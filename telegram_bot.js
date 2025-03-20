"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ===== Configuration =====
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
const ADMIN_ID = 5415517965;

let botConfig = {
  welcomeMessage: "👋 *Welcome to the Investment Bot by FY'S PROPERTY!* \nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package*. Please enter the amount (in Ksh) you'd like to invest:",
  referralPrompt: "If you have a referral code, please enter it now, or type `none`.",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds... \n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...* \nWe will fetch the status soon!",
  paymentSuccess: "*🎉 Payment Successful!*\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit Number:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  fromAdmin: "From Admin GK-FY",
  channelID: 529,
  referralBonus: 200,
  withdrawMin: 1,
  withdrawMax: 75000
};

// ===== In-Memory Data =====
const userState = {};    // { chatId: { stage, package, amount, depositNumber, stkRef, referralCode } }
const userBalances = {}; // { chatId: number }
const depositHistory = {}; // { chatId: [ { amount, package, depositNumber, date, status, mpesaCode } ] }
const referralRequests = {}; // { id: { referrer, referred, code, date, status } }
let nextReferralID = 1;
const userReferralCodes = {}; // { chatId: referralCode }
const userReferralBonuses = {}; // { chatId: number }

let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ===== Create Telegram Bot =====
const bot = new TelegramBot(token, { polling: true });

// ===== Helper Functions =====

// Format phone number: converts "0712345678" to "254712345678"
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.slice(1);
  }
  return cleaned;
}

// Replace placeholders.
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

// Send STK push to Pay Hero (with formatted phone number)
async function sendSTKPush(amount, depositNumber) {
  const formattedNumber = formatPhoneNumber(depositNumber);
  const payload = {
    amount: amount,
    phone_number: formattedNumber,
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

// Fetch transaction status.
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

// Send admin alert.
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// Parse broadcast command.
function parseBroadcastCommand(msg) {
  const start = msg.indexOf("[");
  const end = msg.indexOf("]");
  if (start === -1 || end === -1) return null;
  const ids = msg.substring(start + 1, end).split(",").map(id => id.trim());
  const broadcastText = msg.substring(end + 1).trim();
  return { ids, broadcastText };
}

// Admin help text.
function getAdminHelp() {
  return (
    "*ADMIN COMMANDS:*\n" +
    "1) /admin - Show this help message.\n" +
    "2) edit <key> <newValue> - Edit a config value.\n" +
    "   Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID, balanceMessage, depositErrorMessage, referralBonus, withdrawMin, withdrawMax\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "4) addpackage <name> <min> - Add a new investment package.\n" +
    "5) editpackage <name> <newMin> - Edit an existing package's minimum.\n" +
    "6) /referrals - List pending referral requests.\n" +
    "7) approve <referralID> - Approve a referral request.\n" +
    "8) decline <referralID> - Decline a referral request.\n" +
    "9) /withdrawlimits - Show current withdrawal limits.\n" +
    "10) /balance - Show your balance.\n" +
    "11) Other user commands: /balance, /packages, /history, /withdraw, /myreferral, /interest, /profile, /faq, /help"
  );
}

// ===== Extra User Commands =====

bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const reply = parsePlaceholders(botConfig.balanceMessage, { balance: String(balance) });
  bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });
});

bot.onText(/\/packages/, (msg) => {
  const chatId = msg.chat.id;
  let pkgText = "*Available Investment Packages:*\n";
  packages.forEach((pkg) => {
    pkgText += `• *${pkg.name}*: Minimum Ksh ${pkg.min}\n`;
  });
  bot.sendMessage(chatId, pkgText, { parse_mode: "Markdown" });
});

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

// /withdraw - initiate withdrawal flow.
bot.onText(/\/withdraw/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `*Please enter the withdrawal amount (min Ksh ${botConfig.withdrawMin}, max Ksh ${botConfig.withdrawMax}):*`, { parse_mode: "Markdown" });
  userState[chatId] = { stage: "awaitingWithdrawAmount" };
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  
  // Process withdrawal flow if in that stage.
  const state = userState[chatId];
  if (state && state.stage === "awaitingWithdrawAmount") {
    const amount = parseInt(text);
    if (isNaN(amount) || amount < botConfig.withdrawMin || amount > botConfig.withdrawMax) {
      bot.sendMessage(chatId, `*⚠️ Please enter a valid withdrawal amount between Ksh ${botConfig.withdrawMin} and Ksh ${botConfig.withdrawMax}.*`, { parse_mode: "Markdown" });
      return;
    }
    state.withdrawAmount = amount;
    state.stage = "awaitingWithdrawNumber";
    bot.sendMessage(chatId, "*Please enter the M-PESA number to send your withdrawal (must start with 07 or 01, 10 digits):*", { parse_mode: "Markdown" });
    return;
  }
  
  if (state && state.stage === "awaitingWithdrawNumber") {
    const num = text.trim();
    if (!/^(07|01)\d{8}$/.test(num)) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid M-PESA number (starting with 07 or 01 and 10 digits total).*", { parse_mode: "Markdown" });
      return;
    }
    state.withdrawNumber = num;
    const balance = userBalances[chatId] || 0;
    if (state.withdrawAmount > balance) {
      bot.sendMessage(chatId, "*⚠️ You do not have sufficient funds for this withdrawal.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    userBalances[chatId] -= state.withdrawAmount;
    bot.sendMessage(chatId, `*✅ Withdrawal Successful!*\nYou withdrew Ksh ${state.withdrawAmount}.\nYour new balance is Ksh ${userBalances[chatId]}.`, { parse_mode: "Markdown" });
    delete userState[chatId];
    return;
  }
});

// /interest - show estimated interest.
bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const interest = (balance * 0.05).toFixed(2);
  bot.sendMessage(chatId, `*📈 Estimated Monthly Interest:* Ksh ${interest} (at 5% per month)`, { parse_mode: "Markdown" });
});

// /profile - show user profile.
bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const history = depositHistory[chatId] || [];
  const totalDeposits = history.length;
  const refCode = userReferralCodes[chatId] || ("REF" + chatId);
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  bot.sendMessage(chatId,
    `*👤 Your Profile:*\n*Balance:* Ksh ${balance}\n*Total Deposits:* ${totalDeposits}\n*Referral Code:* ${refCode}\n*Referral Bonus:* Ksh ${bonus}`,
    { parse_mode: "Markdown" }
  );
});

// /myreferral - show referral code.
bot.onText(/\/myreferral/, (msg) => {
  const chatId = msg.chat.id;
  const refCode = userReferralCodes[chatId] || ("REF" + chatId);
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  bot.sendMessage(chatId, `*🔖 Your Referral Code:* ${refCode}\n*💰 Bonus:* Ksh ${bonus}\nShare your code with friends to earn Ksh ${botConfig.referralBonus} per approved referral.`, { parse_mode: "Markdown" });
});

// /faq - show FAQ.
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
5. *How do referrals work?*  
   Share your referral code via /myreferral. You earn Ksh ${botConfig.referralBonus} per approved referral.
6. *How do I withdraw funds?*  
   Use /withdraw and follow the prompts.
7. *What is the estimated interest?*  
   Use /interest to see your estimated monthly interest.`;
  bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});

// /help - show help for users.
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = 
`*USER COMMANDS:*
/start - Begin a new investment deposit.
/packages - List available investment packages.
/balance - Check your current balance.
/history - View your deposit history.
/withdraw - Withdraw funds (min ${botConfig.withdrawMin}, max ${botConfig.withdrawMax}).
/myreferral - View your referral code and bonus.
/interest - View estimated monthly interest on your balance.
/profile - View your profile summary.
/faq - Frequently asked questions.
/help - Show this help message.`;
  bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
});

// ===== Admin Referral Review Commands =====

// /referrals - List pending referral requests.
bot.onText(/\/referrals/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(referralRequests);
  if (keys.length === 0) {
    bot.sendMessage(msg.chat.id, "*No pending referral requests.*", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Pending Referral Requests:*\n";
  keys.forEach((id) => {
    const req = referralRequests[id];
    text += `ID: *${id}* | Referrer: *${req.referrer}* | Referred: *${req.referred}* | Date: *${req.date}* | Status: *${req.status}*\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// Admin: Approve referral.
bot.onText(/approve (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const refId = match[1];
  const req = referralRequests[refId];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*⚠️ Referral request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  // Credit referrer's bonus.
  const referrerId = req.referrer;
  if (!userReferralBonuses[referrerId]) userReferralBonuses[referrerId] = 0;
  userReferralBonuses[referrerId] += botConfig.referralBonus;
  bot.sendMessage(msg.chat.id, `*Referral ${refId} approved.* Bonus credited to ${referrerId}.`, { parse_mode: "Markdown" });
});

// Admin: Decline referral.
bot.onText(/decline (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const refId = match[1];
  const req = referralRequests[refId];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*⚠️ Referral request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "declined";
  bot.sendMessage(msg.chat.id, `*Referral ${refId} declined.*`, { parse_mode: "Markdown" });
});

// Admin: /withdrawlimits - show current withdrawal limits.
bot.onText(/\/withdrawlimits/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `*Withdrawal Limits:*\nMinimum: Ksh ${botConfig.withdrawMin}\nMaximum: Ksh ${botConfig.withdrawMax}`, { parse_mode: "Markdown" });
});

// ===== Polling error handler =====
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
