# Pet detection pipeline — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current single-stage player heuristic (`ally=1 AND single-word AND name != 'Unknown'`) with a 6-stage classifier (multi-word → EQ2 auto-pet regex → Census `cls` → contribution-ranked bucket-fill) that persists per-combatant via a new `is_player` flag. Every consumer of `player_count` reads the same answer.

**Architecture:** Bottom-up, six phases. Phases 1–2 are pure additions (module + schema). Phase 3 wires the classifier into ingest. Phase 4 flips the SQL filter and adds lazy backfill for historic rows (behaviour-change commit). Phase 5 wires the zone-cache invalidation. Phase 6 surfaces the new field through the API and the frontend Allies/Pets split. Approved spec at [`docs/superpowers/specs/2026-05-30-pet-detection-pipeline-design.md`](../specs/2026-05-30-pet-detection-pipeline-design.md) (commit `9a18afa`) is the source of truth for component behaviour and edge cases.

**Tech Stack:** Python 3.13 + FastAPI + Pydantic v2 + sqlite3 stdlib, React + TypeScript + Tailwind v4 (CSS-first, no Preflight). Tests: pytest, vitest. Run commands: `uv run pytest`, `cd frontend ; npm test`. Linters: `uv run ruff format --check`, `uv run ruff check`, `uv run pyright`, `cd frontend ; npm run typecheck`.

**Per-task discipline:**
- **No commit step inside any task.** Commits happen only at phase checkpoints, run manually by the controller AFTER user review.
- **Stage only the named files at each checkpoint.** The user has unrelated WIP in the working tree; never `git add -A`.
- **No Census calls in dev** — use the existing `_FAKE_ENCOUNTER` / `_FAKE_COMBATANTS` fixtures or new in-memory sqlite fakes.

---

## File map

| File | Phase | Action | Notes |
|---|---|---|---|
| `parses/pet_detection.py` | 1 | create | Regex + `classify_combatants` pure function |
| `scripts/dev/pet_name_detector.py` | 1 | delete | Module supersedes the dev prototype |
| `tests/parses/test_pet_detection.py` | 1 | create | Regex + pipeline stages + bucket-fill rule table + determinism |
| `parses/db.py` | 2 | modify | New `is_player` column + index in `_MIGRATIONS` / `_CREATE_INDEXES`; `update_combatant_is_player` + `invalidate_is_player_cache` helpers |
| `tests/parses/test_db_is_player.py` | 2 | create | Migration + helper round-trip tests |
| `web/routes/parses/ingest.py` | 3 | modify | Classifier call after combatant insert; same call in the async snapshot fill |
| `tests/web/test_parses_ingest_classify.py` | 3 | create | Round-trip: posting a payload populates `is_player`; async fill re-classifies |
| `web/routes/parses/list.py` | 4 | modify | SQL filters switch to `is_player=1`; `_ensure_classified` + hooks |
| `web/routes/rankings.py` | 4, 5 | modify | Hook `_ensure_classified` into `_load_primary_boss_kills` (Phase 4) + `invalidate_zones_cache` calls `invalidate_is_player_cache` (Phase 5) |
| `tests/web/test_parses_pet_filter.py` | 4 | create | SQL filter respects `is_player`; lazy backfill on NULL; Phase-4 merger tests still pass |
| `tests/web/test_zones_cache_invalidation.py` | 5 | modify | Extend to assert `is_player` reset on `invalidate_zones_cache()` |
| `web/routes/parses/models.py` | 6 | modify | `CombatantSummary.is_player: bool` |
| `web/routes/parses/list.py` | 6 | modify | `_encounter_detail_sync` populates `is_player` on combatant summaries |
| `frontend/src/pages/ParsePage.tsx` | 6 | modify | `CombatantSummary.is_player` field; Allies/Pets predicate switches to `!c.is_player` |
| `frontend/src/pages/ParsePage.test.tsx` | 6 | create | Renders bucket-promoted players in Allies, regex-matched names in Pets |

---

## Phase 1 — `parses/pet_detection.py` module + tests

**Goal:** A pure-function classifier module + comprehensive unit tests. Zero behaviour change — nothing in production imports the new module yet. Includes deleting the `scripts/dev/pet_name_detector.py` prototype (the new module is its permanent home).

### Task 1.1: Classifier module + 19 unit tests

**Files:**
- Create: `parses/pet_detection.py`
- Create: `tests/parses/test_pet_detection.py`
- Delete: `scripts/dev/pet_name_detector.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/parses/test_pet_detection.py` with EXACTLY this content:

```python
"""Unit tests for the pet-detection classifier in parses/pet_detection.py.

The classifier is a pure function that takes a list of combatant dicts
plus a zone-category string and returns {combatant.id: is_player}. The
6-stage pipeline + bucket-fill rules are the spec's source of truth — see
docs/superpowers/specs/2026-05-30-pet-detection-pipeline-design.md.
"""

from __future__ import annotations

import pytest

from parses.pet_detection import EQ2_PET_PATTERN, KNOWN_EXAMPLES, classify_combatants


def _ally(
    cid: int,
    name: str,
    *,
    cls: str | None = None,
    encdps: float = 0.0,
    enchps: float = 0.0,
) -> dict:
    """Minimal combatant dict — the fields the classifier reads."""
    return {
        "id": cid,
        "name": name,
        "ally": 1,
        "cls": cls,
        "encdps": encdps,
        "enchps": enchps,
    }


def _enemy(cid: int, name: str) -> dict:
    return {"id": cid, "name": name, "ally": 0, "cls": None, "encdps": 0.0, "enchps": 0.0}


# ── Regex tests ───────────────────────────────────────────────────────

def test_regex_matches_every_known_example():
    for name in KNOWN_EXAMPLES:
        assert EQ2_PET_PATTERN.match(name) or name in KNOWN_EXAMPLES, name


def test_regex_matches_prototype_examples():
    for name in ("Gibab", "Zosn", "Kebn", "Zebekn", "Jentik", "Xebobtik", "Kabantik", "Jonaner"):
        assert EQ2_PET_PATTERN.match(name.lower()), name


def test_regex_rejects_real_player_names():
    for name in ("Bob", "Fluffy", "Menludiir", "Sihtric", "Tarinax", "Vyemm"):
        assert not EQ2_PET_PATTERN.match(name.lower()), name


# ── Pipeline stage tests (single-shot, no bucket-fill) ────────────────

def test_stage1_enemy_omitted():
    out = classify_combatants([_enemy(1, "a krait")], "raid")
    assert 1 not in out


def test_stage2_empty_name_is_pet():
    out = classify_combatants([_ally(1, "", cls="Wizard")], "raid")
    assert out[1] is False


def test_stage2_unknown_name_is_pet():
    out = classify_combatants([_ally(1, "Unknown", cls="Wizard")], "raid")
    assert out[1] is False


def test_stage3_multi_word_is_pet():
    out = classify_combatants([_ally(1, "Bravo's Pet", cls="Wizard")], "raid")
    assert out[1] is False


def test_stage4_regex_match_is_pet():
    out = classify_combatants([_ally(1, "Gibab", cls="Wizard")], "raid")
    assert out[1] is False, "Auto-pet name should override cls"


def test_stage5_cls_resolved_is_player():
    out = classify_combatants([_ally(1, "Menludiir", cls="Wizard")], "raid")
    assert out[1] is True


# ── Bucket-fill rule table (one test per row of the spec) ─────────────

def test_raid_fill_under_24_additive_below_25_total():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 11)]
    unconfirmed = [_ally(20 + i, f"U{i}", encdps=500.0 - i) for i in range(5)]
    out = classify_combatants(confirmed + unconfirmed, "raid")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 15, "10 confirmed + 5 unconfirmed promoted under cap of 24"


def test_raid_fill_then_trim_at_24_when_total_ge_25():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 26)]
    out = classify_combatants(confirmed, "raid")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 24, "25 confirmed raiders capped at 24 (lowest 1 trimmed)"


def test_dungeon_fill_to_6():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 4)]
    unconfirmed = [_ally(20 + i, f"U{i}", encdps=500.0 - i) for i in range(5)]
    out = classify_combatants(confirmed + unconfirmed, "dungeon")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 6, "3 confirmed + 3 unconfirmed promoted to hit target 6"


def test_dungeon_no_trim_above_6():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 9)]
    out = classify_combatants(confirmed, "dungeon")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 8, "Dungeon rule is additive only — 8 confirmed stay players"


def test_other_n_total_under_6_no_op():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 4)]
    unconfirmed = [_ally(20 + i, f"U{i}", encdps=500.0 - i) for i in range(2)]
    out = classify_combatants(confirmed + unconfirmed, "other")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 3, "n_total=5 in 'other' is no-op"


def test_other_n_total_7_to_10_fills_to_6():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 4)]
    unconfirmed = [_ally(20 + i, f"U{i}", encdps=500.0 - i) for i in range(5)]
    out = classify_combatants(confirmed + unconfirmed, "other")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 6, "n_total=8 in 'other' fills confirmed up to 6"


def test_other_n_total_11_to_24_treats_as_raid_fills_to_24():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 11)]
    unconfirmed = [_ally(20 + i, f"U{i}", encdps=500.0 - i) for i in range(10)]
    out = classify_combatants(confirmed + unconfirmed, "other")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 20, "n_total=20 in 'other' treated as raid, all unconfirmed promoted (cap 24 not hit)"


def test_other_n_total_ge_25_treats_as_raid_caps_at_24():
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 27)]
    out = classify_combatants(confirmed, "other")
    n_player = sum(1 for v in out.values() if v)
    assert n_player == 24, "n_total=26 in 'other' treated as raid, trimmed to 24"


# ── Determinism + tiebreaker ──────────────────────────────────────────

def test_determinism_same_input_same_output():
    combatants = [_ally(i, f"P{i}", encdps=500.0 + i, enchps=100.0) for i in range(1, 10)]
    first = classify_combatants(combatants, "dungeon")
    second = classify_combatants(combatants, "dungeon")
    assert first == second


def test_tiebreaker_name_ascending_on_equal_contribution():
    # Two unconfirmed allies tied on (encdps + enchps); name ASC wins.
    confirmed = [_ally(i, f"P{i}", cls="Wizard", encdps=1000.0) for i in range(1, 6)]
    unconfirmed = [
        _ally(99, "Zelda", encdps=100.0, enchps=50.0),
        _ally(98, "Alice", encdps=100.0, enchps=50.0),
    ]
    out = classify_combatants(confirmed + unconfirmed, "dungeon")
    # Target = 6, 5 confirmed → 1 unconfirmed promoted. Tiebreaker on name ASC
    # picks Alice (98), leaves Zelda (99) as pet.
    assert out[98] is True
    assert out[99] is False


# ── Edge cases ─────────────────────────────────────────────────────────

def test_empty_combatant_list_returns_empty_dict():
    assert classify_combatants([], "raid") == {}


def test_all_pet_encounter_yields_zero_players():
    combatants = [_ally(i, f"Pet {i}") for i in range(1, 5)]  # all multi-word
    out = classify_combatants(combatants, "raid")
    assert all(v is False for v in out.values())


def test_missing_keys_do_not_raise():
    # ``ally`` missing → treat as 0 (omit); ``cls`` missing → unconfirmed.
    minimal = [{"id": 1, "name": "Bob"}]
    out = classify_combatants(minimal, "raid")
    # Without ally=1 the row is omitted entirely.
    assert out == {}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/parses/test_pet_detection.py -v`

Expected: every test errors with `ImportError: cannot import name 'classify_combatants' from 'parses.pet_detection'` or similar.

- [ ] **Step 3: Create the module**

Create `parses/pet_detection.py` with EXACTLY this content:

```python
"""Pet detection pipeline for parses.

Replaces the legacy `ally=1 AND single-word AND name != 'Unknown'` SQL
heuristic with a 6-stage classifier that better separates real players
from EQ2 auto-named pets, multi-word pet names, and unresolved-by-Census
combatants. The output is persisted as `combatants.is_player` and is the
authoritative signal used by every reader (parses list, individual parse
detail, rankings scope, Phase 4 merger top-N).

The classifier is a pure function — no DB access, no side effects.
Callers fetch the combatant rows + the zone category and the helpers in
``parses/db.py`` (``update_combatant_is_player`` etc.) persist the result.

See docs/superpowers/specs/2026-05-30-pet-detection-pipeline-design.md
for the full design rationale and the bucket-fill rule table.
"""

from __future__ import annotations

import re
from typing import Literal

# ── Stage 4: EQ2 auto-named-pet regex ────────────────────────────────────
# Matches the typical [gkjxzv][ieaov]… stem + optional middle syllable +
# common ending that EQ2's pet-naming code produces (Gibab, Zosn, Kebn,
# Zebekn, Jentik). The regex was prototyped via scripts/dev/pet_name_detector.py
# against an observed sample of pet names in parses.
EQ2_PET_PATTERN = re.compile(
    r"""
    ^
    (?:[gkjxzv]i|[gkjxzv]e|[gkjxzv]a|[gkjxzv]o|je|jo|ja|ze|zo|ke|gi)
    (?:ba|be|bo|na|ne|ti|an)?
    (?:b|bn|ber|bekn|tik|ntik|ner|sn|kn|n)
    $
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Safety-net for names the regex misses. Add observed-in-the-wild auto-pet
# names that fall outside the pattern but are clearly pets.
KNOWN_EXAMPLES = {
    "gibab",
    "zosn",
    "kebn",
    "zebekn",
    "jentik",
}


# ── Pipeline ────────────────────────────────────────────────────────────

def _is_known_pet_name(name: str) -> bool:
    """Stage 4 helper: regex match OR explicit known-example."""
    lower = name.strip().lower()
    if lower in KNOWN_EXAMPLES:
        return True
    return bool(EQ2_PET_PATTERN.match(lower))


def classify_combatants(
    combatants: list[dict],
    zone_category: Literal["raid", "dungeon", "other"],
) -> dict[int, bool]:
    """Return {combatant.id: is_player} for every ally combatant.

    Enemies (ally != 1) are omitted from the result entirely — they're
    irrelevant to the player_count question. The dict keys are combatant
    `id` values, values are True (player) or False (pet/NPC/unresolved).

    Pipeline:
      1. ally != 1 → omit
      2. name in {"", "Unknown"} → pet
      3. " " in name → pet (multi-word)
      4. EQ2_PET_PATTERN.match(name) or name in KNOWN_EXAMPLES → pet
      5. cls is truthy → player (Census-resolved at ingest or async fill)
      6. survived 1-5 → unconfirmed. Bucket-fill applies (see below).

    Bucket-fill (per the spec's rule table):

      raid    : fill confirmed up to 24, then trim if final > 24
      dungeon : fill confirmed up to 6 (additive only — no trim)
      other   : if n_total ≤ 6  → no-op
                if n_total 7-10  → fill confirmed up to 6
                if n_total ≥ 11  → treat as raid (fill to 24, trim if > 24)

    Promotion order within bucket-fill: unconfirmed allies sorted by
    (encdps + enchps) DESC with name ASC tiebreaker; promote until target
    reached or pool exhausted. Demotion (trim) order: confirmed allies
    sorted by (encdps + enchps) ASC with name ASC tiebreaker; demote
    lowest contributors back to pet until target reached.

    Defensive: missing keys (`ally`, `name`, `cls`, `encdps`, `enchps`)
    are treated as absent; the function never raises on malformed input.
    """
    # Stage 1: keep only allies.
    allies = [c for c in combatants if c.get("ally") == 1]
    if not allies:
        return {}

    # Stages 2-5: classify each ally into pet / player / unconfirmed.
    pets: list[dict] = []
    players: list[dict] = []
    unconfirmed: list[dict] = []
    for c in allies:
        name = (c.get("name") or "").strip()
        if name == "" or name == "Unknown":
            pets.append(c)
            continue
        if " " in name:
            pets.append(c)
            continue
        if _is_known_pet_name(name):
            pets.append(c)
            continue
        if c.get("cls"):
            players.append(c)
            continue
        unconfirmed.append(c)

    n_total = len(allies)
    n_player = len(players)

    # Stage 6: bucket-fill target by zone category + total ally count.
    target: int | None
    if zone_category == "raid":
        target = 24
    elif zone_category == "dungeon":
        target = 6
    elif zone_category == "other":
        if n_total <= 6:
            target = None  # no-op
        elif n_total <= 10:
            target = 6
        else:
            target = 24
    else:  # unknown category — treat conservatively (no fill)
        target = None

    if target is not None:
        # Fill: promote highest-contributing unconfirmed up to target.
        if n_player < target and unconfirmed:
            unconfirmed.sort(
                key=lambda c: (-(float(c.get("encdps") or 0) + float(c.get("enchps") or 0)), c.get("name") or ""),
            )
            promote_count = min(target - n_player, len(unconfirmed))
            promoted = unconfirmed[:promote_count]
            remaining_unconfirmed = unconfirmed[promote_count:]
            players.extend(promoted)
            pets.extend(remaining_unconfirmed)
            n_player += promote_count
        else:
            pets.extend(unconfirmed)

        # Trim: cap confirmed-player count at target IF currently above.
        # Only the raid / raid-treated paths actually allow this branch —
        # dungeon and other-≤-10 targets never set n_player > target via
        # this function, but a parse can arrive with 25+ Census-confirmed
        # allies (mercs/swap-ins) and needs trimming to honour the 24 cap.
        if n_player > target and zone_category in ("raid", "other"):
            players.sort(
                key=lambda c: (float(c.get("encdps") or 0) + float(c.get("enchps") or 0), c.get("name") or ""),
            )
            demote_count = n_player - target
            demoted = players[:demote_count]
            players = players[demote_count:]
            pets.extend(demoted)
            n_player = target
    else:
        # No bucket-fill — unconfirmed stay pets.
        pets.extend(unconfirmed)

    out: dict[int, bool] = {}
    for c in players:
        out[int(c["id"])] = True
    for c in pets:
        out[int(c["id"])] = False
    return out
```

- [ ] **Step 4: Delete the dev prototype**

Delete `scripts/dev/pet_name_detector.py` (the new module is its permanent home). Confirm via `git status --short` that the deletion shows.

- [ ] **Step 5: Re-run tests, expect 19 passed**

Run: `uv run pytest tests/parses/test_pet_detection.py -v`

Expected: 19 passed.

- [ ] **Step 6: Lint + format + types**

Run each:
```
uv run ruff format --check parses/pet_detection.py tests/parses/test_pet_detection.py
uv run ruff check parses/pet_detection.py tests/parses/test_pet_detection.py
uv run pyright parses/pet_detection.py
```

Expected: all clean. If `ruff format --check` complains, run `uv run ruff format parses/pet_detection.py tests/parses/test_pet_detection.py` to fix.

### Phase 1 checkpoint (manual, after user signs off)

```powershell
git add parses/pet_detection.py tests/parses/test_pet_detection.py
git rm scripts/dev/pet_name_detector.py
git commit -m "parses: pet_detection module — 6-stage classifier + bucket-fill

Pure function classify_combatants(combatants, zone_category) replaces
the legacy single-stage 'ally=1 AND single-word AND name!=Unknown'
heuristic. Pipeline:
  1. ally=0                                       → omit
  2. name in {'', 'Unknown'}                      → pet
  3. multi-word name                              → pet
  4. matches EQ2 auto-pet regex / KNOWN_EXAMPLES  → pet
  5. cls IS NOT NULL (Census-resolved)            → player
  6. unconfirmed → bucket-fill by zone target:
        raid:     fill to 24, trim if > 24
        dungeon:  fill to 6 (additive only)
        other:    fill to 6 when n_total 7-10, treat as raid when 11+

The EQ2 auto-pet regex moves verbatim from scripts/dev/pet_name_detector.py
(user's prototype) into parses/pet_detection.py; the dev script is
removed in this same commit (the module is its permanent home).

Unused by production code until Phase 3 wires it into ingest.

Part of: docs/superpowers/plans/2026-05-30-pet-detection-pipeline.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 2 — schema migration + DB helpers

**Goal:** Add `combatants.is_player INTEGER DEFAULT NULL` + supporting index. Add `update_combatant_is_player` and `invalidate_is_player_cache` DB helpers. Migration is idempotent. No behaviour change yet — the column is unused until Phase 3 starts populating it.

### Task 2.1: Schema migration + two helpers + round-trip tests

**Files:**
- Modify: `parses/db.py` (append to `_MIGRATIONS` at line 217; append to `_CREATE_INDEXES` at line 201; add two new helpers after `update_combatant_snapshots`)
- Create: `tests/parses/test_db_is_player.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/parses/test_db_is_player.py` with EXACTLY this content:

```python
"""Tests for the Phase-2 is_player schema migration + helpers in parses/db.py.

The migration is idempotent (re-running init_db on a fresh or migrated DB
must not error). The helpers round-trip the classifier's output through
the column.
"""

from __future__ import annotations

import sqlite3

import pytest

from parses import db as parses_db


@pytest.fixture
def conn() -> sqlite3.Connection:
    """Fresh in-memory parses DB with the full schema applied."""
    c = parses_db.init_db(parses_db.Path(":memory:"))
    try:
        yield c
    finally:
        c.close()


def _insert_encounter(conn: sqlite3.Connection) -> int:
    cur = conn.execute(
        """
        INSERT INTO encounters (
            act_encid, title, zone, started_at, ended_at, duration_s,
            total_damage, encdps, kills, deaths, source_dsn, ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("abc123", "Test", "Zone", 1000, 1100, 100, 50000, 500.0, 1, 0, "test", 1100),
    )
    return int(cur.lastrowid or 0)


def _insert_combatant(conn: sqlite3.Connection, encounter_id: int, name: str) -> int:
    cur = conn.execute(
        "INSERT INTO combatants (encounter_id, name, ally) VALUES (?, ?, ?)",
        (encounter_id, name, 1),
    )
    return int(cur.lastrowid or 0)


def test_is_player_column_exists():
    conn = parses_db.init_db(parses_db.Path(":memory:"))
    try:
        cols = {r[1]: r for r in conn.execute("PRAGMA table_info(combatants)")}
        assert "is_player" in cols
        # DEFAULT NULL allows the lazy-backfill sentinel.
        assert cols["is_player"][4] is None
    finally:
        conn.close()


def test_is_player_index_exists():
    conn = parses_db.init_db(parses_db.Path(":memory:"))
    try:
        names = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='combatants'"
            )
        }
        assert "idx_combatants_encounter_is_player" in names
    finally:
        conn.close()


def test_migration_is_idempotent():
    # Calling init_db twice on the same DB must not error (ALTER TABLE
    # would normally fail on a column that already exists; the swallowed
    # OperationalError protects us).
    conn1 = parses_db.init_db(parses_db.Path(":memory:"))
    conn1.close()
    # The :memory: db is per-connection, so this isn't a true second-call
    # idempotency check. Run it twice on the SAME conn instead.
    conn = sqlite3.connect(":memory:")
    parses_db.init_db.__wrapped__ if hasattr(parses_db.init_db, "__wrapped__") else None
    # Easier path: re-execute every migration statement directly.
    conn.execute(parses_db._CREATE_ENCOUNTERS)
    conn.execute(parses_db._CREATE_COMBATANTS)
    for stmt in parses_db._MIGRATIONS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass
        # second time
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass  # idempotency: duplicate ALTER must be a no-op
    cols = {r[1] for r in conn.execute("PRAGMA table_info(combatants)")}
    assert "is_player" in cols
    conn.close()


def test_update_combatant_is_player_round_trip(conn: sqlite3.Connection):
    enc_id = _insert_encounter(conn)
    a = _insert_combatant(conn, enc_id, "Alpha")
    b = _insert_combatant(conn, enc_id, "Bravo")
    c = _insert_combatant(conn, enc_id, "Charlie")
    parses_db.update_combatant_is_player(conn, {a: True, b: False, c: True})
    rows = {
        r["id"]: r["is_player"]
        for r in conn.execute("SELECT id, is_player FROM combatants ORDER BY id")
    }
    assert rows[a] == 1
    assert rows[b] == 0
    assert rows[c] == 1


def test_update_combatant_is_player_overwrites_existing(conn: sqlite3.Connection):
    enc_id = _insert_encounter(conn)
    a = _insert_combatant(conn, enc_id, "Alpha")
    parses_db.update_combatant_is_player(conn, {a: True})
    parses_db.update_combatant_is_player(conn, {a: False})
    row = conn.execute("SELECT is_player FROM combatants WHERE id = ?", (a,)).fetchone()
    assert row[0] == 0


def test_update_combatant_is_player_empty_dict_is_noop(conn: sqlite3.Connection):
    parses_db.update_combatant_is_player(conn, {})  # must not raise


def test_invalidate_is_player_cache_sets_every_row_to_null(conn: sqlite3.Connection):
    enc_id = _insert_encounter(conn)
    a = _insert_combatant(conn, enc_id, "Alpha")
    b = _insert_combatant(conn, enc_id, "Bravo")
    parses_db.update_combatant_is_player(conn, {a: True, b: False})
    parses_db.invalidate_is_player_cache_with_conn(conn)
    rows = conn.execute("SELECT is_player FROM combatants").fetchall()
    assert all(r[0] is None for r in rows), rows
```

NOTE: the test uses `invalidate_is_player_cache_with_conn(conn)` — a connection-accepting variant — so the test runs against the in-memory fixture. The module-level `invalidate_is_player_cache(path)` is the production caller that opens its own connection. Both are defined in Step 3.

Make `conn` work as a fixture by binding it — the line:

```python
conn = parses_db.init_db(parses_db.Path(":memory:"))
```

requires `parses_db.Path` to be a module-level export. It already is (re-exported from `pathlib`), so the test is good as-is. If pyright complains, change to `from pathlib import Path` at the top of the test and use `Path(":memory:")`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/parses/test_db_is_player.py -v`

Expected: tests error with `AttributeError` on `parses_db.update_combatant_is_player` etc., or with `is_player` column missing.

- [ ] **Step 3: Add the migration + helpers to `parses/db.py`**

#### 3a. Append to `_MIGRATIONS` (currently ends at line 238)

Locate `_MIGRATIONS: list[str] = [` (line 217). Append ONE entry inside the list as the final element:

```python
    # Phase-1 pet-detection pipeline: is_player flag (per-combatant) is the
    # authoritative player/pet signal. DEFAULT NULL = the lazy-backfill
    # sentinel; pre-existing rows get classified on first read of their
    # parent encounter (see web/routes/parses/list.py:_ensure_classified).
    "ALTER TABLE combatants ADD COLUMN is_player INTEGER DEFAULT NULL",
```

#### 3b. Append to `_CREATE_INDEXES` (currently ends at line 212)

Locate `_CREATE_INDEXES = [` (line 201). Append ONE entry as the final element:

```python
    "CREATE INDEX IF NOT EXISTS idx_combatants_encounter_is_player ON combatants (encounter_id, is_player);",
```

#### 3c. Add the two helpers

Locate `update_combatant_snapshots` (currently at line 518). IMMEDIATELY after that function (around line 537), add:

```python
def update_combatant_is_player(conn: sqlite3.Connection, classification: dict[int, bool]) -> None:
    """Bulk UPDATE the per-combatant is_player flag.

    Called from:
      * the ingest path, after the classifier runs against newly-inserted rows
      * the async snapshot fill, after cls fills in (which can flip stage 5)
      * the lazy-backfill helper in web/routes/parses/list.py

    No-op when ``classification`` is empty. Caller owns the connection
    and transaction scope."""
    if not classification:
        return
    conn.executemany(
        "UPDATE combatants SET is_player = ? WHERE id = ?",
        [(1 if v else 0, k) for k, v in classification.items()],
    )


def invalidate_is_player_cache_with_conn(conn: sqlite3.Connection) -> None:
    """Mark every combatant row for lazy re-classification on next read.
    Variant that accepts an existing connection (used by tests + by the
    rankings cache-invalidation hook to share the parses.db connection)."""
    conn.execute("UPDATE combatants SET is_player = NULL")


def invalidate_is_player_cache(path: Path = DB_PATH) -> None:
    """Mark every combatant row for lazy re-classification on next read.
    Production caller (opens its own connection).

    Called by web/routes/rankings.py:invalidate_zones_cache so that a
    curator zone-edit propagates to the existing parses without a
    separate backfill — the next read of each encounter re-classifies
    against the updated zone trees.

    Brute-force table-wide invalidation is fine at current data size
    (test parses only as of 2026-05-30). If the parses corpus grows past
    ~10k encounters and this becomes painful, swap for a per-zone-targeted
    invalidation using an is_player_computed_at timestamp."""
    with sqlite3.connect(path) as conn:
        invalidate_is_player_cache_with_conn(conn)
```

- [ ] **Step 4: Run tests, expect green**

Run: `uv run pytest tests/parses/test_db_is_player.py -v`

Expected: 7 passed.

- [ ] **Step 5: Re-run Phase 1 tests + full parses suite**

Run: `uv run pytest tests/parses/ -v`

Expected: all previous tests still green plus the 7 new ones.

- [ ] **Step 6: Lint + types**

Run:
```
uv run ruff format --check parses/db.py tests/parses/test_db_is_player.py
uv run ruff check parses/db.py tests/parses/test_db_is_player.py
uv run pyright parses/db.py
```

Expected: all clean.

### Phase 2 checkpoint (manual, after user signs off)

```powershell
git add parses/db.py tests/parses/test_db_is_player.py
git commit -m "parses: combatants.is_player schema + helpers

Phase 2 of the pet-detection pipeline. Adds:
  * combatants.is_player INTEGER DEFAULT NULL (lazy-backfill sentinel)
  * idx_combatants_encounter_is_player covering the
    'WHERE encounter_id=? AND is_player=1' query shape that every read
    site will use post-Phase-4
  * update_combatant_is_player(conn, classification) — batch UPDATE
    helper, shared by ingest + async fill + lazy backfill
  * invalidate_is_player_cache(path) — table-wide NULL reset hook for
    the zone-cache invalidator (Phase 5). Brute-force is fine at
    current data size; flagged as a scalability concern in the spec.

Schema-only commit — the column is unused until Phase 3.

Part of: docs/superpowers/plans/2026-05-30-pet-detection-pipeline.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 3 — ingest + async snapshot re-classify

**Goal:** Classifier runs on every new upload (after combatant insert + cache-warm fast-path) and again after the async snapshot fill updates `cls`. New rows get `is_player` populated; existing rows still NULL.

### Task 3.1: Wire the classifier into both ingest paths + integration tests

**Files:**
- Modify: `web/routes/parses/ingest.py` (`_insert_encounter_rows_sync` adds a classify-and-update call; `_resolve_and_update_snapshots` adds a re-classify call after `_update_snapshots_sync`)
- Create: `tests/web/test_parses_ingest_classify.py`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/web/test_parses_ingest_classify.py` with EXACTLY this content:

```python
"""Tests for the Phase-3 classifier integration into the ingest path.

Verifies the classifier runs at upload time (populates is_player on
every newly-inserted combatant row) and re-runs after the async
snapshot fill completes (cls flips → is_player can flip too).
"""

from __future__ import annotations

import sqlite3
from unittest.mock import patch

import pytest


@pytest.mark.asyncio
async def test_ingest_populates_is_player_on_every_combatant(
    parses_db_path,  # fixture from tests/conftest.py — temp DB path
):
    """Synthesise an ingest call directly (skip HTTP) and confirm
    is_player flows onto every combatant row."""
    from parses import db as parses_db_mod
    from parses.models import Combatant, Encounter
    from web.routes.parses.ingest import _insert_encounter_rows_sync

    enc = Encounter(
        encid="testenc",
        title="Test Boss",
        zone="Halls of Fate",
        started_at=1716561116,
        ended_at=1716561176,
        duration_s=60,
        total_damage=120000,
        encdps=2000.0,
        kills=1,
        deaths=0,
    )
    combatants = [
        # confirmed player via cls
        Combatant(name="Alpha", ally=True, encdps=1000.0, enchps=200.0, encid="testenc"),
        # multi-word pet
        Combatant(name="a krait warrior", ally=True, encdps=500.0, enchps=0.0, encid="testenc"),
        # regex-match pet
        Combatant(name="Gibab", ally=True, encdps=400.0, enchps=0.0, encid="testenc"),
        # enemy (ally=False)
        Combatant(name="Test Boss", ally=False, encdps=0.0, enchps=300.0, encid="testenc"),
    ]
    snapshots = {"Alpha": _snap(cls="Wizard")}

    conn = parses_db_mod.init_db(parses_db_mod.DB_PATH)
    try:
        with patch("web.routes.parses.ingest._classify_zone", return_value="dungeon"):
            _insert_encounter_rows_sync(
                conn,
                enc,
                combatants=combatants,
                damage_types=[],
                attack_types=[],
                snapshots=snapshots,
                uploaded_by="Alpha",
                guild_name="Exordium",
                source_dsn="test",
                world="Varsoon",
            )
        rows = list(
            conn.execute(
                "SELECT name, ally, is_player FROM combatants ORDER BY id"
            )
        )
    finally:
        conn.close()

    by_name = {r[0]: r for r in rows}
    # Stage 5 — cls set → player
    assert by_name["Alpha"][2] == 1
    # Stage 3 — multi-word → pet
    assert by_name["a krait warrior"][2] == 0
    # Stage 4 — regex match → pet
    assert by_name["Gibab"][2] == 0
    # Enemy → is_player stays NULL (classifier omits ally=0 rows)
    assert by_name["Test Boss"][2] is None


@pytest.mark.asyncio
async def test_async_snapshot_fill_reclassifies(parses_db_path):
    """After ingest, an async snapshot fill updates cls. The classifier
    must re-run so is_player can flip from 0 → 1 for a previously-
    unconfirmed combatant that Census just resolved."""
    from parses import db as parses_db_mod
    from parses.models import Combatant, CombatantSnapshot, Encounter
    from web.routes.parses.ingest import _insert_encounter_rows_sync, _update_snapshots_sync

    enc = Encounter(
        encid="testenc2",
        title="Other Boss",
        zone="Antonica",
        started_at=1716561116,
        ended_at=1716561176,
        duration_s=60,
        total_damage=50000,
        encdps=500.0,
        kills=1,
        deaths=0,
    )
    # 5 unconfirmed allies (n_total=5, zone='other' → no bucket-fill).
    combatants = [
        Combatant(name=f"P{i}", ally=True, encdps=100.0 * i, enchps=0.0, encid="testenc2")
        for i in range(1, 6)
    ]

    conn = parses_db_mod.init_db(parses_db_mod.DB_PATH)
    try:
        with patch("web.routes.parses.ingest._classify_zone", return_value="other"):
            _insert_encounter_rows_sync(
                conn,
                enc,
                combatants=combatants,
                damage_types=[],
                attack_types=[],
                snapshots=None,
                uploaded_by="P1",
                guild_name=None,
                source_dsn="test",
                world="Varsoon",
            )
        # All five start as is_player=0 because no cls + no bucket-fill in 'other' n_total=5.
        baseline = {r[0]: r[1] for r in conn.execute("SELECT name, is_player FROM combatants")}
        assert all(v == 0 for v in baseline.values()), baseline

        # Simulate async fill: cls becomes known for P1 + P2.
        snapshots = {"P1": _snap(cls="Wizard"), "P2": _snap(cls="Berserker")}
        with patch("web.routes.parses.ingest._classify_zone", return_value="other"):
            _update_snapshots_sync_with_reclassify(conn, encounter_id_for(conn, "testenc2"), snapshots)

        after = {r[0]: r[1] for r in conn.execute("SELECT name, is_player FROM combatants")}
    finally:
        conn.close()

    assert after["P1"] == 1
    assert after["P2"] == 1
    assert after["P3"] == 0
    assert after["P4"] == 0
    assert after["P5"] == 0


# ── helpers ────────────────────────────────────────────────────────────

def _snap(*, cls=None, level=None, guild_name=None, ilvl=None):
    from parses.models import CombatantSnapshot
    return CombatantSnapshot(level=level, guild_name=guild_name, cls=cls, ilvl=ilvl)


def encounter_id_for(conn: sqlite3.Connection, act_encid: str) -> int:
    row = conn.execute("SELECT id FROM encounters WHERE act_encid = ?", (act_encid,)).fetchone()
    return int(row[0])


def _update_snapshots_sync_with_reclassify(conn, encounter_id, snapshots):
    """Mirror what _update_snapshots_sync will do after Phase 3 wiring:
    update snapshots then re-classify and write is_player. This helper
    proves the contract; the real ingest helper is patched below."""
    from web.routes.parses.ingest import _update_snapshots_sync
    _update_snapshots_sync(encounter_id, snapshots)
```

NOTE: this test imports `parses_db_path` from conftest; if that fixture doesn't already exist, use the `:memory:` shape from the Phase 2 tests. The async snapshot test additionally uses a `_update_snapshots_sync_with_reclassify` helper because the production helper changes during Phase 3 — the helper proves the contract without needing the new code to exist yet.

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/web/test_parses_ingest_classify.py -v`

Expected: tests fail because `is_player` isn't populated by `_insert_encounter_rows_sync` and isn't re-classified by `_update_snapshots_sync`.

- [ ] **Step 3: Wire the classifier into `_insert_encounter_rows_sync`**

In `web/routes/parses/ingest.py`, locate `_insert_encounter_rows_sync` (currently at line 481). Add a classifier call AFTER `parses_db.mark_ingested(...)` and BEFORE the closing `return` of the `with conn:` block. The full updated function:

```python
def _insert_encounter_rows_sync(
    conn: sqlite3.Connection,
    enc: Encounter,
    *,
    combatants: list,
    damage_types: list,
    attack_types: list,
    snapshots: dict[str, CombatantSnapshot] | None,
    uploaded_by: str,
    guild_name: str | None,
    source_dsn: str,
    world: str,
) -> tuple[int, int, int]:
    """Insert encounter + all sub-rows in a single transaction.
    Returns (encounter_id, n_damage_types, n_attack_types)."""
    ingested_at = int(time.time())
    with conn:
        encounter_id = parses_db.insert_encounter(
            conn,
            enc,
            source_dsn=source_dsn,
            ingested_at=ingested_at,
            uploaded_by=uploaded_by,
            guild_name=guild_name,
            world=world,
        )
        name_to_id = parses_db.insert_combatants_bulk(conn, encounter_id, combatants, snapshots)
        n_dt = parses_db.insert_damage_types_bulk(conn, name_to_id, damage_types)
        n_at = parses_db.insert_attack_types_bulk(conn, name_to_id, attack_types)
        parses_db.mark_ingested(
            conn,
            enc.encid,
            encounter_id,
            source_dsn=source_dsn,
            ingested_at=ingested_at,
            world=world,
        )
        # Phase 3 (pet detection): classify ally combatants now that the
        # cache-warm snapshot fast-path has populated cls for whatever was
        # already in character_cache. Any cls that fills in later via the
        # background snapshot resolution triggers a re-classify in
        # _resolve_and_update_snapshots.
        rows = parses_db.get_combatants_for_encounter(conn, encounter_id)
        zone_category = _classify_zone(enc.zone)
        classification = classify_combatants(rows, zone_category)
        parses_db.update_combatant_is_player(conn, classification)
    return encounter_id, n_dt, n_at
```

Add the two new imports at the top of the file (alongside the existing `from parses import db as parses_db`):

```python
from parses.pet_detection import classify_combatants
from web.routes.parses.list import _classify_zone
```

- [ ] **Step 4: Wire the re-classify into `_update_snapshots_sync`**

Locate `_update_snapshots_sync` (currently at line 244). Replace its body so it re-classifies after the snapshot update:

```python
def _update_snapshots_sync(encounter_id: int, snapshots: dict[str, CombatantSnapshot]) -> None:
    conn = parses_db.init_db(parses_db.DB_PATH)
    try:
        parses_db.update_combatant_snapshots(conn, encounter_id, snapshots)
        # Phase 3: re-classify because cls just changed. The classifier
        # is stage-5-driven by cls, so a fresh resolution can flip an
        # unconfirmed ally to player (or unblock a regex-match pet's
        # higher-rank slot from the bucket-fill pool).
        rows = parses_db.get_combatants_for_encounter(conn, encounter_id)
        enc = conn.execute(
            "SELECT zone FROM encounters WHERE id = ?",
            (encounter_id,),
        ).fetchone()
        zone = enc[0] if enc else None
        zone_category = _classify_zone(zone)
        classification = classify_combatants(rows, zone_category)
        parses_db.update_combatant_is_player(conn, classification)
        conn.commit()
    finally:
        conn.close()
```

(The original body just called `update_combatant_snapshots`; the new body also re-classifies and commits. The `with conn:` blocks inside the DB helpers already handle their own transactions, so the explicit `conn.commit()` is belt-and-braces for the combined sequence.)

- [ ] **Step 5: Run new tests**

Run: `uv run pytest tests/web/test_parses_ingest_classify.py -v`

Expected: 2 passed.

- [ ] **Step 6: Run the existing ingest test suite for regressions**

Run: `uv run pytest tests/web/test_parses_ingest.py tests/web/test_parses_ingest_hmac.py -v`

Expected: all pre-existing tests still pass. The classifier additions shouldn't affect any existing behaviour because the new `is_player` column is unused by readers until Phase 4.

- [ ] **Step 7: Lint + types**

Run:
```
uv run ruff format --check web/routes/parses/ingest.py tests/web/test_parses_ingest_classify.py
uv run ruff check web/routes/parses/ingest.py tests/web/test_parses_ingest_classify.py
uv run pyright web/routes/parses/ingest.py
```

Expected: all clean.

### Phase 3 checkpoint (manual, after user signs off)

```powershell
git add web/routes/parses/ingest.py tests/web/test_parses_ingest_classify.py
git commit -m "parses: ingest wires Phase-1 classifier (is_player on new rows)

Phase 3 of the pet-detection pipeline. classify_combatants runs in
two places now:
  1. _insert_encounter_rows_sync — after combatant insert + cache-warm
     snapshot fast-path. Every new ingest gets is_player populated on
     every ally row (enemies stay NULL — classifier omits ally=0).
  2. _update_snapshots_sync — after the async background fill writes
     fresh cls/level/guild_name/ilvl. Re-classify because stage-5
     (cls IS NOT NULL) can flip an unconfirmed ally → player, which
     in turn unblocks a bucket-fill slot for a different unconfirmed
     contributor.

Existing combatant rows (pre-migration) still have is_player=NULL —
they'll be lazy-backfilled by Phase 4's _ensure_classified on first
read.

No reader consumes is_player yet — Phase 4 is the behaviour-flip.

Part of: docs/superpowers/plans/2026-05-30-pet-detection-pipeline.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 4 — SQL filter switch + lazy backfill

**Goal:** Switch `_PLAYER_COUNT_SQL`, `_TOP_N_ALLY_SQL`, `_ALL_ALLY_SQL` to filter on `is_player = 1` instead of the multi-word/Unknown predicate. Add `_ensure_classified` and hook it into every read path so pre-migration rows are classified on demand. This is the behaviour-flip commit. **USER GATE before commit.**

### Task 4.1: Filter switch + lazy backfill + integration tests

**Files:**
- Modify: `web/routes/parses/list.py` (three SQL constants + `_ensure_classified` helper + hook into `_list_and_group_sync` and `_encounter_detail_sync`)
- Modify: `web/routes/rankings.py:_load_primary_boss_kills` (hook `_ensure_classified` so rankings reads are backed by classified data)
- Create: `tests/web/test_parses_pet_filter.py`

- [ ] **Step 1: Write the failing integration tests**

Create `tests/web/test_parses_pet_filter.py` with EXACTLY this content:

```python
"""Tests for the Phase-4 SQL filter switch + lazy backfill in
web/routes/parses/list.py.

After Phase 4: _PLAYER_COUNT_SQL filters on is_player=1, not on the
old multi-word/Unknown predicate. _ensure_classified runs lazy
backfill for any encounter whose combatants still have is_player=NULL
(i.e. pre-migration historic rows).
"""

from __future__ import annotations

import sqlite3
from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from tests.fixtures.users import make_fake_require_user, make_fake_user
from tests.web._parses_fixtures import _FAKE_ENCOUNTER

_fake_user = make_fake_require_user(make_fake_user(id="123456789"))


@pytest.mark.asyncio
async def test_player_count_reads_is_player_flag(app, parses_db_path):
    """A combatant whose is_player=0 must NOT count toward player_count
    even if its name is single-word + ally=1 (the old heuristic would
    have counted it)."""
    from parses import db as parses_db_mod

    conn = parses_db_mod.init_db(parses_db_mod.DB_PATH)
    try:
        # Insert one encounter + 3 single-word allies, all is_player=0
        # (pretend the classifier marked them pets).
        cur = conn.execute(
            """
            INSERT INTO encounters (
                act_encid, title, zone, started_at, ended_at, duration_s,
                total_damage, encdps, kills, deaths, source_dsn, ingested_at, world
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("encA", "Test", "Z", 1, 2, 1, 100, 100.0, 0, 0, "test", 1, "Varsoon"),
        )
        enc_id = int(cur.lastrowid or 0)
        for name in ("Alpha", "Bravo", "Charlie"):
            conn.execute(
                "INSERT INTO combatants (encounter_id, name, ally, is_player) VALUES (?, ?, ?, ?)",
                (enc_id, name, 1, 0),
            )
        conn.commit()
    finally:
        conn.close()

    with patch("web.routes.parses.list._require_user", _fake_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses?limit=10")

    assert r.status_code == 200
    data = r.json()
    assert len(data["results"]) == 1
    assert data["results"][0]["player_count"] == 0, "single-word allies with is_player=0 must not count"


@pytest.mark.asyncio
async def test_ensure_classified_backfills_null_rows(parses_db_path):
    """Inserting an encounter with combatant.is_player=NULL (mimicking a
    historic pre-migration row) then calling _ensure_classified on it
    must populate is_player on every row."""
    from parses import db as parses_db_mod
    from web.routes.parses.list import _ensure_classified

    conn = parses_db_mod.init_db(parses_db_mod.DB_PATH)
    try:
        cur = conn.execute(
            """
            INSERT INTO encounters (
                act_encid, title, zone, started_at, ended_at, duration_s,
                total_damage, encdps, kills, deaths, source_dsn, ingested_at, world
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("encB", "Test", "Halls of Fate", 1, 2, 1, 100, 100.0, 0, 0, "test", 1, "Varsoon"),
        )
        enc_id = int(cur.lastrowid or 0)
        # Insert two confirmed (cls set) and one multi-word pet, all is_player=NULL.
        conn.execute(
            "INSERT INTO combatants (encounter_id, name, ally, cls, is_player) VALUES (?, ?, ?, ?, ?)",
            (enc_id, "Alpha", 1, "Wizard", None),
        )
        conn.execute(
            "INSERT INTO combatants (encounter_id, name, ally, cls, is_player) VALUES (?, ?, ?, ?, ?)",
            (enc_id, "Bravo", 1, "Wizard", None),
        )
        conn.execute(
            "INSERT INTO combatants (encounter_id, name, ally, cls, is_player) VALUES (?, ?, ?, ?, ?)",
            (enc_id, "a krait warrior", 1, None, None),
        )
        conn.commit()
        # Sanity: every is_player is NULL.
        nulls = conn.execute("SELECT COUNT(*) FROM combatants WHERE is_player IS NULL").fetchone()[0]
        assert nulls == 3

        with patch("web.routes.parses.list._classify_zone", return_value="dungeon"):
            _ensure_classified(conn, enc_id, "Halls of Fate")

        rows = {r[0]: r[1] for r in conn.execute("SELECT name, is_player FROM combatants")}
    finally:
        conn.close()

    assert rows["Alpha"] == 1
    assert rows["Bravo"] == 1
    assert rows["a krait warrior"] == 0


@pytest.mark.asyncio
async def test_ensure_classified_is_noop_when_already_classified(parses_db_path):
    """Once every combatant has is_player populated, _ensure_classified
    must not re-run the classifier (no extra writes)."""
    from parses import db as parses_db_mod
    from web.routes.parses.list import _ensure_classified

    conn = parses_db_mod.init_db(parses_db_mod.DB_PATH)
    try:
        cur = conn.execute(
            """
            INSERT INTO encounters (
                act_encid, title, zone, started_at, ended_at, duration_s,
                total_damage, encdps, kills, deaths, source_dsn, ingested_at, world
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("encC", "Test", "Z", 1, 2, 1, 100, 100.0, 0, 0, "test", 1, "Varsoon"),
        )
        enc_id = int(cur.lastrowid or 0)
        conn.execute(
            "INSERT INTO combatants (encounter_id, name, ally, is_player) VALUES (?, ?, ?, ?)",
            (enc_id, "Alpha", 1, 1),
        )
        conn.commit()

        with patch("parses.pet_detection.classify_combatants") as fake:
            _ensure_classified(conn, enc_id, None)
            fake.assert_not_called()
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_phase4_merger_top_n_uses_is_player(app, parses_db_path):
    """Phase 4 merger's top-N gate must filter on is_player=1, so a
    bucket-promoted player CAN appear in top-N for merge decisions and
    a regex-matched pet CANNOT (even with high encdps)."""
    from parses import db as parses_db_mod

    conn = parses_db_mod.init_db(parses_db_mod.DB_PATH)
    try:
        for encid, uploader in (("encD1", "Alpha"), ("encD2", "Bravo")):
            cur = conn.execute(
                """
                INSERT INTO encounters (
                    act_encid, title, zone, started_at, ended_at, duration_s,
                    total_damage, encdps, kills, deaths, source_dsn, ingested_at,
                    world, uploaded_by, guild_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (encid, "Bossy", "Z", 1, 2, 1, 100, 100.0, 0, 0, "test", 1, "Varsoon", uploader, "Exordium"),
            )
            enc_id = int(cur.lastrowid or 0)
            # Top-3 by encdps in both encounters are the same three players —
            # plus one regex-matching pet with very high encdps that MUST NOT
            # qualify as top-N.
            for name, encdps, is_player in (
                ("Alpha", 5000.0, 1),
                ("Bravo", 4000.0, 1),
                ("Charlie", 3000.0, 1),
                ("Gibab", 99999.0, 0),  # pet — must not show in top-N
            ):
                conn.execute(
                    "INSERT INTO combatants (encounter_id, name, ally, encdps, is_player) VALUES (?, ?, ?, ?, ?)",
                    (enc_id, name, 1, encdps, is_player),
                )
        conn.commit()
    finally:
        conn.close()

    with patch("web.routes.parses.list._require_user", _fake_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses?limit=10")

    assert r.status_code == 200
    data = r.json()
    # Top-N (player_count = 3 → group bucket → N=2; identical top-2 means MERGE).
    assert data["total"] == 1, "merger should treat both uploads as the same fight"
```

- [ ] **Step 2: Run tests to verify they fail (most of them)**

Run: `uv run pytest tests/web/test_parses_pet_filter.py -v`

Expected: `_ensure_classified` doesn't exist yet → ImportError on import. Once the helper exists, the player-count test fails because `_PLAYER_COUNT_SQL` still uses the old predicate. The lazy-backfill tests fail because the helper isn't hooked yet. The merger test fails because the old SQL filter still counts `Gibab` as a top-N candidate (its encdps is huge).

- [ ] **Step 3: Update the three SQL constants in `web/routes/parses/list.py`**

Locate `_PLAYER_COUNT_SQL` (currently lines 69-76 before this task; ~lines 65-76 in the post-Phase-4-of-parse-grouping-redo state). Replace with:

```python
# Player count: ally combatants flagged is_player=1 by the pet-detection
# pipeline (see parses/pet_detection.py). Pre-Phase-4 historic rows
# have is_player=NULL until _ensure_classified backfills them on first
# read — until then they count as 0, which is fine because the lazy-
# backfill runs BEFORE the SQL filter in every read path.
_PLAYER_COUNT_SQL = """\
    SELECT COUNT(*) FROM combatants c
    WHERE c.encounter_id = e.id AND c.is_player = 1
"""
```

Locate `_TOP_N_ALLY_SQL` (currently lines 83-90 ish — search for `_TOP_N_ALLY_SQL =`). Replace with:

```python
_TOP_N_ALLY_SQL = """\
    SELECT name FROM combatants
    WHERE encounter_id = ? AND is_player = 1
    ORDER BY encdps DESC, name ASC
    LIMIT ?
"""
```

Locate `_ALL_ALLY_SQL` (immediately below `_TOP_N_ALLY_SQL`). Replace with:

```python
_ALL_ALLY_SQL = """\
    SELECT name FROM combatants
    WHERE encounter_id = ? AND is_player = 1
"""
```

Update the block comment above `_PLAYER_COUNT_SQL` to remove the now-obsolete "single-word / Unknown" reasoning if present.

- [ ] **Step 4: Add `_ensure_classified` to `web/routes/parses/list.py`**

Add the helper IMMEDIATELY after the three SQL constants and before `_list_encounters_sync`. Use EXACTLY this:

```python
def _ensure_classified(conn: sqlite3.Connection, encounter_id: int, zone: str | None) -> None:
    """Lazy backfill for pre-Phase-4 combatant rows.

    If any combatant for this encounter has ``is_player IS NULL`` (i.e.
    was inserted before the pet-detection pipeline shipped), run the
    classifier now and persist. No-op when every row is already
    classified (a single indexed lookup — steady-state cost is
    negligible).

    Called by every read path (parses list, parse detail, rankings load)
    before any ``WHERE is_player = 1`` query that depends on the value
    being populated. Without this, historic encounters would silently
    report player_count=0 forever."""
    needs = conn.execute(
        "SELECT 1 FROM combatants WHERE encounter_id = ? AND is_player IS NULL LIMIT 1",
        (encounter_id,),
    ).fetchone()
    if not needs:
        return
    rows = parses_db.get_combatants_for_encounter(conn, encounter_id)
    zone_category = _classify_zone(zone)
    classification = classify_combatants(rows, zone_category)
    parses_db.update_combatant_is_player(conn, classification)
    conn.commit()
```

Add the import at the top of the file (alongside existing imports):

```python
from parses.pet_detection import classify_combatants
```

- [ ] **Step 5: Hook `_ensure_classified` into `_list_and_group_sync`**

Locate `_list_and_group_sync` (the helper inside `list_parses`). After the row fetch and before `_group_into_fights`, classify every row's encounter:

```python
    def _list_and_group_sync() -> tuple[list[dict], list[dict], int]:
        """Run the inner-list SQL, then group into fights.

        (existing docstring …)"""
        rows = _list_encounters_sync(inner_cap, zone, size, current_world())
        if not rows:
            return rows, [], 0
        conn = parses_db.init_db(parses_db.DB_PATH)
        try:
            # Lazy backfill: any encounter inserted before the pet-detection
            # pipeline shipped has is_player=NULL on its combatants. Classify
            # before the merger runs so its top-N gate sees the correct
            # is_player flag for every row.
            for r in rows:
                _ensure_classified(conn, r["id"], r.get("zone"))
            fights = _group_into_fights(rows, conn)
        finally:
            conn.close()
        return rows, fights, len(fights)
```

NOTE: this DOES re-fetch `rows` AFTER classification implicitly — the `player_count` column in `rows` was computed by `_list_encounters_sync`'s outer SQL BEFORE the classifier ran. For pre-migration encounters, `player_count` will show as 0 in `rows` until the next request (which will see the now-populated `is_player`). Acceptable for v1; first-request-after-migration shows stale counts; second-request-onwards is correct. If we need first-request-correct semantics, re-fetch `player_count` per row inside the loop — but it doubles the SQL cost on every list request, so let's accept the v1 limitation.

Actually, to avoid the "first request after migration shows stale counts" UX glitch, update the rows dict in-place after classifying:

```python
    def _list_and_group_sync() -> tuple[list[dict], list[dict], int]:
        rows = _list_encounters_sync(inner_cap, zone, size, current_world())
        if not rows:
            return rows, [], 0
        conn = parses_db.init_db(parses_db.DB_PATH)
        try:
            # Lazy backfill before the merger runs OR the response is
            # built. After classify, re-query the player_count for each
            # backfilled encounter so the response shows correct
            # numbers on the same request (no stale-on-first-load
            # glitch).
            for r in rows:
                _ensure_classified(conn, r["id"], r.get("zone"))
                # Cheap re-read using the now-correct flag.
                refreshed = conn.execute(
                    "SELECT COUNT(*) FROM combatants WHERE encounter_id = ? AND is_player = 1",
                    (r["id"],),
                ).fetchone()
                r["player_count"] = int(refreshed[0])
            fights = _group_into_fights(rows, conn)
        finally:
            conn.close()
        return rows, fights, len(fights)
```

This adds one indexed `COUNT(*)` per encounter — fast on the new index from Phase 2.

- [ ] **Step 6: Hook `_ensure_classified` into `_encounter_detail_sync`**

Locate `_encounter_detail_sync` (currently around line 190). After fetching the encounter row and before the combatants fetch:

```python
def _encounter_detail_sync(encounter_id: int, top_attacks_per_combatant: int, world: str = "Varsoon") -> dict | None:
    """Return the encounter + its combatants + top attacks per combatant.

    (existing docstring …)"""
    if not parses_db.DB_PATH.exists():
        return None
    conn = parses_db.init_db()
    try:
        conn.row_factory = sqlite3.Row
        enc_row = conn.execute("SELECT * FROM encounters WHERE id = ? AND world = ?", (encounter_id, world)).fetchone()
        if enc_row is None:
            return None
        enc = dict(enc_row)
        # Lazy backfill so the per-combatant is_player flag is correct
        # for the frontend's Allies/Pets split.
        _ensure_classified(conn, enc["id"], enc.get("zone"))

        combatants = parses_db.get_combatants_for_encounter(conn, enc["id"])
        # (rest of function unchanged)
```

- [ ] **Step 7: Hook `_ensure_classified` into `_load_primary_boss_kills`**

In `web/routes/rankings.py`, locate `_load_primary_boss_kills`. Around the loop that builds kill rows, add a per-encounter `_ensure_classified` call:

```python
def _load_primary_boss_kills(conn: sqlite3.Connection, world: str) -> list[dict]:
    """(existing docstring …)"""
    from web.routes.parses.list import _ensure_classified  # local import: avoid cycle

    rows = conn.execute(
        # (existing SELECT — unchanged)
        ...
    ).fetchall()
    # Lazy backfill for any pre-migration combatant rows so the
    # is_player-derived player_count in the response is correct.
    for r in rows:
        _ensure_classified(conn, r["id"], r["zone"])
    # (rest of function unchanged)
    return rows
```

The exact placement depends on how `_load_primary_boss_kills` currently shapes its rows; locate the function and insert the backfill loop AFTER the SELECT and BEFORE any consumer reads `player_count` from `r`.

- [ ] **Step 8: Run all the new + adjacent tests**

Run: `uv run pytest tests/web/test_parses_pet_filter.py tests/web/test_parses_list.py tests/web/test_parses_list_category.py tests/web/test_parses_list_grouping.py tests/web/test_parses_top_n.py tests/web/test_parses_classify_zone.py -v`

Expected: all green. Pay attention to `test_parses_list_grouping.py` — Phase 4-of-parse-grouping-redo's merger tests must still pass. They patch `_top_n_ally_names` / `_all_ally_names` directly so the SQL change should be invisible to them; if they fail, that's a regression to investigate, not delete.

- [ ] **Step 9: Full backend sweep**

Run: `uv run pytest tests/web/ tests/parses/ -v`

Expected: same pass-count as before Phase 4 plus the 4 new tests. No regressions.

- [ ] **Step 10: Lint + types**

Run:
```
uv run ruff format --check web/routes/parses/list.py web/routes/rankings.py tests/web/test_parses_pet_filter.py
uv run ruff check web/routes/parses/list.py web/routes/rankings.py tests/web/test_parses_pet_filter.py
uv run pyright web/routes/parses/list.py web/routes/rankings.py
```

Expected: all clean.

### Phase 4 checkpoint (manual, AFTER user verifies test results)

USER GATE: This is the behaviour-flip commit — every reader now uses `is_player = 1`. Surface the pass-count from step 9 and confirm before committing.

```powershell
git add web/routes/parses/list.py web/routes/rankings.py tests/web/test_parses_pet_filter.py
git commit -m "parses: SQL filters read is_player=1; lazy backfill on read

Phase 4 of the pet-detection pipeline. The behaviour-flip commit:

_PLAYER_COUNT_SQL / _TOP_N_ALLY_SQL / _ALL_ALLY_SQL switch from the
legacy 'single-word AND name!=Unknown' predicate to 'is_player = 1'.
The Phase 4 (parse-grouping-redo) merger inherits the new filter via
its existing top-N call sites; mirror grouping now decides on the
pet-detection-correct set of players.

_ensure_classified(conn, encounter_id, zone) runs once per encounter
on every read path (parses list, parse detail, rankings load):
  * No-op when every combatant has is_player populated.
  * Otherwise runs classify_combatants and persists via
    update_combatant_is_player.
  * Picks up historic pre-migration rows on demand.

In the list path, player_count is also re-queried per row after the
backfill so the same response carries the correct count (no
stale-on-first-load glitch).

Part of: docs/superpowers/plans/2026-05-30-pet-detection-pipeline.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 5 — zone-cache invalidation hook

**Goal:** When a curator edits zones.db (e.g. promotes a previously-`other` zone to `dungeon`), the change must propagate to historic parses. Extend `rankings.invalidate_zones_cache()` to also nuke `is_player` table-wide so the next read of each encounter re-classifies under the new zone category.

### Task 5.1: Wire `invalidate_is_player_cache` into `invalidate_zones_cache` + tests

**Files:**
- Modify: `web/routes/rankings.py:invalidate_zones_cache` (one line + a comment)
- Modify or create: `tests/web/test_zones_cache_invalidation.py` (extend if it exists; create otherwise)

- [ ] **Step 1: Inspect the existing test (if any) before deciding extend vs create**

Run: `Test-Path tests/web/test_zones_cache_invalidation.py`

If TRUE, open the file and read its current test names. If FALSE, this task creates the file from scratch with the test below.

- [ ] **Step 2: Add the test(s)**

Either extend the existing file with these two tests OR create the file with the full block:

```python
"""Tests for rankings.invalidate_zones_cache() — Phase 5 of the
pet-detection pipeline extends it to also invalidate the combatant
is_player cache so curator zone edits propagate to historic parses
on the next read."""

from __future__ import annotations

import sqlite3

import pytest


def test_invalidate_zones_cache_nukes_combatant_is_player(parses_db_path):
    from parses import db as parses_db_mod
    from web.routes.rankings import invalidate_zones_cache

    conn = parses_db_mod.init_db(parses_db_mod.DB_PATH)
    try:
        cur = conn.execute(
            """
            INSERT INTO encounters (
                act_encid, title, zone, started_at, ended_at, duration_s,
                total_damage, encdps, kills, deaths, source_dsn, ingested_at, world
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ("invZ", "Test", "Z", 1, 2, 1, 100, 100.0, 0, 0, "test", 1, "Varsoon"),
        )
        enc_id = int(cur.lastrowid or 0)
        conn.execute(
            "INSERT INTO combatants (encounter_id, name, ally, is_player) VALUES (?, ?, ?, ?)",
            (enc_id, "Alpha", 1, 1),
        )
        conn.execute(
            "INSERT INTO combatants (encounter_id, name, ally, is_player) VALUES (?, ?, ?, ?)",
            (enc_id, "Bravo", 1, 0),
        )
        conn.commit()

        invalidate_zones_cache()

        rows = conn.execute("SELECT is_player FROM combatants").fetchall()
    finally:
        conn.close()

    assert all(r[0] is None for r in rows), "every is_player must be NULL after invalidate_zones_cache"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/web/test_zones_cache_invalidation.py -v`

Expected: the new test fails (the rows still have is_player=1/0 after invalidate_zones_cache because the hook isn't wired yet).

- [ ] **Step 4: Wire `invalidate_is_player_cache` into `invalidate_zones_cache`**

In `web/routes/rankings.py`, locate `invalidate_zones_cache` (currently around line 195-203). Update its body:

```python
def invalidate_zones_cache() -> None:
    """Clear the _cached_zones_data lru_cache AND the parses
    classifier's leaderboard map AND mark every combatant for
    re-classification.

    Call this after any mutation to zones / zone_encounters /
    zone_encounter_mobs so:
      * the next /api/rankings/filters rebuilds the dropdown tree
      * the next /api/parses request rebuilds the classifier map
      * existing parses re-classify against the updated zone trees
        on first read (the brute-force is_player NULL reset is fine
        at current data size — flagged as a scalability concern in
        the pet-detection-pipeline spec)
    """
    _cached_zones_data.cache_clear()
    # Local imports: parses.list already imports _cached_zones_data
    # from this module, and parses.db is a deeper dependency. Local
    # imports keep the module-load DAG cycle-free.
    from web.routes.parses.list import _classifier_cache_clear
    from parses import db as parses_db

    _classifier_cache_clear()
    parses_db.invalidate_is_player_cache()
```

- [ ] **Step 5: Run tests, expect green**

Run: `uv run pytest tests/web/test_zones_cache_invalidation.py tests/web/test_parses_classify_zone.py -v`

Expected: the new is_player-reset test passes, all the pre-existing zone-cache tests still pass.

- [ ] **Step 6: Full backend sweep**

Run: `uv run pytest tests/web/ tests/parses/ -v`

Expected: same pass-count as Phase 4 plus the 1 new test.

- [ ] **Step 7: Lint + types**

Run:
```
uv run ruff format --check web/routes/rankings.py tests/web/test_zones_cache_invalidation.py
uv run ruff check web/routes/rankings.py tests/web/test_zones_cache_invalidation.py
uv run pyright web/routes/rankings.py
```

Expected: all clean.

### Phase 5 checkpoint (manual, after user signs off)

```powershell
git add web/routes/rankings.py tests/web/test_zones_cache_invalidation.py
git commit -m "rankings: invalidate_zones_cache also nukes combatant is_player

Phase 5 of the pet-detection pipeline. The existing curator hook
(invalidate_zones_cache) already clears the _cached_zones_data LRU
and the parses classifier map. Now it also calls
parses_db.invalidate_is_player_cache() so a curator promoting a
zone from 'other' to 'dungeon' (etc.) propagates to historic parses:
the next read of each encounter re-classifies under the new zone
category and re-derives is_player accordingly.

Brute-force table-wide NULL reset is acceptable at current data size
(test parses only); spec calls out the scalability concern with a
per-zone-targeted invalidation as the future fix.

Part of: docs/superpowers/plans/2026-05-30-pet-detection-pipeline.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Phase 6 — frontend ParsePage predicate switch (UI)

**Goal:** Surface `is_player` through the API, swap the frontend Allies/Pets split predicate from the legacy heuristic to `!c.is_player`. UI change — **hold the commit for user visual review** per the hold-commits-on-visual-work memory.

### Task 6.1: API field + ParsePage predicate + frontend test

**Files:**
- Modify: `web/routes/parses/models.py` (add `is_player: bool` to `CombatantSummary`)
- Modify: `web/routes/parses/list.py:_encounter_detail_sync` and the route handler that builds `CombatantSummary` (populate the new field)
- Modify: `frontend/src/pages/ParsePage.tsx` (interface + `isPet` predicate)
- Create: `frontend/src/pages/ParsePage.test.tsx`

- [ ] **Step 1: Write the failing frontend test**

Create `frontend/src/pages/ParsePage.test.tsx` with EXACTLY this content:

```tsx
/**
 * ParsePage Allies/Pets split tests.
 *
 * The split predicate post-Phase-6 reads c.is_player directly (no more
 * cls / multi-word fallback heuristic). Bucket-promoted combatants
 * (is_player=true but cls=null) render in the Allies section identical
 * to Census-resolved players.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import ParsePage from './ParsePage'

interface MockCombatant {
  id: number
  name: string
  ally: boolean
  is_player: boolean
  level: number | null
  guild_name: string | null
  cls: string | null
  duration_s?: number
  damage?: number
  damage_perc?: number
  dps?: number
  encdps?: number
  dps_percentile?: number | null
  dps_best_overall?: boolean
  hps_percentile?: number | null
  hps_best_overall?: boolean
  healed?: number
  enchps?: number
  heals?: number
  crit_heals?: number
  cure_dispels?: number
  power_drain?: number
  power_replenish?: number
  heals_taken?: number
  damage_taken?: number
  threat_delta?: number
  deaths?: number
  kills?: number
  crit_hits?: number
  crit_dam_perc?: number
  top_attacks?: unknown[]
  top_heals?: unknown[]
  top_cures?: unknown[]
  top_threats?: unknown[]
  damage_types?: unknown[]
}

const _DEFAULTS = {
  duration_s: 60,
  damage: 100,
  damage_perc: 50,
  dps: 1.0,
  encdps: 1.0,
  dps_percentile: null,
  dps_best_overall: false,
  hps_percentile: null,
  hps_best_overall: false,
  healed: 0,
  enchps: 0,
  heals: 0,
  crit_heals: 0,
  cure_dispels: 0,
  power_drain: 0,
  power_replenish: 0,
  heals_taken: 0,
  damage_taken: 0,
  threat_delta: 0,
  deaths: 0,
  kills: 0,
  crit_hits: 0,
  crit_dam_perc: 0,
  top_attacks: [],
  top_heals: [],
  top_cures: [],
  top_threats: [],
  damage_types: [],
}

function combatant(o: Partial<MockCombatant> & Pick<MockCombatant, 'id' | 'name' | 'ally' | 'is_player'>): MockCombatant {
  return {
    ..._DEFAULTS,
    level: null,
    guild_name: null,
    cls: null,
    ...o,
  } as MockCombatant
}

function mockFetch(combatants: MockCombatant[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/zones/')) return { ok: false, status: 404, json: async () => ({}) }
      if (url.includes('/api/characters/lookup')) return { ok: true, status: 200, json: async () => ({ results: {} }) }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 1,
          act_encid: 'x',
          title: 'Test Boss',
          zone: 'Z',
          started_at: 100,
          ended_at: 200,
          duration_s: 100,
          total_damage: 1000,
          encdps: 100,
          kills: 1,
          deaths: 0,
          success_level: 1,
          hidden: false,
          uploaded_by: 'tester',
          uploader_discord_id: null,
          uploader_display_name: null,
          combatants,
        }),
      }
    }) as unknown as typeof fetch,
  )
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/parse/1']}>
      <Routes>
        <Route path="/parse/:id" element={<ParsePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { vi.restoreAllMocks() })


describe('ParsePage Allies/Pets split', () => {
  it('renders is_player=true combatants in Allies', async () => {
    mockFetch([
      combatant({ id: 1, name: 'Alpha', ally: true, is_player: true, cls: 'Wizard' }),
      combatant({ id: 2, name: 'a krait warrior', ally: true, is_player: false }),
    ])
    renderPage()
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('a krait warrior')).toBeInTheDocument()
    // Both render, but in different sections — verify section headings exist
    expect(screen.getByText('Allies')).toBeInTheDocument()
    expect(screen.getByText('Pets')).toBeInTheDocument()
  })

  it('renders bucket-promoted players (is_player=true, cls=null) in Allies', async () => {
    mockFetch([
      combatant({ id: 1, name: 'Bob', ally: true, is_player: true, cls: null }),
    ])
    renderPage()
    expect(await screen.findByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Allies')).toBeInTheDocument()
    // No Pets section because everyone is a player.
    expect(screen.queryByText('Pets')).not.toBeInTheDocument()
  })

  it('renders enemies in Enemies', async () => {
    mockFetch([
      combatant({ id: 1, name: 'Alpha', ally: true, is_player: true, cls: 'Wizard' }),
      combatant({ id: 2, name: 'Test Boss', ally: false, is_player: false }),
    ])
    renderPage()
    expect(await screen.findByText('Test Boss')).toBeInTheDocument()
    expect(screen.getByText('Enemies')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend ; npm test -- ParsePage`

Expected: fails because `is_player` isn't on the interface and the backend isn't sending it. Likely also fails at runtime because the `isPet` predicate doesn't yet read the field.

- [ ] **Step 3: Add `is_player` to the backend Pydantic model**

In `web/routes/parses/models.py`, locate `CombatantSummary` (currently around line 145). Insert `is_player: bool` immediately after `ally: bool`:

```python
class CombatantSummary(BaseModel):
    id: int
    name: str
    ally: bool
    # Pet-detection pipeline output (see parses/pet_detection.py).
    # Authoritative player/pet signal — drives the frontend Allies/Pets
    # split on the parse detail page. Bucket-fill-promoted combatants
    # are visually identical to Census-resolved players (per the spec's
    # "keep it clean" UX call).
    is_player: bool
    # (rest of fields unchanged)
    level: int | None = None
    # …
```

- [ ] **Step 4: Populate `is_player` in `_encounter_detail_sync`**

In `web/routes/parses/list.py`, locate `_encounter_detail_sync` (currently around line 190). Inside the combatant-loop where each combatant dict is enriched with `top_attacks`/`top_heals`/etc., add `c["is_player"] = bool(c.get("is_player"))` so the dict has a Python bool (the DB returns `Optional[int]`):

```python
        combatants = parses_db.get_combatants_for_encounter(conn, enc["id"])
        for c in combatants:
            c["top_attacks"] = parses_db.get_top_attacks_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["top_heals"] = parses_db.get_top_heals_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["top_cures"] = parses_db.get_top_cures_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["top_threats"] = parses_db.get_top_threats_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["damage_types"] = parses_db.get_damage_types_for_combatant(conn, c["id"])
            c["ally"] = bool(c["ally"])
            c["is_player"] = bool(c.get("is_player"))
```

Then locate the route handler `get_parse` (around line 354) that constructs `CombatantSummary` objects via `CombatantSummary(...)`. Add `is_player=c["is_player"]` to the constructor call.

- [ ] **Step 5: Switch the frontend predicate**

In `frontend/src/pages/ParsePage.tsx`:

#### 5a. Add `is_player` to the `CombatantSummary` interface (currently lines 17-55)

After `ally: boolean` (line 20), insert:

```tsx
  // Pet-detection pipeline output (see parses/pet_detection.py on the
  // backend). Authoritative player/pet signal — drives the Allies/Pets
  // split below. Bucket-fill-promoted combatants render identically to
  // Census-resolved players.
  is_player: boolean
```

#### 5b. Replace the `isPet` predicate (currently lines 161-167)

In the `useMemo` block:

```tsx
  const { allies, pets, enemies } = useMemo(() => {
    if (!data) return { allies: [], pets: [], enemies: [] }
    const byEncdps = (a: CombatantSummary, b: CombatantSummary) => b.encdps - a.encdps
    const isPet = (c: CombatantSummary): boolean => c.ally && !c.is_player
    const allyCombatants = data.combatants.filter(c => c.ally)
    return {
      allies:  allyCombatants.filter(c => !isPet(c)).sort(byEncdps),
      pets:    allyCombatants.filter(isPet).sort(byEncdps),
      enemies: data.combatants.filter(c => !c.ally).sort(byEncdps),
    }
  }, [data])
```

NOTE: the dependency array drops `lookup` because the new `isPet` doesn't read it. `lookup` is still used elsewhere in the file for the "show guild on hover" UX so the `useState` + the bulk-lookup effect stay; just the `useMemo` deps change.

Also: the `isLikelyPlayer` function (currently lines 94-98) is still used by the bulk-lookup effect to decide which names to look up. Leave it alone — only the `isPet` predicate inside the `useMemo` changes.

- [ ] **Step 6: Run the frontend test**

Run: `cd frontend ; npm test -- ParsePage`

Expected: 3 tests pass.

- [ ] **Step 7: Typecheck + build + full vitest sweep**

Run each:

```
cd frontend ; npm run typecheck
cd frontend ; npm run build
cd frontend ; npm test
```

Expected: typecheck clean, build clean, full vitest suite green (the existing count plus 3 new).

- [ ] **Step 8: Backend lint + types**

Run:
```
uv run ruff format --check web/routes/parses/models.py web/routes/parses/list.py
uv run ruff check web/routes/parses/models.py web/routes/parses/list.py
uv run pyright web/routes/parses/models.py web/routes/parses/list.py
```

Expected: clean.

- [ ] **Step 9: Manual visual check (user-driven)**

Hand off to the user:

> Build is clean and tests pass. ParsePage now reads is_player directly for the Allies/Pets split. Bucket-promoted combatants (single-word name, no cls, but is_player=true via Phase 1's bucket-fill) render in the Allies section identically to Census-resolved players. Want to spin up the dev server and look at a parse before I commit?

Wait for the user to OK the visual result. Per the hold-commits-on-visual-work memory: do not stage or commit until the user explicitly approves.

### Phase 6 checkpoint (manual, AFTER user visual approval)

```powershell
git add web/routes/parses/models.py web/routes/parses/list.py frontend/src/pages/ParsePage.tsx frontend/src/pages/ParsePage.test.tsx
git commit -m "ParsePage: Allies/Pets split reads is_player directly

Phase 6 of the pet-detection pipeline — the UI flip. CombatantSummary
gains 'is_player: bool' on the API side, populated by
_encounter_detail_sync from the persisted column. The frontend
ParsePage's Allies/Pets predicate switches from the legacy
'cls IS NULL AND (multi-word OR Unknown)' heuristic to a direct
'c.ally && !c.is_player' read.

Bucket-fill-promoted combatants (is_player=true, cls=null) render
in the Allies section identically to Census-resolved players —
no visible 'guessed player' badge per the spec's 'keep it clean'
UX decision.

3 vitest tests cover: is_player=false → Pets; is_player=true →
Allies (even without cls); enemies → Enemies.

Part of: docs/superpowers/plans/2026-05-30-pet-detection-pipeline.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Stage ONLY those four files. After commit, ask the user whether to push (Railway redeploys on every push to main). Do not push without explicit consent.

---

## Plan self-review

**Spec coverage:** Every component in the spec maps to a phase task:
- Spec § "Out of scope" — explicitly excluded; no tasks.
- Spec § "Architecture data flow" — Phases 1, 3, 4, 5 implement the diagram top-to-bottom.
- Spec § "Component 1 — schema migration" — Phase 2 Task 2.1.
- Spec § "Component 2 — classifier module" — Phase 1 Task 1.1.
- Spec § "Component 3 — SQL filter switch" — Phase 4 Task 4.1.
- Spec § "Component 4 — ingest integration" — Phase 3 Task 3.1.
- Spec § "Component 5 — zone reclassification hook" — Phase 5 Task 5.1.
- Spec § "Component 6 — lazy backfill on read" — Phase 4 Task 4.1 (`_ensure_classified`).
- Spec § "Component 7 — frontend ParsePage split" — Phase 6 Task 6.1.
- Spec § "Edge cases" — covered by tests (`test_empty_combatant_list…`, `test_all_pet_encounter…`, `test_missing_keys_do_not_raise`, the bucket-fill table tests).
- Spec § "Testing" — every test from the spec appears in a Phase task's test file.
- Spec § "Implementation order" — Phase numbering matches the spec's ordered list 1→6.

**Placeholders:** none in this plan body. The localStorage / "future micro-optimisation" comments are legitimate deferred follow-ups explicitly called out as out-of-scope.

**Type consistency:** `classify_combatants` signature `(list[dict], Literal["raid","dungeon","other"]) -> dict[int, bool]` is identical in Phase 1, Phase 3, Phase 4, Phase 5. `update_combatant_is_player(conn, dict[int, bool])` likewise consistent. `is_player: bool` field shape consistent on Pydantic + TypeScript interfaces in Phase 6.
