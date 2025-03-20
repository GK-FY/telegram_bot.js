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
  welcomeMessage: "👋 *Welcome back, {firstName}!* \nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package* (min Ksh {min}).\nEnter the deposit amount (in Ksh):",
  referralPrompt: "If you have a referral code, please enter it now, or type `none`:",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  paymentSuccess: "*🎉 Investment Successful!*\n*INV Code:* {invCode}\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit No:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\nYou will earn Ksh {profitTotal} after the {earningReturn}.\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  
  // Withdrawal texts
  withdrawPrompt: "💸 *Withdrawal Requested!* Please enter the amount to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, enter the M-PESA number to send the funds (must start with 07 or 01, 10 digits):",
  
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
  
  // Profit rate & earning timeframe
  profitRate: 10,              // default 10% profit
  earningReturn: "monthly",    // default timeframe is "monthly"
  
  // Withdrawal limits
  withdrawMin: 1,
  withdrawMax: 75000,
  
  // Additional user help
  userHelp: "Available commands:\n/start - Start deposit flow\n/balance - Check your balance\n/packages - View available packages\n/history - Deposit history\n/withdraw - Withdraw funds\n/myreferral - Your referral code\n/interest - Estimated interest\n/profile - Your profile\n/faq - FAQs\n/help - Help\n/ticket - Create a support ticket"
};

// =====================
// IN-MEMORY DATA STORAGE
// =====================

// Registered users: { chatId: { firstName, lastName, phone } }
const userProfiles = {};
// User conversation state
const userState = {};
// User balances
const userBalances = {};
// Deposit history: { chatId: [ { invCode, amount, package, depositNumber, date, status, mpesaCode } ] }
const depositHistory = {};
// Referral requests: { id: { referrer, referred, code, date, status } }
const referralRequests = {};
let nextReferralID = 1;
// Each user gets a referral code: { chatId: code }
const userReferralCodes = {};
// Referral bonuses: { chatId: bonus }
const userReferralBonuses = {};
// Pending withdrawal requests: { id: { chatId, amount, withdrawNumber, date, status, remark } }
const pendingWithdrawals = {};
let nextWithdrawalID = 1;
// Support tickets: { id: { chatId, message, date, status, reply } }
const supportTickets = {};
let nextTicketID = 1;
// Banned users: { chatId: { reason, date } }
const bannedUsers = {};

// Investment packages
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// =====================
// CREATE TELEGRAM BOT
// =====================
const bot = new TelegramBot(token, { polling: true });

// =====================
// HELPER FUNCTIONS
// =====================

// Replace placeholders in text templates.
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

// Convert phone from "07..." to "2547..."
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

// Generate unique investment code
function generateInvestmentCode() {
  return "INV-" + Math.floor(1000000 + Math.random() * 9000000);
}

// Generate referral code
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

// Fetch transaction status from Pay Hero
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

// Send alert to admin
function sendAdminAlert(text) {
  bot.sendMessage(ADMIN_ID, text, { parse_mode: "Markdown" });
}

// Parse broadcast command
function parseBroadcastCommand(msg) {
  const start = msg.indexOf("[");
  const end = msg.indexOf("]");
  if (start === -1 || end === -1) return null;
  const ids = msg.substring(start + 1, end).split(",").map(id => id.trim());
  const broadcastText = msg.substring(end + 1).trim();
  return { ids, broadcastText };
}

// Admin help text
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

// =====================
// BOT START
// =====================
console.log("Telegram Investment Bot by FY'S PROPERTY starting...");

// =====================
// POLLING ERROR HANDLER
// =====================
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

// =====================
// ADMIN: /admin => show help + confirm deployment
// =====================
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id === ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode: "Markdown" });
    bot.sendMessage(msg.chat.id, "*Bot is successfully deployed and running!*", { parse_mode: "Markdown" });
  }
});

// ... (Place the rest of the code: registration, deposit flow, withdrawal, admin commands, etc. as above)


// =====================
// The rest of the code is exactly the same as in the final snippet above
// EXCEPT we do not re-declare `supportTickets`
// and we add 'profitRate' and 'earningReturn' placeholders in the success message
// (which we already did).
//
// Make sure the entire snippet is placed in one file with no duplicate `supportTickets` or code
// so that it runs without syntax errors.
// =====================
