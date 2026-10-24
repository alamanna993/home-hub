"""Codex as Emerald's brain — runs the Codex CLI (signed in with the family's ChatGPT
subscription) non-interactively. HomeHub's own tools reach Codex through a small stdio
MCP bridge (mcp_tools.py), so the agent can read and change the household database
without Codex getting a shell or file access."""
import asyncio
import json
import logging
import os
import re
import shutil
import sys
import tempfile
import time

logger = logging.getLogger("homehub-codex")

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
CODEX_BIN = os.environ.get("CODEX_BIN") or shutil.which("codex") or "codex"

PARSE_TIMEOUT = 60
CHAT_TIMEOUT = 90
AGENT_TIMEOUT = 150

# Everything Codex would use to act on a machine stays off — Emerald only talks and
# calls HomeHub's tools.
DISABLED_FEATURES = ("shell_tool", "unified_exec", "browser_use", "computer_use",
                     "image_generation", "plugins", "apps", "multi_agent", "memories")

# Env the MCP bridge needs to open the database (Codex doesn't pass the full environment)
BRIDGE_ENV_VARS = ("DATABASE_URL", "SECRET_KEY", "INTERNAL_API_KEY", "PATH", "HOME",
                   "SYSTEMROOT", "TEMP", "TMP")

_RUN_SLOTS = asyncio.Semaphore(3)  # a family can't need more parallel Codex runs than this


class CodexError(RuntimeError):
    pass


class CodexPartial(CodexError):
    """Codex failed after some HomeHub tools already ran — retrying on the backup
    brain would repeat those changes, so the caller reports what was done instead."""
    def __init__(self, message: str, done: list[str]):
        super().__init__(message)
        self.done = done


def _toml(value) -> str:
    """JSON string/array literals are valid TOML for the -c overrides we pass."""
    return json.dumps(value)


def _base_args(model: str | None, effort: str | None, workdir: str) -> list[str]:
    args = [CODEX_BIN, "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
            "--sandbox", "read-only", "-C", workdir, "--color", "never",
            "-c", 'web_search="disabled"']
    for feature in DISABLED_FEATURES:
        args += ["--disable", feature]
    if effort:
        args += ["-c", f"model_reasoning_effort={_toml(effort)}"]
    if model:
        args += ["-m", model]
    return args


def _bridge_args(source: str, call_log: str) -> list[str]:
    return [
        "-c", f"mcp_servers.homehub.command={_toml(sys.executable)}",
        "-c", f"mcp_servers.homehub.args={_toml([os.path.join(BACKEND_DIR, 'mcp_tools.py')])}",
        "-c", f"mcp_servers.homehub.cwd={_toml(BACKEND_DIR)}",
        "-c", 'mcp_servers.homehub.default_tools_approval_mode="approve"',
        "-c", "mcp_servers.homehub.tool_timeout_sec=60",
        "-c", f"mcp_servers.homehub.env={{HOMEHUB_SOURCE={_toml(source)}, HOMEHUB_CALL_LOG={_toml(call_log)}, PYTHONPATH={_toml(BACKEND_DIR)}}}",
        "-c", f"mcp_servers.homehub.env_vars={_toml([v for v in BRIDGE_ENV_VARS if v in os.environ])}",
    ]


async def _run(prompt: str, timeout: int, *, model: str | None, effort: str | None,
               schema: dict | None = None, source: str | None = None) -> str:
    if not await is_signed_in():
        raise CodexError("Codex isn't signed in — connect it in Settings → Emerald.")
    async with _RUN_SLOTS:
        with tempfile.TemporaryDirectory(prefix="codex-") as workdir:
            out_file = os.path.join(workdir, "last.txt")
            args = _base_args(model, effort, workdir)
            if schema is not None:
                schema_file = os.path.join(workdir, "schema.json")
                with open(schema_file, "w", encoding="utf-8") as f:
                    json.dump(schema, f)
                args += ["--output-schema", schema_file]
            call_log = os.path.join(workdir, "calls.log")
            if source is not None:
                args += _bridge_args(source, call_log)
            args += ["-o", out_file, "-"]

            proc = await asyncio.create_subprocess_exec(
                *args, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                _, stderr = await asyncio.wait_for(proc.communicate(prompt.encode("utf-8")), timeout)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                done = _read_call_log(call_log)
                if done:
                    raise CodexPartial(f"Codex took longer than {timeout}s", done)
                raise CodexError(f"Codex took longer than {timeout}s")

            text = ""
            if os.path.exists(out_file):
                with open(out_file, encoding="utf-8") as f:
                    text = f.read().strip()
            if proc.returncode != 0 or not text:
                message = _error_tail(stderr.decode("utf-8", "replace")) or f"Codex exited with code {proc.returncode}"
                done = _read_call_log(call_log)
                if done:
                    raise CodexPartial(message, done)
                raise CodexError(message)
            return text


def _read_call_log(path: str) -> list[str]:
    """Results of the tools that changed something during this run."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip()]


def _error_tail(stderr: str) -> str:
    lines = [l for l in stderr.splitlines()
             if re.search(r"error|limit|unauthor|expired|denied|failed", l, re.I)
             and "skills" not in l]
    return (lines[-1] if lines else "")[:300]


def _prompt(instructions: str, message: str) -> str:
    return f"{instructions}\n\n---\nThe family member's message:\n{message}"


async def codex_parse(system: str, message: str, schema: dict, *, model=None, effort=None) -> dict:
    text = await _run(_prompt(system, message), PARSE_TIMEOUT, model=model, effort=effort, schema=schema)
    try:
        return json.loads(text)
    except ValueError:
        from llm import _extract_json
        return _extract_json(text)


async def codex_chat(system: str, message: str, *, model=None, effort=None) -> str:
    return await _run(_prompt(system, message), CHAT_TIMEOUT, model=model, effort=effort)


async def codex_agent(system: str, message: str, source: str, *, model=None, effort=None) -> str:
    instructions = (system + "\n\nUse the `homehub` tools for anything that reads or changes household "
                    "data. You have no shell or file access — don't try. Reply in plain, friendly text.")
    try:
        return await _run(_prompt(instructions, message), AGENT_TIMEOUT, model=model, effort=effort, source=source)
    except CodexPartial as e:
        return (f"I got partway through that before Codex stopped ({e}). Done so far:\n"
                + "\n".join(f"- {line}" for line in e.done))


# ---------------------------------------------------------------------------
# Sign-in (ChatGPT device code) — the CLI keeps the tokens in CODEX_HOME.
# ---------------------------------------------------------------------------
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
CODE_RE = re.compile(r"\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b")
URL_RE = re.compile(r"https://\S+")

LOGIN: dict = {"status": "idle", "url": None, "code": None, "expires_at": None, "error": None}
_login_proc: asyncio.subprocess.Process | None = None
_status_cache: dict = {"at": 0.0, "signed_in": False, "detail": ""}


async def login_status(force: bool = False) -> dict:
    """{'signed_in': bool, 'detail': 'Logged in using ChatGPT'} — cached for a minute."""
    if not force and time.time() - _status_cache["at"] < 60:
        return {"signed_in": _status_cache["signed_in"], "detail": _status_cache["detail"]}
    try:
        proc = await asyncio.create_subprocess_exec(
            CODEX_BIN, "login", "status",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        out, _ = await asyncio.wait_for(proc.communicate(), 15)
        lines = [l for l in ANSI_RE.sub("", out.decode("utf-8", "replace")).splitlines()
                 if l.strip() and not l.startswith("WARNING")]
        signed_in = proc.returncode == 0
        detail = lines[-1].strip() if lines else ""
    except FileNotFoundError:
        signed_in, detail = False, "Codex CLI isn't installed in this container."
    except Exception as e:  # noqa: BLE001 — any failure just means "not ready"
        signed_in, detail = False, f"Couldn't check Codex sign-in: {e!r}"
    _status_cache.update(at=time.time(), signed_in=signed_in, detail=detail)
    return {"signed_in": signed_in, "detail": detail}


async def is_signed_in() -> bool:
    return (await login_status())["signed_in"]


async def start_login() -> dict:
    """Start `codex login --device-auth` and return the link + one-time code to show."""
    global _login_proc
    if _login_proc and _login_proc.returncode is None and LOGIN["status"] == "pending":
        return dict(LOGIN)
    LOGIN.update(status="starting", url=None, code=None, expires_at=None, error=None)
    try:
        _login_proc = await asyncio.create_subprocess_exec(
            CODEX_BIN, "login", "--device-auth",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    except FileNotFoundError:
        LOGIN.update(status="error", error="Codex CLI isn't installed in this container.")
        return dict(LOGIN)

    seen = ""
    try:
        while not (LOGIN["url"] and LOGIN["code"]):
            line = await asyncio.wait_for(_login_proc.stdout.readline(), 30)
            if not line:
                break
            text = ANSI_RE.sub("", line.decode("utf-8", "replace"))
            seen += text
            if not LOGIN["url"] and (m := URL_RE.search(text)):
                LOGIN["url"] = m.group(0).rstrip(".")
            if not LOGIN["code"] and (m := CODE_RE.search(text)):
                LOGIN["code"] = m.group(1)
    except asyncio.TimeoutError:
        pass

    if LOGIN["url"] and LOGIN["code"]:
        LOGIN.update(status="pending", expires_at=time.time() + 15 * 60)
        asyncio.get_running_loop().create_task(_finish_login(_login_proc))
    else:
        if _login_proc.returncode is None:
            _login_proc.kill()
        lines = [l for l in seen.splitlines() if l.strip() and not l.startswith("WARNING")]
        LOGIN.update(status="error", error=(lines[-1] if lines else "Codex didn't return a sign-in code.")[:300])
    return dict(LOGIN)


async def _finish_login(proc: asyncio.subprocess.Process):
    try:
        rest, _ = await asyncio.wait_for(proc.communicate(), 16 * 60)
    except asyncio.TimeoutError:
        proc.kill()
        LOGIN.update(status="error", error="The sign-in code expired. Start again.")
        return
    status = await login_status(force=True)
    if status["signed_in"]:
        LOGIN.update(status="signed_in", url=None, code=None, expires_at=None, error=None)
        from llm import reset_breaker
        reset_breaker()
    else:
        lines = [l for l in ANSI_RE.sub("", rest.decode("utf-8", "replace")).splitlines() if l.strip()]
        LOGIN.update(status="error", error=(lines[-1] if lines else "Sign-in didn't complete.")[:300])


async def logout() -> dict:
    try:
        proc = await asyncio.create_subprocess_exec(
            CODEX_BIN, "logout", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        await asyncio.wait_for(proc.communicate(), 15)
    except Exception as e:  # noqa: BLE001
        logger.warning("codex logout failed: %s", e)
    LOGIN.update(status="idle", url=None, code=None, expires_at=None, error=None)
    return await login_status(force=True)
