// bot.js — Telegram Upload Bot (FSM + pending system)
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const STATE_FILE = path.join(process.cwd(), "bot_state.json");

const PENDING_DIR = path.join(process.cwd(), "pending");
if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({}), "utf8");
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(st) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), "utf8");
}

// Send message
async function sendMessage(chatId, text) {
  await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

// Download Telegram file
async function getFilePath(file_id) {
  const r = await fetch(`${API}/getFile?file_id=${file_id}`);
  const j = await r.json();
  return j.result.file_path;
}

async function downloadFile(tgPath, dest) {
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgPath}`;
  const r = await fetch(url);
  const buffer = await r.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(buffer));
}

// Poll updates
let offset = 0;

async function poll() {
  try {
    const res = await fetch(`${API}/getUpdates?offset=${offset}`);
    const data = await res.json();

    if (!data.result) return setTimeout(poll, 1500);

    const state = loadState();

    for (const upd of data.result) {
      offset = upd.update_id + 1;

      const msg = upd.message;
      if (!msg) continue;

      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const text = msg.text || "";
      const hasPhoto = msg.photo;

      // init state for this user
      if (!state[userId]) {
        state[userId] = { step: "idle", tmpBase: null };
      }

      // Handle /start
      if (text === "/start") {
        state[userId].step = "idle";
        saveState(state);
        await sendMessage(chatId, "أهلاً! ابعتلي صورة علشان نبدأ عملية الرفع 👌");
        continue;
      }

      // ==== STEP 1: expecting image ====
      if (hasPhoto && state[userId].step === "idle") {
        const bestPhoto = msg.photo[msg.photo.length - 1];
        const file_id = bestPhoto.file_id;

        const tgpath = await getFilePath(file_id);
        const baseName = "item_" + Date.now();

        const imgPath = path.join(PENDING_DIR, baseName + ".jpg");
        await downloadFile(tgpath, imgPath);

        state[userId].step = "need_prompt";
        state[userId].tmpBase = baseName;
        saveState(state);

        await sendMessage(chatId, "تم حفظ الصورة 📸\nارسل البرومبت (النص)");
        continue;
      }

      // ==== STEP 2: expecting prompt ====
      if (state[userId].step === "need_prompt" && text.length > 0) {
        const base = state[userId].tmpBase;
        const dest = path.join(PENDING_DIR, base + ".txt");
        fs.writeFileSync(dest, text, "utf8");

        state[userId].step = "need_title";
        saveState(state);

        await sendMessage(chatId, "تمام 👌\nدلوقتي ابعت العنوان النصي القصير للصورة");
        continue;
      }

      // ==== STEP 3: expecting title ====
      if (state[userId].step === "need_title" && text.length > 0) {
        const base = state[userId].tmpBase;
        const dest = path.join(PENDING_DIR, base + "_title.txt");
        fs.writeFileSync(dest, text, "utf8");

        state[userId].step = "idle";
        state[userId].tmpBase = null;
        saveState(state);

        await sendMessage(chatId, `تم حفظ كل البيانات بنجاح 🎉\nسيتم رفعها تلقائيًا خلال 10 دقائق.\nالاسم: ${base}`);
        continue;
      }

      // If user sends something unexpected
      if (state[userId].step !== "idle") {
        await sendMessage(chatId, "مش مفهوم 🤔\nلو عايز تعيد العملية اكتب /start");
      }
    }

  } catch (e) {
    console.error("poll error:", e);
  }

  setTimeout(poll, 1500);
}

poll();
