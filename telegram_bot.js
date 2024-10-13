require("dotenv").config();

const { Telegraf } = require("telegraf");
const { markdownv2: format } = require("telegram-format");

const nodeFetch = require("node-fetch-native");

const { formatCurrency, processEnv } = require("./utils");

const BOT_API_URL = processEnv("BOT_API_URL") || "http://localhost:3000";

const bot = new Telegraf(processEnv("TELEGRAM_TOKEN"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

bot.start((ctx) => {
  ctx.reply(
    "Welcome to your Telegram bot! Use /help to see available commands."
  );
});

bot.command("info", async (ctx) => {
  const result = await nodeFetch(`${BOT_API_URL}/api/v1/debug/info`, {
    rejectUnauthorized: false,
  });
  const data = (await result.json())?.data || {};
  if (Object.keys(data).length) {
    let msg = `${format.bold("[INFO]")}\n`;
    Object.entries(data).forEach(([key, value]) => {
      msg += `Account: ${format.bold(key)} -- ${format.bold(
        value?.account?.username
      )} -- ${format.bold(value?.account?.first_name)}\n`;
      msg += `Proxy: ${format.bold(value?.proxy)}\n`;
      msg += `Token: ${format.bold(value?.token)}\n`;
      msg += `Total Purple: ${format.bold(
        formatCurrency(value?.totalPurple)
      )}\n`;
      msg += `ZPS Purple: ${format.bold(formatCurrency(value?.zpsPurple))}\n`;
      msg += `Total Yellow: ${format.bold(
        formatCurrency(value?.totalYellow)
      )}\n`;
      msg += `ZPS Yellow: ${format.bold(formatCurrency(value?.zpsYellow))}\n`;
      msg += `Next Pet Timestamp: ${format.bold(value?.nextPetTimestamp)}\n`;
      msg += `Target Cat Category: ${format.bold(value?.targetCatCategory)}\n`;
      msg += `Allow Buy Egg: ${format.bold(value?.allowBuyEgg)}\n`;
      msg += `Allow Upgrade Egg: ${format.bold(value?.allowUpgradeEgg)}\n`;
      msg += `Last Fetch Game Info: ${format.bold(value?.lastFetchGameInfo)}\n`;
      msg += `-----------------------------------\n`;
    });
    ctx.reply(msg, { parse_mode: "Markdown" });
  }
});

bot.command("updateproxy", async (ctx) => {
  const [, familyId, proxy] = ctx.message.text.split(" ");
  if (!familyId || !proxy) {
    return ctx.reply("Invalid command. Usage: /updateproxy <familyId> <proxy>");
  }
  await nodeFetch(`${BOT_API_URL}/api/v1/clients/proxy`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId,
      proxy,
    }),
  });
  ctx.reply("Update proxy. Done!");
});

bot.command("updatetoken", async (ctx) => {
  const [, familyId, token] = ctx.message.text.split(" ");
  if (!familyId || !token) {
    return ctx.reply("Invalid command. Usage: /updatetoken <familyId> <token>");
  }
  await nodeFetch(`${BOT_API_URL}/api/v1/clients/token`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId,
      token,
    }),
  });
  ctx.reply("Update token. Done!");
});

bot.command("updatetargetcatcategory", async (ctx) => {
  const [, familyId, targetCatCategory] = ctx.message.text.split(" ");
  if (!familyId || !targetCatCategory) {
    return ctx.reply(
      "Invalid command. Usage: /updatetargetcatcategory <familyId> <targetCatCategory>"
    );
  }
  await nodeFetch(`${BOT_API_URL}/api/v1/clients/eggs/category`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId,
      catCategory: targetCatCategory,
    }),
  });
  ctx.reply("Update target cat category. Done!");
});

bot.command("allowupgradeegg", async (ctx) => {
  const [, familyId] = ctx.message.text.split(" ");
  if (!familyId) {
    return ctx.reply("Invalid command. Usage: /allowupgradeegg <familyId>");
  }
  await nodeFetch(`${BOT_API_URL}/api/v1/clients/eggs/allow-upgrade`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId,
    }),
  });
  ctx.reply("Allow upgrade egg. Done!");
});

bot.command("denyupgradeegg", async (ctx) => {
  const [, familyId] = ctx.message.text.split(" ");
  if (!familyId) {
    return ctx.reply("Invalid command. Usage: /denyupgradeegg <familyId>");
  }
  await nodeFetch(`${BOT_API_URL}/api/v1/clients/eggs/deny-upgrade`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId,
    }),
  });
  ctx.reply("Deny upgrade egg. Done!");
});

bot.command("allowbuyegg", async (ctx) => {
  const [, familyId] = ctx.message.text.split(" ");
  if (!familyId) {
    return ctx.reply("Invalid command. Usage: /allowbuyegg <familyId>");
  }
  await nodeFetch(`${BOT_API_URL}/api/v1/clients/eggs/allow-buy`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId,
    }),
  });
  ctx.reply("Allow buy egg. Done!");
});

bot.command("denybuyegg", async (ctx) => {
  const [, familyId] = ctx.message.text.split(" ");
  if (!familyId) {
    return ctx.reply("Invalid command. Usage: /denybuyegg <familyId>");
  }
  await nodeFetch(`${BOT_API_URL}/api/v1/clients/eggs/deny-buy`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      familyId,
    }),
  });
  ctx.reply("Deny buy egg. Done!");
});

bot.launch();
