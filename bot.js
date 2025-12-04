// bot.js  (CommonJS, ready for GitHub Actions)
// Node 18, requires node-fetch v2
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;           // ضع التوكن في Secrets
const CHANNEL_ID = Number(process.env.CHANNEL_ID); // ضع -100... في Secrets

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is missing. Add it to repository secrets as BOT_TOKEN');
  process.exit(1);
}
if (!CHANNEL_ID) {
  console.error('❌ CHANNEL_ID is missing. Add it to repository secrets as CHANNEL_ID (e.g. -100123...)');
  process.exit(1);
}

// مسارات
const PHOTO_DIR = path.join(process.cwd(), 'photo');
const PROMPT_DIR = path.join(process.cwd(), 'prompts');
const DATA_FILE = path.join(process.cwd(), 'data.json');
const LAST_UPDATE_FILE = path.join(process.cwd(), 'last_update.json');

// تأكد وجود المجلدات/الملفات
if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });
if (!fs.existsSync(PROMPT_DIR)) fs.mkdirSync(PROMPT_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
if (!fs.existsSync(LAST_UPDATE_FILE)) fs.writeFileSync(LAST_UPDATE_FILE, JSON.stringify({ last_update_id: 0 }), 'utf8');

function loadData(){
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch(e){
    console.warn('Warning: data.json invalid, resetting to []');
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
    return [];
  }
}
function saveData(arr){
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), 'utf8');
}
function loadLastUpdate(){
  try {
    const obj = JSON.parse(fs.readFileSync(LAST_UPDATE_FILE, 'utf8'));
    return obj.last_update_id || 0;
  } catch(e){
    return 0;
  }
}
function saveLastUpdate(id){
  fs.writeFileSync(LAST_UPDATE_FILE, JSON.stringify({ last_update_id: id }), 'utf8');
}

async function safeFetchJson(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch(e){
    throw new Error(`Invalid JSON from ${url}: ${text}`);
  }
}

async function getUpdates() {
  // getUpdates without offset returns recent updates; we'll filter by last_update_id
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;
  const data = await safeFetchJson(url);
  if (!data.ok) {
    throw new Error('getUpdates failed: ' + JSON.stringify(data));
  }
  return data.result || [];
}

async function getFilePath(file_id){
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`;
  const data = await safeFetchJson(url);
  if (!data.ok) throw new Error('getFile failed: ' + JSON.stringify(data));
  return data.result.file_path; // e.g. photos/file_123.jpg
}

async function downloadFileTo(file_path, destLocalPath){
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(destLocalPath, Buffer.from(buffer));
}

function ensureUniqueBase(base) {
  // returns unique base (no extension)
  let name = base;
  let i = 1;
  while (fs.existsSync(path.join(PHOTO_DIR, `${name}.jpg`)) || fs.existsSync(path.join(PROMPT_DIR, `${name}.txt`))) {
    name = `${base}_${i++}`;
  }
  return name;
}

async function processOnce(){
  console.log('🔎 Checking for channel updates...');
  const lastUpdateId = loadLastUpdate();
  console.log('Last processed update id:', lastUpdateId);

  const updates = await getUpdates();
  if (!Array.isArray(updates) || updates.length === 0) {
    console.log('ℹ️ No updates returned by getUpdates()');
    return;
  }

  // sort by update_id ascending
  updates.sort((a,b)=> (a.update_id||0) - (b.update_id||0));

  const data = loadData();
  let newLast = lastUpdateId;
  let addedCount = 0;

  for (const upd of updates) {
    const uId = upd.update_id || 0;
    if (uId <= lastUpdateId) continue; // already processed

    // message might be in channel_post for channel messages
    const msg = upd.channel_post || upd.message;
    if (!msg) {
      // update type not message/channel_post — skip
      newLast = Math.max(newLast, uId);
      continue;
    }

    // verify chat id equals our CHANNEL_ID
    if (!msg.chat || Number(msg.chat.id) !== Number(CHANNEL_ID)) {
      newLast = Math.max(newLast, uId);
      continue;
    }

    // we only want posts that have photo(s) and a caption (text)
    if (!msg.photo || !msg.caption) {
      console.log(`skip update ${uId}: not photo+caption`);
      newLast = Math.max(newLast, uId);
      continue;
    }

    try {
      // pick highest-resolution photo (last)
      const photoArr = msg.photo;
      const best = photoArr[photoArr.length - 1];
      const file_id = best.file_id;

      const baseCandidate = `img_${msg.message_id || msg.message_id || uId}`;
      const baseName = ensureUniqueBase(baseCandidate);
      const localImg = path.join(PHOTO_DIR, `${baseName}.jpg`);
      const localPrompt = path.join(PROMPT_DIR, `${baseName}.txt`);

      console.log(`⬇️ Downloading file for update ${uId} -> ${localImg}`);
      const remotePath = await getFilePath(file_id);
      await downloadFileTo(remotePath, localImg);
      console.log('Saved image:', localImg);

      // save prompt text (caption)
      const captionText = String(msg.caption || '').trim();
      fs.writeFileSync(localPrompt, captionText, 'utf8');
      console.log('Saved prompt:', localPrompt);

      // append to data.json
      data.push({
        image: path.join('photo', `${baseName}.jpg`),
        prompt: path.join('prompts', `${baseName}.txt`),
        message_id: msg.message_id || null,
        update_id: uId,
        date: new Date().toISOString()
      });
      addedCount++;

      // update last
      newLast = Math.max(newLast, uId);

    } catch(err){
      console.error('Error processing update', uId, err);
      // still set newLast so we won't hang on this update forever
      newLast = Math.max(newLast, uId);
    }
  } // end for

  if (addedCount > 0) {
    saveData(data);
    console.log(`🎉 Added ${addedCount} new items to data.json`);
  } else {
    console.log('ℹ️ No new items added');
  }

  // save new last_update_id
  if (newLast > lastUpdateId) {
    saveLastUpdate(newLast);
    console.log('Saved last_update_id =', newLast);
  } else {
    console.log('No update to last_update_id');
  }
}

processOnce()
  .then(()=>{ console.log('Done'); })
  .catch(err=>{ console.error('Fatal error', err); process.exit(1); });