# EQ2CensusBot

A Discord bot for EverQuest 2 that queries the [Daybreak Census API](https://census.daybreakgames.com) and renders item tooltips, guild summaries, and spell tier breakdowns.

## Commands

| Command | Description |
|---|---|
| `/item <name\|id\|game link>` | Renders an EQ2 item tooltip as a PNG image |
| `/guild <name>` | Shows a tabular member summary for a guild on the configured world |
| `/spellcheck <name>` | Summarises a character's spell/art tiers (unique highest-level only) |
| `/spellcheck <name> details:True` | Full spell list ordered by tier then level |

## Project Structure

```
main.py                  # Entry point — loads .env, starts the bot
bot/
  bot.py                 # EQ2Bot class — registers cogs, syncs slash commands
  cogs/
    items.py             # /item command
    guild.py             # /guild command
    spellcheck.py        # /spellcheck command
census/
  client.py              # CensusClient — all HTTP calls to the Census API
  models.py              # Dataclasses: ItemData, GuildData, CharacterSpells, etc.
  constants.py           # STAT_MAP, class groups, ARCHETYPES, display config
image/
  tooltip.py             # PIL tooltip renderer (2x supersampling, ZOOM=1.3)
scripts/
  preview_item.py        # Render an item tooltip to preview.png locally
  inspect_item.py        # Dump raw Census JSON for an item
  preview_guild.py       # Print guild table to console locally
  preview_spellcheck.py  # Print spell summary to console locally
```

## Setup

### Requirements

- Python 3.11+
- Dependencies: `discord.py`, `aiohttp`, `Pillow`, `python-dotenv`

```
pip install -r requirements.txt
```

### Environment Variables

Copy `.env.example` to `.env` and fill in:

```
DISCORD_TOKEN=your_discord_bot_token
CENSUS_SERVICE_ID=example        # Register at census.daybreakgames.com for a higher rate limit
EQ2_WORLD=Varsoon                # EQ2 world/server name used for guild and spellcheck lookups
```

### Running Locally

```
python main.py
```

### Preview Scripts (no Discord needed)

```
python scripts/preview_item.py "Faded Black Hood"
python scripts/inspect_item.py "Faded Black Hood"
python scripts/preview_guild.py "Exordium"
python scripts/preview_spellcheck.py Sihtric
python scripts/preview_spellcheck.py Sihtric --details
python scripts/preview_spellcheck.py Sihtric --debug
```

## Deployment (Railway)

The repo includes a `railway.toml` configured for Nixpacks. Set the following environment variables in the Railway dashboard:

- `DISCORD_TOKEN`
- `CENSUS_SERVICE_ID`
- `EQ2_WORLD`

Push to `main` to trigger a redeploy.

## Census API Notes

- Base URL: `https://census.daybreakgames.com`
- Item lookup supports: display name, numeric ID, or in-game link (e.g. `\aITEM 12345 ...`)
- Game link IDs are signed 32-bit integers; the client converts negative values to unsigned automatically
- The `example` service ID is rate-limited — register your own at the Census site for production use
