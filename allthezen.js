require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const cookie = require("cookie");
const nodeFetch = require("node-fetch-native");
const { createProxy } = require("node-fetch-native/proxy");
const { program } = require("commander");
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const CircuitBreaker = require("opossum");

require("./log");
require("./notification");
const packageJson = require("./package.json");
const {
  sleep,
  formatCurrency,
  cleanupAndExit,
  randomIntFromInterval: randomInt,
  processEnv,
} = require("./utils");
const { eventBus } = require("./bus");

program
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
  .option(
    "--allow-listen",
    "Specify the server status on which server is using for listening.",
  )
  .option(
    "-p, --port <port>",
    "Specify the TCP port on which the server is listening for connections.",
  )
  .option(
    "--ignore-proxy",
    "Specify the proxy status on which server is using for connections.",
  )
  .option(
    "--target-cat-category <targetCatCategory>",
    "Specify the target cat category on which server is using for auto upgrade",
  )
  .parse(process.argv);

const cmdOpts = program.opts();

const ALLOW_LISTEN = cmdOpts.allowListen || false;

const PORT = cmdOpts.port || processEnv("PORT") || 3000;

const IGNORE_PROXY = cmdOpts.ignoreProxy || false;

const TARGET_CAT_CATEGORY = cmdOpts.targetCatCategory || "";

const MAX_NUMBER = Number.MAX_SAFE_INTEGER;

class AllTheZenBot {
  #baseApiUrl = "https://zenegg-api.production.cryptokitties.dapperlabs.com";

  #maxAgeRefreshGameInfo = 300;
  #maxAgeNotifyGameinfo = 300;
  #urgentClaimBigEggSec = 300;
  #urgentClaimParadeKittiesSec = 600;
  #ignoreProxy = IGNORE_PROXY;

  #allowUpgradeEgg = false;
  #allowBuyEgg = false;

  // { ["tg_id"]: { game :{}, account: {}, storefront: {}, lastFetchGameInfo, targetCatCategory, token, proxy, allowUpgradeEgg, allowBuyEgg, lastNofifyGameInfo } }
  #data = {};

  withAllowUpgradeEgg() {
    this.#allowUpgradeEgg = true;
    return this;
  }

  withAllowBuyEgg() {
    this.#allowBuyEgg = true;
    return this;
  }

  healthCheck() {
    if (!Object.keys(this.#data).length) {
      return false;
    }

    const now = new Date();
    for (const familyId in this.#data) {
      const diffSec =
        (now.getTime() -
          (this.#data[familyId].lastFetchGameInfo?.getTime() || MAX_NUMBER)) /
        1000;
      if (diffSec >= this.#maxAgeRefreshGameInfo) {
        return false;
      }
    }

    return true;
  }

  data() {
    for (const familyId in this.#data) {
      this.#data[familyId].paradeKitties = this.#getParadeKitties(familyId);
      this.#data[familyId].totalPurple = this.#calculateZenPurple(familyId);
      this.#data[familyId].zpsPurple = this.#getZPSPurle(familyId);
      this.#data[familyId].totalYellow = this.#calculateZenYellow(familyId);
      this.#data[familyId].zpsYellow = this.#getZPSYellow(familyId);
      this.#data[familyId].nextPetTimestamp =
        this.#getNextPetTimestamp(familyId);
    }
    return this.#data;
  }

  async updateProxyClient(familyId, proxy) {
    if (!this.#data[familyId]) {
      return;
    }
    this.#data[familyId].proxy = proxy;
  }

  async updateTokenClient(familyId, token) {
    if (!this.#data[familyId]) {
      return;
    }
    this.#data[familyId].token = token;

    const writeStream = fs.createWriteStream("data.txt");
    for (const familyId in this.#data) {
      const user = this.#data[familyId];
      writeStream.write(`${user.token}\n`, "utf8");
    }
    writeStream.end();
  }

  async updateTargetCatCategoryClient(familyId, targetCatCategory) {
    if (!this.#data[familyId]) {
      return;
    }
    const eggShop = this.#getEggs(familyId);
    const egg = eggShop.filter((e) => e.cat_category === targetCatCategory);
    if (!egg.length) {
      return;
    }
    this.#data[familyId].targetCatCategory = targetCatCategory;
  }

  async allowUpgradeEggClient(familyId) {
    if (!this.#data[familyId]) {
      return;
    }
    this.#data[familyId].allowUpgradeEgg = true;
  }

  async denyUpgradeEggClient(familyId) {
    if (!this.#data[familyId]) {
      return;
    }
    this.#data[familyId].allowUpgradeEgg = false;
  }

  async allowBuyEggClient(familyId) {
    if (!this.#data[familyId]) {
      return;
    }
    this.#data[familyId].allowBuyEgg = true;
  }

  async denyBuyEggClient(familyId) {
    if (!this.#data[familyId]) {
      return;
    }
    this.#data[familyId].allowBuyEgg = false;
  }

  async claimParadeKittyClient(familyId, id) {
    if (!this.#data[familyId]) {
      return;
    }
    const kitty = this.#getParadeKitties(familyId)?.[Number(id) - 1];
    if (!kitty) {
      return;
    }
    await this.#claimFancyParadeKittyAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId),
      kitty?.id,
    );
    await this.#refreshGameInfo(familyId, true);
  }

  async refreshClient(familyId) {
    if (!this.#data[familyId]) {
      return;
    }
    await this.#refreshGameInfo(familyId, true);
  }

  async checkProxyIP(proxy) {
    const response = await this.#get(
      "https://api.ipify.org?format=json",
      {},
      proxy,
    );
    if (!response.success) {
      throw new Error(`Cann't check IP proxy. Status code: ${response.error}`);
    }
    return response.data.ip;
  }

  async run() {
    this.#initProxies();
    this.#initData();

    await eventBus.dispatchAsync("server.started");

    let stop = false;

    for (const familyId in this.#data) {
      try {
        await this.checkProxyIP(this.#getUserProxy(familyId));
      } catch (error) {
        this.#logError(
          familyId,
          "failed to resolve proxy",
          this.#getUserProxy(familyId),
          error,
        );
        this.#data[familyId].proxy =
          this.proxies[randomInt(0, this.proxies.length - 1)];
      }
    }

    const tasks = [
      this.#wrapBuySmallEgg.bind(this),
      this.#wrapBuyBigEgg.bind(this),
      this.#wrapUpgradeEgg.bind(this),
      this.#wrapBuyFancyEgg.bind(this),
      this.#wrapAckAchievements.bind(this),
      this.#wrapClaimStorefront.bind(this),
    ];

    while (!stop) {
      for (const familyId in this.#data) {
        try {
          await this.#refreshGameInfo(familyId);

          if (this.#shouldNotifyGameInfo(familyId)) {
            await eventBus.dispatchAsync("game_info.latest", {
              username: this.#getUserAccount(familyId)?.username,
              totalPurple: this.#calculateZenPurple(familyId),
              zpsPurple: this.#getZPSPurle(familyId),
              totalYellow: this.#calculateZenYellow(familyId),
              zpsYellow: this.#getZPSYellow(familyId),
              targetCatCategory: this.#getTargetEgg(familyId)?.cat_category,
              targetCatCategoryPrice:
                this.#getTargetEgg(familyId)?.current_price,
              nextPetTimestamp:
                this.#getNextPetTimestamp(familyId) === MAX_NUMBER
                  ? ""
                  : this.#getNextPetTimestamp(familyId),
              allowUpgradeEgg: this.#getUser(familyId).allowUpgradeEgg,
              allowBuyEgg: this.#getUser(familyId).allowBuyEgg,
            });
          }

          console.log(
            `========== Account ${chalk.green(familyId)} | ${chalk.green(
              this.#getUserAccount(familyId)?.username,
            )} | ${chalk.green(
              this.#getUserAccount(familyId)?.id,
            )} | ip: ${chalk.green(
              getIP(this.#getUserProxy(familyId)),
            )} ==========`,
          );
          this.#logInfo(
            familyId,
            `${chalk.bold.bgHex("#A45DF0")(
              "[PURPLE]",
            )} ZEN -- [TOTAL] ${chalk.bold.green(
              formatCurrency(this.#calculateZenPurple(familyId)),
            )} -- [ZPS] ${chalk.bold.green(
              formatCurrency(this.#getZPSPurle(familyId)),
            )}`,
          );
          this.#logInfo(
            familyId,
            `${chalk.bold.bgHex("#D9ED24")(
              "[YELLOW]",
            )} ZEN -- [TOTAL] ${chalk.bold.green(
              formatCurrency(this.#calculateZenYellow(familyId)),
            )} -- [ZPS] ${chalk.bold.green(
              formatCurrency(this.#getZPSYellow(familyId)),
            )}`,
          );
          const eggs = this.#getEggs(familyId);
          eggs.map((egg, idx) => {
            this.#logDebug(
              familyId,
              `id ${chalk.red(idx + 1)} -- egg '${chalk.red(
                egg.cat_category,
              )}' -- price ${chalk.red(formatCurrency(egg.current_price))}`,
            );
          });

          for (const task of tasks) {
            await task(familyId);
            await sleep(randomInt(1 * 1e3, 3 * 1e3));
          }
        } catch (error) {
          this.#logError(familyId, error);
        }
      }

      await sleep(randomInt(3 * 1e3, 5 * 1e3));
    }
  }

  async #wrapBuySmallEgg(familyId) {
    if (!this.#getUser(familyId)?.allowBuyEgg) {
      return;
    }

    if (this.#canBuySmallEgg(familyId) && !this.#canBuyFancyEgg(familyId)) {
      if (this.#canClaimTao(familyId)) {
        await this.#claimTaoAPI(
          this.#getUserToken(familyId),
          this.#getUserProxy(familyId),
        );
        await sleep(randomInt(3 * 1e3, 5 * 1e3));
      }
      await this.#buyFancyEggAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
        this.#getSmallEgg(familyId)?.cat_category,
      );
      await sleep(randomInt(5 * 1e3, 10 * 1e3));
      await this.#claimTaoAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
      );
      await sleep(randomInt(5 * 1e3, 7 * 1e3));
      // await this.#refreshGameInfo(familyId, true);
    }
  }

  async #wrapBuyBigEgg(familyId) {
    if (!this.#canBuyBigEgg(familyId)) {
      const shouldNotify =
        this.#getDiffSecToNextPet(familyId) <= 0
          ? Math.abs(this.#getDiffSecToNextPet(familyId)) <=
            this.#urgentClaimBigEggSec
          : false;
      if (shouldNotify) {
        await eventBus.dispatchAsync("big_egg.ready_to_claim", {
          username: this.#getUserAccount(familyId)?.username,
          nextPetTimestamp:
            this.#getNextPetTimestamp(familyId) === MAX_NUMBER
              ? null
              : this.#getNextPetTimestamp(familyId),
        });
      }
      // NOTE: in testing, we found that when you claim the parade kitties 10 minutes before claim big egg,
      // you are more likely to receive the parade kitties after claim big egg.
      const shouldClaimParadeKitties =
        this.#getDiffSecToNextPet(familyId) <= 0
          ? Math.abs(this.#getDiffSecToNextPet(familyId)) <=
            this.#urgentClaimParadeKittiesSec
          : false;
      if (shouldClaimParadeKitties) {
        await this.#claimParadeKitties(familyId);
      }
      return;
    }

    await this.#claimParadeKitties(familyId);
    await sleep(randomInt(3 * 1e3, 5 * 1e3));
    await this.#buyBigEggAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId),
    );
    await sleep(randomInt(3 * 1e3, 5 * 1e3));
    await this.#claimZenModeTaoAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId),
    );
    await sleep(randomInt(3 * 1e3, 5 * 1e3));
    await this.#claimTaoAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId),
    );
    await sleep(randomInt(3 * 1e3, 5 * 1e3));
    await this.#refreshGameInfo(familyId, true);
    await eventBus.dispatchAsync("big_egg.already_claimed", {
      username: this.#getUserAccount(familyId)?.username,
      nextPetTimestamp:
        this.#getNextPetTimestamp(familyId) === MAX_NUMBER
          ? null
          : this.#getNextPetTimestamp(familyId),
    });
  }

  async #wrapBuyFancyEgg(familyId) {
    if (!this.#getUser(familyId)?.allowBuyEgg) {
      return;
    }

    if (this.#canBuyFancyEgg(familyId)) {
      if (this.#canClaimTao(familyId)) {
        await this.#claimTaoAPI(
          this.#getUserToken(familyId),
          this.#getUserProxy(familyId),
        );
        await sleep(randomInt(3 * 1e3, 5 * 1e3));
      }
      await this.#buyFancyEggAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
        this.#getTargetEgg(familyId)?.cat_category,
      );
      await sleep(randomInt(3 * 1e3, 5 * 1e3));
      await this.#claimTaoAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
      );
      await sleep(randomInt(3 * 1e3, 5 * 1e3));
      await this.#refreshGameInfo(familyId, true);
    }
  }

  async #wrapAckAchievements(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return;
    }

    const achievements = game?.zen_den?.unacked_user_achievements || [];
    if (!achievements.length) {
      return;
    }
    const ids = [achievements[0].id];
    await this.#ackAchievementsAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId),
      ids,
    );
    await sleep(randomInt(3 * 1e3, 5 * 1e3));
    await this.#refreshGameInfo(familyId, true);
  }

  async #wrapClaimStorefront(familyId) {
    const storefront = this.#getUserStorefront(familyId);
    if (!storefront || !Object.keys(storefront).length) {
      return;
    }
    if (!storefront.balance.stored_balance) {
      return;
    }

    await this.#claimStorefrontAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId),
    );
    await sleep(randomInt(3 * 1e3, 5 * 1e3));
    await this.#refreshGameInfo(familyId, true);
  }

  async #wrapUpgradeEgg(familyId) {
    if (!this.#getUser(familyId)?.allowUpgradeEgg) {
      return;
    }

    if (!this.#canUpgradeEgg(familyId)) {
      return;
    }

    await this.#upgradeEggAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId),
      this.#getFirstUpgrade(familyId)?.id,
    );
    await sleep(randomInt(3 * 1e3, 5 * 1e3));
    await this.#refreshGameInfo(familyId, true);
  }

  #canBuyBigEgg(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return false;
    }
    const can = !!(
      this.#getDiffSecToNextPet(familyId) >= 0 &&
      this.#getNextPetTimestamp(familyId) !== MAX_NUMBER
    );
    if (!can) {
      const nextPetDate = new Date(this.#getNextPetTimestamp(familyId));
      this.#logDebug(
        familyId,
        `${chalk.bold.red(
          "[BIG-EGG]",
        )} next time to claim big egg: ${chalk.bold.red(
          nextPetDate.toISOString(),
        )}`,
      );
    }

    return can;
  }

  #canBuySmallEgg(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return false;
    }
    const smallEgg = this.#getSmallEgg(familyId);
    if (!Object.keys(smallEgg).length) {
      return false;
    }
    const isValidLevelEgg =
      !!(
        smallEgg.purchase_count <
        smallEgg.max_level * smallEgg.hatchable_cats?.length
      ) && !Object.keys(smallEgg.store_requirement || {}).length
        ? true
        : !!smallEgg.store_requirement.is_purchased;
    if (!isValidLevelEgg) {
      return false;
    }

    const zenPurple = this.#calculateZenPurple(familyId);
    const zpsZenPurple = this.#getZPSPurle(familyId);
    const priceEgg = this.#getSmallEggPrice(familyId);
    // TOIMPROVE: remove magic number 10
    const can = !!(zenPurple >= priceEgg && zpsZenPurple * 10 >= priceEgg);
    if (!can) {
      this.#logDebug(
        familyId,
        `unable to buy small egg ${chalk.bold.red(
          this.#getSmallEgg(familyId)?.cat_category,
        )} -- price ${chalk.bold.red(
          formatCurrency(this.#getSmallEggPrice(familyId)),
        )}`,
      );
    }
    return can;
  }

  #canClaimTao(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return false;
    }
    return !!game.can_claim_tao;
  }

  #canBuyFancyEgg(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return false;
    }

    const targetEgg = this.#getTargetEgg(familyId);
    if (!Object.keys(targetEgg).length) {
      return false;
    }
    const isValidLevelEgg =
      !!(
        targetEgg.purchase_count <
        targetEgg.max_level * targetEgg.hatchable_cats?.length
      ) && !Object.keys(targetEgg.store_requirement || {}).length
        ? true
        : !!targetEgg.store_requirement.is_purchased;
    if (!isValidLevelEgg) {
      return false;
    }

    const zenPurple = this.#calculateZenPurple(familyId);
    const priceEgg = this.#getTargetEggPrice(familyId);
    const can = !!(zenPurple >= priceEgg);
    if (!can) {
      this.#logDebug(
        familyId,
        `unable to buy egg ${chalk.bold.red(
          this.#getTargetEgg(familyId)?.cat_category,
        )} -- price ${chalk.bold.red(
          formatCurrency(this.#getTargetEggPrice(familyId)),
        )}`,
      );
    }
    return can;
  }

  #getSmallEggPrice(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return MAX_NUMBER;
    }
    const targetEgg = this.#getSmallEgg(familyId);
    return targetEgg?.current_price || MAX_NUMBER;
  }

  #getTargetEggPrice(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return MAX_NUMBER;
    }
    const targetEgg = this.#getTargetEgg(familyId);
    return targetEgg?.current_price || MAX_NUMBER;
  }

  #getSmallEgg(familyId) {
    const eggShop = this.#getEggs(familyId);
    const eggShopFilter = eggShop.filter(
      (curr) =>
        curr.purchase_count < curr.max_level * curr.hatchable_cats?.length &&
        (!Object.keys(curr.store_requirement || {}).length
          ? true
          : !!curr.store_requirement.is_purchased),
    );
    const egg = eggShopFilter.reduce((prev, curr) =>
      prev.current_price < curr.current_price ? prev : curr,
    );
    return egg;
  }

  #getTargetEgg(familyId) {
    const eggShop = this.#getEggs(familyId);
    const egg = eggShop.filter(
      (e) => e.cat_category === this.#data[familyId].targetCatCategory,
    );
    if (!egg.length) {
      return {};
    }
    return egg[0];
  }

  #getEggs(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return [];
    }
    return game?.zen_den?.egg_shop || [];
  }

  async #claimParadeKitties(familyId) {
    await this.#refreshGameInfo(familyId, true);

    const paradeKitties = this.#getParadeKitties(familyId);
    if (!paradeKitties.length) {
      return;
    }

    for (let kitty of paradeKitties) {
      await this.#claimFancyParadeKittyAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
        kitty?.id,
      );
      await sleep(randomInt(3 * 1e3, 5 * 1e3));
    }

    await this.#refreshGameInfo(familyId, true);
  }

  #getParadeKitties(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return [];
    }

    return game.zen_den?.claimable_fancy_parade_kitties || [];
  }

  #canUpgradeEgg(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return false;
    }

    const zenPurple = this.#calculateZenPurple(familyId);
    const firstUpgrade = this.#getFirstUpgrade(familyId);
    if (!firstUpgrade || !Object.keys(firstUpgrade).length) {
      return false;
    }
    const can = !!(zenPurple >= firstUpgrade.price);
    if (!can) {
      this.#logDebug(
        familyId,
        `unable to ${chalk.bold.red("upgrade")} egg -- name '${chalk.red(
          this.#getFirstUpgrade(familyId)?.name,
        )}' -- price ${chalk.red(
          formatCurrency(this.#getFirstUpgrade(familyId)?.price),
        )}`,
      );
    }

    return can;
  }

  #getDiffSecToNextPet(familyId) {
    const now = new Date();
    const nextPetTimestamp = this.#getNextPetTimestamp(familyId);
    if (nextPetTimestamp === MAX_NUMBER) {
      return MAX_NUMBER;
    }
    const nextPetDate = new Date(this.#getNextPetTimestamp(familyId));
    return (now.getTime() - nextPetDate.getTime()) / 1e3;
  }

  #getNextPetTimestamp(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return MAX_NUMBER;
    }
    return game.zen_den?.regenesis_egg_status?.next_pet_timestamp || MAX_NUMBER;
  }

  #calculateZenPurple(familyId) {
    const user = this.#getUser(familyId);
    if (!user) {
      return 0;
    }
    if (!user.lastFetchGameInfo) {
      return 0;
    }
    const now = new Date();
    const diffSec = (now.getTime() - user.lastFetchGameInfo.getTime()) / 1e3;
    return (
      user.game.zen_den?.zen_status?.zen_count +
        this.#getZPSPurle(familyId) * diffSec || 0
    );
  }

  #getZPSPurle(familyId) {
    const user = this.#getUser(familyId);
    if (!user) {
      return 0;
    }
    return user.game.zen_den?.zen_status?.zps || 0;
  }

  #calculateZenYellow(familyId) {
    const user = this.#getUser(familyId);
    if (!user) {
      return 0;
    }
    if (!user.lastFetchGameInfo) {
      return 0;
    }
    const now = new Date();
    const diffSec = (now.getTime() - user.lastFetchGameInfo.getTime()) / 1e3;
    return (
      user.game.zen_den?.regenesis_egg_status?.zen_accumulated +
        this.#getZPSYellow(familyId) * diffSec || 0
    );
  }

  #getZPSYellow(familyId) {
    const user = this.#data[familyId];
    if (!user) {
      return 0;
    }
    return user.game.zen_den?.regenesis_egg_status?.zps || 0;
  }

  #getUser(familyId) {
    return this.#data[familyId] || {};
  }

  #getUserAccount(familyId) {
    const user = this.#data[familyId];
    if (user) {
      return user.account;
    }
  }

  #getUserFromToken(token) {
    const cookies = cookie.parse(token);
    let jsonCookies = {};
    try {
      jsonCookies = JSON.parse(
        cookies?.user?.substring(0, cookies?.user?.indexOf("&chat_instance")),
      );
    } catch (error) {
      this.#logError(token, "failed to extract user info: ", error);
    }
    return jsonCookies;
  }

  #getUserGame(familyId) {
    const user = this.#data[familyId];
    if (user) {
      return user.game || {};
    }
    return {};
  }

  #getUserStorefront(familyId) {
    const user = this.#data[familyId];
    if (user) {
      return user.storefront || {};
    }
    return {};
  }

  #getUserToken(familyId) {
    return this.#getUser(familyId)?.token;
  }

  #getUserProxy(familyId) {
    return this.#getUser(familyId)?.proxy;
  }

  #getFirstUpgrade(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return {};
    }

    const upgradesForPurchase = game?.zen_den?.upgrades_for_purchase;
    if (!upgradesForPurchase) {
      return {};
    }

    return {
      id: upgradesForPurchase?.[0].id,
      name: upgradesForPurchase?.[0].name,
      price: upgradesForPurchase?.[0].price,
    };
  }

  #setUserAccount(familyId) {
    const user = this.#data[familyId];
    if (user && user.account && Object.keys(user.account).length > 0) {
      return;
    }
    try {
      const jsonCookies = this.#getUserFromToken(this.#getUserToken(familyId));
      this.#data[familyId] = {
        ...this.#data[familyId],
        account: jsonCookies,
      };
    } catch (error) {
      this.#logError(familyId, "failed to extract user info: ", error);
    }
  }

  #shouldNotifyGameInfo(familyId) {
    const now = new Date();
    const diffSec =
      (now.getTime() -
        (this.#getUser(familyId).lastNofifyGameInfo?.getTime() || 0)) /
      1000;
    const should = !!(diffSec >= this.#maxAgeNotifyGameinfo);
    if (should) {
      this.#data[familyId].lastNofifyGameInfo = now;
    }
    return should;
  }

  async #refreshGameInfo(familyId, force = false) {
    const user = this.#getUser(familyId);
    const now = new Date();
    const diffSec =
      (now.getTime() - (user.lastFetchGameInfo?.getTime() || 0)) / 1000;
    if (
      force ||
      diffSec >= this.#maxAgeRefreshGameInfo ||
      !user ||
      !user.game ||
      Object.keys(user.game).length === 0 ||
      !user.account ||
      Object.keys(user.account).length === 0
    ) {
      const gameInfoResult = await this.#fetchGameInfoAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
      );
      if (gameInfoResult.success) {
        let targetCatCategory = this.#data[familyId]?.targetCatCategory;
        const isInvalid =
          !targetCatCategory ||
          targetCatCategory === "" ||
          (gameInfoResult.data?.zen_den?.egg_shop?.length &&
            !gameInfoResult.data?.zen_den?.egg_shop.filter(
              (c) => c.cat_category === targetCatCategory,
            )?.length);
        if (isInvalid) {
          targetCatCategory =
            gameInfoResult.data?.zen_den?.egg_shop[
              gameInfoResult.data?.zen_den?.egg_shop?.length - 1
            ]?.cat_category || "";
          console.warn(
            `invalid targetCatCategory: '${
              this.#data[familyId]?.targetCatCategory
            }'. Cat categories: '${gameInfoResult.data?.zen_den?.egg_shop
              ?.map((e) => e.cat_category)
              ?.join(", ")}' .Default: '${targetCatCategory}'`,
          );
        }

        const storefrontResult = await this.#fetchStorefrontAPI(
          this.#getUserToken(familyId),
          this.#getUserProxy(familyId),
        );

        this.#data = {
          ...this.#data,
          [familyId]: {
            ...this.#data[familyId],
            targetCatCategory,
            game: gameInfoResult.data,
            storefront: storefrontResult.data,
            lastFetchGameInfo: new Date(),
          },
        };
        this.#setUserAccount(familyId);
      }
    }
  }

  #getFamilyId(id) {
    return 10000 + Number(id);
  }

  #getFamilyToken(token = "token") {
    return crypto.createHash("md5").update(token).digest("hex").slice(0, 16);
  }

  #initProxies() {
    this.proxies = fs
      .readFileSync("proxy.txt", "utf8")
      .split("\n")
      .filter(Boolean);
  }

  #initData() {
    const dataFile = path.join(__dirname, "data.txt");
    const data = fs
      .readFileSync(dataFile, "utf8")
      .replace(/\r/g, "")
      .split("\n")
      .filter(Boolean);
    for (let idx = 0; idx < data.length; idx++) {
      const token = data[idx];

      let proxy = this.proxies[idx];
      if (!proxy) {
        proxy = this.proxies[randomInt(0, this.proxies.length - 1)];
      }

      this.#data = {
        ...this.#data,
        [this.#getFamilyId(idx)]: {
          game: {},
          account: {},
          lastFetchGameInfo: null,
          token,
          proxy,
          targetCatCategory: TARGET_CAT_CATEGORY,
          allowUpgradeEgg: this.#allowUpgradeEgg,
          allowBuyEgg: this.#allowBuyEgg,
        },
      };
      this.#setUserAccount(this.#getFamilyId(idx));
    }
  }

  async #fetchGameInfoAPI(token, proxy) {
    const result = await this.#get(
      this.#getGameUrl("/egg/api/den"),
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to fetch game info:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.fetched_game_info", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #fetchStorefrontAPI(token, proxy) {
    const result = await this.#get(
      this.#getGameUrl("/egg/api/storefront/current"),
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to fetch storefront:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.fetched_storefront", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #claimStorefrontAPI(token, proxy) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/currencies/claim"),
      null,
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to claim storefront:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.claimed_storefront", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #buyStorefrontAPI(token, proxy, itemId) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/storefront/purchases"),
      {
        item_id: itemId,
      },
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to buy storefront:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.bought_storefront", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #buyBigEggAPI(token, proxy) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/gently-stroke-the-regenesis-egg"),
      null,
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to buy big egg:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.bought_big_egg", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #buyFancyEggAPI(token, proxy, catCategory) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/buy-fancy-egg"),
      {
        cat_category: catCategory,
      },
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to buy fancy egg:",
        catCategory,
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.bought_fancy_egg", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #claimFancyParadeKittyAPI(token, proxy, id) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/claim-fancy-parade-kitty"),
      {
        fancy_parade_kitty_claim_id: id,
      },
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to claim fancy parade kitty:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.claimed_fancy_parade_kitty", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #claimZenModeTaoAPI(token, proxy) {
    const taps = randomInt(25, 60);

    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/claim-zen-mode-tao"),
      {
        taps,
      },
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to claim zen mode tao:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.claimed_zen_mode_tao", {
        token,
      });
    }
    return result;
  }

  async #claimTaoAPI(token, proxy) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/claim-tao"),
      null,
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(token, "failed to claim tao:", result.error, getIP(proxy));
      await eventBus.dispatchAsync("error.api.claimed_tao", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #upgradeEggAPI(token, proxy, upgrade_id) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/upgrades/buy"),
      {
        upgrade_id,
      },
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to upgrade egg:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.upgraded_egg", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #ackAchievementsAPI(token, proxy, ids) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/achievements/ack"),
      {
        ids,
      },
      this.#getHeaderToken(token),
      proxy,
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to ack achievements:",
        result.error,
        getIP(proxy),
      );
      await eventBus.dispatchAsync("error.api.ack_achievements", {
        token,
        error: {
          msg: result.error,
        },
      });
    }
    return result;
  }

  async #get(url, headers = {}, proxy = null) {
    return await this.requestWithCircuitBreaker(
      url,
      "GET",
      null,
      headers,
      proxy,
    );
  }

  async #post(url, payload = null, headers = {}, proxy = null) {
    return await this.requestWithCircuitBreaker(
      url,
      "POST",
      payload,
      headers,
      proxy,
    );
  }

  async #put(url, payload = null, headers = {}, proxy = null) {
    return await this.requestWithCircuitBreaker(
      url,
      "PUT",
      payload,
      headers,
      proxy,
    );
  }

  async #delete(url, payload = null, headers = {}, proxy = null) {
    return await this.requestWithCircuitBreaker(
      url,
      "DELETE",
      payload,
      headers,
      proxy,
    );
  }

  #getGameUrl(path) {
    const uri = new URL(this.#baseApiUrl);
    uri.pathname = path;
    return uri.toString();
  }

  #breakers = new Map();

  async requestWithCircuitBreaker(
    url,
    method,
    payload = null,
    headers = {},
    proxy = null,
  ) {
    let breaker = this.#breakers.get(
      this.#getFamilyToken(headers[this.#getKeyTokenHeader()]),
    );
    if (!breaker) {
      const abortController = new AbortController();
      this.#breakers.set(
        this.#getFamilyToken(headers[this.#getKeyTokenHeader()]),
        {
          abortController,
          fn: new CircuitBreaker(this.#request, {
            abortController,
            timeout: 30000, // If our function takes longer than 30 seconds, trigger a failure
            errorThresholdPercentage: 80, // When 50% of requests fail, trip the circuit
            resetTimeout: 60000, // After 60 seconds, try again.
          }),
        },
      );
      breaker = this.#breakers.get(
        this.#getFamilyToken(headers[this.#getKeyTokenHeader()]),
      );
    }

    try {
      const data = await breaker.fn.fire(
        url,
        method,
        payload,
        {
          ...this.#headers(),
          ...headers,
        },
        this.#ignoreProxy ? null : proxy,
        breaker.abortController.signal,
      );

      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async #request(
    url,
    method,
    payload = null,
    headers = {},
    proxy = null,
    abortSignal = null,
  ) {
    let config = {
      method,
      headers,
      ...(payload && { body: JSON.stringify(payload) }),
      signal: abortSignal,
    };

    if (proxy) {
      config = {
        ...config,
        ...createProxy({
          url: proxy,
        }),
      };
    }

    const response = await nodeFetch(url, config);
    const data = await response.json();
    if (data?.error) {
      throw new Error(data.error);
    }
    return data;
  }

  #getHeaderToken(token) {
    return {
      [this.#getKeyTokenHeader()]: token,
    };
  }

  #getKeyTokenHeader() {
    return "x-id-token";
  }

  #headers() {
    return {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      Referer: "https://zenegg-app.production.cryptokitties.dapperlabs.com/",
    };
  }

  #logDebug(familyId, ...args) {
    return this.#stdout("debug", familyId, ...args);
  }

  #logInfo(familyOrToken, ...args) {
    return this.#stdout("log", familyOrToken, ...args);
  }

  #logError(familyOrToken, ...args) {
    return this.#stdout("error", familyOrToken, ...args);
  }

  #stdout(level, familyOrToken, ...args) {
    const isToken = familyOrToken.startsWith("user=");
    if (isToken) {
      const user = this.#getUserFromToken(familyOrToken);
      console[level](`[${user.username}][${user.id}]`, ...args);
      return;
    }
    console[level](
      `[${familyOrToken}][${this.#getUserAccount(familyOrToken)?.username}][${
        this.#getUserAccount(familyOrToken)?.id
      }][${getIP(this.#getUser(familyOrToken)?.proxy)}]`,
      ...args,
    );
  }
}

/*******************************/
/*********** MAIN *************/
/*****************************/
const bot = new AllTheZenBot();
const fastify = Fastify({
  logger: true,
  disableRequestLogging: true,
});

process.on("SIGINT", () => {
  fastify?.close();
  cleanupAndExit(0);
});

process.on("SIGTERM", () => {
  fastify?.close();
  cleanupAndExit(0);
});

process.on("unhandledRejection", async (error, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", error);
  await eventBus.dispatchAsync("error.unhandled_rejection", {
    error: {
      msg: error?.message || error,
      stack: error?.stack,
    },
  });
  // fastify?.close();
  // cleanupAndExit(1);
});

function routeV1(fastify, _, done) {
  fastify.get("/debug/healthz", function handler(_, reply) {
    const health = bot.healthCheck();
    if (!health) {
      return responseFailure(reply, null, 500);
    }
    return responseSuccess(reply);
  });
  fastify.get("/debug/info", function handler(_, reply) {
    const data = bot.data();
    if (!Object.keys(data).length) {
      return responseFailure(reply, null, 500);
    }
    return responseSuccess(reply, data);
  });
  fastify.put("/clients/proxy", async function handler(request, reply) {
    const { familyId, proxy } = request.body;
    await bot.updateProxyClient(familyId, proxy);
    return responseSuccess(reply);
  });
  fastify.put("/clients/token", async function handler(request, reply) {
    const { familyId, token } = request.body;
    await bot.updateTokenClient(familyId, token);
    return responseSuccess(reply);
  });
  fastify.put("/clients/eggs/category", async function handler(request, reply) {
    const { familyId, catCategory } = request.body;
    await bot.updateTargetCatCategoryClient(familyId, catCategory);
    return responseSuccess(reply);
  });
  fastify.put(
    "/clients/eggs/allow-upgrade",
    async function handler(request, reply) {
      const { familyId } = request.body;
      await bot.allowUpgradeEggClient(familyId);
      return responseSuccess(reply);
    },
  );
  fastify.put(
    "/clients/eggs/deny-upgrade",
    async function handler(request, reply) {
      const { familyId } = request.body;
      await bot.denyUpgradeEggClient(familyId);
      return responseSuccess(reply);
    },
  );
  fastify.put(
    "/clients/eggs/allow-buy",
    async function handler(request, reply) {
      const { familyId } = request.body;
      await bot.allowBuyEggClient(familyId);
      return responseSuccess(reply);
    },
  );
  fastify.put("/clients/eggs/deny-buy", async function handler(request, reply) {
    const { familyId } = request.body;
    await bot.denyBuyEggClient(familyId);
    return responseSuccess(reply);
  });
  fastify.post(
    "/clients/claim-parade-kitty",
    async function handler(request, reply) {
      const { familyId, id } = request.body;
      await bot.claimParadeKittyClient(familyId, id);
      return responseSuccess(reply);
    },
  );
  fastify.get(
    "/clients/:familyId/refresh",
    async function handler(request, reply) {
      const { familyId } = request.params;
      await bot.refreshClient(familyId);
      return responseSuccess(reply);
    },
  );

  done();
}

fastify.register(cors, {});
fastify.setNotFoundHandler((_, reply) => {
  return responseFailure(reply);
});

fastify.register(routeV1, { prefix: "/api/v1" });

if (ALLOW_LISTEN) {
  try {
    fastify.listen({ port: PORT });
  } catch (error) {
    console.error(error);
    eventBus.dispatchAsync("error.server", {
      error: {
        msg: error?.message || error,
        stack: error?.stack,
      },
    });
    cleanupAndExit(1);
  }
}

bot
  .withAllowBuyEgg()
  // .withAllowUpgradeEgg()
  .run()
  .catch((err) => {
    console.error(err);
    cleanupAndExit(1);
  });

/*******************************/
/*********** UTILS *************/
/*****************************/
function responseSuccess(reply, data) {
  reply.status = 200;
  if (data) {
    return { code: 200, status: "OK", data };
  }
  return { code: 200, status: "OK" };
}

function responseFailure(reply, data, code = 200) {
  reply.code(code);
  if (data) {
    return { code, status: "ERROR", data };
  }
  return { code, status: "ERROR" };
}

function getIP(proxy) {
  return proxy?.split("@")?.[1]?.split(":")?.[0];
}
