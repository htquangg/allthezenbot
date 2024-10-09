const { processEnv, convertSecondsToHIS, formarCurrency } = require("./utils");
const { eventBus } = require("./bus");

eventBus.on("server.started", async function handleEventServerStarted(payload) {
  const { username } = payload;
  await sendNotification({
    message: `*[START] AZenBOT @${username}*`,
  });
});

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
    } = payload;
    await sendNotification({
      message: `*[INFO] @${username}*\n-----\n*PURPLE* -- TOTAL *${formarCurrency(
        totalPurple
      )}* -- ZPS *${formarCurrency(
        zpsPurple
      )}*\n*YELLOW* -- TOTAL *${formarCurrency(
        totalYellow
      )}* -- ZPS *${formarCurrency(
        zpsYellow
      )}*\n*CAT_CATEGORY* -- *'${targetCatCategory}'* -- *${formarCurrency(
        targetCatCategoryPrice
      )}*\n${
        nextPetTimestamp
          ? `*BIG_EGG* -- *${new Date(nextPetTimestamp).toLocaleString()}*`
          : ""
      }`,
    });
  }
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
  }
);

eventBus.on(
  "big_egg.ready_to_claim",
  async function handleEventBigEggReadyToClaim(payload) {
    const { username, nextPetTimestamp } = payload;
    await sendUrgentBigEggNotification({
      username,
      nextPetTimestamp,
    });
  }
);

eventBus.on(
  "big_egg.already_claimed",
  async function handleEventBigEggAlreadyClaimed(payload) {
    const { nextPetTimestamp } = payload;
    await sendAlreadyClaimBigEggNotification({
      nextPetTimestamp,
    });
  }
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
  }
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

module.exports = {
  sendNotification,
  sendUrgentBigEggNotification,
  sendAlreadyClaimBigEggNotification,
};
