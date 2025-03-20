"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ====================
// CONFIGURATION
// ====================
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw"; // Your Bot Token
const ADMIN_ID = 5415517965; // Admin's Telegram ID

// Maintenance mode settings
let maintenanceMode = false;
let maintenanceMessage = "⚙️ The system is under maintenance. Please try again later.";

// Editable settings (admin can change these via /edit)
let botConfig = {
  // Registration texts
  registrationWelcome: "👋 *Welcome to FYS_PROPERTY Investment Bot!* \nBefore you begin, please register.\nEnter your *first name*:",
  askLastName: "Great! Now, please enter your *last name*:",
  askPhone: "Please enter your *phone number* (must start with 07 or 01, 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}*! Your registration is complete. Your referral code is *{referralCode}*.\nType /start to see our menu.",

  // Main menu text
  mainMenuText: "Hello, *{firstName}*! Please select an option below:",

  // Deposit flow (for adding funds)
  depositIntro: "💰 *Deposit Flow Started!* Please enter the deposit amount in Ksh:",
  depositPhonePrompt: "📱 Now enter your M-PESA phone number (start with 07 or 01):",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  depositSuccess: "*🎉 Deposit Successful!*\n*INV Code:* {invCode}\n*Amount:* Ksh {amount}\n*Phone:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  depositFooter: "Thank you for using FYS_PROPERTY! Type /start to see the menu.",

  // Invest (auto‑invest via Mining)
  investPrompt: "⛏️ Select a package to invest automatically from your balance:",
  investInsufficient: "*⚠️ You do not have enough balance to invest in {package}. Please deposit first.*",
  investSuccess: "*🎉 Investment Created!*\n*INV Code:* {invCode}\nPackage: {package}\nAmount: Ksh {amount}",

  // Referral: shows referral code and link
  referralBonus: 200,
  botUsername: "shankfy_bot", // for referral link

  // Balance message
  balanceMessage: "*💵 Your current balance is:* Ksh {balance}",

  // Withdrawal flow (6% fee applies)
  withdrawPrompt: "💸 *Withdrawal Requested!* Please enter the amount to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, enter your M-PESA number (start with 07 or 01, 10 digits):",
  withdrawMin: 1,
  withdrawMax: 75000,
  withdrawalFeePercent: 6,

  // Admin
  fromAdmin: "shankfy_bot",

  // User help message
  userHelp: "Main commands:\n/start - Show main menu\n/deposit - Deposit funds\n/balance - Check balance\n/withdraw - Request withdrawal\n/invest - Invest from balance\n/history - View your activities\n/myreferral - View your referral code & link\n/profile - View your profile\n/faq - FAQs\n/ticket - Support ticket\n/inspire - Get inspired\n/feedback - Send feedback\n/about - About this bot\n/uptime - Bot uptime"
};

// ====================
// EXTRA FEATURES (Quotes, etc.)
// ====================
const motivationalQuotes = [
  "Believe you can and you're halfway there. – Theodore Roosevelt",
  "Your limitation—it’s only your imagination.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream it. Wish it. Do it."
];

let adminLog = []; // Array to store admin logs
const botStartTime = Date.now();

// ====================
// IN-MEMORY DATA STORAGE
// ====================
const userProfiles = {};         // { chatId: { firstName, lastName, phone } }
const userState = {};            // { chatId: { stage, ... } }
const userBalances = {};         // { chatId: number }
const depositHistory = {};       // { chatId: [ { invCode, amount, depositNumber, date, status, mpesaCode, package? } ] }
let referralRequests = {};       // { id: { referrer, referred, code, date, status } }
let nextReferralID = 1;
const userReferralCodes = {};    // { chatId: code }
const userReferralBonuses = {};  // { chatId: number }
let pendingWithdrawals = {};     // { id: { chatId, requestedAmount, fee, finalAmount, withdrawNumber, date, status, remark } }
let nextWithdrawalID = 1;
let supportTickets = {};         // { id: { chatId, message, date, status, reply } }
let nextTicketID = 1;
const bannedUsers = {};          // { chatId: { reason, date } }

// Investment packages
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ====================
// CREATE THE BOT
// ====================
const bot = new TelegramBot(token, { polling: true });
console.log("FYS_PROPERTY Bot is starting...");

// ====================
// MAINTENANCE CHECK
// ====================
function maintenanceCheck(chatId, callback) {
  if (maintenanceMode && chatId !== ADMIN_ID) {
    bot.sendMessage(chatId, maintenanceMessage, { parse_mode: "Markdown" });
    return;
  }
  callback();
}

// ====================
// ADMIN LOGGING FUNCTION
// ====================
function logAdmin(message) {
  const timeStr = new Date().toLocaleString();
  const logEntry = `[${timeStr}] ${message}`;
  adminLog.push(logEntry);
  sendAdminAlert(logEntry);
}

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
    .replace(/{mpesaCode}/g, data.mpesaCode || "")
    .replace(/{seconds}/g, data.seconds || "")
    .replace(/{date}/g, data.date || "")
    .replace(/{invCode}/g, data.invCode || "")
    .replace(/{balance}/g, data.balance || "")
    .replace(/{code}/g, data.code || "")
    .replace(/{bonus}/g, data.bonus || "")
    .replace(/{depositNumber}/g, data.depositNumber || "")
    .replace(/{footer}/g, botConfig.depositFooter);
}

function isRegistered(chatId) {
  if (chatId === ADMIN_ID) return true;
  return !!userProfiles[chatId];
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

// ====================
// STK PUSH (Deposit)
// ====================
async function sendSTKPush(amount, depositNumber) {
  const formatted = formatPhoneNumber(depositNumber);
  const payload = {
    amount,
    phone_number: formatted,
    channel_id: 529,
    provider: "m-pesa",
    external_reference: "INV-009",
    customer_name: "User",
    callback_url: "https://img-2-url.html-5.me/cl.php",
    account_reference: "FYS_PROPERTY",
    transaction_desc: "Payment",
    remarks: "FYS_PROPERTY",
    business_name: "FYS_PROPERTY",
    companyName: "FYS_PROPERTY"
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

// ====================
// EXTRA FEATURES
// ====================

// Uptime command – /uptime
function getUptime() {
  const diff = Date.now() - botStartTime;
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / (1000 * 60)) % 60;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return `${hours}h ${minutes}m ${seconds}s`;
}

// Inspirational quote – /inspire
function getRandomQuote() {
  return motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
}

// About command – /about
function getAbout() {
  return "FYS_PROPERTY Investment Bot v1.0\nDeveloped by FY'S PROPERTY 🕊️\nEnjoy our services!";
}

// Leaderboard – /leaderboard: top 5 users by deposit volume
function getLeaderboard() {
  let leaderboard = [];
  for (let uid in depositHistory) {
    const total = depositHistory[uid].reduce((sum, rec) => sum + rec.amount, 0);
    leaderboard.push({ uid, total });
  }
  leaderboard.sort((a, b) => b.total - a.total);
  return leaderboard.slice(0, 5);
}

// ====================
// ADMIN LOGGING
// ====================
function logAdmin(message) {
  const timeStr = new Date().toLocaleString();
  const entry = `[${timeStr}] ${message}`;
  adminLog.push(entry);
  sendAdminAlert(entry);
}

// ====================
// MAINTENANCE MODE COMMANDS (Admin Only)
// ====================
bot.onText(/\/maintenance (on|off)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  maintenanceMode = (match[1] === "on");
  bot.sendMessage(ADMIN_ID, `Maintenance mode turned ${maintenanceMode ? "ON" : "OFF"}.`, { parse_mode: "Markdown" });
});

bot.onText(/\/maintenanceMsg (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  maintenanceMessage = match[1];
  bot.sendMessage(ADMIN_ID, `Maintenance message updated to: ${maintenanceMessage}`, { parse_mode: "Markdown" });
});

// ====================
// AUTO-REPLY: if user sends "hello"
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (typeof msg.text !== "string") return;
  if (/^hello$/i.test(msg.text.trim()) && isRegistered(chatId) && !maintenanceMode) {
    bot.sendMessage(chatId, "Hi there! How can I help you today? 😊", { parse_mode: "Markdown" });
  }
});

// ====================
// FEEDBACK COMMAND (/feedback)
// ====================
bot.onText(/\/feedback (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  const feedback = match[1];
  bot.sendMessage(chatId, "Thank you for your feedback! 🙏", { parse_mode: "Markdown" });
  sendAdminAlert(`Feedback from ${chatId}: ${feedback}`);
});

// ====================
// Uptime, Inspire, About, Leaderboard Commands
// ====================
bot.onText(/\/uptime/, (msg) => {
  bot.sendMessage(msg.chat.id, `Bot uptime: ${getUptime()}`, { parse_mode: "Markdown" });
});

bot.onText(/\/inspire/, (msg) => {
  bot.sendMessage(msg.chat.id, `💡 *Inspirational Quote:*\n${getRandomQuote()}`, { parse_mode: "Markdown" });
});

bot.onText(/\/about/, (msg) => {
  bot.sendMessage(msg.chat.id, getAbout(), { parse_mode: "Markdown" });
});

bot.onText(/\/leaderboard/, (msg) => {
  const lb = getLeaderboard();
  if (!lb.length) {
    bot.sendMessage(msg.chat.id, "No deposits yet.", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Leaderboard (Top Depositors):*\n";
  lb.forEach((entry, idx) => {
    text += `${idx + 1}. User ${entry.uid} - Ksh ${entry.total}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ====================
// ADMIN DATA COMMANDS
// ====================
bot.onText(/\/adminlog/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const logText = adminLog.slice(-10).join("\n");
  bot.sendMessage(ADMIN_ID, `*Admin Log (last 10 entries):*\n${logText}`, { parse_mode: "Markdown" });
});

bot.onText(/\/resetdata/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  Object.keys(userProfiles).forEach(key => delete userProfiles[key]);
  Object.keys(userBalances).forEach(key => delete userBalances[key]);
  Object.keys(depositHistory).forEach(key => delete depositHistory[key]);
  Object.keys(userReferralCodes).forEach(key => delete userReferralCodes[key]);
  Object.keys(userReferralBonuses).forEach(key => delete userReferralBonuses[key]);
  bot.sendMessage(ADMIN_ID, "All user data has been reset.", { parse_mode: "Markdown" });
  logAdmin("System data reset by admin.");
});

bot.onText(/\/clearhistory (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const uid = match[1];
  delete depositHistory[uid];
  bot.sendMessage(ADMIN_ID, `Deposit/investment history for user ${uid} cleared.`, { parse_mode: "Markdown" });
  logAdmin(`Deposit history for user ${uid} cleared.`);
});

bot.onText(/\/exportdata/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  console.log("=== Exported Data ===");
  console.log("Users:", userProfiles);
  console.log("Balances:", userBalances);
  console.log("Deposit History:", depositHistory);
  console.log("Referral Codes:", userReferralCodes);
  console.log("Pending Withdrawals:", pendingWithdrawals);
  bot.sendMessage(ADMIN_ID, "Data exported to console.", { parse_mode: "Markdown" });
});

// ====================
// REGISTRATION FLOW
// ====================
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId === ADMIN_ID) {
    bot.sendMessage(chatId, "Admin doesn't need to register. Use /admin to see commands.", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `🚫You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  if (isRegistered(chatId)) {
    bot.sendMessage(chatId, "You are already registered. Type /start to see the menu.", { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "regFirstName" };
  bot.sendMessage(chatId, botConfig.registrationWelcome, { parse_mode: "Markdown" });
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (msg.text && msg.text.startsWith("/")) return;
  if (!userState[chatId]) return;
  if (chatId === ADMIN_ID) return;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `🚫You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    delete userState[chatId];
    return;
  }
  const st = userState[chatId];
  if (st.stage === "regFirstName") {
    st.firstName = msg.text.trim();
    st.stage = "regLastName";
    bot.sendMessage(chatId, botConfig.askLastName, { parse_mode: "Markdown" });
  } else if (st.stage === "regLastName") {
    st.lastName = msg.text.trim();
    st.stage = "regPhone";
    bot.sendMessage(chatId, botConfig.askPhone, { parse_mode: "Markdown" });
  } else if (st.stage === "regPhone") {
    const phone = msg.text.trim();
    if (!/^(07|01)\d{8}$/.test(phone)) {
      bot.sendMessage(chatId, "⚠️ invalid phone. Must start with 07 or 01 and be 10 digits.", { parse_mode: "Markdown" });
      return;
    }
    userProfiles[chatId] = {
      firstName: st.firstName,
      lastName: st.lastName,
      phone
    };
    userBalances[chatId] = userBalances[chatId] || 0;
    if (!userReferralCodes[chatId]) {
      userReferralCodes[chatId] = generateReferralCode();
      userReferralBonuses[chatId] = 0;
    }
    const text = parsePlaceholders(botConfig.registrationSuccess, {
      firstName: st.firstName,
      lastName: st.lastName,
      referralCode: userReferralCodes[chatId]
    });
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    logAdmin(`New user registered: ${chatId} (${st.firstName} ${st.lastName})`);
    delete userState[chatId];
  }
});

// Warn unregistered users (only once)
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (chatId === ADMIN_ID) return;
  if (!isRegistered(chatId) && !msg.text.startsWith("/register")) {
    if (!userState[chatId]) {
      userState[chatId] = { stage: "notRegisteredWarned" };
      bot.sendMessage(chatId, "You are not registered. Type /register to begin.", { parse_mode: "Markdown" });
    }
  }
});

// ====================
// MAIN MENU
// ====================
bot.onText(/\/start/, (msg) => {
  maintenanceCheck(msg.chat.id, () => {
    const chatId = msg.chat.id;
    if (!isRegistered(chatId)) return;
    if (bannedUsers[chatId]) {
      bot.sendMessage(chatId, `You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
      return;
    }
    const fn = userProfiles[chatId]?.firstName || "Investor";
    const text = parsePlaceholders(botConfig.mainMenuText, { firstName: fn });
    const keyboard = [
      [{ text: "⛏️ Mining", callback_data: "menu:mining" }, { text: "💰 Deposit", callback_data: "menu:deposit" }],
      [{ text: "👥 Referral bonus", callback_data: "menu:refBonus" }, { text: "👤 Profile", callback_data: "menu:profile" }],
      [{ text: "📞 Contact support", callback_data: "menu:contactSupport" }, { text: "💸 Withdrawals", callback_data: "menu:withdraw" }],
      [{ text: "📊 Stats", callback_data: "menu:stats" }, { text: "📂 All Activities", callback_data: "menu:allActivities" }]
    ];
    bot.sendMessage(chatId, text, {
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: "Markdown"
    });
  });
});

// ====================
// CALLBACK HANDLING (Main Menu Options)
bot.on("callback_query", async (cb) => {
  const chatId = cb.message.chat.id;
  maintenanceCheck(chatId, () => {}); // If maintenance, non-admin users are blocked.
  if (!isRegistered(chatId)) return;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `🚫You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  await bot.answerCallbackQuery(cb.id).catch(() => {});
  const data = cb.data;
  switch (data) {
    case "menu:mining":
      userState[chatId] = { stage: "autoInvest" };
      const pkKeyboard = packages.map(p => ([{
        text: `${p.name} (Min Ksh ${p.min})`,
        callback_data: `autoInvest:${p.name}`
      }]));
      pkKeyboard.push([{ text: "🔙 Back to Menu", callback_data: "backToMenu" }]);
      bot.sendMessage(chatId, botConfig.investPrompt, {
        reply_markup: { inline_keyboard: pkKeyboard },
        parse_mode: "Markdown"
      });
      break;
    case "menu:deposit":
      userState[chatId] = { stage: "awaitingDepositAmount" };
      bot.sendMessage(chatId, botConfig.depositIntro, { parse_mode: "Markdown" });
      break;
    case "menu:refBonus":
      if (!userReferralCodes[chatId]) {
        userReferralCodes[chatId] = generateReferralCode();
        userReferralBonuses[chatId] = 0;
      }
      {
        const code = userReferralCodes[chatId];
        const bonus = userReferralBonuses[chatId] || 0;
        const link = `https://t.me/${botConfig.botUsername}?start=${code}`;
        bot.sendMessage(chatId, `*Referral Bonus:* Ksh ${bonus}\n*Your Referral Code:* ${code}\n*Referral Link:* ${link}`, { parse_mode: "Markdown" });
      }
      break;
    case "menu:profile":
      {
        const up = userProfiles[chatId];
        const bal = userBalances[chatId] || 0;
        let c = depositHistory[chatId] ? depositHistory[chatId].length : 0;
        bot.sendMessage(chatId, `*Profile*\nName: ${up.firstName} ${up.lastName}\nPhone: ${up.phone}\nBalance: Ksh ${bal}\nActivities: ${c}`, { parse_mode: "Markdown" });
      }
      break;
    case "menu:contactSupport":
      userState[chatId] = { stage: "ticketMsg" };
      // Alert admin immediately for support request
      sendAdminAlert(`Support ticket requested by user ${chatId}.`);
      bot.sendMessage(chatId, "*Please describe your issue:*", { parse_mode: "Markdown" });
      break;
    case "menu:withdraw":
      userState[chatId] = { stage: "awaitingWithdrawAmount" };
      bot.sendMessage(chatId, parsePlaceholders(botConfig.withdrawPrompt, { min: botConfig.withdrawMin, max: botConfig.withdrawMax }), { parse_mode: "Markdown" });
      break;
    case "menu:stats":
      {
        let total = 0;
        Object.values(depositHistory).forEach(arr => {
          arr.forEach(r => total += r.amount);
        });
        const userCount = Object.keys(userProfiles).length;
        bot.sendMessage(chatId, `*Stats*\nTotal users: ${userCount}\nTotal deposit volume: Ksh ${total}`, { parse_mode: "Markdown" });
      }
      break;
    case "menu:allActivities":
      {
        const hist = depositHistory[chatId] || [];
        if (!hist.length) {
          bot.sendMessage(chatId, "No deposit or investment history found.", { parse_mode: "Markdown" });
          return;
        }
        let text = "*Your Activities:*\n";
        hist.forEach((r, i) => {
          const type = (r.package && r.package !== "FromBalance") ? "INVESTMENT" : "DEPOSIT";
          text += `${i+1}. [${type}] INV: ${r.invCode}, Amount: ${r.amount}, Phone: ${r.depositNumber}, Status: ${r.status}, Date: ${r.date}\n`;
        });
        bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
      }
      break;
    case "backToMenu":
      bot.sendMessage(chatId, "Back to main menu. Type /start again.", { parse_mode: "Markdown" });
      break;
    default:
      if (data.startsWith("autoInvest:")) {
        const pkgName = data.split(":")[1];
        const pkg = packages.find(x => x.name === pkgName);
        if (!pkg) {
          bot.sendMessage(chatId, "Package not found.", { parse_mode: "Markdown" });
          return;
        }
        const bal2 = userBalances[chatId] || 0;
        if (bal2 < pkg.min) {
          bot.sendMessage(chatId, parsePlaceholders(botConfig.investInsufficient, { package: pkg.name }), { parse_mode: "Markdown" });
          return;
        }
        userBalances[chatId] = bal2 - pkg.min;
        const invCode = generateInvestmentCode();
        const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
        if (!depositHistory[chatId]) depositHistory[chatId] = [];
        depositHistory[chatId].push({
          invCode,
          amount: pkg.min,
          package: pkg.name,
          depositNumber: "FromBalance",
          date: dateNow,
          status: "INVESTED",
          mpesaCode: ""
        });
        const successMsg = parsePlaceholders(botConfig.investSuccess, {
          invCode,
          package: pkg.name,
          amount: String(pkg.min)
        });
        bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });
        sendAdminAlert(`User ${chatId} auto-invested Ksh ${pkg.min} in ${pkg.name}. INV: ${invCode}`);
      } else {
        bot.sendMessage(chatId, "Unknown option.", { parse_mode: "Markdown" });
      }
  }
});

// ====================
// Deposit Flow
// ====================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!userState[chatId]) return;
  if (!isRegistered(chatId)) return;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `🚫You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    delete userState[chatId];
    return;
  }
  const st = userState[chatId];
  if (st.stage === "awaitingDepositAmount") {
    const amt = parseInt(msg.text);
    if (isNaN(amt) || amt <= 0) {
      bot.sendMessage(chatId, "⚠️Invalid deposit amount.", { parse_mode: "Markdown" });
      return;
    }
    st.amount = amt;
    st.stage = "awaitingDepositPhone";
    bot.sendMessage(chatId, botConfig.depositPhonePrompt, { parse_mode: "Markdown" });
  } else if (st.stage === "awaitingDepositPhone") {
    const phone = msg.text.trim();
    st.depositNumber = phone;
    st.stage = "processingDeposit";
    const ref = await sendSTKPush(st.amount, phone);
    if (!ref) {
      bot.sendMessage(chatId, `*❌ Error:* ${botConfig.depositErrorMessage}`, { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    const invCode = generateInvestmentCode();
    bot.sendMessage(chatId, parsePlaceholders(botConfig.paymentInitiated, { seconds: "20" }), { parse_mode: "Markdown" });
    setTimeout(() => {
      bot.sendMessage(chatId, parsePlaceholders(botConfig.countdownUpdate, { seconds: "10" }), { parse_mode: "Markdown" });
    }, 10000);
    setTimeout(async () => {
      const stData = await fetchTransactionStatus(ref);
      if (!stData) {
        bot.sendMessage(chatId, "*❌ Error fetching payment status.*", { parse_mode: "Markdown" });
        delete userState[chatId];
        return;
      }
      const finalStatus = stData.status ? stData.status.toUpperCase() : "UNKNOWN";
      const mpesaCode = stData.provider_reference || "MPESA" + Math.floor(Math.random() * 100000);
      const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
      if (finalStatus === "SUCCESS") {
        userBalances[chatId] = (userBalances[chatId] || 0) + st.amount;
        if (!depositHistory[chatId]) depositHistory[chatId] = [];
        depositHistory[chatId].push({
          invCode,
          amount: st.amount,
          depositNumber: phone,
          date: dateNow,
          status: "SUCCESS",
          mpesaCode
        });
        const successMsg = parsePlaceholders(botConfig.depositSuccess, {
          invCode,
          amount: String(st.amount),
          depositNumber: phone,
          mpesaCode,
          date: dateNow
        });
        bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });
        sendAdminAlert(`*✅ Deposit:*\nUser: ${chatId}\nAmount: Ksh ${st.amount}\nPhone: ${phone}\nMPESA Code: ${mpesaCode}\nDate: ${dateNow}\nINV: ${invCode}`);
      } else {
        bot.sendMessage(chatId, "*❌ Payment failed or pending.*", { parse_mode: "Markdown" });
        sendAdminAlert(`*❌ Deposit Failed:*\nUser: ${chatId}\nAmount: Ksh ${st.amount}\nPhone: ${phone}\nDate: ${dateNow}`);
      }
      delete userState[chatId];
    }, 20000);
  }
});

// ====================
// Withdrawal Flow (with 6% fee)
// ====================
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!userState[chatId]) return;
  if (!isRegistered(chatId)) return;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    delete userState[chatId];
    return;
  }
  const st = userState[chatId];
  if (st.stage === "awaitingWithdrawAmount") {
    const amt = parseFloat(msg.text);
    if (isNaN(amt) || amt < botConfig.withdrawMin || amt > botConfig.withdrawMax) {
      bot.sendMessage(chatId, `Invalid withdrawal amount. Must be between Ksh ${botConfig.withdrawMin} and ${botConfig.withdrawMax}.`, { parse_mode: "Markdown" });
      return;
    }
    st.requestedAmount = amt;
    st.fee = parseFloat((amt * (botConfig.withdrawalFeePercent / 100)).toFixed(2));
    st.finalAmount = parseFloat((amt - st.fee).toFixed(2));
    st.stage = "awaitingWithdrawNumber";
    bot.sendMessage(chatId, `${botConfig.askWithdrawNumber}\nWithdrawal Fee: Ksh ${st.fee}\nYou will receive: Ksh ${st.finalAmount}`, { parse_mode: "Markdown" });
    sendAdminAlert(`*Withdrawal Requested:*\nUser: ${chatId}\nRequested: Ksh ${amt}\nFee: Ksh ${st.fee}\nNet: Ksh ${st.finalAmount}`);
  } else if (st.stage === "awaitingWithdrawNumber") {
    const phone = msg.text.trim();
    if (!/^(07|01)\d{8}$/.test(phone)) {
      bot.sendMessage(chatId, "Invalid M-PESA number (must start with 07 or 01, 10 digits).", { parse_mode: "Markdown" });
      return;
    }
    const bal = userBalances[chatId] || 0;
    if (st.requestedAmount > bal) {
      bot.sendMessage(chatId, "*⚠️ Insufficient funds.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    userBalances[chatId] = bal - st.requestedAmount;
    const wid = nextWithdrawalID++;
    pendingWithdrawals[wid] = {
      chatId,
      requestedAmount: st.requestedAmount,
      fee: st.fee,
      finalAmount: st.finalAmount,
      withdrawNumber: phone,
      date: new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" }),
      status: "pending",
      remark: ""
    };
    bot.sendMessage(chatId, `*Withdrawal request for Ksh ${st.requestedAmount} created.* After a fee of Ksh ${st.fee}, you'll receive Ksh ${st.finalAmount}. Pending admin approval.`, { parse_mode: "Markdown" });
    sendAdminAlert(`*Withdrawal Requested:*\nUser: ${chatId}\nRequested: Ksh ${st.requestedAmount}\nFee: Ksh ${st.fee}\nNet: Ksh ${st.finalAmount}\nPhone: ${phone}\nDate: ${pendingWithdrawals[wid].date}`);
    delete userState[chatId];
  }
});

// ====================
// Extra User Commands
// ====================
bot.onText(/\/balance/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  const bal = userBalances[chatId] || 0;
  bot.sendMessage(chatId, parsePlaceholders(botConfig.balanceMessage, { balance: String(bal) }), { parse_mode: "Markdown" });
});

bot.onText(/\/packages/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  let txt = "*Available Packages:*\n";
  packages.forEach(p => {
    txt += `• ${p.name}: min Ksh ${p.min}\n`;
  });
  bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
});

bot.onText(/\/history/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  const hist = depositHistory[chatId] || [];
  if (!hist.length) {
    bot.sendMessage(chatId, "No deposit or investment history found.", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Your Activities:*\n";
  hist.forEach((r, i) => {
    const type = (r.package && r.package !== "FromBalance") ? "INVESTMENT" : "DEPOSIT";
    text += `${i + 1}. [${type}] INV: ${r.invCode}, Amount: ${r.amount}, Phone: ${r.depositNumber}, Status: ${r.status}, Date: ${r.date}\n`;
  });
  bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
});

bot.onText(/\/myreferral/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  if (!userReferralCodes[chatId]) {
    userReferralCodes[chatId] = generateReferralCode();
    userReferralBonuses[chatId] = 0;
  }
  const code = userReferralCodes[chatId];
  const bonus = userReferralBonuses[chatId] || 0;
  const link = `https://t.me/${botConfig.botUsername}?start=${code}`;
  bot.sendMessage(chatId, `Your referral code: ${code}\nBonus Earned: Ksh ${bonus}\nReferral Link: ${link}`, { parse_mode: "Markdown" });
});

bot.onText(/\/interest/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  const bal = userBalances[chatId] || 0;
  const interest = (bal * 0.05).toFixed(2);
  bot.sendMessage(chatId, `Estimated monthly interest on your balance: Ksh ${interest}`, { parse_mode: "Markdown" });
});

bot.onText(/\/profile/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  const up = userProfiles[chatId];
  const bal = userBalances[chatId] || 0;
  let c = depositHistory[chatId] ? depositHistory[chatId].length : 0;
  bot.sendMessage(chatId, `*Profile*\nName: ${up.firstName} ${up.lastName}\nPhone: ${up.phone}\nBalance: Ksh ${bal}\nActivities: ${c}`, { parse_mode: "Markdown" });
});

bot.onText(/\/faq/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  bot.sendMessage(chatId, "*FAQ placeholder.*", { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  bot.sendMessage(chatId, botConfig.userHelp, { parse_mode: "Markdown" });
});

// /feedback command – user feedback
bot.onText(/\/feedback (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (!isRegistered(chatId)) return;
  const feedback = match[1];
  bot.sendMessage(chatId, "Thank you for your feedback! 🙏", { parse_mode: "Markdown" });
  sendAdminAlert(`Feedback from ${chatId}: ${feedback}`);
});

// /inspire command – inspirational quote
bot.onText(/\/inspire/, (msg) => {
  const quote = getRandomQuote();
  bot.sendMessage(msg.chat.id, `💡 *Inspirational Quote:*\n${quote}`, { parse_mode: "Markdown" });
});

// /about command – about info
bot.onText(/\/about/, (msg) => {
  bot.sendMessage(msg.chat.id, getAbout(), { parse_mode: "Markdown" });
});

// /uptime command – bot uptime
bot.onText(/\/uptime/, (msg) => {
  bot.sendMessage(msg.chat.id, `Bot uptime: ${getUptime()}`, { parse_mode: "Markdown" });
});

// /leaderboard command – top 5 users by deposit volume
bot.onText(/\/leaderboard/, (msg) => {
  let leaderboard = [];
  for (let uid in depositHistory) {
    const total = depositHistory[uid].reduce((sum, rec) => sum + rec.amount, 0);
    leaderboard.push({ uid, total });
  }
  leaderboard.sort((a, b) => b.total - a.total);
  const top5 = leaderboard.slice(0, 5);
  let text = "*Leaderboard (Top Depositors):*\n";
  top5.forEach((entry, idx) => {
    text += `${idx + 1}. User ${entry.uid} - Ksh ${entry.total}\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// ====================
// ADMIN COMMANDS
// ====================

bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
    bot.sendMessage(msg.chat.id, "Bot is successfully deployed and running!", { parse_mode: "Markdown" });
  }
});

// /broadcast [chatId1,chatId2,...] message
bot.onText(/\/broadcast (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const input = match[1];
  const start = input.indexOf("[");
  const end = input.indexOf("]");
  if (start < 0 || end < 0) {
    bot.sendMessage(msg.chat.id, "Invalid format. Use: /broadcast [id1,id2] message", { parse_mode: "Markdown" });
    return;
  }
  const arr = input.substring(start + 1, end).split(",").map(x => x.trim());
  const broadcastText = input.substring(end + 1).trim();
  arr.forEach(id => {
    bot.sendMessage(id, `*${botConfig.fromAdmin}:*\n${broadcastText}`, { parse_mode: "Markdown" })
      .catch(() => bot.sendMessage(msg.chat.id, `Could not message ${id}`, { parse_mode: "Markdown" }));
  });
  bot.sendMessage(msg.chat.id, "*Broadcast complete.*", { parse_mode: "Markdown" });
});

// /broadcastAll <message>
bot.onText(/\/broadcastAll (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const text = match[1];
  const allUsers = Object.keys(userProfiles);
  allUsers.forEach(uid => {
    bot.sendMessage(uid, `*${botConfig.fromAdmin}:*\n${text}`, { parse_mode: "Markdown" })
      .catch(() => bot.sendMessage(msg.chat.id, `Could not message ${uid}`, { parse_mode: "Markdown" }));
  });
  bot.sendMessage(msg.chat.id, "*Broadcast to all users complete.*", { parse_mode: "Markdown" });
});

// /addpackage <name> <min>
bot.onText(/\/addpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const parts = match[1].split(" ");
  if (parts.length < 2) {
    bot.sendMessage(msg.chat.id, "Usage: /addpackage <name> <min>", { parse_mode: "Markdown" });
    return;
  }
  const nm = parts[0];
  const mn = parseInt(parts[1]);
  if (isNaN(mn)) {
    bot.sendMessage(msg.chat.id, "Min must be a number.", { parse_mode: "Markdown" });
    return;
  }
  packages.push({ name: nm, min: mn });
  bot.sendMessage(msg.chat.id, `Package ${nm} added with min Ksh ${mn}`, { parse_mode: "Markdown" });
});

// /editpackage <name> <newMin>
bot.onText(/\/editpackage (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const p = match[1].split(" ");
  if (p.length < 2) {
    bot.sendMessage(msg.chat.id, "Usage: /editpackage <name> <newMin>", { parse_mode: "Markdown" });
    return;
  }
  const nm = p[0];
  const mn = parseInt(p[1]);
  const pkg = packages.find(x => x.name.toLowerCase() === nm.toLowerCase());
  if (!pkg) {
    bot.sendMessage(msg.chat.id, "Package not found.", { parse_mode: "Markdown" });
    return;
  }
  pkg.min = mn;
  bot.sendMessage(msg.chat.id, `Package ${pkg.name} updated to min Ksh ${mn}`, { parse_mode: "Markdown" });
});

// /referrals – list pending referrals
bot.onText(/\/referrals/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(referralRequests);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "No pending referrals.", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Pending Referrals:*\n";
  keys.forEach(id => {
    const r = referralRequests[id];
    txt += `ID: ${id} | Code: ${r.code} | Referred: ${r.referred} | Status: ${r.status}\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// Approve referral
bot.onText(/approve (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const rid = match[1];
  const rr = referralRequests[rid];
  if (!rr) {
    bot.sendMessage(msg.chat.id, "Referral not found.", { parse_mode: "Markdown" });
    return;
  }
  rr.status = "approved";
  const numeric = parseInt(rr.code.replace("FY'S-", ""));
  if (!isNaN(numeric)) {
    if (!userReferralBonuses[numeric]) userReferralBonuses[numeric] = 0;
    userReferralBonuses[numeric] += botConfig.referralBonus;
    bot.sendMessage(msg.chat.id, `Referral ${rid} approved. Bonus credited to code ${rr.code}`, { parse_mode: "Markdown" });
  }
});

// Decline referral
bot.onText(/decline (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const rid = match[1];
  const rr = referralRequests[rid];
  if (!rr) {
    bot.sendMessage(msg.chat.id, "Referral not found.", { parse_mode: "Markdown" });
    return;
  }
  rr.status = "declined";
  bot.sendMessage(msg.chat.id, `Referral ${rid} declined.`, { parse_mode: "Markdown" });
});

// /withdrawlimits
bot.onText(/\/withdrawlimits/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `Min: ${botConfig.withdrawMin}, Max: ${botConfig.withdrawMax}`, { parse_mode: "Markdown" });
});

// /users – list registered users
bot.onText(/\/users/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(userProfiles);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "No users registered.", { parse_mode: "Markdown" });
    return;
  }
  let txt = "*Registered Users:*\n";
  keys.forEach(k => {
    const up = userProfiles[k];
    txt += `• ${k}: ${up.firstName} ${up.lastName}, phone: ${up.phone}\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// /adjust <chatId> <amount>
bot.onText(/\/adjust (\d+) (-?\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const uid = match[1];
  const amt = parseInt(match[2]);
  if (!userBalances[uid]) userBalances[uid] = 0;
  userBalances[uid] += amt;
  bot.sendMessage(msg.chat.id, `User ${uid} new balance: Ksh ${userBalances[uid]}`, { parse_mode: "Markdown" });
});

// /investment <chatId> – show last investment of a user
bot.onText(/\/investment (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const uid = match[1];
  const hist = depositHistory[uid] || [];
  if (!hist.length) {
    bot.sendMessage(msg.chat.id, "No investments found for user.", { parse_mode: "Markdown" });
    return;
  }
  const last = hist[hist.length - 1];
  bot.sendMessage(msg.chat.id,
    `INV: ${last.invCode}\nAmount: Ksh ${last.amount}\nPhone: ${last.depositNumber}\nDate: ${last.date}\nStatus: ${last.status}\nMPESA: ${last.mpesaCode || "N/A"}`,
    { parse_mode: "Markdown" }
  );
});

// /tickets – list support tickets
bot.onText(/\/tickets/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(supportTickets);
  if (!keys.length) {
    bot.sendMessage(msg.chat.id, "No support tickets.", { parse_mode: "Markdown" });
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
  if (msg.from.id !== ADMIN_ID) return;
  const tid = match[1];
  const rep = match[2];
  const t = supportTickets[tid];
  if (!t) {
    bot.sendMessage(msg.chat.id, "Ticket not found.", { parse_mode: "Markdown" });
    return;
  }
  t.status = "replied";
  t.reply = rep;
  bot.sendMessage(msg.chat.id, `Ticket ${tid} replied.`, { parse_mode: "Markdown" });
  bot.sendMessage(t.chatId, `*Support Ticket Reply*\n${rep}`, { parse_mode: "Markdown" });
});

// /adminlog – show last 10 admin log entries
bot.onText(/\/adminlog/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const logText = adminLog.slice(-10).join("\n");
  bot.sendMessage(ADMIN_ID, `*Admin Log (last 10 entries):*\n${logText}`, { parse_mode: "Markdown" });
});

// /resetdata – resets all user data (admin only)
bot.onText(/\/resetdata/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  Object.keys(userProfiles).forEach(key => delete userProfiles[key]);
  Object.keys(userBalances).forEach(key => delete userBalances[key]);
  Object.keys(depositHistory).forEach(key => delete depositHistory[key]);
  Object.keys(userReferralCodes).forEach(key => delete userReferralCodes[key]);
  Object.keys(userReferralBonuses).forEach(key => delete userReferralBonuses[key]);
  bot.sendMessage(ADMIN_ID, "All user data has been reset.", { parse_mode: "Markdown" });
  logAdmin("System data reset by admin.");
});

// /clearhistory <chatId> – clear a user's deposit/investment history
bot.onText(/\/clearhistory (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const uid = match[1];
  delete depositHistory[uid];
  bot.sendMessage(ADMIN_ID, `Deposit/investment history for user ${uid} cleared.`, { parse_mode: "Markdown" });
  logAdmin(`Deposit history for user ${uid} cleared.`);
});

// /exportdata – export data to console (admin only)
bot.onText(/\/exportdata/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  console.log("=== Exported Data ===");
  console.log("Users:", userProfiles);
  console.log("Balances:", userBalances);
  console.log("Deposit History:", depositHistory);
  console.log("Referral Codes:", userReferralCodes);
  console.log("Pending Withdrawals:", pendingWithdrawals);
  bot.sendMessage(ADMIN_ID, "Data exported to console.", { parse_mode: "Markdown" });
});

// ====================
// END OF CODE
console.log("FYS_PROPERTY Bot loaded.");
