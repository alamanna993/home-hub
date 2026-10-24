from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from database import get_db
from models import Location, Item
from location_tree import children_map, descendant_ids, location_dict, tidy, tree_order

router = APIRouter(prefix="/locations", tags=["locations"])


class LocationCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None   # none = a room
    icon: Optional[str] = None
    description: Optional[str] = None


class LocationUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None   # send null with move=True to make it a room
    move: bool = False                # parent_id is only applied when move is set
    icon: Optional[str] = None
    description: Optional[str] = None


def _check_sibling_name(db: Session, parent_id: Optional[int], name: str, exclude_id: Optional[int] = None):
    q = db.query(Location).filter(func.lower(Location.name) == name.lower())
    q = q.filter(Location.parent_id.is_(None) if parent_id is None else Location.parent_id == parent_id)
    if exclude_id:
        q = q.filter(Location.id != exclude_id)
    if q.first():
        where = "at the top level" if parent_id is None else "in that spot"
        raise HTTPException(status_code=400, detail=f"There's already a {name} {where}.")


def _one(db: Session, loc: Location) -> dict:
    direct = dict(db.query(Item.location_id, func.count(Item.id)).group_by(Item.location_id).all())
    depth = next((d for l, d in tree_order(db) if l.id == loc.id), 0)
    return location_dict(loc, depth, direct, children_map(db))


@router.get("/")
def list_locations(db: Session = Depends(get_db)):
    """Every location in tree order (rooms A to Z, each followed by what's inside it)."""
    direct = dict(db.query(Item.location_id, func.count(Item.id)).group_by(Item.location_id).all())
    kids = children_map(db)
    return [location_dict(loc, depth, direct, kids) for loc, depth in tree_order(db)]


@router.post("/", status_code=201)
def create_location(data: LocationCreate, db: Session = Depends(get_db)):
    name = tidy(data.name or "")
    if not name:
        raise HTTPException(status_code=400, detail="Give the location a name")
    if data.parent_id is not None and not db.query(Location).filter(Location.id == data.parent_id).first():
        raise HTTPException(status_code=404, detail="That parent location doesn't exist")
    _check_sibling_name(db, data.parent_id, name)
    loc = Location(name=name, parent_id=data.parent_id, icon=data.icon, description=data.description)
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return _one(db, loc)


@router.patch("/{location_id}")
def update_location(location_id: int, data: LocationUpdate, db: Session = Depends(get_db)):
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    parent_id = loc.parent_id
    if data.move:
        if data.parent_id is not None:
            if data.parent_id in descendant_ids(db, loc.id):
                raise HTTPException(status_code=400, detail="A location can't go inside itself or one of its own spots.")
            if not db.query(Location).filter(Location.id == data.parent_id).first():
                raise HTTPException(status_code=404, detail="That parent location doesn't exist")
        parent_id = data.parent_id
    name = tidy(data.name) if data.name is not None else loc.name
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    if name.lower() != loc.name.lower() or parent_id != loc.parent_id:
        _check_sibling_name(db, parent_id, name, exclude_id=loc.id)
    loc.name, loc.parent_id = name, parent_id
    for field in ("icon", "description"):
        value = getattr(data, field)
        if value is not None:
            setattr(loc, field, value.strip() or None)
    db.commit()
    db.refresh(loc)
    return _one(db, loc)


@router.delete("/{location_id}")
def delete_location(location_id: int, db: Session = Depends(get_db)):
    """Remove one level: what was inside moves up to the parent (or becomes its own
    room / goes unfiled when a room is deleted)."""
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    moved_items = db.query(Item).filter(Item.location_id == loc.id).update({Item.location_id: loc.parent_id})
    moved_spots = db.query(Location).filter(Location.parent_id == loc.id).update({Location.parent_id: loc.parent_id})
    db.delete(loc)
    db.commit()
    return {"ok": True, "moved_items": moved_items, "moved_spots": moved_spots}
