"""The family's shared shopping list: add by hand, from what's running low, from a
recipe's missing ingredients, or by asking Emerald. Check lines off in the store;
'Done shopping' puts what was bought into the inventory."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import Item, Recipe, ShoppingItem, User

router = APIRouter(prefix="/shopping", tags=["shopping"])


class ShoppingIn(BaseModel):
    name: str
    amount: Optional[str] = None
    note: Optional[str] = None
    item_id: Optional[int] = None


class ShoppingUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[str] = None
    note: Optional[str] = None


class CheckIn(BaseModel):
    checked: bool = True


class DoneIn(BaseModel):
    # Checked lines to put into the inventory; other checked lines are just cleared
    inventory_ids: list[int] = []


def row_to_dict(s: ShoppingItem) -> dict:
    return {"id": s.id, "name": s.name, "amount": s.amount, "note": s.note, "source": s.source,
            "item_id": s.item_id, "recipe_id": s.recipe_id, "added_by": s.added_by,
            "checked": s.checked_at is not None,
            "created_at": s.created_at.isoformat() if s.created_at else None}


def find_open(db: Session, name: str) -> ShoppingItem | None:
    return (db.query(ShoppingItem)
            .filter(func.lower(ShoppingItem.name) == name.strip().lower(), ShoppingItem.checked_at.is_(None))
            .first())


def add_line(db: Session, name: str, *, amount: str | None = None, note: str | None = None,
             source: str = "manual", added_by: str = "dashboard",
             item_id: int | None = None, recipe_id: int | None = None) -> tuple[ShoppingItem, bool]:
    """Add one line; returns (row, created). An unchecked line with the same name is reused."""
    name = " ".join(name.split())
    if not name:
        raise HTTPException(status_code=400, detail="Say what to buy")
    existing = find_open(db, name)
    if existing:
        return existing, False
    if item_id is None:   # link to an inventory item of the same name, so 'Done' can restock it
        match = db.query(Item).filter(func.lower(Item.name) == name.lower()).first()
        item_id = match.id if match else None
    row = ShoppingItem(name=name, amount=(amount or None), note=(note or None), source=source,
                       added_by=added_by, item_id=item_id, recipe_id=recipe_id)
    db.add(row)
    db.flush()
    return row, True


def suggestions(db: Session) -> list[dict]:
    """Things running low that aren't on the list yet."""
    from routers.items import is_low, open_label
    on_list = {s.name.lower() for s in db.query(ShoppingItem).filter(ShoppingItem.checked_at.is_(None)).all()}
    on_list_ids = {s.item_id for s in db.query(ShoppingItem).filter(ShoppingItem.checked_at.is_(None)) if s.item_id}
    out = []
    for item in db.query(Item).order_by(Item.name).all():
        if is_low(item) and item.name.lower() not in on_list and item.id not in on_list_ids:
            out.append({"item_id": item.id, "name": item.name, "quantity": item.quantity,
                        "unit": item.unit, "open_label": open_label(item)})
    return out


def missing_for_recipe(db: Session, recipe: Recipe) -> list[str]:
    from routers.recipes import _food, pantry_match
    return [l["text"] for l in pantry_match(recipe.ingredients or [], _food(db)) if l["status"] == "missing"]


def add_recipe_missing(db: Session, recipe: Recipe, added_by: str, source: str = "recipe") -> dict:
    added, skipped = [], 0
    for line in missing_for_recipe(db, recipe):
        row, created = add_line(db, line, note=recipe.title, source=source, added_by=added_by, recipe_id=recipe.id)
        if created:
            added.append(row.name)
        else:
            skipped += 1
    db.commit()
    return {"added": added, "already_on_list": skipped}


# ---------------------------------------------------------------------------
@router.get("/")
def list_shopping(db: Session = Depends(get_db)):
    rows = db.query(ShoppingItem).order_by(ShoppingItem.checked_at.isnot(None), ShoppingItem.created_at).all()
    return [row_to_dict(s) for s in rows]


@router.get("/suggestions")
def get_suggestions(db: Session = Depends(get_db)):
    return suggestions(db)


@router.post("/", status_code=201)
def add_shopping(data: ShoppingIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row, created = add_line(db, data.name, amount=data.amount, note=data.note,
                            added_by=user.username, item_id=data.item_id,
                            source="low_stock" if data.item_id else "manual")
    db.commit()
    db.refresh(row)
    return {**row_to_dict(row), "already_on_list": not created}


@router.patch("/{row_id}")
def update_shopping(row_id: int, data: ShoppingUpdate, db: Session = Depends(get_db)):
    row = db.query(ShoppingItem).filter(ShoppingItem.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="That line isn't on the list")
    for field, value in data.model_dump(exclude_unset=True).items():
        value = value.strip() if isinstance(value, str) else value
        if field == "name" and not value:
            raise HTTPException(status_code=400, detail="Say what to buy")
        setattr(row, field, value or None)
    db.commit()
    db.refresh(row)
    return row_to_dict(row)


@router.post("/{row_id}/check")
def check_shopping(row_id: int, data: CheckIn, db: Session = Depends(get_db)):
    row = db.query(ShoppingItem).filter(ShoppingItem.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="That line isn't on the list")
    row.checked_at = datetime.utcnow() if data.checked else None
    db.commit()
    return row_to_dict(row)


@router.delete("/{row_id}")
def delete_shopping(row_id: int, db: Session = Depends(get_db)):
    row = db.query(ShoppingItem).filter(ShoppingItem.id == row_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="That line isn't on the list")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/from-recipe/{recipe_id}")
def from_recipe(recipe_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Add the ingredients you don't have yet. Lines already on the list are skipped."""
    recipe = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.deleted_at.is_(None)).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return add_recipe_missing(db, recipe, user.username)


@router.post("/done")
def done_shopping(data: DoneIn, source: str = "dashboard", db: Session = Depends(get_db)):
    """Clear the checked lines. Those in inventory_ids are put into the inventory: an
    item that's already there gets one more; anything new is created unfiled, so it
    shows up under 'No location' ready to be put away."""
    from models import AuditLog
    checked = db.query(ShoppingItem).filter(ShoppingItem.checked_at.isnot(None)).all()
    restocked, created = [], []
    for row in checked:
        if row.id in data.inventory_ids:
            item = db.query(Item).filter(Item.id == row.item_id).first() if row.item_id else None
            if item is None:
                item = db.query(Item).filter(func.lower(Item.name) == row.name.lower()).first()
            if item is not None:
                item.quantity = (item.quantity or 0) + 1
                item.updated_at = datetime.utcnow()
                db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details="bought: qty +1"))
                restocked.append(item.name)
            else:
                new = Item(name=row.name, quantity=1)
                db.add(new)
                db.add(AuditLog(action="created", item_name=row.name, changed_by=source, details="bought (no location yet)"))
                created.append(row.name)
        db.delete(row)
    db.commit()
    return {"ok": True, "cleared": len(checked), "restocked": restocked, "created": created}
