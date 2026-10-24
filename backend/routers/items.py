from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional
from datetime import datetime, date, timedelta
from pydantic import BaseModel
from database import get_db
from models import Item, Location, Category, AuditLog

router = APIRouter(prefix="/items", tags=["items"])


def _place_text(item: Item) -> str:
    """Every level of the item's location, lowercased: 'kitchen › fridge › door'."""
    from location_tree import path_str
    return path_str(item.location).lower() if item.location else ""

AUTO_TRACK_CATEGORIES = ("grocer", "food", "produce", "cleaning", "laundry")
AUTO_TRACK_LOCATIONS = ("laundry",)


def is_grocery_category(cat: Optional[Category]) -> bool:
    return bool(cat and any(p in cat.name.lower() for p in AUTO_TRACK_CATEGORIES))


def is_tracked(item: Item) -> bool:
    """Consumables always track stock (grocery/cleaning categories, laundry room);
    everything else is opt-in."""
    if is_grocery_category(item.category):
        return True
    if item.location and any(p in _place_text(item) for p in AUTO_TRACK_LOCATIONS):
        return True
    return bool(item.track_stock)


# Kitchen/laundry consumables alert when down to the last one; elsewhere only when out
THRESHOLD_ONE_LOCATIONS = ("kitchen", "laundry", "pantry", "fridge", "freezer")


def default_threshold(item: Item) -> float:
    if item.location and any(p in _place_text(item) for p in THRESHOLD_ONE_LOCATIONS):
        return 1
    return 0


def open_fraction(item: Item) -> Optional[float]:
    """How full the opened package is (0–1), or None if nothing is open / it can't be told
    (a count like '1 bagel left' with no known package size)."""
    if item.open_amount is None:
        return None
    if not item.pack_unit:
        return max(0.0, min(1.0, item.open_amount))
    if item.pack_size:
        return max(0.0, min(1.0, item.open_amount / item.pack_size))
    return None


def effective_quantity(item: Item) -> Optional[float]:
    """Packages on hand, counting the opened one as only partly there:
    2 tubs with one a quarter full = 1.25. An open package of unknown size counts as half."""
    if item.quantity is None or item.open_amount is None or item.quantity <= 0:
        return item.quantity
    frac = open_fraction(item)
    return item.quantity - 1 + (frac if frac is not None else 0.5)


FRACTION_GLYPHS = ((1 / 8, "⅛"), (1 / 4, "¼"), (1 / 3, "⅓"), (1 / 2, "½"), (2 / 3, "⅔"), (3 / 4, "¾"))


def _plural(unit: str, n: float) -> str:
    if n == 1 or unit.endswith("s"):
        return unit
    return unit[:-1] + "ies" if unit.endswith("y") and unit[-2:-1] not in "aeiou" else unit + "s"


def open_label(item: Item) -> Optional[str]:
    """'1 of 6 bagels left', '1 bagel left', '¼ left' — what's in the opened package."""
    if item.open_amount is None:
        return None
    if item.pack_unit:
        n = item.open_amount
        if item.pack_size:
            return f"{n:g} of {item.pack_size:g} {_plural(item.pack_unit, item.pack_size)} left"
        return f"{n:g} {_plural(item.pack_unit, n)} left"
    frac = open_fraction(item) or 0
    glyph = next((g for v, g in FRACTION_GLYPHS if abs(frac - v) < 0.02), None)
    if frac <= 0.05:
        return "almost empty"
    return f"{glyph or f'{round(frac * 100)}%'} left"


def stock_phrase(item: Item) -> str:
    """'1 package, 1 of 6 bagels left in the open one' / 'that was the last one'."""
    if not item.quantity or item.quantity <= 0:
        return "that was the last one, none left"
    qty = f"{item.quantity:g} {_plural(item.unit, item.quantity) if item.unit else 'left'}".strip()
    left = open_label(item)
    return qty + (f", {left} in the open one" if left else "")


def use_one(item: Item) -> str:
    """Take one unit out of the open package ('ate a bagel'), opening a fresh package when
    needed. Returns a short description of the change; raises ValueError when it can't."""
    if not item.pack_unit:
        raise ValueError("This item isn't counted by the piece. Set what's left instead.")
    if item.open_amount is None:
        if not item.quantity or item.quantity <= 0:
            raise ValueError(f"There's no {item.name} left to use.")
        if not item.pack_size:
            raise ValueError(f"Say how many {_plural(item.pack_unit, 2)} come in a package first.")
        item.open_amount = item.pack_size   # open a fresh package
    item.open_amount -= 1
    if item.open_amount <= 0:
        return finish_open(item)
    return f"used 1 {item.pack_unit}; {open_label(item)}"


def finish_open(item: Item) -> str:
    """The opened package is used up: one fewer package, nothing open."""
    item.quantity = max(0.0, (item.quantity or 0) - 1)
    item.open_amount = None
    return f"finished the open one; {item.quantity:g} {item.unit or 'left'}".strip()


def _singular(unit: str) -> str:
    u = unit.strip().lower()
    if len(u) > 4 and u.endswith("ies"):
        return u[:-3] + "y"
    if len(u) > 3 and u.endswith("s") and not u.endswith("ss"):
        return u[:-1]
    return u


def set_open_package(item: Item, open_amount=None, pack_unit=None, pack_size=None) -> list[str]:
    """Record what's in the opened package from loosely-typed input (chat or tools).
    A unit means a count ('1 bagel'); no unit means a portion of the package (0.25)."""
    changes = []
    if pack_size:
        item.pack_size = float(pack_size)
        changes.append(f"{item.pack_size:g} per package")
    if pack_unit and str(pack_unit).strip():
        item.pack_unit = _singular(str(pack_unit))
    if open_amount is None:
        return changes
    amount = float(open_amount)
    counted = bool(item.pack_unit) and (bool(pack_unit) or amount >= 1)
    if item.pack_unit and not counted:
        # A portion of a package that's normally counted ("half the bagels left")
        if item.pack_size:
            amount, counted = round(amount * item.pack_size), True
        else:
            item.pack_unit = None
    if not counted and amount > 1:
        amount = min(amount, 100) / 100   # "25" from a model meant 25%
    if amount <= 0:
        changes.append(finish_open(item))
        return changes
    if not item.quantity or item.quantity <= 0:
        item.quantity = 1
    item.open_amount = amount
    changes.append(open_label(item))
    return changes


def is_low(item: Item) -> bool:
    qty = effective_quantity(item)
    if not is_tracked(item) or qty is None:
        return False
    threshold = item.low_stock_threshold if item.low_stock_threshold is not None else default_threshold(item)
    return qty <= threshold


class ItemCreate(BaseModel):
    name: str
    description: Optional[str] = None
    quantity: Optional[float] = 1
    unit: Optional[str] = None
    author: Optional[str] = None
    track_stock: Optional[bool] = None
    low_stock_threshold: Optional[float] = None
    location_id: Optional[int] = None
    category_id: Optional[int] = None
    notes: Optional[str] = None
    expiration_date: Optional[date] = None
    pack_size: Optional[float] = None
    pack_unit: Optional[str] = None
    open_amount: Optional[float] = None


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    author: Optional[str] = None
    track_stock: Optional[bool] = None
    low_stock_threshold: Optional[float] = None
    location_id: Optional[int] = None
    category_id: Optional[int] = None
    notes: Optional[str] = None
    expiration_date: Optional[date] = None
    pack_size: Optional[float] = None
    pack_unit: Optional[str] = None
    open_amount: Optional[float] = None


EXPIRING_SOON_DAYS = 3


def is_expired(item: Item) -> bool:
    return item.expiration_date is not None and item.expiration_date < date.today()


def expires_soon(item: Item) -> bool:
    if item.expiration_date is None or is_expired(item):
        return False
    return item.expiration_date <= date.today() + timedelta(days=EXPIRING_SOON_DAYS)


def location_ref(loc) -> dict | None:
    """An item's place. 'name' is the full path so older clients (the bots) still read well."""
    if not loc:
        return None
    from location_tree import path_of, SEP
    chain = path_of(loc)
    return {"id": loc.id, "name": SEP.join(l.name for l in chain), "leaf": loc.name,
            "room": chain[0].name, "room_id": chain[0].id, "path": [l.name for l in chain], "sublocation": None}


def item_to_dict(item: Item) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "quantity": item.quantity,
        "unit": item.unit,
        "author": item.author,
        "track_stock": is_tracked(item),
        "low_stock_threshold": item.low_stock_threshold,
        "location": location_ref(item.location),
        "category": {"id": item.category.id, "name": item.category.name, "icon": item.category.icon, "color": item.category.color} if item.category else None,
        "notes": item.notes,
        "expiration_date": item.expiration_date.isoformat() if item.expiration_date else None,
        "pack_size": item.pack_size,
        "pack_unit": item.pack_unit,
        "open_amount": item.open_amount,
        "open_fraction": open_fraction(item),
        "open_label": open_label(item),
        "effective_quantity": effective_quantity(item),
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "is_low_stock": is_low(item),
        "is_expired": is_expired(item),
        "expires_soon": expires_soon(item),
    }


@router.get("/")
def list_items(
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    location_id: Optional[int] = None,     # this location and everything inside it
    location_name: Optional[str] = None,   # a room by name, and everything inside it
    unlocated: bool = False,               # only items with no location assigned
    low_stock_only: bool = False,
    expiring_only: bool = False,           # expired or expiring within EXPIRING_SOON_DAYS
    db: Session = Depends(get_db),
):
    query = db.query(Item)
    if search:
        query = query.filter(Item.name.ilike(f"%{search}%"))
    if category_id:
        query = query.filter(Item.category_id == category_id)
    if location_id:
        from location_tree import descendant_ids
        query = query.filter(Item.location_id.in_(descendant_ids(db, location_id)))
    if location_name:
        from location_tree import descendant_ids
        room = db.query(Location).filter(Location.parent_id.is_(None), Location.name.ilike(location_name)).first()
        query = query.filter(Item.location_id.in_(descendant_ids(db, room.id) if room else set()))
    if unlocated:
        query = query.filter(Item.location_id.is_(None))
    items = query.order_by(Item.name).all()
    if low_stock_only:
        items = [i for i in items if is_low(i)]
    if expiring_only:
        items = [i for i in items if is_expired(i) or expires_soon(i)]
        items.sort(key=lambda i: i.expiration_date)
    return [item_to_dict(i) for i in items]


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    all_items = db.query(Item).all()
    total = len(all_items)
    low_stock = sum(1 for i in all_items if is_low(i))
    by_category = (
        db.query(Category.name, Category.color, Category.icon, func.count(Item.id))
        .join(Item, isouter=True)
        .group_by(Category.id)
        .all()
    )
    recent_logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(10).all()
    return {
        "total_items": total,
        "low_stock_count": low_stock,
        "by_category": [{"name": r[0], "color": r[1], "icon": r[2], "count": r[3]} for r in by_category],
        "recent_activity": [
            {"action": l.action, "item": l.item_name, "by": l.changed_by, "details": l.details, "at": l.created_at.isoformat()}
            for l in recent_logs
        ],
    }


@router.get("/{item_id}")
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item_to_dict(item)


@router.post("/", status_code=201)
def create_item(data: ItemCreate, source: str = "dashboard", db: Session = Depends(get_db)):
    item = Item(**data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    db.add(AuditLog(action="created", item_name=item.name, changed_by=source, details=f"qty: {item.quantity} {item.unit or ''}"))
    db.commit()
    return item_to_dict(item)


CLEARABLE = ("expiration_date", "open_amount", "pack_size", "pack_unit")


@router.patch("/{item_id}")
def update_item(item_id: int, data: ItemUpdate, source: str = "dashboard", db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    changes = []
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is None and field not in CLEARABLE:  # only these are clearable via explicit null
            continue
        old = getattr(item, field)
        if old == value:
            continue
        setattr(item, field, value)
        changes.append(f"{field}: {old} → {value}")
    if item.quantity is not None and item.quantity <= 0:
        item.open_amount = None   # nothing left means nothing open either
    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details="; ".join(changes)))
    db.commit()
    return item_to_dict(item)


class UseRequest(BaseModel):
    what: str = "one"   # one = a single unit from the open package; opened = finished the open package


@router.post("/{item_id}/use")
def use_item(item_id: int, data: UseRequest, source: str = "dashboard", db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    try:
        detail = use_one(item) if data.what == "one" else finish_open(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    item.updated_at = datetime.utcnow()
    db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details=detail))
    db.commit()
    db.refresh(item)
    return item_to_dict(item)


@router.delete("/{item_id}")
def delete_item(item_id: int, source: str = "dashboard", db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.add(AuditLog(action="deleted", item_name=item.name, changed_by=source, details="item removed"))
    db.delete(item)
    db.commit()
    return {"ok": True}
