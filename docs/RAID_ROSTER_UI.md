# Raid roster UI — feature plan + session handover

**Branch**: `feature/raid-roster-ui`
**Worktree**: `E:/git/EQ2Lexicon-raids/` (sibling of `E:/git/EQ2Lexicon/`)
**Sister branch**: `main` continues unrelated WIP in the other worktree
**Started from**: commit `b231bda` ("zones: hand-curated raid roster (EoF + RoK) — encounter+mob schema")

When opening a new Claude session for this work, point at this file:

```
@docs/RAID_ROSTER_UI.md — please read for context, then proceed.
```

---

## What's already done (the foundation)

Committed to `main` and visible here at `b231bda`:

### Schema in [`census/zones_db.py`](../census/zones_db.py)

Five tables. The raid roster lives in two of them:

- **`zone_encounters`** — one row per named encounter in a raid zone.
  - `id`, `zone_id` (FK → `zones`), `encounter_name`, `position`, `stage`, `wiki_url`
  - `encounter_name` is the curator-supplied display text (e.g. `"Adkar Vyx"` for solos, `"Uthtak the Cruel, Aktar the Dark"` for groups).
  - `position` preserves the curator's intended order (typically the order you meet/kill them).
  - `stage` is an optional grouping label (`"Wing 1"`, `"First Floor"`, etc.) for multi-stage raids.
- **`zone_encounter_mobs`** — individual mob names inside an encounter (group encounters carry 2-4 rows; solo carry 1).
  - Indexed lowercased — reverse lookup "which zone is mob X in?" works whether X is a solo boss or part of a group.

### Public API (already implemented, ready to use)

```python
from census import zones_db

# All bosses for a zone, ordered by position, with stage labels:
zones_db.list_bosses_for_zone("The Emerald Halls")
# → [
#     {"encounter_name": "Prince Thirneg", "position": 1, "stage": "First Floor",
#      "wiki_url": None, "mobs": [{"mob_name": "Prince Thirneg", "position": 0}]},
#     ...
#     {"encounter_name": "Wuoshi", "position": 13, "stage": "Third Floor", ...},
#   ]

# Reverse — find the zone a mob belongs to (works through groups):
zones_db.find_zones_by_boss("Aktar the Dark")
# → [{"name": "The Temple of Kor-Sha", ...}]   ← Aktar is one of 2 mobs in
#                                                an "Uthtak + Aktar" group

# Whole-zone fetch already hydrates the bosses array:
zones_db.find_by_name("Veeshan's Peak")
# → {"name": "Veeshan's Peak", ..., "bosses": [13 entries with stages]}
```

### Data currently loaded

- 14 raid zones (5 EoF + 9 RoK)
- 55 encounters
- 61 individual mob rows (the extras are group-encounter members)
- Source: [`scripts/dev/eq2_raid_bosses.review.txt`](../scripts/dev/eq2_raid_bosses.review.txt) (hand-curated; re-run `python scripts/build_zones_db.py` after edits)
- Smoke tests: [`scripts/dev/_smoke_test_zones_db.py`](../scripts/dev/_smoke_test_zones_db.py) — run after any schema or build-script change.

### One-time setup needed in this worktree

`data/zones/zones.db` is gitignored (binary, rebuildable). Build it once:

```powershell
cd E:/git/EQ2Lexicon-raids
.venv/Scripts/python scripts/build_zones_db.py
.venv/Scripts/python scripts/dev/_smoke_test_zones_db.py   # should be all-pass
```

If `.venv/` doesn't exist in this worktree yet (UV creates per-worktree venvs):
```powershell
uv sync
```

---

## What this feature is

Three user-selected directions, sequenced by user-visible value vs effort. Tackle in order — each is independently shippable, and later items naturally build on the page introduced in #1.

### Phase 1 — Surface the raid roster on the website (1-2 sessions)

The visible payoff of all the curation work. Click a raid zone, see the boss roster.

**Backend** (`web/routes/`):
- New `web/routes/zones.py` (or extend existing if one's been added since)
- Endpoint: `GET /api/zones/{name}` — returns the dict from `zones_db.find_by_name()` (already has the `bosses` array hydrated)
- Endpoint optional: `GET /api/zones?expansion=EoF&type=raid_x4` — list view
- Add to `web/app.py`'s router includes.

**Frontend** (`frontend/src/`):
- New route `/zones/:name` rendering the zone's metadata + boss roster
- Group encounters by `stage` (a zone with stages shows "Wing 1", "Wing 2"... headers; a zone without stages just lists in order)
- Display each encounter as the curator wrote it (`encounter_name`) — multi-mob encounters render their joined name verbatim; can optionally split via `mobs` array if you want individual badges
- Link out to `wiki_url` when present (most are currently null since hand-curated; rely on `https://eq2.fandom.com/wiki/<zone>` URL pattern from the existing wiki integration)
- Follow the Tailwind v4 conventions in [CLAUDE.md](../CLAUDE.md) — use `Card`, `SectionLabel`, `Button` primitives from `frontend/src/components/ui`, gold-on-dark theming, no inline `style={{}}` except for dynamic values

**Link in from existing pages**: parses page, zone-name references, etc. Hover-card showing encounter count?

### Phase 2 — Hook the raid roster into the parses pipeline (1-2 sessions)

When ACT uploads an Emerald Halls parse, the parse detail page shows *"killed 8 of 13 — missing: Wuoshi, Treah Greenroot, Galiel Spirithoof, Herald of Wuoshi, Tender of the Seedlings"*.

**Server-side**:
- After encounter ingest (`web/routes/parses.py:ingest_parse`), look up the zone's expected roster via `zones_db.list_bosses_for_zone()`.
- Match the parse's encounter title against `encounter_name` first (exact, case-insensitive); fall back to checking against individual mobs in `zone_encounter_mobs` (since ACT might log "Wuoshi" while the curator wrote "Wuoshi" — but for group encounters, ACT logs ONE of the mobs and we need to resolve to the encounter).
- Probably want a `parse_zone_progress` table or just a derived field on the parse list response.

**Frontend**:
- Show progress bar / killed-vs-roster badge on parse detail.
- Group view too — "guild progression on EH this week".

**Watch out for**: name normalisation is fuzzy. ACT often emits "a [mob_name]"-style names. The plugin already has placeholder-title skip logic (CLAUDE.md "Plugin upload" section).

### Phase 3 — Per-encounter strategy editor (3-4 sessions)

Bigger lift. The `census/raids_db.py` schema is already designed for this (separate DB, encounter_id + strategy_md + revision history). Currently empty — no UI to write into it.

**Schema** (`census/raids_db.py`, already built):
- `raid_zones`, `raid_encounters`, `raid_encounter_revisions`, `_meta`
- One markdown blob per encounter (PoC simplicity; can split into structured fields later)
- Revision history on every UPDATE

**To build**:
- `web/routes/raid_strategies.py` — GET (public), PUT (auth-gated)
- Auth: tie to existing `require_user_session` + an "is officer of zone's guild" check? Or admin-only for now?
- Frontend: markdown editor (existing pattern?) with preview, version history view
- Linked from the Phase 1 zone page — click an encounter, get a strategy view + edit button

**Out-of-the-box helpers in [`census/wikitext_md.py`](../census/wikitext_md.py)**: wikitext→markdown converter. Currently unused but if you ever want to seed strategy from EQ2i, it's ready.

---

## Repo conventions worth re-reading

- **`CLAUDE.md`** at repo root — full project context, especially:
  - "Frontend styling — Tailwind v4 (ENFORCED)" — use existing primitives, no per-page CSSProperties
  - "Web companion architecture" — FastAPI patterns, cache TTL, run_in_executor for sync DB calls
  - "Manual upload: zones.db" — env var pattern matches recipes_db/spells_db
- **`census/recipes_db.py`** + **`census/spells_db.py`** — reference for the DB-module shape (init_db / lookup helpers / row hydration). `zones_db.py` follows the same pattern.
- **Pre-push hooks** run on every push: `dotnet format`, `ruff format --check`, `ruff check`, `pyright`, `pytest`, vitest, TypeScript. Don't push until they're green.

---

## Files in scope vs out

**In scope** (this feature touches):
- `web/routes/*.py` (new file + existing app.py include)
- `frontend/src/routes/` (new page)
- `frontend/src/components/` (any new shared components for the boss-roster display)
- `census/zones_db.py` (read-only — only if new query helpers needed)
- `tests/web/test_zones_route.py` (new)
- Possibly `web/routes/parses.py` (Phase 2 only)
- Possibly `census/raids_db.py` + new editor routes/components (Phase 3 only)

**Out of scope** (don't touch):
- The ACT plugin (`E:/git/EQ2LexiconACTPlugin/`) — separate repo
- `census/zones_db.py` SCHEMA changes — bake-test in main first if needed
- `scripts/build_zones_db.py` — pipeline is stable; only revisit if the curated file format evolves
- `scripts/dev/eq2_raid_bosses.review.txt` — content edits happen in the other worktree

---

## Stashed / parked work (don't lose)

- `scripts/dev/scrape_eq2i_raids.py` — EQ2i scraper, not currently in the pipeline but kept in case Phase 3 wants to seed strategy from the wiki
- `census/raids_db.py` — strategy schema (untouched), waits for Phase 3
- `census/wikitext_md.py` — wikitext→markdown converter (untouched), waits for Phase 3

---

## When the feature ships

1. Squash-merge into `main` (consider whether the docs/RAID_ROSTER_UI.md should go too — probably yes, the planning context isn't needed post-merge)
2. Delete the worktree:
   ```powershell
   cd E:/git/EQ2Lexicon
   git worktree remove ../EQ2Lexicon-raids
   git branch -d feature/raid-roster-ui
   ```
