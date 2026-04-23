# HomeHub

Home inventory tracker with local AI, Telegram bot, and a dark dashboard.

## Prerequisites

- Docker + Docker Compose
- [Ollama](https://ollama.com) running locally with a model pulled:
  ```bash
  ollama pull llama3.2
  ```
- A Discord bot token (see Discord Bot setup below)

## Setup

1. Copy the env file and fill it in:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env`:
   - `DB_PASSWORD` — any strong password
   - `DISCORD_TOKEN` — your bot token from the Discord Developer Portal
   - `DISCORD_CHANNEL_ID` — the channel ID where the bot should listen
   - `OLLAMA_HOST` — usually `http://host.docker.internal:11434` on Docker Desktop
   - `OLLAMA_MODEL` — `llama3.2`, `mistral`, `qwen2.5`, etc.

## Discord Bot Setup

1. Go to https://discord.com/developers/applications → **New Application**
2. Go to **Bot** tab → **Add Bot** → copy the **Token** → paste into `DISCORD_TOKEN`
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**
4. Go to **OAuth2 → URL Generator** → check `bot` scope + these permissions:
   - Send Messages, Read Message History, Embed Links, Use Slash Commands
5. Open the generated URL to invite the bot to your server
6. In Discord, enable **Developer Mode** (User Settings → Advanced)
7. Right-click your inventory channel → **Copy Channel ID** → paste into `DISCORD_CHANNEL_ID`

3. Start everything:
   ```bash
   docker compose up -d
   ```

4. Open the dashboard: http://localhost:3000

## Usage

### Dashboard
- **Dashboard** — stats, category pie chart, recent activity
- **Inventory** — browse, search, filter, add/edit/delete items
- **Locations** — manage rooms and sub-locations
- **Categories** — manage categories with icons and colors
- **Low Stock** — items that need restocking
- **Chat** — ask your local AI anything about your inventory

### Discord Bot
Message the bot in your inventory channel (natural language or commands):
- `where is my drill?`
- `added 2 boxes of pasta to pantry shelf 1`
- `we're out of milk`
- `what's running low?`
- `!stats` — quick summary
- `!lowstock` — items running low
- `!find drill` — look up a specific item
- `!help` — show all commands

## Models

Any Ollama model works. Recommended:
- `llama3.2` — fast, good for structured parsing
- `mistral` — solid alternative
- `qwen2.5` — great multilingual support

Change the model anytime by updating `OLLAMA_MODEL` in `.env` and restarting the bot:
```bash
docker compose restart bot backend
```

## Tablet Display

Point any browser in kiosk mode to `http://<your-server-ip>:3000`.
On Android: use "Fully Kiosk Browser". On iPad: use Guided Access.
