import time
from collections import defaultdict, deque
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel
from database import get_db
from models import LoginSession, User
from auth import (
    verify_password, hash_password, get_current_user, require_admin, oauth2_scheme, decode_token,
    start_session, session_token, session_from_cookie, set_session_cookie, clear_session_cookie, touch, active,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "member"  # admin | member


# ---------------------------------------------------------------------------
# Sign-in throttle: sign-ins last months now, so slow down password guessing
# ---------------------------------------------------------------------------
MAX_FAILURES = 10
FAILURE_WINDOW = 15 * 60     # seconds
_failures: dict[str, deque] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "?")


def _recent_failures(ip: str) -> deque:
    q = _failures[ip]
    cutoff = time.time() - FAILURE_WINDOW
    while q and q[0] < cutoff:
        q.popleft()
    return q


def _signed_in(user: User, session: LoginSession) -> dict:
    return {"access_token": session_token(user, session), "token_type": "bearer",
            "username": user.username, "role": user.role or "admin"}


@router.post("/login")
def login(request: Request, response: Response, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    ip = _client_ip(request)
    failures = _recent_failures(ip)
    if len(failures) >= MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Too many wrong passwords. Wait a few minutes, then try again.")
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        failures.append(time.time())
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    failures.clear()
    session, secret = start_session(db, user, request.headers.get("user-agent"))
    set_session_cookie(response, request, session, secret)
    return _signed_in(user, session)


@router.post("/resume")
def resume(request: Request, response: Response, token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """A fresh token for a device that is still signed in: from its session cookie, or by
    upgrading a token from before device sessions existed."""
    session = session_from_cookie(db, request)
    if session:
        user = db.query(User).filter(User.id == session.user_id).first()
        if user:
            touch(db, session)
            return _signed_in(user, session)
    payload = decode_token(token) if token else None
    if payload and payload.get("sid") is None and payload.get("sub"):
        user = db.query(User).filter(User.username == payload["sub"]).first()
        if user:
            session, secret = start_session(db, user, request.headers.get("user-agent"))
            set_session_cookie(response, request, session, secret)
            return _signed_in(user, session)
    if payload and payload.get("sid") is not None:
        # The cookie is gone (cleared, or Safari dropped it) but the token's session may still be good
        session = db.query(LoginSession).filter(LoginSession.id == payload["sid"]).first()
        user = db.query(User).filter(User.username == payload.get("sub")).first()
        if user and active(session) and session.user_id == user.id:
            touch(db, session)
            return _signed_in(user, session)
    raise HTTPException(status_code=401, detail="Not signed in")


@router.post("/logout")
def logout(request: Request, response: Response, token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    """Sign this device out: its session stops working everywhere, and the cookie goes."""
    session = None
    payload = decode_token(token) if token else None
    if payload and payload.get("sid") is not None:
        session = db.query(LoginSession).filter(LoginSession.id == payload["sid"]).first()
    session = session or session_from_cookie(db, request)
    if session and session.revoked_at is None:
        session.revoked_at = datetime.utcnow()
        db.commit()
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return {"username": current_user.username, "role": current_user.role or "admin"}


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    """Signed-in devices: everyone's for an admin, your own otherwise."""
    q = (db.query(LoginSession, User).join(User, User.id == LoginSession.user_id)
         .filter(LoginSession.revoked_at.is_(None), LoginSession.expires_at > datetime.utcnow()))
    if (current.role or "admin") != "admin":
        q = q.filter(LoginSession.user_id == current.id)
    rows = q.order_by(LoginSession.last_used_at.desc()).all()
    return [{"id": s.id, "username": u.username, "device": s.device, "created_at": s.created_at.isoformat(),
             "last_used_at": s.last_used_at.isoformat(), "expires_at": s.expires_at.isoformat(),
             "current": s.id == getattr(current, "session_id", None)} for s, u in rows]


@router.delete("/sessions/{session_id}")
def revoke_session(session_id: int, db: Session = Depends(get_db), current: User = Depends(get_current_user)):
    s = db.query(LoginSession).filter(LoginSession.id == session_id).first()
    if not s or (s.user_id != current.id and (current.role or "admin") != "admin"):
        raise HTTPException(status_code=404, detail="That device isn't signed in")
    if s.revoked_at is None:
        s.revoked_at = datetime.utcnow()
        db.commit()
    return {"ok": True, "current": s.id == getattr(current, "session_id", None)}


@router.get("/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return [{"id": u.id, "username": u.username, "role": u.role or "admin"} for u in db.query(User).order_by(User.username).all()]


@router.post("/users", status_code=201)
def create_user(data: UserCreate, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    if data.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="Role must be admin or member")
    if not data.username.strip() or len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Username required and password must be 6+ characters")
    if db.query(User).filter(User.username == data.username.strip()).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = User(username=data.username.strip(), hashed_password=hash_password(data.password), role=data.role)
    db.add(user)
    db.commit()
    return {"id": user.id, "username": user.username, "role": user.role}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current.id:
        raise HTTPException(status_code=400, detail="You can't delete the account you're signed in with")
    admins = db.query(User).filter((User.role == "admin") | (User.role.is_(None))).count()
    if (user.role or "admin") == "admin" and admins <= 1:
        raise HTTPException(status_code=400, detail="Can't delete the last admin")
    db.query(LoginSession).filter(LoginSession.user_id == user.id).delete()   # their devices sign out too
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(req.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.hashed_password = hash_password(req.new_password)
    # A new password signs out this person's other devices
    keep = getattr(current_user, "session_id", None)
    (db.query(LoginSession)
       .filter(LoginSession.user_id == current_user.id, LoginSession.revoked_at.is_(None), LoginSession.id != (keep or -1))
       .update({"revoked_at": datetime.utcnow()}, synchronize_session=False))
    db.commit()
    return {"ok": True}
