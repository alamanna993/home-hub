from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey, Text, Boolean, JSON
from sqlalchemy.orm import relationship
from database import Base


class Location(Base):
    __tablename__ = "locations"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)          # this level only: "Office", "Bookshelf", "Third shelf up"
    # Locations nest to any depth: Office › Bookshelf › Right side › Third shelf up.
    # A location with no parent is a room.
    parent_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    sublocation = Column(String(100), nullable=True)    # legacy flat "spot" — folded into the tree on upgrade
    icon = Column(String(50), nullable=True)            # emoji shown on the Locations page
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("Item", back_populates="location")
    parent = relationship("Location", remote_side=[id], backref="children")


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
    track_stock = Column(Boolean, default=False)        # groceries auto-track; others opt in
    low_stock_threshold = Column(Float, nullable=True)  # alert when at/below this (default 0 = alert when out)
    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    image_url = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    expiration_date = Column(Date, nullable=True)       # for food — created_at is the entry date
    # The opened package: "1 package of bagels, 1 bagel left" / "1 tub, a quarter left".
    # With pack_unit set, open_amount counts those units; without it, open_amount is a
    # fraction (0–1) of the package. NULL open_amount = nothing open (all packages full).
    pack_size = Column(Float, nullable=True)            # units in a full package, e.g. 6
    pack_unit = Column(String(50), nullable=True)       # e.g. "bagel"
    open_amount = Column(Float, nullable=True)
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
    role = Column(String(20), default="admin")          # admin | member (member can't touch settings)
    created_at = Column(DateTime, default=datetime.utcnow)


class LoginSession(Base):
    """One signed-in device. Tokens carry its id, so it can be signed out from Settings,
    and its expiry slides forward while the device keeps being used (all times UTC)."""
    __tablename__ = "login_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    secret_hash = Column(String(64), nullable=False)    # sha256 of the cookie secret
    device = Column(String(100))                         # "iPhone · Safari"
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)


class FamilyMember(Base):
    __tablename__ = "family_members"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), unique=True, nullable=False)
    icon = Column(String(50), nullable=True)            # emoji avatar
    color = Column(String(20), nullable=True)
    photo_url = Column(String(500), nullable=True)      # '/media/<name>.jpg'
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
    ms_id = Column(String(300), nullable=True)          # Outlook event id when two-way synced
    created_at = Column(DateTime, default=datetime.utcnow)


class MealPlan(Base):
    __tablename__ = "meal_plans"

    id = Column(Integer, primary_key=True)
    date = Column(Date, nullable=False)
    meal_type = Column(String(20), nullable=False, default="dinner")  # breakfast | lunch | dinner | snack
    title = Column(String(200), nullable=False)
    notes = Column(Text, nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    servings = Column(String(50), nullable=True)         # free text: "4", "6–8", "1 loaf"
    prep_minutes = Column(Integer, nullable=True)
    cook_minutes = Column(Integer, nullable=True)
    ingredients = Column(JSON, nullable=False, default=list)  # one line each: "2 cups flour"
    steps = Column(JSON, nullable=False, default=list)        # one instruction each, in order
    tags = Column(JSON, nullable=False, default=list)
    cuisine = Column(String(100), nullable=True)
    source_url = Column(String(1000), nullable=True)
    image_url = Column(String(1000), nullable=True)
    notes = Column(Text, nullable=True)
    favorite = Column(Boolean, default=False)
    created_by = Column(String(100), default="dashboard")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)         # soft delete — restorable for 30 days


class Chore(Base):
    __tablename__ = "chores"

    id = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String(50), nullable=True)            # emoji shown on chore chart & calendar
    assigned_to = Column(String(100), nullable=True)    # family member name
    frequency = Column(String(20), default="weekly")    # once | daily | weekly | biweekly | monthly
    day_of_week = Column(Integer, nullable=True)        # 0=Monday .. 6=Sunday, for weekly chores
    override_assigned_to = Column(String(100), nullable=True)  # temp assignee ("just this week")
    override_until = Column(Date, nullable=True)        # exclusive end — start of the next period
    created_at = Column(DateTime, default=datetime.utcnow)

    completions = relationship("ChoreCompletion", back_populates="chore", cascade="all, delete-orphan")


class ChoreCompletion(Base):
    __tablename__ = "chore_completions"

    id = Column(Integer, primary_key=True)
    chore_id = Column(Integer, ForeignKey("chores.id"), nullable=False)
    completed_by = Column(String(100), nullable=True)
    completed_at = Column(DateTime, default=datetime.utcnow)

    chore = relationship("Chore", back_populates="completions")


class ShoppingItem(Base):
    """One line on the shared shopping list. Checked lines stay until 'Done shopping'."""
    __tablename__ = "shopping_items"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    amount = Column(String(100), nullable=True)         # free text: "2", "1 gallon"
    note = Column(Text, nullable=True)
    source = Column(String(20), default="manual")       # manual | low_stock | recipe | emerald
    item_id = Column(Integer, ForeignKey("items.id", ondelete="SET NULL"), nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True)
    checked_at = Column(DateTime, nullable=True)        # in the cart
    added_by = Column(String(100), default="dashboard")
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    """Emerald's conversation memory: one thread per source ('dashboard:alex', 'telegram:Mom')."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True)
    source = Column(String(100), nullable=False, index=True)
    role = Column(String(10), nullable=False)            # user | emerald
    text = Column(Text, nullable=False)
    meta = Column(JSON, nullable=True)                   # brain, pending question, recipe/change cards
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class ChangeSet(Base):
    """Everything one Emerald request changed, so it can be undone as a unit."""
    __tablename__ = "changesets"

    id = Column(Integer, primary_key=True)
    source = Column(String(100))
    label = Column(String(200))                          # the request, shortened
    created_at = Column(DateTime, default=datetime.utcnow)
    undone_at = Column(DateTime, nullable=True)


class ChangeRow(Base):
    __tablename__ = "change_rows"

    id = Column(Integer, primary_key=True)               # order of changes within the set
    changeset_id = Column(Integer, ForeignKey("changesets.id", ondelete="CASCADE"), nullable=False, index=True)
    op = Column(String(10), nullable=False)              # create | update | delete
    table_name = Column(String(50), nullable=False)
    pk = Column(Integer, nullable=False)
    before = Column(JSON, nullable=True)                 # update: old values of what changed; delete: the whole row
    after = Column(JSON, nullable=True)                  # create: the whole row; update: new values of what changed
