from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional
from datetime import datetime, date, timedelta
from pydantic import BaseModel
from database import get_db
from models import Item, Location, Category, AuditLog

router = APIRouter(prefix="/items", tags=["items"])

AUTO_TRACK_CATEGORIES = ("grocer", "food", "produce", "cleaning", "laundry")
AUTO_TRACK_LOCATIONS = ("laundry",)


def is_grocery_category(cat: Optional[Category]) -> bool:
    return bool(cat and any(p in cat.name.lower() for p in AUTO_TRACK_CATEGORIES))


def is_tracked(item: Item) -> bool:
    """Consumables always track stock (grocery/cleaning categories, laundry room);
    everything else is opt-in."""
    if is_grocery_category(item.category):
        return True
    if item.location and any(p in item.location.name.lower() for p in AUTO_TRACK_LOCATIONS):
        return True
    return bool(item.track_stock)


# Kitchen/laundry consumables alert when down to the last one; elsewhere only when out
THRESHOLD_ONE_LOCATIONS = ("kitchen", "laundry", "pantry", "fridge", "freezer")


def default_threshold(item: Item) -> float:
    if item.location and any(p in item.location.name.lower() for p in THRESHOLD_ONE_LOCATIONS):
        return 1
    return 0


def is_low(item: Item) -> bool:
    if not is_tracked(item) or item.quantity is None:
        return False
    threshold = item.low_stock_threshold if item.low_stock_threshold is not None else default_threshold(item)
    return item.quantity <= threshold


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


EXPIRING_SOON_DAYS = 3


def is_expired(item: Item) -> bool:
    return item.expiration_date is not None and item.expiration_date < date.today()


def expires_soon(item: Item) -> bool:
    if item.expiration_date is None or is_expired(item):
        return False
    return item.expiration_date <= date.today() + timedelta(days=EXPIRING_SOON_DAYS)


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
        "location": {"id": item.location.id, "name": item.location.name, "sublocation": item.location.sublocation} if item.location else None,
        "category": {"id": item.category.id, "name": item.category.name, "icon": item.category.icon, "color": item.category.color} if item.category else None,
        "notes": item.notes,
        "expiration_date": item.expiration_date.isoformat() if item.expiration_date else None,
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
    location_id: Optional[int] = None,
    location_name: Optional[str] = None,   # matches all sub-locations of a room
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
        query = query.filter(Item.location_id == location_id)
    if location_name:
        query = query.join(Location).filter(Location.name.ilike(location_name))
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


@router.patch("/{item_id}")
def update_item(item_id: int, data: ItemUpdate, source: str = "dashboard", db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    changes = []
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is None and field != "expiration_date":  # only the date is clearable via explicit null
            continue
        old = getattr(item, field)
        if old == value:
            continue
        setattr(item, field, value)
        changes.append(f"{field}: {old} → {value}")
    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    db.add(AuditLog(action="updated", item_name=item.name, changed_by=source, details="; ".join(changes)))
    db.commit()
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
