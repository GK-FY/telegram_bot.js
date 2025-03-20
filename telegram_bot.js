/**
 * telegram_bot.js
 *
 * Developer: FY'S PROPERTY 🕊️
 *
 * Telegram Investment Bot with 3 packages (Silver, Gold, Platinum),
 * STK push integration via Pay Hero, and admin commands to edit messages,
 * broadcast messages, and change channelID. Group chats are ignored.
 *
 * Features defensive checks to avoid "undefined" property errors in callback queries.
 */

// Required modules
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// 1) Bot token
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";

// 2) Admin ID (replace with your numeric Telegram user ID)
const ADMIN_ID = process.env.ADMIN_ID || 123456789;

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

// 4) In-memory user states and balances
const userState = {};   // chatId => { stage, package, amount, depositNumber, stkRef }
const userBalances = {}; // chatId => number

// 5) Packages
const packages = [
  { name: "Silver", min: 1000 },
  { name: "Gold", min: 5000 },
  { name: "Platinum", min: 10000 }
];

// 6) Create bot with polling
const bot = new TelegramBot(token, { polling: true });

// Keep track of the current QR code text for the Express server (optional).
let currentQR = ""; // Not strictly needed for Telegram, but we keep for consistency.

// HELPER: Replace placeholders
function parsePlaceholders(template, data) {
  return template
    .replace(/{amount}/g, data.amount || '')
    .replace(/{package}/g, data.package || '')
    .replace(/{depositNumber}/g, data.depositNumber || '')
    .replace(/{seconds}/g, data.seconds || '')
    .replace(/{mpesaCode}/g, data.mpesaCode || '')
    .replace(/{date}/g, data.date || '')
    .replace(/{footer}/g, botConfig.paymentFooter || '');
}

// HELPER: STK push via Pay Hero
async function sendSTKPush(amount, depositNumber) {
  const payload = {
    amount: amount,
    phone_number: depositNumber, // depositNumber used as phone
    channel_id: botConfig.channelID,
    provider: "m-pesa",
    external_reference: "INV-009",
    customer_name: "John Doe",
    callback_url: "https://img-2-url.html-5.me/cl.php", // from your code
    account_reference: "FY'S PROPERTY",
    transaction_desc: "FY'S PROPERTY Payment",
    remarks: "FY'S PROPERTY",
    business_name: "FY'S PROPERTY",
    companyName: "FY'S PROPERTY"
  };
  try {
    const response = await axios.post('https://backend.payhero.co.ke/api/v2/payments', payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
      }
    });
    return response.data.reference;
  } catch (error) {
    console.error("STK Push Error:", error);
    return null;
  }
}

// HELPER: fetch transaction status
async function fetchTransactionStatus(ref) {
  try {
    const response = await axios.get(`https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`, {
      headers: {
        'Authorization': 'Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=='
      }
    });
    return response.data;
  } catch (error) {
    console.error("Status Fetch Error:", error);
    return null;
  }
}

// HELPER: send alert to admin
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// HELPER: parse broadcast command
function parseBroadcastCommand(msg) {
  const start = msg.indexOf('[');
  const end = msg.indexOf(']');
  if (start === -1 || end === -1) return null;
  const ids = msg.substring(start + 1, end).split(',').map(id => id.trim());
  const broadcastText = msg.substring(end + 1).trim();
  return { ids, broadcastText };
}

// HELPER: admin help text
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
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  
  // ignore group chats
  if (msg.chat.type !== 'private') return;
  
  // If admin
  if (msg.from.id === +ADMIN_ID) {
    if (text.toLowerCase() === "admin") {
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
  }
  
  // deposit flow
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
  
  if (state.stage === "awaitingAmount") {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid deposit amount in Ksh.*", { parse_mode: "Markdown" });
      return;
    }
    // check min deposit
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
    
    const initText = parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' });
    bot.sendMessage(chatId, initText, { parse_mode: "Markdown" });
    
    setTimeout(() => {
      const midText = parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' });
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
          `*✅ Deposit Successful:*\n` +
          `Amount: Ksh ${state.amount}\n` +
          `Deposit Number: ${state.depositNumber}\n` +
          `Package: ${state.package} Package\n` +
          `MPESA Code: ${providerReference}\n` +
          `Time (KE): ${currentDateTime}`
        );
      } else if (finalStatus === "FAILED") {
        let errMsg = "Your payment could not be completed. Please try again.";
        if (resultDesc.toLowerCase().includes('insufficient')) {
          errMsg = "Insufficient funds in your account.";
        } else if (resultDesc.toLowerCase().includes('wrong pin') || resultDesc.toLowerCase().includes('incorrect pin')) {
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

// Handle callback queries for package selection
bot.on('callback_query', async (callbackQuery) => {
  if (!callbackQuery || !callbackQuery.data) {
    // Defensive check in case callbackQuery is missing
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
    const pkgMsg = parsePlaceholders(botConfig.packageMessage, { amount: "{amount}", package: pkgName });
    bot.sendMessage(chatId, pkgMsg, { parse_mode: "Markdown" });
  }
});

// Listen for polling errors to avoid crashing
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");

// EXPRESS server to show the "QR code" for the Telegram Bot. (Optional for demonstration)
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  // Telegram doesn't typically do a QR code approach like WhatsApp, but we can
  // just show a placeholder or instructions. Or we can generate a link to "https://t.me/<bot_username>"
  // For demonstration, we just show instructions:
  res.send(`
    <html>
      <head>
        <title>FY'S PROPERTY - Telegram Bot</title>
        <style>
          body { background: #222; color: #fff; font-family: Arial; text-align: center; padding: 20px; }
          h1 { color: #12c99b; }
        </style>
      </head>
      <body>
        <h1>FY'S PROPERTY Telegram Bot</h1>
        <p>This bot uses token: <b>${token}</b></p>
        <p>Just open Telegram and search for your bot username to start chatting.</p>
      </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});
