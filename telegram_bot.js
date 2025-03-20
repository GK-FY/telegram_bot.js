"use strict";

// ====================
// REQUIRE MODULES
// ====================
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ====================
// CONFIGURATION
// ====================
// Bot token and admin numeric ID.
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
const ADMIN_ID = 5415517965;

// Editable texts and numeric settings (admin‐editable)
let botConfig = {
  // Registration & welcome texts
  registrationWelcome: "👋 *Welcome to FY'S PROPERTY Investment Bot!*\nBefore you start, please register.\nPlease enter your *first name*:",
  askLastName: "Great, now please enter your *last name*:",
  askPhone: "Please enter your *phone number* (must start with 07 or 01, 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}* – your registration is complete!",
  
  // Deposit flow texts
  welcomeMessage: "👋 *Welcome back, {firstName}!*\nPlease choose one of our investment packages:",
  packageMessage: "You chose the *{package} Package* (min Ksh {min}).\nPlease enter the amount (in Ksh) you'd like to invest:",
  referralPrompt: "If you have a referral code, please enter it now (or type `none`):",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  paymentSuccess: "*🎉 Investment Successful!*\n*INV Code:* {invCode}\n*Amount:* Ksh {amount}\n*Package:* {package}\n*Deposit No:* {depositNumber}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\n{footer}",
  paymentFooter: "Thank you for investing with FY'S PROPERTY! Type /start to invest again.",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  
  // Withdrawal texts
  withdrawPrompt: "💸 *Withdrawal Requested!* Please enter the amount you wish to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, please enter the M-PESA number to which you want your funds sent (must start with 07 or 01, 10 digits):",
  withdrawSuccess: "*✅ Withdrawal Successful!*\nYou withdrew Ksh {amount}.\nYour new balance is Ksh {balance}.",
  
  // Balance text
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",
  
  // Referral texts
  referralBonus: 200, // bonus per approved referral
  referralSuccess: "Thank you for using a referral code!\nYour referrer will earn Ksh {bonus} upon approval.",
  myReferral: "🔖 *Your Referral Code:* {code}\nEarn Ksh {bonus} for each approved referral.",
  
  // Admin texts
  fromAdmin: "From Admin GK-FY",
  
  // Channel ID for STK push
  channelID: 529,
  
  // Withdrawal limits
  withdrawMin: 1,
  withdrawMax: 75000
};

// ====================
// IN-MEMORY STORAGE (for demo purposes)
// ====================
// Registered users: keyed by chatId, storing {firstName, lastName, phone}
const userProfiles = {};
// User conversation state (for registration, deposit, withdrawal, etc.)
const userState = {}; // { chatId: { stage, package, amount, depositNumber, stkRef, referralCode, withdrawAmount, withdrawNumber } }
// User balances (investment balance)
const userBalances = {}; // { chatId: number }
// Deposit history: { chatId: [ { invCode, amount, package, depositNumber, date, status, mpesaCode } ] }
const depositHistory = {};
// Referral requests: { id: { referrer, referred, code, date, status } }
const referralRequests = {};
let nextReferralID = 1;
// Each user gets a referral code: { chatId: code } (format: "FY'S-" + 5-digit random)
const userReferralCodes = {};
// Referral bonuses for each user: { chatId: bonus }
const userReferralBonuses = {};
// Pending withdrawal requests: { id: { chatId, amount, withdrawNumber, date, status, remark } }
const pendingWithdrawals = {};
let nextWithdrawalID = 1;
// Banned users: { chatId: { reason, date } }
const bannedUsers = {};

// ====================
// INVESTMENT PACKAGES
// ====================
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ====================
// CREATE TELEGRAM BOT
// ====================
const bot = new TelegramBot(token, { polling: true });

// ====================
// HELPER FUNCTIONS
// ====================

// Replace placeholders in a template.
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
    .replace(/{bonus}/g, data.bonus || "");
}

// Format a phone number: convert "0712345678" to "254712345678"
function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

// Generate a unique investment code: "INV-" + 7-digit number.
function generateInvestmentCode() {
  return "INV-" + Math.floor(1000000 + Math.random() * 9000000);
}

// Generate a referral code: "FY'S-" + 5-digit number.
function generateReferralCode() {
  return "FY'S-" + Math.floor(10000 + Math.random() * 90000);
}

// Send STK push request via Pay Hero.
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

// Get admin help message.
function getAdminHelp() {
  return (
    "*ADMIN COMMANDS:*\n" +
    "1) /admin - Show this help message.\n" +
    "2) edit <key> <newValue> - Edit a config value.\n" +
    "   Valid keys: welcomeMessage, packageMessage, paymentInitiated, countdownUpdate,\n" +
    "   paymentSuccess, paymentFooter, fromAdmin, channelID, balanceMessage, depositErrorMessage,\n" +
    "   referralBonus, withdrawMin, withdrawMax, registrationWelcome, askLastName, askPhone, registrationSuccess\n" +
    "3) /broadcast [chatId1,chatId2,...] Your message - Broadcast a message.\n" +
    "4) addpackage <name> <min> - Add a new investment package.\n" +
    "5) editpackage <name> <newMin> - Edit an existing package's minimum.\n" +
    "6) /referrals - List pending referral requests.\n" +
    "7) approve <referralID> - Approve a referral request.\n" +
    "8) decline <referralID> - Decline a referral request.\n" +
    "9) /withdrawlimits - Show current withdrawal limits.\n" +
    "10) /users - List all registered users (truncated).\n" +
    "11) ban <chatId> <reason> - Ban a user.\n" +
    "12) unban <chatId> - Unban a user.\n" +
    "13) adjust <chatId> <amount> - Add (or deduct, if negative) money to a user's balance.\n" +
    "14) /investment <chatId> - Get details for a user's last investment.\n"
  );
}

// ====================
// REGISTRATION FLOW
// ====================
// When a user sends /register, start the registration flow.
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

// ====================
// MAIN MESSAGE HANDLER (including registration, deposit, withdrawal)
// ====================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const lowerText = text.toLowerCase();
  
  // Ignore non-private chats.
  if (msg.chat.type !== "private") return;
  
  // Check if user is banned.
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `*You are banned.* Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  
  // If message starts with "/" then it is a command (registration, deposit, withdraw, etc.) – those are handled separately.
  // We handle the registration flow here.
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
      // Validate phone number: must start with 07 or 01 and have 10 digits.
      const phone = text.trim();
      if (!/^(07|01)\d{8}$/.test(phone)) {
        bot.sendMessage(chatId, "*⚠️ Please enter a valid phone number (starting with 07 or 01 and 10 digits).*", { parse_mode: "Markdown" });
        return;
      }
      state.phone = phone;
      // Registration complete.
      userProfiles[chatId] = {
        firstName: state.firstName,
        lastName: state.lastName,
        phone: state.phone
      };
      // Initialize balance and referral code.
      if (!userBalances[chatId]) userBalances[chatId] = 0;
      if (!userReferralCodes[chatId]) {
        userReferralCodes[chatId] = generateReferralCode();
        userReferralBonuses[chatId] = 0;
      }
      bot.sendMessage(chatId, parsePlaceholders(botConfig.registrationSuccess, {
        firstName: state.firstName,
        lastName: state.lastName
      }), { parse_mode: "Markdown" });
      // Registration done, clear registration state.
      delete userState[chatId];
      // Show main menu (deposit flow)
      bot.sendMessage(chatId, "Type /start to begin investing.", { parse_mode: "Markdown" });
      return;
    }
  }
  
  // If user is not registered, prompt to register.
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "*You are not registered.* Please type /register to begin.", { parse_mode: "Markdown" });
    return;
  }
  
  // ====================
  // Withdrawal Flow
  // ====================
  if (lowerText.startsWith("/withdraw") && !userState[chatId].stage.startsWith("register")) {
    userState[chatId] = { stage: "awaitingWithdrawAmount" };
    bot.sendMessage(chatId, parsePlaceholders(botConfig.withdrawPrompt, { min: botConfig.withdrawMin, max: botConfig.withdrawMax }), { parse_mode: "Markdown" });
    return;
  }
  
  // ====================
  // If message is one of the extra commands already handled (/balance, /packages, /history, etc.)
  if (lowerText.startsWith("/") && (lowerText === "/balance" || lowerText === "/packages" || lowerText === "/history" || lowerText === "/interest" || lowerText === "/profile" || lowerText === "/faq" || lowerText === "/help" || lowerText === "/myreferral")) {
    return; // these commands are handled in their onText handlers.
  }
  
  // ====================
  // Deposit Flow
  // ====================
  if (lowerText === "/start") {
    userState[chatId] = { stage: "packageSelection" };
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
  
  // If userState exists and is in deposit flow:
  if (userState[chatId] && !userState[chatId].stage.startsWith("register") && !userState[chatId].stage.startsWith("awaitingWithdraw")) {
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
        const invCode = generateInvestmentCode();
        
        if (finalStatus === "SUCCESS") {
          if (!userBalances[chatId]) userBalances[chatId] = 0;
          userBalances[chatId] += state.amount;
          if (!depositHistory[chatId]) depositHistory[chatId] = [];
          depositHistory[chatId].push({
            invCode,
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
            // If the referral code belongs to another user.
            if (refCode !== userReferralCodes[chatId]) {
              referralRequests[nextReferralID] = {
                referrer: refCode, // referrer code
                referred: chatId,
                code: refCode,
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
  }
});

// ====================
// WITHDRAWAL FLOW HANDLING
// ====================
bot.onText(/\/withdraw/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, parsePlaceholders(botConfig.withdrawPrompt, { min: botConfig.withdrawMin, max: botConfig.withdrawMax }), { parse_mode: "Markdown" });
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
    bot.sendMessage(chatId, "*Please enter the M-PESA number to receive your withdrawal (must start with 07 or 01 and be 10 digits):*", { parse_mode: "Markdown" });
    return;
  }
  if (state && state.stage === "awaitingWithdrawNumber") {
    const num = text.trim();
    if (!/^(07|01)\d{8}$/.test(num)) {
      bot.sendMessage(chatId, "*⚠️ Please enter a valid M-PESA number (starting with 07 or 01, 10 digits).*", { parse_mode: "Markdown" });
      return;
    }
    state.withdrawNumber = num;
    const balance = userBalances[chatId] || 0;
    if (state.withdrawAmount > balance) {
      bot.sendMessage(chatId, "*⚠️ Insufficient funds for withdrawal.*", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    // Create a pending withdrawal request.
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

// ====================
// EXTRA USER COMMANDS
// ====================
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
  bot.sendMessage(chatId, `*🔖 Your Referral Code:* ${refCode}\n*💰 Bonus:* Ksh ${bonus}\nShare your code with friends to earn Ksh ${botConfig.referralBonus} per approved referral.`, { parse_mode: "Markdown" });
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
   An STK push is sent. Status is checked after 20 seconds.
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
  const helpText = 
`*USER COMMANDS:*
/start - Begin a new deposit/investment.
/packages - List available packages.
/balance - Check your current balance.
/history - View your deposit history.
/withdraw - Withdraw funds (min ${botConfig.withdrawMin}, max ${botConfig.withdrawMax}).
/myreferral - View your referral code and bonus.
/interest - View estimated monthly interest.
/profile - View your profile summary.
/faq - Frequently asked questions.
/help - Show this help message.`;
  bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
});

// ====================
// ADMIN REFERRAL REVIEW COMMANDS
// ====================
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
  if (!userReferralBonuses[req.referrer]) userReferralBonuses[req.referrer] = 0;
  userReferralBonuses[req.referrer] += botConfig.referralBonus;
  bot.sendMessage(msg.chat.id, `*Referral ${refId} approved.* Bonus credited to referrer ${req.referrer}.`, { parse_mode: "Markdown" });
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

// ====================
// ADMIN WITHDRAWAL REVIEW COMMANDS
// ====================
bot.onText(/\/withdrawals/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  const keys = Object.keys(pendingWithdrawals);
  if (keys.length === 0) {
    bot.sendMessage(msg.chat.id, "*No pending withdrawal requests.*", { parse_mode: "Markdown" });
    return;
  }
  let text = "*Pending Withdrawal Requests:*\n";
  keys.forEach((id) => {
    const req = pendingWithdrawals[id];
    text += `ID: *${id}* | User: *${req.chatId}* | Amount: *Ksh ${req.amount}* | M-PESA: *${req.withdrawNumber}* | Date: *${req.date}* | Status: *${req.status}*\n`;
  });
  bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// Approve withdrawal.
bot.onText(/approvewithdraw (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const wid = match[1];
  const remark = match[2];
  const req = pendingWithdrawals[wid];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*⚠️ Withdrawal request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "approved";
  // Deduct money already done; here we just notify.
  bot.sendMessage(msg.chat.id, `*Withdrawal ${wid} approved.* Remark: ${remark}`, { parse_mode: "Markdown" });
  bot.sendMessage(req.chatId, `*✅ Withdrawal Approved!*\nYour withdrawal of Ksh ${req.amount} has been approved.\nRemark: ${remark}`, { parse_mode: "Markdown" });
  delete pendingWithdrawals[wid];
});

// Decline withdrawal.
bot.onText(/declinewithdraw (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const wid = match[1];
  const remark = match[2];
  const req = pendingWithdrawals[wid];
  if (!req) {
    bot.sendMessage(msg.chat.id, "*⚠️ Withdrawal request not found.*", { parse_mode: "Markdown" });
    return;
  }
  req.status = "declined";
  // Refund money since withdrawal declined.
  if (!userBalances[req.chatId]) userBalances[req.chatId] = 0;
  userBalances[req.chatId] += req.amount;
  bot.sendMessage(msg.chat.id, `*Withdrawal ${wid} declined.* Remark: ${remark}`, { parse_mode: "Markdown" });
  bot.sendMessage(req.chatId, `*❌ Withdrawal Declined!*\nYour withdrawal request of Ksh ${req.amount} has been declined.\nRemark: ${remark}`, { parse_mode: "Markdown" });
  delete pendingWithdrawals[wid];
});

// Admin: /withdrawlimits to show current withdrawal limits.
bot.onText(/\/withdrawlimits/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `*Withdrawal Limits:*\nMinimum: Ksh ${botConfig.withdrawMin}\nMaximum: Ksh ${botConfig.withdrawMax}`, { parse_mode: "Markdown" });
});

// Admin: /users to list registered users (truncated info).
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

// Admin: /adjust <chatId> <amount> - Adjust user's balance (add if positive, deduct if negative).
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

// Admin: /investment <chatId> - Get last investment info for a user.
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

// ====================
// ADMIN REGISTRATION OF NEW PACKAGES
// ====================
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

// Edit package minimum.
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

// ====================
// Banning/Unbanning Users
// ====================
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

// ====================
// POLLING ERROR HANDLER
// ====================
bot.on("polling_error", (error) => {
  console.error("Polling error:", error);
});

console.log("Telegram Investment Bot by FY'S PROPERTY starting...");
