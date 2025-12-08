import json
import os
from telegram import Update, InputFile
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes

# Load config
with open("config.json", "r", encoding="utf-8") as f:
    CONFIG = json.load(f)

PASSWORD = CONFIG["password"]

AUTHORIZED_USERS = []  # سيتم ملؤه بالأرقام المسجلة

PENDING_FILE = "pending.json"
DATA_FILE = "data.json"

# --------------------------------------
# Helper Functions
# --------------------------------------
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


# --------------------------------------
# Conversation States
# --------------------------------------
USER_STATE = {}   # {user_id: "await_photo"/"await_prompt"/"await_title"}

TEMP_DATA = {}    # {user_id: {"image_file_id":..., "prompt":..., "title":...}}


# --------------------------------------
# START with password authentication
# --------------------------------------
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("من فضلك أرسل كلمة السر:")
    USER_STATE[update.effective_user.id] = "await_password"


async def handle_password(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if USER_STATE.get(user_id) != "await_password":
        return

    if update.message.text == PASSWORD:
        AUTHORIZED_USERS.append(user_id)
        USER_STATE[user_id] = None
        await update.message.reply_text("تم تسجيل الدخول بنجاح!\nأرسل /new لبدء رفع طلب جديد.")
    else:
        await update.message.reply_text("❌ كلمة سر غير صحيحة.")
        USER_STATE[user_id] = "await_password"


# --------------------------------------
# Start new upload process
# --------------------------------------
async def new(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if user_id not in AUTHORIZED_USERS:
        await update.message.reply_text("❌ غير مسموح. أرسل /start أولًا.")
        return

    USER_STATE[user_id] = "await_photo"
    TEMP_DATA[user_id] = {}
    await update.message.reply_text("📸 أرسل الصورة الآن.")


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    if USER_STATE.get(user_id) != "await_photo":
        return

    photo = update.message.photo[-1]
    TEMP_DATA[user_id]["image_file_id"] = photo.file_id

    USER_STATE[user_id] = "await_prompt"
    await update.message.reply_text("✏ أرسل البرومت الآن.")


async def handle_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    if USER_STATE.get(user_id) != "await_prompt":
        return

    TEMP_DATA[user_id]["prompt"] = update.message.text

    USER_STATE[user_id] = "await_title"
    await update.message.reply_text("📝 أرسل العنوان الآن.")


async def handle_title(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id

    if USER_STATE.get(user_id) != "await_title":
        return

    TEMP_DATA[user_id]["title"] = update.message.text

    # Save to pending.json
    pending = load_pending()
    pending.append({
        "user": user_id,
        "image_file_id": TEMP_DATA[user_id]["image_file_id"],
        "prompt": TEMP_DATA[user_id]["prompt"],
        "title": TEMP_DATA[user_id]["title"]
    })

    save_pending(pending)

    USER_STATE[user_id] = None
    TEMP_DATA[user_id] = {}

    await update.message.reply_text("✓ تم تسجيل الطلب بنجاح!\nسيتم رفعه عند تشغيل GitHub Actions.")


# --------------------------------------
# Commands to view data
# --------------------------------------
async def pending(update: Update, context: ContextTypes.DEFAULT_TYPE):
    p = load_pending()
    if not p:
        await update.message.reply_text("لا يوجد طلبات معلقة.")
        return

    msg = "📌 الطلبات المعلقة:\n\n"
    for item in p:
        msg += f"- {item['title']}\n"

    await update.message.reply_text(msg)


async def uploaded(update: Update, context: ContextTypes.DEFAULT_TYPE):
    data = load_data()
    if not data:
        await update.message.reply_text("لا يوجد طلبات مرفوعة.")
        return

    msg = "📁 الطلبات المرفوعة:\n\n"
    for item in data:
        msg += f"- {item['title']}\n"

    await update.message.reply_text(msg)


async def get_item(update: Update, context: ContextTypes.DEFAULT_TYPE):
    title = " ".join(context.args)
    data = load_data()

    for item in data:
        if item["title"] == title:
            msg = f"📄 العنوان: {item['title']}\n📅 التاريخ: {item['date']}\n📁 الصورة: {item['image']}\n📄 البرومت: {item['prompt']}"
            await update.message.reply_text(msg)
            return

    await update.message.reply_text("❌ لا يوجد طلب بهذا الاسم.")


# --------------------------------------
# Main
# --------------------------------------
async def main():
    TOKEN = os.environ.get("BOT_TOKEN")

    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("new", new))
    app.add_handler(CommandHandler("pending", pending))
    app.add_handler(CommandHandler("uploaded", uploaded))
    app.add_handler(CommandHandler("get", get_item))

    app.add_handler(MessageHandler(filters.TEXT, handle_password))
    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.TEXT, handle_prompt))
    app.add_handler(MessageHandler(filters.TEXT, handle_title))

    await app.run_polling()

import asyncio
asyncio.run(main())
