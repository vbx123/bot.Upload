import os
import json
import requests
from datetime import datetime

BOT_TOKEN = os.environ["BOT_TOKEN"]

PENDING_FILE = "pending.json"
DATA_FILE = "data.json"
IMG_DIR = "images/"
PRM_DIR = "Prompts/"

os.makedirs(IMG_DIR, exist_ok=True)
os.makedirs(PRM_DIR, exist_ok=True)

def load_pending():
    if not os.path.exists(PENDING_FILE):
        return []
    with open(PENDING_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_pending(data):
    with open(PENDING_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_data():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

pending = load_pending()
data = load_data()

new_pending = []

for item in pending:
    title = item["title"].replace(" ", "_")

    image_name = f"{title}.png"
    prompt_name = f"{title}.txt"

    img_path = IMG_DIR + image_name
    txt_path = PRM_DIR + prompt_name

    # Download image from Telegram
    file_info = requests.get(
        f"https://api.telegram.org/bot{BOT_TOKEN}/getFile?file_id={item['image_file_id']}"
    ).json()

    file_path = file_info["result"]["file_path"]

    img_url = f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}"

    img_data = requests.get(img_url).content

    with open(img_path, "wb") as f:
        f.write(img_data)

    # Save prompt
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(item["prompt"])

    # Add to data.json
    data.append({
        "image": img_path,
        "prompt": txt_path,
        "title": item["title"],
        "date": datetime.now().strftime("%Y-%m-%d")
    })

# Save updated data.json
with open(DATA_FILE, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

# Clear pending
save_pending([])

print("DONE")
