"""Undo for Emerald.

Every create, edit and delete that happens while an Emerald request is being handled
is captured as the database flushes, so any tool (today's and tomorrow's) is undoable
without per-tool undo code. A request's changes are grouped into one ChangeSet that
Undo reverses as a unit, newest change first.

How it hooks in:
- `recording(source, label)` marks the current request. SQLAlchemy's flush events
  then snapshot tracked rows into a buffer on the session.
- The buffer is written when the session *commits* (a rolled-back action leaves no
  trace), using its own connection, so one request can commit several times.
- Codex runs HomeHub's tools in a separate process (mcp_tools.py). It gets the
  change-set id in HOMEHUB_CHANGESET and records into the same set.

Only changes made through the ORM are seen: Query.update()/delete() skip the flush
events, so recorded code paths use per-object loops instead."""
import contextvars
import logging
from contextlib import contextmanager
from datetime import date, datetime, timedelta

from sqlalchemy import event, inspect as sa_inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import Base, engine
from models import (CalendarEvent, Category, Chore, ChoreCompletion, ChangeRow, ChangeSet, FamilyMember,
                    Item, Location, MealPlan, Recipe, ShoppingItem)

logger = logging.getLogger("homehub-changes")

UNDO_WINDOW = timedelta(hours=24)
TRACKED = (Item, Location, Category, FamilyMember, CalendarEvent, MealPlan, Chore, ChoreCompletion,
           Recipe, ShoppingItem)
_BY_TABLE = {m.__tablename__: m for m in TRACKED}
_CURRENT: contextvars.ContextVar[int | None] = contextvars.ContextVar("homehub_changeset", default=None)
_IGNORED_ALONE = {"updated_at"}   # a touch of updated_at isn't a change worth undoing


def current_id() -> int | None:
    return _CURRENT.get()


def _ser(v):
    return v.isoformat() if isinstance(v, (datetime, date)) else v


def _de(col, v):
    if v is None:
        return None
    try:
        py = col.type.python_type
    except NotImplementedError:
        return v
    if py is datetime and isinstance(v, str):
        return datetime.fromisoformat(v)
    if py is date and isinstance(v, str):
        return date.fromisoformat(v)
    return v


def _snapshot(obj) -> dict:
    return {a.key: _ser(getattr(obj, a.key)) for a in sa_inspect(obj).mapper.column_attrs}


# ---------------------------------------------------------------------------
# Capturing changes as the session flushes
# ---------------------------------------------------------------------------
@event.listens_for(Session, "before_flush")
def _before_flush(session, flush_ctx, instances):
    if _CURRENT.get() is None:
        return
    buf = session.info.setdefault("cs_buf", [])
    for obj in session.new:
        if isinstance(obj, TRACKED):
            buf.append({"op": "create", "obj": obj, "table": obj.__tablename__})
    for obj in session.dirty:
        if not isinstance(obj, TRACKED) or not session.is_modified(obj, include_collections=False):
            continue
        before, after, unknown = {}, {}, []
        state = sa_inspect(obj)
        for col in state.mapper.column_attrs:
            h = state.attrs[col.key].history
            if h.has_changes():
                after[col.key] = _ser(getattr(obj, col.key))
                if h.deleted:
                    before[col.key] = _ser(h.deleted[0])
                else:
                    unknown.append(col.key)   # the old value wasn't loaded when it was overwritten
        if unknown:
            # Nothing has been flushed yet for this change, so the database still holds the old values
            table = obj.__table__
            row = session.execute(table.select().with_only_columns(*[table.c[k] for k in unknown])
                                  .where(table.c.id == obj.id)).first()
            for i, k in enumerate(unknown):
                before[k] = _ser(row[i]) if row is not None else None
        if not before or set(before) <= _IGNORED_ALONE:
            continue
        buf.append({"op": "update", "table": obj.__tablename__, "pk": obj.id, "before": before, "after": after})
    for obj in session.deleted:
        if isinstance(obj, TRACKED):
            buf.append({"op": "delete", "table": obj.__tablename__, "pk": obj.id, "before": _snapshot(obj)})


@event.listens_for(Session, "after_flush")
def _after_flush(session, flush_ctx):
    for entry in session.info.get("cs_buf", ()):
        obj = entry.pop("obj", None)
        if obj is not None:           # a created row now has its id
            entry["pk"] = obj.id
            entry["after"] = _snapshot(obj)


@event.listens_for(Session, "after_commit")
def _after_commit(session):
    buf = session.info.pop("cs_buf", None)
    cs_id = _CURRENT.get()
    if not buf or cs_id is None:
        return
    rows = [{"changeset_id": cs_id, "op": e["op"], "table_name": e["table"], "pk": e["pk"],
             "before": e.get("before"), "after": e.get("after")} for e in buf if "pk" in e]
    if not rows:
        return
    try:
        with engine.begin() as conn:     # its own connection: the request may commit many times
            conn.execute(ChangeRow.__table__.insert(), rows)
    except Exception:  # noqa: BLE001 — never fail the user's action because undo bookkeeping failed
        logger.exception("Couldn't record %s changes for undo", len(rows))


@event.listens_for(Session, "after_rollback")
def _after_rollback(session):
    session.info.pop("cs_buf", None)


# ---------------------------------------------------------------------------
# Marking a request
# ---------------------------------------------------------------------------
def start(source: str, label: str) -> tuple[int, contextvars.Token]:
    with engine.begin() as conn:
        res = conn.execute(ChangeSet.__table__.insert().returning(ChangeSet.id),
                           {"source": source, "label": (label or "")[:200], "created_at": datetime.utcnow()})
        cs_id = res.scalar_one()
    return cs_id, _CURRENT.set(cs_id)


def adopt(cs_id: int | None) -> None:
    """Record into a change set started by another process (the Codex tool bridge)."""
    if cs_id:
        _CURRENT.set(cs_id)


@contextmanager
def recording(source: str, label: str):
    """Everything changed inside this block can be undone together. Yields the set id."""
    cs_id, token = start(source, label)
    try:
        yield cs_id
    finally:
        _CURRENT.reset(token)


def finish(db: Session, cs_id: int) -> dict | None:
    """The change card for a request, or None (and the empty set removed) when nothing changed."""
    n = db.query(ChangeRow).filter(ChangeRow.changeset_id == cs_id).count()
    if n == 0:
        db.query(ChangeSet).filter(ChangeSet.id == cs_id).delete()
        db.commit()
        return None
    return describe(db, cs_id)


# ---------------------------------------------------------------------------
# Describing a set ("Added Dune", "Changed Garlic Powder: location")
# ---------------------------------------------------------------------------
_NAME_FIELD = {"items": "name", "locations": "name", "categories": "name", "family_members": "name",
               "calendar_events": "title", "meal_plans": "title", "chores": "title", "recipes": "title",
               "shopping_items": "name"}
_NOUN = {"items": "", "locations": "location ", "categories": "category ", "family_members": "",
         "calendar_events": "event ", "meal_plans": "meal ", "chores": "chore ", "recipes": "recipe ",
         "shopping_items": ""}


def describe(db: Session, cs_id: int) -> dict:
    cs = db.query(ChangeSet).filter(ChangeSet.id == cs_id).first()
    rows = db.query(ChangeRow).filter(ChangeRow.changeset_id == cs_id).order_by(ChangeRow.id).all()
    names: dict[tuple[str, int], str] = {}
    for r in rows:   # a name is known from whichever snapshot has the whole row
        snap = r.after if r.op == "create" else r.before if r.op == "delete" else None
        field = _NAME_FIELD.get(r.table_name)
        if snap and field and snap.get(field):
            names[(r.table_name, r.pk)] = snap[field]
    lines, seen = [], set()
    for r in rows:
        key = (r.op, r.table_name, r.pk)
        if key in seen:
            continue
        seen.add(key)
        if r.table_name == "chore_completions":
            chore_id = (r.after or r.before or {}).get("chore_id")
            chore = db.query(Chore).filter(Chore.id == chore_id).first()
            what = f"“{chore.title}”" if chore else "a chore"
            lines.append(("Checked off " if r.op == "create" else "Un-checked ") + what)
            continue
        name = names.get((r.table_name, r.pk))
        if name is None and r.op == "update":
            model = _BY_TABLE[r.table_name]
            obj = db.query(model).filter(model.id == r.pk).first()
            name = getattr(obj, _NAME_FIELD.get(r.table_name, "id"), None) if obj else None
        label = f"{_NOUN.get(r.table_name, '')}{name or '#' + str(r.pk)}".strip()
        if r.op == "create":
            lines.append(f"Added {label}")
        elif r.op == "delete":
            lines.append(f"Removed {label}")
        else:
            fields = ", ".join(f.replace("_id", "").replace("_", " ") for f in (r.after or {}) if f not in _IGNORED_ALONE)
            lines.append(f"Changed {label}" + (f" ({fields})" if fields else ""))
    return {"id": cs_id, "count": len(rows), "lines": lines[:8], "more": max(0, len(lines) - 8),
            "undone": bool(cs and cs.undone_at), "label": cs.label if cs else None}


# ---------------------------------------------------------------------------
# Undo
# ---------------------------------------------------------------------------
class UndoError(Exception):
    pass


def undo(db: Session, cs_id: int) -> dict:
    """Reverse a change set, newest change first. Returns what the caller must follow up
    on outside the database (calendar events that are mirrored to Outlook)."""
    cs = db.query(ChangeSet).filter(ChangeSet.id == cs_id).first()
    if not cs:
        raise UndoError("I can't find that change anymore.")
    if cs.undone_at:
        raise UndoError("That change was already undone.")
    if datetime.utcnow() - cs.created_at > UNDO_WINDOW:
        raise UndoError("That change is more than a day old, so it can't be undone from here.")
    rows = db.query(ChangeRow).filter(ChangeRow.changeset_id == cs_id).order_by(ChangeRow.id.desc()).all()

    # Outlook ids seen for each event, since a created event gets its id in a later write
    ms_ids: dict[int, set] = {}
    for r in rows:
        if r.table_name == "calendar_events":
            for snap in (r.before, r.after):
                if snap and snap.get("ms_id"):
                    ms_ids.setdefault(r.pk, set()).add(snap["ms_id"])

    outlook = {"delete_ms_ids": [], "recreate": [], "update": []}

    def run(stmt) -> bool:
        try:
            with db.begin_nested():
                db.execute(stmt)
            return True
        except IntegrityError:
            return False

    def apply(r: ChangeRow) -> bool:
        """Reverse one recorded change. False means a related row isn't back yet."""
        table = _BY_TABLE[r.table_name].__table__
        if r.op == "create":
            ok = run(table.delete().where(table.c.id == r.pk))
            if ok and r.table_name == "calendar_events":
                outlook["delete_ms_ids"] += sorted(ms_ids.get(r.pk, ()))
            return ok
        vals = {k: _de(table.c[k], v) for k, v in (r.before or {}).items() if k in table.c}
        if r.op == "update":
            if not vals:
                return True
            ok = run(table.update().where(table.c.id == r.pk).values(**vals))
            if ok and r.table_name == "calendar_events":
                outlook["update"].append(r.pk)
            return ok
        if db.execute(table.select().where(table.c.id == r.pk)).first():
            return True                      # already there
        ok = run(table.insert().values(**vals))
        if ok and r.table_name == "calendar_events":
            outlook["recreate"].append(r.pk)
        return ok

    # Newest change first. One that has to wait for a related row (a child whose parent
    # is re-created later in the pass) is retried, so order inside a flush doesn't matter.
    waiting = [r for r in rows if not apply(r)]
    for _ in range(4):
        if not waiting:
            break
        waiting = [r for r in waiting if not apply(r)]
    skipped = len(waiting)

    cs.undone_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "skipped": skipped, "outlook": outlook, "summary": describe(db, cs_id)}
