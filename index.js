require("dotenv").config();

const cookie = require("cookie");
const Fastify = require("fastify");
const chalk = require("chalk");
const { program } = require("commander");
const fetch = require("node-fetch-native");
const { createProxy } = require("node-fetch-native/proxy");

require("./log");
require("./notification");
const {
  sleep,
  formarCurrency,
  cleanupAndExit,
  randomIntFromInterval,
  processEnv,
} = require("./utils");
const packageJson = require("./package.json");
const { eventBus } = require("./bus");

program
  .name(packageJson.name)
  .description(packageJson.description)
  .version(packageJson.version)
  .option(
    "-p, --port <port>",
    "Specify the TCP port on which the server is listening for connections.",
  )
  .option(
    "--proxy <scheme://user:pass@ip:port>",
    "Specify the proxy url on which the server is using for connections.",
  )
  .option(
    "--x-id-token <x-id-token>",
    "Specify the AllTheZen token on which server is using for authentication.",
  )
  .option(
    "--allow-upgrade-egg",
    "Specify the AllTheZen token on which server is using for authentication.",
  )
  .parse(process.argv);

const cmdOpts = program.opts();

const PORT = cmdOpts.port || processEnv("PORT");

const PROXY_URL = cmdOpts.proxy || processEnv("PROXY");

const X_ID_TOKEN = cmdOpts.xIdToken || processEnv("X_ID_TOKEN");

const ALLOW_UPGRADE_EGG = cmdOpts.allowUpgradeEgg;

const API_URL = "https://zenegg-api.production.cryptokitties.dapperlabs.com";

const HEADERS = {
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
  "content-type": "application/json",
  "sec-ch-ua": '"Chromium";v="129", "Not=A?Brand";v="8"',
  "sec-ch-ua-mobile": "?1",
  "sec-ch-ua-platform": '"Android"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "x-id-token": X_ID_TOKEN,
  Referer: "https://zenegg-app.production.cryptokitties.dapperlabs.com/",
};

const MAX_NUMBER = Number.MAX_SAFE_INTEGER;

const MAX_AGE_FETCH_GAME_INFO_SEC = 60;

const URGENT_NOTIFY_GAME_INFO_NOT_REFRESH_SEC = 180;

const MAX_AGE_NOTIFY_GAME_INFO_SEC = 300;

const URGENT_CLAIM_BIG_EGG_SEC = 300;

const CAT_CATEGORY = {
  PAGE: "page",
  PAGES_GANG: "pages_gang",
  FOOTBALLER: "footballer",
  CROSSBREED: "crossbreed",
  KITTENHEIM: "halloween",
  BAND: "band",
  BANDS_MASCOT: "bands_mascot",
};

const proxy = createProxy({
  url: PROXY_URL,
});

const fastify = Fastify({
  logger: true,
  disableRequestLogging: true,
});

fastify.setNotFoundHandler((_, reply) => {
  return responseFailure(reply);
});

function routeV1(fastify, _, done) {
  fastify.get("/debug/healthz", function handler(_, reply) {
    if (!Object.keys(gameInfo).length) {
      return responseFailure(reply, null, 500);
    }
    const now = new Date();
    const diffSec = (now.getTime() - (lastGameInfo?.getTime() || 0)) / 1000;
    if (diffSec >= MAX_AGE_FETCH_GAME_INFO_SEC) {
      return responseFailure(reply, null, 500);
    }
    return responseSuccess(reply);
  });

  fastify.get("/debug/info", function handler(_, reply) {
    if (!Object.keys(gameInfo).length) {
      return responseFailure(reply, null, 500);
    }
    const now = new Date();
    const diffSec = (now.getTime() - (lastGameInfo?.getTime() || 0)) / 1000;
    if (diffSec >= MAX_AGE_FETCH_GAME_INFO_SEC) {
      return responseFailure(reply, null, 500);
    }

    const user = getUser();

    return responseSuccess(reply, {
      user: {
        first_name: user?.first_name,
        last_name: user?.last_name,
        username: user?.username,
      },
      target_cat_category: targetCatCategory,
      zen: {
        purple: {
          total: formarCurrency(calculateZenPurple()),
          zps: formarCurrency(getZPSPurle()),
        },
        yellow: {
          total: formarCurrency(calculateZenYellow()),
          zps: formarCurrency(getZPSYellow()),
        },
      },
      eggs: getEggsPrice()?.map((egg) => {
        return {
          ...egg,
          current_price: formarCurrency(egg.current_price),
        };
      }),
    });
  });

  fastify.get("/eggs/buy/:catCategory", async function handler(request, reply) {
    if (!Object.keys(gameInfo).length) {
      return responseFailure(reply, null, 500);
    }
    const { catCategory } = request.params;
    targetCatCategory = catCategoryNumberToString(catCategory);
    return responseSuccess(reply, {
      catCategory: targetCatCategory,
    });
  });

  fastify.get("/eggs/allow-upgrade", async function handler(request, reply) {
    if (!Object.keys(gameInfo).length) {
      return responseFailure(reply, null, 500);
    }
    allowUpgradeEgg = true;
    return responseSuccess(reply, {
      allowUpgradeEgg,
    });
  });

  fastify.get("/eggs/deny-upgrade", async function handler(request, reply) {
    if (!Object.keys(gameInfo).length) {
      return responseFailure(reply, null, 500);
    }
    allowUpgradeEgg = false;
    return responseSuccess(reply, {
      allowUpgradeEgg,
    });
  });

  done();
}

fastify.register(routeV1, { prefix: "/api/v1" });

try {
  fastify.listen({ port: PORT });
} catch (error) {
  console.error(err);
  eventBus.dispatchAsync("error.server", {
    username: getUser().username,
    error: {
      msg: error?.msg(),
      stack: error?.stack,
    },
  });
  cleanupAndExit(1);
}

let targetCatCategory = CAT_CATEGORY.BAND;

let gameInfo = {};
let allowUpgradeEgg = ALLOW_UPGRADE_EGG || false;
let lastGameInfo = null;
let lastGameInfoNotRefresh = null;
let lastNofifyGameInfo = null;

let stop = false;

(async function main() {
  await eventBus.dispatchAsync("server.started", {
    username: getUser()?.username,
  });
  try {
    await claimTaoAPI();
  } catch (error) {}

  await checkProxyIP();

  while (!stop) {
    try {
      await autoFetchInfo();

      if (shouldNotifyGameInfo()) {
        await eventBus.dispatchAsync("game_info.latest", {
          username: getUser()?.username,
          totalPurple: calculateZenPurple(),
          zpsPurple: getZPSPurle(),
          totalYellow: calculateZenYellow(),
          zpsYellow: getZPSYellow(),
          targetCatCategory,
          targetCatCategoryPrice: getEggPrice(targetCatCategory),
          nextPetTimestamp:
            getNextPetTimestamp() === MAX_NUMBER ? "" : getNextPetTimestamp(),
          allowUpgradeEgg,
        });
      }

      if (shouldNotifyGameInfoNotRefresh()) {
        await eventBus.dispatchAsync("error.game_info_not_refreshed", {
          username: getUser()?.username,
          lastGameInfo: lastGameInfo?.toISOString() || null,
        });
      }

      console.debug("--------------------------------------------------");
      console.log(
        `>>> username: ${chalk.bold.yellow(getUser()?.username)} <<<`,
      );
      console.log(
        `${chalk.bold.bgHex("#A45DF0")(
          "[PURPLE]",
        )} ZEN -- [TOTAL] ${chalk.bold.green(
          formarCurrency(calculateZenPurple()),
        )} -- [ZPS] ${chalk.bold.green(formarCurrency(getZPSPurle()))}`,
      );
      console.log(
        `${chalk.bold.bgHex("#D9ED24")(
          "[YELLOW]",
        )} ZEN -- [TOTAL] ${chalk.bold.green(
          formarCurrency(calculateZenYellow()),
        )} -- [ZPS] ${chalk.bold.green(formarCurrency(getZPSYellow()))}`,
      );
      const eggs = getEggsPrice();
      eggs.map((egg) => {
        console.debug(
          `id ${chalk.red(egg.internal_id)} -- egg '${chalk.red(
            egg.cat_category,
          )}' -- price ${chalk.red(formarCurrency(egg.current_price))}`,
        );
      });

      if (!gameInfo) {
        continue;
      }

      await wrapBuyBigEgg();

      await wrapUpgradeEgg();

      await wrapBuyEgg(targetCatCategory);

      await wrapAckAchievements();
    } catch (error) {
      console.error("unknown error: ", error);
    } finally {
      await sleep(randomIntFromInterval(5 * 1e3, 30 * 1e3));
    }
  }
})();

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
    username: getUser()?.username,
    error: {
      msg: error?.message || error,
      stack: error?.stack,
    },
  });
  stop = true;
  // fastify?.close();
  // cleanupAndExit(1);
});

async function autoFetchInfo() {
  const now = new Date();
  const diffSec = (now.getTime() - (lastGameInfo?.getTime() || 0)) / 1000;
  if (diffSec >= MAX_AGE_FETCH_GAME_INFO_SEC) {
    await fetchInfo();
  }
}

function shouldNotifyGameInfoNotRefresh() {
  const now = new Date();
  const diffSec = (now.getTime() - (lastGameInfo?.getTime() || 0)) / 1000;
  const should = !!(
    diffSec >= URGENT_NOTIFY_GAME_INFO_NOT_REFRESH_SEC &&
    (now.getTime() - (lastGameInfoNotRefresh?.getTime() || 0)) / 1000
  );
  if (should) {
    lastGameInfoNotRefresh = now;
  }
  return should;
}

function shouldNotifyGameInfo() {
  const now = new Date();
  const diffSec = (now.getTime() - (lastNofifyGameInfo?.getTime() || 0)) / 1000;
  const should = !!(
    diffSec >= MAX_AGE_NOTIFY_GAME_INFO_SEC &&
    (now.getTime() - (lastNofifyGameInfo?.getTime() || 0)) / 1000
  );
  if (should) {
    lastNofifyGameInfo = now;
  }
  return should;
}

async function wrapBuyEgg(catCategory) {
  let validCatCategory = Object.values(CAT_CATEGORY).find(
    (v) => v === catCategory,
  );
  if (!validCatCategory) {
    targetCatCategory =
      CAT_CATEGORY[
        Object.keys(CAT_CATEGORY)[Object.keys(CAT_CATEGORY).length - 1]
      ];
  }

  if (canBuyEgg(targetCatCategory)) {
    await buyFancyEggAPI(targetCatCategory);
    await fetchInfo();
    await sleep(randomIntFromInterval(10 * 1e3, 30 * 1e3));
    await claimTaoAPI();
    await fetchInfo();
  }
}

async function wrapUpgradeEgg() {
  if (!allowUpgradeEgg) {
    return;
  }

  let stopUpgrade = false;
  while (!stopUpgrade) {
    if (!canUpgradeEgg()) {
      stopUpgrade = true;
      continue;
    }
    await upgradeEggAPI(getFirstUpgrade()?.id);
    await sleep(randomIntFromInterval(5 * 1e3, 10 * 1e3));
    await claimTaoAPI();
    await fetchInfo();
  }
}

async function wrapBuyBigEgg() {
  if (!canBuyBigEgg()) {
    const shouldNotify =
      getDiffSecToNextPet() <= 0
        ? Math.abs(getDiffSecToNextPet()) <= URGENT_CLAIM_BIG_EGG_SEC
        : false;
    if (shouldNotify) {
      await eventBus.dispatchAsync("big_egg.ready_to_claim", {
        username: getUser()?.username,
        nextPetTimestamp:
          getNextPetTimestamp() === MAX_NUMBER ? null : getNextPetTimestamp(),
      });
    }
    return;
  }

  await buyBigEggAPI();
  await sleep(randomIntFromInterval(3 * 1e3, 5 * 1e3));
  await claimFancyParadeKittyAPI();
  await sleep(randomIntFromInterval(5 * 1e3, 7 * 1e3));
  await claimZenModeTaoAPI();
  await sleep(randomIntFromInterval(10 * 1e3, 20 * 1e3));
  await claimTaoAPI();
  await fetchInfo();
  await eventBus.dispatchAsync("big_egg.already_claimed", {
    nextPetTimestamp:
      getNextPetTimestamp() === MAX_NUMBER ? null : getNextPetTimestamp(),
  });
}

async function wrapAckAchievements() {
  let stopAchievements = false;
  while (!stopAchievements) {
    const achievements = getUnackedAchievements();
    if (!achievements.length) {
      stopAchievements = true;
      continue;
    }
    const ids = [achievements[0].id];
    await ackAchievementsAPI(ids);
    await fetchInfo();
    await sleep(randomIntFromInterval(3 * 1e3, 5 * 1e3));
  }
}

function canBuyEgg(catCategory) {
  if (!gameInfo) {
    return false;
  }
  const zenPurple = calculateZenPurple();
  const priceEgg = getEggPrice(catCategory);

  const can = !!(zenPurple >= priceEgg);
  if (!can) {
    console.debug(
      `unable to ${chalk.bold.red("buy")} egg -- name '${chalk.red(
        catCategory,
      )}' -- price: ${chalk.red(formarCurrency(priceEgg))}`,
    );
  }

  return can;
}

function canBuyBigEgg() {
  if (!gameInfo) {
    return false;
  }
  const can = !!(
    getDiffSecToNextPet() >= 0 && getNextPetTimestamp() !== MAX_NUMBER
  );
  if (!can) {
    const nextPetDate = new Date(getNextPetTimestamp());
    console.debug(
      `${chalk.bold.red(
        "[BIG-EGG]",
      )} next time to claim big egg: ${chalk.bold.red(
        nextPetDate.toISOString(),
      )}`,
    );
  }

  return can;
}

function canUpgradeEgg() {
  if (!gameInfo) {
    return false;
  }
  const zenPurple = calculateZenPurple();
  const firstUpgrade = getFirstUpgrade();
  if (!firstUpgrade || !Object.keys(firstUpgrade).length) {
    return false;
  }

  const can = !!(zenPurple >= firstUpgrade.price);
  if (!can) {
    console.debug(
      `unable to ${chalk.bold.red("upgrade")} egg -- name '${chalk.red(
        getFirstUpgrade()?.name,
      )}' -- price ${chalk.red(formarCurrency(getFirstUpgrade()?.price))}`,
    );
  }

  return can;
}

function getEggPrice(catCategory) {
  if (!gameInfo) {
    return MAX_NUMBER;
  }

  const eggShop = gameInfo?.zen_den?.egg_shop;
  if (!eggShop) {
    return MAX_NUMBER;
  }

  const egg = eggShop.filter((e) => e.cat_category === catCategory);
  if (!egg.length) {
    return MAX_NUMBER;
  }

  return egg[0]?.current_price ?? MAX_NUMBER;
}

function getEggsPrice() {
  if (!gameInfo) {
    return [];
  }

  const eggShop = gameInfo?.zen_den?.egg_shop;
  if (!eggShop) {
    return [];
  }

  return eggShop.map((egg) => {
    return {
      internal_id: catCategoryStringToNumber(egg.cat_category),
      cat_category: egg.cat_category,
      current_price: egg.current_price,
    };
  });
}

function getFirstUpgrade() {
  if (!gameInfo) {
    return {};
  }

  const upgradesForPurchase = gameInfo?.zen_den?.upgrades_for_purchase;
  if (!upgradesForPurchase) {
    return {};
  }

  return {
    id: upgradesForPurchase?.[0].id,
    name: upgradesForPurchase?.[0].name,
    price: upgradesForPurchase?.[0].price,
  };
}

function calculateZenPurple() {
  if (!gameInfo) {
    return 0;
  }
  if (!lastGameInfo) {
    return 0;
  }

  const now = new Date();
  const diffSec = (now.getTime() - lastGameInfo?.getTime()) / 1e3;
  return gameInfo.zen_den?.zen_status?.zen_count + getZPSPurle() * diffSec || 0;
}

function calculateZenYellow() {
  if (!gameInfo) {
    return 0;
  }
  if (!lastGameInfo) {
    return 0;
  }

  const now = new Date();
  const diffSec = (now.getTime() - lastGameInfo?.getTime()) / 1e3;
  return (
    gameInfo.zen_den?.regenesis_egg_status?.zen_accumulated +
      getZPSYellow() * diffSec || 0
  );
}

function getZPSPurle() {
  if (!gameInfo) {
    return 0;
  }

  return gameInfo.zen_den?.zen_status?.zps || 0;
}

function getZPSYellow() {
  if (!gameInfo) {
    return 0;
  }

  return gameInfo.zen_den?.regenesis_egg_status?.zps || 0;
}

function getUnackedAchievements() {
  if (!gameInfo) {
    return [];
  }

  return gameInfo.zen_den?.unacked_user_achievements || [];
}

function catCategoryNumberToString(catCategoryNumber) {
  catCategoryNumber = Number(catCategoryNumber);
  const catCategoryValues = Object.values(CAT_CATEGORY);
  if (catCategoryNumber < 1 || catCategoryNumber > catCategoryValues.length) {
    return catCategoryValues[catCategoryValues.length - 1];
  }
  return catCategoryValues[catCategoryNumber - 1];
}

function catCategoryStringToNumber(catCategory) {
  const catCategoryValues = Object.values(CAT_CATEGORY);
  const catCategoryIdx = catCategoryValues.findIndex((c) => c === catCategory);
  if (catCategoryIdx >= 0) {
    return catCategoryIdx + 1;
  }
  return catCategoryValues.length;
}

function getUser() {
  const cookies = cookie.parse(X_ID_TOKEN);

  let jsonCookies = null;
  try {
    jsonCookies = JSON.parse(
      cookies?.user?.substring(0, cookies?.user?.indexOf("&chat_instance")),
    );
  } catch (error) {
    console.error("failed to extract user info: ", error);
  }

  return jsonCookies;
}

function getDiffSecToNextPet() {
  const now = new Date();
  const nextPetTimestamp = getNextPetTimestamp();
  if (nextPetTimestamp === MAX_NUMBER) {
    return MAX_NUMBER;
  }
  const nextPetDate = new Date(getNextPetTimestamp());
  return (now.getTime() - nextPetDate.getTime()) / 1e3;
}

function getNextPetTimestamp() {
  if (!gameInfo) {
    return MAX_NUMBER;
  }

  return (
    gameInfo.zen_den?.regenesis_egg_status?.next_pet_timestamp || MAX_NUMBER
  );
}

function getUrl(path) {
  const uri = new URL(API_URL);
  uri.pathname = path;
  return uri.toString();
}

function fetchInfo() {
  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den"), {
      headers: HEADERS,
      body: null,
      method: "GET",
    })
      .then(async (res) => {
        const payload = await res.json();
        if (payload?.error) {
          resolve({});
          return;
        }
        gameInfo = payload;
        lastGameInfo = new Date();
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to fetch game info", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to fetch game info",
          },
        });
        reject(error);
      });
  });
}

function buyFancyEggAPI(catCategory) {
  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den/buy-fancy-egg"), {
      headers: HEADERS,
      body: JSON.stringify({
        cat_category: catCategory,
        quantity: 1,
      }),
      method: "POST",
    })
      .then(async (res) => {
        const payload = await res.json();
        console.log(
          "[success] buy fancy egg: ",
          catCategory,
          formarCurrency(payload?.zen_den?.zen_status?.zen_count),
        );
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to buy fancy egg", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to buy fancy egg",
          },
        });
        reject(error);
      });
  });
}

function buyBigEggAPI() {
  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den/gently-stroke-the-regenesis-egg"), {
      headers: HEADERS,
      body: null,
      method: "POST",
    })
      .then(async (res) => {
        const payload = await res.json();
        if (payload?.regenesis_egg_status) {
          console.log(
            `[success] buy big egg -- next-pet-timestamp ${new Date(
              payload.regenesis_egg_status?.next_pet_timestamp,
            ).toISOString()}`,
          );
        }
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to buy big egg", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to buy big egg",
          },
        });
        reject(error);
      });
  });
}

function claimTaoAPI() {
  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den/claim-tao"), {
      headers: HEADERS,
      body: null,
      method: "POST",
    })
      .then(async (res) => {
        const payload = await res.json();
        if (payload?.claim?.id) {
          console.log("[success] claim tao", payload?.claim?.id);
        }
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to claim tao", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to claim tao",
          },
        });
        reject(error);
      });
  });
}

async function checkProxyIP() {
  return new Promise((resolve, reject) => {
    matchRequest("https://api.ipify.org?format=json", {
      headers: HEADERS,
      body: null,
      method: "GET",
    })
      .then(async (res) => {
        const payload = await res.json();
        console.log("[success] Your proxy ip: ", payload.ip);
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to get proxy ip", error);
        reject(error);
      });
  });
}

async function matchRequest(url, options) {
  return fetch(url, {
    ...options,
    ...proxy,
  });
}

let tapFancyParadeKitty = randomIntFromInterval(25, 60);

function claimFancyParadeKittyAPI() {
  tapFancyParadeKitty = randomIntFromInterval(25, 60);

  const now = new Date();

  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den/claim-fancy-parade-kitty"), {
      headers: HEADERS,
      body: JSON.stringify({
        fancy_parade_kitty_claim_id: `${
          now.toISOString().split("T")[0]
        }:${tapFancyParadeKitty}`,
      }),
      method: "POST",
    })
      .then(async (res) => {
        const payload = await res.json();
        if (payload?.error) {
          console.error("failed to claim fancy parade kitty", payload.error);
          eventBus.dispatch("error.zen.api", {
            username: getUser()?.username,
            error: {
              msg: payload.error || "unable to claim parade kitty",
            },
          });
        } else {
          console.debug("[success] claim fancy parade kitty", payload);
        }
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to claim fancy parade kitty", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to claim parade kitty",
          },
        });
        reject(error);
      });
  });
}

function claimZenModeTaoAPI() {
  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den/claim-zen-mode-tao"), {
      headers: HEADERS,
      body: JSON.stringify({
        taps: tapFancyParadeKitty * 2,
      }),
      method: "POST",
    })
      .then(async (res) => {
        const payload = await res.json();
        if (payload?.claim?.id) {
          console.log("[success] claim zen mode tao", payload?.claim?.id);
        }
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to claim zen mode tao", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to claim zen mode tao",
          },
        });
        reject(error);
      });
  });
}

function upgradeEggAPI(upgradeId) {
  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den/upgrades/buy"), {
      headers: HEADERS,
      body: JSON.stringify({
        upgrade_id: upgradeId,
      }),
      method: "POST",
    })
      .then(async (res) => {
        await res.json();
        console.log("[success] upgraded egg");
        resolve();
      })
      .catch((error) => {
        console.error("failed to upgrade egg", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to upgrade egg",
          },
        });
        reject(error);
      });
  });
}

function ackAchievementsAPI(ids) {
  return new Promise((resolve, reject) => {
    matchRequest(getUrl("/egg/api/den/achievements/ack"), {
      headers: HEADERS,
      body: JSON.stringify({
        ids,
      }),
      method: "POST",
    })
      .then(async (res) => {
        await res.json();
        console.log("[success] ack achievements");
        resolve();
      })
      .catch((error) => {
        console.error("failed to ack achievements", error);
        eventBus.dispatch("error.zen.api", {
          username: getUser()?.username,
          error: {
            msg: error.message || "unable to ack achievements",
          },
        });
        reject(error);
      });
  });
}

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
