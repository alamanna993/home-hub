from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models import FamilyMember, Chore

router = APIRouter(prefix="/family", tags=["family"])


class MemberCreate(BaseModel):
    name: str
    icon: Optional[str] = None
    color: Optional[str] = None


class MemberUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None


def member_to_dict(m: FamilyMember) -> dict:
    return {"id": m.id, "name": m.name, "icon": m.icon, "color": m.color}


@router.get("/")
def list_members(db: Session = Depends(get_db)):
    return [member_to_dict(m) for m in db.query(FamilyMember).order_by(FamilyMember.name).all()]


@router.post("/", status_code=201)
def create_member(data: MemberCreate, db: Session = Depends(get_db)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if db.query(FamilyMember).filter(FamilyMember.name.ilike(name)).first():
        raise HTTPException(status_code=400, detail="That family member already exists")
    member = FamilyMember(name=name, icon=data.icon, color=data.color)
    db.add(member)
    db.commit()
    db.refresh(member)
    return member_to_dict(member)


@router.patch("/{member_id}")
def update_member(member_id: int, data: MemberUpdate, db: Session = Depends(get_db)):
    member = db.query(FamilyMember).filter(FamilyMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Family member not found")
    updates = data.model_dump(exclude_unset=True)
    if "name" in updates and not (updates["name"] or "").strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    old_name = member.name
    for field, value in updates.items():
        setattr(member, field, value.strip() if isinstance(value, str) else value)
    # Renaming a person carries their chores with them
    if "name" in updates and member.name != old_name:
        db.query(Chore).filter(Chore.assigned_to == old_name).update({"assigned_to": member.name})
    db.commit()
    db.refresh(member)
    return member_to_dict(member)


@router.delete("/{member_id}")
def delete_member(member_id: int, db: Session = Depends(get_db)):
    member = db.query(FamilyMember).filter(FamilyMember.id == member_id).first()
    if not member:
        raise HTTPException(status_code=404, detail="Family member not found")
    db.delete(member)
    db.commit()
    return {"ok": True}
