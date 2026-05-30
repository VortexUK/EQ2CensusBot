# Parse grouping redo — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the player-count heuristic for parse classification with a deliberate `Guild → (Raid / Dungeon / Other) → fights` hierarchy backed by the rankings leaderboard predicate, and tighten the parse merger so two different guild groups doing the same boss within 60 s don't get merged into one fight.

**Architecture:** Bottom-up, five phases. Each phase is independently committable; phase 1–4 are backend pure-adds or behaviour changes invisible to the UI; phase 5 flips the visible page. Approved spec at [`docs/superpowers/specs/2026-05-30-parse-grouping-redo-design.md`](../specs/2026-05-30-parse-grouping-redo-design.md) (commit `a764716`) is the canonical source for component behaviour, edge cases, and decision rationale.

**Tech Stack:** Python 3.13 + FastAPI + Pydantic v2 + sqlite3 stdlib, React + TypeScript + Tailwind v4 (CSS-first, no Preflight). Tests: pytest, vitest. Run commands: `uv run pytest`, `cd frontend && npm test`. Linters: `uv run ruff format --check`, `uv run ruff check`, `uv run pyright`, `cd frontend && npm run typecheck`.

**Per-task discipline:**
- **No commit step inside any task.** Commits happen only at phase checkpoints, run manually by the controller AFTER user review.
- **Stage only the named files at each checkpoint.** The user has unrelated WIP in the working tree; never `git add -A`.
- **No Census calls in dev** — use the existing `_FAKE_ENCOUNTER` / `_FAKE_COMBATANTS` fixtures or new in-memory sqlite fakes.
- Logging conventions: `_log = logging.getLogger(__name__)`, bracketed `[lowercase-with-hyphens]` prefix per module (none of these tasks add log calls, but keep the convention in mind if you do).

---

## File map

| File | Phase | Action | Notes |
|---|---|---|---|
| `web/routes/parses/list.py` | 1, 2, 3, 4 | modify | new helpers `_top_n_ally_names`, `_all_ally_names`, `_classify_zone`, `_classifier_cache_clear`; `_group_into_fights` signature + new clause; `_encounter_summary` sets `category` |
| `web/routes/rankings.py` | 2 | modify | `invalidate_zones_cache` also calls `_classifier_cache_clear` |
| `web/routes/parses/models.py` | 3 | modify | add `category: Literal["raid","dungeon","other"]` to `ParseEncounterSummary` |
| `tests/web/test_parses_top_n.py` | 1 | create | unit tests for top-N helpers |
| `tests/web/test_parses_classify_zone.py` | 2 | create | unit tests for classifier |
| `tests/web/test_parses_list_category.py` | 3 | create | integration tests for `category` in API response |
| `tests/web/test_parses_list_grouping.py` | 4 | create | integration tests for top-N merge gate |
| `frontend/src/pages/ParsesPage.tsx` | 5 | modify | `ParseEncounterSummary.category` field; `groupEncounters` rewrite to Guild → Category; render hierarchy update; sizeLabel → per-row `<Badge>` |
| `frontend/src/pages/ParsesPage.test.tsx` | 5 | create | render-state tests |

---

## Phase 1 — Top-N ally helpers (backend, pure-add)

**Goal:** Two new helpers in `web/routes/parses/list.py` plus their unit tests. Zero behaviour change — the helpers are unused until Phase 4 wires them into the merger.

### Task 1.1: `_top_n_ally_names` + `_all_ally_names` with unit tests

**Files:**
- Modify: `web/routes/parses/list.py` (add helpers after `_PLAYER_COUNT_SQL` block, before `_list_encounters_sync`)
- Create: `tests/web/test_parses_top_n.py`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/web/test_parses_top_n.py`:

```python
"""Unit tests for the top-N ally encDPS helpers in web/routes/parses/list.py.

These helpers are the building blocks for the Phase 4 merger augmentation:
the top-N ally encDPS lists of two upload candidates must mutually contain
each other (each side's top-N appears somewhere in the other side's full
ally list) for the merger to treat them as the same fight.
"""

from __future__ import annotations

import sqlite3

import pytest

from web.routes.parses.list import _all_ally_names, _top_n_ally_names


@pytest.fixture
def conn() -> sqlite3.Connection:
    """In-memory sqlite with just the columns the helpers read.

    Schema is deliberately minimal — we don't want the helpers' behaviour
    to depend on any column we don't actually query, and the parses DB
    schema itself is tested elsewhere.
    """
    c = sqlite3.connect(":memory:")
    c.execute(
        """
        CREATE TABLE combatants (
            id           INTEGER PRIMARY KEY,
            encounter_id INTEGER NOT NULL,
            name         TEXT NOT NULL,
            ally         INTEGER NOT NULL,
            encdps       REAL NOT NULL DEFAULT 0
        )
        """
    )
    return c


def _insert(conn: sqlite3.Connection, **kwargs) -> None:
    conn.execute(
        "INSERT INTO combatants (encounter_id, name, ally, encdps) VALUES (?, ?, ?, ?)",
        (kwargs["encounter_id"], kwargs["name"], kwargs["ally"], kwargs["encdps"]),
    )


def test_top_n_returns_top_three_by_encdps_desc(conn):
    _insert(conn, encounter_id=1, name="Alpha", ally=1, encdps=9000.0)
    _insert(conn, encounter_id=1, name="Bravo", ally=1, encdps=8000.0)
    _insert(conn, encounter_id=1, name="Charlie", ally=1, encdps=7000.0)
    _insert(conn, encounter_id=1, name="Delta", ally=1, encdps=6000.0)
    assert _top_n_ally_names(conn, 1, 3) == {"Alpha", "Bravo", "Charlie"}


def test_top_n_tiebreaker_is_name_ascending(conn):
    # Three combatants tied at the bottom slot — name ASC settles it.
    _insert(conn, encounter_id=1, name="Alpha", ally=1, encdps=9000.0)
    _insert(conn, encounter_id=1, name="Zeta", ally=1, encdps=5000.0)
    _insert(conn, encounter_id=1, name="Bravo", ally=1, encdps=5000.0)
    _insert(conn, encounter_id=1, name="Mike", ally=1, encdps=5000.0)
    # With N=2: Alpha is clear; tied second slot picks 'Bravo' (ASC).
    assert _top_n_ally_names(conn, 1, 2) == {"Alpha", "Bravo"}


def test_top_n_excludes_non_ally_rows(conn):
    _insert(conn, encounter_id=1, name="Player", ally=1, encdps=8000.0)
    _insert(conn, encounter_id=1, name="Mob", ally=0, encdps=100000.0)
    assert _top_n_ally_names(conn, 1, 3) == {"Player"}


def test_top_n_excludes_unknown_and_empty_names(conn):
    _insert(conn, encounter_id=1, name="Alpha", ally=1, encdps=9000.0)
    _insert(conn, encounter_id=1, name="Unknown", ally=1, encdps=8000.0)
    _insert(conn, encounter_id=1, name="", ally=1, encdps=7000.0)
    assert _top_n_ally_names(conn, 1, 3) == {"Alpha"}


def test_top_n_excludes_multi_word_names(conn):
    # Pets / NPCs typically have multi-word names — single-word filter
    # is the existing rule from _PLAYER_COUNT_SQL.
    _insert(conn, encounter_id=1, name="Alpha", ally=1, encdps=9000.0)
    _insert(conn, encounter_id=1, name="a krait warrior", ally=1, encdps=5000.0)
    _insert(conn, encounter_id=1, name="Bravo's Pet", ally=1, encdps=4000.0)
    assert _top_n_ally_names(conn, 1, 3) == {"Alpha"}


def test_top_n_returns_fewer_when_pool_is_smaller(conn):
    _insert(conn, encounter_id=1, name="Alpha", ally=1, encdps=9000.0)
    _insert(conn, encounter_id=1, name="Bravo", ally=1, encdps=8000.0)
    # Asking for 5 from a pool of 2 — returns the pool.
    assert _top_n_ally_names(conn, 1, 5) == {"Alpha", "Bravo"}


def test_top_n_returns_empty_set_for_no_allies(conn):
    _insert(conn, encounter_id=1, name="Mob", ally=0, encdps=10000.0)
    assert _top_n_ally_names(conn, 1, 3) == set()


def test_top_n_scopes_to_encounter_id(conn):
    _insert(conn, encounter_id=1, name="Alpha", ally=1, encdps=9000.0)
    _insert(conn, encounter_id=2, name="Bravo", ally=1, encdps=9000.0)
    assert _top_n_ally_names(conn, 1, 3) == {"Alpha"}
    assert _top_n_ally_names(conn, 2, 3) == {"Bravo"}


def test_all_ally_names_returns_every_qualifying_ally(conn):
    _insert(conn, encounter_id=1, name="Alpha", ally=1, encdps=9000.0)
    _insert(conn, encounter_id=1, name="Bravo", ally=1, encdps=8000.0)
    _insert(conn, encounter_id=1, name="Charlie", ally=1, encdps=7000.0)
    _insert(conn, encounter_id=1, name="Mob", ally=0, encdps=10000.0)
    _insert(conn, encounter_id=1, name="Unknown", ally=1, encdps=6000.0)
    _insert(conn, encounter_id=1, name="a krait warrior", ally=1, encdps=5000.0)
    assert _all_ally_names(conn, 1) == {"Alpha", "Bravo", "Charlie"}


def test_all_ally_names_returns_empty_when_no_qualifying(conn):
    _insert(conn, encounter_id=1, name="Mob", ally=0, encdps=10000.0)
    assert _all_ally_names(conn, 1) == set()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/web/test_parses_top_n.py -v`

Expected: every test errors with `ImportError: cannot import name '_top_n_ally_names' from 'web.routes.parses.list'`.

- [ ] **Step 3: Implement the helpers**

In `web/routes/parses/list.py`, add these two functions immediately after the `_PLAYER_COUNT_SQL` constant (currently ends at line 76) and before `_list_encounters_sync` (currently line 79):

```python
# Top-N ally helpers — the building blocks for the merger's top-N
# mutual-containment gate (see Phase 4 of the 2026-05-30 parse-grouping-redo
# plan). The filter mirrors _PLAYER_COUNT_SQL exactly so "top players" and
# "is a player" agree about who counts: ally=1, single-word, not the
# 'Unknown' rollup, not the empty-name row.
_TOP_N_ALLY_SQL = """\
    SELECT name FROM combatants
    WHERE encounter_id = ? AND ally = 1
      AND name != '' AND name != 'Unknown' AND instr(name, ' ') = 0
    ORDER BY encdps DESC, name ASC
    LIMIT ?
"""

_ALL_ALLY_SQL = """\
    SELECT name FROM combatants
    WHERE encounter_id = ? AND ally = 1
      AND name != '' AND name != 'Unknown' AND instr(name, ' ') = 0
"""


def _top_n_ally_names(conn: sqlite3.Connection, encounter_id: int, n: int) -> set[str]:
    """Return the top-N player names in this encounter by encDPS descending.

    Tiebreaker on name ASC so two combatants with identical encDPS pick the
    same N — important because the merger uses ``set ==`` semantics on these
    lists and a flapping last slot would break determinism.

    Returns ``min(n, available)`` names if the encounter has fewer qualifying
    allies than ``n``. Empty set when there are no qualifying allies at all
    (e.g. an empty-ally parse) — that case still merges trivially under the
    Phase 4 mutual-containment rule (``set() ⊆ X`` is always true)."""
    return {row[0] for row in conn.execute(_TOP_N_ALLY_SQL, (encounter_id, n))}


def _all_ally_names(conn: sqlite3.Connection, encounter_id: int) -> set[str]:
    """Every qualifying player name in the encounter. Pairs with
    ``_top_n_ally_names`` to evaluate the merger's mutual-containment rule
    (``top_N(A) ⊆ allies(B)`` and vice versa)."""
    return {row[0] for row in conn.execute(_ALL_ALLY_SQL, (encounter_id,))}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/web/test_parses_top_n.py -v`

Expected: 9 passed.

- [ ] **Step 5: Type + lint check**

Run: `uv run ruff format --check web/routes/parses/list.py tests/web/test_parses_top_n.py`
Run: `uv run ruff check web/routes/parses/list.py tests/web/test_parses_top_n.py`
Run: `uv run pyright web/routes/parses/list.py`

Expected: all clean. If ruff format wants changes, run `uv run ruff format` on those two files.

### Phase 1 checkpoint (manual, run after user signs off)

```powershell
git add web/routes/parses/list.py tests/web/test_parses_top_n.py
git commit -m "parses: add _top_n_ally_names + _all_ally_names helpers

Two pure-read SQL helpers in web/routes/parses/list.py for top-N
ally encDPS lookup, filter matches _PLAYER_COUNT_SQL (ally=1,
single-word, not 'Unknown'). Tiebreaker on name ASC for determinism.
Unused until Phase 4 wires them into _group_into_fights.

Part of: docs/superpowers/plans/2026-05-30-parse-grouping-redo.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 — Zone classifier (backend, pure-add)

**Goal:** A `_classify_zone(zone) -> Literal["raid","dungeon","other"]` helper that mirrors the rankings page's leaderboard predicate exactly. Wire its cache-clear into the existing `invalidate_zones_cache` so the eight admin call sites already in `web/routes/zones_admin.py` keep the new map in sync for free.

### Task 2.1: `_classify_zone` + cache hook + unit tests

**Files:**
- Modify: `web/routes/parses/list.py` (add classifier section after the top-N helpers from Phase 1)
- Modify: `web/routes/rankings.py:195-203` (extend `invalidate_zones_cache`)
- Create: `tests/web/test_parses_classify_zone.py`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/web/test_parses_classify_zone.py`:

```python
"""Unit tests for the zone classifier in web/routes/parses/list.py.

The classifier mirrors the rankings page's leaderboard predicate exactly:
a zone is 'on the leaderboard' iff (a) its type token is 'raid_x4' or
'dungeon' AND (b) it has ≥1 row in zone_encounters (a curator has
populated at least one boss for it). Anything else is 'other'.

The implementation reuses rankings._cached_zones_data so the classifier
and the rankings dropdowns are guaranteed in lockstep. Cache invalidation
rides invalidate_zones_cache() so admin curator edits propagate without
a separate hook.
"""

from __future__ import annotations

from unittest.mock import patch

from web.routes.parses.list import _classifier_cache_clear, _classify_zone


def _fake_trees(raid_zones: list[str], dungeon_zones: list[str]):
    """Mirror the (boss_index, raid_tree, dungeon_tree) shape that
    rankings._cached_zones_data returns. Tests only need the names."""
    return (
        {},
        [{"zone": z, "expansion": "EoF", "bosses": ["X"]} for z in raid_zones],
        [{"zone": z, "expansion": "EoF", "bosses": ["X"]} for z in dungeon_zones],
    )


def test_classify_returns_raid_for_raid_x4_with_bosses():
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], ["Halls of Fate"]),
    ):
        _classifier_cache_clear()
        assert _classify_zone("Castle Mistmoore") == "raid"


def test_classify_returns_dungeon_for_dungeon_with_bosses():
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], ["Halls of Fate"]),
    ):
        _classifier_cache_clear()
        assert _classify_zone("Halls of Fate") == "dungeon"


def test_classify_returns_other_for_unlisted_zone():
    # 'Antonica' is an open-world overland and has neither a raid_x4 nor
    # dungeon type — must classify Other regardless of what's in zones.db.
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], ["Halls of Fate"]),
    ):
        _classifier_cache_clear()
        assert _classify_zone("Antonica") == "other"


def test_classify_returns_other_for_zone_without_curated_bosses():
    # A 'dungeon'-type zone with zero zone_encounters rows does NOT appear in
    # the dungeon_tree (rankings._cached_zones_data's subquery requires
    # 'z.id IN (SELECT DISTINCT zone_id FROM zone_encounters)'). So our
    # classifier — which derives its map from that same tree — naturally
    # returns Other. This test pins that behaviour.
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees([], []),  # no zones populated yet
    ):
        _classifier_cache_clear()
        assert _classify_zone("Halls of Fate") == "other"


def test_classify_returns_other_for_none_or_empty():
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], []),
    ):
        _classifier_cache_clear()
        assert _classify_zone(None) == "other"
        assert _classify_zone("") == "other"
        assert _classify_zone("(unknown zone)") == "other"


def test_classify_is_case_insensitive():
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], []),
    ):
        _classifier_cache_clear()
        assert _classify_zone("CASTLE MISTMOORE") == "raid"
        assert _classify_zone("castle mistmoore") == "raid"
        assert _classify_zone("Castle MistmoorE") == "raid"


def test_classify_resolves_aliases():
    # When the parse's `zone` doesn't match a canonical name directly but
    # zones_db.find_by_name resolves it to one that's on the leaderboard,
    # the classifier should still bucket it correctly.
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], []),
    ), patch(
        "web.routes.parses.list.zones_db.find_by_name",
        return_value={"name": "Castle Mistmoore"},
    ):
        _classifier_cache_clear()
        assert _classify_zone("Mistmoore Castle") == "raid"


def test_classify_falls_through_to_other_when_alias_misses():
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], []),
    ), patch(
        "web.routes.parses.list.zones_db.find_by_name",
        return_value=None,
    ):
        _classifier_cache_clear()
        assert _classify_zone("Some Random Zone") == "other"


def test_classifier_cache_clear_picks_up_new_trees():
    # Curator adds bosses to a previously-empty dungeon → second classify
    # after cache_clear should now return 'dungeon'.
    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees([], []),
    ):
        _classifier_cache_clear()
        assert _classify_zone("Halls of Fate") == "other"

    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees([], ["Halls of Fate"]),
    ):
        _classifier_cache_clear()
        assert _classify_zone("Halls of Fate") == "dungeon"


def test_invalidate_zones_cache_also_clears_classifier_map():
    """The Phase 2 spec wires _classifier_cache_clear into
    rankings.invalidate_zones_cache so the 8 admin call sites in
    web/routes/zones_admin.py don't each need their own hook. Verify by
    populating the map, calling invalidate_zones_cache, repopulating with
    a different fake, and checking the new result wins."""
    from web.routes.rankings import invalidate_zones_cache

    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees(["Castle Mistmoore"], []),
    ):
        _classifier_cache_clear()
        assert _classify_zone("Castle Mistmoore") == "raid"

    invalidate_zones_cache()

    with patch(
        "web.routes.parses.list._cached_zones_data",
        return_value=_fake_trees([], []),
    ):
        # Cache is empty after invalidation, so the next classify rebuilds
        # from the new (empty) trees → Other.
        assert _classify_zone("Castle Mistmoore") == "other"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/web/test_parses_classify_zone.py -v`

Expected: `ImportError: cannot import name '_classify_zone'`.

- [ ] **Step 3: Implement the classifier**

In `web/routes/parses/list.py`, add to the imports near the top (after the existing import block at lines 8–42):

```python
from typing import Literal

from census import zones_db
from web.routes.rankings import _cached_zones_data
```

Then add this new section immediately after `_all_ally_names` (which Phase 1 added):

```python
# ── Zone classifier ──────────────────────────────────────────────────────
# Bucket a parse's zone into Raid / Dungeon / Other for the ParsesPage
# Guild → Category hierarchy. Mirror the rankings page's leaderboard
# predicate exactly so the dropdown set and the classifier set are
# guaranteed in lockstep: a zone counts iff (a) it has the right type AND
# (b) ≥1 row in zone_encounters. _cached_zones_data already embeds (b) in
# the trees it returns, so we just derive the lookup map from those.

_LEADERBOARD_MAP: dict[str, Literal["raid", "dungeon"]] | None = None


def _classifier_cache_clear() -> None:
    """Reset the lazily-built classifier map. Called from
    rankings.invalidate_zones_cache so the eight admin curator hooks that
    already invalidate the rankings cache also invalidate this one — no
    need to retrofit every call site."""
    global _LEADERBOARD_MAP
    _LEADERBOARD_MAP = None


def _build_leaderboard_map() -> dict[str, Literal["raid", "dungeon"]]:
    """Materialise {zone_name_lower: category} from the cached zone trees.

    Dungeons win ties with raids — neither test data nor real EQ2 data
    should ever assign a single zone BOTH ``raid_x4`` AND ``dungeon``
    types, but if a curator ever does, the rankings page would surface
    it under both dropdowns. Picking "dungeon" here is arbitrary; flag
    this in the audit if it happens in practice."""
    _, raid_tree, dungeon_tree = _cached_zones_data()
    out: dict[str, Literal["raid", "dungeon"]] = {entry["zone"].lower(): "raid" for entry in raid_tree}
    for entry in dungeon_tree:
        out[entry["zone"].lower()] = "dungeon"
    return out


def _classify_zone(zone: str | None) -> Literal["raid", "dungeon", "other"]:
    """Bucket the parse's zone for the Guild → (Raid / Dungeon / Other)
    hierarchy.

    Lookup order:
      1. Empty / None / '(unknown zone)' → 'other'.
      2. Lowercase exact match in the cached leaderboard map.
      3. Alias resolution via ``zones_db.find_by_name`` → retry exact
         match on the canonical name.
      4. Fall through → 'other'.
    """
    if not zone or zone == "(unknown zone)":
        return "other"
    global _LEADERBOARD_MAP
    if _LEADERBOARD_MAP is None:
        _LEADERBOARD_MAP = _build_leaderboard_map()
    hit = _LEADERBOARD_MAP.get(zone.lower())
    if hit is not None:
        return hit
    canonical = zones_db.find_by_name(zone)
    if canonical:
        hit = _LEADERBOARD_MAP.get(canonical["name"].lower())
        if hit is not None:
            return hit
    return "other"
```

- [ ] **Step 4: Wire the cache-clear into `invalidate_zones_cache`**

Modify `web/routes/rankings.py:195-203`:

```python
def invalidate_zones_cache() -> None:
    """Clear the _cached_zones_data lru_cache AND the parses
    classifier's leaderboard map.

    Call this after any mutation to zones / zone_encounters /
    zone_encounter_mobs so the next /api/rankings/filters request rebuilds
    the dropdown tree from disk, and the next /api/parses request rebuilds
    the classifier map (which is derived from the same trees). Without
    this the rankings dropdown shows a stale view of the roster, and the
    parses page misclassifies new/updated zones, until the process
    restarts.
    """
    _cached_zones_data.cache_clear()
    # Local import to avoid a circular dependency at module load time —
    # parses.list already imports _cached_zones_data from this module.
    from web.routes.parses.list import _classifier_cache_clear

    _classifier_cache_clear()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/web/test_parses_classify_zone.py -v`

Expected: 10 passed.

- [ ] **Step 6: Re-run Phase 1 tests + lint/type checks**

Run: `uv run pytest tests/web/test_parses_top_n.py tests/web/test_parses_classify_zone.py -v`

Expected: all green.

Run: `uv run ruff format --check web/routes/parses/list.py web/routes/rankings.py tests/web/test_parses_classify_zone.py`
Run: `uv run ruff check web/routes/parses/list.py web/routes/rankings.py tests/web/test_parses_classify_zone.py`
Run: `uv run pyright web/routes/parses/list.py web/routes/rankings.py`

Expected: all clean.

### Phase 2 checkpoint (manual, run after user signs off)

```powershell
git add web/routes/parses/list.py web/routes/rankings.py tests/web/test_parses_classify_zone.py
git commit -m "parses: zone classifier (Raid / Dungeon / Other)

_classify_zone(zone) reuses rankings._cached_zones_data so the classifier
set and the rankings dropdowns are guaranteed in lockstep — same
'has the right type AND ≥1 curated boss' predicate. Map is built
lazily and cached; the cache-clear hooks into the existing
invalidate_zones_cache() so the eight admin curator call sites in
zones_admin.py keep both caches in sync without retrofit.

Alias resolution via zones_db.find_by_name catches casing/punctuation
variance in the ACT log's zone string.

Helper is unused until Phase 3 wires it into the API response.

Part of: docs/superpowers/plans/2026-05-30-parse-grouping-redo.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 — API field (backend, additive)

**Goal:** Add `category` to `ParseEncounterSummary` and populate it in `_encounter_summary`. Frontend ignores the new field until Phase 5, so this is fully backward-compatible.

### Task 3.1: Add `category` field + wire helper + integration tests

**Files:**
- Modify: `web/routes/parses/models.py:52-82` (add `category` to `ParseEncounterSummary`)
- Modify: `web/routes/parses/list.py:323-346` (set `category` in `_encounter_summary`)
- Create: `tests/web/test_parses_list_category.py`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/web/test_parses_list_category.py`:

```python
"""Tests for the `category` field on /api/parses responses.

The field is computed at query time from _classify_zone(row.zone) and
attached to every ParseEncounterSummary. Frontend reads it in Phase 5;
backend ships it from Phase 3 onwards.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from tests.fixtures.users import make_fake_require_user, make_fake_user
from tests.web._parses_fixtures import _FAKE_ENCOUNTER

_fake_user = make_fake_require_user(make_fake_user(id="123456789"))


@pytest.mark.asyncio
async def test_list_includes_category_on_every_fight(app):
    fake_list_sync = MagicMock(return_value=[dict(_FAKE_ENCOUNTER, combatant_count=2, player_count=1)])

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", fake_list_sync),
        patch("web.routes.parses.list._classify_zone", return_value="other"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    data = r.json()
    assert len(data["results"]) == 1
    assert "category" in data["results"][0]


@pytest.mark.asyncio
async def test_raid_zone_classifies_as_raid(app):
    fake_list_sync = MagicMock(
        return_value=[dict(_FAKE_ENCOUNTER, zone="Castle Mistmoore", combatant_count=2, player_count=1)],
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", fake_list_sync),
        patch("web.routes.parses.list._classify_zone", return_value="raid"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["results"][0]["category"] == "raid"


@pytest.mark.asyncio
async def test_dungeon_zone_classifies_as_dungeon(app):
    fake_list_sync = MagicMock(
        return_value=[dict(_FAKE_ENCOUNTER, zone="Halls of Fate", combatant_count=2, player_count=1)],
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", fake_list_sync),
        patch("web.routes.parses.list._classify_zone", return_value="dungeon"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["results"][0]["category"] == "dungeon"


@pytest.mark.asyncio
async def test_unknown_zone_classifies_as_other(app):
    fake_list_sync = MagicMock(
        return_value=[dict(_FAKE_ENCOUNTER, zone=None, combatant_count=2, player_count=1)],
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", fake_list_sync),
        # No patch on _classify_zone — let the real helper run; it returns
        # "other" for None per its own spec, no zones.db needed.
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["results"][0]["category"] == "other"


@pytest.mark.asyncio
async def test_classifier_called_with_row_zone(app):
    fake_list_sync = MagicMock(
        return_value=[dict(_FAKE_ENCOUNTER, zone="Castle Mistmoore", combatant_count=2, player_count=1)],
    )
    fake_classify = MagicMock(return_value="raid")

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", fake_list_sync),
        patch("web.routes.parses.list._classify_zone", fake_classify),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.get("/api/parses")

    fake_classify.assert_called_once_with("Castle Mistmoore")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/web/test_parses_list_category.py -v`

Expected: tests fail because `category` is not in the response (field doesn't exist on the model yet).

- [ ] **Step 3: Add `category` to the Pydantic model**

In `web/routes/parses/models.py`, update the imports at line 10:

```python
from typing import Literal

from pydantic import BaseModel, Field
```

Then modify `ParseEncounterSummary` (lines 52–82). Insert the new field immediately after `player_count: int` (line 72), preserving every other field's order and defaults:

```python
class ParseEncounterSummary(BaseModel):
    """One FIGHT. Top-level fields are from the canonical upload (the
    raider whose ACT captured the longest duration); `uploads` holds every
    raider's view of the same fight. Mirror grouping is by
    (guild_name, title, started_at within ±MIRROR_WINDOW_S) and only ever
    merges uploads from *distinct* uploaders."""

    id: int
    act_encid: str
    title: str
    zone: str | None
    started_at: int  # unix seconds, UTC
    ended_at: int
    duration_s: int
    total_damage: int
    encdps: float
    kills: int
    deaths: int
    success_level: int  # ACT enum: 0=unknown, 1=win, 2=loss, 3=mixed
    combatant_count: int
    player_count: int  # ally combatants with single-word names, excluding 'Unknown'
    # Backed by web/routes/parses/list.py:_classify_zone — Raid / Dungeon /
    # Other bucketing for the ParsesPage hierarchy. Computed at query time
    # from the zone field against zones.db; not persisted on the encounters
    # table.
    category: Literal["raid", "dungeon", "other"]
    uploaded_by: str  # who ingested the canonical upload; 'local' for local-only era
    # Discord identity of the canonical upload's submitter — same shape as
    # ParseUploadSummary's fields. Surfaced here too so the list view can
    # render the badge directly without needing to dig into uploads[0].
    uploader_discord_id: str | None = None
    uploader_display_name: str | None = None
    guild_name: str | None  # stamped at ingest time from uploader's Census guild
    permissions: ParsePermissions = ParsePermissions()
    uploads: list[ParseUploadSummary] = []  # always at least 1 (the canonical itself)
```

- [ ] **Step 4: Wire `_classify_zone` into `_encounter_summary`**

In `web/routes/parses/list.py`, modify `_encounter_summary` (lines 323–346). Pass `category=_classify_zone(f.get("zone"))` into the `ParseEncounterSummary` constructor, preserving every other field:

```python
    def _encounter_summary(f: dict) -> ParseEncounterSummary:
        did = _uploader_discord_id(f.get("source_dsn"))
        return ParseEncounterSummary(
            id=f["id"],
            act_encid=f["act_encid"],
            title=f["title"],
            zone=f["zone"],
            started_at=f["started_at"],
            ended_at=f["ended_at"],
            duration_s=f["duration_s"],
            total_damage=f["total_damage"],
            encdps=f["encdps"],
            kills=f["kills"],
            deaths=f["deaths"],
            success_level=f.get("success_level", 0) or 0,
            combatant_count=f.get("combatant_count", 0),
            player_count=f.get("player_count", 0),
            category=_classify_zone(f.get("zone")),
            uploaded_by=f.get("uploaded_by") or "local",
            uploader_discord_id=did,
            uploader_display_name=uploader_names.get(did) if did else None,
            guild_name=f.get("guild_name"),
            permissions=permissions.get(f["id"], ParsePermissions()),
            uploads=[_upload_summary(u) for u in f["uploads"]],
        )
```

- [ ] **Step 5: Run new tests + the existing parses list tests**

Run: `uv run pytest tests/web/test_parses_list_category.py tests/web/test_parses_list.py -v`

Expected: all green. (The existing test_parses_list.py tests should still pass — they don't assert on `category` so the new field flows through silently.)

- [ ] **Step 6: Lint + type check**

Run: `uv run ruff format --check web/routes/parses/list.py web/routes/parses/models.py tests/web/test_parses_list_category.py`
Run: `uv run ruff check web/routes/parses/list.py web/routes/parses/models.py tests/web/test_parses_list_category.py`
Run: `uv run pyright web/routes/parses/list.py web/routes/parses/models.py`

Expected: all clean.

### Phase 3 checkpoint (manual, run after user signs off)

```powershell
git add web/routes/parses/list.py web/routes/parses/models.py tests/web/test_parses_list_category.py
git commit -m "parses: surface category on /api/parses response

Adds `category: Literal['raid','dungeon','other']` to
ParseEncounterSummary, populated at query time by _classify_zone(zone).
Frontend ignores the field until Phase 5; this commit is fully
backward-compatible.

Part of: docs/superpowers/plans/2026-05-30-parse-grouping-redo.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4 — Augmented merger (backend, behaviour change)

**Goal:** Add the top-N mutual-containment clause to `_group_into_fights`. Pass a sqlite connection through from the route handler. Keep every other gate intact.

### Task 4.1: Augment `_group_into_fights` + update caller + integration tests

**Files:**
- Modify: `web/routes/parses/list.py:128-187` (signature + new clause in `_group_into_fights`)
- Modify: `web/routes/parses/list.py:280-287` (caller passes a `conn`)
- Create: `tests/web/test_parses_list_grouping.py`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/web/test_parses_list_grouping.py`:

```python
"""Tests for the Phase 4 top-N mutual-containment merge gate in
web/routes/parses/list.py:_group_into_fights.

Today's merger merges two uploads when (different uploaders) AND (same
guild_name) AND (same title) AND (start times within 60 s). Phase 4 adds
one more clause: each upload's top-N ally encDPS combatants must appear
in the other upload's ally list (mutual containment).

N is 3 if max(player_count_A, player_count_B) >= 7 else 2. Tests verify
both the N selection boundary and the containment-vs-equality semantics.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from tests.fixtures.users import make_fake_require_user, make_fake_user
from tests.web._parses_fixtures import _FAKE_ENCOUNTER

_fake_user = make_fake_require_user(make_fake_user(id="123456789"))


def _two_uploads(*, top_a: set[str], all_a: set[str], top_b: set[str], all_b: set[str],
                  player_count: int = 12, time_offset_s: int = 5):
    """Build two encounter dicts ready for _group_into_fights and a side-effect
    map that the patched top-N helpers should return for each encounter_id.

    All four sets are the parameters that drive the merge decision. The
    other gates (different uploaders, same guild + title, within 60 s) are
    held constant so the test focuses on the new clause alone."""
    base = _FAKE_ENCOUNTER["started_at"]
    a = dict(_FAKE_ENCOUNTER, id=10, uploaded_by="Alpha", started_at=base, player_count=player_count, combatant_count=player_count + 1)
    b = dict(_FAKE_ENCOUNTER, id=11, uploaded_by="Bravo", started_at=base + time_offset_s, player_count=player_count, combatant_count=player_count + 1)

    def fake_top(_conn, enc_id, _n):
        return {10: top_a, 11: top_b}[enc_id]

    def fake_all(_conn, enc_id):
        return {10: all_a, 11: all_b}[enc_id]

    return [a, b], fake_top, fake_all


@pytest.mark.asyncio
async def test_identical_top_three_merges(app):
    """Two uploads of the same raid fight — identical top 3, identical
    ally rosters. Today's gates pass + new top-N gate passes → ONE fight."""
    rows, fake_top, fake_all = _two_uploads(
        top_a={"P1", "P2", "P3"}, all_a={"P1", "P2", "P3", "P4", "P5"},
        top_b={"P1", "P2", "P3"}, all_b={"P1", "P2", "P3", "P4", "P5"},
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", MagicMock(return_value=rows)),
        patch("web.routes.parses.list._top_n_ally_names", side_effect=fake_top),
        patch("web.routes.parses.list._all_ally_names", side_effect=fake_all),
        patch("web.routes.parses.list._classify_zone", return_value="raid"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1, "identical top-3 should merge"
    assert {u["uploaded_by"] for u in data["results"][0]["uploads"]} == {"Alpha", "Bravo"}


@pytest.mark.asyncio
async def test_disjoint_top_three_does_not_merge(app):
    """Two different groups of Guild X simultaneously doing Tarinax — same
    guild, same title, within 60 s — but completely different rosters.
    The pre-Phase-4 merger would merge them; the new gate rejects the merge."""
    rows, fake_top, fake_all = _two_uploads(
        top_a={"P1", "P2", "P3"}, all_a={"P1", "P2", "P3", "P4", "P5"},
        top_b={"Q1", "Q2", "Q3"}, all_b={"Q1", "Q2", "Q3", "Q4", "Q5"},
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", MagicMock(return_value=rows)),
        patch("web.routes.parses.list._top_n_ally_names", side_effect=fake_top),
        patch("web.routes.parses.list._all_ally_names", side_effect=fake_all),
        patch("web.routes.parses.list._classify_zone", return_value="raid"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 2, "disjoint top-3 should NOT merge"


@pytest.mark.asyncio
async def test_one_sided_containment_does_not_merge(app):
    """A's top 3 are all in B's allies (containment one direction) but
    B's top 3 are NOT all in A's allies (containment fails the other way).
    Mutual containment requires both directions; this case must NOT merge."""
    rows, fake_top, fake_all = _two_uploads(
        top_a={"P1", "P2", "P3"}, all_a={"P1", "P2", "P3"},  # A only saw 3 allies
        top_b={"Q1", "Q2", "Q3"}, all_b={"Q1", "Q2", "Q3", "P1", "P2", "P3"},  # B's allies include all of A's top
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", MagicMock(return_value=rows)),
        patch("web.routes.parses.list._top_n_ally_names", side_effect=fake_top),
        patch("web.routes.parses.list._all_ally_names", side_effect=fake_all),
        patch("web.routes.parses.list._classify_zone", return_value="raid"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["total"] == 2


@pytest.mark.asyncio
async def test_partial_top_n_overlap_with_full_containment_merges(app):
    """A's top 3 = {P1, P2, P3}; B's top 3 = {P1, P2, P4} (one different).
    Each side's top-N IS fully contained in the other side's full ally list
    (P4 is in A's all_allies even if not A's top-3). The mutual-containment
    rule allows this case — the difference is ACT in upload A and B
    ranking the bottom slots slightly differently, but it's the same fight."""
    rows, fake_top, fake_all = _two_uploads(
        top_a={"P1", "P2", "P3"}, all_a={"P1", "P2", "P3", "P4", "P5"},
        top_b={"P1", "P2", "P4"}, all_b={"P1", "P2", "P3", "P4", "P5"},
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", MagicMock(return_value=rows)),
        patch("web.routes.parses.list._top_n_ally_names", side_effect=fake_top),
        patch("web.routes.parses.list._all_ally_names", side_effect=fake_all),
        patch("web.routes.parses.list._classify_zone", return_value="raid"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["total"] == 1


@pytest.mark.asyncio
async def test_group_bucket_uses_n_equals_two(app):
    """Both uploads have player_count=5 → group bucket → N=2. Identical
    top-2 should merge; differing third slot doesn't matter."""
    rows, fake_top, fake_all = _two_uploads(
        top_a={"P1", "P2"}, all_a={"P1", "P2", "P3"},
        top_b={"P1", "P2"}, all_b={"P1", "P2", "P3"},
        player_count=5,
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", MagicMock(return_value=rows)),
        patch("web.routes.parses.list._top_n_ally_names", side_effect=fake_top),
        patch("web.routes.parses.list._all_ally_names", side_effect=fake_all),
        patch("web.routes.parses.list._classify_zone", return_value="dungeon"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["total"] == 1


@pytest.mark.asyncio
async def test_boundary_one_seven_one_six_uses_n_three(app):
    """One upload has player_count=7 (just into raid bucket); the other
    has player_count=6 (group bucket). max(7,6) >= 7 so N=3 wins. Both
    sides happen to share an identical top 3, so the merge should succeed."""
    base = _FAKE_ENCOUNTER["started_at"]
    a = dict(_FAKE_ENCOUNTER, id=10, uploaded_by="Alpha", started_at=base, player_count=7, combatant_count=8)
    b = dict(_FAKE_ENCOUNTER, id=11, uploaded_by="Bravo", started_at=base + 5, player_count=6, combatant_count=7)

    # The patched helpers must respect the N argument the merger passes —
    # capture it so the assertion below is meaningful.
    captured_n: list[int] = []

    def fake_top(_conn, enc_id, n):
        captured_n.append(n)
        return {10: {"P1", "P2", "P3"}, 11: {"P1", "P2", "P3"}}[enc_id]

    def fake_all(_conn, enc_id):
        return {10: {"P1", "P2", "P3", "P4"}, 11: {"P1", "P2", "P3", "P4"}}[enc_id]

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", MagicMock(return_value=[a, b])),
        patch("web.routes.parses.list._top_n_ally_names", side_effect=fake_top),
        patch("web.routes.parses.list._all_ally_names", side_effect=fake_all),
        patch("web.routes.parses.list._classify_zone", return_value="raid"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert 3 in captured_n, "N should be 3 when max(player_count) >= 7"


@pytest.mark.asyncio
async def test_empty_ally_uploads_still_merge(app):
    """Two uploads with no qualifying ally combatants (e.g. ACT logged
    only NPC damage). Top-N is empty set on both sides. The mutual-
    containment rule reduces to set() ⊆ set() which is trivially true,
    so the merge falls back to the existing gates alone."""
    rows, fake_top, fake_all = _two_uploads(
        top_a=set(), all_a=set(),
        top_b=set(), all_b=set(),
        player_count=0,
    )

    with (
        patch("web.routes.parses.list._require_user", _fake_user),
        patch("web.routes.parses.list._list_encounters_sync", MagicMock(return_value=rows)),
        patch("web.routes.parses.list._top_n_ally_names", side_effect=fake_top),
        patch("web.routes.parses.list._all_ally_names", side_effect=fake_all),
        patch("web.routes.parses.list._classify_zone", return_value="other"),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    assert r.status_code == 200
    assert r.json()["total"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/web/test_parses_list_grouping.py -v`

Expected: most tests fail because the merger doesn't run the top-N check yet. (`test_identical_top_three_merges`, `test_group_bucket_uses_n_equals_two`, `test_boundary_one_seven_one_six_uses_n_three`, `test_partial_top_n_overlap_with_full_containment_merges`, `test_empty_ally_uploads_still_merge` may already pass — they exercise cases the existing merger handles correctly. `test_disjoint_top_three_does_not_merge` and `test_one_sided_containment_does_not_merge` MUST fail today.)

- [ ] **Step 3: Update `_group_into_fights` signature + add the clause**

In `web/routes/parses/list.py`, replace the current `_group_into_fights` (lines 128–187) with:

```python
def _group_into_fights(encounters: list[dict], conn: sqlite3.Connection) -> list[dict]:
    """Greedy mirror-grouping. Two uploads are the same fight when ALL of:
      - they come from *different* uploaders,
      - their guild + title match,
      - any pair of start times falls within ``PARSE_MIRROR_WINDOW_S``, AND
      - their top-N ally encDPS lists mutually contain each other
        (each side's top-N appears somewhere in the other side's full
        ally list). N = 3 if either upload is in the raid bucket
        (``player_count >= 7``), else 2.

    Same-uploader uploads are never merged — one raider can't mirror their
    own fight, so two of their uploads are two real fights. The canonical
    upload (carried as the top-level fields on the returned dict) is the
    longest-duration upload in the group — the raider whose ACT captured
    the most fight time.

    The top-N gate (added 2026-05-30) catches the case of two of the same
    guild's groups simultaneously doing the same boss — the older gates
    alone would have merged them.

    Each returned group dict looks like::

        {
            # ...all fields of the canonical upload row...
            "uploads": [<every upload dict, including the canonical>],
        }

    The ``conn`` argument lets the top-N gate query ``combatants`` rows
    without re-opening the parses DB per pair. Caller is responsible for
    the connection lifetime."""
    if not encounters:
        return []
    # Sort by started_at ASC so we attach in chronological order — late
    # stragglers reach the group whose existing members include their
    # closest neighbour.
    sorted_encs = sorted(encounters, key=lambda e: e["started_at"])
    groups: list[dict] = []
    for e in sorted_encs:
        attached = False
        for g in groups:
            if g["title"] != e["title"]:
                continue
            if g.get("guild_name") != e.get("guild_name"):
                continue
            # A mirror is the SAME fight captured by a DIFFERENT raider. Two
            # uploads from the same uploader are always distinct fights (a
            # same-encid re-upload is deduped at ingest), so never merge
            # them — even if title/guild/start-time all line up (e.g. the
            # same boss pulled twice within the window).
            if any((u.get("uploaded_by") or "local") == (e.get("uploaded_by") or "local") for u in g["uploads"]):
                continue
            # Compare against every member so a late straggler still attaches
            # even if the first uploader's start time drifted out of window.
            if not any(abs(u["started_at"] - e["started_at"]) <= PARSE_MIRROR_WINDOW_S for u in g["uploads"]):
                continue
            # Top-N mutual containment: each upload's top-N ally encDPS
            # combatants must appear *somewhere* in the other upload's
            # ally list. Prevents two different groups doing the same
            # boss within 60s of each other from merging into one fight
            # when they share guild + title but have entirely different
            # rosters.
            #
            # Compare new upload against the CANONICAL upload in the
            # group. Group membership is overlap-transitive only THROUGH
            # the canonical — every prior member overlapped with the
            # then-canonical at the time of joining, not member-to-
            # member. The canonical can also swap mid-group when a
            # longer-duration upload joins, so the join criterion has a
            # moving target. Both are acceptable for v1 — the
            # pathological case (a new join overlaps the current
            # canonical but would have failed against an earlier
            # member's roster) is rare in practice.
            n = 3 if max(g.get("player_count", 0), e.get("player_count", 0)) >= 7 else 2
            top_e = _top_n_ally_names(conn, e["id"], n)
            all_e = _all_ally_names(conn, e["id"])
            top_g = _top_n_ally_names(conn, g["id"], n)
            all_g = _all_ally_names(conn, g["id"])
            if not (top_e.issubset(all_g) and top_g.issubset(all_e)):
                continue
            g["uploads"].append(e)
            # Promote to canonical if this upload captured a longer fight.
            if e["duration_s"] > g["duration_s"]:
                kept_uploads = g["uploads"]
                g.clear()
                g.update(e)
                g["uploads"] = kept_uploads
            attached = True
            break
        if not attached:
            new_group = dict(e)
            new_group["uploads"] = [e]
            groups.append(new_group)

    # Render order: most-recent fight first.
    groups.sort(key=lambda g: g["started_at"], reverse=True)
    return groups
```

- [ ] **Step 4: Update the caller in `list_parses` to pass a `conn`**

In `web/routes/parses/list.py`, find the call to `_group_into_fights` (currently line 285). Replace the surrounding block (lines 280–287) with the version below — opens one read-only connection on the worker thread, passes it into the grouper, closes it before the response is built:

```python
    def _list_and_group_sync() -> tuple[list[dict], list[dict], int]:
        """Run the inner-list SQL, classify rows, then group into fights.

        Both calls share one sqlite3 connection — the inner list opens it
        for the SQL, then the grouper reuses it for top-N lookups. Keeping
        this synchronous and threaded matches the surrounding pattern
        (``run_sync`` is the executor for any DB-touching step)."""
        rows = _list_encounters_sync(inner_cap, zone, size, current_world())
        if not rows:
            return rows, [], 0
        conn = parses_db.init_db(parses_db.DB_PATH)
        try:
            conn.row_factory = sqlite3.Row
            fights = _group_into_fights(rows, conn)
        finally:
            conn.close()
        return rows, fights, len(fights)

    encounters, fights, total_fights = await run_sync(_list_and_group_sync)
    fights = fights[:limit]
```

NOTE: `encounters` is still used by `_compute_permissions` below — leave that call site as-is. The change above just wraps the existing two calls (`_list_encounters_sync` and `_group_into_fights`) in a single threaded helper so both share one connection.

- [ ] **Step 5: Run new tests + every other parses test**

Run: `uv run pytest tests/web/test_parses_list_grouping.py tests/web/test_parses_list.py tests/web/test_parses_list_category.py tests/web/test_parses_top_n.py tests/web/test_parses_classify_zone.py -v`

Expected: all green. Pay special attention to `test_list_parses_groups_mirror_uploads` and `test_list_parses_does_not_group_same_uploader` in `test_parses_list.py` — these existed before and must still pass.

- [ ] **Step 6: Full backend test sweep**

Run: `uv run pytest tests/web/ -v`

Expected: same total pass-count as before plus the new tests. No regressions.

- [ ] **Step 7: Lint + type check**

Run: `uv run ruff format --check web/routes/parses/list.py tests/web/test_parses_list_grouping.py`
Run: `uv run ruff check web/routes/parses/list.py tests/web/test_parses_list_grouping.py`
Run: `uv run pyright web/routes/parses/list.py`

Expected: all clean.

### Phase 4 checkpoint (manual, run after user verifies test results)

```powershell
git add web/routes/parses/list.py tests/web/test_parses_list_grouping.py
git commit -m "parses: top-N mutual containment gate on the merger

Today's merger collapses two uploads when (different uploaders) AND
(same guild + title) AND (within 60 s). Two of the same guild's
groups simultaneously doing the same boss would slip through. New
clause: each upload's top-N ally encDPS combatants must appear in
the other upload's ally list (mutual containment, encdps with
name-ASC tiebreaker). N = 3 if max(player_count) >= 7 else 2.

_group_into_fights gains a sqlite3 connection parameter; caller
wraps the list + group steps in a single _list_and_group_sync
helper so both share one connection.

Empty-ally edge case merges trivially (set() ⊆ set()). Fewer-
than-N-allies case uses min(N, available). Canonical-anchored
containment means group membership is transitive only through the
canonical — documented in the function docstring.

Part of: docs/superpowers/plans/2026-05-30-parse-grouping-redo.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 5 — Frontend regroup (UI, visual)

**Goal:** ParsesPage renders Guild → (Raid / Dungeon / Other) → fights, replacing the existing Guild → (Date · Zone) → fights structure. The old `sizeLabel` ("Raid (24)" / "Group" / "Individual") collapses to a small `<Badge>` showing `Np` per fight row. Raid + Dungeon open by default, Other collapsed.

**Hold-commits rule:** This is visible UI work. Don't commit until the user has rebuilt, looked at the page, and signed off. Per the hold-commits-on-visual-work memory.

### Task 5.1: Update `ParsesPage.tsx` + tests

**Files:**
- Modify: `frontend/src/pages/ParsesPage.tsx` (full rewrite of the grouping + render section)
- Create: `frontend/src/pages/ParsesPage.test.tsx`

NOTE on file size: `ParsesPage.tsx` is 672 lines today and the rewrite likely pushes past 700. If after the changes below it crosses 700, also extract the new `GuildSection` + `CategorySection` (and their helpers) into `frontend/src/pages/parses/GuildSection.tsx` and `frontend/src/pages/parses/CategorySection.tsx` per the existing file-split convention (CLAUDE.md → "File-split conventions"). For the plan below I'll keep everything in one file; the split is a mechanical follow-up if needed.

- [ ] **Step 1: Add `category` field to the frontend `ParseEncounterSummary` interface**

In `frontend/src/pages/ParsesPage.tsx`, modify the interface block (lines 31–54). Add the new field immediately after `player_count: number` (line 45):

```tsx
interface ParseEncounterSummary {
  id: number
  act_encid: string
  title: string
  zone: string | null
  started_at: number       // unix seconds, UTC
  ended_at: number
  duration_s: number
  total_damage: number
  encdps: number
  kills: number
  deaths: number
  success_level: number      // ACT enum: 0=unknown, 1=win, 2=loss, 3=mixed
  combatant_count: number
  player_count: number
  // Backend-computed Raid / Dungeon / Other bucket (see
  // web/routes/parses/list.py:_classify_zone). Drives the Guild → Category
  // hierarchy on this page.
  category: 'raid' | 'dungeon' | 'other'
  uploaded_by: string                       // canonical upload's character name
  uploader_discord_id: string | null        // canonical upload's Discord ID
  uploader_display_name: string | null      // canonical upload's Discord display name
  guild_name: string | null   // stamped at ingest from uploader's Census guild
  permissions: ParsePermissions
  // Server-side mirror grouping (B2.15e) — every raider's upload for this
  // fight, including the canonical (single-upload fights have length 1).
  uploads: ParseUploadSummary[]
}
```

- [ ] **Step 2: Replace `groupEncounters` with category-bucketing**

In `frontend/src/pages/ParsesPage.tsx`, replace the existing `groupEncounters` (lines 117–171) and its helper types `ZoneBucket` / `GuildBucket` (lines 101–111) with:

```tsx
// ── Grouped structure ─────────────────────────────────────────────────────────
// Guild → Category (Raid / Dungeon / Other) → ParseEncounterSummary[]
//
// Mirror grouping (collapsing multiple raider uploads of the same fight)
// happens server-side. Each ParseEncounterSummary IS a fight, with the
// canonical upload's fields at the top level. The frontend buckets fights
// by guild then by the backend-computed category.

type Category = 'raid' | 'dungeon' | 'other'

interface GuildBucket {
  guild: string                                  // "Exordium" or NO_GUILD
  fightsByCategory: Record<Category, ParseEncounterSummary[]>
  totalFights: number
}

function groupEncounters(fights: ParseEncounterSummary[]): GuildBucket[] {
  const byGuild = new Map<string, Record<Category, ParseEncounterSummary[]>>()

  for (const e of fights) {
    const guild = e.guild_name || NO_GUILD
    let cats = byGuild.get(guild)
    if (!cats) {
      cats = { raid: [], dungeon: [], other: [] }
      byGuild.set(guild, cats)
    }
    cats[e.category].push(e)
  }

  const result: GuildBucket[] = []
  for (const [guild, cats] of byGuild) {
    // Server returns fights newest-first overall; re-sort within each
    // category so the most recent fight always sits on top.
    for (const k of ['raid', 'dungeon', 'other'] as const) {
      cats[k].sort((a, b) => b.started_at - a.started_at)
    }
    const total = cats.raid.length + cats.dungeon.length + cats.other.length
    result.push({ guild, fightsByCategory: cats, totalFights: total })
  }

  // Sort guilds: NO_GUILD always last; everyone else by total fight count
  // desc (most-active guild first), with name ASC as tiebreaker.
  result.sort((a, b) => {
    if (a.guild === NO_GUILD) return 1
    if (b.guild === NO_GUILD) return -1
    if (b.totalFights !== a.totalFights) return b.totalFights - a.totalFights
    return a.guild.localeCompare(b.guild)
  })
  return result
}
```

- [ ] **Step 3: Remove the old `sizeLabel` helper**

Delete the `sizeLabel` function entirely (currently lines 78–83) — the per-row size signal moves to a small `<Badge>` displayed near each row, and the page no longer needs a label-string helper.

- [ ] **Step 4: Update the `Card` import to also bring in `Badge`**

In `frontend/src/pages/ParsesPage.tsx`, change line 7:

```tsx
import { Badge, Card, SectionLabel } from '../components/ui'
```

(Both `Badge` and `SectionLabel` are already exported from `frontend/src/components/ui/index.ts` per the inventory in `CLAUDE.md` → "Shared frontend infrastructure".)

- [ ] **Step 5: Rewrite the render hierarchy**

Find the `GuildSection` component in `ParsesPage.tsx` (search for `function GuildSection` — likely around line 290+ after the inline page render). Replace its body (and any sibling `ZoneSection` it dispatches to) with a category-based hierarchy.

Because this is the largest single edit and the existing `GuildSection` / `ZoneSection` shape is tightly coupled, here is the FULL replacement for the section between (and including) the `GuildSection` declaration and its closing `}`. Read the file first to confirm the current shape, then replace `GuildSection` + remove `ZoneSection` + add the new `CategorySection`:

```tsx
// ── GuildSection ──────────────────────────────────────────────────────────────
// One section per guild. Renders three CategorySection children (Raid /
// Dungeon / Other), each independently collapsible. Empty categories
// render nothing.

interface GuildSectionProps {
  bucket: GuildBucket
  defaultExpanded: boolean
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

function GuildSection({ bucket, defaultExpanded, onDeleted }: GuildSectionProps) {
  const [open, setOpen] = useState(defaultExpanded)
  return (
    <Card className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="appearance-none border-0 bg-transparent p-0 flex items-baseline gap-2 cursor-pointer text-left"
      >
        <Caret open={open} />
        <h2 className="font-heading text-gold-bright text-[1.15rem] m-0">
          {bucket.guild}
        </h2>
        <span className="ml-auto text-text-muted text-[0.78rem] tabular-nums">
          {bucket.totalFights} fight{bucket.totalFights === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 mt-1">
          <CategorySection
            label="Raid"
            fights={bucket.fightsByCategory.raid}
            defaultOpen
            guild={bucket.guild}
            onDeleted={onDeleted}
          />
          <CategorySection
            label="Dungeon"
            fights={bucket.fightsByCategory.dungeon}
            defaultOpen
            guild={bucket.guild}
            onDeleted={onDeleted}
          />
          <CategorySection
            label="Other"
            fights={bucket.fightsByCategory.other}
            defaultOpen={false}
            guild={bucket.guild}
            onDeleted={onDeleted}
          />
        </div>
      )}
    </Card>
  )
}

// ── CategorySection ───────────────────────────────────────────────────────────
// One subsection per category under a guild. Renders nothing when there are
// no fights — guild headers stay clean.

interface CategorySectionProps {
  label: 'Raid' | 'Dungeon' | 'Other'
  fights: ParseEncounterSummary[]
  defaultOpen: boolean
  guild: string
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

function CategorySection({ label, fights, defaultOpen, guild, onDeleted }: CategorySectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (fights.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`${label} · ${fights.length} fight${fights.length === 1 ? '' : 's'}`}
        className="appearance-none border-0 bg-transparent p-0 flex items-baseline gap-2 cursor-pointer text-left"
      >
        <Caret open={open} />
        <SectionLabel variant="gold" className="mb-0">{label}</SectionLabel>
        <span className="text-text-muted text-[0.72rem] tabular-nums">
          · {fights.length}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 pl-4">
          {fights.map(f => (
            <FightRow
              key={f.id}
              fight={f}
              guild={guild}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Find the per-fight row component and replace `sizeLabel` with `<Badge>`**

Search `ParsesPage.tsx` for `sizeLabel(` — every callsite is the old "Raid (24)" / "Group" / "Individual" label. Each one becomes:

```tsx
<Badge variant="muted">{f.player_count}p</Badge>
```

(`f` is the local fight variable name in that component — adjust to whatever the surrounding closure uses.)

Once every callsite is updated, the `sizeLabel` function definition can be deleted (step 3 already removed it). If there are inbound callsites that survive (the search caught them all), the typechecker will catch the import-mismatch in step 9.

- [ ] **Step 7: Verify the `<FightRow>` component still exists / extract one if it doesn't**

The pre-existing ParsesPage likely has the per-fight UI inline inside `ZoneSection`. The Phase 5 rewrite uses a `<FightRow>` reference in `CategorySection`. Two options:

  - (a) If the existing code already has a row-renderer component (look for `function ZoneSection` body — the inner per-fight JSX), pull that JSX into a top-level `function FightRow(...)` taking `(fight, guild, onDeleted)` props.
  - (b) If the per-fight rendering is inline-mapped inside `ZoneSection`, factor it out — copy the JSX from `ZoneSection`'s inner `.map(...)` into a new top-level component:

```tsx
interface FightRowProps {
  fight: ParseEncounterSummary
  guild: string
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

function FightRow({ fight, guild, onDeleted }: FightRowProps) {
  // ... whatever the existing ZoneSection's row JSX was, with the
  // ParseEncounterSummary fields renamed to `fight.<x>` and using
  // the imported `<Badge>` for the per-row size signal:
  return (
    <Link
      to={`/parse/${fight.id}`}
      className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-surface-raised"
    >
      <span className="text-text text-[0.88rem] flex-1 truncate">{fight.title}</span>
      <Badge variant="muted">{fight.player_count}p</Badge>
      <span className="text-text-muted text-[0.78rem] tabular-nums">
        {fmtDuration(fight.duration_s)} · {fmtLocalDate(fight.started_at)} {fmtLocalTime(fight.started_at)}
      </span>
      <UploaderTag fight={fight} />
      {/* Whatever delete-button JSX existed in ZoneSection's row */}
    </Link>
  )
}
```

The exact JSX of `FightRow` must match what the old `ZoneSection` rendered per row, minus the now-obsolete `sizeLabel` text — copy the existing JSX faithfully, only swap the size label.

- [ ] **Step 8: Remove the now-orphaned date/zone subsection code**

If `ZoneSection` is now unused after Phase 5's restructuring, delete it entirely. Likewise remove `ZoneBucket`, the `KEY_SEP`/`DISPLAY_SEP` constants, and any other helper used only by the old grouping. Anything still imported but not used will be flagged by the TS unused-import check in step 9.

- [ ] **Step 9: Write the failing render-state tests**

Create `frontend/src/pages/ParsesPage.test.tsx`:

```tsx
/**
 * ParsesPage render-state tests — guild ordering, category hierarchy,
 * default open/closed state, sizeLabel replacement.
 *
 * Mocks /api/parses via global fetch so we don't need the backend running.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import ParsesPage from './ParsesPage'

interface MockFight {
  id: number
  act_encid?: string
  title: string
  zone: string | null
  started_at: number
  ended_at?: number
  duration_s?: number
  total_damage?: number
  encdps?: number
  kills?: number
  deaths?: number
  success_level?: number
  combatant_count?: number
  player_count: number
  category: 'raid' | 'dungeon' | 'other'
  uploaded_by?: string
  uploader_discord_id?: string | null
  uploader_display_name?: string | null
  guild_name: string | null
  permissions?: { can_delete: boolean }
  uploads?: unknown[]
}

const _DEFAULTS = {
  act_encid: 'x',
  ended_at: 0,
  duration_s: 60,
  total_damage: 1000,
  encdps: 100,
  kills: 1,
  deaths: 0,
  success_level: 1,
  combatant_count: 5,
  uploaded_by: 'tester',
  uploader_discord_id: null,
  uploader_display_name: null,
  permissions: { can_delete: false },
  uploads: [],
}

function fight(overrides: Partial<MockFight> & Pick<MockFight, 'id' | 'title' | 'category' | 'guild_name' | 'started_at' | 'zone' | 'player_count'>): MockFight {
  return { ..._DEFAULTS, ...overrides } as MockFight
}

function mockFetch(results: MockFight[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results, total: results.length }),
    })) as unknown as typeof fetch,
  )
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ParsesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})


describe('ParsesPage grouping', () => {
  it('renders guilds in fight-count-desc order', async () => {
    mockFetch([
      fight({ id: 1, title: 'A', category: 'raid', guild_name: 'Guild Two', started_at: 100, zone: 'Z', player_count: 12 }),
      fight({ id: 2, title: 'B', category: 'raid', guild_name: 'Guild One', started_at: 110, zone: 'Z', player_count: 12 }),
      fight({ id: 3, title: 'C', category: 'raid', guild_name: 'Guild One', started_at: 120, zone: 'Z', player_count: 12 }),
    ])
    renderPage()
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map(h => h.textContent)).toEqual(['Guild One', 'Guild Two'])
  })

  it('renders (no guild) section last', async () => {
    mockFetch([
      fight({ id: 1, title: 'A', category: 'raid', guild_name: null, started_at: 100, zone: 'Z', player_count: 12 }),
      fight({ id: 2, title: 'B', category: 'raid', guild_name: null, started_at: 110, zone: 'Z', player_count: 12 }),
      fight({ id: 3, title: 'C', category: 'raid', guild_name: null, started_at: 120, zone: 'Z', player_count: 12 }),
      fight({ id: 4, title: 'D', category: 'raid', guild_name: 'Exordium', started_at: 130, zone: 'Z', player_count: 12 }),
    ])
    renderPage()
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map(h => h.textContent)).toEqual(['Exordium', 'No Guild'])
  })

  it('opens Raid + Dungeon by default; collapses Other', async () => {
    mockFetch([
      fight({ id: 1, title: 'RaidFight', category: 'raid', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 12 }),
      fight({ id: 2, title: 'DungeonFight', category: 'dungeon', guild_name: 'Guild', started_at: 110, zone: 'Z', player_count: 5 }),
      fight({ id: 3, title: 'OtherFight', category: 'other', guild_name: 'Guild', started_at: 120, zone: 'Z', player_count: 1 }),
    ])
    renderPage()
    // Raid + Dungeon fight titles visible immediately.
    expect(await screen.findByText('RaidFight')).toBeInTheDocument()
    expect(screen.getByText('DungeonFight')).toBeInTheDocument()
    // Other fight title hidden behind the collapsed Other subsection.
    expect(screen.queryByText('OtherFight')).not.toBeInTheDocument()
  })

  it('clicking Other reveals its fights', async () => {
    mockFetch([
      fight({ id: 1, title: 'OtherFight', category: 'other', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 1 }),
    ])
    renderPage()
    const otherToggle = await screen.findByRole('button', { name: /^Other ·/ })
    await userEvent.click(otherToggle)
    expect(await screen.findByText('OtherFight')).toBeInTheDocument()
  })

  it('renders empty category subsections as nothing', async () => {
    mockFetch([
      fight({ id: 1, title: 'RaidFight', category: 'raid', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 12 }),
    ])
    renderPage()
    // Dungeon + Other should not render at all because the guild has no
    // fights in those buckets. Only the Raid section header is present.
    const dungeonHeaders = screen.queryAllByRole('button', { name: /^Dungeon ·/ })
    expect(dungeonHeaders).toEqual([])
    const otherHeaders = screen.queryAllByRole('button', { name: /^Other ·/ })
    expect(otherHeaders).toEqual([])
  })

  it('per-row badge shows {Np}, not the old sizeLabel', async () => {
    mockFetch([
      fight({ id: 1, title: 'RaidFight', category: 'raid', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 24 }),
      fight({ id: 2, title: 'GroupFight', category: 'dungeon', guild_name: 'Guild', started_at: 110, zone: 'Z', player_count: 6 }),
      fight({ id: 3, title: 'SoloFight', category: 'other', guild_name: 'Guild', started_at: 120, zone: 'Z', player_count: 1 }),
    ])
    renderPage()
    // Other is collapsed by default — expand to reach SoloFight first.
    const otherToggle = await screen.findByRole('button', { name: /^Other ·/ })
    await userEvent.click(otherToggle)

    expect(screen.getByText('24p')).toBeInTheDocument()
    expect(screen.getByText('6p')).toBeInTheDocument()
    expect(screen.getByText('1p')).toBeInTheDocument()
    // Old sizeLabel strings must NOT appear anywhere on the page.
    expect(screen.queryByText('Raid (24)')).not.toBeInTheDocument()
    expect(screen.queryByText('Group')).not.toBeInTheDocument()
    expect(screen.queryByText('Individual')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 10: Run typecheck + build + tests**

Run: `cd frontend && npm run typecheck`

Expected: clean. Any TS error here points at a missing import, an unused symbol left over from the old grouping helpers, or an incorrect prop type. Fix and re-run.

Run: `cd frontend && npm run build`

Expected: build succeeds. Pre-existing chunk-size warning is fine.

Run: `cd frontend && npm test -- ParsesPage`

Expected: 6 passed (the six test functions above).

- [ ] **Step 11: Manual visual check (user-driven)**

Hand off to the user:

> Build is clean and tests pass. ParsesPage now groups Guild → Raid/Dungeon/Other → fights, Raid + Dungeon open by default, Other collapsed, per-row badge shows `Np` instead of "Raid (24)" / "Group" / "Individual". Want to spin up the dev server (`npm run dev` in `frontend/`, and the backend separately) and have a look before I commit?

Wait for the user to OK the visual result. Per the hold-commits-on-visual-work memory: do not stage or commit until the user explicitly approves the appearance.

### Phase 5 checkpoint (manual, run after user has visually approved)

```powershell
git add frontend/src/pages/ParsesPage.tsx frontend/src/pages/ParsesPage.test.tsx
git commit -m "ParsesPage: regroup Guild → Raid/Dungeon/Other

Replaces the Guild → (Date · Zone) hierarchy with Guild → Category
(Raid / Dungeon / Other), backed by the new backend-computed
\`category\` field. Raid + Dungeon open by default; Other collapsed.
The per-row size signal moves from a 'Raid (24)' / 'Group' /
'Individual' text label to a compact <Badge>Np</Badge>.

Guild sort: total fight count desc, with No Guild always last.
Within a category: started_at desc (most recent fight first). Empty
category subsections render nothing.

Open/closed state is component-local — refreshing the page resets to
defaults. localStorage persistence deferred to a follow-up if requested.

Part of: docs/superpowers/plans/2026-05-30-parse-grouping-redo.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Stage ONLY those two files. The implementer must not include any other working-tree changes — the user has unrelated WIP.

After commit, ask the user whether to push (Railway redeploys on every push to main). Do not push without explicit consent. See CLAUDE.md → "Deployment".

---

## Plan self-review

**Spec coverage:** Every section of the spec maps to at least one task:
- Spec § "Goal" — Phases 1–5 together.
- Spec § "Out of scope" — explicitly excluded from every phase; called out in the spec itself.
- Spec § "Data flow" — Phase 3 wires the helper into `_encounter_summary`; Phase 4 augments the merger; Phase 5 consumes `category`.
- Spec § "Component 1 — zone classifier" — Phase 2 Task 2.1.
- Spec § "Component 2 — top-N ally helper" — Phase 1 Task 1.1.
- Spec § "Component 3 — augmented merger" — Phase 4 Task 4.1.
- Spec § "Component 4 — API response" — Phase 3 Task 3.1.
- Spec § "Component 5 — frontend ParsesPage" — Phase 5 Task 5.1.
- Spec § "Edge cases" — covered by individual tests in every phase (`test_top_n_returns_fewer_when_pool_is_smaller`, `test_classify_returns_other_for_none_or_empty`, `test_empty_ally_uploads_still_merge`, `test_classify_resolves_aliases`, `test_classifier_cache_clear_picks_up_new_trees`).
- Spec § "Testing" — every test from the spec's testing section appears in one of the tasks' test files, plus a few extras (boundary, alias).
- Spec § "Implementation order" — Phase numbering matches the spec's ordered list 1→5.

**Placeholders:** none in this plan body (the only "TODO"-like reference is the legitimate "follow-up if requested" line about localStorage persistence, which the spec explicitly defers).

**Type consistency:** `_classify_zone` signature, `_top_n_ally_names` signature, `_group_into_fights` new signature, `ParseEncounterSummary.category`, and the frontend interface field all use the same `Literal["raid","dungeon","other"]` / `'raid' | 'dungeon' | 'other'` union throughout. The `Category` type alias on the frontend is a strict subset of the same.
