import json
import httpx
from database import settings as env_settings

SYSTEM_PROMPT_TEMPLATE = """You are a home assistant. Parse the user's message into JSON actions.
Today is {today} ({weekday}).

A single message may contain SEVERAL items or requests (e.g. a shopping list). Return one action per item/request, in the order mentioned.
{locations_section}
Available actions:
- find_item: user wants to know where something is or if they have it
- add_item: user is adding a new item
- update_item: user is updating an existing item (quantity, location, notes)
- remove_item: user is removing/used up a physical inventory item (NOT chores, events, meals, locations, or people)
- list_items: user wants to see items in a category or location
- low_stock: user wants to see what's running low
- suggest_recipes: user asks what they can cook/make/eat with what they have (e.g. "what can I make tonight?")
- add_event: user wants to put something on the calendar (set "item" to the event title, "datetime" to ISO 8601 resolved from today's date)
- add_chore: user wants to CREATE a new chore/recurring task (set "item" to the chore title, "person" to the assignee if mentioned, "frequency" to once|daily|weekly|monthly)
- complete_chore: user says an existing chore is DONE (set "item" to the chore name, "person" to who did it if mentioned)
- unknown: anything else — questions, chit-chat, AND requests to edit/delete/rename events, chores, meals, locations, categories, or family members (a smarter assistant handles those; do NOT force them into the actions above)

Respond ONLY with valid JSON in this format (always a top-level "actions" array, even for one action):
{{
  "actions": [
    {{
      "action": "find_item",
      "item": "milk",
      "location": null,
      "suggested_location": null,
      "sublocation": null,
      "category": null,
      "quantity": null,
      "unit": null,
      "author": null,
      "description": null,
      "notes": null,
      "low_stock_threshold": null,
      "track_stock": null,
      "expires": null,
      "datetime": null,
      "person": null,
      "frequency": null,
      "confidence": 0.95
    }}
  ]
}}

For food items with a mentioned expiration/use-by date, set "expires" to the ISO date (YYYY-MM-DD) resolved from today's date.

Enrichment rules for add_item — fill out everything you can, the user shouldn't have to:
- ALWAYS set "category" to the best fit — prefer the known categories above, otherwise propose a sensible new one.
- Books, music, movies, games: set "author" to the author/artist/creator. Use your own knowledge when the user didn't say (e.g. The Hobbit -> J.R.R. Tolkien).
- Set "low_stock_threshold" (and "track_stock": true) when the user wants a restock warning ("warn me when we're down to 2").
- Put extra details the user gives into "description" or "notes".

Location rules for add_item:
- Set "location" ONLY when the user explicitly says where the item is or goes. Never guess into "location".
- "location" is always the ROOM. A spot inside a room goes into "sublocation" — if the user names a known spot ("put it in the spice pantry"), set location to its room and sublocation to the spot.
- A location mentioned once in a list ("... for the freezer") applies only to the item(s) it clearly refers to.
- When the user did NOT say where, set "suggested_location" to where that kind of item is usually stored — prefer one of the known locations above; otherwise propose a sensible new name (e.g. "Fridge" for milk, "Garage" for tools).

Examples (each -> the "actions" array):
- "where is my drill?" -> [{{"action": "find_item", "item": "drill", ...}}]
- "added 2 boxes of pasta to pantry shelf 1" -> [{{"action": "add_item", "item": "pasta", "location": "pantry", "sublocation": "shelf 1", "quantity": 2, "unit": "boxes", ...}}]
- "we're out of milk" -> [{{"action": "update_item", "item": "milk", "quantity": 0, ...}}]
- "just bought 2 gallons of milk" -> [{{"action": "add_item", "item": "milk", "quantity": 2, "unit": "gallons", ...}}]
- "bought milk, 2 dozen eggs, bread, and chicken for the freezer" -> [{{"action": "add_item", "item": "milk", "suggested_location": "Fridge", ...}}, {{"action": "add_item", "item": "eggs", "quantity": 2, "unit": "dozen", "suggested_location": "Fridge", ...}}, {{"action": "add_item", "item": "bread", "suggested_location": "Pantry", ...}}, {{"action": "add_item", "item": "chicken", "location": "freezer", ...}}]
- "picked up AA batteries" -> [{{"action": "add_item", "item": "AA batteries", "suggested_location": "Garage", "category": "Electronics", ...}}]
- "added the hobbit to the bookshelf" -> [{{"action": "add_item", "item": "The Hobbit", "author": "J.R.R. Tolkien", "category": "Books / Media", "location": "bookshelf", ...}}]
- "got abbey road on vinyl for the living room" -> [{{"action": "add_item", "item": "Abbey Road (vinyl)", "author": "The Beatles", "category": "Books / Media", "location": "living room", ...}}]
- "bought a 12 pack of paper towels, warn me when we're down to 3" -> [{{"action": "add_item", "item": "paper towels", "quantity": 12, "category": "Cleaning", "low_stock_threshold": 3, "track_stock": true, ...}}]
- "added chicken to the fridge, use by friday, and we're out of ketchup" -> [{{"action": "add_item", "item": "chicken", "location": "fridge", "expires": "{friday}", ...}}, {{"action": "update_item", "item": "ketchup", "quantity": 0, ...}}]
- "moved the drill to the garage" -> [{{"action": "update_item", "item": "drill", "location": "garage", ...}}]
- "throw out the broken toaster" -> [{{"action": "remove_item", "item": "toaster", ...}}]
- "what's running low?" -> [{{"action": "low_stock", ...}}]
- "what can I make for dinner tonight?" -> [{{"action": "suggest_recipes", ...}}]
- "add dentist appointment friday at 2pm" -> [{{"action": "add_event", "item": "Dentist appointment", "datetime": "{friday}T14:00:00", ...}}]
- "put soccer practice on the calendar for tomorrow 5:30" -> [{{"action": "add_event", "item": "Soccer practice", "datetime": "{tomorrow}T17:30:00", ...}}]
- "add a chore for Emma to water the plants every day" -> [{{"action": "add_chore", "item": "Water the plants", "person": "Emma", "frequency": "daily", ...}}]
- "new chore: take out the recycling weekly" -> [{{"action": "add_chore", "item": "Take out the recycling", "frequency": "weekly", ...}}]
- "I took out the trash" -> [{{"action": "complete_chore", "item": "trash", ...}}]
- "Emma finished feeding the dog" -> [{{"action": "complete_chore", "item": "feeding the dog", "person": "Emma", ...}}]
- "how are you?" / "what's on the calendar this week?" -> [{{"action": "unknown", ...}}]
- "cancel the dentist appointment" / "delete the water plants chore" / "reassign dishes to Sam" -> [{{"action": "unknown", ...}}]
- "add a location called Attic" / "rename the garage to Workshop" / "add Sam to the family" -> [{{"action": "unknown", ...}}]
"""


def get_system_prompt(locations: list[str] | None = None, family: list[str] | None = None,
                      categories: list[str] | None = None) -> str:
    from datetime import date, timedelta
    today = date.today()
    friday = today + timedelta(days=((4 - today.weekday()) % 7) or 7)
    locations_section = ""
    if locations:
        locations_section += "\nKnown storage locations in this home: " + ", ".join(locations) + ".\n"
    if categories:
        locations_section += "Known item categories: " + ", ".join(categories) + ".\n"
    if family:
        locations_section += "Family members (use for \"person\"): " + ", ".join(family) + ".\n"
    return SYSTEM_PROMPT_TEMPLATE.format(
        today=today.isoformat(),
        weekday=today.strftime("%A"),
        friday=friday.isoformat(),
        tomorrow=(today + timedelta(days=1)).isoformat(),
        locations_section=locations_section,
    )


def _db_setting(db, key: str, fallback: str = "") -> str:
    if db is None:
        return fallback
    from models import Setting
    row = db.query(Setting).filter(Setting.key == key).first()
    return (row.value or fallback) if row else fallback


def _normalize_actions(raw) -> list[dict]:
    """Accept whatever shape the model produced and return a list of action dicts.
    Small local models sometimes ignore the {"actions": [...]} wrapper."""
    if isinstance(raw, list):
        actions = raw
    elif isinstance(raw, dict):
        if isinstance(raw.get("actions"), list):
            actions = raw["actions"]
        elif raw.get("action"):
            actions = [raw]
        else:
            actions = []
    else:
        actions = []
    actions = [a for a in actions if isinstance(a, dict) and a.get("action")]
    return actions or [{"action": "unknown", "confidence": 0}]


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


async def _parse_ollama(user_message: str, host: str, model: str, system_prompt: str) -> dict:
    # Long shopping/book lists mean many JSON actions: allow time and tokens for all of them
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(
            f"{host}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "stream": False,
                "format": "json",
                "options": {"num_predict": 4096},
            },
        )
        r.raise_for_status()
        return json.loads(r.json()["message"]["content"])


async def _parse_openai_compat(user_message: str, api_key: str, model: str, system_prompt: str, base_url: str | None = None, json_mode: bool = True) -> dict:
    from openai import AsyncOpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    client = AsyncOpenAI(**kwargs)
    extra = {}
    if json_mode:  # LM Studio rejects response_format json_object; rely on the prompt there
        extra["response_format"] = {"type": "json_object"}
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        max_tokens=4096,  # a long shopping/book list produces many actions
        **extra,
    )
    return _extract_json(response.choices[0].message.content)


async def _parse_claude(user_message: str, api_key: str, model: str, system_prompt: str) -> dict:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=4096,  # a long shopping/book list produces many actions
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    return _extract_json(response.content[0].text)


NO_AI_NOTICE = ("No AI model is configured yet — set one up in Settings → AI Provider. "
                "Simple lookups still work: try 'where is <item>' or 'what's running low'.")


def _keyword_parse(message: str) -> list[dict]:
    """Best-effort intent guess with no LLM, so the app stays useful before AI setup."""
    import re
    text = message.lower().strip().rstrip("?.!")
    base = {"action": "unknown", "item": None, "location": None, "sublocation": None,
            "category": None, "quantity": None, "unit": None, "notes": None, "expires": None, "confidence": 0.3}

    if re.search(r"\b(low|running out|restock|out of stock)\b", text):
        return [{**base, "action": "low_stock"}]

    m = re.match(r"(?:where(?:'s| is| are)?|find|do we have|do i have|got any)\s+(?:my |the |any )?(.+)", text)
    if m:
        return [{**base, "action": "find_item", "item": m.group(1).strip()}]

    return [{**base, "no_ai": True}]


def _known_locations(db) -> list[str]:
    """Room names, with their sub-locations attached: 'Kitchen [spots: Spice Pantry]'."""
    if db is None:
        return []
    try:
        from models import Location
        rooms: dict[str, list[str]] = {}
        for loc in db.query(Location).order_by(Location.name).all():
            subs = rooms.setdefault(loc.name, [])
            if loc.sublocation:
                subs.append(loc.sublocation)
        return [name + (f" [spots: {', '.join(subs)}]" if subs else "")
                for name, subs in list(rooms.items())[:20]]
    except Exception:
        return []


def _known_family(db) -> list[str]:
    if db is None:
        return []
    try:
        from models import FamilyMember
        return [m.name for m in db.query(FamilyMember).order_by(FamilyMember.name).all()][:20]
    except Exception:
        return []


def _known_categories(db) -> list[str]:
    if db is None:
        return []
    try:
        from models import Category
        return [c.name for c in db.query(Category).order_by(Category.name).all()][:15]
    except Exception:
        return []


async def parse_message(user_message: str, db=None) -> list[dict]:
    """Parse a chat message into one or more action dicts."""
    try:
        provider = _db_setting(db, "llm_provider", env_settings.llm_provider)

        if provider in ("", "none"):
            return _keyword_parse(user_message)

        system_prompt = get_system_prompt(locations=_known_locations(db), family=_known_family(db),
                                          categories=_known_categories(db))

        if provider == "claude":
            api_key = _db_setting(db, "anthropic_api_key", env_settings.anthropic_api_key)
            model = _db_setting(db, "claude_model", env_settings.claude_model) or "claude-haiku-4-5-20251001"
            raw = await _parse_claude(user_message, api_key, model, system_prompt)

        elif provider == "openai":
            api_key = _db_setting(db, "openai_api_key", env_settings.openai_api_key)
            model = _db_setting(db, "openai_model", env_settings.openai_model) or "gpt-4o-mini"
            raw = await _parse_openai_compat(user_message, api_key, model, system_prompt)

        elif provider == "lmstudio":
            host = _db_setting(db, "lmstudio_host", env_settings.lmstudio_host)
            model = _db_setting(db, "lmstudio_model", env_settings.lmstudio_model) or "local-model"
            raw = await _parse_openai_compat(user_message, "lm-studio", model, system_prompt, base_url=f"{host}/v1", json_mode=False)

        else:  # ollama
            host = _db_setting(db, "ollama_host", env_settings.ollama_host)
            model = _db_setting(db, "ollama_model", env_settings.ollama_model)
            raw = await _parse_ollama(user_message, host, model, system_prompt)

        return _normalize_actions(raw)

    except Exception as e:
        return [{"action": "unknown", "error": str(e), "confidence": 0}]


async def generate_response(prompt: str, context: str = "", db=None) -> str:
    try:
        provider = _db_setting(db, "llm_provider", env_settings.llm_provider)
        if provider in ("", "none"):
            return NO_AI_NOTICE
        messages = []
        if context:
            messages.append({"role": "system", "content":
                "You are HomeHub, the family's friendly home assistant. Be warm and concise — replies "
                "may show in a small chat bubble or Telegram message. Use this live household data to "
                "answer questions about inventory, the calendar, meals, and chores:\n\n" + context})
        messages.append({"role": "user", "content": prompt})

        if provider == "claude":
            from anthropic import AsyncAnthropic
            api_key = _db_setting(db, "anthropic_api_key", env_settings.anthropic_api_key)
            model = _db_setting(db, "claude_model", env_settings.claude_model) or "claude-haiku-4-5-20251001"
            client = AsyncAnthropic(api_key=api_key)
            sys_msg = messages.pop(0)["content"] if messages[0]["role"] == "system" else None
            r = await client.messages.create(
                model=model, max_tokens=512,
                system=sys_msg or "",
                messages=messages,
            )
            return r.content[0].text

        elif provider in ("openai", "lmstudio"):
            from openai import AsyncOpenAI
            if provider == "openai":
                api_key = _db_setting(db, "openai_api_key", env_settings.openai_api_key)
                model = _db_setting(db, "openai_model", env_settings.openai_model) or "gpt-4o-mini"
                client = AsyncOpenAI(api_key=api_key)
            else:
                host = _db_setting(db, "lmstudio_host", env_settings.lmstudio_host)
                model = _db_setting(db, "lmstudio_model", env_settings.lmstudio_model) or "local-model"
                client = AsyncOpenAI(api_key="lm-studio", base_url=f"{host}/v1")
            r = await client.chat.completions.create(model=model, messages=messages, max_tokens=512)
            return r.choices[0].message.content

        else:  # ollama
            host = _db_setting(db, "ollama_host", env_settings.ollama_host)
            model = _db_setting(db, "ollama_model", env_settings.ollama_model)
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    f"{host}/api/chat",
                    json={"model": model, "messages": messages, "stream": False},
                )
                r.raise_for_status()
                return r.json()["message"]["content"]

    except Exception as e:
        return f"I couldn't process that right now. Error: {e}"
