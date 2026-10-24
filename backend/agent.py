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

AGENT_SYSTEM = """You are Emerald, the family's assistant in HomeHub, their home app. Today is {today} ({weekday}).
You have tools that read and MODIFY the household database. When the user wants something
changed, do it: look the record up first if you need its exact name, call the right tool,
then confirm in one short friendly sentence (it may show in a small Telegram bubble).
When the user adds several things at once (a list of books, a shopping haul), call
create_item once per item — never skip any, and fill in author/category from your
own knowledge when the user didn't say.
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
_A = lambda d: {"type": "array", "items": {"type": "string"}, "description": d}  # noqa: E731


def _as_list(value) -> list[str]:
    """Small models sometimes send a list as one newline/semicolon-separated string."""
    if isinstance(value, str):
        import re
        return [v.strip(" -•") for v in re.split(r"\n|;", value) if v.strip(" -•")]
    return [str(v) for v in (value or [])]

TOOLS = [
    # --- inventory ---
    _tool("find_items", "Search inventory items by name. Returns matches with id, quantity and location.",
          {"search": _S("part of the item name")}, ["search"]),
    _tool("create_item", "Add ONE new item to the inventory. For a list of things, call this once per item.",
          {"name": _S("item name"), "quantity": {"type": "number", "description": "how many (default 1)"},
           "unit": _S("e.g. bottles, boxes, lbs"), "location": _S("room it's stored in, e.g. Office"),
           "sublocation": _S("where inside the room, as a path: 'Bookshelf > Right side > Third shelf up'"),
           "category": _S("best-fit category, e.g. Books / Media"),
           "author": _S("author/artist/creator for books & media"),
           "notes": _S("extra details"), "expiration_date": _S("YYYY-MM-DD for food"),
           "open_amount": {"type": "number", "description": "what's left in the opened package: a count of pack_unit pieces (1 bagel), or a fraction 0-1 when there's no pack_unit (0.25 = a quarter of the tub)"},
           "pack_unit": _S("piece name when counted, singular, e.g. bagel"),
           "pack_size": {"type": "number", "description": "pieces in a full package, e.g. 6"}}, ["name"]),
    _tool("update_item", "Update an inventory item found by name: quantity (whole packages), location, category, author/artist, notes, expiration date, or how much is left in the opened package. Only pass fields to change.",
          {"name": _S("item name to find"), "quantity": {"type": "number", "description": "new quantity"},
           "location": _S("new room"), "sublocation": _S("where inside the room, as a path: 'Bookshelf > Right side'"),
           "category": _S("category name"), "author": _S("author/artist/creator for books & media"),
           "notes": _S("new notes"), "expiration_date": _S("YYYY-MM-DD"),
           "open_amount": {"type": "number", "description": "what's left in the opened package: a count of pack_unit pieces (1 bagel), or a fraction 0-1 when there's no pack_unit (0.25 = a quarter of the tub)"},
           "pack_unit": _S("piece name when counted, singular, e.g. bagel"),
           "pack_size": {"type": "number", "description": "pieces in a full package, e.g. 6"}}, ["name"]),
    _tool("use_item", "Someone used or ate some of an item counted in pieces (ate a bagel): takes them out of the opened package.",
          {"name": _S("item name to find"), "count": {"type": "integer", "description": "pieces used, default 1"}}, ["name"]),
    _tool("delete_item", "Mark an inventory item as gone (quantity 0, kept on the list for restocking).",
          {"name": _S("item name to find")}, ["name"]),
    # --- locations ---
    _tool("list_locations", "List every storage location as a path from its room ('Office > Bookshelf > Right side') with item counts.", {}),
    _tool("create_location", "Create a storage location. Give the full path; missing levels are created too.",
          {"name": _S("path from the room, e.g. 'Attic' or 'Office > Bookshelf > Right side'")}, ["name"]),
    _tool("update_location", "Rename a location and/or move it inside another one.",
          {"name": _S("the location's path or name, e.g. 'Office > Bookshelf'"), "new_name": _S("new name for that level"),
           "move_under": _S("path of the new parent, or 'top' to make it a room")}, ["name"]),
    _tool("delete_location", "Delete a location. Fails if items are stored in it or anywhere inside it.",
          {"name": _S("the location's path or name")}, ["name"]),
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
           "frequency": _S("once|daily|weekly|biweekly|monthly"), "new_title": _S("new title")}, ["title"]),
    _tool("reassign_chore", "Hand a chore to another person. Set temporary=true for 'just this week/time' — it reverts automatically next period.",
          {"title": _S("chore title (or part of it)"), "person": _S("family member taking it over"),
           "temporary": {"type": "boolean", "description": "true = only until the current period ends"}},
          ["title", "person"]),
    _tool("delete_chore", "Delete a chore from the chart.", {"title": _S("chore title or part of it")}, ["title"]),
    # --- meals ---
    _tool("list_meals", "List planned meals for the next N days (default 7).",
          {"days_ahead": {"type": "integer", "description": "default 7"}}),
    _tool("plan_meal", "Put a meal on the meal plan.",
          {"date": _S("YYYY-MM-DD"), "meal_type": _S("breakfast|lunch|dinner|snack"), "title": _S("what's being made")},
          ["date", "title"]),
    _tool("remove_meal", "Remove a planned meal found by title (optionally narrowed by date).",
          {"title": _S("meal title or part of it"), "date": _S("optional YYYY-MM-DD")}, ["title"]),
    # --- recipes ---
    _tool("find_recipes", "Search saved recipes by name, ingredient, tag, or cuisine (blank = list all). "
          "Each result says how many ingredients are on hand.",
          {"search": _S("e.g. 'chicken', 'pasta', 'vegetarian'")}),
    _tool("get_recipe", "Show one saved recipe in full: ingredients (with what's on hand) and steps.",
          {"title": _S("recipe title or part of it")}, ["title"]),
    _tool("save_recipe", "Save a new recipe to the family cookbook.",
          {"title": _S("recipe name"), "ingredients": _A("one entry per ingredient line, with amounts"),
           "steps": _A("one entry per instruction, in order"), "servings": _S("e.g. 4"),
           "prep_minutes": {"type": "integer"}, "cook_minutes": {"type": "integer"},
           "tags": _A("short tags like dinner, vegetarian"), "description": _S("one-line summary"),
           "source_url": _S("where it came from"), "notes": _S("family notes")}, ["title"]),
    _tool("import_recipe_url", "Save a recipe from a web page link into the cookbook.",
          {"url": _S("full https:// link")}, ["url"]),
    _tool("plan_recipe", "Put a saved recipe on the meal plan.",
          {"title": _S("recipe title or part of it"), "date": _S("YYYY-MM-DD"),
           "meal_type": _S("breakfast|lunch|dinner|snack")}, ["title", "date"]),
    _tool("delete_recipe", "Move a saved recipe to Recently deleted (restorable for 30 days).",
          {"title": _S("recipe title or part of it")}, ["title"]),
]


def _loc_str(loc) -> str:
    from location_tree import path_str
    return path_str(loc) if loc else "no location"


def _find_location(db, path: str):
    """A location by path ('Office > Bookshelf') or bare name, without creating anything."""
    from location_tree import resolve_path, split_path
    segments = split_path(path)
    loc = resolve_path(db, segments, create=False)
    # resolve_path stops at the deepest match; only accept it when every level matched
    if loc is not None and len(segments) > 1:
        from location_tree import path_of
        if len(path_of(loc)) < len(segments) and loc.name.lower() != segments[-1].lower():
            return None
    return loc


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
            from routers.items import open_label
            return [{"id": i.id, "name": i.name, "quantity": i.quantity, "unit": i.unit,
                     "open_package": open_label(i), "location": _loc_str(i.location)} for i in items] or "No matching items."

        if name == "create_item":
            from routers.chat import find_or_create_category
            item = Item(
                name=args["name"].strip(),
                quantity=args.get("quantity") if args.get("quantity") is not None else 1,
                unit=args.get("unit"),
                author=args.get("author"),
                location_id=find_or_create_location(args.get("location"), args.get("sublocation"), db),
                category_id=find_or_create_category(args.get("category"), db),
                notes=args.get("notes"),
            )
            if args.get("expiration_date"):
                try:
                    item.expiration_date = date.fromisoformat(args["expiration_date"][:10])
                except ValueError:
                    return "expiration_date must be YYYY-MM-DD."
            if any(args.get(k) is not None for k in ("open_amount", "pack_size", "pack_unit")):
                from routers.items import set_open_package
                set_open_package(item, args.get("open_amount"), args.get("pack_unit"), args.get("pack_size"))
            db.add(item)
            db.add(AuditLog(action="created", item_name=item.name, changed_by=source,
                            details=f"qty: {item.quantity:g} {item.unit or ''}".strip()))
            db.commit()
            return f"Added {item.name}" + (f" by {item.author}" if item.author else "") + \
                   f" to {_loc_str(item.location)}."

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
            if args.get("author"):
                item.author = args["author"]; changes.append(f"author → {item.author}")
            if args.get("category"):
                from routers.chat import find_or_create_category
                item.category_id = find_or_create_category(args["category"], db)
                changes.append(f"category → {args['category']}")
            if args.get("expiration_date"):
                try:
                    item.expiration_date = date.fromisoformat(args["expiration_date"][:10])
                    changes.append(f"expires {item.expiration_date.isoformat()}")
                except ValueError:
                    return "expiration_date must be YYYY-MM-DD."
            if any(args.get(k) is not None for k in ("open_amount", "pack_size")):
                from routers.items import set_open_package
                changes += set_open_package(item, args.get("open_amount"), args.get("pack_unit"), args.get("pack_size"))
            if not changes:
                return "No fields to change were given."
            db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details="; ".join(changes)))
            db.commit()
            return f"Updated {item.name}: {', '.join(changes)}."

        if name == "use_item":
            from routers.items import use_one
            item = db.query(Item).filter(Item.name.ilike(f"%{args['name']}%")).first()
            if not item:
                return f"No item matching '{args['name']}'."
            count = max(1, int(args.get("count") or 1))
            try:
                if item.pack_unit:
                    for _ in range(count):
                        detail = use_one(item)
                else:
                    item.quantity = max(0.0, (item.quantity or 0) - count)
                    detail = f"used {count}; {item.quantity:g} left"
            except ValueError as e:
                return str(e)
            db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details=detail))
            db.commit()
            from routers.items import stock_phrase
            return f"{item.name}: {stock_phrase(item)}." 

        if name == "delete_item":
            item = db.query(Item).filter(Item.name.ilike(f"%{args['name']}%")).first()
            if not item:
                return f"No item matching '{args['name']}'."
            item.quantity = 0
            db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details="marked as gone (qty 0) via chat agent"))
            db.commit()
            return f"Marked {item.name} as gone (qty 0, kept for restocking)."

        if name == "list_locations":
            from location_tree import tree_order, path_str, descendant_ids, children_map
            kids = children_map(db)
            out = []
            for loc, _ in tree_order(db):
                ids = descendant_ids(db, loc.id, kids)
                out.append({"path": path_str(loc, " > "),
                            "items": db.query(Item).filter(Item.location_id.in_(ids)).count()})
            return out or "No locations yet."

        if name == "create_location":
            from location_tree import resolve_path, split_path, path_str
            existing = _find_location(db, args["name"])
            if existing is not None and existing.name.lower() == split_path(args["name"])[-1].lower():
                return f"'{path_str(existing)}' already exists."
            loc = resolve_path(db, split_path(args["name"]))
            db.commit()
            return f"Created {path_str(loc)}."

        if name == "update_location":
            from location_tree import path_str, descendant_ids, tidy
            loc = _find_location(db, args["name"])
            if not loc:
                return f"No location matching '{args['name']}'."
            old = path_str(loc)
            if args.get("new_name"):
                loc.name = tidy(args["new_name"])
            target = (args.get("move_under") or "").strip()
            if target:
                if target.lower() in ("top", "none", "room", "top level"):
                    loc.parent_id = None
                else:
                    parent = _find_location(db, target)
                    if not parent:
                        return f"No location matching '{target}' to move it into."
                    if parent.id in descendant_ids(db, loc.id):
                        return "A location can't go inside itself."
                    loc.parent_id = parent.id
            db.commit()
            db.refresh(loc)
            return f"Updated {old} → {path_str(loc)}."

        if name == "delete_location":
            from location_tree import path_str, descendant_ids
            loc = _find_location(db, args["name"])
            if not loc:
                return f"No location matching '{args['name']}'."
            count = db.query(Item).filter(Item.location_id.in_(descendant_ids(db, loc.id))).count()
            if count:
                return f"Can't delete {path_str(loc)}: {count} item(s) are stored in it. Move them first."
            label = path_str(loc)
            db.query(Location).filter(Location.parent_id == loc.id).update({Location.parent_id: loc.parent_id})
            db.delete(loc); db.commit()
            return f"Deleted {label}."

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
                if freq not in ("once", "daily", "weekly", "biweekly", "monthly"):
                    return "frequency must be once, daily, weekly, biweekly, or monthly."
                chore.frequency = freq; changes.append(f"frequency {freq}")
            if args.get("new_title"):
                chore.title = args["new_title"]; changes.append(f"renamed to {chore.title}")
            if not changes:
                return "No fields to change were given."
            db.commit()
            return f"Updated chore '{chore.title}': {', '.join(changes)}."

        if name == "reassign_chore":
            from routers.chores import reassign_chore as _reassign, ReassignRequest
            chore = db.query(Chore).filter(Chore.title.ilike(f"%{args['title']}%")).first()
            if not chore:
                return f"No chore matching '{args['title']}'."
            person = args["person"].strip()
            member = db.query(FamilyMember).filter(FamilyMember.name.ilike(f"%{person}%")).first()
            if member:
                person = member.name
            temporary = bool(args.get("temporary"))
            result = _reassign(chore.id, ReassignRequest(person=person, permanent=not temporary), db)
            if result.get("override_active"):
                return f"{result['title']} is {person}'s until next period, then it goes back to {result['original_assigned_to'] or 'anyone'}."
            return f"Reassigned '{result['title']}' to {person}."

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

        if name in ("find_recipes", "get_recipe", "save_recipe", "import_recipe_url", "plan_recipe", "delete_recipe"):
            return await _recipe_tool(name, args, db, source)

        return f"Unknown tool: {name}"

    except Exception as e:
        db.rollback()
        return f"Tool error: {e}"


async def _recipe_tool(name: str, args: dict, db, source: str):
    from datetime import datetime as _dt
    from models import Recipe, MealPlan
    from routers import recipes as rx

    if name == "find_recipes":
        found = rx.search_recipes(db, args.get("search") or None)
        return [rx.recipe_brief(r, db) for r in found[:15]] or "No saved recipes match."

    if name == "save_recipe":
        title = args["title"].strip()
        if rx.live_recipes(db).filter(Recipe.title.ilike(title)).first():
            return f"There's already a recipe called '{title}'."
        r = Recipe(title=title, ingredients=_as_list(args.get("ingredients")), steps=_as_list(args.get("steps")),
                   tags=_as_list(args.get("tags")), servings=args.get("servings"),
                   prep_minutes=args.get("prep_minutes"), cook_minutes=args.get("cook_minutes"),
                   description=args.get("description"), source_url=args.get("source_url"),
                   notes=args.get("notes"), created_by=source)
        db.add(r); db.commit()
        return f"Saved recipe '{r.title}' ({len(r.ingredients)} ingredients, {len(r.steps)} steps)."

    if name == "import_recipe_url":
        draft = await rx.fetch_recipe_draft(args["url"], db)
        draft.pop("imported_by", None)
        if rx.live_recipes(db).filter(Recipe.title.ilike(draft["title"])).first():
            return f"'{draft['title']}' is already in the cookbook."
        r = Recipe(created_by=source, **{k: v for k, v in draft.items() if hasattr(Recipe, k)})
        db.add(r); db.commit()
        return f"Saved '{r.title}' from the link ({len(r.ingredients)} ingredients, {len(r.steps)} steps)."

    matches = rx.find_by_title(db, args["title"])
    if not matches:
        return f"No saved recipe matching '{args['title']}'."
    if len(matches) > 1:
        return {"multiple_matches": [m.title for m in matches]}
    r = matches[0]

    if name == "get_recipe":
        lines = rx.pantry_match(r.ingredients or [], rx._food(db))
        return {"title": r.title, "servings": r.servings, "prep_minutes": r.prep_minutes,
                "cook_minutes": r.cook_minutes,
                "ingredients": [l["text"] + {"have": " (on hand)", "missing": " (need)"}.get(l["status"], "")
                                for l in lines],
                "steps": r.steps or [], "notes": r.notes}

    if name == "plan_recipe":
        try:
            d = date.fromisoformat(args["date"])
        except ValueError:
            return "date must be YYYY-MM-DD."
        meal_type = (args.get("meal_type") or "dinner").lower()
        if meal_type not in rx.MEAL_TYPES:
            meal_type = "dinner"
        db.add(MealPlan(date=d, meal_type=meal_type, title=r.title, recipe_id=r.id)); db.commit()
        return f"Planned {r.title} for {meal_type} on {d.strftime('%A %b %d')}."

    if name == "delete_recipe":
        r.deleted_at = _dt.utcnow(); db.commit()
        return f"Moved '{r.title}' to Recently deleted — it can be restored for 30 days."


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
                "think": False,
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


async def _agent_with(provider: str, user_message: str, db, source: str, system: str) -> str | None:
    from llm import provider_model, codex_options
    if provider == "codex":
        from codex_brain import codex_agent
        return await codex_agent(system, user_message, source, **codex_options(db))

    model = provider_model(provider, db)
    if provider == "claude":
        api_key = _db_setting(db, "anthropic_api_key", env_settings.anthropic_api_key)
        return await _agent_claude(system, [{"role": "user", "content": user_message}], api_key, model, db, source)

    messages = [{"role": "system", "content": system}, {"role": "user", "content": user_message}]
    if provider == "openai":
        api_key = _db_setting(db, "openai_api_key", env_settings.openai_api_key)
        return await _agent_openai(messages, api_key, model, db, source)
    if provider == "lmstudio":
        host = _db_setting(db, "lmstudio_host", env_settings.lmstudio_host)
        return await _agent_openai(messages, "lm-studio", model, db, source, base_url=f"{host}/v1")
    host = _db_setting(db, "ollama_host", env_settings.ollama_host)
    return await _agent_ollama(messages, host, model, db, source)


async def run_agent(user_message: str, db=None, source: str = "chat", context: str = "") -> str | None:
    """Run the tool loop on Emerald's primary brain, falling back to the backup.
    Returns the final reply text, or None when no brain produced an answer."""
    from llm import with_fallback, brain_chain
    if not brain_chain(db):
        return None
    system = _system_prompt(context)
    try:
        return await with_fallback(db, lambda p: _agent_with(p, user_message, db, source, system))
    except Exception as e:
        logger.warning("agent failed on every brain: %s", e)
        return None
