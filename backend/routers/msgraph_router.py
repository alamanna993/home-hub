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


@router.get("/status")
def status(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return {
        "connected": msgraph.is_connected(db),
        "account": msgraph._get(db, "msgraph_account"),
        "client_id_set": bool(msgraph._get(db, "msgraph_client_id")),
    }


@router.post("/client-id")
def save_client_id(data: ClientId, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    cid = data.client_id.strip()
    if len(cid) < 30 or " " in cid:
        raise HTTPException(status_code=400, detail="That doesn't look like an Application (client) ID")
    msgraph._set(db, "msgraph_client_id", cid)
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
