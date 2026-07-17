from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date, timedelta
from database import get_db
from models import Chore, ChoreCompletion

router = APIRouter(prefix="/chores", tags=["chores"])

FREQUENCIES = ("once", "daily", "weekly", "monthly")

# Keyword → emoji for chores created from chat, where nobody picks an icon by hand.
CHORE_ICONS = (
    (("trash", "garbage",), "🗑️"),
    (("recycl",), "♻️"),
    (("dish", "dishwasher",), "🍽️"),
    (("laundry", "clothes", "fold",), "🧺"),
    (("dog", "puppy", "walk",), "🐕"),
    (("cat", "litter",), "🐈"),
    (("fish", "aquarium",), "🐠"),
    (("chicken", "coop",), "🐔"),
    (("plant", "flower", "garden", "weed",), "🪴"),
    (("lawn", "mow", "grass", "yard", "leaves", "rake",), "🌱"),
    (("bed", "sheets",), "🛏️"),
    (("toilet", "bathroom",), "🚽"),
    (("shower", "tub", "bath",), "🛁"),
    (("car", "truck",), "🚗"),
    (("homework", "study", "read",), "📚"),
    (("piano", "guitar", "practice", "music",), "🎵"),
    (("cook", "dinner", "breakfast", "lunch", "meal",), "🍳"),
    (("grocer", "shopping",), "🛒"),
    (("window",), "🪟"),
    (("dust",), "🪶"),
    (("mop", "scrub", "sink", "counter", "wipe",), "🧽"),
    (("snow", "shovel",), "❄️"),
    (("fix", "repair",), "🔧"),
    (("mail", "package",), "📬"),
    (("toy", "playroom", "tidy",), "🧸"),
    (("water",), "💧"),
)


def pick_chore_icon(title: str) -> str:
    text = (title or "").lower()
    for keywords, icon in CHORE_ICONS:
        if any(k in text for k in keywords):
            return icon
    return "🧹"


class ChoreCreate(BaseModel):
    title: str
    description: Optional[str] = None
    icon: Optional[str] = None
    assigned_to: Optional[str] = None
    frequency: str = "weekly"
    day_of_week: Optional[int] = None


class ChoreUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    assigned_to: Optional[str] = None
    frequency: Optional[str] = None
    day_of_week: Optional[int] = None


class CompleteRequest(BaseModel):
    completed_by: Optional[str] = None


def _period_start(chore: Chore, today: date) -> datetime:
    """Start of the current period a completion counts toward."""
    if chore.frequency == "daily":
        return datetime(today.year, today.month, today.day)
    if chore.frequency == "weekly":
        monday = today - timedelta(days=today.weekday())
        return datetime(monday.year, monday.month, monday.day)
    if chore.frequency == "monthly":
        return datetime(today.year, today.month, 1)
    return datetime.min  # "once": any completion ever counts


def chore_to_dict(chore: Chore, db: Session) -> dict:
    today = date.today()
    since = _period_start(chore, today)
    done = (
        db.query(ChoreCompletion)
        .filter(ChoreCompletion.chore_id == chore.id, ChoreCompletion.completed_at >= since)
        .order_by(ChoreCompletion.completed_at.desc())
        .first()
    )
    last = (
        db.query(ChoreCompletion)
        .filter(ChoreCompletion.chore_id == chore.id)
        .order_by(ChoreCompletion.completed_at.desc())
        .first()
    )
    return {
        "id": chore.id,
        "title": chore.title,
        "description": chore.description,
        "icon": chore.icon,
        "assigned_to": chore.assigned_to,
        "frequency": chore.frequency,
        "day_of_week": chore.day_of_week,
        "done_this_period": done is not None,
        "last_completed_at": last.completed_at.isoformat() if last else None,
        "last_completed_by": last.completed_by if last else None,
    }


@router.get("/")
def list_chores(assigned_to: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Chore)
    if assigned_to:
        query = query.filter(Chore.assigned_to.ilike(f"%{assigned_to}%"))
    chores = query.order_by(Chore.assigned_to, Chore.title).all()
    # A finished one-time chore is done forever — it belongs in /past, not on the chart
    return [d for d in (chore_to_dict(c, db) for c in chores)
            if not (d["frequency"] == "once" and d["done_this_period"])]


@router.get("/past")
def past_chores(limit: int = 100, db: Session = Depends(get_db)):
    """Completion history, newest first — every check-off with who and when."""
    rows = (db.query(ChoreCompletion, Chore)
            .join(Chore, ChoreCompletion.chore_id == Chore.id)
            .order_by(ChoreCompletion.completed_at.desc())
            .limit(limit).all())
    return [{
        "id": comp.id,
        "chore_id": chore.id,
        "title": chore.title,
        "icon": chore.icon,
        "frequency": chore.frequency,
        "completed_at": comp.completed_at.isoformat(),
        "completed_by": comp.completed_by,
    } for comp, chore in rows]


@router.delete("/past")
def clear_past_chores(db: Session = Depends(get_db)):
    """Clear the history: drop completions from earlier periods, and remove
    finished one-time chores entirely (their record is what keeps them 'done')."""
    today = date.today()
    removed = 0
    for chore in db.query(Chore).all():
        since = _period_start(chore, today)
        if chore.frequency == "once":
            if db.query(ChoreCompletion).filter(ChoreCompletion.chore_id == chore.id).count():
                db.delete(chore)  # cascade removes its completions
                removed += 1
            continue
        removed += (db.query(ChoreCompletion)
                    .filter(ChoreCompletion.chore_id == chore.id, ChoreCompletion.completed_at < since)
                    .delete())
    db.commit()
    return {"ok": True, "removed": removed}


@router.post("/", status_code=201)
def create_chore(data: ChoreCreate, db: Session = Depends(get_db)):
    if data.frequency not in FREQUENCIES:
        raise HTTPException(status_code=400, detail=f"frequency must be one of {FREQUENCIES}")
    chore = Chore(**data.model_dump())
    if not chore.icon:
        chore.icon = pick_chore_icon(chore.title)
    db.add(chore)
    db.commit()
    db.refresh(chore)
    return chore_to_dict(chore, db)


@router.patch("/{chore_id}")
def update_chore(chore_id: int, data: ChoreUpdate, db: Session = Depends(get_db)):
    chore = db.query(Chore).filter(Chore.id == chore_id).first()
    if not chore:
        raise HTTPException(status_code=404, detail="Chore not found")
    updates = data.model_dump(exclude_unset=True)
    if "frequency" in updates and updates["frequency"] not in FREQUENCIES:
        raise HTTPException(status_code=400, detail=f"frequency must be one of {FREQUENCIES}")
    for field, value in updates.items():
        setattr(chore, field, value)
    db.commit()
    db.refresh(chore)
    return chore_to_dict(chore, db)


@router.post("/{chore_id}/complete")
def complete_chore(chore_id: int, data: CompleteRequest, db: Session = Depends(get_db)):
    chore = db.query(Chore).filter(Chore.id == chore_id).first()
    if not chore:
        raise HTTPException(status_code=404, detail="Chore not found")
    db.add(ChoreCompletion(chore_id=chore.id, completed_by=data.completed_by or chore.assigned_to))
    db.commit()
    return chore_to_dict(chore, db)


@router.post("/{chore_id}/uncomplete")
def uncomplete_chore(chore_id: int, db: Session = Depends(get_db)):
    chore = db.query(Chore).filter(Chore.id == chore_id).first()
    if not chore:
        raise HTTPException(status_code=404, detail="Chore not found")
    since = _period_start(chore, date.today())
    completion = (
        db.query(ChoreCompletion)
        .filter(ChoreCompletion.chore_id == chore.id, ChoreCompletion.completed_at >= since)
        .order_by(ChoreCompletion.completed_at.desc())
        .first()
    )
    if completion:
        db.delete(completion)
        db.commit()
    return chore_to_dict(chore, db)


@router.delete("/{chore_id}")
def delete_chore(chore_id: int, db: Session = Depends(get_db)):
    chore = db.query(Chore).filter(Chore.id == chore_id).first()
    if not chore:
        raise HTTPException(status_code=404, detail="Chore not found")
    db.delete(chore)
    db.commit()
    return {"ok": True}
