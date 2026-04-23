from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from pydantic import BaseModel
from database import get_db
from models import Location, Item

router = APIRouter(prefix="/locations", tags=["locations"])


class LocationCreate(BaseModel):
    name: str
    sublocation: Optional[str] = None
    description: Optional[str] = None


@router.get("/")
def list_locations(db: Session = Depends(get_db)):
    locations = db.query(Location).order_by(Location.name).all()
    return [
        {
            "id": loc.id,
            "name": loc.name,
            "sublocation": loc.sublocation,
            "description": loc.description,
            "item_count": len(loc.items),
        }
        for loc in locations
    ]


@router.post("/", status_code=201)
def create_location(data: LocationCreate, db: Session = Depends(get_db)):
    loc = Location(**data.model_dump())
    db.add(loc)
    db.commit()
    db.refresh(loc)
    return {"id": loc.id, "name": loc.name, "sublocation": loc.sublocation}


@router.delete("/{location_id}")
def delete_location(location_id: int, db: Session = Depends(get_db)):
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    db.delete(loc)
    db.commit()
    return {"ok": True}
