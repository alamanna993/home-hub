"""Tool-calling agent: when the fast intent parser can't map a message to a known
action, this agent gets real tools over the whole app (items, locations, categories,
events, chores, meals, family) and decides what to call — so editing, deleting,
renaming, and anything unanticipated works from chat instead of hitting a wall."""
import json
import logging
from datetime import date, datetime, timedelta

import httpx
from database import settings as env_settings
from llm import _db_setting

logger = logging.getLogger("homehub-agent")

MAX_TURNS = 8

AGENT_SYSTEM = """You are HomeHub, the family's home assistant. Today is {today} ({weekday}).
You have tools that read and MODIFY the household database. When the user wants something
changed, do it: look the record up first if you need its exact name, call the right tool,
then confirm in one short friendly sentence (it may show in a small Telegram bubble).
If a lookup returns several matches, ask which one they meant instead of guessing.
Use ISO format for dates (YYYY-MM-DD) and datetimes (YYYY-MM-DDTHH:MM:SS).
If nothing needs changing, just answer from the household snapshot below.

Household snapshot:
{context}"""


def _tool(name: str, description: str, params: dict, required: list[str] | None = None) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": params, "required": required or []},
    }}


_S = lambda d: {"type": "string", "description": d}  # noqa: E731

TOOLS = [
    # --- inventory ---
    _tool("find_items", "Search inventory items by name. Returns matches with id, quantity and location.",
          {"search": _S("part of the item name")}, ["search"]),
    _tool("update_item", "Update an inventory item found by name: quantity, location, notes, or expiration date. Only pass fields to change.",
          {"name": _S("item name to find"), "quantity": {"type": "number", "description": "new quantity"},
           "location": _S("new location name"), "sublocation": _S("new sub-location"),
           "notes": _S("new notes"), "expiration_date": _S("YYYY-MM-DD")}, ["name"]),
    _tool("delete_item", "Mark an inventory item as gone (quantity 0, kept on the list for restocking).",
          {"name": _S("item name to find")}, ["name"]),
    # --- locations ---
    _tool("list_locations", "List all storage locations (rooms/spots) with item counts.", {}),
    _tool("create_location", "Create a new storage location (room or spot).",
          {"name": _S("location name, e.g. Attic"), "sublocation": _S("optional sub-location")}, ["name"]),
    _tool("update_location", "Rename a location and/or change its sub-location.",
          {"name": _S("current location name"), "new_name": _S("new name"), "new_sublocation": _S("new sub-location")}, ["name"]),
    _tool("delete_location", "Delete a location. Fails if items are still stored there.",
          {"name": _S("location name")}, ["name"]),
    # --- categories ---
    _tool("list_categories", "List all item categories.", {}),
    _tool("create_category", "Create a new item category.", {"name": _S("category name")}, ["name"]),
    _tool("delete_category", "Delete a category. Fails if items still use it.", {"name": _S("category name")}, ["name"]),
    # --- family ---
    _tool("list_family", "List family members.", {}),
    _tool("add_family_member", "Add a person to the family.", {"name": _S("person's name")}, ["name"]),
    _tool("remove_family_member", "Remove a person from the family.", {"name": _S("person's name")}, ["name"]),
    # --- calendar ---
    _tool("list_events", "List upcoming calendar events (next N days) with id, title and start time.",
          {"days_ahead": {"type": "integer", "description": "how far to look, default 30"}}),
    _tool("create_event", "Add a calendar event.",
          {"title": _S("event title"), "start": _S("start datetime YYYY-MM-DDTHH:MM:SS (midnight = all-day)"),
           "end": _S("optional end datetime")}, ["title", "start"]),
    _tool("update_event", "Change an upcoming event's title and/or start time, found by title.",
          {"title": _S("current title (or part of it)"), "new_title": _S("new title"),
           "new_start": _S("new start datetime YYYY-MM-DDTHH:MM:SS")}, ["title"]),
    _tool("delete_event", "Cancel/delete an upcoming event found by title.", {"title": _S("title or part of it")}, ["title"]),
    # --- chores ---
    _tool("list_chores", "List all chores with assignee and frequency.", {}),
    _tool("update_chore", "Change a chore's assignee, frequency, or title, found by title. Only pass fields to change.",
          {"title": _S("current chore title (or part of it)"), "assigned_to": _S("family member to assign"),
           "frequency": _S("once|daily|weekly|monthly"), "new_title": _S("new title")}, ["title"]),
    _tool("delete_chore", "Delete a chore from the chart.", {"title": _S("chore title or part of it")}, ["title"]),
    # --- meals ---
    _tool("list_meals", "List planned meals for the next N days (default 7).",
          {"days_ahead": {"type": "integer", "description": "default 7"}}),
    _tool("plan_meal", "Put a meal on the meal plan.",
          {"date": _S("YYYY-MM-DD"), "meal_type": _S("breakfast|lunch|dinner|snack"), "title": _S("what's being made")},
          ["date", "title"]),
    _tool("remove_meal", "Remove a planned meal found by title (optionally narrowed by date).",
          {"title": _S("meal title or part of it"), "date": _S("optional YYYY-MM-DD")}, ["title"]),
]


def _loc_str(loc) -> str:
    if not loc:
        return "no location"
    return loc.name + (f" / {loc.sublocation}" if loc.sublocation else "")


_TOOL_SPECS = {t["function"]["name"]: t["function"]["parameters"] for t in TOOLS}


def _normalize_args(tool_name: str, args: dict) -> dict | str:
    """Small models invent argument names ('current_location_name' for 'name').
    Map stray keys onto the tool's declared parameters; report anything still missing."""
    spec = _TOOL_SPECS.get(tool_name)
    if spec is None or not isinstance(args, dict):
        return args if isinstance(args, dict) else {}
    props = spec["properties"]
    normalized = {k: v for k, v in args.items() if k in props}
    for key, value in args.items():
        if key in props:
            continue
        kl = key.lower()
        match = next((p for p in props if p not in normalized and (p in kl or kl in p)), None)
        if match:
            normalized[match] = value
    missing = [p for p in spec.get("required", []) if normalized.get(p) in (None, "")]
    if missing:
        return f"Missing required argument(s) for {tool_name}: {', '.join(missing)}. Retry with them set."
    return normalized


async def execute_tool(name: str, args: dict, db, source: str) -> dict | list | str:
    from models import (Item, Location, Category, FamilyMember, CalendarEvent,
                        MealPlan, Chore, AuditLog)
    import msgraph
    from routers.chat import find_or_create_location

    args = _normalize_args(name, args)
    if isinstance(args, str):  # missing-argument message for the model
        return args

    try:
        if name == "find_items":
            items = db.query(Item).filter(Item.name.ilike(f"%{args['search']}%")).limit(10).all()
            return [{"id": i.id, "name": i.name, "quantity": i.quantity, "unit": i.unit,
                     "location": _loc_str(i.location)} for i in items] or "No matching items."

        if name == "update_item":
            item = db.query(Item).filter(Item.name.ilike(f"%{args['name']}%")).first()
            if not item:
                return f"No item matching '{args['name']}'."
            changes = []
            if args.get("quantity") is not None:
                item.quantity = args["quantity"]; changes.append(f"qty → {item.quantity:g}")
            if args.get("location"):
                item.location_id = find_or_create_location(args["location"], args.get("sublocation"), db)
                changes.append(f"moved to {args['location']}")
            if args.get("notes"):
                item.notes = args["notes"]; changes.append("notes updated")
            if args.get("expiration_date"):
                try:
                    item.expiration_date = date.fromisoformat(args["expiration_date"][:10])
                    changes.append(f"expires {item.expiration_date.isoformat()}")
                except ValueError:
                    return "expiration_date must be YYYY-MM-DD."
            if not changes:
                return "No fields to change were given."
            db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details="; ".join(changes)))
            db.commit()
            return f"Updated {item.name}: {', '.join(changes)}."

        if name == "delete_item":
            item = db.query(Item).filter(Item.name.ilike(f"%{args['name']}%")).first()
            if not item:
                return f"No item matching '{args['name']}'."
            item.quantity = 0
            db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details="marked as gone (qty 0) via chat agent"))
            db.commit()
            return f"Marked {item.name} as gone (qty 0, kept for restocking)."

        if name == "list_locations":
            locs = db.query(Location).order_by(Location.name).all()
            return [{"name": l.name, "sublocation": l.sublocation,
                     "items": db.query(Item).filter(Item.location_id == l.id).count()} for l in locs]

        if name == "create_location":
            existing = db.query(Location).filter(Location.name.ilike(args["name"])).first()
            if existing:
                return f"Location '{existing.name}' already exists."
            loc = Location(name=args["name"].strip().title(), sublocation=args.get("sublocation"))
            db.add(loc); db.commit()
            return f"Created location {loc.name}."

        if name == "update_location":
            loc = db.query(Location).filter(Location.name.ilike(f"%{args['name']}%")).first()
            if not loc:
                return f"No location matching '{args['name']}'."
            old = loc.name
            if args.get("new_name"):
                loc.name = args["new_name"].strip().title()
            if args.get("new_sublocation") is not None:
                loc.sublocation = args["new_sublocation"] or None
            db.commit()
            return f"Updated location {old} → {loc.name}" + (f" / {loc.sublocation}" if loc.sublocation else "") + "."

        if name == "delete_location":
            loc = db.query(Location).filter(Location.name.ilike(f"%{args['name']}%")).first()
            if not loc:
                return f"No location matching '{args['name']}'."
            count = db.query(Item).filter(Item.location_id == loc.id).count()
            if count:
                return f"Can't delete {loc.name} — {count} item(s) are stored there. Move them first."
            db.delete(loc); db.commit()
            return f"Deleted location {loc.name}."

        if name == "list_categories":
            return [{"name": c.name, "icon": c.icon} for c in db.query(Category).order_by(Category.name).all()]

        if name == "create_category":
            existing = db.query(Category).filter(Category.name.ilike(args["name"])).first()
            if existing:
                return f"Category '{existing.name}' already exists."
            cat = Category(name=args["name"].strip().title())
            db.add(cat); db.commit()
            return f"Created category {cat.name}."

        if name == "delete_category":
            cat = db.query(Category).filter(Category.name.ilike(f"%{args['name']}%")).first()
            if not cat:
                return f"No category matching '{args['name']}'."
            count = db.query(Item).filter(Item.category_id == cat.id).count()
            if count:
                return f"Can't delete {cat.name} — {count} item(s) use it."
            db.delete(cat); db.commit()
            return f"Deleted category {cat.name}."

        if name == "list_family":
            return [m.name for m in db.query(FamilyMember).order_by(FamilyMember.name).all()] or "No family members yet."

        if name == "add_family_member":
            existing = db.query(FamilyMember).filter(FamilyMember.name.ilike(args["name"])).first()
            if existing:
                return f"{existing.name} is already in the family."
            m = FamilyMember(name=args["name"].strip().title())
            db.add(m); db.commit()
            return f"Added {m.name} to the family."

        if name == "remove_family_member":
            m = db.query(FamilyMember).filter(FamilyMember.name.ilike(f"%{args['name']}%")).first()
            if not m:
                return f"No family member matching '{args['name']}'."
            removed = m.name
            db.delete(m); db.commit()
            return f"Removed {removed} from the family."

        if name == "list_events":
            days = int(args.get("days_ahead") or 30)
            now = datetime.now()
            events = (db.query(CalendarEvent)
                      .filter(CalendarEvent.start >= now - timedelta(days=1),
                              CalendarEvent.start < now + timedelta(days=days))
                      .order_by(CalendarEvent.start).limit(30).all())
            return [{"id": e.id, "title": e.title, "start": e.start.isoformat(), "all_day": e.all_day}
                    for e in events] or "No upcoming events."

        if name == "create_event":
            try:
                start = datetime.fromisoformat(args["start"])
            except ValueError:
                return "start must be an ISO datetime (YYYY-MM-DDTHH:MM:SS)."
            end = None
            if args.get("end"):
                try:
                    end = datetime.fromisoformat(args["end"])
                except ValueError:
                    pass
            event = CalendarEvent(title=args["title"], start=start, end=end,
                                  all_day=(start.hour == 0 and start.minute == 0), created_by=source)
            db.add(event); db.commit(); db.refresh(event)
            pushed = await msgraph.push_create(db, event)
            return f"Added event '{event.title}' on {start.strftime('%A %b %d %H:%M')}" + (" (synced to Outlook)." if pushed else ".")

        def _match_events(title):
            now = datetime.now()
            return (db.query(CalendarEvent)
                    .filter(CalendarEvent.title.ilike(f"%{title}%"), CalendarEvent.start >= now - timedelta(days=1))
                    .order_by(CalendarEvent.start).limit(5).all())

        if name == "update_event":
            matches = _match_events(args["title"])
            if not matches:
                return f"No upcoming event matching '{args['title']}'."
            if len(matches) > 1:
                return {"multiple_matches": [{"id": e.id, "title": e.title, "start": e.start.isoformat()} for e in matches]}
            event = matches[0]
            if args.get("new_title"):
                event.title = args["new_title"]
            if args.get("new_start"):
                try:
                    event.start = datetime.fromisoformat(args["new_start"])
                    event.all_day = event.start.hour == 0 and event.start.minute == 0
                except ValueError:
                    return "new_start must be an ISO datetime."
            db.commit()
            await msgraph.push_update(db, event)
            return f"Updated event: '{event.title}' now {event.start.strftime('%A %b %d %H:%M')}."

        if name == "delete_event":
            matches = _match_events(args["title"])
            if not matches:
                return f"No upcoming event matching '{args['title']}'."
            if len(matches) > 1:
                return {"multiple_matches": [{"id": e.id, "title": e.title, "start": e.start.isoformat()} for e in matches]}
            event = matches[0]
            title, ms_id = event.title, event.ms_id
            db.delete(event); db.commit()
            if ms_id:
                await msgraph.push_delete(db, ms_id)
            return f"Deleted event '{title}'."

        if name == "list_chores":
            return [{"title": c.title, "assigned_to": c.assigned_to, "frequency": c.frequency}
                    for c in db.query(Chore).order_by(Chore.title).all()] or "No chores yet."

        if name == "update_chore":
            chore = db.query(Chore).filter(Chore.title.ilike(f"%{args['title']}%")).first()
            if not chore:
                return f"No chore matching '{args['title']}'."
            changes = []
            if args.get("assigned_to"):
                member = db.query(FamilyMember).filter(FamilyMember.name.ilike(f"%{args['assigned_to']}%")).first()
                chore.assigned_to = member.name if member else args["assigned_to"].strip().title()
                changes.append(f"assigned to {chore.assigned_to}")
            if args.get("frequency"):
                freq = args["frequency"].lower()
                if freq not in ("once", "daily", "weekly", "monthly"):
                    return "frequency must be once, daily, weekly, or monthly."
                chore.frequency = freq; changes.append(f"frequency {freq}")
            if args.get("new_title"):
                chore.title = args["new_title"]; changes.append(f"renamed to {chore.title}")
            if not changes:
                return "No fields to change were given."
            db.commit()
            return f"Updated chore '{chore.title}': {', '.join(changes)}."

        if name == "delete_chore":
            chore = db.query(Chore).filter(Chore.title.ilike(f"%{args['title']}%")).first()
            if not chore:
                return f"No chore matching '{args['title']}'."
            title = chore.title
            db.delete(chore); db.commit()
            return f"Deleted chore '{title}'."

        if name == "list_meals":
            days = int(args.get("days_ahead") or 7)
            today = date.today()
            meals = (db.query(MealPlan).filter(MealPlan.date >= today, MealPlan.date <= today + timedelta(days=days))
                     .order_by(MealPlan.date).all())
            return [{"date": m.date.isoformat(), "meal_type": m.meal_type, "title": m.title}
                    for m in meals] or "No meals planned."

        if name == "plan_meal":
            try:
                d = date.fromisoformat(args["date"])
            except ValueError:
                return "date must be YYYY-MM-DD."
            meal_type = (args.get("meal_type") or "dinner").lower()
            if meal_type not in ("breakfast", "lunch", "dinner", "snack"):
                meal_type = "dinner"
            meal = MealPlan(date=d, meal_type=meal_type, title=args["title"])
            db.add(meal); db.commit()
            return f"Planned {meal.title} for {meal_type} on {d.strftime('%A %b %d')}."

        if name == "remove_meal":
            q = db.query(MealPlan).filter(MealPlan.title.ilike(f"%{args['title']}%"))
            if args.get("date"):
                try:
                    q = q.filter(MealPlan.date == date.fromisoformat(args["date"]))
                except ValueError:
                    pass
            meal = q.first()
            if not meal:
                return f"No planned meal matching '{args['title']}'."
            title, d = meal.title, meal.date
            db.delete(meal); db.commit()
            return f"Removed {title} from {d.strftime('%A %b %d')}."

        return f"Unknown tool: {name}"

    except Exception as e:
        db.rollback()
        return f"Tool error: {e}"


def _system_prompt(context: str) -> str:
    today = date.today()
    return AGENT_SYSTEM.format(today=today.isoformat(), weekday=today.strftime("%A"), context=context or "(none)")


def _text_tool_call(content: str) -> dict | None:
    """Small local models sometimes write the tool call as plain JSON text
    ({"name": ..., "arguments": {...}}) instead of a structured tool_calls entry."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    if not (text.startswith("{") and '"name"' in text):
        return None
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if isinstance(data, dict) and isinstance(data.get("name"), str) and isinstance(data.get("arguments"), dict):
        return {"function": {"name": data["name"], "arguments": data["arguments"]}}
    return None


async def _agent_ollama(messages: list, host: str, model: str, db, source: str) -> str | None:
    async with httpx.AsyncClient(timeout=90.0) as client:
        for _ in range(MAX_TURNS):
            r = await client.post(f"{host}/api/chat", json={
                "model": model, "messages": messages, "tools": TOOLS, "stream": False,
            })
            r.raise_for_status()
            msg = r.json()["message"]
            messages.append(msg)
            calls = msg.get("tool_calls") or []
            if not calls:
                recovered = _text_tool_call(msg.get("content"))
                if recovered:
                    calls = [recovered]
                else:
                    return msg.get("content") or None
            for call in calls:
                fn = call.get("function", {})
                args = fn.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                result = await execute_tool(fn.get("name", ""), args, db, source)
                messages.append({"role": "tool", "tool_name": fn.get("name", ""), "content": json.dumps(result, default=str)})
    return None


async def _agent_openai(messages: list, api_key: str, model: str, db, source: str, base_url: str | None = None) -> str | None:
    from openai import AsyncOpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = AsyncOpenAI(**kwargs)
    for _ in range(MAX_TURNS):
        r = await client.chat.completions.create(model=model, messages=messages, tools=TOOLS, max_tokens=1024)
        msg = r.choices[0].message
        messages.append({"role": "assistant", "content": msg.content,
                         "tool_calls": [tc.model_dump() for tc in (msg.tool_calls or [])] or None})
        if not msg.tool_calls:
            return msg.content or None
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except ValueError:
                args = {}
            result = await execute_tool(tc.function.name, args, db, source)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)})
    return None


async def _agent_claude(system: str, messages: list, api_key: str, model: str, db, source: str) -> str | None:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=api_key)
    tools = [{"name": t["function"]["name"], "description": t["function"]["description"],
              "input_schema": t["function"]["parameters"]} for t in TOOLS]
    for _ in range(MAX_TURNS):
        r = await client.messages.create(model=model, max_tokens=1024, system=system, messages=messages, tools=tools)
        messages.append({"role": "assistant", "content": r.content})
        tool_uses = [b for b in r.content if b.type == "tool_use"]
        if not tool_uses:
            texts = [b.text for b in r.content if b.type == "text"]
            return "\n".join(texts) or None
        results = []
        for block in tool_uses:
            result = await execute_tool(block.name, dict(block.input or {}), db, source)
            results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, default=str)})
        messages.append({"role": "user", "content": results})
    return None


async def run_agent(user_message: str, db=None, source: str = "chat", context: str = "") -> str | None:
    """Run the tool loop with the configured provider. Returns the final reply text,
    or None when no provider is set / the loop didn't produce an answer."""
    provider = _db_setting(db, "llm_provider", env_settings.llm_provider)
    if provider in ("", "none"):
        return None

    system = _system_prompt(context)

    if provider == "claude":
        api_key = _db_setting(db, "anthropic_api_key", env_settings.anthropic_api_key)
        model = _db_setting(db, "claude_model", env_settings.claude_model) or "claude-haiku-4-5-20251001"
        return await _agent_claude(system, [{"role": "user", "content": user_message}], api_key, model, db, source)

    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_message}]

    if provider == "openai":
        api_key = _db_setting(db, "openai_api_key", env_settings.openai_api_key)
        model = _db_setting(db, "openai_model", env_settings.openai_model) or "gpt-4o-mini"
        return await _agent_openai(messages, api_key, model, db, source)

    if provider == "lmstudio":
        host = _db_setting(db, "lmstudio_host", env_settings.lmstudio_host)
        model = _db_setting(db, "lmstudio_model", env_settings.lmstudio_model) or "local-model"
        return await _agent_openai(messages, "lm-studio", model, db, source, base_url=f"{host}/v1")

    host = _db_setting(db, "ollama_host", env_settings.ollama_host)
    model = _db_setting(db, "ollama_model", env_settings.ollama_model)
    return await _agent_ollama(messages, host, model, db, source)
