from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db
from models import Setting, User
from auth import get_current_user

router = APIRouter(prefix="/settings", tags=["settings"])

SETTING_DEFINITIONS = [
    {"key": "discord_token", "description": "Discord bot token", "secret": True},
    {"key": "discord_channel_id", "description": "Discord channel ID the bot listens in", "secret": False},
    {"key": "ollama_host", "description": "Ollama server URL (e.g. http://host.docker.internal:11434)", "secret": False},
    {"key": "ollama_model", "description": "Ollama model name (e.g. llama3.2, mistral)", "secret": False},
    {"key": "low_stock_alert_channel", "description": "Discord channel ID for automatic low-stock alerts (leave blank to disable)", "secret": False},
    {"key": "site_title", "description": "Dashboard title shown in the sidebar", "secret": False},
]


class SettingUpdate(BaseModel):
    value: Optional[str] = None


@router.get("/")
def get_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = {s.key: s.value for s in db.query(Setting).all()}
    result = []
    for defn in SETTING_DEFINITIONS:
        value = rows.get(defn["key"], "")
        result.append({
            "key": defn["key"],
            "value": ("••••••••" if defn["secret"] and value else value),
            "description": defn["description"],
            "secret": defn["secret"],
            "is_set": bool(value),
        })
    return result


@router.patch("/{key}")
def update_setting(
    key: str,
    data: SettingUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    valid_keys = {d["key"] for d in SETTING_DEFINITIONS}
    if key not in valid_keys:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Unknown setting key")

    setting = db.query(Setting).filter(Setting.key == key).first()
    if setting:
        setting.value = data.value
    else:
        defn = next(d for d in SETTING_DEFINITIONS if d["key"] == key)
        db.add(Setting(key=key, value=data.value, description=defn["description"]))
    db.commit()
    return {"ok": True, "key": key}


@router.get("/runtime")
def get_runtime_settings(db: Session = Depends(get_db)):
    """Public endpoint for the bot to fetch its own config at startup."""
    rows = {s.key: s.value for s in db.query(Setting).all()}
    return {
        "discord_channel_id": rows.get("discord_channel_id", ""),
        "ollama_host": rows.get("ollama_host", ""),
        "ollama_model": rows.get("ollama_model", ""),
        "low_stock_alert_channel": rows.get("low_stock_alert_channel", ""),
        "site_title": rows.get("site_title", "HomeHub"),
    }
