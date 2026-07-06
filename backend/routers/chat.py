from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db
from models import Item, Location, Category
from llm import parse_message, generate_response

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    source: str = "dashboard"


def find_best_item_match(name: str, db: Session):
    return db.query(Item).filter(Item.name.ilike(f"%{name}%")).first()


FOOD_LOCATIONS = ("kitchen", "pantry", "fridge", "freezer")
FOOD_CATEGORIES = ("grocer", "food", "produce", "spice", "baking")


def get_food_inventory(db: Session) -> list[Item]:
    """Items likely to be edible: in a kitchen-ish location or a food-ish category."""
    items = db.query(Item).filter((Item.quantity.is_(None)) | (Item.quantity > 0)).all()
    food = []
    for item in items:
        loc = item.location
        loc_text = f"{loc.name} {loc.sublocation or ''}".lower() if loc else ""
        cat_text = item.category.name.lower() if item.category else ""
        if any(k in loc_text for k in FOOD_LOCATIONS) or any(k in cat_text for k in FOOD_CATEGORIES):
            food.append(item)
    return food


async def build_house_context(db: Session) -> str:
    """Compact snapshot of the whole household for conversational answers."""
    from datetime import date, datetime, timedelta
    from models import CalendarEvent, MealPlan, Chore
    from routers.chores import chore_to_dict
    from routers.calendar import get_external_events

    today = date.today()
    parts = [f"Today is {today.strftime('%A, %B %d, %Y')}."]

    total = db.query(Item).count()
    low = db.query(Item).filter(Item.low_stock_threshold.isnot(None), Item.quantity <= Item.low_stock_threshold).all()
    inv = f"Inventory: {total} items tracked."
    if low:
        inv += " Running low: " + ", ".join(i.name for i in low[:10])
    parts.append(inv)

    day_start = datetime.combine(today, datetime.min.time())
    week_end = datetime.combine(today + timedelta(days=7), datetime.min.time())
    events = (db.query(CalendarEvent)
              .filter(CalendarEvent.start >= day_start, CalendarEvent.start < week_end)
              .order_by(CalendarEvent.start).limit(15).all())
    lines = [f"- {e.start.strftime('%a %b %d %H:%M') if not e.all_day else e.start.strftime('%a %b %d')}: {e.title}" for e in events]
    try:
        for ev in await get_external_events(db, day_start, week_end):
            dt = datetime.fromisoformat(ev["start"])
            lines.append(f"- {dt.strftime('%a %b %d') if ev['all_day'] else dt.strftime('%a %b %d %H:%M')}: {ev['title']} (synced calendar)")
    except Exception:
        pass
    if lines:
        parts.append("Calendar (next 7 days):\n" + "\n".join(sorted(lines)))
    else:
        parts.append("Calendar: nothing scheduled in the next 7 days.")

    meals = db.query(MealPlan).filter(MealPlan.date >= today, MealPlan.date <= today + timedelta(days=2)).order_by(MealPlan.date).all()
    if meals:
        parts.append("Planned meals:\n" + "\n".join(f"- {m.date.strftime('%a')} {m.meal_type}: {m.title}" for m in meals))

    chores = db.query(Chore).all()
    if chores:
        lines = []
        for c in chores[:20]:
            d = chore_to_dict(c, db)
            status = "done" if d["done_this_period"] else "not done yet"
            lines.append(f"- {c.title} ({c.assigned_to or 'anyone'}, {c.frequency}): {status} this period")
        parts.append("Chores:\n" + "\n".join(lines))

    return "\n\n".join(parts)


def item_line(item: Item) -> str:
    qty = f"{item.quantity:g} {item.unit or ''}".strip() if item.quantity is not None else "some"
    loc = ""
    if item.location:
        loc = item.location.name
        if item.location.sublocation:
            loc += f" / {item.location.sublocation}"
    return f"- {item.name} ({qty})" + (f" — in {loc}" if loc else "")


def find_or_create_location(name: str, sublocation: str | None, db: Session) -> int | None:
    if not name:
        return None
    loc = db.query(Location).filter(Location.name.ilike(f"%{name}%")).first()
    if not loc:
        loc = Location(name=name.title(), sublocation=sublocation)
        db.add(loc)
        db.commit()
        db.refresh(loc)
    return loc.id


def find_or_create_category(name: str, db: Session) -> int | None:
    if not name:
        return None
    cat = db.query(Category).filter(Category.name.ilike(f"%{name}%")).first()
    if not cat:
        cat = Category(name=name.title())
        db.add(cat)
        db.commit()
        db.refresh(cat)
    return cat.id


WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def resolve_datetime_from_text(message: str):
    """Fallback when the model returns an unusable datetime: pull 'friday at 5:30pm',
    'tomorrow', 'today 7pm' etc. straight out of the message."""
    import re
    from datetime import datetime, timedelta

    text = message.lower()
    now = datetime.now()
    day = None

    if "tomorrow" in text:
        day = now + timedelta(days=1)
    elif "today" in text or "tonight" in text:
        day = now
    else:
        for i, name in enumerate(WEEKDAYS):
            if name in text:
                ahead = (i - now.weekday()) % 7
                if ahead == 0 and "next" in text:
                    ahead = 7
                day = now + timedelta(days=ahead)
                break
    if day is None:
        return None

    hour, minute = 0, 0
    m = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text)
    if m and (m.group(2) or m.group(3)):  # need a :mm or am/pm to be confident it's a time
        hour = int(m.group(1)) % 12 if m.group(3) else int(m.group(1))
        if m.group(3) == "pm":
            hour += 12
        minute = int(m.group(2) or 0)
    return day.replace(hour=hour, minute=minute, second=0, microsecond=0)


async def conversational_reply(req: "ChatRequest", db: Session, parsed: dict) -> dict:
    context = await build_house_context(db)
    reply = await generate_response(req.message, context=context, db=db)
    return {"reply": reply, "action": "chat", "parsed": parsed}


@router.post("/")
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    import re
    parsed = await parse_message(req.message, db)
    action = parsed.get("action", "unknown")
    item_name = parsed.get("item")

    # Models sometimes shove calendar/chore questions into inventory actions — reroute those.
    if action == "list_items" and not parsed.get("category") and not parsed.get("location") \
            and re.search(r"calendar|schedule|event|appointment|chore|meal|dinner plan", req.message, re.I) \
            and not parsed.get("no_ai"):
        return await conversational_reply(req, db, parsed)

    if action == "find_item" and item_name:
        item = find_best_item_match(item_name, db)
        if item:
            loc_str = ""
            if item.location:
                loc_str = item.location.name
                if item.location.sublocation:
                    loc_str += f" — {item.location.sublocation}"
            qty_str = f"{item.quantity} {item.unit or ''}".strip() if item.quantity is not None else "some"
            reply = f"✅ **{item.name}** — {loc_str or 'location unknown'} | Qty: {qty_str}"
        else:
            reply = f"❌ Couldn't find **{item_name}** in the inventory."
        return {"reply": reply, "action": action, "parsed": parsed}

    elif action == "add_item" and item_name:
        from routers.items import ItemCreate, create_item
        loc_id = find_or_create_location(parsed.get("location"), parsed.get("sublocation"), db)
        cat_id = find_or_create_category(parsed.get("category"), db)
        data = ItemCreate(
            name=item_name.title(),
            quantity=parsed.get("quantity", 1),
            unit=parsed.get("unit"),
            location_id=loc_id,
            category_id=cat_id,
            notes=parsed.get("notes"),
        )
        result = create_item(data, source=req.source, db=db)
        reply = f"✅ Added **{result['name']}** (qty: {result['quantity'] or 1}) to {result['location']['name'] if result.get('location') else 'inventory'}."
        return {"reply": reply, "action": action, "item": result}

    elif action == "update_item" and item_name:
        from models import AuditLog
        item = find_best_item_match(item_name, db)
        if item:
            changes = []
            if parsed.get("quantity") is not None:
                item.quantity = parsed["quantity"]
                changes.append(f"qty → {item.quantity:g}")
            if parsed.get("location"):
                loc_id = find_or_create_location(parsed["location"], parsed.get("sublocation"), db)
                if loc_id:
                    item.location_id = loc_id
                    loc = db.query(Location).filter(Location.id == loc_id).first()
                    loc_str = loc.name + (f" / {loc.sublocation}" if loc.sublocation else "")
                    changes.append(f"moved to {loc_str}")
            if parsed.get("notes"):
                item.notes = parsed["notes"]
                changes.append("notes updated")
            db.add(AuditLog(action="updated", item_name=item.name, changed_by=req.source, details="; ".join(changes) or "no changes"))
            db.commit()
            if changes:
                reply = f"✅ Updated **{item.name}** — {', '.join(changes)}."
            else:
                reply = f"🤔 Found **{item.name}** but I'm not sure what to change about it."
        else:
            reply = f"❌ Couldn't find **{item_name}** to update."
        return {"reply": reply, "action": action, "parsed": parsed}

    elif action == "remove_item" and item_name:
        # Soft remove: a misheard chat message must never destroy a record.
        from models import AuditLog
        item = find_best_item_match(item_name, db)
        if item:
            item.quantity = 0
            db.add(AuditLog(action="updated", item_name=item.name, changed_by=req.source, details="marked as gone (qty 0) via chat"))
            db.commit()
            reply = f"🗑️ Marked **{item.name}** as gone (qty 0) — it stays on the list so you remember to restock. Delete it for good from the Inventory page."
        else:
            reply = f"❌ Couldn't find **{item_name}** to remove."
        return {"reply": reply, "action": action, "parsed": parsed}

    elif action == "low_stock":
        from routers.items import is_low
        low_items = [i for i in db.query(Item).all() if is_low(i)]
        if low_items:
            lines = [f"• {i.name}: {i.quantity} {i.unit or ''} left".strip() for i in low_items]
            reply = "⚠️ **Running low:**\n" + "\n".join(lines)
        else:
            reply = "✅ Nothing is critically low right now."
        return {"reply": reply, "action": action}

    elif action == "suggest_recipes":
        food = get_food_inventory(db)
        if not food:
            reply = "🍽️ I don't see any food in the inventory yet. Add items to Kitchen locations (Pantry, Fridge, Freezer) or a Groceries category and ask me again!"
            return {"reply": reply, "action": action}
        inventory_text = "\n".join(item_line(i) for i in food)
        prompt = (
            f"{req.message}\n\n"
            "Suggest 2-3 meals I could realistically make using mostly the ingredients listed in the context. "
            "For each meal: give a short name, the ingredients from my inventory it uses (with where each is stored), "
            "and note any common staples I might still need. Be concise."
        )
        reply = await generate_response(prompt, context=f"Food currently in the house:\n{inventory_text}", db=db)
        return {"reply": reply, "action": action}

    elif action == "list_items":
        cat_name = parsed.get("category")
        loc_name = parsed.get("location")
        query = db.query(Item)
        if cat_name:
            query = query.join(Category).filter(Category.name.ilike(f"%{cat_name}%"))
        if loc_name:
            query = query.join(Location).filter(Location.name.ilike(f"%{loc_name}%"))
        items = query.limit(20).all()
        if items:
            lines = [f"• {i.name} ({i.quantity or '?'} {i.unit or ''})" for i in items]
            reply = "\n".join(lines)
        elif not parsed.get("no_ai") and re.search(r"calendar|schedule|event|appointment|chore|meal", req.message, re.I):
            # The model misfiled a calendar/chore question as an inventory list — just answer it.
            return await conversational_reply(req, db, parsed)
        else:
            reply = "No items found for that filter."
        return {"reply": reply, "action": action}

    elif action == "add_event" and item_name:
        from datetime import datetime
        from models import CalendarEvent
        raw_dt = parsed.get("datetime")
        try:
            start = datetime.fromisoformat(raw_dt) if raw_dt else None
        except (ValueError, TypeError):
            start = None
        # Models often miscount weekdays; when the user named one, trust our own resolver.
        from_text = resolve_datetime_from_text(req.message)
        if from_text and (not start or (any(w in req.message.lower() for w in WEEKDAYS) and start.date() != from_text.date())):
            if start and start.hour and not from_text.hour:
                from_text = from_text.replace(hour=start.hour, minute=start.minute)
            start = from_text
        if not start:
            reply = f"🗓️ I got the event (**{item_name}**) but not the date/time — try 'add {item_name} on Friday at 2pm'."
            return {"reply": reply, "action": action, "parsed": parsed}
        all_day = start.hour == 0 and start.minute == 0
        event = CalendarEvent(title=item_name, start=start, all_day=all_day, created_by=req.source)
        db.add(event)
        db.commit()
        db.refresh(event)
        import msgraph
        pushed = await msgraph.push_create(db, event)
        when = start.strftime("%A %b %d") + ("" if all_day else start.strftime(" at %H:%M"))
        reply = f"🗓️ Added **{item_name}** to the calendar for {when}." + (" (synced to Outlook ✓)" if pushed else "")
        return {"reply": reply, "action": action, "parsed": parsed}

    elif action == "complete_chore" and item_name:
        from models import Chore, ChoreCompletion
        from routers.chores import chore_to_dict
        chore = db.query(Chore).filter(Chore.title.ilike(f"%{item_name}%")).first()
        if not chore:
            # try word-by-word ("I took out the trash" → chore "Take out trash")
            for word in item_name.split():
                if len(word) > 3:
                    chore = db.query(Chore).filter(Chore.title.ilike(f"%{word}%")).first()
                    if chore:
                        break
        if chore:
            person = parsed.get("person") or (req.source.split(":", 1)[1] if ":" in req.source else None)
            db.add(ChoreCompletion(chore_id=chore.id, completed_by=person or chore.assigned_to))
            db.commit()
            who = person or chore.assigned_to or "someone"
            reply = f"🎉 Nice work! Checked off **{chore.title}**" + (f" for {who}." if who else ".")
        else:
            reply = f"🤔 I couldn't find a chore matching **{item_name}** on the chart."
        return {"reply": reply, "action": action, "parsed": parsed}

    else:
        if parsed.get("no_ai"):
            from llm import NO_AI_NOTICE
            reply = f"🤖 {NO_AI_NOTICE}"
            return {"reply": reply, "action": "unknown", "parsed": parsed}
        # Not an inventory/calendar/chore command — just talk, with the household as context.
        return await conversational_reply(req, db, parsed)
