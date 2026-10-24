"""Locations as a tree: a room at the top, then spots inside it to any depth —
Office › Bookshelf › Right side › Third shelf up. Shared by the API, chat, and Emerald's tools."""
import re
from collections import defaultdict

from sqlalchemy.orm import Session

from models import Item, Location, Setting

SEP = " › "
SPLIT_RE = re.compile(r"\s*(?:›|>|→|/|\\|,)\s*")


def split_path(text: str | None) -> list[str]:
    """'Office > Bookshelf, right side' -> ['Office', 'Bookshelf', 'right side']"""
    return [p.strip() for p in SPLIT_RE.split(text or "") if p.strip()]


def tidy(name: str) -> str:
    """'third shelf up' -> 'Third shelf up'; typed capitals are kept as written."""
    name = re.sub(r"\s+", " ", name.strip())
    return name[:1].upper() + name[1:] if name == name.lower() else name


def path_of(loc: Location | None) -> list[Location]:
    chain, seen = [], set()
    while loc is not None and loc.id not in seen:   # seen guards against a bad cycle
        seen.add(loc.id)
        chain.append(loc)
        loc = loc.parent
    return list(reversed(chain))


def path_str(loc: Location | None, sep: str = SEP) -> str:
    return sep.join(l.name for l in path_of(loc))


def room_of(loc: Location | None) -> Location | None:
    chain = path_of(loc)
    return chain[0] if chain else None


def children_map(db: Session) -> dict[int | None, list[Location]]:
    kids: dict[int | None, list[Location]] = defaultdict(list)
    for loc in db.query(Location).order_by(Location.name).all():
        kids[loc.parent_id].append(loc)
    return kids


def descendant_ids(db: Session, loc_id: int, kids: dict | None = None) -> set[int]:
    kids = kids if kids is not None else children_map(db)
    out, stack = {loc_id}, [loc_id]
    while stack:
        for child in kids.get(stack.pop(), []):
            if child.id not in out:
                out.add(child.id)
                stack.append(child.id)
    return out


def tree_order(db: Session) -> list[tuple[Location, int]]:
    """Every location depth-first, siblings A to Z, with its depth (0 = room)."""
    kids = children_map(db)
    out: list[tuple[Location, int]] = []

    def walk(parent_id, depth):
        for loc in sorted(kids.get(parent_id, []), key=lambda l: l.name.lower()):
            out.append((loc, depth))
            walk(loc.id, depth + 1)
    walk(None, 0)
    return out


def _find_child(db: Session, parent_id: int | None, name: str) -> Location | None:
    q = db.query(Location).filter(Location.parent_id.is_(None) if parent_id is None else Location.parent_id == parent_id)
    return (q.filter(Location.name.ilike(name)).first()
            or q.filter(Location.name.ilike(f"%{name}%")).order_by(Location.name).first())


def resolve_path(db: Session, segments: list[str], create: bool = True) -> Location | None:
    """Walk (and, when allowed, create) a path like ['office', 'bookshelf', 'right side'].
    The first segment is a room — or, when no room matches, any known spot by that name
    ('put it in the spice pantry')."""
    if not segments:
        return None
    first, rest = segments[0], segments[1:]
    current = _find_child(db, None, first)
    if current is None:
        spot = (db.query(Location).filter(Location.name.ilike(first)).first()
                or db.query(Location).filter(Location.name.ilike(f"%{first}%")).first())
        if spot is not None:
            current = spot
        elif create:
            current = Location(name=tidy(first))
            db.add(current)
            db.flush()
        else:
            return None
    for seg in rest:
        child = _find_child(db, current.id, seg)
        if child is None:
            if not create:
                return current
            child = Location(name=tidy(seg), parent_id=current.id)
            db.add(child)
            db.flush()
        current = child
    return current


def location_dict(loc: Location, depth: int, direct: dict[int, int], kids: dict) -> dict:
    ids = descendant_ids(None, loc.id, kids)
    return {
        "id": loc.id, "name": loc.name, "parent_id": loc.parent_id, "icon": loc.icon,
        "description": loc.description, "depth": depth,
        "path": [l.name for l in path_of(loc)], "path_label": path_str(loc),
        "item_count": direct.get(loc.id, 0),
        "total_count": sum(direct.get(i, 0) for i in ids),
        "child_count": len(kids.get(loc.id, [])),
    }


def migrate_to_tree(db: Session) -> None:
    """One-time upgrade from flat rows ('Kitchen' + spot 'Pantry', 'Kitchen' + spot
    'Fridge', …) to one Kitchen room with Pantry and Fridge inside it. Same-named
    rooms and spots are merged; items keep pointing at the same place."""
    if db.query(Setting).filter_by(key="locations_tree").first():
        return
    rows = db.query(Location).order_by(Location.id).all()
    roots: dict[str, Location] = {}
    spots: dict[tuple[int, str], Location] = {}
    gone: set[int] = set()

    def merge(src: Location, dst: Location):
        db.query(Item).filter(Item.location_id == src.id).update({Item.location_id: dst.id})
        db.query(Location).filter(Location.parent_id == src.id).update({Location.parent_id: dst.id})
        if not dst.icon and src.icon:
            dst.icon = src.icon
        gone.add(src.id)
        db.delete(src)

    for loc in rows:   # plain rows become rooms
        if loc.parent_id is None and not (loc.sublocation or "").strip():
            key = loc.name.strip().lower()
            if key in roots:
                merge(loc, roots[key])
            else:
                roots[key] = loc
    db.flush()
    for loc in rows:   # rows with a spot move under their room
        sub = (loc.sublocation or "").strip()
        if loc.id in gone or loc.parent_id is not None or not sub:
            continue
        key = loc.name.strip().lower()
        root = roots.get(key)
        if root is None:
            root = Location(name=loc.name.strip(), icon=loc.icon)
            db.add(root)
            db.flush()
            roots[key] = root
        twin = spots.get((root.id, sub.lower()))
        if twin is not None:
            merge(loc, twin)
            continue
        loc.parent_id, loc.name, loc.sublocation = root.id, sub, None
        spots[(root.id, sub.lower())] = loc
    # Spots inherited the room's emoji in the flat model: the room keeps it, the spots drop it
    for (root_id, _), spot in spots.items():
        root = next(r for r in roots.values() if r.id == root_id)
        if spot.icon and not root.icon:
            root.icon = spot.icon
        if spot.icon and spot.icon == root.icon:
            spot.icon = None
    db.add(Setting(key="locations_tree", value="true"))
    db.commit()
