const cookie = require("cookie");

const { processEnv, convertSecondsToHIS, formatCurrency } = require("./utils");
const { eventBus } = require("./bus");

eventBus.on(
  "server.started",
  async function handleEventServerStarted(_payload) {
    await sendNotification({
      message: `*[START]* server started`,
    });
  },
);

eventBus.on(
  "error.api.fetched_game_info",
  async function handleEventFetchedGameInfoError(payload) {
    const { token, error } = payload;
    await sendNotification({
      message: `*[ERROR][API][FETCHED_GAME_INFO] @${
        getUserFromToken(token)?.username || ""
      }*\n${error?.msg || error}`,
    });
  },
);

eventBus.on(
  "game_info.latest",
  async function handleEventGameInfoLatest(payload) {
    const {
      username,
      totalPurple,
      zpsPurple,
      totalYellow,
      zpsYellow,
      targetCatCategory,
      targetCatCategoryPrice,
      nextPetTimestamp,
      allowUpgradeEgg,
    } = payload;
    await sendNotification({
      message: `*[INFO] @${username}*\n-----\n*PURPLE* -- TOTAL *${formatCurrency(
        totalPurple,
      )}* -- ZPS *${formatCurrency(
        zpsPurple,
      )}*\n*YELLOW* -- TOTAL *${formatCurrency(
        totalYellow,
      )}* -- ZPS *${formatCurrency(
        zpsYellow,
      )}*\n*CAT_CATEGORY* -- *'${targetCatCategory}'* -- *${formatCurrency(
        targetCatCategoryPrice,
      )}*\n*ALLOW_UPGRADE_EGG* -- *${allowUpgradeEgg}*\n${
        nextPetTimestamp
          ? `*BIG_EGG* -- *${new Date(nextPetTimestamp).toLocaleString()}*`
          : ""
      }`,
    });
  },
);

eventBus.on(
  "error.game_info_not_refreshed",
  async function handleEventGameInfoNotRefresh(payload) {
    const { username, lastGameInfo } = payload;
    await sendNotification({
      message: `*[ERROR][GAME_INFO_NOT_REFRESH] AZenBOT @${username}*\nLastGameInfo: *${
        lastGameInfo ? lastGameInfo : "Cann't detect!!!"
      }*`,
    });
  },
);

eventBus.on(
  "big_egg.ready_to_claim",
  async function handleEventBigEggReadyToClaim(payload) {
    const { username, nextPetTimestamp } = payload;
    await sendUrgentBigEggNotification({
      username,
      nextPetTimestamp,
    });
  },
);

eventBus.on(
  "big_egg.already_claimed",
  async function handleEventBigEggAlreadyClaimed(payload) {
    const { username, nextPetTimestamp } = payload;
    await sendAlreadyClaimBigEggNotification({
      username,
      nextPetTimestamp,
    });
  },
);

eventBus.on("error.server", async function handleEventServerError(payload) {
  const { username, error } = payload;
  await sendNotification({
    message: `*[ERROR][SERVER] AZenBOT @${username}*\n${error?.msg}\n${error.stack}`,
  });
});

eventBus.on(
  "error.unhandled_rejection",
  async function handleEventUnhandledRejection(payload) {
    const { username, error } = payload;
    await sendNotification({
      message: `*[ERROR][UNHANDLED_REJECTION] AZenBOT @${username}*\n${error?.msg}\n${error?.stack}`,
    });
  },
);

eventBus.on("error.zen.api", async function handleErrorZenAPI(payload) {
  const { username, error } = payload;
  await sendNotification({
    message: `*[ERROR][ZEN][API] AZenBOT @${username}*\n${error?.msg}`,
  });
});

const TELEGRAM_API_URL = "https://api.telegram.org";
const ALL_THE_ZEN_BOT_URL = "https://t.me/CKMeowBot/AllTheZen";

async function sendUrgentBigEggNotification(payload) {
  if (!payload?.nextPetTimestamp) {
    console.warn("[BIG-EGG][URGENT] No next pet timestamp");
    return;
  }
  const now = new Date();
  const nextPetDate = new Date(payload.nextPetTimestamp);
  const diffSec = ((nextPetDate?.getTime() || 0) - now.getTime()) / 1000;
  const message = `*[HOT] BIG EGG READY ${
    payload?.username ? `@${payload.username}` : ""
  }*\nBig Egg is ready to be *claimed*.\nCountdown: *${
    diffSec > 0 ? convertSecondsToHIS(diffSec) : "00:00:00"
  }*\n${ALL_THE_ZEN_BOT_URL}`;
  return await sendTelegramNotification({
    message: message,
  });
}

async function sendAlreadyClaimBigEggNotification(payload) {
  if (!payload?.nextPetTimestamp) {
    console.warn("[BIG-EGG][ALREADY-CLAIM] No next pet timestamp");
    return;
  }
  const nextPetDate = new Date(payload.nextPetTimestamp);
  const message = `*[HOT] BIG EGG CLAIMED ${
    payload?.username ? `@${payload.username}` : ""
  }*\nBig Egg is already taken.\nNext: *${nextPetDate.toLocaleString()}*\n${ALL_THE_ZEN_BOT_URL}`;
  return await sendTelegramNotification({
    message: message,
  });
}

async function sendNotification(payload) {
  return await sendTelegramNotification(payload);
}

async function sendTelegramNotification(payload) {
  const url = getTelegramAPIUrl("/sendMessage");
  const groupId = getTelegramGroupId();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: groupId,
      text: payload.message,
      parse_mode: "Markdown",
    }),
  });
  // should not **return await res.json()** when return the response
  // https://github.com/nodejs/undici/issues/3097
  const data = await res.json();
  return data;
}

function getTelegramAPIUrl(path) {
  return TELEGRAM_API_URL + "/bot" + getTelegramToken() + path;
}

function getTelegramToken() {
  return processEnv("TELEGRAM_TOKEN");
}

function getTelegramGroupId() {
  return processEnv("TELEGRAM_CHAT_ID");
}

function getUserFromToken(token) {
  const cookies = cookie.parse(token);
  let jsonCookies = {};
  try {
    jsonCookies = JSON.parse(
      cookies?.user?.substring(0, cookies?.user?.indexOf("&chat_instance")),
    );
  } catch (error) {
    console.error("failed to extract user info: ", error);
  }
  return jsonCookies;
}

module.exports = {
  sendNotification,
  sendUrgentBigEggNotification,
  sendAlreadyClaimBigEggNotification,
};
