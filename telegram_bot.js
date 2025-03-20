/**
 * telegram_bot.js
 *
 * Developer: FY'S PROPERTY 🕊️
 *
 * Telegram Investment Bot
 * 
 * Features:
 *  - Three investment packages (Package 1: Min Ksh 1, Package 2: Min Ksh 2, Package 3: Min Ksh 3)
 *  - Deposit flow: choose package, enter amount, then deposit number.
 *  - Immediately sends an STK push to Pay Hero.
 *  - Sends two countdown updates (at 10 and 20 seconds) then fetches transaction status.
 *  - On success, automatically adds deposit to user's balance and sends a detailed confirmation.
 *  - Users can check their balance with /balance.
 *  - Admin commands (from admin ID 5415517965) to edit bot texts, change channelID, and broadcast messages.
 *  - Configurable texts support placeholders:
 *       {amount}, {package}, {depositNumber}, {seconds}, {mpesaCode}, {date}, {footer}
 */

"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// === Bot Token & Admin ID ===
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
const ADMIN_ID = 5415517965;  // Admin's Telegram numeric ID

// === Editable Bot Configuration ===
// Admin can change these via commands (edit command).
let botConfig = {
  welcomeMessage: "👋 *Welcome to the Investment Bot by FY'S PROPERTY!* \nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package*. Please enter the amount (in Ksh) you'd like to invest:",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds... \n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...* \nWe will fetch the status soon!",
  paymentSuccess: "*🎉 Payment Successful!*\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit Number:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  fromAdmin: "From Admin GK-FY",
  channelID: 529,
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again."
};

// === In-Memory State ===
const userState = {};    // chatId => { stage, package, amount, depositNumber, stkRef }
const userBalances = {}; // chatId => number

// === Investment Packages ===
const packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// === Create the Telegram Bot ===
const bot = new TelegramBot(token, { polling: true });

// === Helper: Replace placeholders in a template string ===
function parsePlaceholders(template, data) {
  return template
    .replace(/{amount}/g, data.amount || "")
    .replace(/{package}/g, data.package || "")
    .replace(/{depositNumber}/g, data.depositNumber || "")
    .replace(/{seconds}/g, data.seconds || "")
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{footer}/g, botConfig.paymentFooter || "")
    .replace(/{balance}/g, data.balance || "");
}

// === Helper: Send STK push via Pay Hero API ===
async function sendSTKPush(amount, depositNumber) {
  const payload = {
    amount: amount,
    phone_number: depositNumber, // For demo, depositNumber is used as phone
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

// === Helper: Fetch transaction status from Pay Hero ===
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

// === Helper: Send alert message to admin ===
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// === Helper: Parse broadcast command ===
function parseBroadcastCommand(msg) {
  const start = msg.indexOf("[");
  const end = msg.indexOf("]");
  if (start === -1 || end === -1) return null;
  const ids = msg.substring(start + 1, end).split(",").map(id => id.trim());
  const broadcastText = msg.substring(end + 1).trim();
  return { ids, broadcastText };
}

// === Admin help text ===
function getAdminHelp() {
  return (
    "*ADMIN COMMANDS:*\n" +
    "1) /admin - Show this help message.\n" +
    "2) edit <key> <newValue> - Edit a config value.\n" +
    "   Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID, balanceMessage, depositErrorMessage\n" +
    "   Example: edit welcomeMessage 👋 Hello from GK-FY! How much would you like to invest?\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "   Example: /broadcast [123456789,987654321] Hello from Admin GK-FY!\n" +
    "4) /balance - Check your current investment balance."
  );
}

// === User Commands ===

// When user sends /balance, show their balance.
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  const balance = userBalances[chatId] || 0;
  const reply = parsePlaceholders(botConfig.balanceMessage, { balance: String(balance) });
  bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
});

// === Main Message Handler ===
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const lowerText = text.toLowerCase();

  // Ignore non-private chats.
  if (msg.chat.type !== "private") return;

  // --- Admin Commands ---
  if (msg.from.id === +ADMIN_ID) {
    if (lowerText === "/admin") {
      bot.sendMessage(chatId, getAdminHelp(), { parse_mode: "Markdown" });
      return;
    }
    if (text.startsWith("edit ")) {
      const parts = text.split(" ");
      if (parts.length < 3) {
        bot.sendMessage(chatId, "*⚠️ Invalid format.* Use: edit <key> <newValue>", { parse_mode: "Markdown" });
        return;
      }
      const key = parts[1];
      const newValue = text.substring(("edit " + key + " ").length).trim();
      if (!botConfig.hasOwnProperty(key)) {
        bot.sendMessage(chatId, "*⚠️ Unknown key.* Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID, balanceMessage, depositErrorMessage", { parse_mode: "Markdown" });
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
    if (text.startsWith("/broadcast ")) {
      const commandText = text.substring(11).trim();
      const broadcast = parseBroadcastCommand(commandText);
      if (!broadcast) {
        bot.sendMessage(chatId, "*⚠️ Invalid format.* Use: /broadcast [chatId1,chatId2,...] Your message", { parse_mode: "Markdown" });
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
  } // End admin commands

  // --- Deposit Flow ---
  if (lowerText === "/start") {
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

  if (state.stage === "awaitingDepositNumber") {
    state.depositNumber = text;
    state.stage = "processing";

    const stkRef = await sendSTKPush(state.amount, state.depositNumber);
    if (!stkRef) {
      bot.sendMessage(chatId, `*❌ Error:* ${botConfig.depositErrorMessage}`, { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    state.stkRef = stkRef;

    const attemptTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    sendAdminAlert(
      `*💸 Deposit Attempt:*\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nTime (KE): ${attemptTime}`
    );

    const initText = parsePlaceholders(botConfig.paymentInitiated, { seconds: "20" });
    bot.sendMessage(chatId, initText, { parse_mode: "Markdown" });

    setTimeout(() => {
      const midText = parsePlaceholders(botConfig.countdownUpdate, { seconds: "10" });
      bot.sendMessage(chatId, midText, { parse_mode: "Markdown" });
    }, 10000);

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
          `*✅ Deposit Successful:*\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nMPESA Code: ${providerReference}\nTime (KE): ${currentDateTime}`
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
          `*❌ Deposit Failed:*\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nError: ${errMsg}\nTime (KE): ${currentDateTime}`
        );
      } else {
        bot.sendMessage(chatId, `*⏳ Payment Pending.* Current status: ${finalStatus}\nPlease wait a bit longer or contact support.\nType /start to restart.`, { parse_mode: "Markdown" });
      }
      delete userState[chatId];
    }, 20000);

    return;
  }
});

// === Handle callback queries for package selection ===
bot.on("callback_query", async (callbackQuery) => {
  if (!callbackQuery || !callbackQuery.data) return;
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;

  if (data.startsWith("pkg:")) {
    const pkgName = data.split(":")[1];
    userState[chatId] = { stage: "awaitingAmount", package: pkgName };
    try {
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (e) {
      console.log("Callback error:", e);
    }
    const pkgMsg = parsePlaceholders(botConfig.packageMessage, { package: pkgName });
    bot.sendMessage(chatId, pkgMsg, { parse_mode: "Markdown" });
  }
});

// === Admin command: /admin ===
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
  }
});

// === Admin broadcast command: /broadcast [id1,id2,...] message ===
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const input = match[1];
  const broadcast = parseBroadcastCommand(input);
  if (!broadcast) {
    bot.sendMessage(msg.chat.id, "*⚠️ Invalid format.* Use: /broadcast [chatId1,chatId2,...] Your message", { parse_mode: "Markdown" });
    return;
  }
  const { ids, broadcastText } = broadcast;
  for (let id of ids) {
    try {
      await bot.sendMessage(id, `*${botConfig.fromAdmin}:*\n${broadcastText}`, { parse_mode: "Markdown" });
    } catch (err) {
      console.error("Broadcast error:", err);
      bot.sendMessage(msg.chat.id, `*⚠️ Could not send message to:* ${id}`, { parse_mode: "Markdown" });
    }
  }
  bot.sendMessage(msg.chat.id, "*Message sent successfully to the specified users!*", { parse_mode: "Markdown" });
});

// === User command: /balance - check investment balance ===
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const reply = parsePlaceholders(botConfig.balanceMessage, { balance: String(balance) });
  bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
});

// === Polling error handler ===
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
