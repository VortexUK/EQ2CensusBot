# EQ2CensusBot

A Discord bot for EverQuest 2 that queries the [Daybreak Census API](https://census.daybreakgames.com) and renders item tooltips, guild summaries, spell tier breakdowns, and AA tree visualisations.

## Commands

| Command | Description |
|---|---|
| `/item <name\|id\|game link>` | Renders an EQ2 item tooltip as a PNG image |
| `/guild <name>` | Shows a tabular member summary for a guild on the configured world |
| `/spellcheck <name>` | Summarises a character's spell/art tiers (unique highest-level only) |
| `/spellcheck <name> details:True` | Full spell list ordered by tier then level |
| `/aacheck <character> <tree>` | Renders a character's AA allocations for a chosen tree type |

### `/aacheck` tree options

| Choice | Tree type |
|---|---|
| Class | Archetype/class tree (e.g. Cleric) |
| Subclass | Subclass tree (e.g. Templar) |
| Shadows | Shadows of Fate tree |
| Heroic | Heroic tree |
| Trade | Tradeskill tree |

Each node shows a **yellow badge** if points are invested but not maxed, or a **green badge** if the node is maxed. The caption includes the character's real tree name (e.g. "Templar") and total points spent.

## Project Structure

```
main.py                  # Entry point — loads .env, starts the bot
bot/
  bot.py                 # EQ2Bot class — registers cogs, syncs slash commands
  cogs/
    items.py             # /item command
    guild.py             # /guild command
    spellcheck.py        # /spellcheck command
    aacheck.py           # /aacheck command
census/
  client.py              # CensusClient — all HTTP calls to the Census API
  models.py              # Dataclasses: ItemData, GuildData, CharacterSpells, CharacterAAs, etc.
  constants.py           # STAT_MAP, class groups, ARCHETYPES, display config
image/
  tooltip.py             # PIL tooltip renderer (2x supersampling, ZOOM=1.3)
  aa_tree.py             # AA tree renderers (class, subclass, shadows, heroic, tradeskill)
data/
  AAs/
    trees/               # 157 AA tree JSON files (one per tree ID)
    icons/               # AA node icon PNGs
    background.jpg       # Shared dark background for all tree renders
    bg_class.png         # Golden connector overlay for class trees
    bg_subclass.png      # Bow-tie connector overlay for subclass trees
    bg_shadows.png       # Shadows tree background overlay
    bg_sprite.png        # Sprite sheet: backdrop circles + tier badge sprites
    index.json           # Maps subclass name → list of tree IDs
scripts/
  preview_item.py        # Render an item tooltip to preview.png locally
  inspect_item.py        # Dump raw Census JSON for an item
  preview_guild.py       # Print guild table to console locally
  preview_spellcheck.py  # Print spell summary to console locally
  preview_aa_tree.py     # Render any AA tree to preview_aa_tree.png locally
  preview_aacheck.py     # Fetch character AAs + render tree to preview_aacheck.png
  download_aa_trees.py   # Download all AA tree JSONs from Census API
  download_aa_icons.py   # Download all AA node icon PNGs from Census API
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
EQ2_WORLD=Varsoon                # EQ2 world/server name used for guild, spellcheck, and aacheck lookups
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
python scripts/preview_aa_tree.py 25              # render tree by ID
python scripts/preview_aacheck.py Menludiir       # list a character's AA trees
python scripts/preview_aacheck.py Menludiir Templar  # render by tree name
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
