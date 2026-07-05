from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base, settings as app_settings
from routers import items, locations, categories, chat, calendar, meals, chores, family
from routers import auth as auth_router
from routers import settings as settings_router
from models import Category, Location, User, Setting
from auth import get_current_user, hash_password
from sqlalchemy.orm import Session
import logging

logger = logging.getLogger("homehub")

app = FastAPI(title="HomeHub API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(settings_router.router)
app.include_router(items.router, dependencies=[Depends(get_current_user)])
app.include_router(locations.router, dependencies=[Depends(get_current_user)])
app.include_router(categories.router, dependencies=[Depends(get_current_user)])
app.include_router(chat.router, dependencies=[Depends(get_current_user)])
app.include_router(calendar.feed_router)  # token-protected, used by Google/Outlook subscriptions
app.include_router(calendar.router, dependencies=[Depends(get_current_user)])
app.include_router(meals.router, dependencies=[Depends(get_current_user)])
app.include_router(chores.router, dependencies=[Depends(get_current_user)])
app.include_router(family.router, dependencies=[Depends(get_current_user)])


def seed_defaults(db: Session):
    default_categories = [
        {"name": "Groceries", "icon": "🛒", "color": "#22c55e"},
        {"name": "Electronics", "icon": "🔌", "color": "#3b82f6"},
        {"name": "Server / Network", "icon": "🖥️", "color": "#8b5cf6"},
        {"name": "Tools", "icon": "🔧", "color": "#f59e0b"},
        {"name": "Furniture", "icon": "🪑", "color": "#84cc16"},
        {"name": "Books / Media", "icon": "📚", "color": "#ec4899"},
        {"name": "Cleaning", "icon": "🧹", "color": "#06b6d4"},
        {"name": "Other", "icon": "📦", "color": "#6b7280"},
    ]
    default_locations = [
        {"name": "Kitchen", "sublocation": "Pantry"},
        {"name": "Kitchen", "sublocation": "Fridge"},
        {"name": "Kitchen", "sublocation": "Freezer"},
        {"name": "Garage", "sublocation": None},
        {"name": "Living Room", "sublocation": None},
        {"name": "Office / Server Room", "sublocation": None},
        {"name": "Basement", "sublocation": None},
        {"name": "Bedroom", "sublocation": None},
    ]
    for cat_data in default_categories:
        if not db.query(Category).filter_by(name=cat_data["name"]).first():
            db.add(Category(**cat_data))
    for loc_data in default_locations:
        if not db.query(Location).filter_by(name=loc_data["name"], sublocation=loc_data["sublocation"]).first():
            db.add(Location(**loc_data))

    if not db.query(User).filter_by(username="admin").first():
        db.add(User(username="admin", hashed_password=hash_password(app_settings.default_admin_password)))
        logger.warning("Created default admin user — password: %s — change it in Settings!", app_settings.default_admin_password)

    import secrets as _secrets
    default_settings = [
        ("site_title", "HomeHub"),
        ("setup_complete", "false"),
        ("calendar_feed_token", _secrets.token_hex(16)),
        ("llm_provider", app_settings.llm_provider),
        ("ollama_host", app_settings.ollama_host),
        ("ollama_model", app_settings.ollama_model),
        ("lmstudio_host", app_settings.lmstudio_host),
        ("lmstudio_model", app_settings.lmstudio_model),
        ("openai_model", app_settings.openai_model),
        ("claude_model", app_settings.claude_model),
    ]
    for key, value in default_settings:
        if not db.query(Setting).filter_by(key=key).first():
            db.add(Setting(key=key, value=value))

    db.commit()


def run_migrations():
    """Lightweight column additions for existing installs (create_all won't alter tables)."""
    from sqlalchemy import text
    with engine.begin() as conn:
        # track_stock backfill must only run when the column is first created
        had_track_stock = conn.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='track_stock'"
        )).first() is not None
        conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS track_stock BOOLEAN DEFAULT FALSE"))
        if not had_track_stock:
            conn.execute(text("""
                UPDATE items SET track_stock = TRUE
                WHERE low_stock_threshold IS NOT NULL
                   OR category_id IN (
                        SELECT id FROM categories
                        WHERE name ILIKE '%grocer%' OR name ILIKE '%food%' OR name ILIKE '%produce%'
                   )
            """))
        conn.execute(text("ALTER TABLE items ADD COLUMN IF NOT EXISTS author VARCHAR(200)"))
        conn.execute(text("ALTER TABLE locations ADD COLUMN IF NOT EXISTS icon VARCHAR(50)"))
        conn.execute(text("ALTER TABLE chores ADD COLUMN IF NOT EXISTS icon VARCHAR(50)"))
        conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'admin'"))


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    run_migrations()
    db = Session(bind=engine)
    try:
        seed_defaults(db)
    finally:
        db.close()


@app.get("/health")
def health():
    return {"status": "ok"}
