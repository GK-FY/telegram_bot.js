/**
 * telegram_bot.js
 *
 * Developer: FY'S PROPERTY 🕊️
 *
 * Minimal Telegram Investment Bot with:
 *  - 3 Packages (Silver, Gold, Platinum)
 *  - STK push integration via Pay Hero
 *  - 20s countdown (two updates at 10s and 20s)
 *  - Admin commands to edit texts, broadcast, and change channelID
 *  - Ignores group chats
 *  - No Express server or QR code references
 */

"use strict";

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// 1) Telegram bot token
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";

// 2) Admin Telegram numeric ID (replace with your actual ID)
const ADMIN_ID = 123456789;

// 3) Editable bot configuration
let botConfig = {
  welcomeMessage: "👋 *Welcome to the Investment Bot by FY'S PROPERTY!* \nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package*. Please enter the amount (in Ksh) you'd like to invest:",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds... \n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...* \nWe will fetch the status soon!",
  paymentSuccess: "*🎉 Payment Successful!*\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit Number:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  fromAdmin: "From Admin GK-FY",
  channelID: 529
};

// 4) In-memory conversation state & user balances
const userState = {};    // keyed by chatId => { stage, package, amount, depositNumber, stkRef }
const userBalances = {}; // keyed by chatId => numeric

// 5) Investment packages
const packages = [
  { name: "Silver", min: 1000 },
  { name: "Gold", min: 5000 },
  { name: "Platinum", min: 10000 }
];

// 6) Create the Telegram bot (polling mode)
const bot = new TelegramBot(token, { polling: true });

// HELPER: placeholders
function parsePlaceholders(template, data) {
  return template
    .replace(/{amount}/g, data.amount || "")
    .replace(/{package}/g, data.package || "")
    .replace(/{depositNumber}/g, data.depositNumber || "")
    .replace(/{seconds}/g, data.seconds || "")
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{footer}/g, botConfig.paymentFooter || "");
}

// HELPER: STK push via Pay Hero
async function sendSTKPush(amount, depositNumber) {
  const payload = {
    amount: amount,
    phone_number: depositNumber, // For demonstration, depositNumber is used as phone
    channel_id: botConfig.channelID,
    provider: "m-pesa",
    external_reference: "INV-009",
    customer_name: "John Doe",
    callback_url: "https://img-2-url.html-5.me/cl.php",
    account_reference: "FY'S PROPERTY",
    transaction_desc: "FY'S PROPERTY Payment",
    remarks: "FY'S PROPERTY",
    business_name: "FY'S PROPERTY",
    companyName: "FY'S PROPERTY"
  };
  try {
    const response = await axios.post("https://backend.payhero.co.ke/api/v2/payments", payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=="
      }
    });
    return response.data.reference;
  } catch (error) {
    console.error("STK Push Error:", error);
    return null;
  }
}

// HELPER: fetch transaction status from Pay Hero
async function fetchTransactionStatus(ref) {
  try {
    const response = await axios.get(`https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`, {
      headers: {
        "Authorization": "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=="
      }
    });
    return response.data;
  } catch (error) {
    console.error("Status Fetch Error:", error);
    return null;
  }
}

// HELPER: admin alerts
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// HELPER: parse broadcast command (like "msg [123456,987654] Hello!")
function parseBroadcastCommand(msg) {
  const start = msg.indexOf("[");
  const end = msg.indexOf("]");
  if (start === -1 || end === -1) return null;
  const idsStr = msg.substring(start + 1, end).trim();
  const broadcastText = msg.substring(end + 1).trim();
  const ids = idsStr.split(",").map(id => id.trim());
  return { ids, broadcastText };
}

// Admin help text
function getAdminHelp() {
  return (
    "*ADMIN COMMANDS:*\n" +
    "1) /admin - Show this help message.\n" +
    "2) edit <key> <newValue> - Edit a config value.\n" +
    "   Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message\n" +
    "   Example: /broadcast [123456789,987654321] Hello from GK-FY!"
  );
}

// BOT: handle normal messages
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  // Ignore group chats
  if (msg.chat.type !== "private") return;

  // Admin commands
  if (msg.from.id === +ADMIN_ID) {
    // /admin => show admin help
    if (text.toLowerCase() === "/admin") {
      bot.sendMessage(chatId, getAdminHelp(), { parse_mode: "Markdown" });
      return;
    }
    // edit <key> <newValue>
    if (text.startsWith("edit ")) {
      const parts = text.split(" ");
      if (parts.length < 3) {
        bot.sendMessage(chatId, "*⚠️ Invalid format.* Use: edit <key> <newValue>", { parse_mode: "Markdown" });
        return;
      }
      const key = parts[1];
      const newValue = text.substring(("edit " + key + " ").length);
      if (!botConfig.hasOwnProperty(key)) {
        bot.sendMessage(chatId, "*⚠️ Unknown key.* Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID", { parse_mode: "Markdown" });
        return;
      }
      if (key === "channelID") {
        const newID = parseInt(newValue);
        if (isNaN(newID)) {
          bot.sendMessage(chatId, "*⚠️ channelID must be a number.*", { parse_mode: "Markdown" });
          return;
        }
        botConfig.channelID = newID;
        bot.sendMessage(chatId, `*channelID* updated to: ${newID}`, { parse_mode: "Markdown" });
        return;
      }
      botConfig[key] = newValue;
      bot.sendMessage(chatId, `*${key}* updated successfully!`, { parse_mode: "Markdown" });
      return;
    }
    // /broadcast ...
    if (text.startsWith("/broadcast ")) {
      const cmdText = text.substring(11).trim();
      const broadcast = parseBroadcastCommand(cmdText);
      if (!broadcast) {
        bot.sendMessage(chatId, "*⚠️ Invalid format.* Use: /broadcast [chatId1,chatId2,...] message", { parse_mode: "Markdown" });
        return;
      }
      const { ids, broadcastText } = broadcast;
      for (let id of ids) {
        try {
          await bot.sendMessage(id, `*${botConfig.fromAdmin}:*\n${broadcastText}`, { parse_mode: "Markdown" });
        } catch (err) {
          console.error("Broadcast error:", err);
          bot.sendMessage(chatId, `*⚠️ Could not send message to:* ${id}`, { parse_mode: "Markdown" });
        }
      }
      bot.sendMessage(chatId, "*Message sent successfully to the specified users!*", { parse_mode: "Markdown" });
      return;
    }
  }

  // Deposit flow
  if (text.toLowerCase() === "/start") {
    userState[chatId] = { stage: "packageSelection" };
    const keyboard = packages.map(pkg => ([{
      text: `${pkg.name} Package (Min Ksh ${pkg.min})`,
      callback_data: `pkg:${pkg.name}`
    }]));
    bot.sendMessage(chatId, botConfig.welcomeMessage, {
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: "Markdown"
    });
    return;
  }

  if (!userState[chatId]) {
    userState[chatId] = { stage: "packageSelection" };
    bot.sendMessage(chatId, botConfig.welcomeMessage, { parse_mode: "Markdown" });
    return;
  }

  const state = userState[chatId];

  // Stage: awaitingAmount
  if (state.stage === "awaitingAmount") {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid deposit amount in Ksh.*", { parse_mode: "Markdown" });
      return;
    }
    const pkg = packages.find(p => p.name === state.package);
    if (amount < pkg.min) {
      bot.sendMessage(chatId, `*⚠️ The minimum deposit for the ${pkg.name} Package is Ksh ${pkg.min}.*`, { parse_mode: "Markdown" });
      return;
    }
    state.amount = amount;
    state.stage = "awaitingDepositNumber";
    const replyText = parsePlaceholders(botConfig.packageMessage, {
      amount: String(amount),
      package: state.package
    });
    bot.sendMessage(chatId, replyText, { parse_mode: "Markdown" });
    return;
  }

  // Stage: awaitingDepositNumber
  if (state.stage === "awaitingDepositNumber") {
    state.depositNumber = text;
    state.stage = "processing";

    const stkRef = await sendSTKPush(state.amount, state.depositNumber);
    if (!stkRef) {
      bot.sendMessage(chatId, "*❌ Error:* Unable to initiate payment. Please try again later.", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    state.stkRef = stkRef;

    const attemptTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    sendAdminAlert(
      `*💸 Deposit Attempt:*\n` +
      `Amount: Ksh ${state.amount}\n` +
      `Deposit Number: ${state.depositNumber}\n` +
      `Package: ${state.package} Package\n` +
      `Time (KE): ${attemptTime}`
    );

    const initText = parsePlaceholders(botConfig.paymentInitiated, { seconds: "20" });
    bot.sendMessage(chatId, initText, { parse_mode: "Markdown" });

    // After 10 seconds
    setTimeout(() => {
      const midText = parsePlaceholders(botConfig.countdownUpdate, { seconds: "10" });
      bot.sendMessage(chatId, midText, { parse_mode: "Markdown" });
    }, 10000);

    // After 20 seconds => poll status
    setTimeout(async () => {
      const statusData = await fetchTransactionStatus(state.stkRef);
      if (!statusData) {
        bot.sendMessage(chatId, "*❌ Error fetching payment status.* Please try again later.", { parse_mode: "Markdown" });
        delete userState[chatId];
        return;
      }
      const finalStatus = statusData.status ? statusData.status.toUpperCase() : "UNKNOWN";
      const providerReference = statusData.provider_reference || "";
      const resultDesc = statusData.ResultDesc || "";
      const currentDateTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });

      if (finalStatus === "SUCCESS") {
        if (!userBalances[chatId]) userBalances[chatId] = 0;
        userBalances[chatId] += state.amount;

        const successMsg = parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(state.amount),
          package: state.package,
          depositNumber: state.depositNumber,
          mpesaCode: providerReference,
          date: currentDateTime
        });
        bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });

        sendAdminAlert(
          `*✅ Deposit Successful:*\n` +
          `Amount: Ksh ${state.amount}\n` +
          `Deposit Number: ${state.depositNumber}\n` +
          `Package: ${state.package} Package\n` +
          `MPESA Code: ${providerReference}\n` +
          `Time (KE): ${currentDateTime}`
        );
      } else if (finalStatus === "FAILED") {
        let errMsg = "Your payment could not be completed. Please try again.";
        if (resultDesc.toLowerCase().includes("insufficient")) {
          errMsg = "Insufficient funds in your account.";
        } else if (resultDesc.toLowerCase().includes("wrong pin") || resultDesc.toLowerCase().includes("incorrect pin")) {
          errMsg = "The PIN you entered is incorrect.";
        }
        bot.sendMessage(chatId, `*❌ Payment Failed!* ${errMsg}\nType /start to try again.`, { parse_mode: "Markdown" });
        sendAdminAlert(
          `*❌ Deposit Failed:*\n` +
          `Amount: Ksh ${state.amount}\n` +
          `Deposit Number: ${state.depositNumber}\n` +
          `Package: ${state.package} Package\n` +
          `Error: ${errMsg}\n` +
          `Time (KE): ${currentDateTime}`
        );
      } else {
        bot.sendMessage(chatId, `*⏳ Payment Pending.* Current status: ${finalStatus}\nPlease wait a bit longer or contact support.\nType /start to restart.`, { parse_mode: "Markdown" });
      }
      delete userState[chatId];
    }, 20000);

    return;
  }
});

// Callback queries for package selection
bot.on("callback_query", async (callbackQuery) => {
  if (!callbackQuery || !callbackQuery.data) {
    return;
  }
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  if (!msg || !msg.chat) {
    return;
  }
  const chatId = msg.chat.id;

  if (data.startsWith("pkg:")) {
    const pkgName = data.split(":")[1];
    bot.answerCallbackQuery(callbackQuery.id).catch(e => console.log("Callback error:", e));
    userState[chatId] = { stage: "awaitingAmount", package: pkgName };
    const pkgMsg = parsePlaceholders(botConfig.packageMessage, { package: pkgName });
    bot.sendMessage(chatId, pkgMsg, { parse_mode: "Markdown" });
  }
});

// Polling error handler
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
