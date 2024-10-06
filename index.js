require("dotenv").config();
require("./log");

const cookie = require("cookie");
const Fastify = require("fastify");

const {
  sleep,
  formarCurrency,
  cleanupAndExit,
  randomIntFromInterval,
} = require("./utils");

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

const CAT_CATEGORY = {
  PAGE: "page",
  PAGES_GANG: "pages_gang",
  FOOTBALLER: "footballer",
  CROSSBREED: "crossbreed",
  BAND: "band",
};

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
    if (diffSec >= MAX_AGE) {
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
    if (diffSec >= MAX_AGE) {
      return responseFailure(reply, null, 500);
    }

    const user = getUser();

    return responseSuccess(reply, {
      user: {
        first_name: user?.first_name,
        last_name: user?.last_name,
        username: user?.username,
      },
      cat_category: targetCatCategory,
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

  done();
}

fastify.register(routeV1, { prefix: "/api/v1" });

try {
  fastify.listen({ port: Number(process.env.ZEN_PORT) || 3000 });
} catch (error) {
  console.error(err);
  process.exit(1);
}

let targetCatCategory = CAT_CATEGORY.CROSSBREED;

let gameInfo = {};
let lastGameInfo = null;

let stop = false;

(async function main() {
  try {
    await claimTao();
  } catch (error) {}

  while (!stop) {
    try {
      await autoFetchInfo();

      console.log("--------------------------------------------------");
      console.log(`>>> username: ${getUser()?.username} <<<`);
      console.log(
        `purple zen -- total ${formarCurrency(
          calculateZenPurple(),
        )} -- zps ${formarCurrency(getZPSPurle())}`,
      );
      console.log(
        `yellow zen -- total ${formarCurrency(
          calculateZenYellow(),
        )} -- zps ${formarCurrency(getZPSYellow())}`,
      );
      const eggs = getEggsPrice();
      eggs.map((egg) => {
        console.log(
          `id ${egg.internal_id} -- egg ${
            egg.cat_category
          } -- price ${formarCurrency(egg.current_price)}`,
        );
      });

      if (!gameInfo) {
        continue;
      }

      await wrapBuyEgg(targetCatCategory);
    } catch (error) {
      console.error("unknown error: ", error);
    } finally {
      await wrapBuyBigEgg();
      await sleep(10 * 1e3);
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

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  stop = true;
  fastify?.close();
  cleanupAndExit(1);
});

async function autoFetchInfo() {
  const now = new Date();
  const diffSec = (now.getTime() - (lastGameInfo?.getTime() || 0)) / 1000;
  if (diffSec >= MAX_AGE) {
    await fetchInfo();
  }
}

async function wrapBuyEgg(catCategory) {
  switch (catCategory) {
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
      await wrapBuyCrossbreedEgg();
      break;
    case CAT_CATEGORY.BAND:
      await wrapBuyBandEgg();
      break;
    default:
      await wrapBuyBandEgg();
      break;
  }
}

async function wrapBuyBigEgg() {
  if (canBuyBigEgg()) {
    await buyBigEgg();
    await sleep(randomIntFromInterval(30 * 1e3, 45 * 1e3));
    await claimTao();
    await fetchInfo();
  }
}

async function wrapBuyPageEgg() {
  if (canBuyPageEgg()) {
    await buyPageEgg();
    await sleep(randomIntFromInterval(10 * 1e3, 15 * 1e3));
    await claimTao();
    await fetchInfo();
  }
}

async function wrapBuyPagesGangEgg() {
  if (canBuyPagesGangEgg()) {
    await buyPagesGangEgg();
    await sleep(randomIntFromInterval(15 * 1e3, 25 * 1e3));
    await claimTao();
    await fetchInfo();
  }
}

async function wrapBuyFootballerEgg() {
  if (canBuyFootballerEgg()) {
    await buyFootballerEgg();
    await sleep(randomIntFromInterval(20 * 1e3, 30 * 1e3));
    await claimTao();
    await fetchInfo();
  }
}

async function wrapBuyCrossbreedEgg() {
  if (canBuyCrossbreedEgg()) {
    await buyCrossbreedEgg();
    await sleep(randomIntFromInterval(30 * 1e3, 45 * 1e3));
    await claimTao();
    await fetchInfo();
  }
}

async function wrapBuyBandEgg() {
  if (canBuyBandEgg()) {
    await buyBandEgg();
    await fetchInfo();
    await sleep(randomIntFromInterval(50 * 1e3, 75 * 1e3));
    await claimTao();
    await fetchInfo();
  }
}

function canBuyPageEgg() {
  const can = canBuyEgg(CAT_CATEGORY.PAGE);
  if (!can) {
    console.debug(
      `unable to buy 'page' egg -- price: ${formarCurrency(
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
      `unable to buy 'pages_gang' egg -- price: ${formarCurrency(
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
      `unable to buy 'footballer' egg -- price: ${formarCurrency(
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
      `unable to buy 'crossbreed' egg -- price: ${formarCurrency(
        getCrossbreedEggPrice(),
      )} -- totalPurleZen: ${formarCurrency(calculateZenPurple())}`,
    );
  }
  return can;
}

function canBuyBandEgg() {
  const can = canBuyEgg(CAT_CATEGORY.BAND);
  if (!can) {
    console.debug(
      `unable to buy 'band' egg -- price: ${formarCurrency(
        getBandEggPrice(),
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

function canBuyBigEgg() {
  if (!gameInfo) {
    return false;
  }

  const now = new Date();
  const nextPetTimestamp = new Date(
    gameInfo?.zen_den?.regenesis_egg_status?.next_pet_timestamp,
  );
  const diffSec = (now.getTime() - nextPetTimestamp.getTime()) / 1e3;

  const can = diffSec >= 0;

  if (!can) {
    console.debug(
      `[BIGEGG] next time to claim big egg: ${nextPetTimestamp.toLocaleString()}`,
    );
  }

  return can;
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

function buyBandEgg() {
  return buyFancyEgg(CAT_CATEGORY.BAND);
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

function getBandEggPrice() {
  return getEggPrice(CAT_CATEGORY.BAND);
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

function catCategoryNumberToString(catCategory) {
  let targetCatCategory = CAT_CATEGORY.BAND;

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
      targetCatCategory = CAT_CATEGORY.CROSSBREED;
      break;
    case 5:
      targetCatCategory = CAT_CATEGORY.BAND;
      break;
    default:
      targetCatCategory = CAT_CATEGORY.BAND;
      break;
  }

  return targetCatCategory;
}

function catCategoryStringToNumber(catCategory) {
  let targetCatCategory = 5;

  switch (catCategory) {
    case CAT_CATEGORY.PAGE:
      targetCatCategory = 1;
      break;
    case CAT_CATEGORY.PAGES_GANG:
      targetCatCategory = 2;
      break;
    case CAT_CATEGORY.FOOTBALLER:
      targetCatCategory = 3;
      break;
    case CAT_CATEGORY.CROSSBREED:
      targetCatCategory = 4;
      break;
    case CAT_CATEGORY.BAND:
      targetCatCategory = 5;
      break;
    default:
      targetCatCategory = 5;
      break;
  }

  return targetCatCategory;
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

function getUrl(path) {
  const uri = new URL(API_URL);
  uri.pathname = path;
  return uri.toString();
}

function fetchInfo() {
  return new Promise((resolve, reject) => {
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
  return new Promise((resolve, reject) => {
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
        console.error("failed to buy fancy egg", error);
        reject(error);
      });
  });
}

function buyBigEgg() {
  return new Promise((resolve, reject) => {
    fetch(getUrl("/egg/api/den/gently-stroke-the-regenesis-egg"), {
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
            ).toLocaleString()}`,
          );
        }
        resolve(payload);
      })
      .catch((error) => {
        console.error("failed to buy big egg", error);
        reject(error);
      });
  });
}

function claimTao() {
  return new Promise((resolve, reject) => {
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
        console.error("failed to claim tao", error);
        reject(error);
      });
  });
}

function upgradeEgg(upgradeId) {
  return new Promise((resolve, reject) => {
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
        console.error("failed to upgrad egg", error);
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

function responseFailure(reply, data, code = 200) {
  reply.code(code);
  if (data) {
    return { code, status: "ERROR", data };
  }
  return { code, status: "ERROR" };
}
