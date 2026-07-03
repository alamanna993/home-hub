import os
import logging
import httpx
from dotenv import load_dotenv
from telegram import Update
from telegram.constants import ParseMode, ChatAction
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("homehub-telegram")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
ALLOWED_CHAT_IDS: set[int] = set()

_raw_allowed = os.getenv("TELEGRAM_ALLOWED_CHAT_IDS", "")
for part in _raw_allowed.split(","):
    part = part.strip()
    if part.lstrip("-").isdigit():
        ALLOWED_CHAT_IDS.add(int(part))


async def call_backend(path: str, method: str = "GET", json: dict = None) -> dict:
    headers = {"X-API-Key": INTERNAL_API_KEY} if INTERNAL_API_KEY else {}
    async with httpx.AsyncClient(timeout=60.0, headers=headers) as client:
        if method == "POST":
            r = await client.post(f"{BACKEND_URL}{path}", json=json)
        else:
            r = await client.get(f"{BACKEND_URL}{path}")
        r.raise_for_status()
        return r.json()


def authorized(update: Update) -> bool:
    if not ALLOWED_CHAT_IDS:
        return True
    return update.effective_chat is not None and update.effective_chat.id in ALLOWED_CHAT_IDS


def item_text(item: dict) -> str:
    loc = item.get("location")
    loc_str = "Unknown"
    if loc:
        loc_str = loc["name"]
        if loc.get("sublocation"):
            loc_str += f" — {loc['sublocation']}"
    cat = item.get("category")
    icon = cat["icon"] if cat and cat.get("icon") else "📦"
    qty = f"{item.get('quantity', '—')} {item.get('unit') or ''}".strip()
    lines = [f"{icon} *{item['name']}*", f"📍 {loc_str}", f"📦 Qty: {qty}"]
    if item.get("notes"):
        lines.append(f"💬 {item['notes']}")
    if item.get("is_low_stock"):
        lines.append("⚠️ Running low!")
    return "\n".join(lines)


async def start_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    await update.message.reply_text(
        "🏠 *HomeHub Bot*\n"
        "Ask me about your home in plain language:\n\n"
        "• where is my drill?\n"
        "• added 2 boxes of pasta to pantry\n"
        "• we're out of milk\n"
        "• what can I make for dinner tonight?\n\n"
        "Commands: /stats /lowstock /find <name> /help\n\n"
        f"(This chat ID: `{update.effective_chat.id}`)",
        parse_mode=ParseMode.MARKDOWN,
    )


async def stats_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    try:
        data = await call_backend("/items/stats")
        lines = [
            "📊 *Inventory Stats*",
            f"📦 Total items: {data['total_items']}",
            f"⚠️ Low stock: {data['low_stock_count']}",
        ]
        cats = [c for c in data["by_category"] if c["count"] > 0]
        if cats:
            lines.append("")
            lines += [f"{c['icon'] or '•'} {c['name']}: {c['count']}" for c in cats]
        await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        await update.message.reply_text(f"❌ Error: {e}")


async def lowstock_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    try:
        items = await call_backend("/items/?low_stock_only=true")
        if not items:
            await update.message.reply_text("✅ Nothing is running low right now.")
            return
        lines = ["⚠️ *Running Low*"]
        for item in items:
            qty = f"{item.get('quantity', 0)} {item.get('unit') or ''}".strip()
            loc = item.get("location")
            lines.append(f"• {item['name']} — {qty} left ({loc['name'] if loc else '?'})")
        await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        await update.message.reply_text(f"❌ Error: {e}")


async def find_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    name = " ".join(context.args) if context.args else ""
    if not name:
        await update.message.reply_text("Usage: /find <item name>")
        return
    try:
        items = await call_backend(f"/items/?search={name}")
        if not items:
            await update.message.reply_text(f"❌ Couldn't find *{name}* in the inventory.", parse_mode=ParseMode.MARKDOWN)
        else:
            await update.message.reply_text(item_text(items[0]), parse_mode=ParseMode.MARKDOWN)
    except Exception as e:
        await update.message.reply_text(f"❌ Error: {e}")


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update) or not update.message or not update.message.text:
        return
    await update.effective_chat.send_action(ChatAction.TYPING)
    try:
        result = await call_backend("/chat/", "POST", {
            "message": update.message.text,
            "source": f"telegram:{update.effective_user.first_name if update.effective_user else 'unknown'}",
        })
        reply = result.get("reply", "Sorry, I didn't understand that.")
        # Backend replies use **bold** — Telegram Markdown uses *bold*
        reply = reply.replace("**", "*")
        try:
            await update.message.reply_text(reply, parse_mode=ParseMode.MARKDOWN)
        except Exception:
            await update.message.reply_text(reply)
    except Exception as e:
        await update.message.reply_text(f"❌ Something went wrong: {e}")


def main():
    if not TELEGRAM_BOT_TOKEN:
        logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram bot is disabled. Sleeping.")
        import time
        while True:
            time.sleep(3600)

    if not ALLOWED_CHAT_IDS:
        logger.warning("TELEGRAM_ALLOWED_CHAT_IDS not set — the bot will answer ANY chat. "
                       "Send /start to the bot to see your chat ID, then set the variable.")

    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler(["start", "help"], start_cmd))
    app.add_handler(CommandHandler("stats", stats_cmd))
    app.add_handler(CommandHandler("lowstock", lowstock_cmd))
    app.add_handler(CommandHandler("find", find_cmd))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    logger.info("HomeHub Telegram bot starting (polling)...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
