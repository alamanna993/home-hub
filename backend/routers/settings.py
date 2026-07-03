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
    {"key": "low_stock_alert_channel", "description": "Discord channel ID for automatic low-stock alerts (leave blank to disable)", "secret": False},
    {"key": "site_title", "description": "Dashboard title shown in the sidebar", "secret": False},
    # LLM provider selection
    {"key": "llm_provider", "description": "AI provider: ollama | lmstudio | openai | claude", "secret": False},
    # Ollama
    {"key": "ollama_host", "description": "Ollama server URL (e.g. http://host.docker.internal:11434)", "secret": False},
    {"key": "ollama_model", "description": "Ollama model name (e.g. llama3.2, mistral)", "secret": False},
    # LM Studio
    {"key": "lmstudio_host", "description": "LM Studio server URL (e.g. http://host.docker.internal:1234)", "secret": False},
    {"key": "lmstudio_model", "description": "LM Studio model identifier (leave blank to use whichever model is loaded)", "secret": False},
    # OpenAI
    {"key": "openai_api_key", "description": "OpenAI API key", "secret": True},
    {"key": "openai_model", "description": "OpenAI model (e.g. gpt-4o-mini, gpt-4o)", "secret": False},
    # Claude / Anthropic
    {"key": "anthropic_api_key", "description": "Anthropic API key", "secret": True},
    {"key": "claude_model", "description": "Claude model (e.g. claude-haiku-4-5-20251001, claude-sonnet-4-6)", "secret": False},
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
        "low_stock_alert_channel": rows.get("low_stock_alert_channel", ""),
        "site_title": rows.get("site_title", "HomeHub"),
        "llm_provider": rows.get("llm_provider", "ollama"),
        "ollama_host": rows.get("ollama_host", ""),
        "ollama_model": rows.get("ollama_model", ""),
        "lmstudio_host": rows.get("lmstudio_host", ""),
        "lmstudio_model": rows.get("lmstudio_model", ""),
        "openai_model": rows.get("openai_model", ""),
        "claude_model": rows.get("claude_model", ""),
    }
