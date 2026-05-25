# Class Database

**Date:** 2026-05-25
**Status:** Design approved, pending implementation plan

## Summary

A reference database of every EQ2 adventure class and what we know about it —
archetype, subclass (middle tier), role, colour, display order, and an icon.
It consolidates class facts currently scattered across `census/constants.py`
(archetype frozensets + `CLASS_GROUPS`) and the frontend `classConstants.ts`
(colour map) into one source, and adds **role** (which nothing currently
records).

This is **prework**. It delivers the database, a Python access layer, an API,
and the class icons — nothing more. The rankings-page features that will
*consume* it are explicitly out of scope (see Non-goals).

## Goals

- One authoritative definition of the 26 adventure classes with: archetype,
  subclass, role, colour, display order, icon id.
- A SQLite catalogue (`data/classes/classes.db`) matching the existing
  `recipes.db` / `spells.db` pattern, with a Python access module.
- De-duplicate: `census/constants.py`'s archetype/subclass groupings and the
  frontend's hardcoded colour map both derive from this one source.
- `GET /api/classes` so the frontend has a single source instead of a hardcoded
  copy.
- The 26 class icons, downloaded from EQ2wire and served like other icons.

## Non-goals (deferred to later specs)

The rankings upgrades that motivated this prework are **not** built here — each
is its own future spec that consumes this database:

- Composition column (tanks/healers/etc. per kill)
- Top-50 class/role breakdown
- Role / archetype aggregate boards
- Hierarchical (archetype → subclass → class) class dropdown
- Per-class visuals on the rankings table
- Role/archetype-scoped percentile grouping

## Key decisions

| Decision | Choice |
|---|---|
| Storage | SQLite `data/classes/classes.db` (matches `recipes.db`/`spells.db`), **not** JSON |
| Source of truth | A hand-authored `CLASS_SEED` (26 records) in `census/classes_db.py`; the `.db` is built from it (no Census download — the data is static) |
| Primary key | **Class name** — the only identifier stable across EQ2's multiple class-id spaces (see below) |
| Roles | 5: Tank / Healer / Melee DPS / Ranged DPS / Support |
| Icons | EQ2wire `class_medium/{icon_id}.png` → `data/classes/icons/{icon_id}.png`, served at `/class-icons/{icon_id}.png` |
| `.db` in git | Gitignored + built by a script + hand-copied to the Railway volume (per the project's DB convention). Icons **are** committed (small static assets). |
| Frontend sharing | `GET /api/classes` (cached); the hardcoded colour map in `classConstants.ts` is removed |

### Class-id spaces — why we key on name

EQ2 has at least three unrelated class-id schemes; **none align**, so the
database keys on class **name** and treats `icon_id` purely as the EQ2wire icon
filename — never as a universal class id.

| Class | EQ2wire icon id (ours) | AA tree id | 
|---|---|---|
| Guardian | 3 | 13 |
| Templar | 13 | 25 |
| Swashbuckler | 33 | 22 |

(AA trees number the 12 middle-tier classes 1–12, then subclasses from 13; Census
`type.classid` used by the spell queries is yet another scheme.) A future feature
joining classes to AA trees joins by **name** (the AA tree's `name` field is the
class/subclass name).

## Data model

`ClassInfo` (frozen dataclass) in `census/classes_db.py`:

| Field | Type | Notes |
|---|---|---|
| `name` | str | Canonical class name, e.g. `Templar`. Primary key. |
| `archetype` | str | `Fighter` / `Priest` / `Scout` / `Mage` |
| `subclass` | str \| None | Middle tier (`Cleric`, `Druid`, …); **None** for Beastlord & Channeler |
| `role` | str | `Tank` / `Healer` / `Melee DPS` / `Ranged DPS` / `Support` |
| `colour` | str | Hex; seeded per-archetype (see below), per-class field allows future override |
| `display_order` | int | Deterministic: archetype order `[Fighter, Priest, Scout, Mage]`, then `icon_id` ascending within archetype (this naturally orders the subclass pairs and sorts the None-subclass classes — Channeler 44, Beastlord 42 — last within their archetype) |
| `icon_id` | int | EQ2wire `class_medium` id (icon filename) |

Archetype colours (carried from `classConstants.ts`): Fighter `#f87171`,
Priest `#4ade80`, Scout `#fbbf24`, Mage `#93b4ff`.

## The 26 classes (authoritative seed)

| Class | archetype | subclass | role | icon_id |
|---|---|---|---|---|
| Guardian | Fighter | Warrior | Tank | 3 |
| Berserker | Fighter | Warrior | Tank | 4 |
| Monk | Fighter | Brawler | Tank | 6 |
| Bruiser | Fighter | Brawler | Tank | 7 |
| Shadowknight | Fighter | Crusader | Tank | 9 |
| Paladin | Fighter | Crusader | Tank | 10 |
| Templar | Priest | Cleric | Healer | 13 |
| Inquisitor | Priest | Cleric | Healer | 14 |
| Warden | Priest | Druid | Healer | 16 |
| Fury | Priest | Druid | Healer | 17 |
| Mystic | Priest | Shaman | Healer | 19 |
| Defiler | Priest | Shaman | Healer | 20 |
| Channeler | Priest | *(none)* | Healer | 44 |
| Wizard | Mage | Sorcerer | Ranged DPS | 23 |
| Warlock | Mage | Sorcerer | Ranged DPS | 24 |
| Coercer | Mage | Enchanter | Support | 26 |
| Illusionist | Mage | Enchanter | Support | 27 |
| Conjuror | Mage | Summoner | Ranged DPS | 29 |
| Necromancer | Mage | Summoner | Ranged DPS | 30 |
| Swashbuckler | Scout | Rogue | Melee DPS | 33 |
| Brigand | Scout | Rogue | Melee DPS | 34 |
| Troubador | Scout | Bard | Support | 36 |
| Dirge | Scout | Bard | Support | 37 |
| Ranger | Scout | Predator | Ranged DPS | 39 |
| Assassin | Scout | Predator | Melee DPS | 40 |
| Beastlord | Scout | *(none)* | Melee DPS | 42 |

Role counts (test invariant): **Tank 6, Healer 7, Support 4, Melee DPS 4,
Ranged DPS 5** = 26.

The intra-pair icon-id ordering (e.g. Guardian 3 / Berserker 4) is verified
during the build by downloading all 26 and visually confirming each against the
known icon before committing.

## Architecture

### `census/classes_db.py`
Mirrors `census/recipes_db.py` / `spells_db.py`:
- `ClassInfo` dataclass.
- `CLASS_SEED: tuple[ClassInfo, ...]` — the 26 records above (the canonical
  hand-authored source).
- `DB_PATH` (env-overridable, default `data/classes/classes.db`).
- `_CREATE_CLASSES` schema: `classes(name TEXT PRIMARY KEY, archetype TEXT,
  subclass TEXT, role TEXT, colour TEXT, display_order INTEGER, icon_id INTEGER)`
  + indexes `idx_classes_archetype`, `idx_classes_role`.
- `init_db(path) -> sqlite3.Connection` (WAL, same conventions).
- `seed(conn)` / `upsert_classes(conn, rows)` — writes `CLASS_SEED`.
- Query helpers: `find_by_name`, `list_all`, `by_role`, `by_archetype`,
  `subclass_of`.

### `scripts/build_classes_db.py`
`init_db()` then `seed()` from `CLASS_SEED`. Instant (no network). Prints a
summary (26 rows, role counts). Equivalent to `download_recipes.py` but for
static data.

### `census/constants.py` (de-dup)
`FIGHTERS / PRIESTS / SCOUTS / MAGES` and the subclass `CLASS_GROUPS` are
derived from `CLASS_SEED` (a Python import — never depends on the `.db`
existing). Existing consumers (`item.py` class-collapsing, etc.) keep working
unchanged because the derived values are identical to today's.

### `GET /api/classes`
New read endpoint (in `web/routes/`), reads `classes.db` via `classes_db.py`,
dispatched through `run_in_executor`, cached (static data → compute once).
Returns the 26 records: `name, archetype, subclass, role, colour,
display_order, icon_url` (`icon_url = /class-icons/{icon_id}.png`).

### Icons
- `scripts/download_class_icons.py` downloads
  `https://u.eq2wire.com/images/class_medium/{icon_id}.png` →
  `data/classes/icons/{icon_id}.png` for the 26 ids, **visually verifying each**
  against the mapping before finalizing.
- Served statically at `/class-icons/{icon_id}.png` (same mechanism as the
  existing spell/AA icon mounts in `web/app.py`).
- The 26 icons are committed (small static assets).

### Frontend
- A small `useClasses` hook/context fetches `/api/classes` once and caches it.
- `classConstants.ts`'s hardcoded `CLASS_COLOURS` is removed; consumers
  (HomePage, GuildPage, ItemSearchPage, ParsePage) read colour from the fetched
  class data. (A thin fallback is acceptable while the fetch is in flight.)

## Testing

Backend unit tests (`tests/census/test_classes_db.py` + a route test):
- `CLASS_SEED` has exactly 26 unique names; every record has a valid archetype
  (∈ 4) and role (∈ 5); `icon_id`s are unique and match the seed table.
- Role counts equal 6/7/4/4/5 (Tank/Healer/Support/Melee/Ranged).
- Beastlord & Channeler have `subclass is None`; all others non-None.
- Derived `constants.py` sets (`FIGHTERS/PRIESTS/SCOUTS/MAGES`, `CLASS_GROUPS`)
  equal their current literal values (regression guard).
- `init_db` + `seed` round-trips: `list_all()` returns 26; `by_role`/
  `by_archetype` partition correctly.
- `GET /api/classes` returns 26 items with the expected fields + `icon_url`.

Frontend: `tsc --noEmit` after removing the hardcoded colour map.

## Rollout

- Build locally: `python scripts/build_classes_db.py`, then hand-copy
  `data/classes/classes.db` to the Railway volume (same as `recipes.db`/
  `spells.db`).
- Run `scripts/download_class_icons.py` once; commit the 26 icons.
- Additive: no migration; existing class consumers unchanged (derived values
  identical).
