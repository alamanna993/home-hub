from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db
from models import Setting, User
from auth import require_admin
import msgraph

router = APIRouter(prefix="/msgraph", tags=["msgraph"])


class ClientId(BaseModel):
    client_id: str
    tenant: str = ""


class Credentials(BaseModel):
    client_id: str
    tenant: str
    client_secret: str
    user_email: str


@router.get("/status")
def status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return {
        "connected": msgraph.is_connected(db),
        "mode": msgraph.get_mode(db),
        "account": msgraph._get(db, "msgraph_account"),
        "client_id_set": bool(msgraph._get(db, "msgraph_client_id")),
        "tenant": msgraph._get(db, "msgraph_tenant"),
    }


@router.post("/credentials")
async def save_credentials(data: Credentials, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Client-secret (Application permissions) mode: validate by actually reading the
    target calendar before saving anything permanent."""
    cid, tenant = data.client_id.strip(), data.tenant.strip()
    secret, email = data.client_secret.strip(), data.user_email.strip()
    if not (cid and tenant and secret and email):
        raise HTTPException(status_code=400, detail="All four fields are required for client-secret mode")
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Calendar email should be a full address, e.g. you@lamanna.family")

    import httpx
    # 1. Get a token with these exact credentials
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            data={"grant_type": "client_credentials", "client_id": cid,
                  "client_secret": secret, "scope": "https://graph.microsoft.com/.default"})
        tok = r.json()
    if "access_token" not in tok:
        desc = tok.get("error_description", "")
        if "7000215" in desc:
            raise HTTPException(status_code=400, detail="Microsoft says the client secret is invalid — copy the secret's *Value* (not the Secret ID) right after creating it; it's only shown once.")
        if "700016" in desc:
            raise HTTPException(status_code=400, detail="Microsoft doesn't recognize that Client ID in this tenant — check both the client ID and the Directory (tenant) ID.")
        if "90002" in desc or "not found" in desc.lower():
            raise HTTPException(status_code=400, detail="That Directory (tenant) ID wasn't found — copy it from the app's Overview page.")
        raise HTTPException(status_code=400, detail=desc.split("Trace ID")[0].strip() or "Could not get a token from Microsoft")

    # 2. Prove we can actually read the calendar
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(f"{msgraph.GRAPH}/users/{email}/calendar",
                             headers={"Authorization": f"Bearer {tok['access_token']}"})
    if r.status_code == 403:
        raise HTTPException(status_code=400, detail="Token OK but calendar access denied — in the app's API permissions add Microsoft Graph → *Application* permissions → Calendars.ReadWrite, then click 'Grant admin consent'.")
    if r.status_code == 404:
        raise HTTPException(status_code=400, detail=f"No mailbox found for {email} — check the address (it must be a real Microsoft 365 mailbox in this tenant).")
    if r.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Calendar check failed (HTTP {r.status_code}): {r.text[:200]}")

    # 3. All good — persist
    msgraph._set(db, "msgraph_client_id", cid)
    msgraph._set(db, "msgraph_tenant", tenant)
    msgraph._set(db, "msgraph_client_secret", secret)
    msgraph._set(db, "msgraph_user_email", email)
    msgraph._set(db, "msgraph_account", email)
    msgraph._token_cache.update({"access": tok["access_token"], "exp": __import__("time").time() + tok.get("expires_in", 3600) - 120})
    from routers.calendar import sync_with_graph
    try:
        await sync_with_graph(db, force=True)
    except Exception:
        pass
    return {"ok": True, "account": email}


@router.post("/client-id")
def save_client_id(data: ClientId, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cid = data.client_id.strip()
    if len(cid) < 30 or " " in cid:
        raise HTTPException(status_code=400, detail="That doesn't look like an Application (client) ID")
    msgraph._set(db, "msgraph_client_id", cid)
    msgraph._set(db, "msgraph_tenant", data.tenant.strip())
    return {"ok": True}


@router.post("/device-code")
async def device_code(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    try:
        return await msgraph.start_device_flow(db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Microsoft sign-in service error: {e}")


@router.post("/poll")
async def poll(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    result = await msgraph.poll_device_flow(db)
    if result.get("status") == "success":
        # First sync right away so the calendar fills in immediately
        from routers.calendar import sync_with_graph
        try:
            await sync_with_graph(db, force=True)
        except Exception:
            pass
    return result


@router.post("/disconnect")
def disconnect(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    msgraph.disconnect(db)
    return {"ok": True}
