from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import date
from database import get_db
from models import MealPlan

router = APIRouter(prefix="/meals", tags=["meals"])

MEAL_TYPES = ("breakfast", "lunch", "dinner", "snack")


class MealCreate(BaseModel):
    date: date
    meal_type: str = "dinner"
    title: str
    notes: Optional[str] = None


class MealUpdate(BaseModel):
    date: Optional[date] = None
    meal_type: Optional[str] = None
    title: Optional[str] = None
    notes: Optional[str] = None


def meal_to_dict(m: MealPlan) -> dict:
    return {
        "id": m.id,
        "date": m.date.isoformat(),
        "meal_type": m.meal_type,
        "title": m.title,
        "notes": m.notes,
    }


@router.get("/")
def list_meals(
    start: Optional[date] = None,
    end: Optional[date] = None,
    db: Session = Depends(get_db),
):
    query = db.query(MealPlan)
    if start:
        query = query.filter(MealPlan.date >= start)
    if end:
        query = query.filter(MealPlan.date <= end)
    meals = query.order_by(MealPlan.date).all()
    return [meal_to_dict(m) for m in meals]


@router.post("/", status_code=201)
def create_meal(data: MealCreate, db: Session = Depends(get_db)):
    if data.meal_type not in MEAL_TYPES:
        raise HTTPException(status_code=400, detail=f"meal_type must be one of {MEAL_TYPES}")
    meal = MealPlan(**data.model_dump())
    db.add(meal)
    db.commit()
    db.refresh(meal)
    return meal_to_dict(meal)


@router.patch("/{meal_id}")
def update_meal(meal_id: int, data: MealUpdate, db: Session = Depends(get_db)):
    meal = db.query(MealPlan).filter(MealPlan.id == meal_id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    updates = data.model_dump(exclude_unset=True)
    if "meal_type" in updates and updates["meal_type"] not in MEAL_TYPES:
        raise HTTPException(status_code=400, detail=f"meal_type must be one of {MEAL_TYPES}")
    for field, value in updates.items():
        setattr(meal, field, value)
    db.commit()
    db.refresh(meal)
    return meal_to_dict(meal)


@router.delete("/{meal_id}")
def delete_meal(meal_id: int, db: Session = Depends(get_db)):
    meal = db.query(MealPlan).filter(MealPlan.id == meal_id).first()
    if not meal:
        raise HTTPException(status_code=404, detail="Meal not found")
    db.delete(meal)
    db.commit()
    return {"ok": True}
