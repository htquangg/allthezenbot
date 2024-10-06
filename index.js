require("dotenv").config();

require("./log");

const { sleep, formarCurrency, cleanupAndExit } = require("./utils");

const X_ID_TOKEN = process.env.X_ID_TOKEN;

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

const MAX_AGE = 300; // seconds

let stop = false;

process.on("SIGINT", () => {
  stop = true;
  cleanupAndExit();
});

process.on("SIGTERM", () => {
  stop = true;
  cleanupAndExit();
});

process.on("unhandledRejection", (reason, promise) => {
  stop = true;
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

const CAT_CATEGORY = {
  PAGE: "page",
  PAGES_GANG: "pages_gang",
  FOOTBALLER: "footballer",
  CROSSBREED: "crossbreed",
};

let TARGET_CAT_CATEGORY = CAT_CATEGORY.CROSSBREED;

function catCategoryNumberToString(catCategory) {
  let targetCatCategory = CAT_CATEGORY.CROSSBREED;

  switch (Number(catCategory)) {
    case 1:
      targetCatCategory = CAT_CATEGORY.PAGE;
      break;
    case 2:
      targetCatCategory = CAT_CATEGORY.PAGES_GANG;
      break;
    case 3:
      targetCatCategory = CAT_CATEGORY.FOOTBALLER;
      break;
    case 4:
    default:
      targetCatCategory = CAT_CATEGORY.CROSSBREED;
      break;
  }

  return targetCatCategory;
}

const Fastify = require("fastify");
const fastify = Fastify({
  logger: true,
  disableRequestLogging: true,
});

fastify.setNotFoundHandler((request, reply) => {
  return responseFailure(reply);
});

function routeV1(fastify, opts, done) {
  fastify.get("/debug/healthz", function handler(_, reply) {
    return responseSuccess(reply);
  });
  fastify.get("/zen/purple", function handler(_, _) {
    return responseSuccess(reply, {
      total: calculateZenPurple(),
      zps: getZPSPurle(),
    });
  });
  fastify.get("/zen/yellow", function handler(_, _) {
    return responseSuccess(reply, {
      total: calculateZenYellow(),
      zps: getZPSYellow(),
    });
  });
  fastify.get("/eggs/buy/:catCategory", async function handler(_, reply) {
    const { catCategory } = request.params;
    TARGET_CAT_CATEGORY = catCategoryNumberToString(catCategory);
    return responseSuccess(reply, {
      catCategory: TARGET_CAT_CATEGORY,
    });
  });
  done();
}

fastify.register(routeV1, { prefix: "/api/v1" });

try {
  fastify.listen({ port: 3000 });
} catch (error) {
  console.error(err);
  process.exit(1);
}

let gameInfo = {};
let lastGameInfo = null;

(async function main() {
  await claimTao();

  while (!stop) {
    try {
      await autoFetchInfo();

      console.log(
        `total purple zen: ${formarCurrency(
          calculateZenPurple(),
        )} -- total yellow zen: ${formarCurrency(calculateZenYellow())}`,
      );

      if (!gameInfo) {
        continue;
      }

      switch (TARGET_CAT_CATEGORY) {
        case CAT_CATEGORY.PAGE:
          await wrapBuyPageEgg();
          break;
        case CAT_CATEGORY.PAGES_GANG:
          await wrapBuyPagesGangEgg();
          break;
        case CAT_CATEGORY.FOOTBALLER:
          await wrapBuyFootballerEgg();
          break;
        case CAT_CATEGORY.CROSSBREED:
        default:
          await wrapBuyCrossbreedEgg();
          break;
      }
    } catch (error) {
      console.error("unknown error: ", error);
    } finally {
      await sleep(10 * 1e3);
    }
  }
})();

async function autoFetchInfo() {
  const now = new Date();
  const diffSec = (now.getTime() - (lastGameInfo?.getTime() || 0)) / 1000;
  if (diffSec >= MAX_AGE) {
    await fetchInfo();
  }
}

async function wrapBuyPageEgg() {
  if (canBuyPageEgg()) {
    await buyPageEgg();
    await fetchInfo();
    await sleep(10 * 1e3);
    await claimTao();
  }
}

async function wrapBuyPagesGangEgg() {
  if (canBuyPagesGangEgg()) {
    await buyPagesGangEgg();
    await fetchInfo();
    await sleep(15 * 1e3);
    await claimTao();
  }
}

async function wrapBuyFootballerEgg() {
  if (canBuyFootballerEgg()) {
    await buyFootballerEgg();
    await fetchInfo();
    await sleep(20 * 1e3);
    await claimTao();
  }
}

async function wrapBuyCrossbreedEgg() {
  if (canBuyCrossbreedEgg()) {
    await buyCrossbreedEgg();
    await fetchInfo();
    await sleep(30 * 1e3);
    await claimTao();
  }
}

function buyPageEgg() {
  return buyFancyEgg(CAT_CATEGORY.PAGE);
}

function buyPagesGangEgg() {
  return buyFancyEgg(CAT_CATEGORY.PAGES_GANG);
}

function buyFootballerEgg() {
  return buyFancyEgg(CAT_CATEGORY.FOOTBALLER);
}

function buyCrossbreedEgg() {
  return buyFancyEgg(CAT_CATEGORY.CROSSBREED);
}

function canBuyPageEgg() {
  const can = canBuyEgg(CAT_CATEGORY.PAGE);
  if (!can) {
    console.debug(
      `unable to buy 'page' egg -- pageEdgePrice: ${formarCurrency(
        getPageEggPrice(),
      )} -- totalPurleZen: ${formarCurrency(calculateZenPurple())}`,
    );
  }
  return can;
}

function canBuyPagesGangEgg() {
  const can = canBuyEgg(CAT_CATEGORY.PAGES_GANG);
  if (!can) {
    console.debug(
      `unable to buy 'pages_gang' egg -- pageEdgePrice: ${formarCurrency(
        getPagesGangEggPrice(),
      )} -- totalPurleZen: ${formarCurrency(calculateZenPurple())}`,
    );
  }
  return can;
}

function canBuyFootballerEgg() {
  can = canBuyEgg(CAT_CATEGORY.FOOTBALLER);
  if (!can) {
    console.debug(
      `unable to buy 'footballer' egg -- pageEdgePrice: ${formarCurrency(
        getFootballerEggPrice(),
      )} -- totalPurleZen: ${formarCurrency(calculateZenPurple())}`,
    );
  }
  return can;
}

function canBuyCrossbreedEgg() {
  const can = canBuyEgg(CAT_CATEGORY.CROSSBREED);
  if (!can) {
    console.debug(
      `unable to buy 'crossbreed' egg -- pageEdgePrice: ${formarCurrency(
        getCrossbreedEggPrice(),
      )} -- totalPurleZen: ${formarCurrency(calculateZenPurple())}`,
    );
  }
  return can;
}

function canBuyEgg(catCategory) {
  if (!gameInfo) {
    return false;
  }
  const zenPurple = calculateZenPurple();
  const priceEgg = getEggPrice(catCategory);
  return zenPurple >= priceEgg;
}

function getPageEggPrice() {
  return getEggPrice(CAT_CATEGORY.PAGE);
}

function getPagesGangEggPrice() {
  return getEggPrice(CAT_CATEGORY.PAGES_GANG);
}

function getFootballerEggPrice() {
  return getEggPrice(CAT_CATEGORY.FOOTBALLER);
}

function getCrossbreedEggPrice() {
  return getEggPrice(CAT_CATEGORY.CROSSBREED);
}

function getEggPrice(catCategory) {
  if (!gameInfo) {
    return MAX_NUMBER;
  }

  const eggShop = gameInfo?.zen_den?.egg_shop;
  if (!eggShop) {
    return MAX_NUMBER;
  }

  const pageShop = eggShop.filter((e) => e.cat_category === catCategory);
  if (!pageShop.length) {
    return MAX_NUMBER;
  }

  return pageShop[0]?.current_price ?? MAX_NUMBER;
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
  return gameInfo.zen_den?.zen_status?.zen_count + getZPSPurle() * diffSec;
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
    getZPSYellow() * diffSec
  );
}

function getZPSPurle() {
  if (!gameInfo) {
    return 0;
  }
  if (!lastGameInfo) {
    return 0;
  }

  return gameInfo.zen_den?.zen_status?.zps || 0;
}

function getZPSYellow() {
  if (!gameInfo) {
    return 0;
  }
  if (!lastGameInfo) {
    return 0;
  }

  return gameInfo.zen_den?.regenesis_egg_status?.zps || 0;
}

function getUrl(path) {
  const uri = new URL(API_URL);
  uri.pathname = path;
  return uri.toString();
}

function fetchInfo() {
  return new Promise((resolve) => {
    fetch(getUrl("/egg/api/den"), {
      headers: HEADERS,
      body: null,
      method: "GET",
    })
      .then(async (res) => {
        const payload = await res.json();
        gameInfo = payload;
        lastGameInfo = new Date();
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to fetch info", error);
        reject(error);
      });
  });
}

function buyFancyEgg(catCategory) {
  return new Promise((resolve) => {
    fetch(getUrl("/egg/api/den/buy-fancy-egg"), {
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
        console.error("failed to fetch info", error);
        reject(error);
      });
  });
}

function claimTao() {
  return new Promise((resolve) => {
    fetch(getUrl("/egg/api/den/claim-tao"), {
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
        console.error("failed to fetch info", error);
        reject(error);
      });
  });
}

function upgradeEgg(upgradeId) {
  return new Promise((resolve) => {
    fetch(getUrl("/egg/api/den/upgrades/buy"), {
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
        console.error("failed to fetch info", error);
        reject(error);
      });
  });
}

function responseSuccess(reply, data) {
  if (data) {
    return { code: 200, status: "OK", data };
  }
  return { code: 200, status: "OK" };
}

function responseFailure(reply, data) {
  if (data) {
    return { code: 200, status: "ERROR", data };
  }
  return { code: 200, status: "ERROR" };
}
