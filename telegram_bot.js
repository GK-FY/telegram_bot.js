"use strict";

const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

// ================
// BOT CONFIG
// ================
const token = "6496106682:AAH4D4yMcYx4FKIyZem5akCQr6swjf_Z6pw";
const ADMIN_ID = 5415517965;

// Admin-editable config
let botConfig = {
  // Registration
  registrationWelcome: "👋 *Welcome to FY'S PROPERTY Investment Bot!* \nBefore you begin, please register.\nEnter your *first name*:",
  askLastName: "Great! Now, please enter your *last name*:",
  askPhone: "Please enter your *phone number* (must start with 07 or 01 and be 10 digits):",
  registrationSuccess: "Thank you, *{firstName} {lastName}*! Your registration is complete. Your referral code is *{referralCode}*.\nType /start to see our menu.",
  
  // Main menu
  mainMenuText: "Hello, *{firstName}*. Please select an option below:",

  // Deposit
  depositIntro: "*Deposit Flow Started!* Please enter the deposit amount in Ksh:",
  depositPhonePrompt: "Now enter your M-PESA phone number (start with 07 or 01):",
  paymentInitiated: "*⏳ Payment initiated!* We'll check status in {seconds} seconds...\n_Stay tuned!_",
  countdownUpdate: "*⏳ {seconds} seconds left...*",
  depositSuccess: "*🎉 Deposit Successful!*\n*INV Code:* {invCode}\n*Amount:* Ksh {amount}\n*MPESA Code:* {mpesaCode}\n*Date/Time:* {date}\nYou will earn Ksh {profitTotal} after the {earningReturn}.",
  depositErrorMessage: "Sorry, an error occurred during your deposit. Please try again.",
  depositFooter: "Thank you for investing with FY'S PROPERTY! Type /start to see the menu.",

  // Invest from balance
  investPrompt: "Select a package to invest from your balance:",
  investInsufficient: "*⚠️ You do not have enough balance to invest in {package}. Please deposit first.*",
  investSuccess: "*🎉 Investment Created!*\n*INV Code:* {invCode}\nPackage: {package}\nAmount: Ksh {amount}\nYou will earn Ksh {profitTotal} after the {earningReturn}.",

  // Referral
  referralBonus: 200,
  referralSuccess: "Thank you for using a referral code! Your referrer will be credited upon admin approval.",
  // For referral link generation:
  botUsername: "shankfy_bot",  // The username of your bot

  // Balance
  balanceMessage: "*💵 Your current investment balance is:* Ksh {balance}",

  // Profit Rate & Earning Return
  profitRate: 10,            // default 10%
  earningReturn: "monthly",  // default timeframe

  // Withdraw
  withdrawPrompt: "💸 *Withdrawal Requested!* Please enter the amount to withdraw (min Ksh {min}, max Ksh {max}):",
  askWithdrawNumber: "Now, enter the M-PESA number (start 07 or 01, 10 digits):",
  withdrawMin: 1,
  withdrawMax: 75000,

  // Admin
  fromAdmin: "shankfy_bot",   // used for referral links too
};

// ================
// IN-MEMORY DATA
// ================
const userProfiles = {};         // { chatId: { firstName, lastName, phone, referralParam } }
const userState = {};            // { chatId: { stage, ... } }
const userBalances = {};         // { chatId: number }
const depositHistory = {};       // { chatId: [ { invCode, amount, depositNumber, date, status, mpesaCode, package? } ] }
const referralRequests = {};     // { id: { referrer, referred, code, date, status } }
let nextReferralID = 1;
const userReferralCodes = {};    // { chatId: code }
const userReferralBonuses = {};  // { chatId: number }
const pendingWithdrawals = {};   // { id: { chatId, amount, withdrawNumber, date, status, remark } }
let nextWithdrawalID = 1;
const supportTickets = {};       // { id: { chatId, message, date, status, reply } }
let nextTicketID = 1;
const bannedUsers = {};          // { chatId: { reason, date } }

// Packages
let packages = [
  { name: "Package 1", min: 1 },
  { name: "Package 2", min: 2 },
  { name: "Package 3", min: 3 }
];

// ================
// CREATE BOT
// ================
const bot = new TelegramBot(token, { polling: true });
console.log("FY'S PROPERTY Bot starting...");

// On startup, notify admin
bot.sendMessage(ADMIN_ID, "*Bot is successfully deployed and running!* Use /admin to see admin commands.", { parse_mode: "Markdown" });

// Polling error
bot.on("polling_error", (err) => console.error("Polling error:", err));

// ================
// HELPER FUNCTIONS
// ================
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
    .replace(/{footer}/g, botConfig.depositFooter);
}

function formatPhoneNumber(numStr) {
  let cleaned = numStr.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.slice(1);
  }
  return cleaned;
}

function generateInvestmentCode() {
  return "INV-" + Math.floor(1000000 + Math.random()*9000000);
}

function generateReferralCode() {
  return "FY'S-" + Math.floor(10000 + Math.random()*90000);
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
/admin - Show this help
edit <key> <newValue> - Edit config (keys: registrationWelcome, askLastName, askPhone, registrationSuccess, mainMenuText, depositIntro, depositPhonePrompt, depositErrorMessage, depositFooter, paymentInitiated, countdownUpdate, depositSuccess, fromAdmin, channelID, balanceMessage, referralBonus, withdrawMin, withdrawMax, profitRate, earningReturn)
/broadcast [chatId1,chatId2,...] message
/addpackage <name> <min>
/editpackage <name> <newMin>
/referrals - List pending referrals
approve <id>, decline <id>
/withdrawlimits - Show withdraw min/max
/users - List registered users
ban <chatId> <reason>, unban <chatId>
adjust <chatId> <amount>
/investment <chatId> - Last investment
/tickets - List support tickets
replyticket <id> <message> - reply to a ticket
/help - user help
`
  );
}

// ================
// BAN / UNBAN
// ================
bot.onText(/ban (\d+) (.+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) return;
  const uid = match[1];
  const reason = match[2];
  bannedUsers[uid] = { reason, date: new Date().toLocaleString() };
  bot.sendMessage(msg.chat.id, `User ${uid} banned. Reason: ${reason}`, { parse_mode: "Markdown" });
});

bot.onText(/unban (\d+)/, (msg, match) => {
  if (msg.from.id!==ADMIN_ID) return;
  const uid = match[1];
  if (bannedUsers[uid]) {
    delete bannedUsers[uid];
    bot.sendMessage(msg.chat.id, `User ${uid} unbanned.`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, `User ${uid} not banned.`, { parse_mode: "Markdown" });
  }
});

// ================
// REGISTRATION
// ================
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  userState[chatId] = { stage: "regFirstName" };
  bot.sendMessage(chatId, botConfig.registrationWelcome, { parse_mode: "Markdown" });
});

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (msg.text && msg.text.startsWith("/")) return;
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
      bot.sendMessage(chatId, "Invalid phone number. Must start 07 or 01, 10 digits total.", { parse_mode: "Markdown" });
      return;
    }
    // complete registration
    userProfiles[chatId] = {
      firstName: state.firstName,
      lastName: state.lastName,
      phone
    };
    userBalances[chatId] = userBalances[chatId] || 0;
    if (!userReferralCodes[chatId]) {
      userReferralCodes[chatId] = generateReferralCode();
      userReferralBonuses[chatId] = 0;
    }
    const text = parsePlaceholders(botConfig.registrationSuccess, {
      firstName: state.firstName,
      lastName: state.lastName,
      referralCode: userReferralCodes[chatId]
    });
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
    delete userState[chatId];
  }
});

// If not registered
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId] && !msg.text.startsWith("/register")) {
    bot.sendMessage(chatId, "You are not registered. Type /register to begin.", { parse_mode: "Markdown" });
  }
});

// ================
// MAIN MENU
// ================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "You are not registered. /register first.", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  const fn = userProfiles[chatId].firstName || "";
  // 8 items: "Mining", "More money", "Referral bonus", "Profile", "HASH exchange", "Withdrawals", "Stats", "Promo codes"
  const keyboard = [
    [{ text: "Mining", callback_data: "menu:mining" }, { text: "More money", callback_data: "menu:moreMoney" }],
    [{ text: "Referral bonus", callback_data: "menu:refBonus" }, { text: "Profile", callback_data: "menu:profile" }],
    [{ text: "HASH exchange", callback_data: "menu:hash" }, { text: "Withdrawals", callback_data: "menu:withdraw" }],
    [{ text: "Stats", callback_data: "menu:stats" }, { text: "Promo codes", callback_data: "menu:promo" }]
  ];
  const text = parsePlaceholders(botConfig.mainMenuText, { firstName: fn });
  bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: keyboard },
    parse_mode: "Markdown"
  });
});

// handle main menu button clicks
bot.on("callback_query", async (cb) => {
  const data = cb.data;
  const msg = cb.message;
  if (!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  if (!userProfiles[chatId]) {
    bot.sendMessage(chatId, "You are not registered. /register", { parse_mode: "Markdown" });
    return;
  }
  if (bannedUsers[chatId]) {
    bot.sendMessage(chatId, `You are banned. Reason: ${bannedUsers[chatId].reason}`, { parse_mode: "Markdown" });
    return;
  }
  await bot.answerCallbackQuery(cb.id).catch(()=>{});
  
  switch(data) {
    case "menu:mining":
      // invests from balance
      userState[chatId] = { stage: "chooseInvestPackage" };
      const pkKeyboard = packages.map(p => ([{
        text: `${p.name} (Min Ksh ${p.min})`,
        callback_data: `invest:${p.name}`
      }]));
      pkKeyboard.push([{ text: "Back to Menu", callback_data: "backToMenu" }]);
      bot.sendMessage(chatId, botConfig.investPrompt, {
        reply_markup: { inline_keyboard: pkKeyboard },
        parse_mode: "Markdown"
      });
      break;
    case "menu:moreMoney":
      // deposit
      userState[chatId] = { stage: "awaitingDepositAmount" };
      bot.sendMessage(chatId, botConfig.depositIntro, { parse_mode: "Markdown" });
      break;
    case "menu:refBonus":
      // show referral code
      if (!userReferralCodes[chatId]) {
        userReferralCodes[chatId] = generateReferralCode();
        userReferralBonuses[chatId] = 0;
      }
      const code = userReferralCodes[chatId];
      const bonus = userReferralBonuses[chatId]||0;
      const link = `https://t.me/shankfy_bot?start=${code}`;
      bot.sendMessage(chatId, `Your referral code: ${code}\nReferral bonus: Ksh ${bonus}\nLink: ${link}`, { parse_mode: "Markdown" });
      break;
    case "menu:profile":
      // show profile
      const up = userProfiles[chatId];
      const bal = userBalances[chatId]||0;
      let histCount = depositHistory[chatId]? depositHistory[chatId].length:0;
      bot.sendMessage(chatId, `*Profile*\nName: ${up.firstName} ${up.lastName}\nPhone: ${up.phone}\nBalance: Ksh ${bal}\nDeposits: ${histCount}`, { parse_mode: "Markdown" });
      break;
    case "menu:hash":
      bot.sendMessage(chatId, "*HASH exchange placeholder.*", { parse_mode: "Markdown" });
      break;
    case "menu:withdraw":
      userState[chatId] = { stage: "awaitingWithdrawAmount" };
      bot.sendMessage(chatId, parsePlaceholders(botConfig.withdrawPrompt, {min: botConfig.withdrawMin, max: botConfig.withdrawMax}), { parse_mode: "Markdown" });
      break;
    case "menu:stats":
      // show stats
      let totalDepo = 0;
      Object.values(depositHistory).forEach(arr => {
        arr.forEach(r => totalDepo += r.amount);
      });
      let userCount = Object.keys(userProfiles).length;
      bot.sendMessage(chatId, `*Stats*\nUsers: ${userCount}\nTotal deposit: Ksh ${totalDepo}`, { parse_mode: "Markdown" });
      break;
    case "menu:promo":
      bot.sendMessage(chatId, "*Promo codes placeholder.*", { parse_mode: "Markdown" });
      break;
    case "backToMenu":
      bot.sendMessage(chatId, "Back to main menu. Type /start again.", { parse_mode: "Markdown" });
      break;
    default:
      // check if it's invest
      if (data.startsWith("invest:")) {
        const pkgName = data.split(":")[1];
        userState[chatId] = { stage: "investAmount", package: pkgName };
        bot.sendMessage(chatId, `How much do you want to invest in ${pkgName}?`, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, "Unknown option.", { parse_mode: "Markdown" });
      }
  }
});

// handle invest flow
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!userState[chatId]) return;
  const state = userState[chatId];
  if (state.stage==="investAmount") {
    const pkg = packages.find(p=>p.name===state.package);
    if(!pkg) {
      bot.sendMessage(chatId, "Package not found.", { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    const amt = parseInt(msg.text);
    if(isNaN(amt)||amt< pkg.min) {
      bot.sendMessage(chatId, `*Invalid amount.* Min for ${pkg.name} is Ksh ${pkg.min}.`, { parse_mode: "Markdown" });
      return;
    }
    const bal = userBalances[chatId]||0;
    if(amt>bal) {
      bot.sendMessage(chatId, parsePlaceholders(botConfig.investInsufficient, {package: pkg.name}), { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    userBalances[chatId] = bal-amt;
    const invCode = generateInvestmentCode();
    const dateNow = new Date().toLocaleString("en-GB", { timeZone: "Africa/Nairobi" });
    if(!depositHistory[chatId]) depositHistory[chatId]=[];
    depositHistory[chatId].push({
      invCode,
      amount: amt,
      package: pkg.name,
      depositNumber: "FromBalance",
      date: dateNow,
      status: "INVESTED",
      mpesaCode: ""
    });
    const profitVal = amt*(botConfig.profitRate/100);
    const profitTotal = (amt+profitVal).toFixed(2);
    const successMsg = parsePlaceholders(botConfig.investSuccess, {
      invCode,
      package: pkg.name,
      amount: String(amt),
      profitTotal,
      earningReturn: botConfig.earningReturn
    });
    bot.sendMessage(chatId, successMsg, { parse_mode: "Markdown" });
    sendAdminAlert(`User ${chatId} invested Ksh ${amt} in ${pkg.name}. INV: ${invCode}`);
    delete userState[chatId];
  }
});

// deposit from main menu
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!userState[chatId]) return;
  const state = userState[chatId];
  // deposit
  if (state.stage==="awaitingDepositAmount") {
    const amt = parseInt(msg.text);
    if(isNaN(amt)||amt<=0) {
      bot.sendMessage(chatId,"Invalid deposit amount.", { parse_mode: "Markdown" });
      return;
    }
    state.amount = amt;
    state.stage="awaitingDepositPhone";
    bot.sendMessage(chatId, botConfig.depositPhonePrompt, { parse_mode: "Markdown" });
  } else if (state.stage==="awaitingDepositPhone") {
    const phone = msg.text.trim();
    state.depositNumber=phone;
    state.stage="processingDeposit";
    const ref = await sendSTKPush(state.amount, phone);
    if(!ref) {
      bot.sendMessage(chatId, `*❌ Error:* ${botConfig.depositErrorMessage}`, { parse_mode: "Markdown" });
      delete userState[chatId];
      return;
    }
    const invCode=generateInvestmentCode();
    bot.sendMessage(chatId, parsePlaceholders(botConfig.paymentInitiated, {seconds:"20"}), { parse_mode: "Markdown" });
    setTimeout(()=>{
      bot.sendMessage(chatId, parsePlaceholders(botConfig.countdownUpdate, {seconds:"10"}), { parse_mode: "Markdown" });
    },10000);
    setTimeout(async()=>{
      const st = await fetchTransactionStatus(ref);
      if(!st) {
        bot.sendMessage(chatId, "*❌ Error fetching status.*", { parse_mode: "Markdown" });
        delete userState[chatId];
        return;
      }
      const finalStatus = st.status? st.status.toUpperCase():"UNKNOWN";
      const mpesaCode= st.provider_reference||"MPESA"+Math.floor(Math.random()*100000);
      const dateNow= new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"});
      const profitVal= state.amount*(botConfig.profitRate/100);
      const profitTotal= (state.amount+profitVal).toFixed(2);
      if(finalStatus==="SUCCESS") {
        userBalances[chatId] = (userBalances[chatId]||0)+ state.amount;
        if(!depositHistory[chatId]) depositHistory[chatId]=[];
        depositHistory[chatId].push({
          invCode,
          amount: state.amount,
          depositNumber: phone,
          date: dateNow,
          status: "SUCCESS",
          mpesaCode
        });
        const successTxt= parsePlaceholders(botConfig.depositSuccess,{
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
        bot.sendMessage(chatId,"*❌ Payment failed or pending.*",{ parse_mode:"Markdown"});
        sendAdminAlert(`*❌ Deposit Failed:* Ksh ${state.amount}\nUser: ${chatId}\nTime: ${dateNow}`);
      }
      delete userState[chatId];
    },20000);
  }
});

// ================
// WITHDRAWAL flow
// ================
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if(!userState[chatId]) return;
  const st= userState[chatId];
  if(st.stage==="awaitingWithdrawAmount") {
    const amt= parseInt(msg.text);
    if(isNaN(amt)||amt<botConfig.withdrawMin||amt>botConfig.withdrawMax) {
      bot.sendMessage(chatId, `Invalid withdraw amount. Must be between Ksh ${botConfig.withdrawMin} and ${botConfig.withdrawMax}.`, { parse_mode:"Markdown" });
      return;
    }
    st.withdrawAmount= amt;
    st.stage="awaitingWithdrawNumber";
    bot.sendMessage(chatId, botConfig.askWithdrawNumber,{ parse_mode:"Markdown"});
  } else if(st.stage==="awaitingWithdrawNumber") {
    const phone= msg.text.trim();
    if(!/^(07|01)\d{8}$/.test(phone)) {
      bot.sendMessage(chatId, "*⚠️ Invalid M-PESA number.*", { parse_mode:"Markdown"});
      return;
    }
    // check balance
    const bal= userBalances[chatId]||0;
    if(st.withdrawAmount>bal) {
      bot.sendMessage(chatId,"*⚠️ Insufficient funds.*",{ parse_mode:"Markdown"});
      delete userState[chatId];
      return;
    }
    // hold the money
    userBalances[chatId]= bal- st.withdrawAmount;
    const wid= nextWithdrawalID++;
    pendingWithdrawals[wid]= {
      chatId,
      amount: st.withdrawAmount,
      withdrawNumber: phone,
      date: new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"}),
      status:"pending",
      remark:""
    };
    bot.sendMessage(chatId, `*Withdrawal request for Ksh ${st.withdrawAmount} created.* Pending admin approval.`, { parse_mode:"Markdown"});
    delete userState[chatId];
  }
});

// ================
// Extra user commands: /balance, /packages, /history, /myreferral, /interest, /profile, /faq, /help, /ticket
// ================
bot.onText(/\/balance/, (msg) => {
  const chatId= msg.chat.id;
  const bal= userBalances[chatId]||0;
  bot.sendMessage(chatId, parsePlaceholders(botConfig.balanceMessage,{balance:String(bal)}), { parse_mode:"Markdown"});
});

bot.onText(/\/packages/, (msg) => {
  const txt= packages.map(p=>`• ${p.name}: min Ksh ${p.min}`).join("\n");
  bot.sendMessage(msg.chat.id, "*Available Packages:*\n"+txt, { parse_mode:"Markdown"});
});

bot.onText(/\/history/, (msg) => {
  const chatId= msg.chat.id;
  const hist= depositHistory[chatId]||[];
  if(!hist.length) {
    bot.sendMessage(chatId,"*No deposit history.*",{ parse_mode:"Markdown"});
    return;
  }
  let text="*Your Deposit History:*\n";
  hist.forEach((r,i)=>{
    text+=`${i+1}. INV: ${r.invCode} | Amount: ${r.amount} | MPESA: ${r.mpesaCode||"N/A"} | Date: ${r.date}\n`;
  });
  bot.sendMessage(chatId,text,{ parse_mode:"Markdown"});
});

bot.onText(/\/myreferral/, (msg) => {
  const chatId= msg.chat.id;
  if(!userReferralCodes[chatId]) {
    userReferralCodes[chatId]= generateReferralCode();
    userReferralBonuses[chatId]=0;
  }
  const code= userReferralCodes[chatId];
  const bonus= userReferralBonuses[chatId]||0;
  const link= `https://t.me/shankfy_bot?start=${code}`;
  bot.sendMessage(chatId,`Your referral code: ${code}\nBonus: Ksh ${bonus}\nLink: ${link}`,{ parse_mode:"Markdown"});
});

bot.onText(/\/interest/, (msg) => {
  const chatId= msg.chat.id;
  const bal= userBalances[chatId]||0;
  const interest= (bal*0.05).toFixed(2);
  bot.sendMessage(chatId, `Estimated monthly interest on your balance: Ksh ${interest}`, { parse_mode:"Markdown"});
});

bot.onText(/\/profile/, (msg) => {
  const chatId= msg.chat.id;
  const up= userProfiles[chatId]||{};
  const bal= userBalances[chatId]||0;
  let c= depositHistory[chatId]? depositHistory[chatId].length:0;
  bot.sendMessage(chatId, `*Profile*\nName: ${up.firstName||"N/A"} ${up.lastName||""}\nPhone: ${up.phone||"N/A"}\nBalance: Ksh ${bal}\nDeposits: ${c}`, { parse_mode:"Markdown"});
});

bot.onText(/\/faq/, (msg) => {
  bot.sendMessage(msg.chat.id,"*FAQ placeholder.*",{ parse_mode:"Markdown"});
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, botConfig.userHelp, { parse_mode:"Markdown"});
});

// support ticket
bot.onText(/\/ticket/, (msg) => {
  userState[msg.chat.id]= { stage:"ticketMsg" };
  bot.sendMessage(msg.chat.id,"*Please describe your issue:*",{ parse_mode:"Markdown"});
});

bot.on("message", (msg) => {
  const chatId= msg.chat.id;
  if(!userState[chatId]) return;
  const st= userState[chatId];
  if(st.stage==="ticketMsg") {
    const tid= nextTicketID++;
    supportTickets[tid]= {
      chatId,
      message: msg.text,
      date: new Date().toLocaleString("en-GB",{timeZone:"Africa/Nairobi"}),
      status:"pending",
      reply:""
    };
    bot.sendMessage(chatId, `*Support ticket created.* ID: ${tid}`, { parse_mode:"Markdown"});
    delete userState[chatId];
  }
});

// ================
// ADMIN
// ================
bot.onText(/\/admin/, (msg) => {
  if (msg.from.id===ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(), { parse_mode:"Markdown"});
    bot.sendMessage(msg.chat.id, "*Bot is successfully deployed and running!*", { parse_mode:"Markdown"});
  }
});

// /broadcast
bot.onText(/\/broadcast (.+)/, (msg, match) => {
  if(msg.from.id!==ADMIN_ID)return;
  const input= match[1];
  const start= input.indexOf("[");
  const end= input.indexOf("]");
  if(start<0||end<0) {
    bot.sendMessage(msg.chat.id,"Invalid format: /broadcast [id1,id2] message",{ parse_mode:"Markdown"});
    return;
  }
  const arr= input.substring(start+1,end).split(",").map(x=>x.trim());
  const broadcastText= input.substring(end+1).trim();
  arr.forEach(id=>{
    bot.sendMessage(id, `*${botConfig.fromAdmin}:*\n${broadcastText}`, { parse_mode:"Markdown"})
      .catch(()=> bot.sendMessage(msg.chat.id, `Could not message ${id}`, { parse_mode:"Markdown"}));
  });
  bot.sendMessage(msg.chat.id,"*Broadcast complete.*",{ parse_mode:"Markdown"});
});

// /addpackage <name> <min>
bot.onText(/\/addpackage (.+)/,(msg,match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const p= match[1].split(" ");
  if(p.length<2) {
    bot.sendMessage(msg.chat.id,"Usage: /addpackage <name> <min>", { parse_mode:"Markdown"});
    return;
  }
  const nm= p[0];
  const mn= parseInt(p[1]);
  packages.push({ name:nm, min:mn});
  bot.sendMessage(msg.chat.id,`Package ${nm} added with min Ksh ${mn}`, { parse_mode:"Markdown"});
});

// /editpackage <name> <newMin>
bot.onText(/\/editpackage (.+)/,(msg,match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const p= match[1].split(" ");
  if(p.length<2) {
    bot.sendMessage(msg.chat.id,"Usage: /editpackage <name> <newMin>",{ parse_mode:"Markdown"});
    return;
  }
  const nm= p[0];
  const mn= parseInt(p[1]);
  let pkg= packages.find(x=>x.name.toLowerCase()=== nm.toLowerCase());
  if(!pkg) {
    bot.sendMessage(msg.chat.id,"Package not found.",{ parse_mode:"Markdown"});
    return;
  }
  pkg.min= mn;
  bot.sendMessage(msg.chat.id, `Package ${pkg.name} updated to min Ksh ${mn}`, { parse_mode:"Markdown"});
});

// /referrals => list
bot.onText(/\/referrals/, (msg)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const keys= Object.keys(referralRequests);
  if(!keys.length) {
    bot.sendMessage(msg.chat.id,"No pending referrals.", { parse_mode:"Markdown"});
    return;
  }
  let txt= "*Pending referrals:*\n";
  keys.forEach(id=>{
    const r= referralRequests[id];
    txt+= `ID: ${id}, code: ${r.code}, referred: ${r.referred}, status: ${r.status}\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode:"Markdown"});
});

// approve <id>, decline <id>
bot.onText(/approve (\d+)/, (msg, match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const rid= match[1];
  const rr= referralRequests[rid];
  if(!rr) {
    bot.sendMessage(msg.chat.id,"Referral not found.",{ parse_mode:"Markdown"});
    return;
  }
  rr.status="approved";
  // parse code to get numeric
  const numeric= parseInt(rr.code.replace("FY'S-",""));
  if(!isNaN(numeric)) {
    if(!userReferralBonuses[numeric]) userReferralBonuses[numeric]=0;
    userReferralBonuses[numeric]+= botConfig.referralBonus;
    bot.sendMessage(msg.chat.id, `Referral ${rid} approved. Bonus to code ${rr.code}`,{ parse_mode:"Markdown"});
    // Also notify the referrer if we want
  }
});

bot.onText(/decline (\d+)/,(msg,match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const rid= match[1];
  const rr= referralRequests[rid];
  if(!rr) {
    bot.sendMessage(msg.chat.id,"Referral not found.",{ parse_mode:"Markdown"});
    return;
  }
  rr.status="declined";
  bot.sendMessage(msg.chat.id,`Referral ${rid} declined.`,{ parse_mode:"Markdown"});
});

// /withdrawlimits
bot.onText(/\/withdrawlimits/,(msg)=>{
  if(msg.from.id!==ADMIN_ID)return;
  bot.sendMessage(msg.chat.id,`Min: ${botConfig.withdrawMin}, Max: ${botConfig.withdrawMax}`,{ parse_mode:"Markdown"});
});

// /users => list
bot.onText(/\/users/,(msg)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const keys= Object.keys(userProfiles);
  if(!keys.length) {
    bot.sendMessage(msg.chat.id,"No users.",{ parse_mode:"Markdown"});
    return;
  }
  let txt= "*Registered users:*\n";
  keys.forEach(k=>{
    const u= userProfiles[k];
    txt+= `• ${k}: ${u.firstName} ${u.lastName}, phone: ${u.phone}\n`;
  });
  bot.sendMessage(msg.chat.id, txt, { parse_mode:"Markdown"});
});

// adjust <chatId> <amount>
bot.onText(/\/adjust (\d+) (-?\d+)/,(msg,match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const uid= match[1];
  const amt= parseInt(match[2]);
  if(!userBalances[uid]) userBalances[uid]=0;
  userBalances[uid]+= amt;
  bot.sendMessage(msg.chat.id,`User ${uid} new balance: Ksh ${userBalances[uid]}`,{ parse_mode:"Markdown"});
});

// /investment <chatId>
bot.onText(/\/investment (\d+)/,(msg,match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const uid= match[1];
  const hist= depositHistory[uid]||[];
  if(!hist.length) {
    bot.sendMessage(msg.chat.id,"No investments for user.",{ parse_mode:"Markdown"});
    return;
  }
  const last= hist[hist.length-1];
  bot.sendMessage(msg.chat.id,`INV: ${last.invCode}\nAmount: Ksh ${last.amount}\nDepositNo: ${last.depositNumber}\nDate: ${last.date}\nStatus: ${last.status}\nMPESA: ${last.mpesaCode||"N/A"}`,{ parse_mode:"Markdown"});
});

// tickets
bot.onText(/\/tickets/,(msg)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const keys= Object.keys(supportTickets);
  if(!keys.length) {
    bot.sendMessage(msg.chat.id,"No support tickets.",{ parse_mode:"Markdown"});
    return;
  }
  let txt="*Support Tickets:*\n";
  keys.forEach(id=>{
    const t= supportTickets[id];
    txt+= `ID: ${id}, user: ${t.chatId}, date: ${t.date}, status: ${t.status}\nMessage: ${t.message}\n\n`;
  });
  bot.sendMessage(msg.chat.id, txt,{ parse_mode:"Markdown"});
});

// replyticket <id> <message>
bot.onText(/replyticket (\d+) (.+)/,(msg,match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const tid= match[1];
  const rep= match[2];
  const t= supportTickets[tid];
  if(!t) {
    bot.sendMessage(msg.chat.id,"Ticket not found.",{ parse_mode:"Markdown"});
    return;
  }
  t.status="replied";
  t.reply= rep;
  bot.sendMessage(msg.chat.id, `Ticket ${tid} replied.`,{ parse_mode:"Markdown"});
  bot.sendMessage(t.chatId, `*Support Ticket Reply*\n${rep}`,{ parse_mode:"Markdown"});
});

// /admin => show help
bot.onText(/\/admin/,(msg)=>{
  if(msg.from.id===ADMIN_ID) {
    bot.sendMessage(msg.chat.id, getAdminHelp(),{ parse_mode:"Markdown"});
    bot.sendMessage(msg.chat.id, "Bot is successfully deployed and running!",{ parse_mode:"Markdown"});
  }
});

// edit <key> <newValue>
bot.onText(/edit (.+)/,(msg,match)=>{
  if(msg.from.id!==ADMIN_ID)return;
  const parts= match[1].split(" ");
  if(parts.length<2) {
    bot.sendMessage(msg.chat.id,"Usage: edit <key> <newValue>",{ parse_mode:"Markdown"});
    return;
  }
  const key= parts[0];
  const newValue= match[1].substring(key.length).trim();
  if(!Object.prototype.hasOwnProperty.call(botConfig, key)) {
    bot.sendMessage(msg.chat.id,"Invalid key.",{ parse_mode:"Markdown"});
    return;
  }
  if(["referralBonus","withdrawMin","withdrawMax","profitRate","channelID"].includes(key)) {
    const valNum= parseInt(newValue);
    if(isNaN(valNum)) {
      bot.sendMessage(msg.chat.id,"Value must be a number.",{ parse_mode:"Markdown"});
      return;
    }
    botConfig[key]= valNum;
    bot.sendMessage(msg.chat.id, `${key} updated to ${valNum}`,{ parse_mode:"Markdown"});
  } else {
    botConfig[key]= newValue;
    bot.sendMessage(msg.chat.id, `${key} updated.`,{ parse_mode:"Markdown"});
  }
});
