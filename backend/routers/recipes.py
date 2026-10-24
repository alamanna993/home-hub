"""Recipes: the family cookbook. Soft-deleted recipes stay restorable for 30 days;
each recipe is matched against the food in the inventory ("6 of 8 on hand")."""
import html
import json
import math
import re
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session

from database import get_db
from models import MealPlan, Recipe

router = APIRouter(prefix="/recipes", tags=["recipes"])

TRASH_DAYS = 30
MEAL_TYPES = ("breakfast", "lunch", "dinner", "snack")


class RecipeIn(BaseModel):
    title: str
    description: Optional[str] = None
    servings: Optional[str] = None
    prep_minutes: Optional[int] = None
    cook_minutes: Optional[int] = None
    ingredients: list[str] = []
    steps: list[str] = []
    tags: list[str] = []
    cuisine: Optional[str] = None
    source_url: Optional[str] = None
    image_url: Optional[str] = None
    notes: Optional[str] = None
    favorite: bool = False


class RecipeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    servings: Optional[str] = None
    prep_minutes: Optional[int] = None
    cook_minutes: Optional[int] = None
    ingredients: Optional[list[str]] = None
    steps: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    cuisine: Optional[str] = None
    source_url: Optional[str] = None
    image_url: Optional[str] = None
    notes: Optional[str] = None
    favorite: Optional[bool] = None


class ImportRequest(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None  # pasted recipe text, for sites that don't allow apps to read them


class PlanRequest(BaseModel):
    date: date
    meal_type: str = "dinner"


# ---------------------------------------------------------------------------
# Pantry match — which ingredient lines the house already has
# ---------------------------------------------------------------------------
STAPLES = ("salt", "pepper", "water", "ice", "cooking spray", "nonstick spray")
WORD_RE = re.compile(r"[a-z]+")


def _singular(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("oes", "ches", "shes", "sses")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def _tokens(text: str) -> set[str]:
    return {_singular(w) for w in WORD_RE.findall(text.lower())}


def _clean(values) -> list[str]:
    return [v.strip() for v in (values or []) if isinstance(v, str) and v.strip()]


def is_heading(line: str) -> bool:
    """'For the sauce:' groups the lines under it — not an ingredient itself."""
    return line.rstrip().endswith(":") and len(line) < 60


def pantry_match(ingredients: list[str], food: list) -> list[dict]:
    keyed = []
    for item in food:
        tokens = _tokens(item.name) - {"fresh", "organic", "large", "small", "bag", "box", "can"}
        if tokens:
            keyed.append((tokens, item))
    keyed.sort(key=lambda pair: -len(pair[0]))  # "chicken breast" beats "chicken"

    lines = []
    for line in ingredients:
        if is_heading(line):
            lines.append({"text": line, "status": "heading"})
            continue
        words = _tokens(line)
        hit = next((item for tokens, item in keyed if tokens <= words), None)
        if hit:
            loc = hit.location
            where = (loc.name + (f" / {loc.sublocation}" if loc.sublocation else "")) if loc else None
            lines.append({"text": line, "status": "have", "item": hit.name, "location": where})
        elif any(re.search(rf"\b{s}\b", line.lower()) for s in STAPLES):
            lines.append({"text": line, "status": "staple"})
        else:
            lines.append({"text": line, "status": "missing"})
    return lines


def pantry_summary(lines: list[dict]) -> dict:
    counted = [l for l in lines if l["status"] in ("have", "missing")]
    have = sum(1 for l in counted if l["status"] == "have")
    return {"have": have, "total": len(counted),
            "missing": [l["text"] for l in counted if l["status"] == "missing"]}


def _food(db: Session) -> list:
    from routers.chat import get_food_inventory
    return get_food_inventory(db)


# ---------------------------------------------------------------------------
def recipe_to_dict(r: Recipe, pantry: list[dict] | None = None) -> dict:
    total = (r.prep_minutes or 0) + (r.cook_minutes or 0)
    out = {
        "id": r.id, "title": r.title, "description": r.description, "servings": r.servings,
        "prep_minutes": r.prep_minutes, "cook_minutes": r.cook_minutes, "total_minutes": total or None,
        "ingredients": r.ingredients or [], "steps": r.steps or [], "tags": r.tags or [],
        "cuisine": r.cuisine, "source_url": r.source_url, "image_url": r.image_url, "notes": r.notes,
        "favorite": bool(r.favorite), "created_by": r.created_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "deleted_at": r.deleted_at.isoformat() if r.deleted_at else None,
    }
    if r.deleted_at:
        purge_on = r.deleted_at + timedelta(days=TRASH_DAYS)
        out["days_left"] = max(0, math.ceil((purge_on - datetime.utcnow()).total_seconds() / 86400))
    if pantry is not None:
        out["pantry"] = pantry_summary(pantry)
    return out


def purge_expired(db: Session) -> int:
    cutoff = datetime.utcnow() - timedelta(days=TRASH_DAYS)
    expired = db.query(Recipe).filter(Recipe.deleted_at.isnot(None), Recipe.deleted_at < cutoff).all()
    for r in expired:
        db.query(MealPlan).filter(MealPlan.recipe_id == r.id).update({MealPlan.recipe_id: None})
        db.delete(r)
    if expired:
        db.commit()
    return len(expired)


def live_recipes(db: Session):
    return db.query(Recipe).filter(Recipe.deleted_at.is_(None))


def search_recipes(db: Session, q: str | None = None, tag: str | None = None) -> list[Recipe]:
    query = live_recipes(db)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Recipe.title.ilike(like), Recipe.description.ilike(like),
                                 Recipe.cuisine.ilike(like), cast(Recipe.tags, String).ilike(like),
                                 cast(Recipe.ingredients, String).ilike(like)))
    recipes = query.all()
    if tag:
        recipes = [r for r in recipes if tag.lower() in (t.lower() for t in (r.tags or []))]
    return recipes


def get_live(db: Session, recipe_id: int) -> Recipe:
    r = live_recipes(db).filter(Recipe.id == recipe_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return r


def _apply(r: Recipe, data: dict):
    for field, value in data.items():
        if field in ("ingredients", "steps", "tags"):
            value = _clean(value)
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(r, field, value)
    if not r.title:
        raise HTTPException(status_code=400, detail="A recipe needs a title")


# ---------------------------------------------------------------------------
@router.get("/")
def list_recipes(q: Optional[str] = None, tag: Optional[str] = None, sort: str = "recent",
                 db: Session = Depends(get_db)):
    food = _food(db)
    rows = [recipe_to_dict(r, pantry_match(r.ingredients or [], food)) for r in search_recipes(db, q, tag)]
    if sort == "title":
        rows.sort(key=lambda r: r["title"].lower())
    elif sort == "cookable":
        rows.sort(key=lambda r: (-(r["pantry"]["have"] / r["pantry"]["total"]) if r["pantry"]["total"] else 0,
                                 len(r["pantry"]["missing"])))
    elif sort == "quick":
        rows.sort(key=lambda r: r["total_minutes"] or 10_000)
    else:
        rows.sort(key=lambda r: r["updated_at"] or "", reverse=True)
    return rows


@router.get("/trash")
def list_trash(db: Session = Depends(get_db)):
    purge_expired(db)
    rows = (db.query(Recipe).filter(Recipe.deleted_at.isnot(None))
            .order_by(Recipe.deleted_at.desc()).all())
    return [recipe_to_dict(r) for r in rows]


@router.post("/import")
async def import_recipe(data: ImportRequest, db: Session = Depends(get_db)):
    """Read a recipe web page (or pasted text) into a draft — not saved — for the editor."""
    if data.text and data.text.strip():
        return await draft_from_text(data.text, db, source_url=(data.url or "").strip() or None)
    if not data.url:
        raise HTTPException(status_code=400, detail="Paste a recipe link or the recipe text")
    return await fetch_recipe_draft(data.url, db)


@router.get("/{recipe_id}")
def get_recipe(recipe_id: int, db: Session = Depends(get_db)):
    r = get_live(db, recipe_id)
    lines = pantry_match(r.ingredients or [], _food(db))
    out = recipe_to_dict(r, lines)
    out["pantry_lines"] = lines
    out["planned"] = [{"id": m.id, "date": m.date.isoformat(), "meal_type": m.meal_type}
                      for m in db.query(MealPlan).filter(MealPlan.recipe_id == r.id, MealPlan.date >= date.today())
                      .order_by(MealPlan.date).all()]
    return out


@router.post("/", status_code=201)
def create_recipe(data: RecipeIn, source: str = "dashboard", db: Session = Depends(get_db)):
    r = Recipe(created_by=source)
    _apply(r, data.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return recipe_to_dict(r)


@router.patch("/{recipe_id}")
def update_recipe(recipe_id: int, data: RecipeUpdate, db: Session = Depends(get_db)):
    r = get_live(db, recipe_id)
    _apply(r, data.model_dump(exclude_unset=True))
    db.commit()
    db.refresh(r)
    return recipe_to_dict(r)


@router.delete("/{recipe_id}")
def delete_recipe(recipe_id: int, db: Session = Depends(get_db)):
    """Move to Recently deleted — restorable for 30 days, then purged."""
    r = get_live(db, recipe_id)
    r.deleted_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "id": r.id, "restorable_days": TRASH_DAYS}


@router.post("/{recipe_id}/restore")
def restore_recipe(recipe_id: int, db: Session = Depends(get_db)):
    r = db.query(Recipe).filter(Recipe.id == recipe_id, Recipe.deleted_at.isnot(None)).first()
    if not r:
        raise HTTPException(status_code=404, detail="That recipe isn't in Recently deleted")
    r.deleted_at = None
    db.commit()
    db.refresh(r)
    return recipe_to_dict(r)


@router.post("/{recipe_id}/plan", status_code=201)
def plan_recipe(recipe_id: int, data: PlanRequest, db: Session = Depends(get_db)):
    r = get_live(db, recipe_id)
    if data.meal_type not in MEAL_TYPES:
        raise HTTPException(status_code=400, detail=f"meal_type must be one of {MEAL_TYPES}")
    meal = MealPlan(date=data.date, meal_type=data.meal_type, title=r.title, recipe_id=r.id)
    db.add(meal)
    db.commit()
    db.refresh(meal)
    from routers.meals import meal_to_dict
    return meal_to_dict(meal)


# ---------------------------------------------------------------------------
# Import from a web page: schema.org JSON-LD first (most recipe sites publish it),
# otherwise Emerald reads the page text.
# ---------------------------------------------------------------------------
LD_JSON_RE = re.compile(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", re.S | re.I)
DURATION_RE = re.compile(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?", re.I)
TAG_RE = re.compile(r"<[^>]+>")
UA = "HomeHub/1.0 (family recipe import; self-hosted)"
BLOCKED_HINT = ("That site doesn't let apps read its pages. Copy the recipe from the page and "
                "paste it under Paste text instead.")


def _text(value) -> str:
    return html.unescape(TAG_RE.sub("", str(value or ""))).replace("\xa0", " ").strip()


def _minutes(value) -> int | None:
    m = DURATION_RE.fullmatch(str(value or "").strip())
    if not m or not any(m.groups()):
        return None
    d, h, mins = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mins or None


def _find_recipe_node(node):
    if isinstance(node, list):
        for child in node:
            found = _find_recipe_node(child)
            if found:
                return found
    elif isinstance(node, dict):
        kind = node.get("@type")
        if kind == "Recipe" or (isinstance(kind, list) and "Recipe" in kind):
            return node
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in node:
                found = _find_recipe_node(node[key])
                if found:
                    return found
    return None


def _instructions(value) -> list[str]:
    if isinstance(value, str):
        return [l for l in (_text(x) for x in re.split(r"\n+|(?<=\.)\s{2,}", value)) if l]
    steps = []
    for entry in value or []:
        if isinstance(entry, str):
            steps.append(_text(entry))
        elif isinstance(entry, dict):
            if entry.get("@type") == "HowToSection" or "itemListElement" in entry:
                if entry.get("name"):
                    steps.append(_text(entry["name"]).rstrip(":") + ":")
                steps.extend(_instructions(entry.get("itemListElement")))
            else:
                steps.append(_text(entry.get("text") or entry.get("name")))
    return [s for s in steps if s]


def _image(value) -> str | None:
    if isinstance(value, list):
        value = value[0] if value else None
    if isinstance(value, dict):
        value = value.get("url")
    return str(value) if value else None


def _listish(value) -> list[str]:
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return [_text(v) for v in (value or []) if _text(v)]


def recipe_from_ld(node: dict, url: str) -> dict:
    prep, cook, total = (_minutes(node.get(k)) for k in ("prepTime", "cookTime", "totalTime"))
    if cook is None and total and prep:
        cook = max(total - prep, 0) or None
    if cook is None and prep is None and total:
        cook = total
    servings = node.get("recipeYield")
    if isinstance(servings, list):
        servings = next((s for s in servings if isinstance(s, str) and not s.isdigit()), servings[0] if servings else None)
    authors = node.get("author") or []
    authors = {(_text(a.get("name")) if isinstance(a, dict) else _text(a)).lower()
               for a in (authors if isinstance(authors, list) else [authors])}
    tags = []
    for key in ("recipeCategory", "keywords"):
        for t in _listish(node.get(key)):
            if t.lower() not in authors and t.lower() not in (x.lower() for x in tags):
                tags.append(t)
    cuisine = _listish(node.get("recipeCuisine"))
    return {
        "title": _text(node.get("name")) or "Untitled recipe",
        "description": _text(node.get("description")) or None,
        "servings": _text(servings) or None,
        "prep_minutes": prep, "cook_minutes": cook,
        "ingredients": [_text(i) for i in node.get("recipeIngredient") or [] if _text(i)],
        "steps": _instructions(node.get("recipeInstructions")),
        "tags": tags[:8], "cuisine": cuisine[0] if cuisine else None,
        "source_url": url, "image_url": _image(node.get("image")),
        "notes": None, "favorite": False,
    }


RECIPE_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "description", "servings", "prep_minutes", "cook_minutes",
                 "ingredients", "steps", "tags", "cuisine"],
    "properties": {
        "title": {"type": "string"}, "description": {"type": ["string", "null"]},
        "servings": {"type": ["string", "null"]},
        "prep_minutes": {"type": ["integer", "null"]}, "cook_minutes": {"type": ["integer", "null"]},
        "ingredients": {"type": "array", "items": {"type": "string"}},
        "steps": {"type": "array", "items": {"type": "string"}},
        "tags": {"type": "array", "items": {"type": "string"}},
        "cuisine": {"type": ["string", "null"]},
    },
}

STRUCTURE_PROMPT = """Extract the recipe from this text (a web page or something pasted) into JSON with keys: title, description,
servings, prep_minutes, cook_minutes, ingredients (one string per ingredient line, with amounts),
steps (one string per instruction, in order), tags (up to 6 short ones like "dinner", "vegetarian"),
cuisine. Use null when the page doesn't say. Copy ingredient amounts exactly; don't invent anything.
If the page holds no recipe, return title "" and empty lists."""


async def fetch_recipe_draft(url: str, db: Session) -> dict:
    import httpx
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Paste a full link that starts with https://")
    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True,
                                     headers={"User-Agent": UA, "Accept": "text/html"}) as client:
            r = await client.get(url)
            r.raise_for_status()
            page = r.text
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403, 429):
            raise HTTPException(status_code=400, detail=BLOCKED_HINT)
        raise HTTPException(status_code=400, detail=f"Couldn't open that page (error {e.response.status_code}).")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Couldn't open that page: {e}")

    for block in LD_JSON_RE.findall(page):
        try:
            data = json.loads(block.strip().replace("\n", " "), strict=False)
        except ValueError:
            continue
        node = _find_recipe_node(data)
        if node:
            draft = recipe_from_ld(node, str(r.url))
            if draft["ingredients"] or draft["steps"]:
                return {**draft, "imported_by": "page"}

    # No structured data — have Emerald read the page.
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(page, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer", "aside", "form"]):
        tag.decompose()
    main = soup.find("article") or soup.find("main") or soup.body or soup
    text = re.sub(r"\n{3,}", "\n\n", main.get_text("\n", strip=True))[:12000]
    if len(text) < 200:
        raise HTTPException(status_code=422, detail="That page doesn't seem to have a recipe on it.")
    og = soup.find("meta", property="og:image")
    return await draft_from_text(text, db, source_url=str(r.url), image_url=og.get("content") if og else None)


async def draft_from_text(text: str, db: Session, source_url: str | None = None,
                          image_url: str | None = None) -> dict:
    """Have Emerald structure free recipe text (pasted, or a page without recipe data)."""
    from llm import structured_json
    try:
        data = await structured_json(db, STRUCTURE_PROMPT, text[:12000], RECIPE_SCHEMA)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Emerald couldn't read that recipe: {e}")
    if not (data.get("title") and (data.get("ingredients") or data.get("steps"))):
        raise HTTPException(status_code=422, detail="Emerald didn't find a recipe in that text.")
    return {
        "title": data["title"], "description": data.get("description"), "servings": data.get("servings"),
        "prep_minutes": data.get("prep_minutes"), "cook_minutes": data.get("cook_minutes"),
        "ingredients": _clean(data.get("ingredients")), "steps": _clean(data.get("steps")),
        "tags": _clean(data.get("tags"))[:8], "cuisine": data.get("cuisine"),
        "source_url": source_url, "image_url": image_url,
        "notes": None, "favorite": False, "imported_by": "emerald",
    }


# ---------------------------------------------------------------------------
# Chat (Emerald) helpers — the agent tools in agent.py call these.
# ---------------------------------------------------------------------------
def find_by_title(db: Session, title: str) -> list[Recipe]:
    exact = live_recipes(db).filter(Recipe.title.ilike(title.strip())).all()
    return exact or live_recipes(db).filter(Recipe.title.ilike(f"%{title.strip()}%")).limit(5).all()


def recipe_brief(r: Recipe, db: Session) -> dict:
    summary = pantry_summary(pantry_match(r.ingredients or [], _food(db)))
    return {"id": r.id, "title": r.title, "total_minutes": ((r.prep_minutes or 0) + (r.cook_minutes or 0)) or None,
            "tags": r.tags or [], "on_hand": f"{summary['have']} of {summary['total']}",
            "missing": summary["missing"][:8]}


def ranked_for_tonight(db: Session, limit: int = 3) -> list[dict]:
    """Saved recipes that use the most of what's in the house."""
    food = _food(db)
    scored = []
    for r in live_recipes(db).all():
        s = pantry_summary(pantry_match(r.ingredients or [], food))
        if s["total"] and s["have"]:
            scored.append((s["have"] / s["total"], -len(s["missing"]), r, s))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [{"id": r.id, "title": r.title, "have": s["have"], "total": s["total"], "missing": s["missing"]}
            for _, _, r, s in scored[:limit]]
