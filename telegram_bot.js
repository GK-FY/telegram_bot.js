/**
 * telegram_bot.js
 *
 * Developer: FY'S PROPERTY 🕊️
 *
 * This Telegram Investment Bot allows users to invest via 3 packages
 * (Silver, Gold, Platinum). When a user deposits, an STK push is sent
 * to Pay Hero and the bot polls for transaction status after 20 seconds.
 * If successful, the deposit amount is added to their balance.
 *
 * Admin Commands (only from admin ID):
 *  - /admin : Show admin help.
 *  - edit <key> <newText> : Edit bot texts and channelID.
 *    Valid keys: welcomeMessage, packageMessage, paymentInitiated,
 *                countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID.
 *  - /broadcast [chatId1,chatId2,...] Your message
 *
 * Placeholders available: {amount}, {package}, {depositNumber}, {seconds}, {mpesaCode}, {date}, {footer}.
 *
 * The Pay Hero API is used for STK push and status checking.
 */

// Require necessary modules
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Bot token as provided:
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";

// Create a bot instance using polling
const bot = new TelegramBot(token, { polling: true });

// Global admin ID (set this to your admin numeric Telegram ID)
const ADMIN_ID = process.env.ADMIN_ID || 123456789; // Change this to your admin's numeric ID

// Bot configuration (editable by admin)
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

// In-memory state: userState holds conversation details, userBalances holds investment balances.
const userState = {};   // keyed by chat id: { stage, package, amount, depositNumber, stkRef }
const userBalances = {}; // keyed by chat id: number

// Available investment packages
const packages = [
  { name: "Silver", min: 1000 },
  { name: "Gold", min: 5000 },
  { name: "Platinum", min: 10000 }
];

// Helper: replace placeholders in a template string.
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

// Helper: send STK push to Pay Hero.
async function sendSTKPush(amount, depositNumber) {
  const payload = {
    amount: amount,
    phone_number: depositNumber, // Here depositNumber is used as phone (for demo purposes)
    channel_id: botConfig.channelID,
    provider: "m-pesa",
    external_reference: "INV-009",
    customer_name: "John Doe",
    callback_url: "https://your-callback-url", // Replace with your callback URL if needed.
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

// Helper: fetch transaction status.
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

// Helper: send admin alert.
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// Helper: Parse broadcast command (e.g., "/broadcast [chatId1,chatId2] message")
function parseBroadcastCommand(msg) {
  const start = msg.indexOf('[');
  const end = msg.indexOf(']');
  if (start === -1 || end === -1) return null;
  const ids = msg.substring(start + 1, end).split(',').map(id => id.trim());
  const broadcastText = msg.substring(end + 1).trim();
  return { ids, broadcastText };
}

// Admin help message.
function getAdminHelp() {
  return (
    "*ADMIN COMMANDS:*\n" +
    "1) /admin - Show this help message.\n" +
    "2) edit <key> <newValue> - Edit a config value.\n" +
    "   Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID\n" +
    "   Example: edit welcomeMessage 👋 Hello from GK-FY! How much to invest?\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "   Example: /broadcast [123456789,987654321] Hello everyone, this is a test!"
  );
}

// --- Handle incoming messages ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Do not process messages in groups.
  if (msg.chat.type !== 'private') return;
  
  // --- Admin Commands ---
  if (msg.from.id === ADMIN_ID) {
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
      } else {
        botConfig[key] = newValue;
      }
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
  
  // --- Deposit (Investment) Flow ---
  // If user types /start, begin deposit flow.
  if (text.toLowerCase() === "/start") {
    userState[chatId] = { stage: "packageSelection" };
    
    // Create inline keyboard for packages.
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
  
  // If userState doesn't exist, initialize it.
  if (!userState[chatId]) {
    userState[chatId] = { stage: "packageSelection" };
    bot.sendMessage(chatId, botConfig.welcomeMessage, { parse_mode: "Markdown" });
    return;
  }
  
  const state = userState[chatId];
  
  // --- Package selection is handled by callback_query ---
  if (state.stage === "awaitingAmount") {
    const amount = parseInt(text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid deposit amount in Ksh.*", { parse_mode: "Markdown" });
      return;
    }
    // Check if amount meets minimum for selected package.
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
    
    // Immediately initiate STK push.
    const stkRef = await sendSTKPush(state.amount, state.depositNumber);
    if (!stkRef) {
      bot.sendMessage(chatId, "*❌ Error:* Unable to initiate payment. Please try again later.", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    state.stkRef = stkRef;
    
    // Alert admin about deposit attempt.
    const attemptTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    sendAdminAlert(
      `*💸 Deposit Attempt:*\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nTime (KE): ${attemptTime}`
    );
    
    // Send payment initiated message.
    const initText = parsePlaceholders(botConfig.paymentInitiated, { seconds: '20' });
    bot.sendMessage(chatId, initText, { parse_mode: "Markdown" });
    
    // After 10 seconds, send a countdown update.
    setTimeout(() => {
      const midText = parsePlaceholders(botConfig.countdownUpdate, { seconds: '10' });
      bot.sendMessage(chatId, midText, { parse_mode: "Markdown" });
    }, 10000);
    
    // After 20 seconds, poll transaction status.
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
        // Update user balance.
        if (!userBalances[chatId]) userBalances[chatId] = 0;
        userBalances[chatId] += state.amount;
        
        const successMsg = parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(state.amount),
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
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  
  if (data.startsWith("pkg:")) {
    const pkgName = data.split(":")[1];
    userState[chatId] = { stage: "awaitingAmount", package: pkgName };
    bot.answerCallbackQuery(callbackQuery.id);
    const pkgMsg = parsePlaceholders(botConfig.packageMessage, { amount: "{amount}", package: pkgName });
    bot.sendMessage(chatId, pkgMsg, { parse_mode: "Markdown" });
  }
});

// Admin command: /admin to show help.
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
  }
});

// For broadcast messages from admin: /broadcast [id1,id2,...] message
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

// Start the bot.
bot.on('polling_error', error => {
  console.error("Polling error:", error);
});
console.log("Telegram Investment Bot starting...");

// EXPRESS SERVER: Display QR code for authentication.
const app = express();
const port = process.env.PORT || 3000;
app.get('/', async (req, res) => {
  let qrImage = '';
  if (currentQR) {
    try {
      qrImage = await QRCode.toDataURL(currentQR);
    } catch (err) {
      console.error("QR code generation error:", err);
    }
  }
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>FY'S PROPERTY - Telegram Bot QR</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="icon" href="https://iili.io/3oPqsb1.webp">
      <style>
        body {
          font-family: Arial, sans-serif;
          text-align: center;
          background: #222;
          color: #fff;
          padding: 20px;
        }
        h1 {
          color: #12c99b;
          margin-bottom: 20px;
        }
        .qr-container {
          background: #333;
          display: inline-block;
          padding: 20px;
          border-radius: 10px;
        }
        img {
          max-width: 250px;
          margin: 10px;
        }
      </style>
    </head>
    <body>
      <h1>Scan This QR Code to Authenticate Your Bot</h1>
      <div class="qr-container">
        ${
          qrImage
            ? `<img src="${qrImage}" alt="Telegram Bot QR Code" />`
            : '<p>No QR code available yet. Please wait...</p>'
        }
      </div>
    </body>
    </html>
  `);
});
app.listen(port, () => {
  console.log(`Express server running on port ${port}`);
});
