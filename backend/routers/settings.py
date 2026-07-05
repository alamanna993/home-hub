from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from database import get_db, settings as env_settings
from models import Setting, User
from auth import get_current_user, verify_password
import auth as auth_module

router = APIRouter(prefix="/settings", tags=["settings"])

SETTING_DEFINITIONS = [
    {"key": "telegram_bot_token", "description": "Telegram bot token from @BotFather (the bot picks it up within ~30s)", "secret": True},
    {"key": "telegram_allowed_chat_ids", "description": "Comma-separated Telegram chat IDs allowed to use the bot (send /start to the bot to see yours)", "secret": False},
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


def require_api_key(x_api_key: Optional[str] = Header(None)):
    if not x_api_key or x_api_key != auth_module.INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@router.get("/runtime")
def get_runtime_settings(db: Session = Depends(get_db), _=Depends(require_api_key)):
    """Endpoint for the bot containers to fetch their config (requires X-API-Key)."""
    rows = {s.key: s.value for s in db.query(Setting).all()}
    return {
        "telegram_bot_token": rows.get("telegram_bot_token", "") or "",
        "telegram_allowed_chat_ids": rows.get("telegram_allowed_chat_ids", "") or "",
        "discord_token": rows.get("discord_token", "") or "",
        "discord_channel_id": rows.get("discord_channel_id", "") or "",
        "low_stock_alert_channel": rows.get("low_stock_alert_channel", "") or "",
        "site_title": rows.get("site_title", "HomeHub"),
        "llm_provider": rows.get("llm_provider", "ollama"),
        "ollama_host": rows.get("ollama_host", ""),
        "ollama_model": rows.get("ollama_model", ""),
        "lmstudio_host": rows.get("lmstudio_host", ""),
        "lmstudio_model": rows.get("lmstudio_model", ""),
        "openai_model": rows.get("openai_model", ""),
        "claude_model": rows.get("claude_model", ""),
    }


@router.get("/setup/status")
def setup_status(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import os
    rows = {s.key: s.value for s in db.query(Setting).all()}
    env_file = env_settings.env_file_path
    return {
        "setup_complete": rows.get("setup_complete", "false") == "true",
        "default_password_in_use": verify_password("admin", current_user.hashed_password),
        "data_path": env_settings.data_path,
        "backup_path": env_settings.backup_path,
        "data_path_display": env_settings.data_path or "(Docker named volume: postgres_data)",
        "backup_path_display": env_settings.backup_path or "./backups (next to docker-compose.yml)",
        "env_file_writable": bool(env_file) and os.path.isfile(env_file) and os.access(env_file, os.W_OK),
        "llm_provider": rows.get("llm_provider", "ollama"),
        "telegram_configured": bool(rows.get("telegram_bot_token")),
    }


class StorageUpdate(BaseModel):
    data_path: Optional[str] = None
    backup_path: Optional[str] = None


def _set_env_line(lines: list[str], key: str, value: str) -> list[str]:
    """Replace (or append) KEY=value, uncommenting a '#KEY=' line if that's all there is."""
    new_line = f"{key}={value}"
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = new_line
            return lines
    for i, line in enumerate(lines):
        if line.lstrip("# ").startswith(f"{key}="):
            lines[i] = new_line
            return lines
    lines.append(new_line)
    return lines


@router.post("/storage")
def update_storage(data: StorageUpdate, _: User = Depends(get_current_user)):
    import os
    env_file = env_settings.env_file_path
    if not env_file or not os.path.isfile(env_file):
        raise HTTPException(
            status_code=400,
            detail="The .env file isn't mounted into the backend container — edit .env by hand instead "
                   "(set DATA_PATH / BACKUP_PATH) and run: docker compose up -d",
        )
    # Rewrite in place (seek+truncate) — replacing the file would break the Docker bind mount.
    with open(env_file, "r+", encoding="utf-8") as f:
        lines = f.read().splitlines()
        if data.data_path is not None:
            lines = _set_env_line(lines, "DATA_PATH", data.data_path.strip())
        if data.backup_path is not None:
            lines = _set_env_line(lines, "BACKUP_PATH", data.backup_path.strip())
        f.seek(0)
        f.write("\n".join(lines) + "\n")
        f.truncate()

    commands = ["docker compose up -d"]
    if data.data_path and data.data_path.strip() and data.data_path.strip() != env_settings.data_path:
        commands.insert(0,
            f'docker run --rm -v home-hub_postgres_data:/from -v "{data.data_path.strip()}":/to alpine sh -c "cp -a /from/. /to/"')
    return {
        "ok": True,
        "saved": {"data_path": data.data_path, "backup_path": data.backup_path},
        "restart_required": True,
        "commands": commands,
        "note": "Run these on the machine hosting Docker, from the HomeHub folder. "
                "The first command copies your existing data to the new folder (skip it on a fresh install); "
                "the volume name may differ if your folder isn't named 'home-hub' - check with: docker volume ls",
    }


class StorageTest(BaseModel):
    path: str
    kind: str = "data"  # data | backup


@router.post("/storage/test")
def test_storage_path(data: StorageTest, _: User = Depends(get_current_user)):
    """Sanity-check a storage path before saving. We can't see the host's filesystem from
    this container, so we validate the path shape, reach out to network hosts, and flag
    setups known to cause trouble (live Postgres on SMB/NFS shares)."""
    import re
    import socket

    path = data.path.strip()
    messages: list[dict] = []

    def msg(level: str, text: str):
        messages.append({"level": level, "text": text})

    if not path:
        msg("ok", "Blank = default: a Docker-managed volume (data) or the local backups folder. Always safe.")
        return {"ok": True, "messages": messages}

    unc = re.match(r"^[\\/]{2}([^\\/]+)[\\/](.+)", path)          # \\server\share or //server/share
    nfs = re.match(r"^([A-Za-z0-9_.-]+):(/.*)", path)              # server:/export
    win = re.match(r"^[A-Za-z]:[\\/]", path)                       # C:\folder
    posix = path.startswith("/")

    server = None
    if unc:
        server = unc.group(1)
        msg("warning",
            f"'{path}' is a network share (UNC). Docker can't bind-mount UNC paths directly — "
            "mount the share on the Docker host first (or run HomeHub on the NAS itself and use "
            "its local path, e.g. /volume1/docker/homehub).")
    elif nfs:
        server = nfs.group(1)
        msg("warning",
            f"'{path}' looks like an NFS export. Mount it on the Docker host first, then use the mount point here.")
    elif win:
        msg("ok", f"Windows path — fine if Docker runs on this Windows machine. Use forward slashes in .env: {path.replace(chr(92), '/')}")
    elif posix:
        msg("ok", "Path format looks good. If the folder doesn't exist yet, Docker creates it on restart.")
    else:
        msg("error", "That doesn't look like an absolute path. Use /folder/on/the/docker/host (NAS example: /volume1/docker/homehub).")
        return {"ok": False, "messages": messages}

    if server:
        reachable = False
        ports = [445, 2049] if unc else [2049, 445]  # SMB / NFS
        for port in ports:
            try:
                with socket.create_connection((server, port), timeout=3):
                    reachable = True
                    break
            except OSError:
                continue
        if reachable:
            msg("ok", f"Good news: '{server}' is reachable on the network from HomeHub.")
        else:
            msg("error", f"Couldn't reach '{server}' on the usual file-sharing ports (SMB 445 / NFS 2049). Check the name/IP and that the NAS is on.")

    if data.kind == "data" and (unc or nfs):
        msg("warning",
            "Running the live database over a network share risks corruption (file-locking issues). "
            "Best practice: keep the database on a local disk and point the BACKUP folder at the NAS instead.")

    ok = not any(m["level"] == "error" for m in messages)
    return {"ok": ok, "messages": messages}


CURATED_MODELS = {
    "claude": ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5-20251001"],
    "openai": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
}


@router.get("/models")
async def list_models(provider: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """List models available for a provider: live from the server/API when possible, curated fallback."""
    import httpx
    rows = {s.key: s.value for s in db.query(Setting).all()}
    try:
        if provider == "ollama":
            host = rows.get("ollama_host") or env_settings.ollama_host
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{host}/api/tags")
                r.raise_for_status()
                return {"models": [m["name"] for m in r.json().get("models", [])], "source": "live"}

        elif provider == "lmstudio":
            host = rows.get("lmstudio_host") or env_settings.lmstudio_host
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{host}/v1/models")
                r.raise_for_status()
                return {"models": [m["id"] for m in r.json().get("data", [])], "source": "live"}

        elif provider == "claude":
            api_key = rows.get("anthropic_api_key") or env_settings.anthropic_api_key
            if api_key:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    r = await client.get(
                        "https://api.anthropic.com/v1/models",
                        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                    )
                    r.raise_for_status()
                    return {"models": [m["id"] for m in r.json().get("data", [])], "source": "live"}
            return {"models": CURATED_MODELS["claude"], "source": "static"}

        elif provider == "openai":
            api_key = rows.get("openai_api_key") or env_settings.openai_api_key
            if api_key:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    r = await client.get(
                        "https://api.openai.com/v1/models",
                        headers={"Authorization": f"Bearer {api_key}"},
                    )
                    r.raise_for_status()
                    models = sorted(m["id"] for m in r.json().get("data", []) if m["id"].startswith(("gpt-", "o")))
                    return {"models": models, "source": "live"}
            return {"models": CURATED_MODELS["openai"], "source": "static"}

        return {"models": [], "source": "static"}

    except Exception as e:
        return {"models": CURATED_MODELS.get(provider, []), "source": "static", "error": str(e)}


@router.post("/setup/complete")
def complete_setup(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    setting = db.query(Setting).filter(Setting.key == "setup_complete").first()
    if setting:
        setting.value = "true"
    else:
        db.add(Setting(key="setup_complete", value="true"))
    db.commit()
    return {"ok": True}


@router.post("/test-llm")
async def test_llm(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Fire a tiny prompt at the configured provider to confirm it responds."""
    from llm import generate_response
    reply = await generate_response("Reply with the single word: OK", db=db)
    if reply.startswith("I couldn't process that right now."):
        return {"ok": False, "error": reply}
    return {"ok": True, "reply": reply[:200]}
