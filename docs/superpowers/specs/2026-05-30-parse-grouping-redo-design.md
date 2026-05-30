# Parse grouping redo — design

**Status:** approved through brainstorming on 2026-05-30; pending implementation plan.

## Goal

Replace the existing player-count heuristic for parse classification ("2–6 = Group, 7+ = Raid, computed at render time") with a deliberate hierarchy backed by the rankings leaderboard predicate:

```
Guild (from uploader's resolved guild_name)
  ├── Raid     — zone is on the raid leaderboard
  ├── Dungeon  — zone is on the dungeon leaderboard
  └── Other    — everything else
```

A zone is "on the leaderboard" iff it satisfies the same predicate the rankings page already runs:
`(zone_types.type IN ('raid_x4','dungeon')) AND (zone has ≥1 row in zone_encounters)`.

Simultaneously, tighten the existing parse merger so two different groups doing the same boss at the same time don't get merged into one fight. The merge gate today is `(different uploaders) AND (same guild_name) AND (same title) AND (start times within 60s)`. We add one more clause: the top-N ally encDPS combatants of each upload must appear in the other upload's ally list.

## Out of scope (v1)

- **Rankings page changes.** The classifier is parallel to `_resolve_boss`; we don't change which encounters rank, only how the parses page groups them.
- **Persisted `category` column on `encounters`.** Computed at query time; revisit only if rankings or stats want it.
- **Further subdivision of "Other".** Heroic dungeons not on the curator list, solo parses, trash-only fights all share one bucket.
- **Retroactive re-merge of historical fights.** The new top-N gate applies only to merge decisions made after this ships. A re-bucket script can come later if needed.
- **Storing per-fight ally rankings.** Top-N is computed on the fly from `combatants` rows during the merger pass; no schema migration.

## Data flow

```
GET /api/parses?world=Varsoon
        │
        ▼
_list_encounters_sync          ← unchanged: returns raw encounter rows
        │
        ▼
_classify_zone(row.zone)       ← NEW: lookup against cached leaderboard set;
        │                         attaches row["category"] ∈ {"raid","dungeon","other"}
        ▼
_group_into_fights              ← UPDATED: adds top-N mutual-containment clause to
        │                         the existing merge predicate
        ▼
ParsesListResponse              ← serialised; category is on each fight
        │
        ▼
ParsesPage.tsx (frontend)       ← UPDATED: render hierarchy is
                                  guild → category → fight rows
```

The ranking-leaderboard zone set is loaded once at module import via `rankings._cached_zones_data()` (existing `functools.lru_cache`, cleared by the same hook that admins use after curator edits) and exposed as a lowercase-name → category map. No new caching infrastructure.

## Component 1 — zone classifier

**Location:** `web/routes/parses/list.py` (new module-level helper), reusing the cached zone trees already exposed by `web/routes/rankings.py`.

**Signature:**

```python
def _classify_zone(zone: str | None) -> Literal["raid", "dungeon", "other"]
```

**Behaviour:**

1. Empty / `None` / `(unknown zone)` → `"other"`.
2. Lookup against a cached map `{zone_name_lower: category}` built once from `rankings._cached_zones_data()`. The two trees that function returns already embed the leaderboard predicate (correct type AND ≥1 curated boss), so the map is just `{z.zone.lower(): "raid" for z in raid_tree} | {z.zone.lower(): "dungeon" for z in dungeon_tree}`.
3. If the lowercased zone matches → return that category.
4. Otherwise, fall through to alias resolution: `zones_db.find_by_name(zone)` returns the canonical name (or None). Retry the map with the canonical name.
5. Still no match → `"other"`.

**Cache invalidation:** `_cached_zones_data.cache_clear()` is already called from the admin "rebuild zones data" hook; the classifier map is derived lazily inside `_classify_zone` via a tiny module-level `_LEADERBOARD_MAP = None` sentinel that's also reset by the same admin hook. One-time cost per process is negligible (two list comprehensions over the two trees, < 200 zones total).

**Why not just JOIN against zones.db on every list call?** `_list_encounters_sync` already runs one parameterised query per request; an extra JOIN per row would be fine for correctness but worse than reusing the existing in-memory map. The map approach matches what `_resolve_boss` does for raids (`boss_index.get(_normalise_boss_key(title))`).

## Component 2 — top-N ally helper

**Location:** `web/routes/parses/list.py`.

**Signature:**

```python
def _top_n_ally_names(conn: sqlite3.Connection, encounter_id: int, n: int) -> set[str]
def _all_ally_names(conn: sqlite3.Connection, encounter_id: int) -> set[str]
```

**Queries:**

```sql
-- top-N
SELECT name FROM combatants
WHERE encounter_id = ? AND ally = 1
  AND name != '' AND name != 'Unknown' AND instr(name, ' ') = 0
ORDER BY encdps DESC, name ASC
LIMIT ?
```

```sql
-- all allies
SELECT name FROM combatants
WHERE encounter_id = ? AND ally = 1
  AND name != '' AND name != 'Unknown' AND instr(name, ' ') = 0
```

Same player-detection filter that `_PLAYER_COUNT_SQL` already uses (single-word + ally + not "Unknown"). Tiebreaker on `name ASC` makes determinism explicit when two combatants have identical encdps.

**N selection** (per merge candidate, computed in `_group_into_fights`):

```python
n = 3 if max(g["player_count"], e["player_count"]) >= 7 else 2
```

**Degenerate case:** if a parse has fewer than N ally combatants, `top_n` returns whatever it has (LIMIT N is the upper bound). The mutual-containment check below still works — small sets get checked against small sets.

## Component 3 — augmented merger

**Location:** `web/routes/parses/list.py:_group_into_fights` (existing function, one new clause).

**New clause inserted between the time-window check (line 169) and the attach step (line 171):**

```python
# Top-N mutual containment: each upload's top-N ally encDPS combatants must
# appear *somewhere* in the other upload's ally list. Prevents two different
# groups doing the same boss within 60s of each other from merging into one
# fight when they share guild + title but have entirely different rosters.
n = 3 if max(g["player_count"], e["player_count"]) >= 7 else 2
top_e = _top_n_ally_names(conn, e["id"], n)
all_e = _all_ally_names(conn, e["id"])
# Compare new upload against the CANONICAL upload in the group. Group
# membership is overlap-transitive only THROUGH the canonical (every member
# overlapped with the then-canonical at the time of joining), not member-to-
# member. The canonical can also swap mid-group when a longer-duration upload
# joins, so the join criterion has a moving target. Both are acceptable for
# v1 — the pathological case (a new join overlaps the current canonical but
# would have failed against an earlier member's roster) is rare in practice.
top_g = _top_n_ally_names(conn, g["id"], n)
all_g = _all_ally_names(conn, g["id"])
if not (top_e.issubset(all_g) and top_g.issubset(all_e)):
    continue
```

**Why mutual containment, not strict equality:** the user's stated rule was "top 3 are in the raid". Strict set equality (`top_e == top_g`) would reject merges where ACT in upload A captured a healer that upload B's ACT missed — clearly the same fight. Mutual containment forgives one-sided missing low-DPS combatants while still failing the "two distinct groups" case (their top lists are disjoint).

**SQL connection:** the merger today is pure Python over already-fetched rows. The new clause needs a sqlite3 connection. We open one in `list_parses` (the route handler), pass it through `_group_into_fights(rows, conn)`, and rely on the request scope to close it. Alternatively, fold the top-N lookups into the initial `_list_encounters_sync` query as JSON-aggregated columns; this is a code-clarity tradeoff and we choose connection-passing because it keeps the SQL helpers small and individually testable.

**All other gates unchanged** (different uploaders, same guild_name, same title, within `PARSE_MIRROR_WINDOW_S`).

## Component 4 — API response

`ParseEncounterSummary` (Pydantic model in `web/routes/parses/models.py`) gains:

```python
category: Literal["raid", "dungeon", "other"]
```

`_list_encounters_sync` (or its caller in the route handler) sets `row["category"] = _classify_zone(row["zone"])` on every row before grouping. After grouping, each fight's category is the canonical upload's category (which equals every member's category by transitivity of `same title → same zone → same classification`).

No other API fields change. `player_count` and `size` stay; the frontend uses category for grouping and player_count for the small per-row badge.

## Component 5 — frontend ParsesPage

**Location:** `frontend/src/pages/ParsesPage.tsx` plus extracted sibling files per the existing file-split convention if the page passes ~700 lines after the change.

**Render hierarchy:**

```
<main>
  {guildSections.map(g =>
    <section key={g.guild}>
      <h2>{g.guild ?? "(no guild)"}</h2>

      <Collapsible defaultOpen>
        <h3>Raid · {g.raidFights.length}</h3>
        {g.raidFights.map(<FightRow />)}
      </Collapsible>

      <Collapsible defaultOpen>
        <h3>Dungeon · {g.dungeonFights.length}</h3>
        {g.dungeonFights.map(<FightRow />)}
      </Collapsible>

      <Collapsible defaultOpen={false}>
        <h3>Other · {g.otherFights.length}</h3>
        {g.otherFights.map(<FightRow />)}
      </Collapsible>
    </section>
  )}
</main>
```

**Default open state:**
- Raid: open
- Dungeon: open
- Other: collapsed

User toggles are session-local in v1 — clicking the chevron flips the section open or closed in component state, but the page resets to default-open-state on reload. Persisting preferences via `localStorage` is a clean follow-up if requested; deliberately excluded from v1 so the regroup ships smaller.

**Sorting:**
- Guilds: by total fight count desc; `(no guild)` always last.
- Within a category: most recent fight first (today's `started_at DESC` order, unchanged).

**Empty states:** a category subsection with zero fights renders nothing (not "0 fights" placeholder). A guild with zero fights is not present in the response at all.

**Today's `sizeLabel`** ("Raid (24)", "Raid (12)", "Group", "Individual") is replaced by a small per-row badge showing only the player count (`24p`, `12p`, `6p`, `1p`). The category is the section heading; duplicating it on every row is noise.

**World filter:** unchanged. The per-server subdomain still scopes the whole page to one world.

## Edge cases

- **Uploader with no resolved guild.** `encounters.guild_name IS NULL` → fight is grouped under a `(no guild)` guild section. Internal logic treats `None` as a sentinel guild value; the section heading renders the placeholder.
- **Zone string casing variance.** Census/ACT sometimes capitalises zone names differently per upload. The classifier lowercases before lookup, then alias-resolves for true variants ("Kaesora" vs "Kaesora: Halls of the Forgotten").
- **Zone we've never seen before.** If `_classify_zone` returns `"other"` because the curator hasn't populated bosses, that's intentional — Other bucket holds unstable/early-expansion content. If curator later adds the zone to `zone_encounters`, future list calls reclassify it once the admin hook flushes the cache.
- **Fewer than N ally combatants.** Solo-someone-kills-a-raid-boss case. `_top_n_ally_names` returns ≤ N names. Mutual containment still works — two-element sets compare cleanly. The merge happens if the small available top sets each appear in the other.
- **Top-N has ties at position N.** Determinism via `ORDER BY encdps DESC, name ASC`. Both uploads see the same tiebreaker, so the rule is stable.
- **Bot-uploaded fights with no ally combatants at all.** Top-N is empty set; `set() ⊆ X` is trivially true. Such fights merge on the existing gates alone. Acceptable — empty-ally fights are rare and unmergeable in practice (no shared identity to merge on).
- **Cache stale after curator edit.** Admin "rebuild zones data" hook (existing) calls `_cached_zones_data.cache_clear()` and also resets the new `_LEADERBOARD_MAP` sentinel. Without the hook, restart picks up new zones on next deploy.

## Testing

**Unit tests** (`tests/web/test_parses_classify_zone.py`, new file):
- `_classify_zone("Castle Mistmoore")` → `"raid"` (raid_x4 + curated bosses).
- `_classify_zone("Halls of Fate: The Throne")` → `"dungeon"` if curated, `"other"` if not.
- `_classify_zone("Antonica")` → `"other"`.
- `_classify_zone(None)` → `"other"`.
- `_classify_zone("")` → `"other"`.
- `_classify_zone("CASTLE MISTMOORE")` → `"raid"` (case-insensitive).
- `_classify_zone(<alias>)` → `"raid"` (alias-resolves to canonical).
- After `_cached_zones_data.cache_clear()` with a zones.db that now has `dungeon` + curated bosses for a previously-Other zone → reclassifies.

**Unit tests** (`tests/web/test_parses_top_n.py`, new file):
- `_top_n_ally_names(conn, encid, 3)` returns 3 single-word ally names in encdps-descending order.
- Excludes ally=0, ally=1 with `name=''` or `name='Unknown'`, multi-word names (pets/NPCs).
- Returns fewer than N when fewer ally combatants exist.
- Tiebreaker order on identical encdps is `name ASC`.

**Integration tests** (`tests/web/test_parses_list_grouping.py`, new file):
- Two uploads, different uploaders, same `(guild, title, started_at±30s)`, same top 3 → ONE fight in response.
- Two uploads, different uploaders, same `(guild, title, started_at±30s)`, DISJOINT top 3 → TWO fights in response.
- Two uploads, different uploaders, same `(guild, title, started_at±30s)`, A's top 3 ⊂ B's allies but B's top 3 ⊄ A's allies → TWO fights (mutual containment fails one direction).
- Raid bucket (player_count = 12) uses N=3; group bucket (player_count = 5) uses N=2.
- `_PLAYER_COUNT_SQL` boundary 7 selects N correctly when one upload is 7-player and the other is 6-player.
- API response shape: each fight has `"category": "raid" | "dungeon" | "other"`.

**Frontend tests** (`frontend/src/pages/ParsesPage.test.tsx`):
- Renders guild sections in fight-count-desc order.
- `(no guild)` section renders last.
- Default open: Raid + Dungeon. Default collapsed: Other.
- Empty category subsections do not render.
- Per-row badge shows `{player_count}p`, not the old sizeLabel.

## Implementation order (preview for the plan)

The implementation plan will sequence the work bottom-up so each commit ships green CI:

1. `_top_n_ally_names` + `_all_ally_names` helpers + unit tests (no behaviour change yet).
2. `_classify_zone` helper + unit tests (still no behaviour change; classifier unused).
3. `ParseEncounterSummary.category` field + wire into `_list_encounters_sync` and the route handler (API gains the field; frontend doesn't read it yet).
4. `_group_into_fights` gets the top-N clause + integration tests for the two-group case.
5. Frontend `ParsesPage` regroup — at this point the backend already serves `category` and the merger already does the right thing; the change is purely render-side.

Each step is reviewable in isolation, and the plan can be paused/aborted mid-sequence without leaving a half-broken page (steps 1–4 are pure additions; step 5 is the user-visible flip).
