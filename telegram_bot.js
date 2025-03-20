"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// =====================
// BOT CONFIG & SETTINGS
// =====================
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";  // Your Bot Token
const ADMIN_ID = 5415517965;                                  // Admin's Telegram numeric ID

// Admin-editable config:
let botConfig = {
  // Registration
  registrationWelcome: "👋 *Welcome to FY'S PROPERTY Investment Bot!* \nBefore you begin, please register.\nEnter your *first name*:",
  askLastName: "Great! Now, please enter your *last name*:",
  askPhone: "Please enter your *phone number* (must start with 07 or 01 and be 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}*! Your registration is complete. Your referral code is *{referralCode}*.\nType /start to see our menu.",

  // Main menu text
  mainMenuText: "Choose an option below, *{firstName}*:",
  
  // Deposit flow
  depositIntro: "*Deposit Flow Started!* Please enter the deposit amount in Ksh:",
  depositPhonePrompt: "Now enter your M-PESA phone number (start 07 or 01):",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  depositSuccess: "*🎉 Deposit Successful!*\n*INV Code:* {invCode}\n*Amount:* Ksh {amount}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\nYou will earn Ksh {profitTotal} after the {earningReturn}.",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  depositFooter: "Thank you for investing with FY'S PROPERTY! Type /start to see menu.",

  // Investment from balance
  investPrompt: "Select a package to invest from your balance:",
  investInsufficient: "*⚠️ You do not have enough balance to invest in {package}. Please deposit first.*",
  investSuccess: "*🎉 Investment Created!*\n*INV Code:* {invCode}\nPackage: {package}\nAmount: Ksh {amount}\nYou will earn Ksh {profitTotal} after the {earningReturn}.",

  // Referral
  referralBonus: 200,  // default bonus
  referralSuccess: "Thank you for using a referral code! Your referrer will be credited upon admin approval.",

  // Balance
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",

  // Profit rate & earning return
  profitRate: 10,            // default 10%
  earningReturn: "monthly",  // default timeframe

  // Withdrawal
  withdrawPrompt: "💸 *Withdrawal Requested!* Please enter the amount to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, enter the M-PESA number (start 07 or 01, 10 digits):",
  withdrawMin: 1,
  withdrawMax: 75000,

  // Additional
  fromAdmin: "From Admin GK-FY",
  channelID: 529,
  userHelp: "Main commands:\n/start - Show main menu\n/deposit - Start deposit flow\n/balance - Check balance\n/withdraw - Request withdrawal\n/invest - Invest from balance\n/history - Show deposit history\n/myreferral - Show referral code\n/profile - Show profile\n/faq - Show FAQs\n/ticket - Support ticket\n/help - This help message"
};

// =====================
// IN-MEMORY DATA
// =====================

// userProfiles: { chatId: { firstName, lastName, phone, referralLinkParam } }
const userProfiles = {};
// userState: { chatId: { stage, ... } }
const userState = {};
// userBalances: { chatId: number }
const userBalances = {};
// depositHistory: { chatId: [ { invCode, amount, depositNumber, date, status, mpesaCode, package? } ] }
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

// =====================
// CREATE BOT
// =====================
const bot = new TelegramBot(token, { polling: true });
console.log("Bot is starting...");

// Notify admin on startup
bot.sendMessage(ADMIN_ID, "*Bot is successfully deployed and running!* Use /admin to see admin commands.", { parse_mode: "Markdown" });

// Polling error
bot.on("polling_error", (err) => console.error("Polling error:", err));

// =====================
// HELPER FUNCTIONS
// =====================
function parsePlaceholders(template, data) {
  return template
    .replace(/{firstName}/g, data.firstName || "")
    .replace(/{lastName}/g, data.lastName || "")
    .replace(/{amount}/g, data.amount || "")
    .replace(/{package}/g, data.package || "")
    .replace(/{min}/g, data.min || "")
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{seconds}/g, data.seconds || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{profitTotal}/g, data.profitTotal || "")
    .replace(/{earningReturn}/g, data.earningReturn || "")
    .replace(/{invCode}/g, data.invCode || "")
    .replace(/{balance}/g, data.balance || "")
    .replace(/{code}/g, data.code || "")
    .replace(/{bonus}/g, data.bonus || "")
    .replace(/{depositNumber}/g, data.depositNumber || "")
    .replace(/{footer}/g, botConfig.depositFooter)
    ;
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

async function sendSTKPush(amount, depositNumber) {
  const formatted = formatPhoneNumber(depositNumber);
  const payload = {
    amount,
    phone_number: formatted,
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
    const resp = await axios.post("https://backend.payhero.co.ke/api/v2/payments", payload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=="
      }
    });
    return resp.data.reference;
  } catch (error) {
    console.error("STK Push Error:", error.response ? error.response.data : error);
    return null;
  }
}

async function fetchTransactionStatus(ref) {
  try {
    const resp = await axios.get(`https://backend.payhero.co.ke/api/v2/transaction-status?reference=${encodeURIComponent(ref)}`, {
      headers: {
        "Authorization": "Basic QklYOXY0WlR4RUV4ZUJSOG1EdDY6c2lYb09taHRYSlFMbWZ0dFdqeGp4SG13NDFTekJLckl2Z2NWd2F1aw=="
      }
    });
    return resp.data;
  } catch (error) {
    console.error("Status Fetch Error:", error.response ? error.response.data : error);
    return null;
  }
}

function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

function getAdminHelp() {
  return (
`*ADMIN COMMANDS:*
1) /admin - Show this help message.
2) edit <key> <newValue> - Edit a config value.
   Valid keys: registrationWelcome, askLastName, askPhone, registrationSuccess, mainMenuText, depositIntro, depositPhonePrompt, depositErrorMessage, depositFooter, paymentInitiated, countdownUpdate, depositSuccess, fromAdmin, channelID, balanceMessage, referralBonus, withdrawMin, withdrawMax, profitRate, earningReturn
3) /broadcast [chatId1,chatId2,...] Your message
4) /addpackage <name> <min>
5) /editpackage <name> <newMin>
6) /referrals - List pending referrals
7) approve <id> or decline <id>
8) /withdrawlimits - Show withdrawal limits
9) /users - List registered users
10) ban <chatId> <reason>, unban <chatId>
11) adjust <chatId> <amount> - Add/deduct user balance
12) /investment <chatId> - Show last investment
13) /tickets - List support tickets
14) replyticket <id> <message> - reply to ticket
15) /help - Show user help
`
  );
}

// ====================
// BAN / UNBAN
bot.onText(/ban (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const userId = match[1];
  const reason = match[2];
  bannedUsers[userId] = { reason, date: new Date().toLocaleString() };
  bot.sendMessage(msg.chat.id, `*User ${userId} banned.* Reason: ${reason}`, { parse_mode: "Markdown" });
});

bot.onText(/unban (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const userId = match[1];
  if (bannedUsers[userId]) {
    delete bannedUsers[userId];
    bot.sendMessage(msg.chat.id, `*User ${userId} unbanned.*`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, `*User ${userId} is not banned.*`, { parse_mode: "Markdown" });
  }
});

// ====================
// REGISTRATION
// ====================
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "regFirstName" };
  bot.sendMessage(chatId, botConfig.registrationWelcome, { parse_mode: "Markdown" });
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (msg.text && msg.text.startsWith("/")) return; // skip commands
  if (!userState[chatId]) return;
  const state = userState[chatId];
  if (state.stage === "regFirstName") {
    state.firstName = msg.text.trim();
    state.stage = "regLastName";
    bot.sendMessage(chatId, botConfig.askLastName, { parse_mode: "Markdown" });
    return;
  }
  if (state.stage === "regLastName") {
    state.lastName = msg.text.trim();
    state.stage = "regPhone";
    bot.sendMessage(chatId, botConfig.askPhone, { parse_mode: "Markdown" });
    return;
  }
  if (state.stage === "regPhone") {
    const phone = msg.text.trim();
    if (!/^(07|01)\d{8}$/.test(phone)) {
      bot.sendMessage(chatId, "*Invalid phone.* Must start 07 or 01, 10 digits total.", { parse_mode: "Markdown" });
      return;
    }
    // done
    userProfiles[chatId] = {
      firstName: state.firstName,
      lastName: state.lastName,
      phone: phone
    };
    userBalances[chatId] = userBalances[chatId] || 0;
    if (!userReferralCodes[chatId]) {
      userReferralCodes[chatId] = generateReferralCode();
      userReferralBonuses[chatId] = 0;
    }
    const response = parsePlaceholders(botConfig.registrationSuccess, {
      firstName: state.firstName,
      lastName: state.lastName,
      referralCode: userReferralCodes[chatId]
    });
    bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
    delete userState[chatId];
  }
});

// If user not registered, prompt
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId] && !msg.text.startsWith("/register")) {
    bot.sendMessage(chatId, "*You are not registered.* Type /register to begin.", { parse_mode: "Markdown" });
  }
});

// ====================
// MAIN MENU
// ====================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* Type /register first.", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  const firstName = userProfiles[chatId].firstName || "";
  // Show a menu with 8 items: More money, Top players, Referral bonus, Profile, HASH exchange, Withdrawals, Stats, Promo codes
  const keyboard = [
    [{text: "More money", callback_data: "menu:moreMoney"}, {text: "Top players", callback_data: "menu:topPlayers"}],
    [{text: "Referral bonus", callback_data: "menu:referralBonus"}, {text: "Profile", callback_data: "menu:profile"}],
    [{text: "HASH exchange", callback_data: "menu:hash"}, {text: "Withdrawals", callback_data: "menu:withdraw"}],
    [{text: "Stats", callback_data: "menu:stats"}, {text: "Promo codes", callback_data: "menu:promo"}]
  ];
  const text = parsePlaceholders(botConfig.mainMenuText, { firstName });
  bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: "Markdown"
  });
});

// Handle the main menu button clicks
bot.on("callback_query", async (callbackQuery) => {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* /register", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  await bot.answerCallbackQuery(callbackQuery.id).catch(()=>{});

  switch(data) {
    case "menu:moreMoney":
      // deposit flow
      userState[chatId] = { stage: "awaitingDepositAmount" };
      bot.sendMessage(chatId, botConfig.depositIntro, { parse_mode: "Markdown" });
      break;
    case "menu:topPlayers":
      // For demo, show top depositors
      let topText = "*Top players (by deposit)*:\n";
      let arr = Object.keys(depositHistory).map(id => {
        const sum = depositHistory[id] ? depositHistory[id].reduce((acc, r) => acc + r.amount, 0) : 0;
        return {id, sum};
      });
      arr.sort((a,b) => b.sum - a.sum);
      arr.slice(0,5).forEach((u, i) => {
        topText += `${i+1}. User ${u.id} => Ksh ${u.sum}\n`;
      });
      bot.sendMessage(chatId, topText, { parse_mode: "Markdown" });
      break;
    case "menu:referralBonus":
      // show user referral code
      if (!userReferralCodes[chatId]) {
        userReferralCodes[chatId] = generateReferralCode();
        userReferralBonuses[chatId] = 0;
      }
      const code = userReferralCodes[chatId];
      const bonus = userReferralBonuses[chatId] || 0;
      bot.sendMessage(chatId, `*Your referral code:* ${code}\nReferral bonus: Ksh ${bonus}\nLink: https://t.me/${botConfig.fromAdmin}?start=${code}`, { parse_mode: "Markdown" });
      break;
    case "menu:profile":
      // show user profile
      const prof = userProfiles[chatId];
      const bal = userBalances[chatId] || 0;
      let depoCount = 0;
      if (depositHistory[chatId]) depoCount = depositHistory[chatId].length;
      bot.sendMessage(chatId, `*Profile*\nName: ${prof.firstName} ${prof.lastName}\nPhone: ${prof.phone}\nBalance: Ksh ${bal}\nInvestments: ${depoCount}`, { parse_mode: "Markdown" });
      break;
    case "menu:hash":
      // For demo
      bot.sendMessage(chatId, "*HASH exchange is under construction.*", { parse_mode: "Markdown" });
      break;
    case "menu:withdraw":
      // user wants to withdraw
      userState[chatId] = { stage: "awaitingWithdrawAmount" };
      bot.sendMessage(chatId, parsePlaceholders(botConfig.withdrawPrompt, {min: botConfig.withdrawMin, max: botConfig.withdrawMax}), { parse_mode: "Markdown" });
      break;
    case "menu:stats":
      // Show some stats
      let totalDeposits = 0;
      Object.values(depositHistory).forEach(arr => {
        arr.forEach(r => { totalDeposits += r.amount; });
      });
      let userCount = Object.keys(userProfiles).length;
      bot.sendMessage(chatId, `*Stats*\nTotal registered users: ${userCount}\nTotal deposit volume: Ksh ${totalDeposits}`, { parse_mode: "Markdown" });
      break;
    case "menu:promo":
      // user can input a promo code
      bot.sendMessage(chatId, "*Promo codes coming soon.*", { parse_mode: "Markdown" });
      break;
    default:
      bot.sendMessage(chatId, "*Unknown menu option.*", { parse_mode: "Markdown" });
  }
});

// Deposit flow from main menu
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!userState[chatId]) return;
  if (!userProfiles[chatId]) return;
  const state = userState[chatId];
  if (state.stage === "awaitingDepositAmount") {
    const amount = parseInt(msg.text);
    if (isNaN(amount) || amount <= 0) {
      bot.sendMessage(chatId, "*⚠️ Invalid deposit amount.*", { parse_mode: "Markdown" });
      return;
    }
    state.amount = amount;
    state.stage = "awaitingDepositPhone";
    bot.sendMessage(chatId, botConfig.depositPhonePrompt, { parse_mode: "Markdown" });
    return;
  }
  if (state.stage === "awaitingDepositPhone") {
    state.depositNumber = msg.text.trim();
    state.stage = "processingDeposit";
    const ref = await sendSTKPush(state.amount, state.depositNumber);
    if (!ref) {
      bot.sendMessage(chatId, `*❌ Error:* ${botConfig.depositErrorMessage}`, { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    const dateStr = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    const invCode = generateInvestmentCode();
    bot.sendMessage(chatId, parsePlaceholders(botConfig.paymentInitiated, { seconds: "20" }), { parse_mode: "Markdown" });
    setTimeout(() => {
      bot.sendMessage(chatId, parsePlaceholders(botConfig.countdownUpdate, { seconds: "10" }), { parse_mode: "Markdown" });
    }, 10000);
    setTimeout(async () => {
      const st = await fetchTransactionStatus(ref);
      if (!st) {
        bot.sendMessage(chatId, "*❌ Error fetching status.*", { parse_mode: "Markdown" });
        delete userState[chatId];
        return;
      }
      const finalStatus = st.status ? st.status.toUpperCase() : "UNKNOWN";
      const mpesaCode = st.provider_reference || "MPESA" + Math.floor(Math.random()*100000);
      const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      // calc potential profit
      const profitVal = state.amount * (botConfig.profitRate / 100);
      const profitTotal = (state.amount + profitVal).toFixed(2);
      if (finalStatus === "SUCCESS") {
        if (!userBalances[chatId]) userBalances[chatId] = 0;
        userBalances[chatId] += state.amount;
        if (!depositHistory[chatId]) depositHistory[chatId] = [];
        depositHistory[chatId].push({
          invCode,
          amount: state.amount,
          depositNumber: state.depositNumber,
          date: dateNow,
          status: "SUCCESS",
          mpesaCode
        });
        const successTxt = parsePlaceholders(botConfig.depositSuccess, {
          invCode,
          amount: String(state.amount),
          mpesaCode,
          date: dateNow,
          profitTotal,
          earningReturn: botConfig.earningReturn
        });
        bot.sendMessage(chatId, successTxt, { parse_mode: "Markdown" });
        sendAdminAlert(`*✅ Deposit:* Ksh ${state.amount}\nINV Code: ${invCode}\nUser: ${chatId}\nTime: ${dateNow}`);
      } else {
        bot.sendMessage(chatId, "*❌ Payment failed or pending.*", { parse_mode: "Markdown" });
        sendAdminAlert(`*❌ Deposit Failed:* Ksh ${state.amount}\nUser: ${chatId}\nTime: ${dateNow}`);
      }
      delete userState[chatId];
    }, 20000);
  }
});

// ====================
// WITHDRAWAL FLOW
// ====================
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) return;
  if (!userState[chatId]) return;
  const state = userState[chatId];
  if (state.stage === "awaitingWithdrawAmount") {
    const amt = parseInt(msg.text);
    if (isNaN(amt) || amt < botConfig.withdrawMin || amt > botConfig.withdrawMax) {
      bot.sendMessage(chatId, `*⚠️ Invalid withdrawal amount.* Must be between Ksh ${botConfig.withdrawMin} and ${botConfig.withdrawMax}.`, { parse_mode: "Markdown" });
      return;
    }
    state.withdrawAmount = amt;
    state.stage = "awaitingWithdrawNumber";
    bot.sendMessage(chatId, botConfig.askWithdrawNumber, { parse_mode: "Markdown" });
  } else if (state.stage === "awaitingWithdrawNumber") {
    const num = msg.text.trim();
    if (!/^(07|01)\d{8}$/.test(num)) {
      bot.sendMessage(chatId, "*⚠️ Invalid M-PESA number.* Must start 07 or 01, 10 digits total.", { parse_mode: "Markdown" });
      return;
    }
    const bal = userBalances[chatId] || 0;
    if (state.withdrawAmount > bal) {
      bot.sendMessage(chatId, "*⚠️ Insufficient funds for withdrawal.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    // create pending withdrawal
    const wid = nextWithdrawalID++;
    pendingWithdrawals[wid] = {
      chatId,
      amount: state.withdrawAmount,
      withdrawNumber: num,
      date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
      status: "pending",
      remark: ""
    };
    userBalances[chatId] = bal - state.withdrawAmount; // hold the money
    bot.sendMessage(chatId, `*Withdrawal request of Ksh ${state.withdrawAmount} created.* Pending admin approval.`, { parse_mode: "Markdown" });
    delete userState[chatId];
  }
});

// ====================
// Additional user commands: /balance, /packages, /history, /myreferral, /interest, /profile, /faq, /help, /ticket
// (Similar to the previous code; implement as you see fit or keep them short.)
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  const bal = userBalances[chatId] || 0;
  bot.sendMessage(chatId, parsePlaceholders(botConfig.balanceMessage, { balance: String(bal) }), { parse_mode: "Markdown" });
});

bot.onText(/\/packages/, (msg) => {
  const chatId = msg.chat.id;
  let txt = "*Available Packages:*\n";
  packages.forEach(p => {
    txt += `• ${p.name}: min Ksh ${p.min}\n`;
  });
  bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
});

bot.onText(/\/history/, (msg) => {
  const chatId = msg.chat.id;
  const hist = depositHistory[chatId] || [];
  if (!hist.length) {
    bot.sendMessage(chatId, "*No deposit history.*", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Your Deposit History:*\n";
  hist.forEach((r,i) => {
    txt += `${i+1}. INV: ${r.invCode} | Amount: ${r.amount} | MPESA: ${r.mpesaCode || "N/A"} | Date: ${r.date}\n`;
  });
  bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
});

bot.onText(/\/myreferral/, (msg) => {
  const chatId = msg.chat.id;
  if (!userReferralCodes[chatId]) {
    userReferralCodes[chatId] = generateReferralCode();
    userReferralBonuses[chatId] = 0;
  }
  const code = userReferralCodes[chatId];
  const bonus = userReferralBonuses[chatId] || 0;
  const botUsername = botConfig.fromAdmin; // or store actual bot username
  bot.sendMessage(chatId, `*Your referral code:* ${code}\nBonus: Ksh ${bonus}\nLink: https://t.me/${botUsername}?start=${code}`, { parse_mode: "Markdown" });
});

bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  const bal = userBalances[chatId] || 0;
  const interest = (bal * 0.05).toFixed(2);
  bot.sendMessage(chatId, `*Estimated monthly interest on your current balance:* Ksh ${interest}`, { parse_mode: "Markdown" });
});

bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  const prof = userProfiles[chatId] || {};
  const bal = userBalances[chatId] || 0;
  let count = depositHistory[chatId] ? depositHistory[chatId].length : 0;
  bot.sendMessage(chatId, `*Profile*\nName: ${prof.firstName||"N/A"} ${prof.lastName||""}\nPhone: ${prof.phone||"N/A"}\nBalance: Ksh ${bal}\nDeposits: ${count}`, { parse_mode: "Markdown" });
});

bot.onText(/\/faq/, (msg) => {
  bot.sendMessage(msg.chat.id, "*FAQ coming soon.*", { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, botConfig.userHelp, { parse_mode: "Markdown" });
});

// Support ticket
bot.onText(/\/ticket/, (msg) => {
  const chatId = msg.chat.id;
  userState[chatId] = { stage: "awaitingTicket" };
  bot.sendMessage(chatId, "*Please describe your issue:*", { parse_mode: "Markdown" });
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!userState[chatId]) return;
  if (userState[chatId].stage === "awaitingTicket") {
    const tid = nextTicketID++;
    supportTickets[tid] = {
      chatId,
      message: msg.text,
      date: new Date().toLocaleString(),
      status: "pending",
      reply: ""
    };
    bot.sendMessage(chatId, `*Ticket created!* ID: ${tid}`, { parse_mode: "Markdown" });
    delete userState[chatId];
  }
});

// Admin: /tickets
bot.onText(/\/tickets/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(supportTickets);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "*No tickets.*", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Support Tickets:*\n";
  keys.forEach(id => {
    const t = supportTickets[id];
    txt += `ID: ${id}, user: ${t.chatId}, date: ${t.date}, status: ${t.status}\nMessage: ${t.message}\n\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// Admin: replyticket <id> <message>
bot.onText(/replyticket (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const tid = match[1];
  const rmsg = match[2];
  const ticket = supportTickets[tid];
  if (!ticket) {
    bot.sendMessage(msg.chat.id, "*Ticket not found.*", { parse_mode: "Markdown" });
    return;
  }
  ticket.status = "replied";
  ticket.reply = rmsg;
  bot.sendMessage(msg.chat.id, `*Ticket ${tid} replied.*`, { parse_mode: "Markdown" });
  bot.sendMessage(ticket.chatId, `*Support Ticket Reply*\n${rmsg}`, { parse_mode: "Markdown" });
});

// ====================
// ADMIN: /admin => help
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
    bot.sendMessage(msg.chat.id, "*Bot is successfully deployed and running!*", { parse_mode: "Markdown" });
  }
});

// /broadcast
bot.onText(/\/broadcast (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parsed = parseBroadcastCommand(match[1]);
  if (!parsed) {
    bot.sendMessage(msg.chat.id, "*Invalid format.*", { parse_mode: "Markdown" });
    return;
  }
  const { ids, broadcastText } = parsed;
  ids.forEach(id => {
    bot.sendMessage(id, `*${botConfig.fromAdmin}:*\n${broadcastText}`, { parse_mode: "Markdown" })
      .catch(()=> bot.sendMessage(msg.chat.id, `Could not message ${id}`, { parse_mode: "Markdown" }));
  });
  bot.sendMessage(msg.chat.id, "*Broadcast complete.*", { parse_mode: "Markdown" });
});

// /addpackage <name> <min>
bot.onText(/\/addpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length<2) {
    bot.sendMessage(msg.chat.id, "*Usage: /addpackage <name> <min>*", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const min = parseInt(parts[1]);
  if (isNaN(min)) {
    bot.sendMessage(msg.chat.id, "*min must be number.*", { parse_mode: "Markdown" });
    return;
  }
  packages.push({ name, min });
  bot.sendMessage(msg.chat.id, `*Package ${name} added.*`, { parse_mode: "Markdown" });
});

// /editpackage <name> <newMin>
bot.onText(/\/editpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length<2) {
    bot.sendMessage(msg.chat.id, "*Usage: /editpackage <name> <newMin>*", { parse_mode: "Markdown" });
    return;
  }
  const name = parts[0];
  const newMin = parseInt(parts[1]);
  const pkg = packages.find(p => p.name.toLowerCase()===name.toLowerCase());
  if (!pkg) {
    bot.sendMessage(msg.chat.id, "*Package not found.*", { parse_mode: "Markdown" });
    return;
  }
  pkg.min = newMin;
  bot.sendMessage(msg.chat.id, `*Package ${pkg.name} updated to min Ksh ${newMin}.*`, { parse_mode: "Markdown" });
});

// /referrals => list pending
bot.onText(/\/referrals/, (msg) => {
  if (msg.from.id!==ADMIN_ID) return;
  const keys = Object.keys(referralRequests);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "*No pending referrals.*", { parse_mode: "Markdown" });
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
  if (msg.from.id!==ADMIN_ID) return;
  const rid = match[1];
  const rr = referralRequests[rid];
  if (!rr) {
    bot.sendMessage(msg.chat.id, "*Referral not found.*", { parse_mode: "Markdown" });
    return;
  }
  rr.status = "approved";
  // parse code to get numeric? For demo:
  const numeric = parseInt(rr.code.replace("FY'S-",""));
  if (!isNaN(numeric)) {
    if (!userReferralBonuses[numeric]) userReferralBonuses[numeric] = 0;
    userReferralBonuses[numeric] += botConfig.referralBonus;
    bot.sendMessage(msg.chat.id, `*Referral ${rid} approved.* Bonus to user code: ${rr.code}`, { parse_mode: "Markdown" });
  }
});

// decline <id>
bot.onText(/decline (\d+)/, (msg, match) => {
  if (msg.from.id!==ADMIN_ID) return;
  const rid = match[1];
  const rr = referralRequests[rid];
  if (!rr) {
    bot.sendMessage(msg.chat.id, "*Referral not found.*", { parse_mode: "Markdown" });
    return;
  }
  rr.status="declined";
  bot.sendMessage(msg.chat.id, `*Referral ${rid} declined.*`, { parse_mode: "Markdown" });
});

// /withdrawlimits
bot.onText(/\/withdrawlimits/, (msg) => {
  if (msg.from.id!==ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `Min: ${botConfig.withdrawMin}, Max: ${botConfig.withdrawMax}`, { parse_mode: "Markdown" });
});

// /users => list
bot.onText(/\/users/, (msg) => {
  if (msg.from.id!==ADMIN_ID) return;
  const keys = Object.keys(userProfiles);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "*No users.*", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Registered Users:*\n";
  keys.forEach(id => {
    const up = userProfiles[id];
    txt += `• ${id}: ${up.firstName} ${up.lastName}, phone: ${up.phone}\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// /adjust <chatId> <amount>
bot.onText(/\/adjust (\d+) (-?\d+)/, (msg, match) => {
  if (msg.from.id!==ADMIN_ID) return;
  const uid = match[1];
  const amt = parseInt(match[2]);
  if (!userBalances[uid]) userBalances[uid] = 0;
  userBalances[uid] += amt;
  bot.sendMessage(msg.chat.id, `User ${uid} new balance: Ksh ${userBalances[uid]}`, { parse_mode: "Markdown" });
});

// /investment <chatId>
bot.onText(/\/investment (\d+)/, (msg, match) => {
  if (msg.from.id!==ADMIN_ID) return;
  const uid = match[1];
  const hist = depositHistory[uid] || [];
  if (!hist.length) {
    bot.sendMessage(msg.chat.id, "*No investments found.*", { parse_mode: "Markdown" });
    return;
  }
  const last = hist[hist.length-1];
  bot.sendMessage(msg.chat.id, `INV: ${last.invCode}\nAmount: Ksh ${last.amount}\nDepositNo: ${last.depositNumber}\nDate: ${last.date}\nStatus: ${last.status}\nMPESA: ${last.mpesaCode||"N/A"}`, { parse_mode: "Markdown" });
});

// /tickets => list tickets
bot.onText(/\/tickets/, (msg) => {
  if (msg.from.id!==ADMIN_ID) return;
  const keys = Object.keys(supportTickets);
  if(!keys.length) {
    bot.sendMessage(msg.chat.id, "*No support tickets.*", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Support Tickets:*\n";
  keys.forEach(id => {
    const t = supportTickets[id];
    txt += `ID: ${id}, user: ${t.chatId}, date: ${t.date}, status: ${t.status}\nMessage: ${t.message}\n\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// replyticket <id> <message>
bot.onText(/replyticket (\d+) (.+)/, (msg, match) => {
  if (msg.from.id!==ADMIN_ID) return;
  const tid = match[1];
  const rmsg = match[2];
  const t = supportTickets[tid];
  if(!t) {
    bot.sendMessage(msg.chat.id, "*Ticket not found.*", { parse_mode: "Markdown" });
    return;
  }
  t.status="replied";
  t.reply=rmsg;
  bot.sendMessage(msg.chat.id, `Ticket ${tid} replied.`, { parse_mode: "Markdown" });
  bot.sendMessage(t.chatId, `*Support Ticket Reply*\n${rmsg}`, { parse_mode: "Markdown" });
});

// /admin => help
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id===ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
    bot.sendMessage(msg.chat.id, "*Bot is successfully deployed and running!*", { parse_mode: "Markdown" });
  }
});

// edit <key> <newValue>
bot.onText(/edit (.+)/, (msg, match) => {
  if (msg.from.id!==ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length<2) {
    bot.sendMessage(msg.chat.id, "*Usage: edit <key> <newValue>*", { parse_mode: "Markdown" });
    return;
  }
  const key = parts[0];
  const newValue = match[1].substring(key.length).trim();
  if(!Object.prototype.hasOwnProperty.call(botConfig, key)) {
    bot.sendMessage(msg.chat.id, "*Invalid key.*", { parse_mode: "Markdown" });
    return;
  }
  if(["referralBonus","withdrawMin","withdrawMax","profitRate","channelID"].includes(key)) {
    const valNum = parseInt(newValue);
    if(isNaN(valNum)) {
      bot.sendMessage(msg.chat.id, "*Value must be a number.*", { parse_mode: "Markdown" });
      return;
    }
    botConfig[key] = valNum;
    bot.sendMessage(msg.chat.id, `*${key} updated to:* ${valNum}`, { parse_mode: "Markdown" });
  } else {
    botConfig[key] = newValue;
    bot.sendMessage(msg.chat.id, `*${key} updated.*`, { parse_mode: "Markdown" });
  }
});
