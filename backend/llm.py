import httpx
import json
from database import settings

SYSTEM_PROMPT = """You are a home inventory assistant. Parse the user's message and return a JSON action.

Available actions:
- find_item: user wants to know where something is or if they have it
- add_item: user is adding a new item
- update_item: user is updating an existing item (quantity, location, notes)
- remove_item: user is removing/used up an item
- list_items: user wants to see items in a category or location
- low_stock: user wants to see what's running low
- unknown: cannot determine intent

Respond ONLY with valid JSON in this format:
{
  "action": "find_item",
  "item": "milk",
  "location": null,
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
- "do we have coffee?" -> {"action": "find_item", "item": "coffee", ...}
- "what's running low?" -> {"action": "low_stock", ...}
"""


async def parse_message(user_message: str) -> dict:
    """Send a message to Ollama and get a structured action back."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.ollama_host}/api/chat",
                json={
                    "model": settings.ollama_model,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_message},
                    ],
                    "stream": False,
                    "format": "json",
                },
            )
            response.raise_for_status()
            content = response.json()["message"]["content"]
            return json.loads(content)
    except Exception as e:
        return {"action": "unknown", "error": str(e), "confidence": 0}


async def generate_response(prompt: str, context: str = "") -> str:
    """Generate a friendly natural language response."""
    try:
        messages = []
        if context:
            messages.append({"role": "system", "content": f"Home inventory context:\n{context}"})
        messages.append({"role": "user", "content": prompt})

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.ollama_host}/api/chat",
                json={
                    "model": settings.ollama_model,
                    "messages": messages,
                    "stream": False,
                },
            )
            response.raise_for_status()
            return response.json()["message"]["content"]
    except Exception as e:
        return f"I couldn't process that right now. Error: {e}"
