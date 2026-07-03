import os
import httpx
import logging
import discord
from discord.ext import commands
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO)

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "")
DISCORD_CHANNEL_ID = int(os.getenv("DISCORD_CHANNEL_ID", "0"))  # overridden at startup from DB

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents, help_command=None)


async def call_backend(path: str, method: str = "GET", json: dict = None) -> dict:
    headers = {"X-API-Key": INTERNAL_API_KEY} if INTERNAL_API_KEY else {}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
        if method == "POST":
            r = await client.post(f"{BACKEND_URL}{path}", json=json)
        elif method == "PATCH":
            r = await client.patch(f"{BACKEND_URL}{path}", json=json)
        else:
            r = await client.get(f"{BACKEND_URL}{path}")
        r.raise_for_status()
        return r.json()


def item_embed(item: dict) -> discord.Embed:
    loc = item.get("location")
    cat = item.get("category")
    loc_str = "Unknown"
    if loc:
        loc_str = loc["name"]
        if loc.get("sublocation"):
            loc_str += f" — {loc['sublocation']}"

    color = int((cat.get("color") or "#6366f1").lstrip("#"), 16) if cat else 0x6366f1
    embed = discord.Embed(title=f"{cat['icon'] if cat else '📦'} {item['name']}", color=color)
    embed.add_field(name="📍 Location", value=loc_str, inline=True)
    embed.add_field(name="📦 Quantity", value=f"{item.get('quantity', '—')} {item.get('unit') or ''}".strip(), inline=True)
    if cat:
        embed.add_field(name="🏷️ Category", value=cat["name"], inline=True)
    if item.get("notes"):
        embed.add_field(name="💬 Notes", value=item["notes"], inline=False)
    if item.get("is_low_stock"):
        embed.set_footer(text="⚠️ This item is running low!")
    return embed


@bot.event
async def on_ready():
    global DISCORD_CHANNEL_ID
    logging.info(f"HomeHub bot logged in as {bot.user}")
    try:
        runtime = await call_backend("/settings/runtime")
        if runtime.get("discord_channel_id"):
            DISCORD_CHANNEL_ID = int(runtime["discord_channel_id"])
            logging.info(f"Loaded channel ID from settings: {DISCORD_CHANNEL_ID}")
    except Exception as e:
        logging.warning(f"Could not load runtime settings: {e}")

    if DISCORD_CHANNEL_ID:
        ch = bot.get_channel(DISCORD_CHANNEL_ID)
        if ch:
            await ch.send(embed=discord.Embed(
                title="🏠 HomeHub Bot Online",
                description="I'm here to help track your home inventory. Type `!help` to get started.",
                color=0x6366f1,
            ))


@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if DISCORD_CHANNEL_ID and message.channel.id != DISCORD_CHANNEL_ID:
        await bot.process_commands(message)
        return

    await bot.process_commands(message)

    if message.content.startswith("!"):
        return

    # Natural language — send to AI backend
    async with message.channel.typing():
        try:
            result = await call_backend("/chat/", "POST", {
                "message": message.content,
                "source": f"discord:{message.author.display_name}",
            })
            reply = result.get("reply", "Sorry, I didn't understand that.")
            action = result.get("action")

            if action == "add_item" and result.get("item"):
                embed = item_embed(result["item"])
                await message.reply(reply.split("**")[0].strip(), embed=embed)
            elif action == "find_item" and result.get("reply", "").startswith("✅"):
                # Try to fetch full item for a rich embed
                item_name = result.get("parsed", {}).get("item", "")
                items = await call_backend(f"/items/?search={item_name}")
                if items:
                    await message.reply(embed=item_embed(items[0]))
                else:
                    await message.reply(reply)
            else:
                await message.reply(reply)
        except Exception as e:
            await message.reply(f"❌ Something went wrong: {e}")


@bot.command(name="help")
async def help_cmd(ctx: commands.Context):
    embed = discord.Embed(title="🏠 HomeHub Bot", color=0x6366f1)
    embed.description = "Track what's in your home by just chatting naturally."
    embed.add_field(name="💬 Natural language", value=(
        "`where is my drill?`\n"
        "`added 2 boxes of pasta to pantry`\n"
        "`we're out of milk`\n"
        "`do we have coffee?`\n"
        "`what food do we have?`"
    ), inline=False)
    embed.add_field(name="⚡ Commands", value=(
        "`!stats` — inventory summary\n"
        "`!lowstock` — items running low\n"
        "`!find <name>` — look up an item\n"
        "`!help` — this message"
    ), inline=False)
    embed.set_footer(text="Powered by local AI (Ollama)")
    await ctx.send(embed=embed)


@bot.command(name="stats")
async def stats_cmd(ctx: commands.Context):
    try:
        data = await call_backend("/items/stats")
        embed = discord.Embed(title="📊 Inventory Stats", color=0x6366f1)
        embed.add_field(name="📦 Total Items", value=str(data["total_items"]), inline=True)
        embed.add_field(name="⚠️ Low Stock", value=str(data["low_stock_count"]), inline=True)
        cats = [c for c in data["by_category"] if c["count"] > 0]
        if cats:
            lines = [f"{c['icon'] or '•'} {c['name']}: **{c['count']}**" for c in cats]
            embed.add_field(name="By Category", value="\n".join(lines), inline=False)
        await ctx.send(embed=embed)
    except Exception as e:
        await ctx.send(f"❌ Error: {e}")


@bot.command(name="lowstock")
async def lowstock_cmd(ctx: commands.Context):
    try:
        items = await call_backend("/items/?low_stock_only=true")
        if not items:
            embed = discord.Embed(title="✅ All Stocked Up!", description="Nothing is running low right now.", color=0x22c55e)
        else:
            embed = discord.Embed(title="⚠️ Running Low", color=0xf59e0b)
            lines = []
            for item in items:
                qty = f"{item.get('quantity', 0)} {item.get('unit') or ''}".strip()
                loc = item.get("location")
                loc_str = loc["name"] if loc else "?"
                lines.append(f"• **{item['name']}** — {qty} left ({loc_str})")
            embed.description = "\n".join(lines)
        await ctx.send(embed=embed)
    except Exception as e:
        await ctx.send(f"❌ Error: {e}")


@bot.command(name="find")
async def find_cmd(ctx: commands.Context, *, name: str):
    try:
        items = await call_backend(f"/items/?search={name}")
        if not items:
            await ctx.send(f"❌ Couldn't find **{name}** in the inventory.")
        else:
            await ctx.send(embed=item_embed(items[0]))
    except Exception as e:
        await ctx.send(f"❌ Error: {e}")


if __name__ == "__main__":
    bot.run(DISCORD_TOKEN)
