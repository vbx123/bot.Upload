const fs = require('fs');
const path = require('path');

const PENDING_DIR = path.join(process.cwd(), 'pending');
const images_DIR = path.join(process.cwd(), 'images');
const PROMPTS_DIR = path.join(process.cwd(), 'Prompts');
const DATA_FILE = path.join(process.cwd(), 'data.json');

if (!fs.existsSync(images_DIR)) fs.mkdirSync(images_DIR);
if (!fs.existsSync(PROMPTS_DIR)) fs.mkdirSync(PROMPTS_DIR);
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const files = fs.readdirSync(PENDING_DIR);

const completed = [];

for (const file of files) {
  const match = file.match(/^(item_\d+)(?:_title)?\.(jpg|txt)$/);
  if (!match) continue;

  const base = match[1];
  const ext = match[2];

  if (ext === 'jpg') {
    fs.renameSync(path.join(PENDING_DIR, file), path.join(PHOTOS_DIR, file));
  } else if (ext === 'txt' && !file.includes('_title')) {
    fs.renameSync(path.join(PENDING_DIR, file), path.join(PROMPTS_DIR, file));
  } else if (ext === 'txt' && file.includes('_title')) {
    // العنوان
    const title = fs.readFileSync(path.join(PENDING_DIR, file), 'utf8');
    const imgFile = `photos/${base}.jpg`;
    const promptFile = `prompts/${base}.txt`;

    data.push({
      image: imgFile,
      prompt: promptFile,
      title: title,
      date: new Date().toISOString()
    });

    completed.push(base);

    // remove title file
    fs.unlinkSync(path.join(PENDING_DIR, file));
  }
}

// save updated data.json
fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

console.log('Completed items:', completed.join(', '));
