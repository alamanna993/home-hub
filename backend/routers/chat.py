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
    parsed = await parse_message(req.message)
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
        item = find_best_item_match(item_name, db)
        if item:
            if parsed.get("quantity") is not None:
                item.quantity = parsed["quantity"]
                db.commit()
            reply = f"✅ Updated **{item.name}** — qty now {item.quantity}."
        else:
            reply = f"❌ Couldn't find **{item_name}** to update."
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
        reply = "🤔 I'm not sure what you meant. Try: 'where is my drill', 'add 2 boxes of pasta to pantry', or 'what's running low?'"
        return {"reply": reply, "action": "unknown", "parsed": parsed}
