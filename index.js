require("dotenv").config();
const express = require('express')
const axios = require("axios");
const qs = require("querystring");
const cheerio = require("cheerio");
const cron = require('node-cron');
const moment = require('moment-timezone');
const BBDC_URL = "http://www.bbdc.sg/bbdc/bbdc_web/newheader.asp";
const BBDC_LOGIN_URL = "http://www.bbdc.sg/bbdc/bbdc_web/header2.asp";
const BBDC_SLOTS_LISTING_URL = "http://www.bbdc.sg/bbdc/b-3c-pLessonBooking1.asp";
const BBDC_BOOKING_URL = "http://www.bbdc.sg/bbdc/b-3c-pLessonBookingDetails.asp";

const Telegram = require("telegraf/telegram");
const telegram = new Telegram(process.env.TELEGRAM_TOKEN);
let loginSession;
// Stores all slots discovered here so that same slot wont be notified everytime the bot checks
let slotHistory = {};

const app = express()
const PORT = process.env.PORT || 3000;

main = async () => {
  telegram.sendMessage(
    process.env.TELEGRAM_CHAT_ID,
    `BBDC Bot started with the following config\n<code>Months: ${process.env.PREF_MONTH}\nDay: ${process.env.PREF_DAY}\nSession: ${process.env.PREF_SESSION}\nAuto Book: ${process.env.AUTO_BOOK}</code>`, {
      parse_mode: "HTML"
    }
  );
  scheduleJob();
};

scheduleJob = () => {
  // Check for auto book
  cron.schedule('*/10 * * * *', async () => {
    ping(); // For heroku
    const [cookie] = await getCookie();
    [loginSession] = cookie.split(";");
    await login();
    const slots = await getSlots(populatePreference());
    sendPrettifiedSlotsMessage(slots);
    // Check for auto book
    if (process.env.AUTO_BOOK || false){
      console.log("Auto book is enabled. Attempting to book")
      autoBook(slots);
    }
    // Adds to history
    slotHistory = {
      ... slots,
      ... slotHistory
    };
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
        Cookie: loginSession,
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
        Cookie: loginSession,
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
        Cookie: loginSession,
      },
    };
    const response = await axios.post(
      BBDC_BOOKING_URL,
      qs.stringify(data),
      config
    );
    const $ = cheerio.load(response.data);
    let errorMessage = $(
      "body > table > tbody > tr > td:nth-child(2) > form > table > tbody > tr:nth-child(1) > td > table > tbody > tr:nth-child(3) > td.errtblmsg"
    )
    if (errorMessage.is(".errtblmsg")) {
      telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, errorMessage.text());
    }

  } catch (error) {
    console.error(error);
  }
};

autoBook = async (slots) => {
  const today = moment.tz("Asia/Singapore");
  for (slot in slots) {
    const dateStr = (slots[slot]["date"]).split(" ");
    const date = moment(dateStr[0], "D/M/YYYY");
    if (date.diff(today, 'days') >= 3) {
      createBooking(slot);
      telegram.sendMessage(process.env.TELEGRAM_CHAT_ID, "Booking slot for " + slots[slot]["date"] + ". From " + slots[slot]["start"] + " to " + slots[slot]["end"] + ". Please verify booking");
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

    if (!(slotID in slotHistory)) {
      let informationStr = `New slot found on ${date}, Session: ${session} (${start} - ${end})`;
      slots[slotID] = {
        info: informationStr,
        date: date,
        start: start,
        end: end,
        session: session
      };
    }

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
  axios.get(process.env.HEROKU_URL);
}

app.get('/', (req, res) => res.send('Hello World!'))

app.listen(PORT, () => console.log(`BBDC bot listening on port:${PORT}`))

main();