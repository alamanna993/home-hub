import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
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
    line = f"- {item.name} ({qty})" + (f" — in {loc}" if loc else "")
    if item.expiration_date:
        line += f" — expires {item.expiration_date.isoformat()}"
    return line


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


# ---------------------------------------------------------------------------
# Pending clarifications ("where should I put that?") — one live question per
# chat source, kept in memory. A lost pending just leaves items location-less.
# ---------------------------------------------------------------------------
PENDING: dict[str, dict] = {}
PENDING_TTL_SECONDS = 600
MAX_ACTIONS_PER_MESSAGE = 15

INTENT_WORDS = re.compile(
    r"\b(add|added|bought|buy|remove|removed|delete|throw|move|moved|where|what|when|find|"
    r"out of|running low|used up|done|finished|calendar|schedule|appointment)\b", re.I)


def get_pending(source: str) -> dict | None:
    p = PENDING.get(source)
    if p and time.time() - p["created"] > PENDING_TTL_SECONDS:
        PENDING.pop(source, None)
        return None
    return p


def location_options(db: Session) -> list[str]:
    seen, options = set(), []
    for loc in db.query(Location).order_by(Location.name).all():
        if loc.name.lower() not in seen:
            seen.add(loc.name.lower())
            options.append(loc.name)
        if len(options) >= 8:
            break
    return options


CONFIRM_OPTIONS = ["✅ Yes — file them", "❌ No — I'll say where"]


def make_pending(source: str, needs: list[dict], db: Session) -> tuple[str, dict]:
    """Store one clarification for all location-less items; return (question, pending payload).

    When the model proposed placements ("suggestion"), ask to verify them; otherwise
    ask an open where-should-I-put-it question with the household's locations."""
    names = [n["name"] for n in needs]
    pid = uuid.uuid4().hex[:12]

    if any(n.get("suggestion") for n in needs):
        placements = [{"id": n["id"], "name": n["name"], "location": n.get("suggestion")} for n in needs]
        lines = [f"**{p['name']}** → {p['location'] or '?'}" for p in placements]
        question = "📍 I'd put: " + ", ".join(lines) + ". Look right?"
        if any(not p["location"] for p in placements):
            question += " (For the ? ones, tell me where.)"
        options = list(CONFIRM_OPTIONS)
        PENDING[source] = {
            "id": pid, "type": "confirm", "placements": placements,
            "item_ids": [n["id"] for n in needs], "item_names": names,
            "options": options, "created": time.time(),
        }
        payload = {"id": pid, "type": "confirm", "question": question, "items": names,
                   "options": options, "placements": [{"item": p["name"], "location": p["location"]} for p in placements]}
        return question, payload

    options = location_options(db)
    question = f"📍 Where should I put **{', '.join(names)}**?"
    if options:
        question += " Tap a location or reply with one (you have: " + ", ".join(options) + ")."
    else:
        question += " Reply with a location and I'll create it."
    PENDING[source] = {
        "id": pid, "type": "location",
        "item_ids": [n["id"] for n in needs], "item_names": names,
        "options": options, "created": time.time(),
    }
    payload = {"id": pid, "type": "location", "question": question, "items": names, "options": options}
    return question, payload


def apply_location_to_pending(pending: dict, choice: str, source: str, db: Session) -> dict:
    loc_id = find_or_create_location(choice, None, db)
    names = []
    for item_id in pending["item_ids"]:
        item = db.query(Item).filter(Item.id == item_id).first()
        if item:
            item.location_id = loc_id
            names.append(item.name)
    db.commit()
    loc = db.query(Location).filter(Location.id == loc_id).first()
    loc_name = loc.name if loc else choice.title()
    PENDING.pop(source, None)
    reply = f"✅ Filed **{', '.join(names) or 'the items'}** under **{loc_name}**."
    return {"reply": reply, "action": "clarified"}


def apply_placements(pending: dict, source: str, db: Session) -> dict:
    """User confirmed the proposed placements — file every item where the model suggested."""
    placed, unplaced = [], []
    for p in pending["placements"]:
        if not p.get("location"):
            unplaced.append(p["name"])
            continue
        item = db.query(Item).filter(Item.id == p["id"]).first()
        if item:
            item.location_id = find_or_create_location(p["location"], None, db)
            placed.append(f"**{p['name']}** → {p['location']}")
    db.commit()
    PENDING.pop(source, None)
    reply = ("✅ Filed: " + ", ".join(placed) + ".") if placed else "🤔 I had no locations to apply."
    if unplaced:
        reply += f"\n📍 Still unplaced: **{', '.join(unplaced)}** — say e.g. 'put {unplaced[0].lower()} in the pantry'."
    return {"reply": reply, "action": "clarified"}


def reject_placements(pending: dict, source: str, db: Session) -> dict:
    """User said the proposed placements are wrong."""
    PENDING.pop(source, None)
    if len(pending["item_ids"]) == 1:
        # One item — just ask the open question with location buttons
        needs = [{"id": pending["item_ids"][0], "name": pending["item_names"][0]}]
        question, payload = make_pending(source, needs, db)
        return {"reply": question, "action": "ask_location", "pending": payload}
    names = ", ".join(pending["item_names"])
    return {"reply": f"👍 OK — tell me where each goes, e.g. 'milk in the fridge, bread in the pantry'. ({names})",
            "action": "clarified"}


YES_RE = re.compile(r"^(y|yes|yep|yeah|ya|sure|ok|okay|correct|right|sounds good|looks good|perfect|👍)\b", re.I)
NO_RE = re.compile(r"^(n|no|nope|nah|wrong|incorrect)\b", re.I)


def try_resolve_pending_text(message: str, pending: dict, source: str, db: Session) -> dict | None:
    """Treat the next message as an answer to the open question when it looks like one."""
    text = message.strip().rstrip(".!")
    tl = text.lower()

    if pending.get("type") == "confirm":
        if YES_RE.match(text):
            return apply_placements(pending, source, db)
        if NO_RE.match(text):
            return reject_placements(pending, source, db)
        return None  # anything else ("put bread in the garage") parses as a normal command

    if INTENT_WORDS.search(tl):  # looks like a new command ("where is my garage key?"), not an answer
        return None
    choice = None
    for opt in pending.get("options", []):
        if opt.lower() == tl or opt.lower() in tl:
            choice = opt
            break
    if not choice:
        cleaned = re.sub(r"^(put (it|them|those) )?(in |into |on )?(the )?", "", tl).strip()
        if cleaned and len(cleaned.split()) <= 4 and not INTENT_WORDS.search(cleaned):
            choice = cleaned
    if not choice:
        return None
    return apply_location_to_pending(pending, choice, source, db)


async def handle_action(parsed: dict, req: ChatRequest, db: Session) -> dict:
    """Execute one parsed action and return its reply dict. An add_item without a
    location carries a `_needs_location` marker so the caller can ask once for the batch."""
    action = parsed.get("action", "unknown")
    item_name = parsed.get("item")

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
        from datetime import date
        from routers.items import ItemCreate, create_item
        # Trust "location" only if the user actually said it — models like to guess.
        # An unstated location becomes a suggestion that needs the user's OK.
        loc_name = parsed.get("location")
        if loc_name and loc_name.lower() not in req.message.lower():
            if not parsed.get("suggested_location"):
                parsed["suggested_location"] = loc_name
            loc_name = None
        loc_id = find_or_create_location(loc_name, parsed.get("sublocation"), db)
        cat_id = find_or_create_category(parsed.get("category"), db)
        expires = None
        if parsed.get("expires"):
            try:
                expires = date.fromisoformat(str(parsed["expires"])[:10])
            except ValueError:
                pass  # model produced a non-ISO date — skip rather than fail the add
        data = ItemCreate(
            name=item_name.title(),
            quantity=parsed.get("quantity", 1),
            unit=parsed.get("unit"),
            location_id=loc_id,
            category_id=cat_id,
            notes=parsed.get("notes"),
            expiration_date=expires,
        )
        result = create_item(data, source=req.source, db=db)
        reply = f"✅ Added **{result['name']}** (qty: {result['quantity'] or 1}) to {result['location']['name'] if result.get('location') else 'inventory'}."
        if expires:
            reply += f" Expires {expires.strftime('%b %d')}."
        out = {"reply": reply, "action": action, "item": result}
        if not loc_id:
            suggestion = parsed.get("suggested_location")
            out["_needs_location"] = {"id": result["id"], "name": result["name"],
                                      "suggestion": suggestion.title() if suggestion else None}
        return out

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


@router.post("/")
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    # An open "where should I put that?" question — try the message as its answer first.
    pending = get_pending(req.source)
    if pending:
        resolved = try_resolve_pending_text(req.message, pending, req.source, db)
        if resolved:
            return resolved
        PENDING.pop(req.source, None)  # not an answer — drop the question and process normally

    actions = (await parse_message(req.message, db))[:MAX_ACTIONS_PER_MESSAGE]

    if len(actions) == 1:
        parsed = actions[0]
        # Models sometimes shove calendar/chore questions into inventory actions — reroute those.
        if parsed.get("action") == "list_items" and not parsed.get("category") and not parsed.get("location") \
                and re.search(r"calendar|schedule|event|appointment|chore|meal|dinner plan", req.message, re.I) \
                and not parsed.get("no_ai"):
            return await conversational_reply(req, db, parsed)
        result = await handle_action(parsed, req, db)
        needs = result.pop("_needs_location", None)
        if needs:
            question, payload = make_pending(req.source, [needs], db)
            result["reply"] += "\n" + question
            result["pending"] = payload
        return result

    # Batch: execute every understood action, answer with one summary message.
    results, needs_location, skipped = [], [], 0
    for parsed in actions:
        if parsed.get("action", "unknown") == "unknown":
            skipped += 1
            continue
        result = await handle_action(parsed, req, db)
        needs = result.pop("_needs_location", None)
        if needs:
            needs_location.append(needs)
        results.append(result)

    if not results:  # nothing actionable — just talk, with the household as context
        return await conversational_reply(req, db, actions[0])

    lines = [r["reply"] for r in results]
    if skipped:
        lines.append(f"🤔 (I didn't understand {skipped} part{'s' if skipped > 1 else ''} of that.)")
    out = {"reply": "\n".join(lines), "action": "batch", "results": results}
    if needs_location:
        question, payload = make_pending(req.source, needs_location, db)
        out["reply"] += "\n" + question
        out["pending"] = payload
    return out


class ClarifyRequest(BaseModel):
    source: str
    pending_id: str
    choice: str | None = None
    choice_index: int | None = None


@router.post("/clarify")
async def clarify(req: ClarifyRequest, db: Session = Depends(get_db)):
    """Answer a pending location question (used by Telegram inline buttons)."""
    pending = get_pending(req.source)
    if not pending or pending["id"] != req.pending_id:
        return {"reply": "⌛ That question expired — the item is saved without a location; you can set one in the app.",
                "action": "expired"}
    choice = req.choice
    if choice is None and req.choice_index is not None and 0 <= req.choice_index < len(pending["options"]):
        choice = pending["options"][req.choice_index]
    if not choice:
        raise HTTPException(status_code=400, detail="No location choice provided")
    if pending.get("type") == "confirm":
        if choice.startswith("✅") or YES_RE.match(choice):
            return apply_placements(pending, req.source, db)
        return reject_placements(pending, req.source, db)
    return apply_location_to_pending(pending, choice, req.source, db)
