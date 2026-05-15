# CLAUDE.md — EQ2CensusBot

## What this project is

A Discord bot that queries the EverQuest 2 Daybreak Census API and provides three slash commands: item tooltip images, guild member tables, and character spell summaries. Deployed on Railway; git push to `main` triggers redeploy.

## Key files

| File | Purpose |
|---|---|
| `census/client.py` | All Census API HTTP calls. `CensusClient` has `get_item`, `get_guild`, `get_character_spells`, `get_raw_item`. |
| `census/models.py` | Dataclasses: `ItemData`, `ItemStat`, `ItemEffect`, `GuildData`, `GuildMember`, `CharacterSpells`, `SpellEntry` |
| `census/constants.py` | `STAT_MAP` (stat display names/groups), class frozensets (`FIGHTERS`, `PRIESTS`, `SCOUTS`, `MAGES`, `ARTISANS`), `ARCHETYPES`, `CLASS_GROUPS`, `TYPEINFO_DISPLAY`, `ITEM_DISPLAY` |
| `image/tooltip.py` | PIL renderer for item tooltips. Renders at 2× then downsamples (SCALE=2, ZOOM=1.3). Width is `round(368 * ZOOM)`. |
| `bot/bot.py` | Registers all cogs, syncs slash commands to two specific guild IDs (648253204760625160, 955890381847928892) for instant propagation plus a global sync. |
| `bot/cogs/items.py` | `/item` — accepts name, numeric ID, or game link |
| `bot/cogs/guild.py` | `/guild` — tabular member list sorted by rank then level |
| `bot/cogs/spellcheck.py` | `/spellcheck` — spell tier summary or full list (`details:True`) |

## Environment variables

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from Discord developer portal |
| `CENSUS_SERVICE_ID` | Census API service ID (default `example`, rate-limited) |
| `EQ2_WORLD` | EQ2 server name used for guild/spellcheck lookups (default `Varsoon`) |

## Census API patterns

Base URL: `https://census.daybreakgames.com/s:{service_id}/json/get/eq2/`

- Item by name: `item/?displayname=<name>&c:limit=1`
- Item by ID: `item/?id=<id>&c:limit=1`
- Item by game link: extract signed int from `\aITEM <id>`, convert negative to unsigned (`+= 2**32`), then use ID lookup
- Guild: `guild/?name=<name>&world=<world>&c:resolve=members(displayname,type.aa_level,type.deity,type.level,type.class,guild.rank,type.ts_class,type.ts_level)&c:show=member_list,name,world,rank_list&c:limit=1`
- Character spells: `character/?name.first=<name>&locationdata.world=<world>&c:resolve=spells(name,tier_name,type,level,given_by)&c:show=name,spell_list&c:limit=1`

## Tooltip rendering notes

- Quality tier colours: Fabled = pink `(255,153,255)` with pink glow, Legendary = `(255,201,147)` orange glow, Treasured/Mastercrafted = `(147,217,255)` orange glow, Uncommon/Handcrafted/Common = `(190,255,147)` no glow
- Primary stats (green `#22ff22`): Stamina, Primary Attributes, Resistances, Combat Skills
- Secondary stats (cyan): everything else
- Stat ordering controlled by `_PRIMARY_ORDER` dict in `tooltip.py`
- Class list collapsed via `CLASS_GROUPS` exact match first, then `ARCHETYPES` decomposition
- Extra info rows (Type, Slot, Mitigation, Level, Charges, Duration, etc.) are config-driven via `ITEM_DISPLAY` and `TYPEINFO_DISPLAY` in `constants.py` — add entries there to display new fields without touching rendering code
- Adornments show "Adds the following to an item:" header when `armor_type` contains "adornment"

## Guild command notes

- Members without a `type` dict in the API response are filtered out (incomplete data)
- Rank is a numeric ID in `member["guild"]["rank"]`; resolved to name via `rank_list` from the guild response
- Columns: Rank, Name, Class (Level), AA, Tradeskill (Level), Deity
- Sorted by rank ID ascending, then level descending
- Sends as `.txt` file attachment if table exceeds 2000 chars

## Spellcheck command notes

- Filters: level > 0, type must be `spells` or `arts`, `given_by` must not be `alternateadvancement` or `class`
- Deduplication: strips trailing Roman numerals (I–XX) to get base name, keeps highest-level entry per base name per type
- `details:True` flag shows all individual spells grouped by tier, ordered by level

## Local testing scripts

```
python scripts/preview_item.py "Faded Black Hood"
python scripts/inspect_item.py "Faded Black Hood"       # raw JSON dump
python scripts/preview_guild.py "Exordium"
python scripts/preview_spellcheck.py Sihtric
python scripts/preview_spellcheck.py Sihtric --details
python scripts/preview_spellcheck.py Sihtric --debug    # shows each counted spell
```

## Deployment

- Platform: Railway, Nixpacks builder, `python main.py` start command
- Push to `main` branch triggers redeploy
- New slash commands may take up to 1 hour to propagate globally, but appear instantly in the two registered guild IDs above
- Do not push until the user confirms local testing passes
