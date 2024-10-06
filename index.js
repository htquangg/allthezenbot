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

      await wrapBuyCrossbreedEgg();
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

function canBuyEgg(cat_category) {
  if (!gameInfo) {
    return false;
  }
  const zenPurple = calculateZenPurple();
  const priceEgg = getEggPrice(cat_category);
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

function getEggPrice(cat_category) {
  if (!gameInfo) {
    return MAX_NUMBER;
  }

  const eggShop = gameInfo?.zen_den?.egg_shop;
  if (!eggShop) {
    return MAX_NUMBER;
  }

  const pageShop = eggShop.filter((e) => e.cat_category === cat_category);
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
  return (
    gameInfo.zen_den?.zen_status?.zen_count +
    gameInfo.zen_den?.zen_status?.zps * diffSec
  );
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
    gameInfo.zen_den?.regenesis_egg_status?.zps * diffSec
  );
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

function buyFancyEgg(cat_category) {
  return new Promise((resolve) => {
    fetch(getUrl("/egg/api/den/buy-fancy-egg"), {
      headers: HEADERS,
      body: JSON.stringify({
        cat_category,
        quantity: 1,
      }),
      method: "POST",
    })
      .then(async (res) => {
        const payload = await res.json();
        console.log(
          "[success] buy fancy egg: ",
          cat_category,
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

function upgradeEgg(upgrade_id) {
  return new Promise((resolve) => {
    fetch(getUrl("/egg/api/den/upgrades/buy"), {
      headers: HEADERS,
      body: JSON.stringify({
        upgrade_id,
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
