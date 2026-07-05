import json
import httpx
from database import settings as env_settings

SYSTEM_PROMPT = """You are a home inventory assistant. Parse the user's message and return a JSON action.

Available actions:
- find_item: user wants to know where something is or if they have it
- add_item: user is adding a new item
- update_item: user is updating an existing item (quantity, location, notes)
- remove_item: user is removing/used up an item
- list_items: user wants to see items in a category or location
- low_stock: user wants to see what's running low
- suggest_recipes: user asks what they can cook/make/eat with what they have (e.g. "what can I make tonight?")
- unknown: cannot determine intent

Respond ONLY with valid JSON in this format:
{
  "action": "find_item",
  "item": "milk",
  "location": null,
  "sublocation": null,
  "category": null,
  "quantity": null,
  "unit": null,
  "notes": null,
  "confidence": 0.95
}

Examples:
- "where is my drill?" -> {"action": "find_item", "item": "drill", ...}
- "added 2 boxes of pasta to pantry shelf 1" -> {"action": "add_item", "item": "pasta", "location": "pantry", "sublocation": "shelf 1", "quantity": 2, "unit": "boxes", ...}
- "we're out of milk" -> {"action": "update_item", "item": "milk", "quantity": 0, ...}
- "just bought 2 gallons of milk" -> {"action": "add_item", "item": "milk", "quantity": 2, "unit": "gallons", ...}
- "moved the drill to the garage" -> {"action": "update_item", "item": "drill", "location": "garage", ...}
- "throw out the broken toaster" -> {"action": "remove_item", "item": "toaster", ...}
- "do we have coffee?" -> {"action": "find_item", "item": "coffee", ...}
- "what's running low?" -> {"action": "low_stock", ...}
- "what can I make for dinner tonight?" -> {"action": "suggest_recipes", ...}
- "what should we cook with what we have?" -> {"action": "suggest_recipes", ...}
"""


def _db_setting(db, key: str, fallback: str = "") -> str:
    if db is None:
        return fallback
    from models import Setting
    row = db.query(Setting).filter(Setting.key == key).first()
    return (row.value or fallback) if row else fallback


def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


async def _parse_ollama(user_message: str, host: str, model: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{host}/api/chat",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                "stream": False,
                "format": "json",
            },
        )
        r.raise_for_status()
        return json.loads(r.json()["message"]["content"])


async def _parse_openai_compat(user_message: str, api_key: str, model: str, base_url: str | None = None, json_mode: bool = True) -> dict:
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
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        max_tokens=256,
        **extra,
    )
    return _extract_json(response.choices[0].message.content)


async def _parse_claude(user_message: str, api_key: str, model: str) -> dict:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=256,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )
    return _extract_json(response.content[0].text)


NO_AI_NOTICE = ("No AI model is configured yet — set one up in Settings → AI Provider. "
                "Simple lookups still work: try 'where is <item>' or 'what's running low'.")


def _keyword_parse(message: str) -> dict:
    """Best-effort intent guess with no LLM, so the app stays useful before AI setup."""
    import re
    text = message.lower().strip().rstrip("?.!")
    base = {"action": "unknown", "item": None, "location": None, "sublocation": None,
            "category": None, "quantity": None, "unit": None, "notes": None, "confidence": 0.3}

    if re.search(r"\b(low|running out|restock|out of stock)\b", text):
        return {**base, "action": "low_stock"}

    m = re.match(r"(?:where(?:'s| is| are)?|find|do we have|do i have|got any)\s+(?:my |the |any )?(.+)", text)
    if m:
        return {**base, "action": "find_item", "item": m.group(1).strip()}

    return {**base, "no_ai": True}


async def parse_message(user_message: str, db=None) -> dict:
    try:
        provider = _db_setting(db, "llm_provider", env_settings.llm_provider)

        if provider in ("", "none"):
            return _keyword_parse(user_message)

        if provider == "claude":
            api_key = _db_setting(db, "anthropic_api_key", env_settings.anthropic_api_key)
            model = _db_setting(db, "claude_model", env_settings.claude_model) or "claude-haiku-4-5-20251001"
            return await _parse_claude(user_message, api_key, model)

        elif provider == "openai":
            api_key = _db_setting(db, "openai_api_key", env_settings.openai_api_key)
            model = _db_setting(db, "openai_model", env_settings.openai_model) or "gpt-4o-mini"
            return await _parse_openai_compat(user_message, api_key, model)

        elif provider == "lmstudio":
            host = _db_setting(db, "lmstudio_host", env_settings.lmstudio_host)
            model = _db_setting(db, "lmstudio_model", env_settings.lmstudio_model) or "local-model"
            return await _parse_openai_compat(user_message, "lm-studio", model, base_url=f"{host}/v1", json_mode=False)

        else:  # ollama
            host = _db_setting(db, "ollama_host", env_settings.ollama_host)
            model = _db_setting(db, "ollama_model", env_settings.ollama_model)
            return await _parse_ollama(user_message, host, model)

    except Exception as e:
        return {"action": "unknown", "error": str(e), "confidence": 0}


async def generate_response(prompt: str, context: str = "", db=None) -> str:
    try:
        provider = _db_setting(db, "llm_provider", env_settings.llm_provider)
        if provider in ("", "none"):
            return NO_AI_NOTICE
        messages = []
        if context:
            messages.append({"role": "system", "content": f"Home inventory context:\n{context}"})
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
