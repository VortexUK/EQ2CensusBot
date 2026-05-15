# CLAUDE.md — EQ2CensusBot

## What this project is

A Discord bot that queries the EverQuest 2 Daybreak Census API and provides slash commands: item tooltip images, guild member tables, character spell summaries, and AA tree visualisations. Deployed on Railway; git push to `main` triggers redeploy.

## Key files

| File | Purpose |
|---|---|
| `census/client.py` | All Census API HTTP calls. `CensusClient` has `get_item`, `get_guild`, `get_character_spells`, `get_character_aas`, `get_raw_item`. |
| `census/models.py` | Dataclasses: `ItemData`, `ItemStat`, `ItemEffect`, `GuildData`, `GuildMember`, `CharacterSpells`, `SpellEntry`, `NodeAA`, `CharacterAAs` |
| `census/constants.py` | `STAT_MAP` (stat display names/groups), class frozensets (`FIGHTERS`, `PRIESTS`, `SCOUTS`, `MAGES`, `ARTISANS`), `ARCHETYPES`, `CLASS_GROUPS`, `TYPEINFO_DISPLAY`, `ITEM_DISPLAY` |
| `image/tooltip.py` | PIL renderer for item tooltips. Renders at 2× then downsamples (SCALE=2, ZOOM=1.3). Width is `round(368 * ZOOM)`. |
| `image/aa_tree.py` | AA tree renderers and coordinate systems. See AA tree notes below. |
| `bot/bot.py` | Registers all cogs, syncs slash commands to three specific guild IDs (648253204760625160, 955890381847928892, 1502314690041221260) for instant propagation plus a global sync. |
| `bot/cogs/items.py` | `/item` — accepts name, numeric ID, or game link |
| `bot/cogs/guild.py` | `/guild` — tabular member list sorted by rank then level |
| `bot/cogs/spellcheck.py` | `/spellcheck` — spell tier summary or full list (`details:True`) |
| `bot/cogs/aacheck.py` | `/aacheck` — renders a character's AA tree with tier badges |

## Environment variables

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from Discord developer portal |
| `CENSUS_SERVICE_ID` | Census API service ID (default `example`, rate-limited) |
| `EQ2_WORLD` | EQ2 server name used for guild/spellcheck/aacheck lookups (default `Varsoon`) |

## Census API patterns

Base URL: `https://census.daybreakgames.com/s:{service_id}/json/get/eq2/`

- Item by name: `item/?displayname=<name>&c:limit=1`
- Item by ID: `item/?id=<id>&c:limit=1`
- Item by game link: extract signed int from `\aITEM <id>`, convert negative to unsigned (`+= 2**32`), then use ID lookup
- Guild: `guild/?name=<name>&world=<world>&c:resolve=members(...)&c:show=member_list,name,world,rank_list&c:limit=1`
- Character spells: `character/?name.first=<name>&locationdata.world=<world>&c:resolve=spells(name,tier_name,type,level,given_by)&c:show=name,spell_list&c:limit=1`
- Character AAs: `character/?name.first=<name>&locationdata.world=<world>&c:show=name,alternateadvancements&c:limit=1`
  - Response has `alternateadvancements.alternateadvancement_list` with entries `{tier, treeID, id}` where `id` matches `nodeid` in the tree JSON

## AA tree notes

### Data files (`data/AAs/`)
- `trees/{id}.json` — one file per tree, contains `alternateadvancement_list[0]` with `name`, `ofyclassification`, and `alternateadvancementnode_list`
- Each node has: `nodeid`, `xcoord`, `ycoord`, `icon.id`, `icon.backdrop`, `maxtier`, `classification`
- `icons/{id}.png` — node icon images downloaded from Census
- `bg_sprite.png` — sprite sheet: 7 backdrop circles (44px, ids -1/456–461) then 3 badge circles (24px: white/yellow/green)
  - Backdrop x-offsets: `{-1:0, 456:45, 457:90, 458:135, 459:180, 460:225, 461:270}`
  - Badge x-offsets: yellow (not maxed) = 340, green (maxed) = 365

### Tree type detection (`detect_tree_type`)
Detects from xcoord sets, max ycoord, `ofyclassification`, and node `classification` strings. Returns one of: `class`, `subclass`, `shadows`, `heroic`, `tradeskill`, `tradeskill_general`, `warder`, `prestige`, `dragon`, `reign_of_shadows`, `far_seas`, `unknown`.

### Coordinate systems (native 640×480 base, rendered at SCALE=2 → 1280×960)
- **class**: columns at x=86,206,327,447,567 for xcoords 1,4,7,10,13; rows at y=42+(ycoord×66.67)
- **subclass**: anchor x=234 at xcoord 15, step 155/12 px/unit; y=42+(ycoord×21.05), ycoords 0–19
- **shadows**: native 632×472; x=40+(xcoord×13) scaled by IMG_W/632; y from `{1:59,6:166,11:273,16:377}` scaled by IMG_H/472
- **heroic**: x=65+((xcoord-2)×13), y=50+((ycoord-1)×22); no overlay
- **tradeskill**: x=65+((xcoord-2)×13), y=60+((ycoord-1)×21); no overlay

### `/aacheck` command
- Five static choices: Class/Subclass/Shadows/Heroic/Trade (avoids repeated API calls for autocomplete)
- At runtime: fetches character AAs, iterates their tree IDs, matches by `detect_tree_type` result, renders with `aa_data: dict[node_id → tier]`
- Badge: yellow if `tier < maxtier`, green if `tier >= maxtier`; positioned bottom-right of node (32px output, slight overlap)
- Caption shows real tree name (e.g. "Templar") and total points spent

### Unimplemented tree types
`tradeskill_general`, `warder`, `prestige`, `dragon`, `reign_of_shadows`, `far_seas` all fall back to `render_subclass_tree` pending proper calibration.

## Tooltip rendering notes

- Quality tier colours: Fabled = pink `(255,153,255)` with pink glow, Legendary = `(255,201,147)` orange glow, Treasured/Mastercrafted = `(147,217,255)` orange glow, Uncommon/Handcrafted/Common = `(190,255,147)` no glow
- Primary stats (green `#22ff22`): Stamina, Primary Attributes, Resistances, Combat Skills
- Secondary stats (cyan): everything else
- Stat ordering controlled by `_PRIMARY_ORDER` dict in `tooltip.py`
- Class list collapsed via `CLASS_GROUPS` exact match first, then `ARCHETYPES` decomposition
- Extra info rows (Type, Slot, Mitigation, Level, Charges, Duration, etc.) are config-driven via `ITEM_DISPLAY` and `TYPEINFO_DISPLAY` in `constants.py`
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
python scripts/preview_aa_tree.py 25                    # render tree ID 25
python scripts/preview_aacheck.py Menludiir             # list character's AA trees
python scripts/preview_aacheck.py Menludiir Templar     # render by tree name (partial match)
python scripts/download_aa_trees.py                     # re-download all tree JSONs
python scripts/download_aa_icons.py                     # re-download all node icons
```

## Deployment

- Platform: Railway, Nixpacks builder, `python main.py` start command
- Push to `main` branch triggers redeploy
- New slash commands may take up to 1 hour to propagate globally, but appear instantly in the registered guild IDs above
- Do not push until the user confirms local testing passes
