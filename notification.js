const { processEnv, convertSecondsToHIS } = require("./utils");

const TELEGRAM_API_URL = "https://api.telegram.org";
const ALL_THE_ZEN_BOT_URL = "https://t.me/CKMeowBot/AllTheZen";

async function sendUrgentBigEggNotification(payload) {
  if (!payload?.nextPetTimestamp) {
    return;
  }
  const now = new Date();
  const nextPetTimestamp = new Date(payload.nextPetTimestamp);
  const diffSec = ((nextPetTimestamp?.getTime() || 0) - now.getTime()) / 1000;
  const message = `*BIG EGG URGENT ${
    payload?.username ? `@${payload.username}` : ""
  }*\nBig Egg is ready to be *claimed*.\nCountdown: *${
    diffSec > 0 ? convertSecondsToHIS(diffSec) : "00:00:00"
  }*\n${ALL_THE_ZEN_BOT_URL}`;
  return await sendTelegramNotification({
    message: message,
    parse_mode: "Markdown",
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

  return await res.json();
}

function getTelegramAPIUrl(path) {
  return TELEGRAM_API_URL + "/bot" + getTelegramToken() + path;
}

function getTelegramToken() {
  return processEnv("TELEGRAM_TOKEN");
}

function getTelegramGroupId() {
  return processEnv("TELEGRAM_GROUP_ID");
}

module.exports = {
  sendNotification,
  sendUrgentBigEggNotification,
};
