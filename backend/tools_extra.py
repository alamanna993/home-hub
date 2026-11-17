"""More of the app for Emerald: chores, recipe edits, the shopping list, meal planning,
moving and merging locations, expiry, photos and the daily summary.

Every tool works on ORM objects (never Query.update/delete), so each change is seen by
the Undo recorder in changes.py. agent.py adds EXTRA_TOOLS to its tool list and sends
these names here; the MCP bridge hands them to Codex automatically."""
from datetime import date, datetime, timedelta

from sqlalchemy import func

from location_tree import tidy

from models import (CalendarEvent, Category, Chore, ChoreCompletion, FamilyMember, Item, Location, MealPlan,
                    Recipe, ShoppingItem)


def _tool(name, description, params, required=None):
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": params, "required": required or []}}}


_S = lambda d: {"type": "string", "description": d}  # noqa: E731
_A = lambda d: {"type": "array", "items": {"type": "string"}, "description": d}  # noqa: E731
_B = lambda d: {"type": "boolean", "description": d}  # noqa: E731
_I = lambda d: {"type": "integer", "description": d}  # noqa: E731

EXTRA_TOOLS = [
    # --- chores ---
    _tool("create_chore", "Add a chore to the chart.",
          {"title": _S("what needs doing, e.g. 'Water the plants'"), "person": _S("family member, blank = anyone"),
           "frequency": _S("once|daily|weekly|biweekly|monthly (default weekly)"),
           "day_of_week": _I("0=Monday .. 6=Sunday, for weekly chores")}, ["title"]),
    _tool("complete_chore", "Check a chore off as done.",
          {"title": _S("chore title or part of it"), "person": _S("who did it, if said")}, ["title"]),
    # --- recipes ---
    _tool("update_recipe", "Edit a saved recipe. Only pass what changes; ingredients and steps replace the whole list.",
          {"title": _S("current recipe title or part of it"), "new_title": _S("new title"),
           "ingredients": _A("the full ingredient list, one line each"), "steps": _A("the full method, one step each"),
           "tags": _A("tags"), "servings": _S("servings"), "notes": _S("family notes"),
           "favorite": _B("mark or unmark as a favorite"),
           "photo_url": _S("link to a photo for the recipe")}, ["title"]),
    _tool("restore_recipe", "Bring back a recipe from Recently deleted (kept for 30 days).",
          {"title": _S("deleted recipe title or part of it")}, ["title"]),
    # --- shopping list ---
    _tool("list_shopping", "Show the shopping list: what's still to buy and what's in the cart.", {}),
    _tool("add_to_shopping_list", "Put things on the shopping list. Items already on it are skipped.",
          {"items": _A("one entry per thing to buy, e.g. ['milk', '2 lb chicken thighs']"),
           "note": _S("why, e.g. the recipe it's for")}, ["items"]),
    _tool("check_off_shopping", "Tick something off the shopping list (it's in the cart).",
          {"name": _S("the item as it appears on the list")}, ["name"]),
    _tool("remove_from_shopping_list", "Take something off the shopping list.",
          {"name": _S("the item as it appears on the list")}, ["name"]),
    _tool("add_recipe_to_shopping_list", "Add the ingredients you don't have yet for a saved recipe to the shopping list.",
          {"title": _S("recipe title or part of it")}, ["title"]),
    # --- meals ---
    _tool("update_meal", "Change a planned meal: move it to another day or meal, or rename it.",
          {"title": _S("planned meal title or part of it"), "date": _S("its current date YYYY-MM-DD, if several match"),
           "new_title": _S("new title"), "new_date": _S("YYYY-MM-DD"),
           "new_meal_type": _S("breakfast|lunch|dinner|snack")}, ["title"]),
    _tool("plan_week", "Fill the meal plan with saved recipes for the next several days, favoring ones you can mostly make "
          "from what's in the house. Days that already have that meal are left alone.",
          {"days": _I("how many days, default 7"), "start_date": _S("YYYY-MM-DD, default today"),
           "meal_type": _S("breakfast|lunch|dinner|snack, default dinner")}),
    # --- inventory and locations ---
    _tool("move_items", "Move everything stored in one location (and the spots inside it) to another location.",
          {"from_location": _S("path or name, e.g. 'Kitchen > Bottom Turnstyle'"),
           "to_location": _S("path or name; created if it doesn't exist")}, ["from_location", "to_location"]),
    _tool("merge_locations", "Merge one location into another: its items and spots move over, then it is deleted.",
          {"from_location": _S("the location to fold away"), "into_location": _S("the location to keep")},
          ["from_location", "into_location"]),
    _tool("list_expiring", "Food that has expired or expires soon.", {"days": _I("look-ahead in days, default 7")}),
    _tool("set_item_photo", "Give an inventory item a photo from a link.",
          {"name": _S("item name"), "photo_url": _S("link to the photo")}, ["name", "photo_url"]),
    # --- people and categories ---
    _tool("update_family_member", "Rename a family member or change their emoji or photo.",
          {"name": _S("current name"), "new_name": _S("new name"), "icon": _S("emoji"),
           "photo_url": _S("link to a photo")}, ["name"]),
    _tool("update_category", "Rename a category or change its emoji.",
          {"name": _S("current name"), "new_name": _S("new name"), "icon": _S("emoji")}, ["name"]),
    # --- summary ---
    _tool("today_summary", "Today at a glance: events, dinner, chores, what's expiring, what's low, the shopping list.", {}),
]
EXTRA_NAMES = {t["function"]["name"] for t in EXTRA_TOOLS}
READ_ONLY = {"list_shopping", "list_expiring", "today_summary"}


def _as_list(value) -> list[str]:
    if isinstance(value, str):
        import re
        return [v.strip(" -•") for v in re.split(r"\n|;", value) if v.strip(" -•")]
    return [str(v).strip() for v in (value or []) if str(v).strip()]


def _day(text: str | None) -> date | None:
    try:
        return date.fromisoformat((text or "")[:10])
    except ValueError:
        return None


async def run(name: str, args: dict, db, source: str):
    from routers import recipes as rx
    from routers import shopping as sh

    # ---------------------------------------------------------------- chores
    if name == "create_chore":
        from routers.chores import FREQUENCIES, pick_chore_icon
        title = args["title"].strip()
        title = title[:1].upper() + title[1:]
        if db.query(Chore).filter(Chore.title.ilike(title)).first():
            return f"There's already a chore called '{title}'."
        freq = (args.get("frequency") or "weekly").lower()
        if freq not in FREQUENCIES:
            freq = "weekly"
        person = (args.get("person") or "").strip() or None
        if person:
            m = db.query(FamilyMember).filter(FamilyMember.name.ilike(f"%{person}%")).first()
            person = m.name if m else tidy(person)
        day = args.get("day_of_week")
        chore = Chore(title=title, assigned_to=person, frequency=freq, icon=pick_chore_icon(title),
                      day_of_week=day if freq in ("weekly", "biweekly") and isinstance(day, int) else None)
        db.add(chore)
        db.commit()
        return f"Added chore '{title}' ({freq}{', ' + person if person else ''})."

    if name == "complete_chore":
        from routers.chat import credited_person
        word = args["title"].strip()
        chore = db.query(Chore).filter(Chore.title.ilike(f"%{word}%")).first()
        if not chore:
            for w in word.split():
                if len(w) > 3 and (chore := db.query(Chore).filter(Chore.title.ilike(f"%{w}%")).first()):
                    break
        if not chore:
            return f"No chore matching '{word}'."
        who = (args.get("person") or "").strip()
        m = db.query(FamilyMember).filter(FamilyMember.name.ilike(f"%{who}%")).first() if who else None
        who = m.name if m else (tidy(who) if who else credited_person(db, source) or chore.assigned_to)
        db.add(ChoreCompletion(chore_id=chore.id, completed_by=who))
        db.commit()
        return f"Checked off '{chore.title}'" + (f" for {who}." if who else ".")

    # --------------------------------------------------------------- recipes
    if name == "update_recipe":
        matches = rx.find_by_title(db, args["title"])
        if not matches:
            return f"No saved recipe matching '{args['title']}'."
        if len(matches) > 1:
            return {"multiple_matches": [m.title for m in matches]}
        r = matches[0]
        data = {}
        if args.get("new_title"):
            data["title"] = args["new_title"]
        for key in ("ingredients", "steps", "tags"):
            if args.get(key) is not None:
                data[key] = _as_list(args[key])
        for key in ("servings", "notes", "photo_url"):
            if args.get(key):
                data["image_url" if key == "photo_url" else key] = args[key]
        if args.get("favorite") is not None:
            data["favorite"] = bool(args["favorite"])
        if not data:
            return "Nothing to change was given."
        rx._apply(r, data)
        db.commit()
        return f"Updated '{r.title}': {', '.join(k.replace('image_url', 'photo') for k in data)}."

    if name == "restore_recipe":
        t = args["title"].strip()
        r = (db.query(Recipe).filter(Recipe.deleted_at.isnot(None), Recipe.title.ilike(f"%{t}%"))
             .order_by(Recipe.deleted_at.desc()).first())
        if not r:
            return f"No deleted recipe matching '{t}' (they're kept for 30 days)."
        r.deleted_at = None
        db.commit()
        return f"Restored '{r.title}'."

    # -------------------------------------------------------------- shopping
    if name == "list_shopping":
        rows = db.query(ShoppingItem).order_by(ShoppingItem.checked_at.isnot(None), ShoppingItem.created_at).all()
        if not rows:
            return "The shopping list is empty."
        return {"to_buy": [(s.name + (f" ({s.amount})" if s.amount else "")) for s in rows if not s.checked_at],
                "in_cart": [s.name for s in rows if s.checked_at]}

    if name == "add_to_shopping_list":
        who = source.split(":", 1)[-1] if ":" in source else source
        added, had = [], []
        for text in _as_list(args["items"]):
            row, created = sh.add_line(db, text, note=args.get("note"), source="emerald", added_by=who)
            (added if created else had).append(row.name)
        db.commit()
        out = f"Added to the list: {', '.join(added)}." if added else ""
        if had:
            out += f" Already on it: {', '.join(had)}."
        return out.strip() or "Nothing to add."

    if name in ("check_off_shopping", "remove_from_shopping_list"):
        word = args["name"].strip()
        rows = (db.query(ShoppingItem).filter(ShoppingItem.name.ilike(f"%{word}%"))
                .order_by(ShoppingItem.checked_at.isnot(None)).all())
        if not rows:
            return f"'{word}' isn't on the shopping list."
        exact = [s for s in rows if s.name.lower() == word.lower()]
        row = (exact or rows)[0]
        if name == "check_off_shopping":
            row.checked_at = datetime.utcnow()
            db.commit()
            return f"Ticked off {row.name}."
        label = row.name
        db.delete(row)
        db.commit()
        return f"Removed {label} from the list."

    if name == "add_recipe_to_shopping_list":
        matches = rx.find_by_title(db, args["title"])
        if not matches:
            return f"No saved recipe matching '{args['title']}'."
        if len(matches) > 1:
            return {"multiple_matches": [m.title for m in matches]}
        who = source.split(":", 1)[-1] if ":" in source else source
        res = sh.add_recipe_missing(db, matches[0], who, source="emerald")
        if not res["added"] and not res["already_on_list"]:
            return f"You have everything for '{matches[0].title}'."
        return (f"Added for '{matches[0].title}': {', '.join(res['added']) or 'nothing new'}."
                + (f" {res['already_on_list']} already on the list." if res["already_on_list"] else ""))

    # ----------------------------------------------------------------- meals
    if name == "update_meal":
        q = db.query(MealPlan).filter(MealPlan.title.ilike(f"%{args['title']}%"), MealPlan.date >= date.today() - timedelta(days=1))
        if _day(args.get("date")):
            q = q.filter(MealPlan.date == _day(args["date"]))
        meals = q.order_by(MealPlan.date).limit(5).all()
        if not meals:
            return f"No planned meal matching '{args['title']}'."
        if len(meals) > 1:
            return {"multiple_matches": [{"title": m.title, "date": m.date.isoformat(), "meal": m.meal_type} for m in meals]}
        m = meals[0]
        if args.get("new_title"):
            m.title = args["new_title"]
        if _day(args.get("new_date")):
            m.date = _day(args["new_date"])
        nt = (args.get("new_meal_type") or "").lower()
        if nt in ("breakfast", "lunch", "dinner", "snack"):
            m.meal_type = nt
        db.commit()
        return f"'{m.title}' is now {m.meal_type} on {m.date.strftime('%A %b %d')}."

    if name == "plan_week":
        days = max(1, min(int(args.get("days") or 7), 31))
        start = _day(args.get("start_date")) or date.today()
        mt = (args.get("meal_type") or "dinner").lower()
        if mt not in ("breakfast", "lunch", "dinner", "snack"):
            mt = "dinner"
        recipes = rx.live_recipes(db).all()
        if not recipes:
            return "There are no saved recipes to plan from yet."
        food = rx._food(db)

        def score(r):
            s = rx.pantry_summary(rx.pantry_match(r.ingredients or [], food))
            return (s["have"] / s["total"]) if s["total"] else 0
        pool = sorted(recipes, key=lambda r: (-score(r), r.title.lower()))
        end = start + timedelta(days=days - 1)
        have = {m.date for m in db.query(MealPlan).filter(MealPlan.date >= start, MealPlan.date <= end, MealPlan.meal_type == mt)}
        recent = {m.recipe_id for m in db.query(MealPlan).filter(
            MealPlan.date >= start - timedelta(days=5), MealPlan.date < start, MealPlan.recipe_id.isnot(None))}
        planned = {m.recipe_id for m in db.query(MealPlan).filter(MealPlan.date >= start, MealPlan.date <= end,
                                                                  MealPlan.recipe_id.isnot(None))}
        queue = [r for r in pool if r.id not in recent and r.id not in planned] or pool
        out, i = [], 0
        for k in range(days):
            d = start + timedelta(days=k)
            if d in have:
                continue
            if i >= len(queue):
                break
            r = queue[i]; i += 1
            db.add(MealPlan(date=d, meal_type=mt, title=r.title, recipe_id=r.id))
            out.append(f"{d.strftime('%a %b %d')}: {r.title}")
        db.commit()
        if not out:
            return "Every day in that range already has a meal planned."
        note = "" if i >= 1 and len(recipes) >= len(out) else " (some recipes repeat; save more to add variety)"
        return {"planned": out, "note": note.strip()}

    # ------------------------------------------------- locations and inventory
    if name in ("move_items", "merge_locations"):
        from agent import _find_location
        from location_tree import descendant_ids, path_str, resolve_path, split_path, children_map
        src_text = args["from_location"]
        src = _find_location(db, src_text)
        if not src:
            return f"No location matching '{src_text}'."
        if name == "move_items":
            dst = resolve_path(db, split_path(args["to_location"]))
            db.flush()
            if dst.id in {src.id}:
                return "Those are the same location."
            ids = descendant_ids(db, src.id)
            items = db.query(Item).filter(Item.location_id.in_(ids)).all()
            for it in items:
                it.location_id = dst.id
            db.commit()
            return f"Moved {len(items)} item(s) from {path_str(src)} to {path_str(dst)}."
        dst = _find_location(db, args["into_location"])
        if not dst:
            return f"No location matching '{args['into_location']}'."
        if dst.id in descendant_ids(db, src.id):
            return "A location can't be merged into something inside itself."
        if dst.id == src.id:
            return "Those are the same location."
        moved = {"items": 0, "spots": 0}

        def merge(a: Location, b: Location):
            for it in db.query(Item).filter(Item.location_id == a.id).all():
                it.location_id = b.id
                moved["items"] += 1
            for c in db.query(Location).filter(Location.parent_id == a.id).all():
                twin = (db.query(Location).filter(Location.parent_id == b.id, func.lower(Location.name) == c.name.lower())
                        .first())
                if twin and twin.id != c.id:
                    merge(c, twin)
                else:
                    c.parent_id = b.id
                    moved["spots"] += 1
            db.flush()          # everything out of `a` before it goes
            db.delete(a)
            db.flush()
        label = path_str(src)
        merge(src, dst)
        db.commit()
        return f"Merged {label} into {path_str(dst)} ({moved['items']} item(s) and {moved['spots']} spot(s) moved)."

    if name == "list_expiring":
        horizon = date.today() + timedelta(days=int(args.get("days") or 7))
        items = (db.query(Item).filter(Item.expiration_date.isnot(None), Item.expiration_date <= horizon,
                                       (Item.quantity.is_(None)) | (Item.quantity > 0))
                 .order_by(Item.expiration_date).all())
        from location_tree import path_str
        return [{"name": i.name, "expires": i.expiration_date.isoformat(),
                 "status": "expired" if i.expiration_date < date.today() else "expiring",
                 "where": path_str(i.location) if i.location else None} for i in items] or "Nothing is expiring soon."

    if name == "set_item_photo":
        from routers.media import localize_url
        item = db.query(Item).filter(Item.name.ilike(f"%{args['name']}%")).first()
        if not item:
            return f"No item matching '{args['name']}'."
        local = localize_url(args["photo_url"])
        if not local or local.startswith("http"):
            return "I couldn't download that photo. Try another link."
        item.image_url = local
        db.commit()
        return f"Set a photo for {item.name}."

    # ---------------------------------------------------- people & categories
    if name == "update_family_member":
        m = db.query(FamilyMember).filter(FamilyMember.name.ilike(f"%{args['name']}%")).first()
        if not m:
            return f"No family member matching '{args['name']}'."
        old = m.name
        if args.get("new_name"):
            m.name = tidy(args["new_name"])
            for c in db.query(Chore).filter(Chore.assigned_to == old).all():   # chores follow the new name
                c.assigned_to = m.name
        if args.get("icon"):
            m.icon = args["icon"]
        if args.get("photo_url"):
            from routers.media import localize_url
            local = localize_url(args["photo_url"])
            if local and not local.startswith("http"):
                m.photo_url = local
        db.commit()
        return f"Updated {old}" + (f" → {m.name}." if m.name != old else ".")

    if name == "update_category":
        c = db.query(Category).filter(Category.name.ilike(f"%{args['name']}%")).first()
        if not c:
            return f"No category matching '{args['name']}'."
        if args.get("new_name"):
            c.name = tidy(args["new_name"])
        if args.get("icon"):
            c.icon = args["icon"]
        db.commit()
        return f"Updated category {c.name}."

    if name == "today_summary":
        from briefing import build_briefing
        return await build_briefing(db)

    return f"Unknown tool: {name}"
