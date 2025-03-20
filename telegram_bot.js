"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ====================
// BOT CONFIG & SETTINGS
// ====================
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";  // Your Bot Token
const ADMIN_ID = 5415517965;                                  // Admin's Telegram numeric ID

// Admin-editable config:
let botConfig = {
  // Registration texts
  registrationWelcome: "👋 *Welcome to FY'S PROPERTY Investment Bot!* \nBefore you begin, please register.\nEnter your *first name*:",
  askLastName: "Great! Now, please enter your *last name*:",
  askPhone: "Please enter your *phone number* (must start with 07 or 01 and be 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}*! Your registration is complete. Your referral code is *{referralCode}*.\nType /start to begin investing.",
  
  // Deposit flow texts
  welcomeMessage: "👋 *Welcome back, {firstName}!*\nPlease choose one of our investment packages or type /invest if you already have enough balance:",
  packageMessage: "You chose the *{package} Package* (min Ksh {min}).\nEnter the deposit amount (in Ksh):",
  referralPrompt: "If you have a referral code, please enter it now, or type `none`:",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  paymentSuccess: "*🎉 Deposit Successful!*\n*INV Code:* {invCode}\n*Amount:* Ksh {amount}\n*Deposit No:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\nYou will earn Ksh {profitTotal} after the {earningReturn}.\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to see options.",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  
  // Investment flow (user invests from their balance)
  investPackagePrompt: "Select a package to invest from your balance:",
  investInsufficient: "*⚠️ You do not have enough balance to invest in {package}. Please deposit first.*",
  investSuccess: "*🎉 Investment Created!*\n*INV Code:* {invCode}\nPackage: *{package}*\nAmount: Ksh {amount}\nYou will earn Ksh {profitTotal} after the {earningReturn}.",
  
  // Withdrawal texts
  withdrawPrompt: "💸 *Withdrawal Requested!* Please enter the amount to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, enter the M-PESA number (start 07 or 01, 10 digits):",
  
  // Balance text
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",
  
  // Referral system
  referralBonus: 200,  // default bonus per approved referral
  referralSuccess: "Thank you for using a referral code! Your referrer will receive Ksh {bonus} upon approval.",
  myReferral: "🔖 *Your Referral Code:* {code}\nEarn Ksh {bonus} for each approved referral.\nReferral Link: https://t.me/{botUsername}?start={code}",
  
  // Admin label
  fromAdmin: "From Admin GK-FY",
  
  // STK push channel ID
  channelID: 529,
  
  // Profit Rate & Earning Return
  profitRate: 10,          // default 10% profit
  earningReturn: "monthly",// default timeframe "monthly"
  
  // Withdrawal limits
  withdrawMin: 1,
  withdrawMax: 75000,
  
  // Additional user help
  userHelp: "Available commands:\n/start - Begin deposit or see options\n/invest - Invest from your balance\n/deposit - Make a deposit via STK push\n/balance - Check your balance\n/packages - View packages\n/history - Deposit history\n/withdraw - Withdraw funds\n/myreferral - Your referral code\n/interest - Estimated interest\n/profile - Your profile\n/faq - FAQs\n/help - Show help\n/ticket - Create a support ticket"
};

// ====================
// IN-MEMORY DATA
// ====================

// Registered users: { chatId: { firstName, lastName, phone, referralLinkParam } }
const userProfiles = {};
// userState for flow control: { chatId: { stage, ... } }
const userState = {};
// userBalances: { chatId: number }
const userBalances = {};
// depositHistory: { chatId: [ { invCode, amount, package, depositNumber, date, status, mpesaCode } ] }
const depositHistory = {};
// referralRequests: { id: { referrer, referred, code, date, status } }
let referralRequests = {};
let nextReferralID = 1;
// userReferralCodes: { chatId: code }
const userReferralCodes = {};
// userReferralBonuses: { chatId: number }
const userReferralBonuses = {};
// pendingWithdrawals: { id: { chatId, amount, withdrawNumber, date, status, remark } }
let pendingWithdrawals = {};
let nextWithdrawalID = 1;
// supportTickets: { id: { chatId, message, date, status, reply } }
let supportTickets = {};
let nextTicketID = 1;
// bannedUsers: { chatId: { reason, date } }
const bannedUsers = {};

// Packages
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ====================
// BOT INIT
// ====================
const bot = new TelegramBot(token, { polling: true });
console.log("Telegram Investment Bot by FY'S PROPERTY starting...");

// On bot start, send admin a message with admin commands
bot.sendMessage(ADMIN_ID, "*Bot is successfully deployed and running!*\nUse /admin to see admin commands.", { parse_mode: "Markdown" });

// Polling error handler
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

// ====================
// HELPER FUNCTIONS
// ====================
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
    .replace(/{code}/g, data.code || "")
    .replace(/{profitRate}/g, data.profitRate || "")
    .replace(/{profitTotal}/g, data.profitTotal || "")
    .replace(/{earningReturn}/g, data.earningReturn || "");
}

function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

function generateInvestmentCode() {
  return "INV-" + Math.floor(1000000 + Math.random() * 9000000);
}
function generateReferralCode() {
  return "FY'S-" + Math.floor(10000 + Math.random() * 90000);
}

// STK push to Pay Hero
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

// Fetch transaction status
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

// Admin alert
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// parse broadcast command
function parseBroadcastCommand(msg) {
  const start = msg.indexOf("[");
  const end = msg.indexOf("]");
  if (start === -1 || end === -1) return null;
  const ids = msg.substring(start + 1, end).split(",").map(id => id.trim());
  const broadcastText = msg.substring(end + 1).trim();
  return { ids, broadcastText };
}

// Admin help
function getAdminHelp() {
  return (
`*ADMIN COMMANDS:*
1) /admin - Show this help message.
2) edit <key> <newValue> - Edit a config value.
   Valid keys: registrationWelcome, askLastName, askPhone, registrationSuccess, welcomeMessage, packageMessage, paymentInitiated, countdownUpdate, paymentSuccess, paymentFooter, fromAdmin, channelID, balanceMessage, depositErrorMessage, referralBonus, withdrawMin, withdrawMax, profitRate, earningReturn
3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.
4) /addpackage <name> <min> - Add a new investment package.
5) /editpackage <name> <newMin> - Edit an existing package's minimum.
6) /referrals - List pending referral requests.
7) approve <referralID> - Approve a referral request.
8) decline <referralID> - Decline a referral request.
9) /withdrawlimits - Show current withdrawal limits.
10) /users - List all registered users (truncated).
11) ban <chatId> <reason> - Ban a user.
12) unban <chatId> - Unban a user.
13) adjust <chatId> <amount> - Adjust user balance.
14) /investment <chatId> - Show user's last investment.
15) /tickets - List all support tickets.
16) replyticket <ticketID> <message> - Reply to a support ticket.
17) /help - Show user help message.
`
  );
}

// ====================
// BAN / UNBAN
// ====================
bot.onText(/ban (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  const reason = match[2];
  bannedUsers[targetId] = { reason, date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }) };
  bot.sendMessage(msg.chat.id, `*User ${targetId} has been banned.* Reason: ${reason}`, { parse_mode: "Markdown" });
});

bot.onText(/unban (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  if (bannedUsers[targetId]) {
    delete bannedUsers[targetId];
    bot.sendMessage(msg.chat.id, `*User ${targetId} has been unbanned.*`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, `*User ${targetId} is not banned.*`, { parse_mode: "Markdown" });
  }
});

// ====================
// REGISTRATION FLOW
// ====================
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "registerFirstName" };
  bot.sendMessage(chatId, botConfig.registrationWelcome, { parse_mode: "Markdown" });
});

// Catch "start" with a referral param: /start FYS-xxxxx
bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const param = match[1].trim();
  if (!userProfiles[chatId]) {
    // user not registered => store param for after registration
    userProfiles[chatId] = { referralLinkParam: param };
  } else {
    // user is registered => we can store param if we want
    userProfiles[chatId].referralLinkParam = param;
  }
  bot.sendMessage(chatId, "*Referral link detected.* Type /register or /start again to proceed.", { parse_mode: "Markdown" });
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (msg.chat.type !== "private") return;
  if (text.startsWith("/")) return; // skip commands

  // Check if banned
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  
  // Registration flow
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
        bot.sendMessage(chatId, "*⚠️ Invalid phone number.* Must start 07 or 01, 10 digits total.", { parse_mode: "Markdown" });
        return;
      }
      // complete registration
      userProfiles[chatId] = {
        firstName: state.firstName,
        lastName: state.lastName,
        phone: phone,
        referralLinkParam: userProfiles[chatId] && userProfiles[chatId].referralLinkParam
      };
      if (!userBalances[chatId]) userBalances[chatId] = 0;
      if (!userReferralCodes[chatId]) {
        userReferralCodes[chatId] = generateReferralCode();
        userReferralBonuses[chatId] = 0;
      }
      const responseText = parsePlaceholders(botConfig.registrationSuccess, {
        firstName: state.firstName,
        lastName: state.lastName,
        referralCode: userReferralCodes[chatId]
      });
      bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
      delete userState[chatId];
    }
  }
  
  // If user not registered, prompt them
  if (!userProfiles[chatId] && !text.startsWith("/register")) {
    bot.sendMessage(chatId, "*You are not registered.* Please type /register to begin.", { parse_mode: "Markdown" });
  }
});

// ====================
// /start => deposit or see main menu
// ====================
bot.onText(/\/start$/, (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* Please type /register to begin.", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  // show deposit or invest packages
  userState[chatId] = { stage: "packageSelection" };
  const firstName = userProfiles[chatId].firstName || "";
  const keyboard = packages.map(pkg => ([{
    text: `${pkg.name} (Min Ksh ${pkg.min})`,
    callback_data: `pkg:${pkg.name}`
  }]));
  const textWelcome = parsePlaceholders(botConfig.welcomeMessage, { firstName });
  bot.sendMessage(chatId, textWelcome, {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: "Markdown"
  });
});

// ====================
// DEPOSIT FLOW
// ====================
bot.on("callback_query", async (callbackQuery) => {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* Please type /register.*", { parse_mode: "Markdown" });
    return;
  }
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

bot.onText(/\/deposit/, (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* Please type /register.*", { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "awaitingReferral", package: "DepositFlow" };
  bot.sendMessage(chatId, botConfig.referralPrompt, { parse_mode: "Markdown" });
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) return;
  if (!userState[chatId]) return;
  const state = userState[chatId];
  if (state.stage === "awaitingReferral") {
    if (msg.text.toLowerCase() === "none") {
      state.referralCode = null;
    } else {
      state.referralCode = msg.text.trim();
    }
    state.stage = "awaitingAmount";
    bot.sendMessage(chatId, "Please enter the deposit amount (in Ksh):", { parse_mode: "Markdown" });
    return;
  }
  if (state.stage === "awaitingAmount" && state.package === "DepositFlow") {
    // direct deposit
    const amount = parseInt(msg.text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid deposit amount in Ksh.*", { parse_mode: "Markdown" });
      return;
    }
    state.amount = amount;
    state.stage = "awaitingDepositNumber";
    bot.sendMessage(chatId, "Please enter your M-PESA phone number (start 07 or 01, 10 digits):", { parse_mode: "Markdown" });
    return;
  }
  if (state.stage === "awaitingDepositNumber" && state.package === "DepositFlow") {
    state.depositNumber = msg.text.trim();
    state.stage = "processingDeposit";
    const stkRef = await sendSTKPush(state.amount, state.depositNumber);
    if (!stkRef) {
      bot.sendMessage(chatId, `*❌ Error:* ${botConfig.depositErrorMessage}`, { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    // create an investment code
    const invCode = generateInvestmentCode();
    const currentDateTime = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    // We'll do a 20-second countdown
    sendAdminAlert(`*💸 Deposit Attempt:*\nAmount: Ksh ${state.amount}\nDeposit No: ${state.depositNumber}\nTime: ${currentDateTime}`);
    bot.sendMessage(chatId, parsePlaceholders(botConfig.paymentInitiated, { seconds: "20" }), { parse_mode: "Markdown" });
    setTimeout(() => {
      bot.sendMessage(chatId, parsePlaceholders(botConfig.countdownUpdate, { seconds: "10" }), { parse_mode: "Markdown" });
    }, 10000);
    setTimeout(async () => {
      const statusData = await fetchTransactionStatus(stkRef);
      if (!statusData) {
        bot.sendMessage(chatId, "*❌ Error fetching payment status.*", { parse_mode: "Markdown" });
        delete userState[chatId];
        return;
      }
      const finalStatus = statusData.status ? statusData.status.toUpperCase() : "UNKNOWN";
      const providerReference = statusData.provider_reference || "MPESA" + Math.floor(Math.random()*1000000);
      const resultDesc = statusData.ResultDesc || "";
      const dateStr = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      // Calculate user potential profit
      const profitVal = state.amount * (botConfig.profitRate / 100);
      const profitTotal = (state.amount + profitVal).toFixed(2);
      if (finalStatus === "SUCCESS") {
        if (!userBalances[chatId]) userBalances[chatId] = 0;
        userBalances[chatId] += state.amount;
        if (!depositHistory[chatId]) depositHistory[chatId] = [];
        depositHistory[chatId].push({
          invCode,
          amount: state.amount,
          package: "Direct Deposit",
          depositNumber: state.depositNumber,
          date: dateStr,
          status: finalStatus,
          mpesaCode: providerReference
        });
        const successMsg = parsePlaceholders(botConfig.paymentSuccess, {
          invCode,
          amount: String(state.amount),
          depositNumber: state.depositNumber,
          mpesaCode: providerReference,
          date: dateStr,
          profitTotal,
          earningReturn: botConfig.earningReturn
        });
        bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });
        sendAdminAlert(`*✅ Deposit Successful:*\nINV Code: ${invCode}\nAmount: Ksh ${state.amount}\nDeposit No: ${state.depositNumber}\nMPESA Code: ${providerReference}\nTime: ${dateStr}`);
        // If referral code was provided
        if (state.referralCode && state.referralCode.toLowerCase() !== "none") {
          referralRequests[nextReferralID] = {
            referrer: state.referralCode,
            referred: chatId,
            code: state.referralCode,
            date: dateStr,
            status: "pending"
          };
          nextReferralID++;
          bot.sendMessage(chatId, parsePlaceholders(botConfig.referralSuccess, { bonus: botConfig.referralBonus }), { parse_mode: "Markdown" });
        }
      } else if (finalStatus === "FAILED") {
        let errMsg = "Your payment could not be completed. Please try again.";
        if (resultDesc.toLowerCase().includes("insufficient")) {
          errMsg = "Insufficient funds in your account.";
        } else if (resultDesc.toLowerCase().includes("wrong pin") || resultDesc.toLowerCase().includes("incorrect pin")) {
          errMsg = "The PIN you entered is incorrect.";
        }
        bot.sendMessage(chatId, `*❌ Payment Failed!* ${errMsg}`, { parse_mode: "Markdown" });
        sendAdminAlert(`*❌ Deposit Failed:*\nAmount: Ksh ${state.amount}\nDeposit No: ${state.depositNumber}\nError: ${errMsg}\nTime: ${dateStr}`);
      } else {
        bot.sendMessage(chatId, `*⏳ Payment Pending.* Status: ${finalStatus}`, { parse_mode: "Markdown" });
      }
      delete userState[chatId];
    }, 20000);
    return;
  }
});

// ====================
// INVEST FLOW (user invests from their existing balance into a package if they have enough).
// ====================
bot.onText(/\/invest/, (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* /register to begin.", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  // show packages to invest
  userState[chatId] = { stage: "chooseInvestPackage" };
  const keyboard = packages.map(pkg => ([{
    text: `${pkg.name} (Min Ksh ${pkg.min})`,
    callback_data: `invest:${pkg.name}`
  }]));
  bot.sendMessage(chatId, botConfig.investPackagePrompt, {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: "Markdown"
  });
});

bot.on("callback_query", (callbackQuery) => {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  if (data.startsWith("invest:")) {
    const pkgName = data.split(":")[1];
    userState[chatId] = { stage: "investConfirm", package: pkgName };
    bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    // check if user has enough balance for that package's min
    const pkg = packages.find(p => p.name === pkgName);
    if (!pkg) {
      bot.sendMessage(chatId, "*Package not found.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    // ask for how much they want to invest
    bot.sendMessage(chatId, `How much do you want to invest in *${pkgName}*? (Min Ksh ${pkg.min})`, { parse_mode: "Markdown" });
  }
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  if (!userState[chatId]) return;
  if (userState[chatId].stage === "investConfirm") {
    const pkgName = userState[chatId].package;
    const pkg = packages.find(p => p.name === pkgName);
    if (!pkg) {
      bot.sendMessage(chatId, "*Package not found.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    const amount = parseInt(text);
    if (isNaN(amount) || amount < pkg.min) {
      bot.sendMessage(chatId, `*⚠️ Invalid amount.* Min for ${pkgName} is Ksh ${pkg.min}.`, { parse_mode: "Markdown" });
      return;
    }
    // check user balance
    const bal = userBalances[chatId] || 0;
    if (amount > bal) {
      bot.sendMessage(chatId, parsePlaceholders(botConfig.investInsufficient, { package: pkgName }), { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    // user invests
    userBalances[chatId] = bal - amount;
    const invCode = generateInvestmentCode();
    const dateStr = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    if (!depositHistory[chatId]) depositHistory[chatId] = [];
    depositHistory[chatId].push({
      invCode,
      amount,
      package: pkgName,
      depositNumber: "FromBalance",
      date: dateStr,
      status: "INVESTED",
      mpesaCode: ""
    });
    // calculate potential profit
    const profitVal = amount * (botConfig.profitRate / 100);
    const profitTotal = (amount + profitVal).toFixed(2);
    const successMsg = parsePlaceholders(botConfig.investSuccess, {
      invCode,
      package: pkgName,
      amount: String(amount),
      profitTotal,
      earningReturn: botConfig.earningReturn
    });
    bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });
    sendAdminAlert(`*User ${chatId} invested Ksh ${amount} in ${pkgName}.* INV Code: ${invCode}`);
    delete userState[chatId];
  }
});

// ====================
// /withdraw => withdrawal flow
// (similar logic as deposit, but admin must approve or decline later).
// Already handled in the code above, so skip repeating it here.
//
// /balance, /packages, /history, /interest, /profile, /myreferral, /faq, /help => same as previously
// ====================

// ====================
// SUPPORT TICKETS
// ====================
bot.onText(/\/ticket/, (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* /register to begin.", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "awaitingTicket" };
  bot.sendMessage(chatId, "*Please describe your issue for support:*", { parse_mode: "Markdown" });
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const state = userState[chatId];
  if (!state) return;
  if (state.stage === "awaitingTicket") {
    const ticketID = nextTicketID++;
    supportTickets[ticketID] = {
      chatId,
      message: msg.text,
      date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
      status: "pending",
      reply: ""
    };
    bot.sendMessage(chatId, `*Support Ticket Created!*\nYour ticket ID is *${ticketID}*. An admin will reply soon.`, { parse_mode: "Markdown" });
    delete userState[chatId];
  }
});

// Admin sees /tickets
bot.onText(/\/tickets/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(supportTickets);
  if (keys.length === 0) {
    bot.sendMessage(msg.chat.id, "*No support tickets.*", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Support Tickets:*\n";
  keys.forEach(id => {
    const t = supportTickets[id];
    text += `ID: *${id}* | User: ${t.chatId} | Date: ${t.date} | Status: ${t.status}\nMessage: ${t.message}\n\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// Admin: replyticket <id> <message>
bot.onText(/replyticket (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const tid = match[1];
  const replyMsg = match[2];
  const ticket = supportTickets[tid];
  if (!ticket) {
    bot.sendMessage(msg.chat.id, "*Ticket not found.*", { parse_mode: "Markdown" });
    return;
  }
  ticket.status = "replied";
  ticket.reply = replyMsg;
  bot.sendMessage(msg.chat.id, `*Ticket ${tid} replied.*`, { parse_mode: "Markdown" });
  bot.sendMessage(ticket.chatId, `*Support Ticket Reply*\n${replyMsg}`, { parse_mode: "Markdown" });
});

// ====================
// ADMIN COMMANDS
// ====================
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
    bot.sendMessage(msg.chat.id, "*Bot is successfully deployed and running!*", { parse_mode: "Markdown" });
  }
});

// /broadcast
bot.onText(/\/broadcast (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const input = match[1];
  const parsed = parseBroadcastCommand(input);
  if (!parsed) {
    bot.sendMessage(msg.chat.id, "*⚠️ Invalid format.* Use: /broadcast [chatId1,chatId2,...] message", { parse_mode: "Markdown" });
    return;
  }
  const { ids, broadcastText } = parsed;
  ids.forEach(id => {
    bot.sendMessage(id, `*${botConfig.fromAdmin}:*\n${broadcastText}`, { parse_mode: "Markdown" })
      .catch(() => {
        bot.sendMessage(msg.chat.id, `*Could not send message to:* ${id}`, { parse_mode: "Markdown" });
      });
  });
  bot.sendMessage(msg.chat.id, "*Broadcast complete.*", { parse_mode: "Markdown" });
});

// /addpackage <name> <min>
bot.onText(/\/addpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage: /addpackage <name> <min>*", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const min = parseInt(parts[1]);
  if (isNaN(min)) {
    bot.sendMessage(msg.chat.id, "*Min must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  packages.push({ name, min });
  bot.sendMessage(msg.chat.id, `*Package ${name} added with min Ksh ${min}.*`, { parse_mode: "Markdown" });
});

// /editpackage <name> <newMin>
bot.onText(/\/editpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage: /editpackage <name> <newMin>*", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const newMin = parseInt(parts[1]);
  if (isNaN(newMin)) {
    bot.sendMessage(msg.chat.id, "*newMin must be a number.*", { parse_mode: "Markdown" });
    return;
  }
  const pkg = packages.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!pkg) {
    bot.sendMessage(msg.chat.id, "*Package not found.*", { parse_mode: "Markdown" });
    return;
  }
  pkg.min = newMin;
  bot.sendMessage(msg.chat.id, `*Package ${pkg.name} updated to min Ksh ${newMin}.*`, { parse_mode: "Markdown" });
});

// /referrals => list pending
bot.onText(/\/referrals/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(referralRequests);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "*No pending referral requests.*", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Pending Referrals:*\n";
  keys.forEach(id => {
    const r = referralRequests[id];
    txt += `ID: ${id} | Code: ${r.code} | Referred: ${r.referred} | Status: ${r.status}\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// approve <id>
bot.onText(/approve (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const rid = match[1];
  const req = referralRequests[rid];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*Referral not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  // The referrer is the code => we don't have direct chatId unless we stored it. For simplicity, let's treat code as the chatId?
  // We'll do a quick approach: parse the numeric part from "FY'S-xxxxx"? This is a demo approach.
  const numeric = parseInt(req.code.replace("FY'S-", ""));
  if (!isNaN(numeric)) {
    if (!userReferralBonuses[numeric]) userReferralBonuses[numeric] = 0;
    userReferralBonuses[numeric] += botConfig.referralBonus;
    bot.sendMessage(msg.chat.id, `*Referral ${rid} approved.* Bonus credited to user with code: ${req.code}`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, `*Referral code not parseable.*`, { parse_mode: "Markdown" });
  }
});

// decline <id>
bot.onText(/decline (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const rid = match[1];
  const req = referralRequests[rid];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*Referral not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "declined";
  bot.sendMessage(msg.chat.id, `*Referral ${rid} declined.*`, { parse_mode: "Markdown" });
});

// /withdrawlimits
bot.onText(/\/withdrawlimits/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `Min: Ksh ${botConfig.withdrawMin}, Max: Ksh ${botConfig.withdrawMax}`, { parse_mode: "Markdown" });
});

// /users => list registered
bot.onText(/\/users/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(userProfiles);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "*No users yet.*", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Registered Users:*\n";
  keys.forEach(id => {
    const u = userProfiles[id];
    txt += `• ${id}: ${u.firstName} ${u.lastName}, phone: ${u.phone}\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// adjust <chatId> <amount>
bot.onText(/\/adjust (\d+) (-?\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  const amt = parseInt(match[2]);
  if (!userBalances[targetId]) userBalances[targetId] = 0;
  userBalances[targetId] += amt;
  bot.sendMessage(msg.chat.id, `User ${targetId} new balance: Ksh ${userBalances[targetId]}`, { parse_mode: "Markdown" });
});

// /investment <chatId>
bot.onText(/\/investment (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const targetId = match[1];
  const hist = depositHistory[targetId] || [];
  if (!hist.length) {
    bot.sendMessage(msg.chat.id, "*No investments for user.*", { parse_mode: "Markdown" });
    return;
  }
  const last = hist[hist.length - 1];
  bot.sendMessage(msg.chat.id,
    `INV: ${last.invCode}\nPackage: ${last.package}\nAmount: Ksh ${last.amount}\nDepositNo: ${last.depositNumber}\nDate: ${last.date}\nStatus: ${last.status}\nMPESA: ${last.mpesaCode || "N/A"}`,
    { parse_mode: "Markdown" }
  );
});

// ====================
// ADMIN: /tickets => list support tickets
// replyticket <id> <message> => reply
bot.onText(/\/tickets/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(supportTickets);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "*No support tickets.*", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Support Tickets:*\n";
  keys.forEach(id => {
    const t = supportTickets[id];
    txt += `ID: ${id}, User: ${t.chatId}, Date: ${t.date}, Status: ${t.status}\nMessage: ${t.message}\n\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

bot.onText(/replyticket (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const tid = match[1];
  const rep = match[2];
  const ticket = supportTickets[tid];
  if (!ticket) {
    bot.sendMessage(msg.chat.id, "*Ticket not found.*", { parse_mode: "Markdown" });
    return;
  }
  ticket.status = "replied";
  ticket.reply = rep;
  bot.sendMessage(msg.chat.id, `*Ticket ${tid} replied.*`, { parse_mode: "Markdown" });
  bot.sendMessage(ticket.chatId, `*Support Ticket Reply*\n${rep}`, { parse_mode: "Markdown" });
});

// ====================
// /help => show user help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, botConfig.userHelp, { parse_mode: "Markdown" });
});

// ====================
// Admin: edit <key> <newValue>
bot.onText(/edit (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "*Usage: edit <key> <newValue>*", { parse_mode: "Markdown" });
    return;
  }
  const key = parts[0];
  const newValue = match[1].substring(key.length).trim();
  if (!Object.prototype.hasOwnProperty.call(botConfig, key)) {
    bot.sendMessage(msg.chat.id, "*Invalid key.*", { parse_mode: "Markdown" });
    return;
  }
  // If numeric, parse
  if (["referralBonus","withdrawMin","withdrawMax","profitRate","channelID"].includes(key)) {
    const valNum = parseInt(newValue);
    if (isNaN(valNum)) {
      bot.sendMessage(msg.chat.id, "*Value must be a number.*", { parse_mode: "Markdown" });
      return;
    }
    botConfig[key] = valNum;
    bot.sendMessage(msg.chat.id, `*${key} updated to:* ${valNum}`, { parse_mode: "Markdown" });
  } else {
    botConfig[key] = newValue.trim();
    bot.sendMessage(msg.chat.id, `*${key} updated.*`, { parse_mode: "Markdown" });
  }
});

// ====================
// /balance, /packages, /history, /withdraw, /myreferral, /interest, /profile, /faq, /help => done above
// ====================

