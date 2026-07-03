from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from database import get_db
from models import CalendarEvent

router = APIRouter(prefix="/calendar", tags=["calendar"])


class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start: datetime
    end: Optional[datetime] = None
    all_day: bool = False
    color: Optional[str] = None


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    all_day: Optional[bool] = None
    color: Optional[str] = None


def event_to_dict(e: CalendarEvent) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "description": e.description,
        "start": e.start.isoformat(),
        "end": e.end.isoformat() if e.end else None,
        "all_day": e.all_day,
        "color": e.color,
        "created_by": e.created_by,
    }


@router.get("/")
def list_events(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    query = db.query(CalendarEvent)
    if start:
        query = query.filter(CalendarEvent.start >= start)
    if end:
        query = query.filter(CalendarEvent.start < end)
    events = query.order_by(CalendarEvent.start).all()
    return [event_to_dict(e) for e in events]


@router.post("/", status_code=201)
def create_event(data: EventCreate, source: str = "dashboard", db: Session = Depends(get_db)):
    event = CalendarEvent(**data.model_dump(), created_by=source)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event_to_dict(event)


@router.patch("/{event_id}")
def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db)):
    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return event_to_dict(event)


@router.delete("/{event_id}")
def delete_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()
    return {"ok": True}
