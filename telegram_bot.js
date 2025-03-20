"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ==================== CONFIGURATION ====================
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
const ADMIN_ID = 5415517965; // Admin Telegram numeric ID

// Editable configuration (admin can change these using "edit" commands)
let botConfig = {
  // Registration prompts
  regWelcome: "👋 *Welcome to FY'S PROPERTY Investment Bot!* Please register to continue.\nEnter your *first name*:",
  regLastName: "Please enter your *last name*:",
  regPhone: "Please enter your *phone number* (must start with 07 or 01 and be 10 digits):",
  regSuccess: "🎉 *Registration Successful!* Welcome, *{firstName} {lastName}*.\nYour referral code is: *{referralCode}*.\nType /start to begin investing.",

  // Deposit flow texts
  welcomeMessage: "👋 *Welcome to FY'S PROPERTY Investment Bot!* \nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package*.\nPlease enter the deposit amount (in Ksh) (Minimum Ksh {min}):",
  referralPrompt: "If you have a referral code, please enter it now, or type `none`.",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds... \n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...* \nWe will fetch the status soon!",
  paymentSuccess: "*🎉 Payment Successful!*\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit Number:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  
  // Withdrawal texts
  withdrawPrompt: "Please enter the withdrawal amount (min Ksh {withdrawMin}, max Ksh {withdrawMax}):",
  withdrawNumberPrompt: "Please enter the M-PESA number (must start with 07 or 01, 10 digits):",
  withdrawSuccess: "*✅ Withdrawal Successful!*\nYou withdrew Ksh {amount}.\nYour new balance is Ksh {balance}.",
  
  // Balance text
  balanceMessage: "*💵 Your current balance is:* Ksh {balance}",
  
  // Referral
  referralBonus: 200, // bonus per approved referral
  referralLinkPrefix: "FY'S-", // referral code prefix
  referralMessage: "*🔖 Your Referral Code:* {referralCode}\nShare it with your friends and earn Ksh {referralBonus} per approved referral.\nYour referred users: {referredList}",

  // Admin broadcast label
  fromAdmin: "From Admin GK-FY",
  
  // Payment channel and unique investment codes
  channelID: 529,
  
  // Withdrawal limits
  withdrawMin: 1,
  withdrawMax: 75000
};

// ==================== IN-MEMORY DATA STORAGE ====================

// Registration data: { chatId: { firstName, lastName, phone, referralCode } }
const userRegistration = {};

// Ban list: { chatId: { reason, bannedAt } }
const bannedUsers = {};

// Deposit (investment) state: { chatId: { stage, package, amount, depositNumber, stkRef, referralCode (if provided) } }
const userState = {};

// User balances: { chatId: number }
const userBalances = {};

// Deposit history: { chatId: [ { invCode, amount, package, depositNumber, date, status, mpesaCode } ] }
const depositHistory = {};

// Referral requests: { referralID: { referrer, referred, code, date, status } }
const referralRequests = {};
let nextReferralID = 1;

// For simplicity, use user chatId for referral code (prefix + 5 digits from chatId's last 5 digits)
const userReferralCodes = {}; // { chatId: referralCode }
const userReferralBonuses = {}; // { chatId: number }

// Available investment packages (admin can add/edit)
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ==================== CREATE THE BOT ====================
const bot = new TelegramBot(token, { polling: true });

// ==================== HELPER FUNCTIONS ====================

// Replace placeholders in a template string.
function parsePlaceholders(template, data) {
  return template
    .replace(/{amount}/g, data.amount || "")
    .replace(/{package}/g, data.package || "")
    .replace(/{min}/g, data.min || "")
    .replace(/{depositNumber}/g, data.depositNumber || "")
    .replace(/{seconds}/g, data.seconds || "")
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{footer}/g, botConfig.paymentFooter || "")
    .replace(/{balance}/g, data.balance || "")
    .replace(/{referralBonus}/g, String(botConfig.referralBonus));
}

// Format phone number: convert "0712345678" to "254712345678"
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

// Generate unique investment code: "INV-" + 7-digit random number.
function generateInvestmentCode() {
  const num = Math.floor(1000000 + Math.random() * 9000000);
  return "INV-" + num;
}

// Generate referral code: "FY'S-" + 5-digit (using last 5 digits of chatId)
function generateReferralCode(chatId) {
  let idStr = chatId.toString();
  idStr = idStr.slice(-5).padStart(5, "0");
  return "FY'S-" + idStr;
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
    console.error("STK Push Error:", error.response ? error.response.data : error.message);
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
    console.error("Status Fetch Error:", error.response ? error.response.data : error.message);
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
    "   Valid keys: regWelcome, regLastName, regPhone, regSuccess, welcomeMessage, packageMessage, referralPrompt,\n" +
    "             paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID,\n" +
    "             balanceMessage, depositErrorMessage, referralBonus, withdrawMin, withdrawMax\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "4) addpackage <name> <min> - Add a new investment package.\n" +
    "5) editpackage <name> <newMin> - Edit an existing package's minimum.\n" +
    "6) /listusers - List all registered users.\n" +
    "7) /ban <userId> <reason> - Ban a user.\n" +
    "8) /unban <userId> - Unban a user.\n" +
    "9) /withdrawals - List pending withdrawal requests.\n" +
    "10) approvewithdraw <withdrawalID> <remarks> - Approve a withdrawal.\n" +
    "11) declinewithdraw <withdrawalID> <remarks> - Decline a withdrawal.\n" +
    "12) /referrals - List pending referral requests.\n" +
    "13) approve <referralID> - Approve a referral.\n" +
    "14) decline <referralID> - Decline a referral.\n" +
    "15) addmoney <userId> <amount> - Add money to a user's balance.\n" +
    "16) deductmoney <userId> <amount> - Deduct money from a user's balance.\n" +
    "17) /withdrawlimits - Show current withdrawal limits.\n" +
    "18) cancelinv <INV_CODE> <remarks> - Cancel an investment and refund money.\n" +
    "19) /adminhelp - Show this help again.\n" +
    "20) /balance - Check user balance (admin view).\n" +
    "\nAlso, upon startup, the bot will send this admin message with all commands."
  );
}

// ==================== REGISTRATION FLOW ====================

// When user sends /register, start registration flow.
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "awaitingFirstName" };
  bot.sendMessage(chatId, botConfig.regWelcome || "Please enter your first name:", { parse_mode: "Markdown" });
});

// Handle registration flow.
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  // If user is banned, ignore further messages.
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  // If already registered, do not repeat registration unless /register is sent.
  if (userRegistration[chatId] && text.toLowerCase() === "/register") {
    bot.sendMessage(chatId, "*You are already registered.*", { parse_mode: "Markdown" });
    return;
  }
  // Registration flow handling.
  const state = userState[chatId];
  if (state) {
    if (state.stage === "awaitingFirstName") {
      state.firstName = text;
      state.stage = "awaitingLastName";
      bot.sendMessage(chatId, botConfig.regLastName || "Please enter your last name:", { parse_mode: "Markdown" });
      return;
    }
    if (state.stage === "awaitingLastName") {
      state.lastName = text;
      state.stage = "awaitingRegPhone";
      bot.sendMessage(chatId, botConfig.regPhone || "Please enter your phone number:", { parse_mode: "Markdown" });
      return;
    }
    if (state.stage === "awaitingRegPhone") {
      // Validate phone number (must start with 07 or 01, 10 digits).
      if (!/^(07|01)\d{8}$/.test(text.trim())) {
        bot.sendMessage(chatId, "*⚠️ Please enter a valid phone number (starting with 07 or 01 and 10 digits).*", { parse_mode: "Markdown" });
        return;
      }
      state.phone = text.trim();
      // Save registration.
      userRegistration[chatId] = {
        firstName: state.firstName,
        lastName: state.lastName,
        phone: state.phone,
        referralCode: generateReferralCode(chatId)
      };
      // Initialize balance and deposit history.
      userBalances[chatId] = 0;
      depositHistory[chatId] = [];
      userReferralCodes[chatId] = userRegistration[chatId].referralCode;
      if (!userReferralBonuses[chatId]) userReferralBonuses[chatId] = 0;
      // Registration complete.
      const regMsg = parsePlaceholders(botConfig.regSuccess, {
        firstName: state.firstName,
        lastName: state.lastName,
        referralCode: userRegistration[chatId].referralCode
      });
      bot.sendMessage(chatId, regMsg, { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
  }
});

// ==================== MAIN INVESTMENT DEPOSIT FLOW ====================

// When user sends /start (and is registered), start deposit flow.
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  if (!userRegistration[chatId]) {
    bot.sendMessage(chatId, "*You must register first. Use /register*", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  // Start deposit flow.
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
    bot.sendMessage(chatId, botConfig.referralPrompt, { parse_mode: "Markdown" });
  }
});

// Handle deposit flow messages.
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const lowerText = text.toLowerCase();
  if (msg.chat.type !== "private") return;
  // Skip if message is a command.
  if (text.startsWith("/")) return;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  if (!userRegistration[chatId]) {
    bot.sendMessage(chatId, "*You must register first. Use /register*", { parse_mode: "Markdown" });
    return;
  }
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
      // Record referral request if referral code is not own.
      if (text !== userReferralCodes[chatId]) {
        referralRequests[nextReferralID] = {
          referrer: text, // assuming the referral code is from another user
          referred: chatId,
          code: text,
          date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
          status: "pending"
        };
        nextReferralID++;
        bot.sendMessage(chatId, "*Thank you for using a referral code!* Your referrer will be credited upon approval.", { parse_mode: "Markdown" });
      }
    }
    state.stage = "awaitingAmount";
    bot.sendMessage(chatId, "*Please enter the deposit amount (in Ksh):*", { parse_mode: "Markdown" });
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
      package: state.package,
      min: String(pkg.min)
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
    const invCode = generateInvestmentCode();
    
    const attemptTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    // Record deposit history as pending.
    if (!depositHistory[chatId]) depositHistory[chatId] = [];
    depositHistory[chatId].push({
      invCode: invCode,
      amount: state.amount,
      package: state.package,
      depositNumber: state.depositNumber,
      date: attemptTime,
      status: "pending",
      mpesaCode: ""
    });
    
    sendAdminAlert(
      `*💸 Deposit Attempt:*\nInvestment Code: ${invCode}\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nTime (KE): ${attemptTime}`
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
        userBalances[chatId] = (userBalances[chatId] || 0) + state.amount;
        // Update deposit history with success.
        depositHistory[chatId] = depositHistory[chatId].map(rec => rec.invCode === invCode ? { ...rec, status: "SUCCESS", mpesaCode: providerReference } : rec);
        
        const successMsg = parsePlaceholders(botConfig.paymentSuccess, {
          amount: String(state.amount),
          package: state.package,
          depositNumber: state.depositNumber,
          mpesaCode: providerReference,
          date: currentDateTime
        });
        bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });
        sendAdminAlert(
          `*✅ Deposit Successful:*\nInvestment Code: ${invCode}\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nMPESA Code: ${providerReference}\nTime (KE): ${currentDateTime}`
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
          `*❌ Deposit Failed:*\nInvestment Code: ${invCode}\nAmount: Ksh ${state.amount}\nDeposit Number: ${state.depositNumber}\nPackage: ${state.package} Package\nError: ${errMsg}\nTime (KE): ${currentDateTime}`
        );
      } else {
        bot.sendMessage(chatId, `*⏳ Payment Pending.* Current status: ${finalStatus}\nPlease wait a bit longer or contact support.\nType /start to restart.`, { parse_mode: "Markdown" });
      }
      delete userState[chatId];
    }, 20000);
    return;
  }
});

// ==================== WITHDRAWAL FLOW ====================

bot.onText(/\/withdraw/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, parsePlaceholders(botConfig.withdrawPrompt || `*Please enter the withdrawal amount (min Ksh {withdrawMin}, max Ksh {withdrawMax}):*`, { withdrawMin: String(botConfig.withdrawMin), withdrawMax: String(botConfig.withdrawMax) }), { parse_mode: "Markdown" });
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
    bot.sendMessage(chatId, "*Please enter the M-PESA number to send your withdrawal (must start with 07 or 01 and be 10 digits):*", { parse_mode: "Markdown" });
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
      bot.sendMessage(chatId, "*⚠️ You do not have sufficient funds for this withdrawal.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    // Record withdrawal request (pending admin approval).
    const withdrawalID = "WD-" + Math.floor(100000 + Math.random() * 900000);
    if (!withdrawalRequests) withdrawalRequests = {};
    withdrawalRequests[withdrawalID] = {
      user: chatId,
      amount: state.withdrawAmount,
      withdrawNumber: state.withdrawNumber,
      date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
      status: "pending"
    };
    bot.sendMessage(chatId, `*Withdrawal request submitted!* Your request ID is ${withdrawalID}. Please wait for admin approval.`, { parse_mode: "Markdown" });
    delete userState[chatId];
    return;
  }
});

// ==================== EXTRA USER COMMANDS ====================

bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const interest = (balance * 0.05).toFixed(2);
  bot.sendMessage(chatId, `*📈 Estimated Monthly Interest:* Ksh ${interest} (at 5% per month)`, { parse_mode: "Markdown" });
});

bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const history = depositHistory[chatId] || [];
  const totalDeposits = history.length;
  const refCode = userReferralCodes[chatId] || generateReferralCode(chatId);
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  bot.sendMessage(chatId,
    `*👤 Your Profile:*\n*Balance:* Ksh ${balance}\n*Total Deposits:* ${totalDeposits}\n*Referral Code:* ${refCode}\n*Referral Bonus:* Ksh ${bonus}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/myreferral/, (msg) => {
  const chatId = msg.chat.id;
  const refCode = userReferralCodes[chatId] || generateReferralCode(chatId);
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  // For privacy, list only last 4 digits of referred users' IDs.
  let referredList = "";
  for (let id in referralRequests) {
    const req = referralRequests[id];
    if (req.referrer == chatId && req.status === "approved") {
      referredList += id.slice(-4) + ", ";
    }
  }
  if (referredList === "") referredList = "None";
  else referredList = referredList.slice(0, -2);
  bot.sendMessage(chatId, `*🔖 Your Referral Code:* ${refCode}\n*💰 Bonus:* Ksh ${bonus}\n*Referred Users:* ${referredList}\nShare your referral code to earn Ksh ${botConfig.referralBonus} per approved referral.`, { parse_mode: "Markdown" });
});

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
   An STK push is sent; status is checked after 20 seconds.
5. *How do referrals work?*  
   Share your referral code via /myreferral. You earn Ksh ${botConfig.referralBonus} per approved referral.
6. *How do I withdraw funds?*  
   Use /withdraw and follow the prompts.
7. *What is the estimated interest?*  
   Use /interest to view estimated monthly interest (5% per month).`;
  bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = 
`*USER COMMANDS:*
/register - Register with the bot.
/start - Begin an investment deposit.
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

// /packages command to list packages.
bot.onText(/\/packages/, (msg) => {
  const chatId = msg.chat.id;
  let pkgText = "*Available Investment Packages:*\n";
  packages.forEach((pkg) => {
    pkgText += `• *${pkg.name}*: Minimum Ksh ${pkg.min}\n`;
  });
  bot.sendMessage(chatId, pkgText, { parse_mode: "Markdown" });
});

// /listusers - admin command to list all registered users.
bot.onText(/\/listusers/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  let text = "*Registered Users:*\n";
  for (let id in userRegistration) {
    const reg = userRegistration[id];
    const bal = userBalances[id] || 0;
    text += `ID: *${id}* | Name: *${reg.firstName} ${reg.lastName}* | Balance: *Ksh ${bal}*\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// Admin: Ban and unban users.
bot.onText(/\/ban (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const args = match[1].split(" ");
  if (args.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* /ban <userId> <reason>", { parse_mode: "Markdown" });
    return;
  }
  const userId = args[0];
  const reason = args.slice(1).join(" ");
  bannedUsers[userId] = { reason: reason, bannedAt: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }) };
  bot.sendMessage(msg.chat.id, `*User ${userId} has been banned.* Reason: ${reason}`, { parse_mode: "Markdown" });
});

bot.onText(/\/unban (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const userId = match[1].trim();
  if (bannedUsers[userId]) {
    delete bannedUsers[userId];
    bot.sendMessage(msg.chat.id, `*User ${userId} has been unbanned.*`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, "*User is not banned.*", { parse_mode: "Markdown" });
  }
});

// Admin: Add and edit packages.
bot.onText(/\/addpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* /addpackage <name> <min>", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const min = parseInt(parts[1]);
  if (isNaN(min)) {
    bot.sendMessage(msg.chat.id, "*Minimum must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  packages.push({ name, min });
  bot.sendMessage(msg.chat.id, `*Package ${name} added with minimum Ksh ${min}.*`, { parse_mode: "Markdown" });
});

bot.onText(/\/editpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* /editpackage <name> <newMin>", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const newMin = parseInt(parts[1]);
  if (isNaN(newMin)) {
    bot.sendMessage(msg.chat.id, "*New minimum must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  const pkg = packages.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!pkg) {
    bot.sendMessage(msg.chat.id, "*Package not found.*", { parse_mode: "Markdown" });
    return;
  }
  pkg.min = newMin;
  bot.sendMessage(msg.chat.id, `*Package ${pkg.name} updated:* New minimum is Ksh ${newMin}.`, { parse_mode: "Markdown" });
});

// Admin: Adjust user balance.
bot.onText(/\/addmoney (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* /addmoney <userId> <amount>", { parse_mode: "Markdown" });
    return;
  }
  const userId = parts[0];
  const amount = parseInt(parts[1]);
  if (isNaN(amount)) {
    bot.sendMessage(msg.chat.id, "*Amount must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  userBalances[userId] = (userBalances[userId] || 0) + amount;
  bot.sendMessage(msg.chat.id, `*Added Ksh ${amount}* to user ${userId}. New balance: Ksh ${userBalances[userId]}.`, { parse_mode: "Markdown" });
});

bot.onText(/\/deductmoney (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* /deductmoney <userId> <amount>", { parse_mode: "Markdown" });
    return;
  }
  const userId = parts[0];
  const amount = parseInt(parts[1]);
  if (isNaN(amount)) {
    bot.sendMessage(msg.chat.id, "*Amount must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  userBalances[userId] = (userBalances[userId] || 0) - amount;
  bot.sendMessage(msg.chat.id, `*Deducted Ksh ${amount}* from user ${userId}. New balance: Ksh ${userBalances[userId]}.`, { parse_mode: "Markdown" });
});

// Admin: List all registered users.
bot.onText(/\/listusers/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  let text = "*Registered Users:*\n";
  for (let id in userRegistration) {
    const reg = userRegistration[id];
    const bal = userBalances[id] || 0;
    text += `ID: *${id}* | Name: *${reg.firstName} ${reg.lastName}* | Balance: *Ksh ${bal}*\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ==================== WITHDRAWAL APPROVAL (Admin) ====================
// In-memory pending withdrawals.
const withdrawalRequests = {}; // { id: { user, amount, withdrawNumber, date, status, adminRemarks } }
let nextWithdrawID = 1;

// /withdrawals - list pending withdrawal requests.
bot.onText(/\/withdrawals/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(withdrawalRequests);
  if (keys.length === 0) {
    bot.sendMessage(msg.chat.id, "*No pending withdrawal requests.*", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Pending Withdrawal Requests:*\n";
  keys.forEach((id) => {
    const req = withdrawalRequests[id];
    text += `ID: *${id}* | User: *${req.user}* | Amount: *Ksh ${req.amount}* | Number: *${req.withdrawNumber}* | Date: *${req.date}* | Status: *${req.status}*\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// When user sends /withdraw, create a pending withdrawal request.
bot.onText(/\/withdraw (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== "private") return;
  const amount = parseInt(match[1]);
  if (isNaN(amount) || amount < botConfig.withdrawMin || amount > botConfig.withdrawMax) {
    bot.sendMessage(chatId, `*⚠️ Please enter a valid withdrawal amount between Ksh ${botConfig.withdrawMin} and Ksh ${botConfig.withdrawMax}.*`, { parse_mode: "Markdown" });
    return;
  }
  const balance = userBalances[chatId] || 0;
  if (amount > balance) {
    bot.sendMessage(chatId, "*⚠️ You do not have sufficient funds for this withdrawal.*", { parse_mode: "Markdown" });
    return;
  }
  // Store pending withdrawal.
  const withdrawalID = "WD-" + Math.floor(100000 + Math.random() * 900000);
  withdrawalRequests[withdrawalID] = {
    user: chatId,
    amount: amount,
    withdrawNumber: null,
    date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
    status: "pending",
    adminRemarks: ""
  };
  // Ask for M-PESA number.
  userState[chatId] = { stage: "awaitingWithdrawNumber", withdrawalID: withdrawalID, withdrawAmount: amount };
  bot.sendMessage(chatId, "*Please enter the M-PESA number to receive your withdrawal (must start with 07 or 01 and be 10 digits):*", { parse_mode: "Markdown" });
});

// Handle withdrawal M-PESA number.
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  const state = userState[chatId];
  if (state && state.stage === "awaitingWithdrawNumber") {
    if (!/^(07|01)\d{8}$/.test(text.trim())) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid M-PESA number (starting with 07 or 01 and 10 digits).*", { parse_mode: "Markdown" });
      return;
    }
    state.withdrawNumber = text.trim();
    // Update the pending withdrawal.
    const wid = state.withdrawalID;
    if (withdrawalRequests[wid]) {
      withdrawalRequests[wid].withdrawNumber = state.withdrawNumber;
      bot.sendMessage(chatId, `*Withdrawal request submitted!* Your request ID is ${wid}. Please wait for admin approval.`, { parse_mode: "Markdown" });
    }
    delete userState[chatId];
  }
});

// Admin: Approve withdrawal.
bot.onText(/approvewithdraw (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* approvewithdraw <withdrawalID> <remarks>", { parse_mode: "Markdown" });
    return;
  }
  const withdrawalID = parts[0];
  const remarks = parts.slice(1).join(" ");
  const req = withdrawalRequests[withdrawalID];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*Withdrawal request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  req.adminRemarks = remarks;
  // Deduct money from user balance.
  userBalances[req.user] -= req.amount;
  bot.sendMessage(msg.chat.id, `*Withdrawal ${withdrawalID} approved.*`, { parse_mode: "Markdown" });
  bot.sendMessage(req.user, `*✅ Your withdrawal request (${withdrawalID}) has been approved.*\nRemarks: ${remarks}\nAmount: Ksh ${req.amount}\nYour new balance is Ksh ${userBalances[req.user]}.`, { parse_mode: "Markdown" });
});

// Admin: Decline withdrawal.
bot.onText(/declinewithdraw (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* declinewithdraw <withdrawalID> <remarks>", { parse_mode: "Markdown" });
    return;
  }
  const withdrawalID = parts[0];
  const remarks = parts.slice(1).join(" ");
  const req = withdrawalRequests[withdrawalID];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*Withdrawal request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "declined";
  req.adminRemarks = remarks;
  bot.sendMessage(msg.chat.id, `*Withdrawal ${withdrawalID} declined.*`, { parse_mode: "Markdown" });
  bot.sendMessage(req.user, `*❌ Your withdrawal request (${withdrawalID}) has been declined.*\nRemarks: ${remarks}\nType /withdraw to try again.`, { parse_mode: "Markdown" });
});

// ==================== EXTRA USER COMMANDS ====================

bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  const balance = userBalances[chatId] || 0;
  const interest = (balance * 0.05).toFixed(2);
  bot.sendMessage(chatId, `*📈 Estimated Monthly Interest:* Ksh ${interest} (at 5% per month)`, { parse_mode: "Markdown" });
});

bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  const reg = userRegistration[chatId];
  const balance = userBalances[chatId] || 0;
  const history = depositHistory[chatId] || [];
  const totalDeposits = history.length;
  const refCode = userReferralCodes[chatId] || generateReferralCode(chatId);
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  bot.sendMessage(chatId,
    `*👤 Your Profile:*\n*Name:* ${reg ? reg.firstName + " " + reg.lastName : "N/A"}\n*Balance:* Ksh ${balance}\n*Total Deposits:* ${totalDeposits}\n*Referral Code:* ${refCode}\n*Referral Bonus:* Ksh ${bonus}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/myreferral/, (msg) => {
  const chatId = msg.chat.id;
  const refCode = userReferralCodes[chatId] || generateReferralCode(chatId);
  userReferralCodes[chatId] = refCode;
  const bonus = userReferralBonuses[chatId] || 0;
  // For privacy, show only last 4 digits for each referred user.
  let referredList = "";
  for (let id in referralRequests) {
    const req = referralRequests[id];
    if (req.referrer == chatId && req.status === "approved") {
      referredList += id.slice(-4) + ", ";
    }
  }
  if (referredList === "") referredList = "None";
  else referredList = referredList.slice(0, -2);
  bot.sendMessage(chatId, `*🔖 Your Referral Code:* ${refCode}\n*💰 Bonus:* Ksh ${bonus}\n*Referred Users:* ${referredList}\nShare your code to earn Ksh ${botConfig.referralBonus} per approved referral.`, { parse_mode: "Markdown" });
});

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
   An STK push is sent and status is checked after 20 seconds.
5. *How do referrals work?*  
   Share your referral code via /myreferral. You earn Ksh ${botConfig.referralBonus} per approved referral.
6. *How do I withdraw funds?*  
   Use /withdraw and follow the prompts.
7. *What is the estimated interest?*  
   Use /interest to view estimated monthly interest (5% per month).`;
  bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = 
`*USER COMMANDS:*
/register - Register with the bot.
/start - Begin a new deposit/investment.
/packages - List available investment packages.
/balance - Check your current balance.
/history - View your deposit history.
/withdraw - Withdraw funds.
/myreferral - View your referral code and bonus.
/interest - View estimated monthly interest on your balance.
/profile - View your profile summary.
/faq - Frequently asked questions.
/help - Show this help message.`;
  bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
});

// ==================== ADMIN REFERRAL REVIEW COMMANDS ====================
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

bot.onText(/approve (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const refId = match[1];
  const req = referralRequests[refId];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*⚠️ Referral request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  const referrerId = req.referrer;
  if (!userReferralBonuses[referrerId]) userReferralBonuses[referrerId] = 0;
  userReferralBonuses[referrerId] += botConfig.referralBonus;
  bot.sendMessage(msg.chat.id, `*Referral ${refId} approved.* Bonus credited to ${referrerId}.`, { parse_mode: "Markdown" });
});

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

// ==================== ADMIN WITHDRAWAL REVIEW COMMANDS ====================
const withdrawalRequests = {}; // { id: { user, amount, withdrawNumber, date, status, adminRemarks } }
let nextWithdrawID = 1;

bot.onText(/\/withdrawals/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(withdrawalRequests);
  if (keys.length === 0) {
    bot.sendMessage(msg.chat.id, "*No pending withdrawal requests.*", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Pending Withdrawal Requests:*\n";
  keys.forEach((id) => {
    const req = withdrawalRequests[id];
    text += `ID: *${id}* | User: *${req.user}* | Amount: *Ksh ${req.amount}* | Number: *${req.withdrawNumber}* | Date: *${req.date}* | Status: *${req.status}*\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

bot.onText(/approvewithdraw (\S+)\s+(.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const withdrawalID = match[1];
  const remarks = match[2];
  const req = withdrawalRequests[withdrawalID];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*Withdrawal request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  req.adminRemarks = remarks;
  userBalances[req.user] -= req.amount;
  bot.sendMessage(msg.chat.id, `*Withdrawal ${withdrawalID} approved.*`, { parse_mode: "Markdown" });
  bot.sendMessage(req.user, `*✅ Your withdrawal request (${withdrawalID}) has been approved.*\nRemarks: ${remarks}\nAmount: Ksh ${req.amount}\nYour new balance is Ksh ${userBalances[req.user]}.`, { parse_mode: "Markdown" });
});

bot.onText(/declinewithdraw (\S+)\s+(.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const withdrawalID = match[1];
  const remarks = match[2];
  const req = withdrawalRequests[withdrawalID];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*Withdrawal request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "declined";
  req.adminRemarks = remarks;
  bot.sendMessage(msg.chat.id, `*Withdrawal ${withdrawalID} declined.*`, { parse_mode: "Markdown" });
  bot.sendMessage(req.user, `*❌ Your withdrawal request (${withdrawalID}) has been declined.*\nRemarks: ${remarks}\nType /withdraw to try again.`, { parse_mode: "Markdown" });
});

// ==================== ADMIN: List Users ====================
bot.onText(/\/listusers/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  let text = "*Registered Users:*\n";
  for (let id in userRegistration) {
    const reg = userRegistration[id];
    const bal = userBalances[id] || 0;
    text += `ID: *${id}* | Name: *${reg.firstName} ${reg.lastName}* | Balance: *Ksh ${bal}*\n`;
  }
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ==================== ADMIN: Add/Deduct Money ====================
bot.onText(/\/addmoney (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* /addmoney <userId> <amount>", { parse_mode: "Markdown" });
    return;
  }
  const userId = parts[0];
  const amount = parseInt(parts[1]);
  if (isNaN(amount)) {
    bot.sendMessage(msg.chat.id, "*Amount must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  userBalances[userId] = (userBalances[userId] || 0) + amount;
  bot.sendMessage(msg.chat.id, `*Added Ksh ${amount}* to user ${userId}. New balance: Ksh ${userBalances[userId]}.`, { parse_mode: "Markdown" });
});

bot.onText(/\/deductmoney (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage:* /deductmoney <userId> <amount>", { parse_mode: "Markdown" });
    return;
  }
  const userId = parts[0];
  const amount = parseInt(parts[1]);
  if (isNaN(amount)) {
    bot.sendMessage(msg.chat.id, "*Amount must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  userBalances[userId] = (userBalances[userId] || 0) - amount;
  bot.sendMessage(msg.chat.id, `*Deducted Ksh ${amount}* from user ${userId}. New balance: Ksh ${userBalances[userId]}.`, { parse_mode: "Markdown" });
});

// ==================== POLLING ERROR HANDLER ====================
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
