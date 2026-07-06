"""Microsoft Graph integration: device-code sign-in and two-way Outlook calendar sync."""
import time
import logging
import httpx
from typing import Optional
from models import Setting

logger = logging.getLogger("homehub")

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = "Calendars.ReadWrite offline_access User.Read"


def _auth_base(db) -> str:
    tenant = _get(db, "msgraph_tenant") or "common"
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0"

# In-process state: current device flow + cached access token
_device_flow: dict = {}
_token_cache: dict = {"access": None, "exp": 0.0}


def _get(db, key: str) -> str:
    row = db.query(Setting).filter(Setting.key == key).first()
    return (row.value or "") if row else ""


def _set(db, key: str, value: str):
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


def get_timezone(db) -> str:
    return _get(db, "timezone") or "America/New_York"


def get_mode(db) -> str:
    """'secret' = client-credentials daemon (Application permissions);
    'delegated' = device-code sign-in; '' = not configured."""
    if _get(db, "msgraph_client_secret") and _get(db, "msgraph_tenant") and _get(db, "msgraph_user_email"):
        return "secret"
    if _get(db, "msgraph_refresh_token"):
        return "delegated"
    return ""


def is_connected(db) -> bool:
    return bool(_get(db, "msgraph_client_id")) and get_mode(db) != ""


def me_path(db) -> str:
    """Graph path prefix: /me for delegated, /users/{email} for secret mode."""
    if get_mode(db) == "secret":
        return f"/users/{_get(db, 'msgraph_user_email')}"
    return "/me"


async def start_device_flow(db) -> dict:
    client_id = _get(db, "msgraph_client_id")
    if not client_id:
        raise ValueError("Save your Microsoft app Client ID first")
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{_auth_base(db)}/devicecode",
                              data={"client_id": client_id, "scope": SCOPES})
        if r.status_code >= 400:
            try:
                desc = r.json().get("error_description", "")
            except Exception:
                desc = ""
            if r.status_code == 401 or "7000218" in desc:
                raise ValueError(
                    "Microsoft rejected the request — this almost always means 'Allow public client flows' "
                    "is still set to No. In the Azure portal open your HomeHub app → Authentication → "
                    "Advanced settings → set 'Allow public client flows' to Yes → Save, then try again.")
            if "700016" in desc:
                raise ValueError("Microsoft doesn't recognize that Client ID — double-check you copied the "
                                 "'Application (client) ID' from the app's Overview page.")
            if "50059" in desc:
                raise ValueError(
                    "Your app registration is single-tenant. Easiest fix: in the Azure portal open the app → "
                    "Authentication → Supported account types → choose 'Accounts in any organizational directory "
                    "and personal Microsoft accounts' → Save. (Alternatively, paste your Directory (tenant) ID "
                    "into the Tenant field here.)")
            raise ValueError(desc.split("Trace ID")[0].strip() or f"Microsoft sign-in error (HTTP {r.status_code})")
        data = r.json()
    _device_flow.update({
        "device_code": data["device_code"],
        "client_id": client_id,
        "interval": data.get("interval", 5),
    })
    return {
        "user_code": data["user_code"],
        "verification_uri": data.get("verification_uri", "https://microsoft.com/devicelogin"),
        "expires_in": data.get("expires_in", 900),
    }


async def poll_device_flow(db) -> dict:
    """One poll of the token endpoint. Returns {status: pending|success|error, ...}."""
    if not _device_flow.get("device_code"):
        return {"status": "error", "detail": "No sign-in in progress — click Connect first"}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{_auth_base(db)}/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": _device_flow["client_id"],
            "device_code": _device_flow["device_code"],
        })
        data = r.json()
    if "access_token" in data:
        _set(db, "msgraph_refresh_token", data.get("refresh_token", ""))
        _token_cache.update({"access": data["access_token"], "exp": time.time() + data.get("expires_in", 3600) - 120})
        _device_flow.clear()
        # Grab the account label for the UI
        account = ""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                me = await client.get(f"{GRAPH}/me", headers={"Authorization": f"Bearer {data['access_token']}"})
                j = me.json()
                account = j.get("userPrincipalName") or j.get("mail") or j.get("displayName") or ""
        except Exception:
            pass
        _set(db, "msgraph_account", account)
        return {"status": "success", "account": account}
    err = data.get("error", "")
    if err in ("authorization_pending", "slow_down"):
        return {"status": "pending"}
    _device_flow.clear()
    return {"status": "error", "detail": data.get("error_description", err) or "Sign-in failed"}


def disconnect(db):
    _set(db, "msgraph_refresh_token", "")
    _set(db, "msgraph_account", "")
    _set(db, "msgraph_client_secret", "")
    _set(db, "msgraph_user_email", "")
    _token_cache.update({"access": None, "exp": 0.0})


async def get_access_token(db) -> Optional[str]:
    if _token_cache["access"] and time.time() < _token_cache["exp"]:
        return _token_cache["access"]
    client_id = _get(db, "msgraph_client_id")

    if get_mode(db) == "secret":
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(f"{_auth_base(db)}/token", data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": _get(db, "msgraph_client_secret"),
                "scope": "https://graph.microsoft.com/.default",
            })
            data = r.json()
        if "access_token" not in data:
            logger.warning("Graph client-credentials token failed: %s", data.get("error_description", "")[:200])
            return None
        _token_cache.update({"access": data["access_token"], "exp": time.time() + data.get("expires_in", 3600) - 120})
        return data["access_token"]

    refresh = _get(db, "msgraph_refresh_token")
    if not client_id or not refresh:
        return None
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(f"{_auth_base(db)}/token", data={
            "grant_type": "refresh_token",
            "client_id": client_id,
            "refresh_token": refresh,
            "scope": SCOPES,
        })
        data = r.json()
    if "access_token" not in data:
        logger.warning("Graph token refresh failed: %s", data.get("error_description", "")[:200])
        return None
    if data.get("refresh_token"):
        _set(db, "msgraph_refresh_token", data["refresh_token"])
    _token_cache.update({"access": data["access_token"], "exp": time.time() + data.get("expires_in", 3600) - 120})
    return data["access_token"]


async def graph_request(db, method: str, path: str, json: dict = None, params: dict = None) -> Optional[dict]:
    token = await get_access_token(db)
    if not token:
        return None
    tz = get_timezone(db)
    headers = {"Authorization": f"Bearer {token}", "Prefer": f'outlook.timezone="{tz}"'}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.request(method, f"{GRAPH}{path}", headers=headers, json=json, params=params)
        if r.status_code == 404 and method == "DELETE":
            return {}
        r.raise_for_status()
        return r.json() if r.content else {}


# ---- Outbound: push HomeHub events onto the Outlook calendar ----

def _event_body(event, tz: str) -> dict:
    from datetime import timedelta
    start = event.start
    end = event.end or (start + timedelta(hours=1))
    if event.all_day:
        start = start.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=1)
    return {
        "subject": event.title,
        "body": {"contentType": "text", "content": event.description or ""},
        "start": {"dateTime": start.isoformat(), "timeZone": tz},
        "end": {"dateTime": end.isoformat(), "timeZone": tz},
        "isAllDay": bool(event.all_day),
    }


async def push_create(db, event) -> bool:
    """Create the event in Outlook and remember its Graph id. Best-effort."""
    if not is_connected(db):
        return False
    try:
        result = await graph_request(db, "POST", f"{me_path(db)}/events", json=_event_body(event, get_timezone(db)))
        if result and result.get("id"):
            event.ms_id = result["id"]
            db.commit()
            return True
    except Exception as e:
        logger.warning("Graph push_create failed for '%s': %s", event.title, e)
    return False


async def push_update(db, event) -> bool:
    if not is_connected(db) or not event.ms_id:
        return False
    try:
        await graph_request(db, "PATCH", f"{me_path(db)}/events/{event.ms_id}", json=_event_body(event, get_timezone(db)))
        return True
    except Exception as e:
        logger.warning("Graph push_update failed for '%s': %s", event.title, e)
    return False


async def push_delete(db, ms_id: str) -> bool:
    if not is_connected(db) or not ms_id:
        return False
    try:
        await graph_request(db, "DELETE", f"{me_path(db)}/events/{ms_id}")
        return True
    except Exception as e:
        logger.warning("Graph push_delete failed: %s", e)
    return False
