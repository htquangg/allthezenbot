const { processEnv, convertSecondsToHIS } = require("./utils");

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
  return data
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
