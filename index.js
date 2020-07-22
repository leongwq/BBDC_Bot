require("dotenv").config();
const http = require('http');
const axios = require("axios");
const qs = require("querystring");
const cheerio = require("cheerio");
const {
  Telegraf
} = require("telegraf");
const cron = require('node-cron');
const moment = require('moment-timezone');
const BBDC_URL = "http://www.bbdc.sg/bbdc/bbdc_web/newheader.asp";
const BBDC_LOGIN_URL = "http://www.bbdc.sg/bbdc/bbdc_web/header2.asp";
const BBDC_SLOTS_LISTING_URL = "http://www.bbdc.sg/bbdc/b-3c-pLessonBooking1.asp";
const BBDC_BOOKING_URL = "https://www.bbdc.sg/bbdc/b-3c-pLessonBookingDetails.asp";
var http = require('http');

// const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const Telegram = require("telegraf/telegram");
const telegram = new Telegram(process.env.TELEGRAM_TOKEN);
let session = "";

main = async () => {
  telegram.sendMessage(
    process.env.TELEGRAM_CHAT_ID,
    `BBDC Bot started with the following config\n<code>Months: ${process.env.PREF_MONTH}\nDay: ${process.env.PREF_DAY}\nSession: ${process.env.PREF_SESSION}</code>`, {
      parse_mode: "HTML"
    }
  );
  const [cookie] = await getCookie();
  [session] = cookie.split(";");
  await login();
  scheduleJob();
};

scheduleJob =  () => {
  // Check for auto book
  cron.schedule('*/15 * * * *', async () => {
    ping(); // For heroku
    const slots = await getSlots(session, populatePreference());
    // Check for auto book
    autoBook(slots);
    sendPrettifiedSlotsMessage(slots);
  });
};

getCookie = async () => {
  try {
    const response = await axios.get(BBDC_URL);
    return response.headers["set-cookie"];
  } catch (error) {
    console.error(error);
  }
};

login = async () => {
  console.log("Starting log in");
  try {
    const data = {
      txtNRIC: process.env.NRIC,
      txtPassword: process.env.BBDC_PASSWORD,
      btnLogin: " ",
    };
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session,
      },
    };
    await axios.post(BBDC_LOGIN_URL, qs.stringify(data), config);
  } catch (error) {
    console.error(error);
  }
};

getSlots = async (preference) => {
  console.log("Checking slots");
  try {
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session,
      },
    };
    const response = await axios.post(
      BBDC_SLOTS_LISTING_URL,
      qs.stringify(preference),
      config
    );
    return parseSlotsListing(response.data);
  } catch (error) {
    console.error(error);
  }
};

createBooking = async (slotID) => {
  console.log("Slot booking started");
  try {
    const data = {
      accId: process.env.ACCID,
      slot: slotID,
    };
    const config = {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: session,
      },
    };
    const response = await axios.post(
      BBDC_BOOKING_URL,
      qs.stringify(preference),
      config
    );
    return parseSlotsListing(response.data);
  } catch (error) {
    console.error(error);
  }
};

autoBook = async (slots) => {
  const today = moment.tz("Asia/Singapore");
  for (slot in slots) {
    const dateStr = (slots[slot]["date"]).split(" ");
    const date = moment(dateStr[0], "D/M/YYYY");
    console.log('%c%s', 'color: #bfffc8', date);
    if (date.diff(today, 'days') >= 3) {
      createBooking(slot);
      telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, "Booking slot for " + slots[slot]["date"] + ". From " + slots[slot]["start"] + " to " + slots[slot]["date"] + ". Please verify booking");
    }
  }
};

populatePreference = () => {
  const data = {
    accid: process.env.ACCID,
    optVenue: "1",
    defPLVenue: "1",
    DAY: [],
    SESSION: [],
    MONTH: [],
  };

  const days = process.env.PREF_DAY;
  const sessions = process.env.PREF_SESSION;
  const months = process.env.PREF_MONTH;

  for (day of days.split(",")) {
    data.DAY.push(day);
  }

  for (session of sessions.split(",")) {
    data.SESSION.push(session);
  }

  for (month of months.split(",")) {
    data.MONTH.push(month);
  }

  return data;
};

parseSlotsListing = (data) => {
  let re = /"(.*?)"/g;
  let slots = {};
  const $ = cheerio.load(data);
  $(
    "#myform > table:nth-child(2) > tbody > tr:nth-child(10) > td > table > tbody > tr > td[onmouseover]"
  ).each(function (i, elem) {
    let slotInfo = $(this).attr("onmouseover").matchAll(re);
    slotInfo = Array.from(slotInfo);
    const slotID = $(this).children().attr("value");
    const date = slotInfo[0][1];
    const session = slotInfo[1][1];
    const start = slotInfo[2][1];
    const end = slotInfo[3][1];

    let informationStr = `New slot found on ${date}, Session: ${session} (${start} - ${end})`;
    slots[slotID] = {
      info: informationStr,
      date: date,
      session: session
    };
  });
  return slots;
};

sendPrettifiedSlotsMessage = async (data) => {
  if (Object.keys(data).length === 0) {
    console.log("Unable to find any slots")
    // const res = await telegram.sendMessage(
    //   process.env.TELEGRAM_CHAT_ID,
    //   "Unable to find any available slots"
    // );
    // setTimeout(function () {
    //   deleteMessage(res.message_id);
    // }, 5000);
    return;
  }

  let message = "";
  for (slot in data) {
    message = message + "🚗 " + data[slot].info + "\n";
  }
  telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
};

deleteMessage = (messageID) => {
  telegram.deleteMessage(process.env.TELEGRAM_CHAT_ID, messageID);
};

ping = () => {
  axios(process.env.HEROKU_URL);
}

http.createServer(function (req, res) {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Alive!');
}).listen(8000);

main();