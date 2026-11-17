"""The morning briefing: today at a glance, as plain text. Used by Emerald's
today_summary tool, the Overview's "briefing" and the daily Telegram message."""
import logging
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from models import CalendarEvent, Chore, Item, MealPlan, Setting, ShoppingItem

logger = logging.getLogger("homehub-briefing")
logging.getLogger("httpx").setLevel(logging.WARNING)   # its INFO lines would print the bot token

SEND_WINDOW_HOURS = 5   # after a restart, a missed briefing is still sent if it's no more than this late


def _clock(dt: datetime) -> str:
    return dt.strftime("%I:%M %p").lstrip("0")


def chores_due_today(chores: list, today: date) -> list:
    """The same rule the Overview uses for 'chores today'."""
    weekday = today.weekday()
    return [c for c in chores if c.frequency == "daily"
            or (c.frequency in ("weekly", "biweekly") and (c.day_of_week is None or c.day_of_week == weekday))
            or (c.frequency == "monthly" and today.day == 1)
            or c.frequency == "once"]


async def build_briefing(db: Session) -> str:
    from routers.calendar import get_external_events
    from routers.chores import chore_to_dict
    from routers.items import is_low

    today = date.today()
    start = datetime.combine(today, datetime.min.time())
    end = start + timedelta(days=1)
    lines = [f"Good morning! {today.strftime('%A, %B %d').replace(' 0', ' ')}", ""]

    events = []
    for e in db.query(CalendarEvent).filter(CalendarEvent.start >= start, CalendarEvent.start < end).all():
        events.append((e.start, e.all_day, e.title))
    try:
        for ev in await get_external_events(db, start, end):
            events.append((datetime.fromisoformat(ev["start"]), ev["all_day"], ev["title"]))
    except Exception:  # noqa: BLE001 — a calendar feed that's down shouldn't spoil the briefing
        pass
    if events:
        lines.append("On the calendar:")
        for when, all_day, title in sorted(events, key=lambda x: (not x[1], x[0])):
            lines.append(f"  {'All day' if all_day else _clock(when)}  {title}")
    else:
        lines.append("Nothing on the calendar today.")

    meals = db.query(MealPlan).filter(MealPlan.date == today).all()
    order = {"breakfast": 0, "lunch": 1, "dinner": 2, "snack": 3}
    if meals:
        lines.append("")
        for m in sorted(meals, key=lambda m: order.get(m.meal_type, 9)):
            lines.append(f"{m.meal_type.capitalize()}: {m.title}")
    else:
        lines += ["", "No dinner is planned yet."]

    due = chores_due_today(db.query(Chore).all(), today)
    by_person: dict[str, list[str]] = {}
    for c in due:
        d = chore_to_dict(c, db)
        if not d["done_this_period"]:
            by_person.setdefault(d["assigned_to"] or "Anyone", []).append(c.title)
    if by_person:
        lines += ["", "Chores:"]
        lines += [f"  {who}: {', '.join(titles)}" for who, titles in sorted(by_person.items())]

    soon = (db.query(Item).filter(Item.expiration_date.isnot(None), Item.expiration_date <= today + timedelta(days=3),
                                  (Item.quantity.is_(None)) | (Item.quantity > 0)).order_by(Item.expiration_date).all())
    if soon:
        def when(i):
            d = (i.expiration_date - today).days
            return "expired" if d < 0 else "today" if d == 0 else "tomorrow" if d == 1 else f"in {d} days"
        lines += ["", "Use soon: " + ", ".join(f"{i.name} ({when(i)})" for i in soon[:8])]

    low = [i for i in db.query(Item).all() if is_low(i)]
    if low:
        lines += ["", "Running low: " + ", ".join(i.name for i in low[:8]) + (f" and {len(low) - 8} more" if len(low) > 8 else "")]

    to_buy = db.query(ShoppingItem).filter(ShoppingItem.checked_at.is_(None)).count()
    if to_buy:
        lines += ["", f"Shopping list: {to_buy} item{'s' if to_buy != 1 else ''}"]
    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------
def _setting(db: Session, key: str, default: str = "") -> str:
    row = db.query(Setting).filter(Setting.key == key).first()
    return (row.value if row and row.value is not None else default)


def _set(db: Session, key: str, value: str) -> None:
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


async def send_telegram(db: Session, text: str) -> dict:
    """Send to every allowed Telegram chat. Returns {sent, error}."""
    token = _setting(db, "telegram_bot_token")
    ids = [p.strip() for p in _setting(db, "telegram_allowed_chat_ids").split(",") if p.strip().lstrip("-").isdigit()]
    if not token:
        return {"sent": 0, "error": "Telegram isn't connected yet. Add the bot token in Settings → Chat bots."}
    if not ids:
        return {"sent": 0, "error": "No Telegram chats are allowed yet. Add your chat ID in Settings → Chat bots."}
    sent, error = 0, None
    async with httpx.AsyncClient(timeout=15.0) as client:
        for chat_id in ids:
            try:
                r = await client.post(f"https://api.telegram.org/bot{token}/sendMessage",
                                      json={"chat_id": int(chat_id), "text": text})
                if r.status_code == 200:
                    sent += 1
                else:
                    error = (r.json().get("description") if r.headers.get("content-type", "").startswith("application/json")
                             else f"error {r.status_code}")
            except httpx.HTTPError as e:
                error = f"couldn't reach Telegram ({e.__class__.__name__})"
    return {"sent": sent, "error": error}


async def tick(db: Session) -> None:
    """Called every minute: send today's briefing once, at or shortly after the chosen time."""
    if _setting(db, "briefing_enabled", "true") != "true":
        return
    now = datetime.now()
    today = now.date().isoformat()
    if _setting(db, "briefing_last_sent") == today:
        return
    try:
        hh, mm = (int(x) for x in _setting(db, "briefing_time", "07:00").split(":")[:2])
    except ValueError:
        hh, mm = 7, 0
    due = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if not (due <= now <= due + timedelta(hours=SEND_WINDOW_HOURS)):
        return
    _set(db, "briefing_last_sent", today)   # mark first: a crash must not mean a double send
    result = await send_telegram(db, await build_briefing(db))
    if result["error"] and not result["sent"]:
        logger.warning("Morning briefing not sent: %s", result["error"])
        if "couldn't reach" in result["error"]:
            _set(db, "briefing_last_sent", "")   # a network blip: try again next minute (within the window)
