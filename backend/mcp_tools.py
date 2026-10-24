"""Stdio MCP server that hands HomeHub's agent tools to Codex.

Codex launches this per conversation (see codex_brain._bridge_args). It speaks the
small slice of MCP that tool calling needs — initialize, tools/list, tools/call —
as newline-delimited JSON-RPC, and dispatches every call to agent.execute_tool, so
the tool list and behavior stay identical to the local-model agent.

stdout is the protocol channel: nothing else may print to it."""
import asyncio
import json
import logging
import os
import sys

logging.basicConfig(stream=sys.stderr, level=logging.WARNING)

from agent import TOOLS, execute_tool  # noqa: E402
from database import SessionLocal  # noqa: E402

SOURCE = os.environ.get("HOMEHUB_SOURCE") or "emerald"
CALL_LOG = os.environ.get("HOMEHUB_CALL_LOG")
READ_ONLY_TOOLS = {"find_items", "list_locations", "list_categories", "list_family",
                   "list_events", "list_chores", "list_meals", "find_recipes", "get_recipe"}
PROTOCOL_VERSION = "2025-06-18"

MCP_TOOLS = [{"name": t["function"]["name"],
              "description": t["function"]["description"],
              "inputSchema": t["function"]["parameters"]} for t in TOOLS]


def _send(message: dict):
    sys.stdout.write(json.dumps(message, default=str) + "\n")
    sys.stdout.flush()


def _result(msg_id, result: dict):
    _send({"jsonrpc": "2.0", "id": msg_id, "result": result})


def _call_tool(name: str, args: dict) -> dict:
    db = SessionLocal()
    try:
        result = asyncio.run(execute_tool(name, args or {}, db, SOURCE))
    finally:
        db.close()
    text = result if isinstance(result, str) else json.dumps(result, default=str)
    is_error = isinstance(result, str) and result.startswith(("Tool error:", "Unknown tool:", "Missing required"))
    if CALL_LOG and not is_error and name not in READ_ONLY_TOOLS:
        with open(CALL_LOG, "a", encoding="utf-8") as f:
            f.write(text.replace("\n", " ")[:300] + "\n")
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        msg_id, method = msg.get("id"), msg.get("method")
        params = msg.get("params") or {}

        if method == "initialize":
            _result(msg_id, {"protocolVersion": params.get("protocolVersion", PROTOCOL_VERSION),
                             "capabilities": {"tools": {}},
                             "serverInfo": {"name": "homehub", "version": "1.0"}})
        elif method == "tools/list":
            _result(msg_id, {"tools": MCP_TOOLS})
        elif method == "tools/call":
            try:
                _result(msg_id, _call_tool(params.get("name", ""), params.get("arguments") or {}))
            except Exception as e:  # noqa: BLE001 — report to the model, keep serving
                _result(msg_id, {"content": [{"type": "text", "text": f"Tool error: {e}"}], "isError": True})
        elif msg_id is not None:  # ping and anything else that expects a reply
            _result(msg_id, {})


if __name__ == "__main__":
    main()
