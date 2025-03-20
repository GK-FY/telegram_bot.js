"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// =====================
// CONFIGURATION
// =====================
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
const ADMIN_ID = 5415517965;

// Editable bot texts and settings (admin-editable)
let botConfig = {
  // Registration texts
  registrationWelcome: "👋 *Welcome to FY'S PROPERTY Investment Bot!* \nBefore you begin, please register.\nEnter your *first name*:",
  askLastName: "Great! Now, please enter your *last name*:",
  askPhone: "Please enter your *phone number* (must start with 07 or 01 and be 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}*! Your registration is complete. Your referral code is *{referralCode}*.\nType /start to begin investing.",
  
  // Deposit flow texts
  welcomeMessage: "👋 *Welcome back, {firstName}!*\nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package* (min Ksh {min}).\nEnter the deposit amount (in Ksh):",
  referralPrompt: "If you have a referral code, please enter it now, or type `none`:",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds... \n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  paymentSuccess: "*🎉 Investment Successful!*\n*INV Code:* {invCode}\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit No:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  
  // Withdrawal texts
  withdrawPrompt: "💸 *Withdrawal Requested!* Please enter the amount to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, enter the M-PESA number to send the funds (must start with 07 or 01, 10 digits):",
  withdrawSuccess: "*✅ Withdrawal Successful!*\nYou withdrew Ksh {amount}.\nYour new balance is Ksh {balance}.",
  
  // Balance text
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",
  
  // Referral bonus (per approved referral)
  referralBonus: 200,
  referralSuccess: "Thank you for using a referral code! Your referrer will receive Ksh {bonus} upon approval.",
  myReferral: "🔖 *Your Referral Code:* {code}\nEarn Ksh {bonus} for each approved referral.",
  
  // Admin texts
  fromAdmin: "From Admin GK-FY",
  
  // STK push channel ID
  channelID: 529,
  
  // Withdrawal limits
  withdrawMin: 1,
  withdrawMax: 75000,
  
  // Additional commands help text for users
  userHelp: "Available commands:\n/start - Start deposit flow\n/balance - Check your balance\n/packages - View available packages\n/history - Deposit history\n/withdraw - Withdraw funds\n/myreferral - Your referral code\n/interest - Estimated interest\n/profile - Your profile\n/faq - FAQs\n/help - Help",
};

// =====================
// IN-MEMORY DATA STORAGE
// =====================
const userProfiles = {};         // { chatId: { firstName, lastName, phone } }
const userState = {};            // { chatId: { stage, package, amount, depositNumber, stkRef, referralCode, withdrawAmount, withdrawNumber } }
const userBalances = {};         // { chatId: number }
const depositHistory = {};       // { chatId: [ { invCode, amount, package, depositNumber, date, status, mpesaCode } ] }
const referralRequests = {};     // { id: { referrer, referred, code, date, status } }
let nextReferralID = 1;
const userReferralCodes = {};    // { chatId: referralCode }
const userReferralBonuses = {};  // { chatId: bonus }
const pendingWithdrawals = {};   // { id: { chatId, amount, withdrawNumber, date, status, remark } }
let nextWithdrawalID = 1;
const supportTickets = {};       // { id: { chatId, message, date, status, reply } }
let nextTicketID = 1;
const bannedUsers = {};          // { chatId: { reason, date } }

// Available investment packages.
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// =====================
// CREATE TELEGRAM BOT (polling mode)
// =====================
const bot = new TelegramBot(token, { polling: true });

// =====================
// HELPER FUNCTIONS
// =====================

// Replace placeholders.
function parsePlaceholders(template, data) {
  return template
    .replace(/{firstName}/g, data.firstName || "")
    .replace(/{lastName}/g, data.lastName || "")
    .replace(/{amount}/g, data.amount || "")
    .replace(/{package}/g, data.package || "")
    .replace(/{min}/g, data.min || "")
    .replace(/{depositNumber}/g, data.depositNumber || "")
    .replace(/{seconds}/g, data.seconds || "")
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{footer}/g, botConfig.paymentFooter || "")
    .replace(/{balance}/g, data.balance || "")
    .replace(/{bonus}/g, data.bonus || "")
    .replace(/{invCode}/g, data.invCode || "")
    .replace(/{code}/g, data.code || "");
}

// Format phone number for STK push (e.g., "0712345678" -> "254712345678")
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

// Generate a unique investment code ("INV-" + 7-digit number)
function generateInvestmentCode() {
  return "INV-" + Math.floor(1000000 + Math.random() * 9000000);
}

// Generate a referral code ("FY'S-" + 5-digit number)
function generateReferralCode() {
  return "FY'S-" + Math.floor(10000 + Math.random() * 90000);
}

// Send STK push to Pay Hero.
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
    console.error("STK Push Error:", error.response ? error.response.data : error);
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
    console.error("Status Fetch Error:", error.response ? error.response.data : error);
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

// Get admin help text.
function getAdminHelp() {
  return (
    "*ADMIN COMMANDS:*\n" +
    "1) /admin - Show this help message.\n" +
    "2) edit <key> <newValue> - Edit a config value.\n" +
    "   Valid keys: registrationWelcome, askLastName, askPhone, registrationSuccess, welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID, balanceMessage, depositErrorMessage, referralBonus, withdrawMin, withdrawMax\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "4) /addpackage <name> <min> - Add a new investment package.\n" +
    "5) /editpackage <name> <newMin> - Edit an existing package's minimum.\n" +
    "6) /referrals - List pending referral requests.\n" +
    "7) approve <referralID> - Approve a referral request.\n" +
    "8) decline <referralID> - Decline a referral request.\n" +
    "9) /withdrawlimits - Show current withdrawal limits.\n" +
    "10) /users - List all registered users (truncated).\n" +
    "11) ban <chatId> <reason> - Ban a user.\n" +
    "12) unban <chatId> - Unban a user.\n" +
    "13) adjust <chatId> <amount> - Adjust (add/deduct) money from a user's balance.\n" +
    "14) /investment <chatId> - Get details for a user's last investment.\n" +
    "15) /setreferral <amount> - Set referral bonus amount.\n" +
    "16) /tickets - List all support tickets.\n" +
    "17) replyticket <ticketID> <message> - Reply to a support ticket.\n" +
    "18) /help - Show user help message."
  );
}

// =====================
// SUPPORT TICKET SYSTEM
// =====================
const supportTickets = {}; // { id: { chatId, message, date, status, reply } }
let nextTicketID = 1;

// When user sends /ticket, prompt them for their issue.
bot.onText(/\/ticket/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "*Please describe your issue for support:*", { parse_mode: "Markdown" });
  userState[chatId] = { stage: "awaitingTicket" };
});

// Capture the support ticket message.
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  
  const state = userState[chatId];
  if (state && state.stage === "awaitingTicket") {
    const ticketID = nextTicketID++;
    supportTickets[ticketID] = {
      chatId,
      message: text,
      date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
      status: "pending",
      reply: ""
    };
    bot.sendMessage(chatId, `*Support Ticket Created!*\nYour ticket ID is *${ticketID}*. An admin will reply soon.`, { parse_mode: "Markdown" });
    delete userState[chatId];
  }
});

// =====================
// REGISTRATION FLOW
// =====================
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "registerFirstName" };
  bot.sendMessage(chatId, botConfig.registrationWelcome, { parse_mode: "Markdown" });
});

// Registration steps.
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  
  // Skip if command starts with '/'
  if (text.startsWith("/")) return;
  
  // Registration flow handling.
  if (userState[chatId] && userState[chatId].stage.startsWith("register")) {
    const state = userState[chatId];
    if (state.stage === "registerFirstName") {
      state.firstName = text.trim();
      state.stage = "registerLastName";
      bot.sendMessage(chatId, botConfig.askLastName, { parse_mode: "Markdown" });
      return;
    }
    if (state.stage === "registerLastName") {
      state.lastName = text.trim();
      state.stage = "registerPhone";
      bot.sendMessage(chatId, botConfig.askPhone, { parse_mode: "Markdown" });
      return;
    }
    if (state.stage === "registerPhone") {
      const phone = text.trim();
      if (!/^(07|01)\d{8}$/.test(phone)) {
        bot.sendMessage(chatId, "*⚠️ Please enter a valid phone number (starting with 07 or 01 and 10 digits).*", { parse_mode: "Markdown" });
        return;
      }
      state.phone = phone;
      userProfiles[chatId] = {
        firstName: state.firstName,
        lastName: state.lastName,
        phone: state.phone
      };
      if (!userBalances[chatId]) userBalances[chatId] = 0;
      if (!userReferralCodes[chatId]) {
        userReferralCodes[chatId] = generateReferralCode();
        userReferralBonuses[chatId] = 0;
      }
      bot.sendMessage(chatId, parsePlaceholders(botConfig.registrationSuccess, {
        firstName: state.firstName,
        lastName: state.lastName,
        referralCode: userReferralCodes[chatId]
      }), { parse_mode: "Markdown" });
      delete userState[chatId];
      bot.sendMessage(chatId, "Type /start to begin investing.", { parse_mode: "Markdown" });
      return;
    }
  }
});

// If not registered, prompt registration.
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  if (!userProfiles[chatId] && !msg.text.startsWith("/register")) {
    bot.sendMessage(chatId, "*You are not registered.* Please type /register to begin.", { parse_mode: "Markdown" });
  }
});

// =====================
// MAIN DEPOSIT FLOW
// =====================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  // If user is banned, notify.
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "packageSelection" };
  const keyboard = packages.map(pkg => ([{
    text: `${pkg.name} Package (Min Ksh ${pkg.min})`,
    callback_data: `pkg:${pkg.name}`
  }]));
  // Use the user's first name if available.
  const firstName = (userProfiles[chatId] && userProfiles[chatId].firstName) || "";
  bot.sendMessage(chatId, parsePlaceholders(botConfig.welcomeMessage, { firstName }), {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: "Markdown"
  });
});

// Handle callback for package selection.
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
    bot.sendMessage(chatId, botConfig.referralPrompt, { parse_mode: "Markdown" });
  }
});

// Handle deposit flow messages.
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const lowerText = text.toLowerCase();
  if (msg.chat.type !== "private") return;
  // Skip if command.
  if (text.startsWith("/")) return;
  if (!userState[chatId]) return;
  const state = userState[chatId];
  
  // Stage: Awaiting Referral.
  if (state.stage === "awaitingReferral") {
    state.referralCode = (lowerText === "none") ? null : text.trim();
    state.stage = "awaitingAmount";
    bot.sendMessage(chatId, "Please enter the deposit amount (in Ksh):", { parse_mode: "Markdown" });
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
    const currentDateTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    // Generate unique investment code.
    const invCode = generateInvestmentCode();
    
    // Record deposit history.
    if (!depositHistory[chatId]) depositHistory[chatId] = [];
    depositHistory[chatId].push({
      invCode,
      amount: state.amount,
      package: state.package,
      depositNumber: state.depositNumber,
      date: currentDateTime,
      status: "SUCCESS", // We'll assume success for demo if status check passes.
      mpesaCode: "" // Will be filled below.
    });
    
    sendAdminAlert(
      `*💸 Deposit Attempt:*\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nTime (KE): ${currentDateTime}`
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
      const providerReference = statusData.provider_reference || "MPESA" + Math.floor(Math.random()*1000000);
      const resultDesc = statusData.ResultDesc || "";
      const currentDateTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      
      if (finalStatus === "SUCCESS") {
        if (!userBalances[chatId]) userBalances[chatId] = 0;
        userBalances[chatId] += state.amount;
        // Update the latest deposit record with status and mpesa code.
        const lastIndex = depositHistory[chatId].length - 1;
        depositHistory[chatId][lastIndex].status = "SUCCESS";
        depositHistory[chatId][lastIndex].mpesaCode = providerReference;
        
        const successMsg = parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(state.amount),
          package: state.package,
          depositNumber: state.depositNumber,
          mpesaCode: providerReference,
          date: currentDateTime,
          invCode: invCode
        });
        bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });
        sendAdminAlert(
          `*✅ Deposit Successful:*\nINV Code: ${invCode}\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nMPESA Code: ${providerReference}\nTime (KE): ${currentDateTime}`
        );
        // Process referral if provided.
        if (state.referralCode && state.referralCode.toLowerCase() !== "none") {
          // Assume referral code is in the format generated earlier.
          const refCode = state.referralCode;
          // Record referral request.
          referralRequests[nextReferralID] = {
            referrer: refCode,
            referred: chatId,
            code: refCode,
            date: currentDateTime,
            status: "pending"
          };
          nextReferralID++;
          bot.sendMessage(chatId, "*Thank you for using a referral code!* Your referrer will be credited upon approval.", { parse_mode: "Markdown" });
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

// =====================
// WITHDRAWAL FLOW
// =====================
bot.onText(/\/withdraw/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, parsePlaceholders("💸 *Withdrawal Requested!* Please enter the withdrawal amount (min Ksh {min}, max Ksh {max}):", { min: botConfig.withdrawMin, max: botConfig.withdrawMax }), { parse_mode: "Markdown" });
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
      bot.sendMessage(chatId, parsePlaceholders("*⚠️ Please enter a valid withdrawal amount between Ksh {min} and Ksh {max}.*", { min: botConfig.withdrawMin, max: botConfig.withdrawMax }), { parse_mode: "Markdown" });
      return;
    }
    state.withdrawAmount = amount;
    state.stage = "awaitingWithdrawNumber";
    bot.sendMessage(chatId, botConfig.askWithdrawNumber, { parse_mode: "Markdown" });
    return;
  }
  if (state && state.stage === "awaitingWithdrawNumber") {
    const num = text.trim();
    if (!/^(07|01)\d{8}$/.test(num)) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid M-PESA number (starting with 07 or 01 and 10 digits).*", { parse_mode: "Markdown" });
      return;
    }
    state.withdrawNumber = num;
    const balance = userBalances[chatId] || 0;
    if (state.withdrawAmount > balance) {
      bot.sendMessage(chatId, "*⚠️ Insufficient funds for withdrawal.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    // Create pending withdrawal request.
    pendingWithdrawals[nextWithdrawalID] = {
      chatId: chatId,
      amount: state.withdrawAmount,
      withdrawNumber: state.withdrawNumber,
      date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
      status: "pending",
      remark: ""
    };
    bot.sendMessage(chatId, `*Withdrawal Request Sent!*\nYour request for Ksh ${state.withdrawAmount} is pending admin approval.`, { parse_mode: "Markdown" });
    delete userState[chatId];
    nextWithdrawalID++;
    return;
  }
});

// =====================
// EXTRA USER COMMANDS
// =====================
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
    historyText += `${index + 1}. INV: *${record.invCode}* | Package: *${record.package}* | Amount: *Ksh ${record.amount}* | Deposit No: *${record.depositNumber}* | Date: *${record.date}* | Status: *${record.status}* | MPESA Code: *${record.mpesaCode || "N/A"}*\n`;
  });
  bot.sendMessage(chatId, historyText, { parse_mode: "Markdown" });
});

bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const interest = (balance * 0.05).toFixed(2);
  bot.sendMessage(chatId, `*📈 Estimated Monthly Interest:* Ksh ${interest} (at 5% per month)`, { parse_mode: "Markdown" });
});

bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  const profile = userProfiles[chatId] || {};
  const balance = userBalances[chatId] || 0;
  const history = depositHistory[chatId] || [];
  const totalDeposits = history.length;
  const refCode = userReferralCodes[chatId] || (generateReferralCode());
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  bot.sendMessage(chatId,
    `*👤 Your Profile:*\nName: *${profile.firstName || "N/A"} ${profile.lastName || ""}*\nBalance: *Ksh ${balance}*\nTotal Deposits: *${totalDeposits}*\nReferral Code: *${refCode}*\nReferral Bonus: *Ksh ${bonus}*`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/myreferral/, (msg) => {
  const chatId = msg.chat.id;
  const refCode = userReferralCodes[chatId] || (generateReferralCode());
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  bot.sendMessage(chatId, `*🔖 Your Referral Code:* ${refCode}\n*💰 Bonus:* Ksh ${bonus}\nShare your referral link: https://t.me/${botConfig.fromAdmin}?start=${refCode}\nEarn Ksh ${botConfig.referralBonus} per approved referral.`, { parse_mode: "Markdown" });
});

bot.onText(/\/faq/, (msg) => {
  const chatId = msg.chat.id;
  const faqText = 
`*FAQ:*
1. *How do I invest?*  
   Type /start and follow the prompts.
2. *What are the packages?*  
   Use /packages to see available options.
3. *How do I check my balance?*  
   Type /balance.
4. *What happens after I invest?*  
   An STK push is sent; status is checked after 20 seconds.
5. *How do referrals work?*  
   Share your referral code via /myreferral. You earn Ksh ${botConfig.referralBonus} per approved referral.
6. *How do I withdraw funds?*  
   Type /withdraw and follow the prompts.
7. *What is the estimated interest?*  
   Type /interest to see your estimated monthly interest.`;
  bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, botConfig.userHelp, { parse_mode: "Markdown" });
});

// =====================
// ADMIN COMMANDS
// =====================

// /admin - show admin help.
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
    // On startup, also notify admin with current commands.
    bot.sendMessage(msg.chat.id, "*Bot is successfully deployed and running!*", { parse_mode: "Markdown" });
  }
});

// /broadcast - broadcast messages.
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

// /addpackage - add a new package.
bot.onText(/\/addpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*⚠️ Usage: /addpackage <name> <min>*", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const min = parseInt(parts[1]);
  if (isNaN(min)) {
    bot.sendMessage(msg.chat.id, "*⚠️ Minimum must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  packages.push({ name, min });
  bot.sendMessage(msg.chat.id, `*Package ${name} added with minimum Ksh ${min}.*`, { parse_mode: "Markdown" });
});

// /editpackage - edit an existing package.
bot.onText(/\/editpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*⚠️ Usage: /editpackage <name> <newMin>*", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const newMin = parseInt(parts[1]);
  if (isNaN(newMin)) {
    bot.sendMessage(msg.chat.id, "*⚠️ New minimum must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  let pkg = packages.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!pkg) {
    bot.sendMessage(msg.chat.id, `*⚠️ Package ${name} not found.*`, { parse_mode: "Markdown" });
    return;
  }
  pkg.min = newMin;
  bot.sendMessage(msg.chat.id, `*Package ${pkg.name} updated to minimum Ksh ${newMin}.*`, { parse_mode: "Markdown" });
});

// /referrals - list pending referral requests.
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

// approve referral.
bot.onText(/approve (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const refId = match[1];
  const req = referralRequests[refId];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*⚠️ Referral request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  if (!userReferralBonuses[req.referrer]) userReferralBonuses[req.referrer] = 0;
  userReferralBonuses[req.referrer] += botConfig.referralBonus;
  bot.sendMessage(msg.chat.id, `*Referral ${refId} approved.* Bonus credited to referrer ${req.referrer}.`, { parse_mode: "Markdown" });
});

// decline referral.
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

// /withdrawlimits - show withdrawal limits.
bot.onText(/\/withdrawlimits/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `*Withdrawal Limits:*\nMinimum: Ksh ${botConfig.withdrawMin}\nMaximum: Ksh ${botConfig.withdrawMax}`, { parse_mode: "Markdown" });
});

// /users - list all registered users (truncated).
bot.onText(/\/users/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const users = Object.keys(userProfiles);
  if (users.length === 0) {
    bot.sendMessage(msg.chat.id, "*No users registered yet.*", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Registered Users:*\n";
  users.forEach((id) => {
    const prof = userProfiles[id];
    text += `• ${id}: *${prof.firstName} ${prof.lastName}* (Phone: ${prof.phone})\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// /adjust - adjust user balance.
bot.onText(/\/adjust (\d+) (-?\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  const amount = parseInt(match[2]);
  if (isNaN(amount)) {
    bot.sendMessage(msg.chat.id, "*⚠️ Please enter a valid amount.*", { parse_mode: "Markdown" });
    return;
  }
  if (!userBalances[targetId]) userBalances[targetId] = 0;
  userBalances[targetId] += amount;
  bot.sendMessage(msg.chat.id, `*User ${targetId} balance adjusted by Ksh ${amount}.* New balance: Ksh ${userBalances[targetId]}`, { parse_mode: "Markdown" });
});

// /investment - show last investment for a user.
bot.onText(/\/investment (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  const history = depositHistory[targetId] || [];
  if (history.length === 0) {
    bot.sendMessage(msg.chat.id, `*No investments found for user ${targetId}.*`, { parse_mode: "Markdown" });
    return;
  }
  const last = history[history.length - 1];
  let text = `*Last Investment for ${targetId}:*\nINV: *${last.invCode}*\nPackage: *${last.package}*\nAmount: *Ksh ${last.amount}*\nDeposit No: *${last.depositNumber}*\nDate: *${last.date}*\nStatus: *${last.status}*\nMPESA Code: *${last.mpesaCode || "N/A"}*`;
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// /setreferral - set referral bonus (admin).
bot.onText(/\/setreferral (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const newBonus = parseInt(match[1]);
  if (isNaN(newBonus)) {
    bot.sendMessage(msg.chat.id, "*⚠️ Please provide a valid bonus amount.*", { parse_mode: "Markdown" });
    return;
  }
  botConfig.referralBonus = newBonus;
  bot.sendMessage(msg.chat.id, `*Referral bonus updated to:* Ksh ${newBonus}`, { parse_mode: "Markdown" });
});

// =====================
// SUPPORT TICKET SYSTEM
// =====================
bot.onText(/\/ticket/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "*Please describe your issue for support:*", { parse_mode: "Markdown" });
  userState[chatId] = { stage: "awaitingTicket" };
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  const state = userState[chatId];
  if (state && state.stage === "awaitingTicket") {
    const ticketID = nextTicketID++;
    supportTickets[ticketID] = {
      chatId: chatId,
      message: text,
      date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
      status: "pending",
      reply: ""
    };
    bot.sendMessage(chatId, `*Support Ticket Created!*\nYour ticket ID is *${ticketID}*. An admin will reply soon.`, { parse_mode: "Markdown" });
    delete userState[chatId];
  }
});

// Admin: /tickets - list support tickets.
bot.onText(/\/tickets/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(supportTickets);
  if (keys.length === 0) {
    bot.sendMessage(msg.chat.id, "*No pending support tickets.*", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Pending Support Tickets:*\n";
  keys.forEach((id) => {
    const ticket = supportTickets[id];
    text += `Ticket ID: *${id}* | User: *${ticket.chatId}* | Date: *${ticket.date}* | Status: *${ticket.status}*\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// Admin: /replyticket <ticketID> <message>
bot.onText(/\/replyticket (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const ticketID = match[1];
  const replyMsg = match[2];
  const ticket = supportTickets[ticketID];
  if (!ticket) {
    bot.sendMessage(msg.chat.id, "*⚠️ Ticket not found.*", { parse_mode: "Markdown" });
    return;
  }
  ticket.status = "replied";
  ticket.reply = replyMsg;
  bot.sendMessage(msg.chat.id, `*Ticket ${ticketID} replied.*`, { parse_mode: "Markdown" });
  bot.sendMessage(ticket.chatId, `*Support Ticket Reply:*\n${replyMsg}`, { parse_mode: "Markdown" });
});

// =====================
// BAN / UNBAN USERS
// =====================
bot.onText(/\/ban (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  const reason = match[2];
  bannedUsers[targetId] = { reason, date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }) };
  bot.sendMessage(msg.chat.id, `*User ${targetId} has been banned.* Reason: ${reason}`, { parse_mode: "Markdown" });
});

bot.onText(/\/unban (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  if (bannedUsers[targetId]) {
    delete bannedUsers[targetId];
    bot.sendMessage(msg.chat.id, `*User ${targetId} has been unbanned.*`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, `*User ${targetId} is not banned.*`, { parse_mode: "Markdown" });
  }
});

// =====================
// POLLING ERROR HANDLER
// =====================
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
