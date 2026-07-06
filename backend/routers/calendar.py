import time
import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from database import get_db
from models import CalendarEvent, Setting

router = APIRouter(prefix="/calendar", tags=["calendar"])
# The ICS feed must be reachable by Google/Outlook without a login — token auth only.
feed_router = APIRouter(prefix="/calendar", tags=["calendar"])
logger = logging.getLogger("homehub")

# External ICS feeds (Google/Outlook) — fetched read-only, cached for 10 minutes
_ics_cache: dict = {"at": 0.0, "urls": "", "raw": []}


def invalidate_ics_cache():
    _ics_cache.update({"at": 0.0, "urls": "", "raw": []})
    _graph_sync.update({"at": 0.0})


# ---- Two-way Microsoft Graph sync (Outlook is source of truth for synced events) ----
_graph_sync: dict = {"at": 0.0}


async def sync_with_graph(db: Session, force: bool = False):
    """Pull the Outlook calendar into local events: new Outlook events appear here,
    Outlook edits update our copies, Outlook deletions remove them. HomeHub-side
    changes are pushed at write time, so after this both sides match."""
    import msgraph
    if not msgraph.is_connected(db):
        return
    now = time.time()
    if not force and now - _graph_sync["at"] < 120:
        return
    _graph_sync["at"] = now

    window_start = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S")
    window_end = (datetime.now() + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%S")
    remote: dict[str, dict] = {}
    path = (f"{msgraph.me_path(db)}/calendarView?startDateTime={window_start}&endDateTime={window_end}"
            f"&$top=200&$select=id,subject,bodyPreview,start,end,isAllDay")
    try:
        while path:
            page = await msgraph.graph_request(db, "GET", path)
            if page is None:
                return
            for ev in page.get("value", []):
                remote[ev["id"]] = ev
            nxt = page.get("@odata.nextLink")
            path = nxt.replace(msgraph.GRAPH, "") if nxt else None
    except Exception as e:
        logger.warning("Graph sync fetch failed: %s", e)
        return

    def parse_dt(v: dict) -> datetime:
        return datetime.fromisoformat(v["dateTime"][:19])

    for local in db.query(CalendarEvent).filter(CalendarEvent.ms_id.isnot(None)).all():
        ge = remote.pop(local.ms_id, None)
        if ge is None:
            # Only trust "gone from Outlook" for events inside the fetched window
            if local.start >= datetime.now() - timedelta(days=30):
                db.delete(local)
            continue
        local.title = ge.get("subject") or local.title
        local.start = parse_dt(ge["start"])
        local.end = parse_dt(ge["end"])
        local.all_day = bool(ge.get("isAllDay"))

    for ms_id, ge in remote.items():
        db.add(CalendarEvent(
            title=ge.get("subject") or "(no title)",
            start=parse_dt(ge["start"]),
            end=parse_dt(ge["end"]),
            all_day=bool(ge.get("isAllDay")),
            color="#0ea5e9",
            created_by="outlook",
            ms_id=ms_id,
        ))
    db.commit()


async def get_external_events(db: Session, start: Optional[datetime], end: Optional[datetime]) -> list[dict]:
    import msgraph
    row = db.query(Setting).filter(Setting.key == "ics_urls").first()
    urls = [u.strip() for u in (row.value or "").replace("\n", ",").split(",") if u.strip()] if row else []
    urls = ["https://" + u[len("webcal://"):] if u.startswith("webcal://") else u for u in urls]
    if msgraph.is_connected(db):
        # Graph already syncs the Outlook calendar — skip its ICS feed to avoid duplicates
        urls = [u for u in urls if "outlook.office" not in u]
    if not urls:
        return []

    now = time.time()
    if _ics_cache["urls"] != ",".join(urls) or now - _ics_cache["at"] > 600:
        raw = []
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            for url in urls:
                try:
                    r = await client.get(url)
                    r.raise_for_status()
                    raw.append(r.content)
                except Exception as e:
                    logger.warning("Could not fetch ICS feed %s: %s", url[:60], e)
        _ics_cache.update({"at": now, "urls": ",".join(urls), "raw": raw})

    import icalendar
    import recurring_ical_events

    window_start = (start or datetime.now()).date() - timedelta(days=1)
    window_end = (end or datetime.now() + timedelta(days=60)).date() + timedelta(days=1)

    events = []
    ext_id = 0
    for raw in _ics_cache["raw"]:
        try:
            cal = icalendar.Calendar.from_ical(raw)
            for occurrence in recurring_ical_events.of(cal).between(window_start, window_end):
                dtstart = occurrence.get("DTSTART")
                if dtstart is None:
                    continue
                value = dtstart.dt
                all_day = not isinstance(value, datetime)
                if isinstance(value, datetime):
                    if value.tzinfo is not None:
                        value = value.replace(tzinfo=None)  # keep the event's own wall-clock time
                else:
                    value = datetime(value.year, value.month, value.day)
                ext_id -= 1
                events.append({
                    "id": ext_id,
                    "title": str(occurrence.get("SUMMARY", "Busy")),
                    "description": None,
                    "start": value.isoformat(),
                    "end": None,
                    "all_day": all_day,
                    "color": "#8b5cf6",
                    "created_by": "external",
                    "read_only": True,
                })
        except Exception as e:
            logger.warning("Could not parse ICS feed: %s", e)
    return events


class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    start: datetime
    end: Optional[datetime] = None
    all_day: bool = False
    color: Optional[str] = None


class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    all_day: Optional[bool] = None
    color: Optional[str] = None


def event_to_dict(e: CalendarEvent) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "description": e.description,
        "start": e.start.isoformat(),
        "end": e.end.isoformat() if e.end else None,
        "all_day": e.all_day,
        "color": e.color,
        "created_by": e.created_by,
        "synced": bool(e.ms_id),
    }


@router.get("/")
async def list_events(
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    db: Session = Depends(get_db),
):
    try:
        await sync_with_graph(db)
    except Exception as e:
        logger.warning("Graph sync failed: %s", e)

    query = db.query(CalendarEvent)
    if start:
        query = query.filter(CalendarEvent.start >= start)
    if end:
        query = query.filter(CalendarEvent.start < end)
    events = [event_to_dict(e) for e in query.order_by(CalendarEvent.start).all()]

    external = await get_external_events(db, start, end)
    if external:
        s_naive = start.replace(tzinfo=None) if start else None
        e_naive = end.replace(tzinfo=None) if end else None
        for ev in external:
            ev_start = datetime.fromisoformat(ev["start"])
            if (s_naive is None or ev_start >= s_naive) and (e_naive is None or ev_start < e_naive):
                events.append(ev)
        events.sort(key=lambda e: e["start"])
    return events


@feed_router.get("/feed.ics")
def calendar_feed(token: str, db: Session = Depends(get_db)):
    """Public ICS feed (token-protected) — subscribe from Google/Outlook so HomeHub
    events show up in your existing calendar apps."""
    from fastapi import Response
    import icalendar

    stored = db.query(Setting).filter(Setting.key == "calendar_feed_token").first()
    if not stored or not stored.value or token != stored.value:
        raise HTTPException(status_code=401, detail="Invalid feed token")

    cal = icalendar.Calendar()
    cal.add("prodid", "-//HomeHub//homehub//EN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "HomeHub")

    window_start = datetime.now() - timedelta(days=30)
    # Outlook-origin events stay out of the outbound feed (they're already in Outlook)
    events = (db.query(CalendarEvent)
              .filter(CalendarEvent.start >= window_start, CalendarEvent.created_by != "outlook")
              .order_by(CalendarEvent.start).all())
    for e in events:
        ev = icalendar.Event()
        ev.add("uid", f"homehub-event-{e.id}@homehub")
        ev.add("summary", e.title)
        if e.all_day:
            ev.add("dtstart", e.start.date())
        else:
            ev.add("dtstart", e.start)
            ev.add("dtend", e.end or (e.start + timedelta(hours=1)))
        if e.description:
            ev.add("description", e.description)
        cal.add_component(ev)

    return Response(content=cal.to_ical(), media_type="text/calendar",
                    headers={"Content-Disposition": "attachment; filename=homehub.ics"})


@router.post("/resync")
async def resync_feeds(db: Session = Depends(get_db)):
    """Drop caches and re-sync all feeds + the connected Outlook calendar now."""
    invalidate_ics_cache()
    try:
        await sync_with_graph(db, force=True)
    except Exception as e:
        logger.warning("Forced graph sync failed: %s", e)
    return {"ok": True}


@router.post("/", status_code=201)
async def create_event(data: EventCreate, source: str = "dashboard", db: Session = Depends(get_db)):
    import msgraph
    event = CalendarEvent(**data.model_dump(), created_by=source)
    db.add(event)
    db.commit()
    db.refresh(event)
    await msgraph.push_create(db, event)
    return event_to_dict(event)


@router.patch("/{event_id}")
async def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db)):
    import msgraph
    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    await msgraph.push_update(db, event)
    return event_to_dict(event)


@router.delete("/{event_id}")
async def delete_event(event_id: int, db: Session = Depends(get_db)):
    import msgraph
    event = db.query(CalendarEvent).filter(CalendarEvent.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    ms_id = event.ms_id
    db.delete(event)
    db.commit()
    if ms_id:
        await msgraph.push_delete(db, ms_id)
    return {"ok": True}
