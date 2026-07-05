from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from database import Base


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)          # e.g. "Kitchen"
    sublocation = Column(String(100), nullable=True)    # e.g. "Pantry Shelf 2"
    icon = Column(String(50), nullable=True)            # emoji shown on the Locations page
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("Item", back_populates="location")


class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)          # e.g. "Groceries", "Electronics"
    icon = Column(String(50), nullable=True)            # emoji or icon name
    color = Column(String(20), nullable=True)           # hex color for dashboard

    items = relationship("Item", back_populates="category")


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    quantity = Column(Float, nullable=True, default=1)
    unit = Column(String(50), nullable=True)            # e.g. "bottles", "boxes", "lbs"
    author = Column(String(200), nullable=True)         # for books / media
    low_stock_threshold = Column(Float, nullable=True)  # alert when below this
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    image_url = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    location = relationship("Location", back_populates="items")
    category = relationship("Category", back_populates="items")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    action = Column(String(50), nullable=False)         # "created", "updated", "deleted"
    item_name = Column(String(200))
    changed_by = Column(String(100), default="dashboard")  # "discord", "dashboard"
    details = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    hashed_password = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(100), primary_key=True)
    value = Column(Text, nullable=True)
    description = Column(String(300), nullable=True)


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    start = Column(DateTime, nullable=False)
    end = Column(DateTime, nullable=True)
    all_day = Column(Boolean, default=False)
    color = Column(String(20), nullable=True)           # hex color for the dashboard
    created_by = Column(String(100), default="dashboard")
    created_at = Column(DateTime, default=datetime.utcnow)


class MealPlan(Base):
    __tablename__ = "meal_plans"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    meal_type = Column(String(20), nullable=False, default="dinner")  # breakfast | lunch | dinner | snack
    title = Column(String(200), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Chore(Base):
    __tablename__ = "chores"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(50), nullable=True)            # emoji shown on chore chart & calendar
    assigned_to = Column(String(100), nullable=True)    # family member name
    frequency = Column(String(20), default="weekly")    # once | daily | weekly | monthly
    day_of_week = Column(Integer, nullable=True)        # 0=Monday .. 6=Sunday, for weekly chores
    created_at = Column(DateTime, default=datetime.utcnow)

    completions = relationship("ChoreCompletion", back_populates="chore", cascade="all, delete-orphan")


class ChoreCompletion(Base):
    __tablename__ = "chore_completions"

    id = Column(Integer, primary_key=True)
    chore_id = Column(Integer, ForeignKey("chores.id"), nullable=False)
    completed_by = Column(String(100), nullable=True)
    completed_at = Column(DateTime, default=datetime.utcnow)

    chore = relationship("Chore", back_populates="completions")
