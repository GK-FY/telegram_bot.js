"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ===== Configuration =====
// Bot token as provided.
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
// Admin Telegram numeric ID.
const ADMIN_ID = 5415517965;

// Editable bot texts and settings (admin can change these).
let botConfig = {
  welcomeMessage: "👋 *Welcome to the Investment Bot by FY'S PROPERTY!* \nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package*. Please enter the amount (in Ksh) you'd like to invest:",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds... \n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...* \nWe will fetch the status soon!",
  paymentSuccess: "*🎉 Payment Successful!*\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit Number:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  fromAdmin: "From Admin GK-FY",
  channelID: 529
};

// ===== In-Memory Storage =====
// userState holds conversation data for each user.
const userState = {}; // { chatId: { stage, package, amount, depositNumber, stkRef } }
// userBalances holds each user's investment balance.
const userBalances = {}; // { chatId: number }
// depositHistory holds each user's deposit history.
const depositHistory = {}; // { chatId: [ { amount, package, depositNumber, date, status, mpesaCode } ] }

// Available investment packages.
const packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ===== Create the Telegram Bot =====
const bot = new TelegramBot(token, { polling: true });

// ===== Helper Functions =====

// Replace placeholders in a template string.
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

// Send an STK push to Pay Hero.
async function sendSTKPush(amount, depositNumber) {
  const payload = {
    amount: amount,
    phone_number: depositNumber,
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

// Fetch transaction status from Pay Hero.
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

// Send an alert message to the admin.
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// Parse broadcast command for admin.
function parseBroadcastCommand(msg) {
  const start = msg.indexOf("[");
  const end = msg.indexOf("]");
  if (start === -1 || end === -1) return null;
  const ids = msg.substring(start + 1, end).split(",").map(id => id.trim());
  const broadcastText = msg.substring(end + 1).trim();
  return { ids, broadcastText };
}

// Get admin help message.
function getAdminHelp() {
  return (
    "*ADMIN COMMANDS:*\n" +
    "1) /admin - Show this help message.\n" +
    "2) edit <key> <newValue> - Edit a config value.\n" +
    "   Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID, balanceMessage, depositErrorMessage\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "4) /packages - List available packages.\n" +
    "5) /history - Show deposit history for a user.\n" +
    "6) /withdraw <amount> - Withdraw from your balance.\n" +
    "7) /interest - Show estimated interest (5% per month) on your balance.\n" +
    "8) /profile - Show your investment profile.\n" +
    "9) /faq - Frequently Asked Questions about this bot.\n"
  );
}

// ===== User Commands (Extra Features) =====

// /balance - Check investment balance.
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const reply = parsePlaceholders(botConfig.balanceMessage, { balance: String(balance) });
  bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
});

// /packages - List available packages.
bot.onText(/\/packages/, (msg) => {
  const chatId = msg.chat.id;
  let pkgText = "*Available Investment Packages:*\n";
  packages.forEach((pkg) => {
    pkgText += `• *${pkg.name}*: Minimum Ksh ${pkg.min}\n`;
  });
  bot.sendMessage(chatId, pkgText, { parse_mode: "Markdown" });
});

// /history - Show user's deposit history.
bot.onText(/\/history/, (msg) => {
  const chatId = msg.chat.id;
  const history = depositHistory[chatId] || [];
  if (history.length === 0) {
    bot.sendMessage(chatId, "*No deposit history found.*", { parse_mode: "Markdown" });
    return;
  }
  let historyText = "*Your Deposit History:*\n";
  history.forEach((record, index) => {
    historyText += `${index + 1}. Package: *${record.package}*, Amount: *Ksh ${record.amount}*, Deposit No.: *${record.depositNumber}*, Date: *${record.date}*, Status: *${record.status}*, MPESA Code: *${record.mpesaCode || "N/A"}*\n`;
  });
  bot.sendMessage(chatId, historyText, { parse_mode: "Markdown" });
});

// /withdraw <amount> - Simulate withdrawal from balance.
bot.onText(/\/withdraw (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const amount = parseInt(match[1]);
  if (isNaN(amount) || amount <= 0) {
    bot.sendMessage(chatId, "*⚠️ Please enter a valid withdrawal amount.*", { parse_mode: "Markdown" });
    return;
  }
  const balance = userBalances[chatId] || 0;
  if (amount > balance) {
    bot.sendMessage(chatId, "*⚠️ You do not have sufficient funds for this withdrawal.*", { parse_mode: "Markdown" });
    return;
  }
  userBalances[chatId] -= amount;
  bot.sendMessage(chatId, `*✅ Withdrawal Successful!*\nYou withdrew Ksh ${amount}.\nYour new balance is Ksh ${userBalances[chatId]}.`, { parse_mode: "Markdown" });
});

// /interest - Show simulated interest on current balance (e.g., 5% per month)
bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const interest = (balance * 0.05).toFixed(2);
  bot.sendMessage(chatId, `*📈 Estimated Monthly Interest:* Ksh ${interest} (at 5% per month)`, { parse_mode: "Markdown" });
});

// /profile - Show user's current profile (balance and summary)
bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const history = depositHistory[chatId] || [];
  const totalDeposits = history.length;
  bot.sendMessage(chatId,
    `*👤 Your Profile:*\n*Balance:* Ksh ${balance}\n*Total Deposits:* ${totalDeposits}`,
    { parse_mode: "Markdown" }
  );
});

// /faq - Frequently Asked Questions.
bot.onText(/\/faq/, (msg) => {
  const chatId = msg.chat.id;
  const faqText = 
`*FAQ:*
1. *How do I invest?*  
   Send /start and follow the prompts.
2. *What are the investment packages?*  
   Use /packages to see available options.
3. *How do I check my balance?*  
   Send /balance.
4. *What happens after I deposit?*  
   An STK push is sent. The bot checks status after 20 seconds.
5. *Who can I contact if there's an issue?*  
   Contact our admin via Telegram.`;
  bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});

// ===== Main Deposit Flow =====
// Handle all deposit-related messages.
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const lowerText = text.toLowerCase();

  // Only process deposit flow if message is not an admin command and not one of the extra commands.
  // (We already handled /balance, /packages, /history, etc. above.)
  if (msg.chat.type !== "private") return;
  
  // If message is one of the extra commands, the above handlers take care.
  if (lowerText.startsWith("/")) return;
  
  // If user has not started deposit flow, then prompt them to type /start.
  if (!userState[chatId]) {
    bot.sendMessage(chatId, "*Please type /start to begin your investment.*", { parse_mode: "Markdown" });
    return;
  }
  
  const state = userState[chatId];
  
  // Stage: Awaiting Amount.
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
  
  // Stage: Awaiting Deposit Number.
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
        
        // Record deposit history.
        if (!depositHistory[chatId]) depositHistory[chatId] = [];
        depositHistory[chatId].push({
          amount: state.amount,
          package: state.package,
          depositNumber: state.depositNumber,
          date: currentDateTime,
          status: finalStatus,
          mpesaCode: providerReference
        });
        
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

// ===== Handle callback queries for package selection =====
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
    const pkgMsg = parsePlaceholders(botConfig.packageMessage, { package: pkgName, amount: "{amount}" });
    bot.sendMessage(chatId, pkgMsg, { parse_mode: "Markdown" });
  }
});

// ===== Admin command: /admin =====
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
  }
});

// ===== Admin broadcast command: /broadcast =====
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

// ===== Polling error handler =====
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
