require("dotenv").config();

const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const cookie = require("cookie");
const nodeFetch = require("node-fetch-native");
const { createProxy } = require("node-fetch-native/proxy");
const { program } = require("commander");
const Fastify = require("fastify");

require("./log");
require("./notification");
const packageJson = require("./package.json");
const {
  sleep,
  formarCurrency,
  cleanupAndExit,
  randomIntFromInterval,
  processEnv,
} = require("./utils");
const { eventBus } = require("./bus");

program
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
  .option(
    "-p, --port <port>",
    "Specify the TCP port on which the server is listening for connections."
  )
  .option(
    "--ignore-proxy",
    "Specify the proxy status on which server is using for connections."
  )
  .parse(process.argv);

const cmdOpts = program.opts();

const PORT = cmdOpts.port || processEnv("PORT") || 3000;

const IGNORE_PROXY = cmdOpts.ignoreProxy || false;

const MAX_NUMBER = Number.MAX_SAFE_INTEGER;

class AllTheZenBot {
  #baseApiUrl = "https://zenegg-api.production.cryptokitties.dapperlabs.com";

  #maxAgeRefreshGameInfo = 300;
  #maxAgeNotifyGameinfo = 300;
  #urgentClaimBigEggSec = 300;
  #ignoreProxy = IGNORE_PROXY;

  #allowUpgradeEgg = false;
  #allowBuyEgg = false;

  // { ["tg_id"]: { game :{}, account: {}, lastFetchGameInfo, targetCatCategory, token, proxy, allowUpgradeEgg, allowBuyEgg, lastNofifyGameInfo } }
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

  async checkProxyIP(proxy) {
    const response = await this.#get(
      "https://api.ipify.org?format=json",
      {},
      proxy
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

    while (!stop) {
      for (const familyId in this.#data) {
        try {
          let proxyIP = "";
          try {
            proxyIP = await this.checkProxyIP(this.#getUserProxy(familyId));
          } catch (error) {
            this.#logError(familyId, "failed to resolve proxy", error);
          }

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
              this.#getUserAccount(familyId)?.username
            )} | ${chalk.green(
              this.#getUserAccount(familyId)?.id
            )} | ip: ${chalk.green(proxyIP)} ==========`
          );
          this.#logInfo(
            familyId,
            `${chalk.bold.bgHex("#A45DF0")(
              "[PURPLE]"
            )} ZEN -- [TOTAL] ${chalk.bold.green(
              formarCurrency(this.#calculateZenPurple(familyId))
            )} -- [ZPS] ${chalk.bold.green(
              formarCurrency(this.#getZPSPurle(familyId))
            )}`
          );
          this.#logInfo(
            familyId,
            `${chalk.bold.bgHex("#D9ED24")(
              "[YELLOW]"
            )} ZEN -- [TOTAL] ${chalk.bold.green(
              formarCurrency(this.#calculateZenYellow(familyId))
            )} -- [ZPS] ${chalk.bold.green(
              formarCurrency(this.#getZPSYellow(familyId))
            )}`
          );
          const eggs = this.#getEggs(familyId);
          eggs.map((egg, idx) => {
            this.#logDebug(
              familyId,
              `id ${chalk.red(idx + 1)} -- egg '${chalk.red(
                egg.cat_category
              )}' -- price ${chalk.red(formarCurrency(egg.current_price))}`
            );
          });

          await this.#wrapBuyBigEgg(familyId);

          await this.#wrapUpgradeEgg(familyId);

          await this.#wrapBuyFancyEgg(familyId);

          await this.#wrapAckAchievements(familyId);
        } catch (error) {
          this.#logError(familyId, error);
        }
      }

      await sleep(randomIntFromInterval(5 * 1e3, 15 * 1e3));
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
      return;
    }

    await this.#claimFancyParadeKittyAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId)
    );
    await sleep(randomIntFromInterval(3 * 1e3, 10 * 1e3));
    await this.#buyBigEggAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId)
    );
    await sleep(randomIntFromInterval(3 * 1e3, 5 * 1e3));
    await this.#claimZenModeTaoAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId)
    );
    await sleep(randomIntFromInterval(10 * 1e3, 20 * 1e3));
    await this.#claimTaoAPI(
      this.#getUserToken(familyId),
      this.#getUserProxy(familyId)
    );
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
      await this.#buyFancyEggAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
        this.#getTargetEgg(familyId)?.cat_category
      );
      await sleep(randomIntFromInterval(10 * 1e3, 30 * 1e3));
      await this.#claimTaoAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId)
      );
      await this.#refreshGameInfo(familyId, true);
    }
  }

  async #wrapAckAchievements(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return;
    }

    let stop = false;

    while (!stop) {
      const achievements = game?.zen_den?.unacked_user_achievements || [];
      if (!achievements.length) {
        stop = true;
        continue;
      }
      const ids = [achievements[0].id];
      await this.#ackAchievementsAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
        ids
      );
      await this.#refreshGameInfo(familyId, true);
      await sleep(randomIntFromInterval(3 * 1e3, 5 * 1e3));
    }
  }

  async #wrapUpgradeEgg(familyId) {
    if (!this.#getUser(familyId)?.allowUpgradeEgg) {
      return;
    }

    let stop = false;
    while (!stop) {
      if (!this.#canUpgradeEgg(familyId)) {
        stop = true;
        continue;
      }
      await this.#upgradeEggAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId),
        this.#getFirstUpgrade(familyId)?.id
      );
      await sleep(randomIntFromInterval(5 * 1e3, 10 * 1e3));
      await this.#claimTaoAPI(
        this.#getUserProxy(familyId),
        this.#getUserToken(familyId)
      );
      await this.#refreshGameInfo(familyId, true);
    }
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
          "[BIG-EGG]"
        )} next time to claim big egg: ${chalk.bold.red(
          nextPetDate.toISOString()
        )}`
      );
    }

    return can;
  }

  #canBuyFancyEgg(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return false;
    }
    const zenPurple = this.#calculateZenPurple(familyId);
    const priceEgg = this.#getTargetEggPrice(familyId);
    const can = !!(zenPurple >= priceEgg);
    if (!can) {
      this.#logDebug(
        familyId,
        `unable to buy egg ${chalk.bold.red(
          this.#getTargetEgg(familyId)?.cat_category
        )} -- price ${chalk.bold.red(
          formarCurrency(this.#getTargetEggPrice(familyId))
        )}`
      );
    }
    return can;
  }

  #getTargetEggPrice(familyId) {
    const game = this.#getUserGame(familyId);
    if (!game || !Object.keys(game).length) {
      return MAX_NUMBER;
    }
    const targetEgg = this.#getTargetEgg(familyId);
    return targetEgg?.current_price || MAX_NUMBER;
  }

  #getTargetEgg(familyId) {
    const eggShop = this.#getEggs(familyId);
    const egg = eggShop.filter(
      (e) => e.cat_category === this.#data[familyId].targetCatCategory
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
          this.#getFirstUpgrade(familyId)?.name
        )}' -- price ${chalk.red(
          formarCurrency(this.#getFirstUpgrade(familyId)?.price)
        )}`
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
        cookies?.user?.substring(0, cookies?.user?.indexOf("&chat_instance"))
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
      (now.getTime() - (this.#getUser(familyId).lastNofifyGameInfo?.getTime() || 0)) /
      1000;
    const should = !!(diffSec >= this.#maxAgeNotifyGameinfo);
    if (should) {
      this.#data[familyId].lastNofifyGameInfo = now;
    }
    return should;
  }

  async #refreshGameInfo(familyId, force = false) {
    const user = this.#getUser(familyId);
    if (
      force ||
      !user ||
      !user.game ||
      Object.keys(user.game).length === 0 ||
      !user.account ||
      Object.keys(user.account).length === 0
    ) {
      const gameInfoResult = await this.#fetchGameInfoAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId)
      );
      if (gameInfoResult.success) {
        this.#data = {
          ...this.#data,
          [familyId]: {
            ...this.#data[familyId],
            targetCatCategory: this.#data[familyId]?.targetCatCategory
              ? this.#data[familyId].targetCatCategory
              : gameInfoResult.data?.zen_den?.egg_shop[
                  gameInfoResult.data?.zen_den?.egg_shop?.length - 1
                ]?.cat_category || "",
            game: gameInfoResult.data,
            lastFetchGameInfo: new Date(),
          },
        };
        this.#setUserAccount(familyId);
      }
      return;
    }

    const now = new Date();
    const diffSec =
      (now.getTime() - (user.lastFetchGameInfo?.getTime() || MAX_NUMBER)) /
      1000;
    if (diffSec >= this.#maxAgeRefreshGameInfo) {
      const gameInfoResult = await this.#fetchGameInfoAPI(
        this.#getUserToken(familyId),
        this.#getUserProxy(familyId)
      );
      if (gameInfoResult.success) {
        this.#data[familyId] = {
          ...this.#data[familyId],
          targetCatCategory: this.#data[familyId]?.targetCatCategory
            ? this.#data[familyId].targetCatCategory
            : gameInfoResult.data?.zen_den?.egg_shop[
                gameInfoResult.data?.zen_den?.egg_shop?.length - 1
              ]?.cat_category || "",
          game: gameInfoResult.data,
          lastFetchGameInfo: new Date(),
        };
      }
    }
  }

  #getFamilyId(id) {
    return 10000 + Number(id);
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
      const [_, token] = data[idx].split("|");

      let proxy = this.proxies[idx];
      if (!proxy) {
        proxy = this.proxies[randomIntFromInterval(0, this.proxies.length - 1)];
      }

      this.#data = {
        ...this.#data,
        [this.#getFamilyId(idx)]: {
          game: {},
          account: {},
          lastFetchGameInfo: null,
          token,
          proxy,
          targetCatCategory: "",
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
      proxy
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to fetch game info:",
        result.error,
        getIP(proxy)
      );
      await eventBus.dispatchAsync("error.api.fetched_game_info", {
        token,
        error: result.error,
      });
    }
    return result;
  }

  async #buyBigEggAPI(token, proxy) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/gently-stroke-the-regenesis-egg"),
      null,
      this.#getHeaderToken(token),
      proxy
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to buy big egg:",
        result.error,
        getIP(proxy)
      );
      await eventBus.dispatchAsync("error.api.bought_big_egg", {
        token,
        error: result.error,
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
      proxy
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to buy fancy egg:",
        catCategory,
        result.error,
        getIP(proxy)
      );
      await eventBus.dispatchAsync("error.api.bought_fancy_egg", {
        token,
        error: result.error,
      });
    }
    return result;
  }

  #tapFancyParadeKitty = randomIntFromInterval(25, 60);

  async #claimFancyParadeKittyAPI(token, proxy) {
    this.#tapFancyParadeKitty = randomIntFromInterval(25, 60);

    const now = new Date();
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/claim-fancy-parade-kitty"),
      {
        fancy_parade_kitty_claim_id: `${now.toISOString().split("T")[0]}:${
          this.#tapFancyParadeKitty
        }`,
      },
      this.#getHeaderToken(token),
      proxy
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to claim fancy parade kitty:",
        result.error,
        getIP(proxy)
      );
      await eventBus.dispatchAsync("error.api.claimed_fancy_parade_kitty", {
        token,
        error: result.error,
      });
    }
    return result;
  }

  async #claimZenModeTaoAPI(token, proxy) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/claim-zen-mode-tao"),
      {
        taps: this.#tapFancyParadeKitty * 2,
      },
      this.#getHeaderToken(token),
      proxy
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to claim zen mode tao:",
        result.error,
        getIP(proxy)
      );
      await eventBus.dispatchAsync("error.api.claimed_zen_mode_tao", {
        token,
        error: result.error,
      });
    }
    return result;
  }

  async #claimTaoAPI(token, proxy) {
    const result = await this.#post(
      this.#getGameUrl("/egg/api/den/claim-tao"),
      null,
      this.#getHeaderToken(token),
      proxy
    );
    if (!result.success) {
      this.#logError(token, "failed to claim tao:", result.error, getIP(proxy));
      await eventBus.dispatchAsync("error.api.claimed_tao", {
        token,
        error: result.error,
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
      proxy
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to upgrade egg:",
        result.error,
        getIP(proxy)
      );
      await eventBus.dispatchAsync("error.api.upgraded_egg", {
        token,
        error: result.error,
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
      proxy
    );
    if (!result.success) {
      this.#logError(
        token,
        "failed to ack achievements:",
        result.error,
        getIP(proxy)
      );
      await eventBus.dispatchAsync("error.api.ack_achievements", {
        token,
        error: result.error,
      });
    }
    return result;
  }

  async #get(url, headers = {}, proxy = null) {
    return await this.#request(url, "GET", null, headers, proxy);
  }

  async #post(url, data = null, headers = {}, proxy = null) {
    return await this.#request(url, "POST", data, headers, proxy);
  }

  async #put(url, data = null, headers = {}, proxy = null) {
    return await this.#request(url, "PUT", data, headers, proxy);
  }

  async #delete(url, data = null, headers = {}, proxy = null) {
    return await this.#request(url, "DELETE", data, headers, proxy);
  }

  #getGameUrl(path) {
    const uri = new URL(this.#baseApiUrl);
    uri.pathname = path;
    return uri.toString();
  }

  async #request(url, method, data = null, headers = {}, proxy = null) {
    let config = {
      method,
      headers: {
        ...this.#headers(),
        ...headers,
      },
      ...(data && { body: JSON.stringify(data) }),
    };

    if (!this.#ignoreProxy && proxy) {
      config = {
        ...config,
        ...createProxy({
          url: proxy,
        }),
      };
    }

    try {
      const response = await nodeFetch(url, config);
      const data = await response.json();
      if (data?.error) {
        return { success: false, error: data.error };
      }
      return { success: true, data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  #getHeaderToken(token) {
    return {
      "x-id-token": token,
    };
  }

  #headers() {
    return {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/json",
      "sec-ch-ua": '"Chromium";v="129", "Not=A?Brand";v="8"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
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
      ...args
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
  stop = true;
  fastify?.close();
  cleanupAndExit(0);
});

process.on("SIGTERM", () => {
  stop = true;
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
  stop = true;
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
    }
  );

  fastify.put(
    "/clients/eggs/deny-upgrade",
    async function handler(request, reply) {
      const { familyId } = request.body;
      await bot.denyUpgradeEggClient(familyId);
      return responseSuccess(reply);
    }
  );

  fastify.put(
    "/clients/eggs/allow-buy",
    async function handler(request, reply) {
      const { familyId } = request.body;
      await bot.allowBuyEggClient(familyId);
      return responseSuccess(reply);
    }
  );

  fastify.put("/clients/eggs/deny-buy", async function handler(request, reply) {
    const { familyId } = request.body;
    await bot.denyBuyEggClient(familyId);
    return responseSuccess(reply);
  });

  done();
}

fastify.setNotFoundHandler((_, reply) => {
  return responseFailure(reply);
});
fastify.register(routeV1, { prefix: "/api/v1" });

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

bot
  .withAllowBuyEgg()
  .withAllowUpgradeEgg()
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
