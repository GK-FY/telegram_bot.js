"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ===== Configuration =====

// Bot token as provided.
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
// Admin Telegram numeric ID.
const ADMIN_ID = 5415517965;

// Editable bot texts and settings.
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
const userState = {};    // { chatId: { stage, package, amount, depositNumber, stkRef, referralCode (optional) } }
const userBalances = {}; // { chatId: number }
const depositHistory = {}; // { chatId: [ { amount, package, depositNumber, date, status, mpesaCode } ] }
const referralRequests = {}; // { id: { referrer, referred, code, date, status: "pending"/"approved"/"declined" } }
let nextReferralID = 1; // unique referral request ID

// For each user, assign a referral code (we simply use their chat ID as code for demo).
const userReferralCodes = {}; // { chatId: referralCode }
const userReferralBonuses = {}; // { chatId: number } bonus balance

// Available investment packages.
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ===== Create Telegram Bot =====
const bot = new TelegramBot(token, { polling: true });

// ===== Helper Functions =====

// Replace placeholders in template strings.
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

// Send STK push to Pay Hero.
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

// Send alert message to admin.
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
    "2) edit <key> <newValue> - Edit a config value. Valid keys:\n" +
    "   welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter,\n" +
    "   fromAdmin, channelID, balanceMessage, depositErrorMessage, referralBonus, withdrawMin, withdrawMax\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "4) addpackage <name> <min> - Add a new investment package.\n" +
    "5) editpackage <name> <newMin> - Edit the minimum for an existing package.\n" +
    "6) /referrals - List pending referral requests.\n" +
    "7) approve <referralID> - Approve a referral request.\n" +
    "8) decline <referralID> - Decline a referral request.\n" +
    "9) /withdrawlimits - Show current withdrawal limits.\n" +
    "10) /balance - Show your balance (for testing as admin).\n" +
    "11) Other user commands: /balance, /packages, /history, /withdraw, /myreferral, /referral, /interest, /profile, /faq, /help"
  );
}

// ===== User Flow: Deposit =====

// When user sends /start, begin deposit flow.
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  
  // Initialize user state and generate referral code if not exists.
  if (!userReferralCodes[chatId]) {
    userReferralCodes[chatId] = "REF" + chatId; // simple referral code
    userReferralBonuses[chatId] = 0;
  }
  
  userState[chatId] = { stage: "packageSelection" };
  const keyboard = packages.map(pkg => ([{
    text: `${pkg.name} Package (Min Ksh ${pkg.min})`,
    callback_data: `pkg:${pkg.name}`
  }]));
  bot.sendMessage(chatId, botConfig.welcomeMessage, {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: "Markdown"
  });
});

// Handle callback queries for package selection.
bot.on("callback_query", async (callbackQuery) => {
  if (!callbackQuery || !callbackQuery.data) return;
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  if (data.startsWith("pkg:")) {
    const pkgName = data.split(":")[1];
    userState[chatId] = { stage: "awaitingReferral", package: pkgName };
    try {
      await bot.answerCallbackQuery(callbackQuery.id);
    } catch (e) {
      console.log("Callback error:", e);
    }
    bot.sendMessage(chatId, "If you have a referral code, please enter it now, or type `none`.", { parse_mode: "Markdown" });
  }
});

// Handle messages for deposit flow.
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const lowerText = text.toLowerCase();

  if (msg.chat.type !== "private") return;
  if (text.startsWith("/")) return; // commands already handled

  // If not in deposit flow, prompt.
  if (!userState[chatId]) {
    bot.sendMessage(chatId, "*Please type /start to begin your investment.*", { parse_mode: "Markdown" });
    return;
  }
  
  const state = userState[chatId];
  
  // Stage: Awaiting Referral Code.
  if (state.stage === "awaitingReferral") {
    if (lowerText === "none") {
      state.referralCode = null;
    } else {
      state.referralCode = text;
      // Record referral request if referral code exists and is not own.
      if (text !== userReferralCodes[chatId]) {
        referralRequests[nextReferralID] = {
          referrer: text, // the referral code provided (assumed to be from another user)
          referred: chatId,
          code: text,
          date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
          status: "pending"
        };
        nextReferralID++;
      }
    }
    state.stage = "awaitingAmount";
    bot.sendMessage(chatId, "Please enter the deposit amount (in Ksh).", { parse_mode: "Markdown" });
    return;
  }
  
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
        // If a referral code was provided and it's not the user's own, award bonus to referrer.
        if (state.referralCode && state.referralCode !== "none") {
          // For demo, assume referral code is the referrer's chat ID.
          const referrerId = parseInt(state.referralCode.replace("REF", ""));
          if (referrerId && referrerId !== chatId) {
            // Create a pending referral request.
            referralRequests[nextReferralID] = {
              referrer: referrerId,
              referred: chatId,
              code: state.referralCode,
              date: currentDateTime,
              status: "pending"
            };
            nextReferralID++;
            bot.sendMessage(chatId, "*Thank you for using a referral code!* Your referrer will be credited upon approval.", { parse_mode: "Markdown" });
          }
        }
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

// ===== Withdrawal Flow =====
bot.onText(/\/withdraw/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  bot.sendMessage(chatId, `*Please enter the withdrawal amount (min Ksh ${botConfig.withdrawMin}, max Ksh ${botConfig.withdrawMax}):*`, { parse_mode: "Markdown" });
  userState[chatId] = { stage: "awaitingWithdrawAmount" };
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  
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
    // Process withdrawal: check balance.
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

// ===== Additional User Commands =====

// /packages - List available investment packages.
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

// /interest - Show estimated interest (5% per month) on balance.
bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const interest = (balance * 0.05).toFixed(2);
  bot.sendMessage(chatId, `*📈 Estimated Monthly Interest:* Ksh ${interest} (at 5% per month)`, { parse_mode: "Markdown" });
});

// /profile - Show user profile.
bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const history = depositHistory[chatId] || [];
  const totalDeposits = history.length;
  bot.sendMessage(chatId,
    `*👤 Your Profile:*\n*Balance:* Ksh ${balance}\n*Total Deposits:* ${totalDeposits}\n*Referral Code:* ${userReferralCodes[chatId] || "N/A"}\n*Referral Bonus:* Ksh ${userReferralBonuses[chatId] || 0}`,
    { parse_mode: "Markdown" }
  );
});

// /myreferral - Show user's referral code and bonus.
bot.onText(/\/myreferral/, (msg) => {
  const chatId = msg.chat.id;
  const refCode = userReferralCodes[chatId] || ("REF" + chatId);
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  bot.sendMessage(chatId, `*🔖 Your Referral Code:* ${refCode}\n*💰 Bonus:* Ksh ${bonus}\nShare your code with friends to earn Ksh ${botConfig.referralBonus} per approved referral.`, { parse_mode: "Markdown" });
});

// /faq - Frequently asked questions.
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
   Share your referral code using /myreferral. You earn Ksh ${botConfig.referralBonus} per approved referral.
6. *How do I withdraw funds?*  
   Use /withdraw and follow the prompts.`;
  bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});

// /help - Show help for users.
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = 
`*USER COMMANDS:*
/start - Begin a new deposit/investment.
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

// Admin: Approve referral command.
bot.onText(/approve (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const refId = match[1];
  const req = referralRequests[refId];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*⚠️ Referral request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  // Credit referrer bonus.
  const referrerId = req.referrer;
  if (!userReferralBonuses[referrerId]) userReferralBonuses[referrerId] = 0;
  userReferralBonuses[referrerId] += botConfig.referralBonus;
  bot.sendMessage(msg.chat.id, `*Referral ${refId} approved.* Bonus credited to ${referrerId}.`, { parse_mode: "Markdown" });
});

// Admin: Decline referral command.
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

// Admin: /withdrawlimits to show current withdrawal limits.
bot.onText(/\/withdrawlimits/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `*Withdrawal Limits:*\nMinimum: Ksh ${botConfig.withdrawMin}\nMaximum: Ksh ${botConfig.withdrawMax}`, { parse_mode: "Markdown" });
});

// ===== Polling error handler =====
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
