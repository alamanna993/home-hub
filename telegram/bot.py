import os
import logging
import httpx
from dotenv import load_dotenv
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode, ChatAction
from telegram.ext import (Application, CallbackQueryHandler, CommandHandler, MessageHandler,
                          ContextTypes, filters)

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("homehub-telegram")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
ALLOWED_CHAT_IDS: set[int] = set()


def parse_chat_ids(raw: str) -> set[int]:
    ids = set()
    for part in raw.split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            ids.add(int(part))
    return ids


def fetch_runtime_settings() -> dict:
    """Fetch bot config saved via the web UI (setup wizard / Settings page)."""
    r = httpx.get(
        f"{BACKEND_URL}/settings/runtime",
        headers={"X-API-Key": INTERNAL_API_KEY} if INTERNAL_API_KEY else {},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()


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


def chat_source(update: Update) -> str:
    return f"telegram:{update.effective_user.first_name if update.effective_user else 'unknown'}"


def pending_keyboard(pending: dict) -> InlineKeyboardMarkup | None:
    """Tappable location buttons for a 'where should I put that?' question."""
    options = pending.get("options") or []
    if not options:
        return None
    # callback_data is capped at 64 bytes — send the option index, not the name
    buttons = [InlineKeyboardButton(opt, callback_data=f"clarify|{pending['id']}|{i}")
               for i, opt in enumerate(options)]
    rows = [buttons[i:i + 2] for i in range(0, len(buttons), 2)]
    return InlineKeyboardMarkup(rows)


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update) or not update.message or not update.message.text:
        return
    await update.effective_chat.send_action(ChatAction.TYPING)
    try:
        result = await call_backend("/chat/", "POST", {
            "message": update.message.text,
            "source": chat_source(update),
        })
        reply = result.get("reply", "Sorry, I didn't understand that.")
        # Backend replies use **bold** — Telegram Markdown uses *bold*
        reply = reply.replace("**", "*")
        keyboard = pending_keyboard(result["pending"]) if result.get("pending") else None
        try:
            await update.message.reply_text(reply, parse_mode=ParseMode.MARKDOWN, reply_markup=keyboard)
        except Exception:
            await update.message.reply_text(reply, reply_markup=keyboard)
    except Exception as e:
        await update.message.reply_text(f"❌ Something went wrong: {e}")


async def on_clarify_button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    query = update.callback_query
    await query.answer()
    try:
        _, pending_id, index = query.data.split("|", 2)
        result = await call_backend("/chat/clarify", "POST", {
            "source": chat_source(update),
            "pending_id": pending_id,
            "choice_index": int(index),
        })
        reply = result.get("reply", "Done.").replace("**", "*")
        # A "No" can come back with a fresh question (location buttons) — show it
        keyboard = pending_keyboard(result["pending"]) if result.get("pending") else None
        # Keep the original summary, append the outcome, swap the buttons
        original = query.message.text if query.message else ""
        combined = f"{original}\n{reply}" if original else reply
        try:
            await query.edit_message_text(combined, parse_mode=ParseMode.MARKDOWN, reply_markup=keyboard)
        except Exception:
            await query.edit_message_text(combined, reply_markup=keyboard)
    except Exception as e:
        try:
            await query.edit_message_text(f"❌ Something went wrong: {e}")
        except Exception:
            pass


def main():
    import time

    token = TELEGRAM_BOT_TOKEN
    ALLOWED_CHAT_IDS.update(parse_chat_ids(os.getenv("TELEGRAM_ALLOWED_CHAT_IDS", "")))

    # No token in env? Wait for one to be saved via the web setup wizard / Settings page.
    while not token:
        try:
            runtime = fetch_runtime_settings()
            token = runtime.get("telegram_bot_token", "")
            if not ALLOWED_CHAT_IDS:
                ALLOWED_CHAT_IDS.update(parse_chat_ids(runtime.get("telegram_allowed_chat_ids", "")))
        except Exception as e:
            logger.info(f"Backend not ready yet ({e})")
        if not token:
            logger.info("No Telegram token yet — set one in the web UI (Settings or setup wizard). Checking again in 30s.")
            time.sleep(30)

    if not ALLOWED_CHAT_IDS:
        try:
            ALLOWED_CHAT_IDS.update(parse_chat_ids(fetch_runtime_settings().get("telegram_allowed_chat_ids", "")))
        except Exception:
            pass
    if not ALLOWED_CHAT_IDS:
        logger.warning("No allowed chat IDs configured — the bot will answer ANY chat. "
                       "Send /start to the bot to see your chat ID, then save it in Settings.")

    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler(["start", "help"], start_cmd))
    app.add_handler(CommandHandler("stats", stats_cmd))
    app.add_handler(CommandHandler("lowstock", lowstock_cmd))
    app.add_handler(CommandHandler("find", find_cmd))
    app.add_handler(CallbackQueryHandler(on_clarify_button, pattern=r"^clarify\|"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))
    logger.info("HomeHub Telegram bot starting (polling)...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
