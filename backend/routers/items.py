from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from database import get_db
from models import Item, Location, Category, AuditLog

router = APIRouter(prefix="/items", tags=["items"])


class ItemCreate(BaseModel):
    name: str
    description: Optional[str] = None
    quantity: Optional[float] = 1
    unit: Optional[str] = None
    author: Optional[str] = None
    low_stock_threshold: Optional[float] = None
    location_id: Optional[int] = None
    category_id: Optional[int] = None
    notes: Optional[str] = None


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    author: Optional[str] = None
    low_stock_threshold: Optional[float] = None
    location_id: Optional[int] = None
    category_id: Optional[int] = None
    notes: Optional[str] = None


def item_to_dict(item: Item) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "quantity": item.quantity,
        "unit": item.unit,
        "author": item.author,
        "low_stock_threshold": item.low_stock_threshold,
        "location": {"id": item.location.id, "name": item.location.name, "sublocation": item.location.sublocation} if item.location else None,
        "category": {"id": item.category.id, "name": item.category.name, "icon": item.category.icon, "color": item.category.color} if item.category else None,
        "notes": item.notes,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "is_low_stock": (item.low_stock_threshold is not None and item.quantity is not None and item.quantity <= item.low_stock_threshold),
    }


@router.get("/")
def list_items(
    search: Optional[str] = None,
    category_id: Optional[int] = None,
    location_id: Optional[int] = None,
    low_stock_only: bool = False,
    db: Session = Depends(get_db),
):
    query = db.query(Item)
    if search:
        query = query.filter(Item.name.ilike(f"%{search}%"))
    if category_id:
        query = query.filter(Item.category_id == category_id)
    if location_id:
        query = query.filter(Item.location_id == location_id)
    if low_stock_only:
        query = query.filter(
            Item.low_stock_threshold.isnot(None),
            Item.quantity <= Item.low_stock_threshold,
        )
    items = query.order_by(Item.name).all()
    return [item_to_dict(i) for i in items]


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    total = db.query(Item).count()
    low_stock = db.query(Item).filter(
        Item.low_stock_threshold.isnot(None),
        Item.quantity <= Item.low_stock_threshold,
    ).count()
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
    for field, value in data.model_dump(exclude_none=True).items():
        old = getattr(item, field)
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
