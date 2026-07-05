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


@router.post("/")
async def chat(req: ChatRequest, db: Session = Depends(get_db)):
    parsed = await parse_message(req.message, db)
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
        low_items = db.query(Item).filter(
            Item.low_stock_threshold.isnot(None),
            Item.quantity <= Item.low_stock_threshold,
        ).all()
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
        else:
            reply = "No items found for that filter."
        return {"reply": reply, "action": action}

    else:
        if parsed.get("no_ai"):
            from llm import NO_AI_NOTICE
            reply = f"🤖 {NO_AI_NOTICE}"
        else:
            reply = "🤔 I'm not sure what you meant. Try: 'where is my drill', 'add 2 boxes of pasta to pantry', or 'what's running low?'"
        return {"reply": reply, "action": "unknown", "parsed": parsed}
