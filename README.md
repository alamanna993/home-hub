# HomeHub

Self-hosted family hub: home inventory, AI chat (local or cloud), meal planning, calendar, chore charts, and a Telegram bot — all in Docker, NAS-friendly.

- 📦 **Inventory** — every book, cable, and can of beans, organized by room and sub-location (Kitchen / Pantry Shelf 2, Basement, Office…)
- 💬 **AI Chat** — ask "where's my drill?" or "what can I make for dinner tonight?" from the web app or Telegram
- 🍽️ **Meal Planner** — plan the week's breakfasts, lunches, and dinners
- 📅 **Calendar** — family events on a month view
- ✅ **Chore Chart** — chores by person with daily/weekly/monthly check-offs
- 🤖 **Pluggable AI** — Ollama or LM Studio (local), OpenAI or Claude (cloud); switch providers from the Settings page without restarting
- 💾 **Redundant data** — Postgres data on a folder you choose (NAS share) plus automatic nightly SQL backups with retention

## Quick Install (one line)

All you need is Docker and git. On Linux / macOS / a NAS shell / WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/alamanna993/home-hub/main/install.sh | bash
```

On Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/alamanna993/home-hub/main/install.ps1 | iex
```

The script clones the repo, generates a `.env` with random secrets, pulls the prebuilt
images from GitHub Container Registry (or builds locally if it can't), and starts everything.
Then open **http://localhost:3000**, sign in with **`admin` / `admin`**, and the
**setup wizard** walks you through the rest: setting a real password, checking where your
data lives, connecting a local or cloud AI model (with a test button), and hooking up the
Telegram bot — all from the browser.

For local AI you'll want [Ollama](https://ollama.com) with a model pulled
(`ollama pull llama3.2`) or LM Studio running; for cloud AI, an OpenAI or Anthropic API key.

## Manual Setup

1. Clone and create the env file:
   ```bash
   git clone https://github.com/alamanna993/home-hub.git && cd home-hub
   cp .env.example .env
   ```

2. Edit `.env` — the important ones:
   - `DB_PASSWORD` — any strong password
   - `SECRET_KEY` — random string (`python -c "import secrets; print(secrets.token_hex(32))"`)

3. Start everything:
   ```bash
   docker compose up -d
   ```
   Want the optional Discord bot too?
   ```bash
   docker compose --profile discord up -d
   ```

4. Open http://localhost:3000, sign in with **`admin` / `admin`**, follow the wizard.

**Updating:** re-run the install one-liner, or `git pull && docker compose pull && docker compose up -d`.

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
| LM Studio | local | server on port 1234; leave model blank to use whatever is loaded |
| OpenAI | cloud | needs `OPENAI_API_KEY` |
| Claude | cloud | needs `ANTHROPIC_API_KEY` |

Changes made in Settings take effect immediately — no restart needed. Use the wizard's
**Test Connection** button (or Settings) to confirm the model responds before relying on it.

## Telegram Bot

1. Message **@BotFather** on Telegram → `/newbot` → copy the token
2. Paste it into the **setup wizard** (or Settings → Telegram) — the bot picks it up within ~30s.
   (Setting `TELEGRAM_BOT_TOKEN` in `.env` works too.)
3. Send `/start` to your bot — it replies with your **chat ID**
4. Save that ID under Allowed Chat IDs (comma-separated for family) so only your family can use it

**The bot doesn't just answer — it updates the database.** Text it from the store:
- `just bought 2 gallons of milk` → added to inventory
- `we're out of eggs` → quantity set to 0 (kept on the list so you restock)
- `moved the drill to the garage` → location updated
- `where is my drill?`, `what can I make for dinner tonight?`
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
