# HomeHub

Self-hosted family hub: home inventory, AI chat (local or cloud), meal planning, calendar, chore charts, and a Telegram bot — all in Docker, NAS-friendly.

- 📦 **Inventory** — every book, cable, and can of beans, organized by room and sub-location (Kitchen / Pantry Shelf 2, Basement, Office…)
- 💬 **AI Chat** — ask "where's my drill?" or "what can I make for dinner tonight?" from the web app or Telegram
- 🍽️ **Meal Planner** — plan the week's breakfasts, lunches, and dinners
- 📅 **Calendar** — family events on a month view
- ✅ **Chore Chart** — chores by person with daily/weekly/monthly check-offs
- 🤖 **Pluggable AI** — Ollama or LM Studio (local), OpenAI or Claude (cloud); switch providers from the Settings page without restarting
- 💾 **Redundant data** — Postgres data on a folder you choose (NAS share) plus automatic nightly SQL backups with retention

## Prerequisites

- Docker + Docker Compose (Docker Desktop, or Container Manager on Synology / equivalent on your NAS)
- For local AI: [Ollama](https://ollama.com) with a model pulled (`ollama pull llama3.2`), or LM Studio.
  For cloud AI: an OpenAI or Anthropic API key. You can also configure this later in **Settings**.

## Setup

1. Copy the env file and fill it in:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` — the important ones:
   - `DB_PASSWORD` — any strong password
   - `SECRET_KEY` — random string (`python -c "import secrets; print(secrets.token_hex(32))"`)
   - `TELEGRAM_BOT_TOKEN` — from @BotFather (optional, see below)
   - `LLM_PROVIDER` — `ollama` | `lmstudio` | `openai` | `claude`

3. Start everything:
   ```bash
   docker compose up -d
   ```
   Want the optional Discord bot too?
   ```bash
   docker compose --profile discord up -d
   ```

4. Open the dashboard: http://localhost:3000 — default login `admin` / `homehub` (change it in Settings).

## Where the data lives (NAS deployment)

Keep your data **outside** the containers so upgrades and rebuilds never touch it:

- `DATA_PATH` — host folder for the live Postgres database, e.g. `/volume1/docker/homehub/db`.
  Left unset, a Docker named volume is used (fine for testing, still survives `docker compose down`).
- `BACKUP_PATH` — the `db-backup` container drops nightly `pg_dump` backups here with rotation
  (7 daily / 4 weekly / 6 monthly by default). **Point this at a different disk or NAS share than
  `DATA_PATH`** — that's your redundancy if the primary volume dies.

Restore a backup:
```bash
zcat backups/daily/homehub-<date>.sql.gz | docker compose exec -T db psql -U homehub homehub
```

## AI Providers

Choose and configure the provider on the **Settings** page (admin) — or via `.env`:

| Provider | Type | Notes |
|----------|------|-------|
| Ollama | local | `OLLAMA_HOST` (default `http://host.docker.internal:11434`), any pulled model |
| LM Studio | local | OpenAI-compatible server on port 1234 |
| OpenAI | cloud | needs `OPENAI_API_KEY` |
| Claude | cloud | needs `ANTHROPIC_API_KEY` |

Changes made in Settings take effect immediately — no restart needed.

## Telegram Bot

1. Message **@BotFather** on Telegram → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`
2. `docker compose up -d telegram`
3. Send `/start` to your bot — it replies with your **chat ID**
4. Put that ID into `TELEGRAM_ALLOWED_CHAT_IDS` in `.env` (comma-separated for family members) and
   `docker compose up -d telegram` again — now only your family can use it

Then just talk to it:
- `where is my drill?`
- `added 2 boxes of pasta to pantry shelf 1`
- `we're out of milk`
- `what can I make for dinner tonight?`
- `/stats`, `/lowstock`, `/find drill`, `/help`

## Usage

### Dashboard (web app)
- **Dashboard** — stats, category pie chart, recent activity
- **Inventory** — browse, search, filter, add/edit/delete items
- **Locations** — rooms and sub-locations (Kitchen / Pantry, Basement / Storage Closet…)
- **Categories** — categories with icons and colors
- **Low Stock** — items that need restocking
- **Calendar** — month view of family events
- **Meals** — weekly meal planner, with a one-click "What can I make tonight?" AI shortcut
- **Chores** — chore chart grouped by person, check off as done (resets daily/weekly/monthly)
- **Chat** — ask the AI where things are or what to cook with what's in the house
- **Settings** — site title, AI provider + API keys, bot config, password

### "What can I make tonight?"
Ask in Chat or Telegram. HomeHub gathers everything stored in kitchen-ish locations
(Pantry, Fridge, Freezer) or food categories, sends it to your chosen AI, and answers with
meal ideas — including where each ingredient is stored.

## Discord Bot (optional)

The original Discord bot still works, behind a compose profile:

1. https://discord.com/developers/applications → **New Application** → **Bot** → copy the token into `DISCORD_TOKEN`
2. Enable **Message Content Intent**; invite with Send Messages / Read Message History / Embed Links
3. Copy your channel ID into `DISCORD_CHANNEL_ID`
4. `docker compose --profile discord up -d`

## Local Models

Any Ollama model works. Recommended:
- `llama3.2` — fast, good for structured parsing
- `mistral` — solid alternative
- `qwen2.5` — great multilingual support

Change the model anytime from **Settings → AI Provider**, or via `.env` + `docker compose restart backend`.

## Tablet Display

Point any browser in kiosk mode at `http://<your-server-ip>:3000`.
On Android: "Fully Kiosk Browser". On iPad: Guided Access.
