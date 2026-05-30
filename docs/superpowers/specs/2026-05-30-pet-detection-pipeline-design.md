# Pet detection pipeline — design

**Status:** approved through brainstorming on 2026-05-30; pending implementation plan.

## Goal

Replace the current single-stage player heuristic (`ally=1 AND single-word AND name != 'Unknown'`) with a multi-stage classifier that better separates real players from EQ2-auto-named pets, multi-word pet names, and unresolved-by-Census combatants. Persist the per-combatant classification so every consumer of `player_count` (ParsesPage list, individual parse detail, rankings scope, Phase 4 merger) reads the same answer cheaply.

## Out of scope (v1)

- **Manual override UI.** No "mark this as my pet" / "this is actually a real player" button. v1 accepts the heuristic's inaccuracy; revisit if it becomes a real complaint.
- **Pet → owner attribution.** EQ2 doesn't name pets after owners reliably and the parses table has no owner pointer.
- **Per-combatant `pet_reason` enum.** Binary `is_player INTEGER` only. If debug visibility is ever needed, add the enum then.
- **Bucket-fill "promoted" badge in UI.** A combatant promoted via bucket-fill is visually identical to a Census-resolved player.
- **Recomputing ranking results on backfill / rebuild script.** Lazy — next read of each leaderboard re-buckets via the new `player_count`. No explicit rebuild step.

## Architecture overview

```
At ingest (every upload):
        _ingest_payload_sync
            │
            ▼
        write combatant rows  ← is_player default NULL
            │
            ▼
        cache-warm character snapshot fast-path (existing, sets cls/level/...)
            │
            ▼
        classify_combatants(combatants, zone_category)   ← NEW
            │
            ▼
        batch UPDATE combatants SET is_player = ?   ← NEW
            │
            ▼
        respond to plugin

Async, post-response:
        _resolve_combatant_snapshots (existing — fills missing cls)
            │
            ▼
        update_combatant_snapshots (existing — writes new cls/level/...)
            │
            ▼
        classify_combatants again on the same encounter   ← NEW hook
            │
            ▼
        batch UPDATE is_player

On read (list / detail / rankings):
        SELECT … WHERE is_player = 1   ← replaces _PLAYER_COUNT_SQL filter
        Lazy backfill: if any combatant in the encounter has is_player IS NULL,
        recompute + persist before serving (one-time cost per historic encounter).
```

The classifier is a pure function. Every write hook calls the same function with the same inputs, so the persisted state always matches what the classifier would compute on the latest data.

## Component 1 — schema migration

**File:** `parses/db.py`

Add to the `combatants` table:

```sql
ALTER TABLE combatants ADD COLUMN is_player INTEGER DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_combatants_encounter_is_player
    ON combatants (encounter_id, is_player);
```

- `NULL` is the "never classified" sentinel — distinguishes from `0` (classified as not-a-player) and `1` (classified as player). Lets us lazy-backfill historic parses by detecting NULL on read.
- The index covers the most-frequent query shape: `WHERE encounter_id = ? AND is_player = 1` (used by every read-side helper).

Migration runs at startup via the existing `_MIGRATIONS` list in `parses/db.py` (same pattern as the rest of the project's schema changes).

## Component 2 — classifier module

**Location:** new module `parses/pet_detection.py`.

Carries:

- The EQ2 auto-pet regex (`EQ2_PET_PATTERN`) and `KNOWN_EXAMPLES` set — moved verbatim from `scripts/dev/pet_name_detector.py`. The dev script gets deleted in the same commit (the module is its permanent home).
- A pure function:

```python
from typing import Literal

def classify_combatants(
    combatants: list[dict],
    zone_category: Literal["raid", "dungeon", "other"],
) -> dict[int, bool]:
    """Return {combatant.id: is_player} for every ally combatant in the
    encounter. Enemies (ally=0) are omitted from the returned dict.

    Pipeline (ordering matters — cheap stages first, Census-derived
    signal last, bucket-fill at the end):

      1. ally == 0 → omit (not classified)
      2. name in {"", "Unknown"} → pet
      3. " " in name (multi-word) → pet
      4. EQ2_PET_PATTERN.match(name) or name in KNOWN_EXAMPLES → pet
      5. cls IS NOT NULL → player (Census-resolved at ingest or by
         the async snapshot fill)
      6. survived 1-5 → unconfirmed. Run bucket-fill (see below) and
         promote a subset to player; leftovers become pet.
    """
```

**Step 6 — bucket-fill rules** (matches the user-clarified table):

| Zone category | n_total | Behaviour |
|---|---|---|
| `raid` | any | Fill confirmed up to 24; if final n_player > 24, trim to 24 |
| `dungeon` | any | Fill confirmed up to 6 (additive only — never trims) |
| `other` | ≤ 6 | No-op (already group-sized) |
| `other` | 7–10 | Fill confirmed up to 6 (no-op if already ≥ 6, additive only) |
| `other` | ≥ 11 | Treat as raid (fill to 24, trim if final n_player > 24) |

Where:
- **Fill confirmed up to X**: sort unconfirmed allies by `(encdps + enchps)` DESC with `name ASC` tiebreaker; promote the top `min(X - n_player, len(unconfirmed))` to player. Stop if pool exhausted.
- **Trim to X**: sort confirmed allies by `(encdps + enchps)` ASC with `name ASC` tiebreaker; demote the lowest `n_player - X` back to pet. Used only when raid/raid-like fill ends up with > 24 confirmed (the merc/swap-in case).

**Tiebreaker note:** the ASC name tiebreaker on identical `(encdps + enchps)` makes the promotion/demotion deterministic so the result is stable across re-runs of the classifier on the same data.

## Component 3 — SQL filter switch

**File:** `web/routes/parses/list.py`

The three SQL constants currently expressed in terms of multi-word/Unknown:

```sql
-- _PLAYER_COUNT_SQL (old)
SELECT COUNT(*) FROM combatants c
WHERE c.encounter_id = e.id
  AND c.ally = 1
  AND c.name != '' AND c.name != 'Unknown'
  AND instr(c.name, ' ') = 0
```

become flag-driven:

```sql
-- _PLAYER_COUNT_SQL (new)
SELECT COUNT(*) FROM combatants c
WHERE c.encounter_id = e.id AND c.is_player = 1
```

Same shape for `_TOP_N_ALLY_SQL` and `_ALL_ALLY_SQL` — the `WHERE` clause becomes `WHERE encounter_id = ? AND is_player = 1`. The Phase 4 merger inherits the new filter without any other change. Top-N now ranks the *real players* only — bucket-fill-promoted contributors are eligible for top-N, regex-matched pets are not.

## Component 4 — ingest integration

**File:** `web/routes/parses/ingest.py`

After the existing combatant insert + cache-warm snapshot fast-path in `_ingest_payload_sync` (currently around the existing `_cached_snapshots()` call), call:

```python
from parses.pet_detection import classify_combatants
from web.routes.parses.list import _classify_zone

zone_category = _classify_zone(encounter_row["zone"])
combatants_with_is_player = classify_combatants(combatant_rows, zone_category)
# Batch UPDATE one row per combatant.id.
update_combatant_is_player(conn, combatants_with_is_player)
```

The async snapshot fill in `_resolve_combatant_snapshots` gets the same call appended after `update_combatant_snapshots`:

```python
# After updating cls/level/guild_name/ilvl, re-classify because cls
# changed and that affects stage 5 of the pipeline.
combatants = parses_db.get_combatants_for_encounter(conn, encounter_id)
zone_category = _classify_zone(encounter["zone"])
classification = classify_combatants(combatants, zone_category)
update_combatant_is_player(conn, classification)
```

**New helper** in `parses/db.py`:

```python
def update_combatant_is_player(conn: sqlite3.Connection, classification: dict[int, bool]) -> None:
    """Bulk UPDATE combatants.is_player from the classifier's output.
    classification keys are combatant.id; values are is_player (0/1)."""
    conn.executemany(
        "UPDATE combatants SET is_player = ? WHERE id = ?",
        [(int(v), k) for k, v in classification.items()],
    )
```

## Component 5 — zone reclassification hook

**File:** `web/routes/rankings.py`

The existing `invalidate_zones_cache()` is the canonical hook for "zones.db state changed; re-derive". It already calls `_classifier_cache_clear()` for the parses-list zone classifier. We extend it to also schedule a re-classification of every encounter whose zone is in the affected set.

In practice this is rare (only fires when a curator promotes a zone to `raid_x4` / `dungeon`), so the cleanest implementation is:

```python
def invalidate_zones_cache() -> None:
    _cached_zones_data.cache_clear()
    from web.routes.parses.list import _classifier_cache_clear
    _classifier_cache_clear()
    # Mark every existing combatant for lazy re-classification: setting
    # is_player back to NULL forces the next read of each encounter to
    # re-run the classifier (see Component 6).
    from parses import db as parses_db
    parses_db.invalidate_is_player_cache()
```

**New helper** in `parses/db.py`:

```python
def invalidate_is_player_cache(path: Path = DB_PATH) -> None:
    """Mark every combatant row for lazy re-classification on next read.
    Called by invalidate_zones_cache so zone-classification changes
    propagate to existing parses without a separate backfill."""
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE combatants SET is_player = NULL")
```

This is a one-statement update on a small table (~tens of thousands of rows max in the foreseeable future). Acceptable cost per curator edit. If the table ever grows large enough that this becomes painful, swap for an `is_player_computed_at` timestamp compared against a per-zone reclassification timestamp.

## Component 6 — lazy backfill on read

**File:** `web/routes/parses/list.py` (and `rankings.py` symmetrically)

The user picked the lazy-backfill option (Q2-b) because the dataset is small and pre-release. Every read path checks if any combatant in the encounter has `is_player IS NULL`; if so, the classifier runs and persists before the response is built.

Implementation lives inside `_list_and_group_sync` (which already opens a conn for the merger) — one extra SQL per encounter to check for NULLs, classify if needed, then proceed:

```python
def _ensure_classified(conn: sqlite3.Connection, encounter_id: int, zone: str | None) -> None:
    """If any combatant for this encounter has is_player IS NULL, run
    the classifier now and persist. No-op when fully classified."""
    needs = conn.execute(
        "SELECT 1 FROM combatants WHERE encounter_id = ? AND is_player IS NULL LIMIT 1",
        (encounter_id,),
    ).fetchone()
    if not needs:
        return
    combatants = parses_db.get_combatants_for_encounter(conn, encounter_id)
    zone_category = _classify_zone(zone)
    classification = classify_combatants(combatants, zone_category)
    update_combatant_is_player(conn, classification)
```

Called once per encounter during the list / detail / rankings flow, before any `WHERE is_player = 1` query that depends on the value being populated. The check is one indexed lookup so the steady-state cost (everything classified) is negligible.

**Note on rankings cost:** `_load_primary_boss_kills` reads many encounters at once. Calling `_ensure_classified` per encounter in a tight loop is fine for the current dataset size (the user confirmed there are very few parses today). If the dataset grows past ~1000 encounters and the lazy-classify cost becomes visible, the future fix is a one-shot backfill — but it's deferred until measurement says it's needed.

## Component 7 — frontend ParsePage split

**File:** `frontend/src/pages/ParsePage.tsx` (individual parse detail; not the parses list)

The existing `cls IS NULL AND (multi-word OR Unknown)` heuristic that drives the "Allies" vs "Pets" split is replaced by reading the new `is_player` field directly. One-line predicate change. No new component, no new section.

**Detail API shape:** `CombatantSummary` (in `web/routes/parses/models.py`) gains:

```python
is_player: bool
```

`_encounter_detail_sync` (in `web/routes/parses/list.py`) populates it from the persisted column. The frontend predicate becomes `c.is_player` instead of the heuristic.

The bucket-filled "promoted-from-pet" players appear in the Allies section identically to Census-resolved players (per Q3 — keep it clean, no auto-promoted hint).

**ParsesPage list:** no further change. The per-row `Np` badge already reads `player_count`, which is now the flag-based count.

**RankingsPage:** no further change. `_scope_for(player_count)` is unchanged. Existing parses re-bucket on next read.

## Edge cases

- **Encounter with zero ally combatants.** Classifier returns `{}`. `_PLAYER_COUNT_SQL` returns 0. Rankings excludes via `_scope_for(0) is None`. Same behaviour as today.
- **Encounter with one Census-resolved player.** Stage 5 marks them player; no bucket-fill applies (zones all default to leave-alone for n_total = 1). `_scope_for(1) is None` so it's excluded from rankings. Same as today.
- **Raid zone where every ally has multi-word name.** Stage 3 marks all as pet → n_player = 0. Bucket-fill: target 24, but no unconfirmed → no promotion. Result: 0 players. This is the unusual case of an all-pet parse. Surfaces as a 0-player encounter on the list — visually obvious that something's off.
- **Dungeon zone with 8 Census-confirmed players (mercs + group).** Dungeon rule is additive-only, so all 8 stay as players. `player_count = 8`. Rankings buckets as raid (≥ 7). The user's expectation: dungeons trust the Census count.
- **Other zone with 25+ confirmed players.** Other 11+ treated as raid. After fill (no-op since already > 24), trim to 24. Six lowest contributors get demoted to pet. This is the merc/swap-in case in an unclassified zone.
- **A confirmed player legitimately has an EQ2-pet-style name** ("Gibab" the wizard). Stage 4 misclassifies them as pet. Stage 6's bucket-fill might rescue them if their `(encdps + enchps)` is high enough to be in the top-N of the unconfirmed pool. If not, they show up as a pet in the UI. Accepted v1 inaccuracy.
- **The `pet_name_detector.py` dev script.** Deleted in the same commit as `parses/pet_detection.py` is created. Its tests (if any — currently it has a `__main__` smoke harness) become real pytest tests under `tests/parses/test_pet_detection.py`.
- **Classifier is called with mismatched encounter data.** Defensive: classifier accepts any list of dicts shaped like `{id, name, ally, cls, encdps, enchps}` plus a zone category string. Missing keys → treat as None/0; the function never raises.

## Testing

**Unit tests** (`tests/parses/test_pet_detection.py`, new file):
- Regex stage: `KNOWN_EXAMPLES` set members all match. The user's prototype examples (`Gibab`, `Zosn`, `Kebn`, `Zebekn`, `Jentik`, `Xebobtik`, `Kabantik`, `Jonaner`) all match. Real player names (`Bob`, `Fluffy`, `Menludiir`, `Sihtric`) do not.
- Pipeline stages in isolation: each stage's classification short-circuits correctly (multi-word → pet, regex match → pet, cls non-null → player, etc.).
- Bucket-fill — one test per row of the rule table above. Verify the right number of unconfirmed get promoted, the right number of confirmed get demoted (when applicable), and the result respects the per-zone cap.
- Determinism: same inputs → same `{id: bool}` map across multiple runs (encdps + name tiebreaker holds).
- Edge cases: empty combatant list → empty dict; all-pet encounter → all 0s; classifier never raises on missing keys.

**Integration tests** (`tests/web/test_parses_pet_detection_ingest.py`, new file):
- Posting a parse via `/api/parses/ingest` results in `is_player` populated on every combatant row.
- The new SQL filter (`WHERE is_player = 1`) returns the same set of names as the classifier's player-true output.
- `_list_and_group_sync` triggers lazy backfill: an encounter inserted with `is_player IS NULL` (simulating a pre-migration row) gets classified on first read.
- `invalidate_zones_cache()` resets all `is_player` to NULL so the next read recomputes.

**Regression tests** — re-run the full `tests/web/` suite after the change. Phase 4's merger tests (`test_parses_list_grouping.py`) should still pass: the top-N filter now reads `is_player = 1` but the test fixtures use `_top_n_ally_names`/`_all_ally_names` patches that don't go through the SQL, so they're unaffected. If they break, that's a regression to investigate, not delete.

## Implementation order (preview for the plan)

The plan will sequence work so each commit ships green CI:

1. **`parses/pet_detection.py` module + `tests/parses/test_pet_detection.py`** — pure function, no DB. Includes deleting `scripts/dev/pet_name_detector.py` and the integration tests for the regex/bucket-fill rules.
2. **Schema migration + `update_combatant_is_player` helper + `invalidate_is_player_cache` helper** — schema only; no behaviour change yet.
3. **Ingest integration + async snapshot re-classify hook** — classifier now runs on every new upload. Existing rows still have `is_player IS NULL` so reads still use the old SQL filter.
4. **SQL filter switch + lazy backfill** — `_PLAYER_COUNT_SQL` etc. start reading `is_player = 1`. `_ensure_classified` runs on every encounter read so pre-existing rows get classified on demand. This is the behaviour-flip commit.
5. **`invalidate_zones_cache` extension + tests** — curator zone edits propagate. Final closing-the-loop commit.
6. **Frontend ParsePage predicate switch + `CombatantSummary.is_player` field + integration test** — UI now reads the persisted flag instead of the legacy heuristic.

Each step is independently committable + reviewable. The plan can pause at any step without leaving a half-broken endpoint.
