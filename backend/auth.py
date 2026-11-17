import hashlib
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, Header, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from database import get_db, settings as app_settings
from models import LoginSession, User

SECRET_KEY = app_settings.secret_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days: tokens issued before device sessions existed
# A signed-in device stays signed in until it goes this long without being used
SESSION_DAYS = 180
SLIDE_AFTER = timedelta(days=1)    # move the expiry forward at most once a day per device
SESSION_COOKIE = "hh_session"
# Shared secret for internal services (bots) that can't do the login flow
INTERNAL_API_KEY = app_settings.internal_api_key or app_settings.secret_key

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None, expires_at: Optional[datetime] = None) -> str:
    to_encode = data.copy()
    to_encode["exp"] = expires_at or (datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)))
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# ---------------------------------------------------------------------------
# Device sessions
# ---------------------------------------------------------------------------
def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def device_label(user_agent: str | None) -> str:
    """'iPhone · Safari', 'Windows · Edge' — enough to tell the family's devices apart."""
    ua = user_agent or ""
    device = ("iPad" if "iPad" in ua else "iPhone" if "iPhone" in ua else "Android" if "Android" in ua
              else "Mac" if "Macintosh" in ua else "Windows" if "Windows" in ua else "Linux" if "Linux" in ua else "")
    browser = ("Edge" if "Edg/" in ua else "Firefox" if re.search(r"Firefox|FxiOS", ua) else "Chrome" if re.search(r"Chrome|CriOS", ua)
               else "Safari" if "Safari" in ua else "")
    return " · ".join(x for x in (device, browser) if x) or "Unknown device"


def start_session(db: Session, user: User, user_agent: str | None) -> tuple[LoginSession, str]:
    secret = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    row = LoginSession(user_id=user.id, secret_hash=_hash(secret), device=device_label(user_agent),
                       created_at=now, last_used_at=now, expires_at=now + timedelta(days=SESSION_DAYS))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, secret


def session_token(user: User, session: LoginSession) -> str:
    return create_access_token({"sub": user.username, "sid": session.id}, expires_at=session.expires_at)


def active(session: LoginSession | None) -> bool:
    return session is not None and session.revoked_at is None and session.expires_at > datetime.utcnow()


def touch(db: Session, session: LoginSession) -> None:
    """Sliding expiry: a device that keeps being used stays signed in."""
    now = datetime.utcnow()
    if now - (session.last_used_at or session.created_at) >= SLIDE_AFTER:
        session.last_used_at = now
        session.expires_at = now + timedelta(days=SESSION_DAYS)
        db.commit()


def set_session_cookie(response: Response, request: Request, session: LoginSession, secret: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, f"{session.id}.{secret}", max_age=SESSION_DAYS * 86400, httponly=True, samesite="strict",
        secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https", path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def session_from_cookie(db: Session, request: Request) -> LoginSession | None:
    raw = request.cookies.get(SESSION_COOKIE) or ""
    sid, _, secret = raw.partition(".")
    if not sid.isdigit() or not secret:
        return None
    row = db.query(LoginSession).filter(LoginSession.id == int(sid)).first()
    if not active(row) or not secrets.compare_digest(row.secret_hash, _hash(secret)):
        return None
    return row


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ---------------------------------------------------------------------------
def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    x_api_key: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired session",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if x_api_key and x_api_key == INTERNAL_API_KEY:
        user = db.query(User).filter(User.username == "admin").first()
        if user:
            return user
        raise credentials_exc
    if not token:
        raise credentials_exc
    payload = decode_token(token)
    username = payload.get("sub") if payload else None
    if not username:
        raise credentials_exc
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise credentials_exc
    sid = payload.get("sid")
    if sid is not None:   # tokens from before device sessions have no sid and simply run out after 7 days
        session = db.query(LoginSession).filter(LoginSession.id == sid).first()
        if not active(session) or session.user_id != user.id:
            raise credentials_exc
        touch(db, session)
    user.session_id = sid   # not a column: which device this request came from
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if (user.role or "admin") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
