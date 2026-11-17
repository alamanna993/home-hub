"""Photos: uploaded or fetched once, resized, and kept on the server so they keep
working offline and when the original site changes or blocks hotlinking.

Files live in MEDIA_DIR under random names. Reading a photo needs no login (an
<img> tag can't send one) — the unguessable name is the protection, like the
calendar feed token. Uploading and fetching need a login."""
import io
import ipaddress
import logging
import os
import re
import socket
import uuid
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

logger = logging.getLogger("homehub-media")

MEDIA_DIR = os.environ.get("MEDIA_DIR", "/data/media")
MAX_BYTES = 15 * 1024 * 1024
MAX_SIDE = 1600
THUMB_SIDE = 480
NAME_RE = re.compile(r"^[0-9a-f]{32}(_t)?\.jpg$")
USER_AGENT = "HomeHub/1.0 (family photo fetch; self-hosted)"

# Public photos are served with their own router so they stay outside the login check
router = APIRouter(prefix="/media", tags=["media"])
public_router = APIRouter(prefix="/media", tags=["media"])


class MediaError(Exception):
    """A photo couldn't be read or fetched; the message is safe to show the user."""


try:  # iPhones save HEIC; teach Pillow to read it when the library is installed
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:  # noqa: BLE001
    pass


# ---------------------------------------------------------------------------
# Saving
# ---------------------------------------------------------------------------
def save_image(data: bytes) -> str:
    """Resize and store an image; returns its public path, '/media/<name>.jpg'."""
    from PIL import Image, ImageOps, UnidentifiedImageError
    Image.MAX_IMAGE_PIXELS = 60_000_000   # refuse decompression bombs
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise MediaError("That file isn't a photo I can read. JPG, PNG, WebP and iPhone HEIC photos work.")
    img = ImageOps.exif_transpose(img)           # phone photos carry their rotation in metadata
    if img.mode not in ("RGB", "L"):
        background = Image.new("RGB", img.size, (255, 255, 255))   # flatten transparency onto white
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1])
            img = background
        else:
            img = img.convert("RGB")
    elif img.mode == "L":
        img = img.convert("RGB")
    os.makedirs(MEDIA_DIR, exist_ok=True)
    stem = uuid.uuid4().hex
    full = img.copy()
    full.thumbnail((MAX_SIDE, MAX_SIDE))
    full.save(os.path.join(MEDIA_DIR, f"{stem}.jpg"), "JPEG", quality=85, optimize=True)
    thumb = img.copy()
    thumb.thumbnail((THUMB_SIDE, THUMB_SIDE))
    thumb.save(os.path.join(MEDIA_DIR, f"{stem}_t.jpg"), "JPEG", quality=80, optimize=True)
    return f"/media/{stem}.jpg"


def sweep_orphans(db, min_age_days: int = 7) -> int:
    """Delete stored photos that no recipe, item or person refers to. Photos are never
    removed when a record changes (Undo can bring it back); this tidies up later."""
    import time
    from models import FamilyMember, Item, Recipe
    if not os.path.isdir(MEDIA_DIR):
        return 0
    used: set[str] = set()
    for model, col in ((Recipe, Recipe.image_url), (Item, Item.image_url), (FamilyMember, FamilyMember.photo_url)):
        for (url,) in db.query(col).filter(col.like("/media/%")).all():
            used.add(url.removeprefix("/media/").replace("_t.jpg", ".jpg"))
    cutoff = time.time() - min_age_days * 86400
    removed = 0
    for name in os.listdir(MEDIA_DIR):
        if not NAME_RE.match(name) or name.replace("_t.jpg", ".jpg") in used:
            continue
        path = os.path.join(MEDIA_DIR, name)
        try:
            if os.path.getmtime(path) < cutoff:
                os.remove(path)
                removed += 1
        except OSError:
            pass
    return removed


# ---------------------------------------------------------------------------
# Fetching from a link — refuses anything that points back inside the network
# ---------------------------------------------------------------------------
def _is_public_host(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
                or ip.is_reserved or ip.is_unspecified):
            return False
    return bool(infos)


def fetch_image_bytes(url: str, referer: str | None = None) -> bytes:
    """Download an image from the public internet. Every redirect hop is checked,
    so a public link can't bounce into the router or another machine on the LAN."""
    current = url.strip()
    headers = {"User-Agent": USER_AGENT, "Accept": "image/*"}
    if referer:
        headers["Referer"] = referer
    with httpx.Client(timeout=20.0, follow_redirects=False, headers=headers) as client:
        for _ in range(5):
            parts = urlparse(current)
            if parts.scheme not in ("http", "https") or not parts.hostname:
                raise MediaError("Photo links have to start with http:// or https://")
            if not _is_public_host(parts.hostname):
                raise MediaError("That link points inside your own network, so I won't fetch it.")
            try:
                with client.stream("GET", current) as r:
                    if r.is_redirect:
                        location = r.headers.get("location")
                        if not location:
                            raise MediaError("That link redirects nowhere.")
                        current = urljoin(current, location)
                        continue
                    if r.status_code in (401, 403, 429):
                        raise MediaError("That site doesn't let apps download its photos.")
                    if r.status_code >= 400:
                        raise MediaError(f"That photo link didn't work (error {r.status_code}).")
                    ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
                    if ctype and not ctype.startswith("image/") and ctype != "application/octet-stream":
                        raise MediaError("That link isn't a photo.")
                    chunks, size = [], 0
                    for chunk in r.iter_bytes():
                        size += len(chunk)
                        if size > MAX_BYTES:
                            raise MediaError("That photo is larger than 15 MB.")
                        chunks.append(chunk)
                    return b"".join(chunks)
            except httpx.HTTPError as e:
                raise MediaError(f"Couldn't download that photo: {e.__class__.__name__}")
    raise MediaError("That link redirects too many times.")


def localize_url(url: str | None, referer: str | None = None) -> str | None:
    """Make a local copy of a remote photo. Returns the local path, or the original
    link unchanged when it can't be fetched (so a recipe keeps *some* picture)."""
    if not url or not url.startswith(("http://", "https://")):
        return url
    try:
        return save_image(fetch_image_bytes(url, referer))
    except MediaError as e:
        logger.info("Kept remote photo link %s (%s)", url[:80], e)
    except Exception as e:  # noqa: BLE001 — a failed photo must never fail a recipe save
        logger.warning("Photo localize failed for %s: %r", url[:80], e)
    return url


def localize_existing(db) -> int:
    """One-time pass at startup: bring photos that are still remote links home."""
    from models import Recipe, Setting
    if db.query(Setting).filter_by(key="media_localized_v1").first():
        return 0
    n = 0
    for r in db.query(Recipe).filter(Recipe.image_url.like("http%")).all():
        local = localize_url(r.image_url, r.source_url)
        if local and local != r.image_url:
            r.image_url = local
            n += 1
    db.add(Setting(key="media_localized_v1", value="true"))
    db.commit()
    return n


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
class FromUrl(BaseModel):
    url: str


@router.post("/upload")
def upload_photo(file: UploadFile = File(...)):
    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="That photo is larger than 15 MB.")
    try:
        return {"url": save_image(data)}
    except MediaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/from-url")
def photo_from_url(data: FromUrl):
    try:
        return {"url": save_image(fetch_image_bytes(data.url))}
    except MediaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@public_router.get("/{name}")
def get_photo(name: str):
    if not NAME_RE.match(name):
        raise HTTPException(status_code=404, detail="Not found")
    path = os.path.join(MEDIA_DIR, name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
