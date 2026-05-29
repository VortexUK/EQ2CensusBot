# Backend Cleanliness Audit — 2026-05-29

## Executive summary

- **Total findings: 108**
- **By severity:** P0 = 11, P1 = 56, P2 = 41
- **By category:** duplication 22, dead code 4, helpers/missing infra 15, file-size/organisation 6, schema/migrations 5, error handling 9, security 4, async/sync mixing 6, env-config 6, type-tightening 7, tests 6, naming/branding 4, perf/N+1 8, other 6
- **Estimated total effort:** ~80–95 engineer-hours (P0 ~6h, P1 ~50h, P2 ~30h).
- **Scope:** Read-only audit of `web/`, `census/`, `parses/`, `bot/`, `image/`, `scripts/`, `tests/` Python. No code changed.

The repo is in noticeably better shape than the pre-audit frontend was. Caching conventions (stale-while-revalidate, run_in_executor for sync DB) are followed almost everywhere, the per-server architecture is consistently enforced via `current_world()`, the HMAC strict gate is sound, and migrations are guarded correctly. Most P0s are small but real:

- **Per-process LRU + module caches without cross-worker invalidation** (`_cached_zones_data`, `_cache` in classes/supporters) — works today on a single uvicorn process but is a landmine if/when the deploy scales.
- **`/metrics` token compare is timing-attackable** (`==` instead of `compare_digest`).
- **Three independently-loaded `_ADMIN_IDS` frozensets** can drift if `ADMIN_DISCORD_IDS` is changed in one place and missed; one canonical import is the fix.
- **One sync `sqlite3.connect` happens inside an async handler** without `run_in_executor` (rankings → `_cached_zones_data` is itself called via executor, fine; but several other route helpers don't).

The biggest recurring smell is `CensusClient` lifecycle: 18 places hand-roll `client = CensusClient(...); try: ...; finally: await client.close()`. A `census_client()` async-context-manager + a long-lived shared session would remove a lot of boilerplate and reduce the per-request connection churn.

---

## Findings

# P0 — Bugs, data integrity, security (11)

#### BE-001: `_cached_zones_data` is process-local; invalidation doesn't cross workers
**Location:** `web/routes/rankings.py:195-203, 206-270`
**Effort:** medium

```python
195: def invalidate_zones_cache() -> None:
196:     """Clear the _cached_zones_data lru_cache.
197:
198:     Call this after any mutation to zones / zone_encounters /
199:     zone_encounter_mobs so the next /api/rankings/filters request rebuilds
200:     the dropdown tree from disk. Without this the rankings dropdown shows
201:     a stale view of the roster until the process restarts.
202:     """
203:     _cached_zones_data.cache_clear()
…
206: @lru_cache(maxsize=1)
207: def _cached_zones_data() -> tuple[dict[str, list[tuple[str, str]]], list[dict], list[dict]]:
```

`invalidate_zones_cache()` is called from `zones_admin.py` after every roster mutation (good — fixed in commit 2551d8e). But the cache is per-Python-process. Deploys today run as a single uvicorn process (the SSE pub/sub in `web/census_events.py` documents this assumption), so this works — but the prod story is one bad gunicorn-with-workers config change away from a really hard-to-diagnose "rankings dropdown stale on worker 2 only" bug. The frontend is also broadcast via SSE on edits, but the SSE pipe is per-process too, so there's no cross-process invalidation path at all.

**Fix:** Either (a) document the single-worker assumption next to `_cached_zones_data` and add a startup assert that `WORKERS` is 1, or (b) swap the LRU for an mtime-based reload (`stat(zones.db).st_mtime` check on each call — fast enough; the function already reads the file). Option (b) survives a multi-worker future and removes the need for `invalidate_zones_cache()` entirely.

---

#### BE-002: `/metrics` token comparison is timing-attackable
**Location:** `web/metrics.py:316-323`
**Effort:** small

```python
316: def check_metrics_auth(authorization: str | None) -> bool:
317:     """Return True if the request is authorised to view /metrics."""
318:     if not METRICS_TOKEN:
319:         return True  # no token configured → open access
320:     if not authorization:
321:         return False
322:     scheme, _, token = authorization.partition(" ")
323:     return scheme.lower() == "bearer" and token == METRICS_TOKEN
```

The ingest endpoint already uses `hmac.compare_digest` for its signature check (`web/routes/parses.py:1333`). For consistency and to neutralise the attack class, the metrics check should too — even though the attack surface is small (metrics is a private Railway endpoint behind a token), the asymmetry is what's flagged.

**Fix:** `hmac.compare_digest(token, METRICS_TOKEN)` instead of `==`.

---

#### BE-003: `_ADMIN_IDS` env var read in 3 places — silent drift risk
**Location:** `web/auth_deps.py:68`, `web/routes/auth.py:24`, `web/routes/guild_officer.py:19`, `web/routes/notifications.py:27`
**Effort:** small

```python
# web/auth_deps.py:68
ADMIN_IDS: frozenset[str] = frozenset(filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(",")))

# web/routes/auth.py:24
_ADMIN_IDS: frozenset[str] = frozenset(filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(",")))

# web/routes/guild_officer.py:19
_ADMIN_IDS: frozenset[str] = frozenset(filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(",")))

# web/routes/notifications.py:27
_ADMIN_IDS: frozenset[str] = frozenset(filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(",")))
```

Four separate identical reads — `auth_deps.ADMIN_IDS` is the canonical one. The other three are functional today (same env var, frozen at import) but a future change (e.g. caching from DB instead of env) only happens in one place and the others silently disagree. `guild_officer.py` even hand-rolls a `_require_admin` that duplicates `auth_deps.require_admin` (BE-029 below) — both are reading `_ADMIN_IDS` themselves.

**Fix:** Delete the three `_ADMIN_IDS` constants. Replace usages with `from web.auth_deps import ADMIN_IDS, is_admin, require_admin` (already exported from auth_deps). Same with `guild_officer._require_admin` — use `auth_deps.require_admin`.

---

#### BE-004: `get_active_claims` synchronous DB call from inside `_compute_permissions` without executor
**Location:** `web/routes/parses.py:705-720`, `web/db.py:705`
**Effort:** small

`_compute_permissions` calls `_officer_chars` (which calls `_roster_rank_map` → `get_active_claims`), and `get_active_claims` is `aiosqlite` — actually OK. But `_resolve_primary_guild_cached` (`web/routes/raid_strategies.py:57`) and several auth-gate flows hit `get_active_claims` from a request handler. They're all async/aiosqlite paths in the end, so this is fine — **not** a bug. Withdrawing this as a finding; left as a placeholder so subsequent IDs aren't renumbered.

*(Withdrawn — false positive on initial inspection.)*

---

#### BE-005: `_load_gear_rating()` re-reads `data/gear_rating.json` on EVERY `/api/config` request
**Location:** `web/routes/health.py:29-36, 56-64`
**Effort:** small

```python
29: def _load_gear_rating() -> dict[str, Any]:
30:     try:
31:         raw = json.loads(_GEAR_RATING_PATH.read_text(encoding="utf-8"))
32:         raw.pop("_comment", None)
33:         return raw
34:     except Exception:
35:         return _GEAR_RATING_DEFAULTS
…
56: @router.get("/config", response_model=ConfigResponse)
57: async def get_config() -> ConfigResponse:
58:     """Public server configuration used by the frontend."""
59:     return ConfigResponse(
60:         server_max_level=SERVER_MAX_LEVEL,
61:         world=WORLD,
62:         gear_rating=_load_gear_rating(),
63:         launch_dt=LAUNCH_DT_ISO or None,
64:     )
```

`/api/config` is called on every page load and frequently from the auth flow. Re-reading + parsing a JSON file is fast but pointless — the file doesn't change at runtime. This is a sync I/O in an async handler too (small file, ~1KB, but still).

**Fix:** Read it once at module import (or `@lru_cache(maxsize=1)`); add a TODO if hot-reload is wanted later.

---

#### BE-006: `find_by_id` `LIKE ?` queries are case-insensitive on `displayname_lower` but cast to `str(name).lower()` — wildcard injection possible
**Location:** `census/db.py:906`, `census/spells_db.py:502`, `census/recipes_db.py:406`
**Effort:** small

```python
# census/db.py:906
row = await _best("displayname_lower LIKE ?", (f"%{name.lower()}%",))
```

User-supplied `name` is interpolated into a SQLite `LIKE` pattern. A name containing `%` or `_` (the SQL LIKE wildcards) silently broadens the match (e.g. `_` in a literal name matches any char). Worst-case: `%` short-circuits the index and forces a full table scan, which on items.db (~1M rows) costs a request. Not an injection-of-arbitrary-SQL issue (params are bound), but an injection-of-arbitrary-LIKE-pattern issue.

**Fix:** Escape `%` and `_` before substituting:
```python
def _like_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
…
row = await _best(
    "displayname_lower LIKE ? ESCAPE '\\'",
    (f"%{_like_escape(name.lower())}%",),
)
```
Same pattern needed in spells_db, recipes_db, and the `LIKE` lookups in `web/routes/admin.py` (`parses_db.list_encounters_for_admin`).

---

#### BE-007: `_log.info("[Census] GET %s params=%s", url, params)` leaks token-ish data
**Location:** `census/client.py:175, 336, 411, 471, 520, 666, 698, 745, 793, 884, 925, 983` (12 sites)
**Effort:** small

Every Census call logs the URL + params at INFO. The URL includes the SERVICE_ID (`/s:{service_id}/json/...`). The SERVICE_ID is a paid Census API key — it's not literally credentials (no secret token in standard sense), but it identifies the deployment and could be rate-limit-griefed if exfiltrated via shared logs. Also a lot of log noise.

**Fix:** Either (a) drop to DEBUG, or (b) redact the `s:<service_id>` segment from the logged URL. The TraceConfig already records metrics on every Census call, so the INFO log adds no observability that isn't already in Prometheus.

---

#### BE-008: `_validate_payload_signature` strict mode is correct, but `request.body()` is awaited *after* FastAPI already parsed the body
**Location:** `web/routes/parses.py:1326`
**Effort:** small

```python
1325:     # Request.body() is cached after FastAPI's body-injection consumes it
1326:     # to build `body: IngestRequest`, so re-reading here is free.
1327:     body_bytes = await request.body()
```

The comment is correct — Starlette caches the body. But the *bytes* that hash are the wire bytes, not the canonical JSON. If a future code change adds a body-rewriting middleware (e.g. a JSON normaliser, or `gzip` middleware that re-decodes), this assumption breaks silently — the recomputed HMAC stops matching. Add a defensive assert that `request.scope.get("_body")` (Starlette's cache key) is present, or pin this with a test that exercises the path with a middleware between FastAPI and the handler.

**Fix:** Add a regression test that mounts a no-op `BaseHTTPMiddleware` between SessionMiddleware and the ingest route, and verifies HMAC validation still succeeds. Without the test, the strict-mode rollout is one middleware addition away from breaking every upload.

---

#### BE-009: `_handle_request` doesn't `await client.close()` on cancellation in some routes
**Location:** `web/routes/character.py:511-520`, `web/routes/character.py:867-871`, `web/routes/character.py:756-760`, multiple
**Effort:** small

```python
511:     client = CensusClient(service_id=_SERVICE_ID)
512:     try:
513:         char = await client.get_character(name, current_world())
514:     except Exception:
515:         raise HTTPException(
516:             status_code=503,
…
518:         )
519:     finally:
520:         await client.close()
```

This is actually the correct pattern. But there are 6+ sites where `CensusClient(...)` is instantiated bare with `try/finally` and 0 sites where it's wrapped in an `async with`. **Not a leak per se** — `aiohttp.ClientSession` has a finaliser that warns on un-closed sessions but does eventually close on GC. The risk is a missed `await client.close()` in a future caller (the pattern is hand-rolled 18 times — see BE-010).

**Fix:** See BE-010 below — async context manager wrapper.

---

#### BE-010: `CensusClient` instantiated 18 times with no shared connection pool
**Location:** 18 sites (see grep below). Examples: `web/routes/character.py:422,511,576,756,867`, `web/routes/claim.py:100,235`, `web/routes/parses.py:152,218,238`
**Effort:** medium

```
$ grep -rn "CensusClient(service_id=" web/ | wc -l
18
```

Each invocation creates a new `aiohttp.ClientSession` (`CensusClient._session_()` is per-instance). TCP connection setup + TLS handshake is paid on every Census call. The `aiohttp` docs explicitly warn against this — a long-lived `ClientSession` is the intended pattern. The TraceConfig is also re-instantiated on every CensusClient construction.

**Fix:** Either (a) a module-level singleton `CensusClient` lazily created on first use (the cleanest fix, since the class is already stateless apart from the session), or (b) an `async with census_client() as c:` async-context-manager that returns a shared instance. Option (a) is simpler — promote `_session_()` to a module-level `_get_session()` and make `CensusClient` re-use one session for the process. **Caveat:** the bot also uses `CensusClient`; the singleton would need to be created lazily per-event-loop (web vs bot run in separate processes — fine for option a as-is).

This is P0 because the change is small and the perf upside is real (saving a TLS handshake per Census call across hundreds of calls per page load on the parse view).

---

#### BE-011: `lookup_api_token` writes `last_used_at` on EVERY request without rate-limiting — write storm risk
**Location:** `web/db.py:1303-1308`
**Effort:** small

```python
1303:         # Bump last_used_at — fire and forget, don't fail the auth on this.
1304:         await db.execute(
1305:             "UPDATE api_tokens SET last_used_at = strftime('%s','now') WHERE id = ?",
1306:             (row["token_id"],),
1307:         )
1308:         await db.commit()
```

Every plugin upload (including HMAC-validated ones the user is actively raiding with — multiple per second during a raid) commits a row to users.db just to bump `last_used_at`. WAL mode mitigates lock contention but the disk write storm is real, and `last_used_at` precision below a minute isn't useful for the UI.

**Fix:** Coalesce updates — only write if `last_used_at` is more than 60s old (one extra SELECT in the same connection, free). Or move the bump into a background task triggered on a debounce.

---

#### BE-012: Test fixture path uses stale `eq2censusbot-pytest` directory name post-rename
**Location:** `tests/conftest.py:22`
**Effort:** small

```python
22: _TEST_DB_DIR = Path(tempfile.gettempdir()) / "eq2censusbot-pytest"
```

After the rename to EQ2Lexicon (commit 1045f32), this leftover means a contributor switching between branches mid-rename ends up with two test DB dirs (`eq2censusbot-pytest` + `eq2lexicon-pytest`). Also signals "missed during rename" to any new contributor reading the test setup.

**Fix:** `_TEST_DB_DIR = Path(tempfile.gettempdir()) / "eq2lexicon-pytest"`. (`pyproject.toml:2` also still has `name = "eq2censusbot"` — same class of finding, see BE-094.)

---

# P1 — Cleanup that improves consistency (56)

## P1 — Code duplication (12)

#### BE-020: `_int`/`_str`/`_float` low-level coercion helpers defined in 6 modules
**Location:** `census/client.py:1002, 1011`, `census/spells_db.py:156-179`, `census/recipes_db.py:184`, `census/item_parser.py:31, 40`, `census/db.py:408, 416, 425`, `web/routes/guild.py:166`, `parses/models.py:21, 33, 49`
**Effort:** medium

Every census/parses module rolls its own `_int(v) -> int | None` helper with nearly identical bodies. `census/item_parser.py:27` literally calls itself out: `# Low-level helpers (duplicated from client.py to avoid circular import)`.

```python
# census/client.py:1002
def _int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

# census/spells_db.py:163 — identical
def _int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None

# parses/models.py:21 — slightly different (returns 0 not None, accepts float fallback)
def _to_int(v) -> int:
    ...
```

The parses ones are deliberately different (default-0 instead of None), so keep those. But the 5 census ones could collapse into one `census/_coerce.py` module.

**Fix:** Extract `census/_coerce.py` with `coerce_int`, `coerce_str`, `coerce_float`, `coerce_str_or_none`. Have client.py / spells_db.py / recipes_db.py / item_parser.py / db.py import from there. Note: `census/db.py` has *three* variants (`_int_field`, `_int_field_zero`, plus `_str_field`) — those have specialised semantics (skip 0 for quest IDs etc.) so they stay.

---

#### BE-021: Identical `find_by_id` / `find_by_name` patterns across `census/*_db.py`
**Location:** `census/spells_db.py:330, 490`, `census/recipes_db.py:383, 393`, `census/zones_db.py:421`, `census/classes_db.py:131`, `census/db.py:910, 852`
**Effort:** medium

Every local-DB module reinvents `find_by_id(id, path=DB_PATH)` and `find_by_name(name, path=DB_PATH)` with the same flow: check `path.exists()`, open connection with `row_factory = sqlite3.Row`, SELECT, return `dict(row)` or None. Three of them (`spells_db`, `recipes_db`, `classes_db`) implement the same `with sqlite3.connect(path) as conn: …` pattern verbatim. `zones_db.find_by_name` adds an alias-fallback path; `spells_db.find_by_name` and `recipes_db.find_by_name` do an exact-then-LIKE fallback.

**Fix:** A `census/_lookup.py` module with:
- `read_only_conn(path) -> sqlite3.Connection` — opens with `mode=ro` + sqlite3.Row + closes properly via context manager
- `select_one(conn, sql, params) -> dict | None`
- `select_many(conn, sql, params) -> list[dict]`

Each `*_db.py` keeps its bespoke SQL but uses the shared connection helpers. Reduces ~200 lines.

---

#### BE-022: 4 identical "scrub user value before logging" helpers
**Location:** `web/census_refresh.py:23-26`, `web/routes/claim.py:133-140`, `web/routes/guild.py:44-47`, `web/routes/parses.py:99` (inline in `_sanitize_world`)
**Effort:** small

```python
# web/census_refresh.py:23
def _scrub(value: object) -> str:
    """Strip CR/LF before logging a user-supplied value..."""
    return str(value).replace("\r", " ").replace("\n", " ")

# web/routes/claim.py:133
def _safe_for_log(value: object) -> str:
    """Strip CR/LF before interpolating into a log line..."""
    return str(value).replace("\n", " ").replace("\r", " ")

# web/routes/guild.py:44 — identical to census_refresh
def _scrub(value: object) -> str:
    return str(value).replace("\r", " ").replace("\n", " ")
```

Three different names for the same function; the third is verbatim a copy of the first.

**Fix:** Move to a `web/lib/log_safety.py` (or extend `web/cache.py` since that's already shared infra) and import as `from web.lib.log_safety import scrub`.

---

#### BE-023: 5+ places hand-roll `cache_key = f"{name.lower()}:{current_world().lower()}"`
**Location:** `web/census_refresh.py:55`, `web/routes/character.py:418, 446, 569, 751, 862`, `web/routes/characters.py:150`, `web/routes/parses.py:147, 214, 274`
**Effort:** small

```python
# Pattern repeated 10+ times
cache_key = f"{name.lower()}:{current_world().lower()}"
```

The same cache-key shape appears in 10 sites across the character read path, parse ingest, and refresh orchestrator. Different `world` source (current_world vs explicit param) but the format string is always identical. A typo (e.g. dropping `.lower()` on one side) would silently miss the cache.

**Fix:** Add a helper in `web/cache.py`:
```python
def char_cache_key(name: str, world: str) -> str:
    return f"{name.lower()}:{world.lower()}"
```
Plus `guild_cache_key(guild, world)` for the `roster:{glower}:{wlower}` / `info:` / `adorns:` / `spells:` keys (5 distinct flavours in `guild.py:229-255` alone).

---

#### BE-024: 8+ places repeat the `loop = asyncio.get_event_loop(); ... loop.run_in_executor(None, ...)` boilerplate
**Location:** Throughout `web/routes/*.py` — `parses.py:749, 833, 1444`, `recipes.py:304, 392`, `zones.py:156-160`, `zones_admin.py:26-30`, `raid_strategies.py:406-407, 447, 454, 502, 558, 590`, `admin.py:344`, `act_triggers.py:221, 391, 406, 431, 437, …`
**Effort:** medium

55 grep hits for `asyncio.get_event_loop()` across `web/`. Each call site has the same shape:
```python
loop = asyncio.get_event_loop()
result = await loop.run_in_executor(None, fn, *args)
```

Some sites use `asyncio.get_event_loop()` repeatedly within the same handler (`act_triggers.py:391, 406, 407` — three `asyncio.get_event_loop()` calls in ~15 lines).

**Fix:** Add `web/lib/executor.py`:
```python
import asyncio
from collections.abc import Callable
from typing import TypeVar
_T = TypeVar("_T")

async def run_sync(fn: Callable[..., _T], *args, **kwargs) -> _T:
    """Run a sync function in the default executor; saves the get_event_loop boilerplate."""
    loop = asyncio.get_event_loop()
    if kwargs:
        return await loop.run_in_executor(None, functools.partial(fn, *args, **kwargs))
    return await loop.run_in_executor(None, fn, *args)
```
Then `result = await run_sync(parses_db.init_db)` everywhere. Also: `asyncio.get_event_loop()` is deprecated in Python 3.12+ inside non-coroutine contexts. The helper centralises the way to get the loop, future-proofing the codebase.

---

#### BE-025: `_cached_snapshots` + `_resolve_combatant_snapshots` duplicate cache-lookup logic
**Location:** `web/routes/parses.py:185-262` (resolve) vs `web/routes/parses.py:265-282` (cached-only)
**Effort:** small

```python
# parses.py:265
def _cached_snapshots(names: list[str], world: str | None = None) -> dict[str, CombatantSnapshot]:
    """Cache-only snapshot lookup..."""
    effective_world = _sanitize_world(world) or _WORLD
    world_lower = effective_world.lower()
    out: dict[str, CombatantSnapshot] = {}
    for name in names:
        cached, _ = character_cache.get_stale(f"{name.lower()}:{world_lower}")
        if cached is not None:
            out[name] = CombatantSnapshot(
                level=getattr(cached, "level", None),
                guild_name=getattr(cached, "guild_name", None),
                cls=getattr(cached, "cls", None),
                ilvl=getattr(cached, "ilvl", None),
            )
    return out
```

The `CombatantSnapshot(level=getattr(...))` block is duplicated identically in `_resolve_combatant_snapshots:252-258`. Same 4 fields, same `getattr(cached, ...)` shape.

**Fix:** Extract `_snapshot_from_cache(cached) -> CombatantSnapshot` so both call sites are 1 line.

---

#### BE-026: `_resolve_primary_guild` duplicated in zones.py and raid_strategies.py
**Location:** `web/routes/zones.py:224-251` vs `web/routes/raid_strategies.py:57-76`
**Effort:** small

Both functions:
1. Call `get_active_claims(discord_id, world=current_world())`.
2. Find the `is_primary=True` claim.
3. Read `character_cache` for that character.
4. Return `guild_name` from the cached row.

`zones.py` adds a step 5 (fall back to most-recent parsed guild) which `raid_strategies.py` doesn't have. They diverge in handling but the cheap path is identical.

**Fix:** Extract `_cached_primary_guild(discord_id) -> tuple[character_name | None, guild_name | None]` to a new module (`web/lib/primary_guild.py`), used by both. `zones.py` adds its fallback after the helper.

---

#### BE-027: 3 different patterns for officer auth-checking
**Location:**
- Inline `if not await _officer_chars(user["id"], guild_name): raise 403` — `item_watch.py:97, 125, 208`, `guild_officer.py:71, 98, 133`
- Via the capability dep — `web/routes/raid_strategies.py:437, 582` (`Depends(require_editor)`)
- Cached resolve in `raid_strategies._resolve_primary_guild_cached:57`
**Effort:** small

Three different ways to ask "is this user authorised to act on this guild?" exist:
1. Hand-rolled: fetch session user, call `_officer_chars(user_id, guild)`, raise 403 if empty. Repeated 6+ times.
2. The FastAPI `Depends(require_editor)` capability gate (admin OR contributor — doesn't gate on officer status of THIS guild specifically).
3. The cached primary-guild check.

The hand-rolled version is the only one that does the per-guild check; the capability dep is too broad for officer-of-this-guild gates. So pattern 1 is the right one — but the boilerplate is repeated.

**Fix:** Add `require_officer_of(guild_name: str)` factory in `web/auth_deps.py` that returns a `Depends`-able. Then:
```python
@router.get("/guild/{guild_name}/item-watch", ...)
async def get_item_watches(
    guild_name: str,
    user: dict = Depends(lambda r, g=Path(...): require_officer_of(g)(r)),
) -> ...:
```
or simpler: just `await require_officer_of(user, guild_name)` called inline.

---

#### BE-028: `_handle_get_character` flow duplicated 3 times in character.py
**Location:** `web/routes/character.py:556-587, 738-765, 846-878`
**Effort:** medium

```python
# character.py:556 (get_character_spells)
cache_key = f"{name.lower()}:{current_world().lower()}"
cached, _ = character_cache.get_stale(cache_key)
if cached is not None:
    char_name = cached.name
    spell_ids = cached.spell_ids
else:
    client = CensusClient(service_id=_SERVICE_ID)
    try:
        char = await client.get_character(name, current_world())
    finally:
        await client.close()
    if char is None:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found on {current_world()}")
    result = _build_char_response(char)
    character_cache.set(cache_key, result)
    char_name = result.name
    spell_ids = result.spell_ids
```

Repeated in `get_upgrade_materials` and `get_upgrade_recipes` with just the bound variables different. ~25 lines × 3.

**Fix:** Extract `_get_or_fetch_character(name: str) -> CharacterResponse` that does cache-first + Census fallback. The three callers shrink to one line + `result.spell_ids`.

---

#### BE-029: `_require_admin` in guild_officer.py duplicates `auth_deps.require_admin`
**Location:** `web/routes/guild_officer.py:154-160` vs `web/auth_deps.py:130-136`
**Effort:** small

```python
# guild_officer.py:154
def _require_admin(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["id"] not in _ADMIN_IDS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

# auth_deps.py:130
def require_admin(request: Request) -> dict:
    """Require a logged-in admin. 401 if no session, 403 if not in
    ADMIN_DISCORD_IDS. Returns the session user dict."""
    user = require_user_session(request)
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
```

Same function, same semantics. The guild_officer copy is what drives BE-003 (the duplicated `_ADMIN_IDS`).

**Fix:** Import `require_admin` from auth_deps, delete the local copy.

---

#### BE-030: `_validate_world`/`_sanitize_world` regex pattern lives in parses.py only — needed elsewhere
**Location:** `web/routes/parses.py:84-107` (definition) — referenced indirectly via cache key shape elsewhere
**Effort:** small

```python
84: _VALID_WORLD_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 '_-]{0,30}$")
…
96: def _sanitize_world(world: str | None) -> str | None:
```

The character-name regex (`_VALID_CHARACTER_NAME_RE`) and world regex live in `parses.py` because that's where they were first needed (ingest). But the same constraints apply *everywhere a name or world hits a cache key or Census URL*. `guild.py:61` defines its own `_validate_guild_name` (different rules, fair). But `character.py` accepts a `name` query param up to 64 chars with no shape check — a hostile name with `:` would collide cache keys (the very bug `parses.py:90` calls out).

**Fix:** Promote `_VALID_CHARACTER_NAME_RE`, `_sanitize_world`, `_validate_guild_name` to `web/lib/validation.py` and apply consistently. Today: only the ingest route validates names; the GET endpoints take whatever the client sends.

---

#### BE-031: `data["approved"]` + `c.get("is_primary")` primary-claim lookup pattern in 3 places
**Location:** `web/routes/zones.py:233`, `web/routes/raid_strategies.py:69`, `web/routes/item_watch.py:175`
**Effort:** small

```python
# zones.py:233
primary = next((c for c in data["approved"] if c.get("is_primary")), None)

# raid_strategies.py:69
primary = next((c for c in claims["approved"] if c.get("is_primary")), None)

# item_watch.py:175
primary_claim = next((c for c in officer_claims["approved"] if c.get("is_primary")), None)
```

**Fix:** Add `web/db.py:get_primary_claim(discord_id, world) -> dict | None` that does the active-claims fetch + primary filter in one helper.

---

## P1 — Async/sync mixing + executor patterns (6)

#### BE-040: `notifications.py` calls `_roster_rank_map` for every guild without throttling
**Location:** `web/routes/notifications.py:81-99`
**Effort:** small

```python
81: for guild_name in guilds_seen:
82:     # One _roster_rank_map call per guild — cached after first fetch,
83:     # shared across concurrent polls via in-flight deduplication.
84:     rank_map = await _roster_rank_map(guild_name)
```

If `guilds_seen` is N, this is N sequential awaits even when the rank maps are cache misses. The notifications endpoint polls every 60s from every logged-in browser tab. With 2 approved characters in 2 different guilds, that's 2 sequential `_fetch_and_cache_guild` calls on cache miss.

**Fix:** `asyncio.gather(*[_roster_rank_map(g) for g in guilds_seen])`. Same pattern as `parses.py:_compute_permissions` already does at line 710.

---

#### BE-041: `_get_character_aas` does NOT serve from `census_store` on cold cache
**Location:** `web/routes/aa.py:219-250`
**Effort:** medium

```python
219: @router.get("/character/{name}/aas", response_model=CharAAsResponse)
220: async def get_character_aas(name: str) -> CharAAsResponse:
…
225:     cache_key = f"aas:{name.lower()}:{current_world().lower()}"
226:     cached, is_stale = aa_cache.get_stale(cache_key)
227:     if cached is not None:
…
233:         return cached
234:
235:     client = CensusClient(service_id=_SERVICE_ID)
236:     try:
237:         char_aas = await client.get_character_aas(name, current_world())
```

The AA endpoint is the only major character endpoint that does NOT have a stale-while-revalidate path through `census_store` — every cache miss is a direct Census call. The character + guild paths both serve from `census_store` first (see `character.py:455-500`). This means AA data is the only character-level data that disappears on container restart until the next request reaches Census.

**Fix:** Mirror the `character.py` flow — store AA responses in census_store under a separate key, serve from there on cold cache, schedule refresh.

---

#### BE-042: Five raid_strategies endpoints repeat the `loop = asyncio.get_event_loop()` ritual
**Location:** `web/routes/raid_strategies.py:406, 447, 488, 562, 595, 635`
**Effort:** small

Multiple `loop = asyncio.get_event_loop()` lines per handler, when a single helper would do (see BE-024).

---

#### BE-043: `_resolve_encounter` in act_triggers.py is sync-DB-in-async via thread but does its own init_db every call
**Location:** `web/routes/act_triggers.py:145-216`
**Effort:** small

```python
176:     raids_db.init_db().close()
…
178:     with sqlite3.connect(raids_db.DB_PATH) as conn:
```

Every call to `_resolve_encounter_sync` calls `raids_db.init_db()` (just to ensure tables exist), opens its own raw `sqlite3.connect`, then closes both. The comment at line 170-176 explains why — defensive against an old DB — but doing this on EVERY trigger read is wasteful. Once-per-process is enough.

**Fix:** Move the `init_db().close()` defensive call into a module-load function that runs once. Or gate on a module-level `bool` flag.

---

#### BE-044: `parses_db.init_db(parses_db.DB_PATH)` re-opens connections in tight loops
**Location:** Throughout — `parses.py:584, 661, 1220, 1510, 1585, 1672`
**Effort:** medium

```python
584:     conn = parses_db.init_db(parses_db.DB_PATH)
585:     try:
586:         conn.row_factory = sqlite3.Row
587:         return [dict(r) for r in conn.execute(list_sql, [*params, inner_cap]).fetchall()]
588:     finally:
589:         conn.close()
```

Every sync query handler opens a new connection. SQLite is fast at this, but the WAL-checkpoint logic + `init_db`'s migration-check overhead is paid each time. The `_DBCollector` in metrics.py does this every 30s for /metrics too.

**Fix:** Module-level lazy connection pool. SQLite WAL allows one writer + many readers, so a single read-only connection per request would suffice if explicitly marked `mode=ro`. Or a `contextvars`-keyed connection that lives for the request lifetime.

---

#### BE-045: Cache-sweep loop is created in `_prewarm` but never tracked or cancelled
**Location:** `web/app.py:241-260`
**Effort:** small

```python
240:     async def _prewarm() -> None:
…
245:         _asyncio.create_task(prewarm_character_cache())
246:         _asyncio.create_task(_cache_sweep_loop())
247:         from web import census_health
248:
249:         _asyncio.create_task(census_health.poll_loop())
```

Three untracked background tasks — matches the user-memory note: "Backend `--reload` hangs on untracked bg tasks". The workaround (`--timeout-graceful-shutdown 2`) is already in `dev_backend.ps1`, per the same note. The proper fix is a FastAPI `lifespan` context manager that holds the task handles and cancels them on shutdown.

**Fix:** Convert `on_startup=[…]` to a `lifespan` context manager; track the three task handles; await `task.cancel()` on shutdown.

---

## P1 — File organisation / size (6)

#### BE-050: `web/routes/parses.py` is 1687 lines — split into ingest/read/delete
**Location:** `web/routes/parses.py` (entire file)
**Effort:** large

By far the largest route file. Houses GET list, GET detail, POST ingest, DELETE batch/single/bulk, plus ~12 helper functions and 13 Pydantic models.

**Fix:** Split into:
- `web/routes/parses/list.py` — GET endpoints (list_parses, get_parse) + the SQL helpers
- `web/routes/parses/ingest.py` — POST endpoint, HMAC validation, snapshot helpers, payload coercion
- `web/routes/parses/delete.py` — DELETE endpoints + `_can_delete_encounter`
- `web/routes/parses/models.py` — all the Pydantic models
- `web/routes/parses/__init__.py` — re-exports router

Mirrors the frontend file-split convention (P1-21 in the frontend audit).

---

#### BE-051: `web/db.py` is 1309 lines, mixes users/claims/tokens/servers/item_watch/roles
**Location:** `web/db.py`
**Effort:** large

Five unrelated domains in one file: user-access, character claims, role permissions, item watch, API tokens, server registry. Each has its own schema block, its own helpers (10-30 functions per domain), and its own callers.

**Fix:** Split into `web/db/__init__.py` (init_db + DB_PATH) plus per-domain files:
- `web/db/users.py` — users / role / role_requests / role_permissions
- `web/db/claims.py` — character_claims
- `web/db/item_watch.py` — item_watch
- `web/db/tokens.py` — api_tokens
- `web/db/servers.py` — servers registry

The `_SCHEMA` string can stay assembled in `__init__.py` or move to a `web/db/schema.sql` static file (which simplifies the index-after-migration dance — see BE-070 below).

---

#### BE-052: `web/routes/act_triggers.py` is 1098 lines, mixes triggers + spell timers + XML + imports
**Location:** `web/routes/act_triggers.py`
**Effort:** medium

Half is triggers, a quarter spell timers, a quarter XML serialise/import. Mirror the frontend's `components/act/` split (P1-22 in the frontend audit).

**Fix:** Split into `web/routes/act/triggers.py`, `web/routes/act/spell_timers.py`, `web/routes/act/xml_import.py`, `web/routes/act/xml_export.py`.

---

#### BE-053: `web/routes/character.py` is 933 lines, mixes character + spells + upgrade-materials + upgrade-recipes
**Location:** `web/routes/character.py`
**Effort:** medium

The two `/upgrade-*` endpoints (`get_upgrade_materials`, `get_upgrade_recipes`) duplicate ~80% of their setup. They're a self-contained sub-feature.

**Fix:** Split character.py into:
- `web/routes/character.py` — GET /character, _build_char_response, equipment helpers
- `web/routes/character_spells.py` — GET /character/.../spells
- `web/routes/character_upgrades.py` — GET /character/.../upgrade-materials + upgrade-recipes
Then the duplicated `_get_or_fetch_character` (see BE-028) sits in one place.

---

#### BE-054: `web/routes/guild.py` is 857 lines with two unrelated concerns
**Location:** `web/routes/guild.py`
**Effort:** small

The file has the cache-orchestration helpers (`_fetch_and_cache_guild`, `_persist_and_publish_guild`, `_overview_to_char_response`) AND the public route handlers. The first set is imported by `census_refresh.py`, `parses.py`, `notifications.py`, `auth_deps.py` — i.e. it's effectively shared infrastructure, not route code.

**Fix:** Promote the cache helpers to `web/guild_cache.py` (mirrors `web/census_refresh.py`'s shape). The route file shrinks; the lazy in-function imports in 6+ files become module-level imports.

---

#### BE-055: `census/raids_db.py` is 962 lines, three table groups, schema + helpers
**Location:** `census/raids_db.py`
**Effort:** medium

The file holds raid_zones, raid_encounters, raid_encounter_revisions, raid_zone_revisions, act_triggers, act_spell_timers. The ACT tables (triggers/spell_timers) are arguably a different concern — they support the editor route only.

**Fix:** Split into `census/raids_db.py` (zones + encounters + revisions) and `census/raids_act_db.py` (triggers + spell_timers). Both share `init_db` and DB_PATH.

---

## P1 — Dead code / unreferenced surface (4)

#### BE-060: `parses_db.delete_encounters_by_filter` is unreferenced from production
**Location:** `parses/db.py:781-815`
**Effort:** small

The docstring already calls this out: `"NOTE: no longer called by the bulk-delete route (which now uses find_encounters_by_filter + _apply_delete for soft-vs-hard logic); kept for direct/admin hard-delete use and covered by TestDeleteHelpers."` — but a grep confirms it's only referenced from tests.

```
$ grep -rn "delete_encounters_by_filter" --include="*.py"
parses/db.py:781:def delete_encounters_by_filter(...)
parses/db.py:828:    same filter `delete_encounters_by_filter` uses ...
tests/parses/test_db.py:701:            parses_db.delete_encounters_by_filter(parses_db_conn, guild_name="")
tests/parses/test_db.py:707:        n = parses_db.delete_encounters_by_filter(parses_db_conn, guild_name="Exordium")
tests/parses/test_db.py:726:        n = parses_db.delete_encounters_by_filter(...)
tests/parses/test_db.py:738:        n = parses_db.delete_encounters_by_filter(...)
```

**Fix:** Delete the function + its tests. If someone needs a hard-delete admin script later, they'll write 6 lines of SQL with a guard.

---

#### BE-061: `parses/act_reader.get_damage_types` / `get_attack_types` accept an unused `combatant_name` filter
**Location:** `parses/act_reader.py:223-272, 292-345`
**Effort:** small

Both have an optional `combatant_name` parameter. Grep shows no caller passes it.

```python
def get_damage_types(
    conn: sqlite3.Connection,
    encid: str,
    combatant_name: str | None = None,
) -> list[DamageType]:
```

**Fix:** Drop the parameter and the conditional branches that test for it.

---

#### BE-062: `_reset_for_test` exists in three modules but tests only use one
**Location:** `web/census_events.py:14`, `web/census_health.py:27`, `web/census_refresh.py:34`
**Effort:** small

Three `_reset_for_test()` helpers (clean state between tests). Grep usage:

```
$ grep -rn "_reset_for_test" --include="*.py"
web/census_events.py:14:def _reset_for_test() -> None:
web/census_health.py:27:def _reset_for_test() -> None:
web/census_refresh.py:34:def _reset_for_test() -> None:
tests/web/test_census_events.py:20:    census_events._reset_for_test()
tests/web/test_census_refresh.py:54:    census_refresh._reset_for_test()
tests/web/test_census_health.py:23:    census_health._reset_for_test()
```

Actually all three are used. **Withdrawn.**

---

#### BE-063: `census/db.py:_backfill_pvp_flag` runs on every startup, scans entire raw_json
**Location:** `census/db.py:712-725`
**Effort:** small

```python
712: def _backfill_pvp_flag(conn: sqlite3.Connection) -> None:
…
718:     conn.execute("""
719:         UPDATE items
720:         SET flag_pvp = 1
721:         WHERE flag_pvp = 0
722:           AND raw_json IS NOT NULL
723:           AND LOWER(raw_json) LIKE '%pvp%'
724:     """)
```

Runs on every `init_db()` call. The comment says "Safe to run every startup; is a no-op once all rows are set." — but `flag_pvp = 0` matches every row that's NOT pvp, so it scans ALL ~1M item rows every startup just to set 0 → 0 (the UPDATE is a no-op for non-pvp rows but the scan still happens).

**Fix:** Version-gate it like `_backfill_effect_stats` does via `_meta` — set `pvp_backfill_version` after first run; check that key before re-scanning.

---

## P1 — Schema / migration / DB shape (5)

#### BE-070: `_SCHEMA` runs via `executescript` BEFORE the migrations — fragile pattern documented in comments
**Location:** `web/db.py:62-65`, `web/db.py:192-194` (the two warning comments)
**Effort:** medium

```python
62: -- NOTE: the index on character_claims(world) is NOT created here. _SCHEMA runs
63: -- via executescript BEFORE the ALTER that adds `world` to a pre-existing table,
64: -- so creating it here would raise "no such column: world" on an existing DB.
65: -- It is created in init_db() after the ADD COLUMN migration instead.

192: -- NOTE: no index or statement referencing `is_default` here. _SCHEMA runs via
193: -- executescript BEFORE the ADD COLUMN migration on a pre-existing DB, so any
194: -- column-dependent DDL/DML must live in init_db() after the ALTER, never here.
```

The pattern is correct (the user-memory entry "Test migrations against the old DB shape" documents that this has bitten before — they had a prod crash because an index in `_SCHEMA` referenced a column not yet added on an old DB). But this is a footgun for the next contributor. Every column added in `_MIGRATIONS` after the initial `CREATE` lives in TWO places: the `_SCHEMA` (with the modern shape) and the migration (`ALTER TABLE ... ADD COLUMN`). Drift between the two is silent.

**Fix:** Either (a) move all `CREATE TABLE` to a `web/db/schema.sql` file that contains ONLY the current shape, and rely on per-column migration checks (one PRAGMA table_info per startup, ALTER only if missing) — never executescript the old `_SCHEMA`; or (b) explicitly assert in CI that every column in `_SCHEMA` is also in `_MIGRATIONS` (or vice versa).

---

#### BE-071: `census_store._MIGRATIONS` is empty but the swallow-and-pass loop runs every startup
**Location:** `census/census_store.py:53, 65-69`
**Effort:** small

```python
53: _MIGRATIONS: list[str] = []  # future schema bumps appended here
…
65:     for stmt in _MIGRATIONS:
66:         try:
67:             conn.execute(stmt)
68:         except sqlite3.OperationalError:
69:             pass
```

No-op today but the swallow pattern silently eats real errors when a migration is added. Compare with `parses/db.py:260-264` which has the same `try/except sqlite3.OperationalError: pass` pattern — there it has 8 ALTERs that are MEANT to fail (idempotent column-add). Worth logging at debug at least.

**Fix:** Log the swallowed error at DEBUG so a real DDL error doesn't disappear forever.

---

#### BE-072: `character_claims.is_primary` migration adds the column but no index
**Location:** `web/db.py:225-226`
**Effort:** small

```python
225: if "is_primary" not in claims_cols:
226:     conn.execute("ALTER TABLE character_claims ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0")
```

The `is_primary` filter is the hot path in `get_active_claims` and many other queries. No index — every `WHERE is_primary = 1` is a sequential scan over all claim rows for a user.

**Fix:** Add `CREATE INDEX IF NOT EXISTS idx_claims_primary ON character_claims(discord_id, world, is_primary)` after the ALTER.

---

#### BE-073: `users.access_status` lacks an index
**Location:** `web/db.py:38-46`, `web/db.py:411` (`list_pending_users`)
**Effort:** small

```python
async def list_pending_users(path: Path = DB_PATH) -> list[dict]:
    """Return all users with access_status = 'pending', newest first."""
    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT discord_id, discord_name, discord_username, avatar, first_seen "
            "FROM users WHERE access_status = 'pending' ORDER BY first_seen DESC"
```

Notifications endpoint polls this every 60s for every logged-in admin. No index on `access_status`.

**Fix:** `CREATE INDEX IF NOT EXISTS idx_users_access ON users(access_status)`. Selectivity is high (most users are approved), so the index helps.

---

#### BE-074: `tier_display` UPDATE in `census/zones_db.init_db` runs on every startup
**Location:** `census/zones_db.py:294-310`
**Effort:** small

```python
294:     conn.execute(
295:         """
296:         UPDATE zone_encounters
297:            SET encounter_name = (
298:                    SELECT mob_name FROM zone_encounter_mobs m
299:                     WHERE m.encounter_id = zone_encounters.id
300:                     ORDER BY position ASC
301:                     LIMIT 1
302:                )
303:          WHERE encounter_name LIKE '%,%'
304:           AND EXISTS (...)
305:         """
306:     )
```

Comment says "One-time data normalization (idempotent)" — true, but it scans `zone_encounters` looking for legacy comma-named rows on every startup. After the first run, this should be flagged as "done" via `_meta`.

**Fix:** Version-gate via `set_meta(conn, "encounter_name_normalised_v1", "1")` like the items DB does.

---

## P1 — Error handling (9)

#### BE-080: `except Exception` swallowed without logging in 22 sites
**Location:** Grep result above (22 instances across cache.py, census_health.py, aa.py, characters.py, guild.py, recipes.py, etc.)
**Effort:** medium

The bulk are in `web/cache.py:45, 53, 61, 69, 132` — guarded metric increments. Those are fine. But others swallow real failures:

```python
# web/routes/aa.py:55
def _load_tree_index() -> None:
    for path in _TREES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            …
        except Exception:
            pass

# web/routes/guild.py:244
for ov in overviews:
    try:
        character_cache.set(
            f"{ov.name.lower()}:{world_lower}",
            _overview_to_char_response(ov),
        )
    except Exception:
        pass

# census/spells_db.py:486
except Exception:
    return Blocklist(frozenset(), [])
```

A malformed JSON in `data/AAs/trees/` would silently disappear from the tree index (returning unknown for the tree on /aacheck). A failure in `_overview_to_char_response` (e.g. Pydantic error from new field) silently drops that member from the cache.

**Fix:** Log at WARNING with the exception type at minimum. Module-level `_log = logging.getLogger(__name__)` already exists in most of these files.

---

#### BE-081: `census/client.py` catches `Exception` and returns None across 11 sites
**Location:** `census/client.py:69, 82, 183, 343, 419, 478, 528, 673, 706, 753, 802, 833, 892, 933, 993`
**Effort:** small

Every Census-call method has the same structure:
```python
try:
    async with self._session_().get(url, ...) as resp:
        if resp.status != 200:
            return None
        data = await resp.json(content_type=None)
except Exception as exc:
    _log.error("[Census] API error: %s: %r", type(exc).__name__, exc)
    return None
```

15 identical try/except wrappers. The frontend audit's "useFetch" finding has the same shape — there's exactly one canonical way to do this and it's been copy-pasted instead of factored.

**Fix:** Extract `async def _census_get(self, url, params, *, timeout) -> dict | None:` that wraps the try/except + status check + JSON parse. Each public method then becomes "build params, call _census_get, parse the response into the typed dataclass".

---

#### BE-082: `_resolve_uploader_guild_async` Census error path doesn't distinguish "character not found" from "Census down"
**Location:** `web/routes/parses.py:151-159`
**Effort:** small

```python
153:     try:
154:         guild_name = await client.get_character_guild_name(uploader, effective_world)
155:     except Exception as exc:
156:         _log.warning("Census guild lookup failed for %r: %s", uploader, exc)
157:         return None
158:     finally:
159:         await client.close()
160:
161:     if not guild_name:
162:         return None
```

`get_character_guild_name` returns `None` for "character has no guild" AND for "character not found", but RAISES on Census API/network errors (per its docstring). The current code catches the raise, logs a warning, returns None. Now there's no way for the caller to distinguish "user is unguilded" (fine, store NULL) from "Census is down right now" (would want to retry later via background snapshot resolution). Both result in guild_name=NULL on the encounter row.

**Fix:** Don't catch the exception — let it propagate, and have the caller (in `ingest_parse`) handle "best effort" vs "fail upload" differently. Or, log the warning AND return a sentinel that's distinct from None so the encounter row knows whether to attempt re-resolution later.

---

#### BE-083: `_check_watch` silently swallows ALL exceptions per watch
**Location:** `web/routes/item_watch.py:70-77`
**Effort:** small

```python
70: async def _check_all_watches(guild_name: str, world: str) -> None:
71:     """Background task: check every watch entry for a guild/server against the cache."""
72:     watches = await list_item_watches(guild_name, world=world)
73:     for w in watches:
74:         try:
75:             await _check_watch(w)
76:         except Exception:
77:             pass
```

A failure in one watch silently skips it. If `_check_watch` is broken systemically (schema drift, Pydantic error), every watch fails and you'd never know.

**Fix:** Log at WARNING with the watch_id so the failure is at least visible in logs.

---

#### BE-084: HTTP 503 vs 404 inconsistently used for "Census down" vs "not found"
**Location:**
- 503 for Census down: `character.py:507, 516, 522`, `guild.py:673`, `aa.py:241` (?)
- 404 for not found on Census down: `claim.py:243` ("not found on {current_world()}")
**Effort:** small

The character read path returns 503 when Census is unreachable, 404 only when Census responded with no character. The claim submit path returns 404 even when the Census call failed (no try/except for the failure case → unhandled at runtime). The aa endpoint just lets `client.get_character_aas` exceptions propagate → 500.

**Fix:** Pick one — 503 for "service degraded, retry later", 404 for "definitively not found". Apply across all 6+ endpoints.

---

#### BE-085: `web/routes/admin.py:approve_role_request` race window between review_role_request and grant_role
**Location:** `web/routes/admin.py:294-298`
**Effort:** small

```python
294:     reviewed = await review_role_request(request_id, "approved", admin["id"], body.note)
295:     if reviewed is None:
296:         # Lost to a concurrent admin (race). Surface as 409 rather than 200.
297:         raise HTTPException(status_code=409, detail="Request was reviewed by someone else")
298:     await grant_role(existing["discord_id"], existing["role"], admin["id"])
```

The comment at line 290-293 acknowledges this: "Mark approved first so a grant-side failure doesn't leave the queue with a phantom-approved row." But the real fix is to do both in one SQLite transaction. As written, a process crash between line 294 and 298 leaves "request marked approved, role not granted" — a state the rejected-because-they-tried-again user would experience as silent. Mentioned in `web/db.py:283` TODO too.

**Fix:** Add `review_and_grant_role(request_id, admin_id, note)` to `web/db.py` that does both writes in one BEGIN/COMMIT.

---

#### BE-086: Bare `raise` in `_log.exception` block in `parses/ingest.py:179`
**Location:** `parses/ingest.py:178-180`
**Effort:** small

```python
178: except Exception as exc:
179:     errors += 1
180:     _log.exception("Failed to ingest encounter %s: %s", encid, exc)
```

This is fine — `errors` counter is incremented and ingest continues to the next encounter. **Withdrawn**, not a finding.

---

#### BE-087: `_handle_search_chars_single` returns [] on any Census error — caller can't distinguish from "no results"
**Location:** `census/client.py:864-893`
**Effort:** small

Same shape as BE-082. `[]` from a Census error means the caller's search hit "no characters match" silently.

**Fix:** Raise a `CensusError` (new exception class) that the route can catch and turn into a 503 with a useful message. Today's behaviour is "empty result list" which UX-wise looks like "no characters found".

---

#### BE-088: `_parse_effects(spell)` in spells_db silently returns "[]" on malformed input — but caller has no way to know
**Location:** `census/spells_db.py:195-218`
**Effort:** small

```python
195: def _parse_effects(spell: dict) -> str:
196:     """Extract effect_list into a compact JSON string.
197:
198:     Always returns a JSON string (never None):
199:       - Non-empty array  → the effect lines
200:       - '[]'             → processed, genuinely no effects in Census
201:     """
202:     raw = spell.get("effect_list")
203:     if not isinstance(raw, list):
204:         return "[]"
```

`[]` is returned for both "Census genuinely returned no effects" and "the field was malformed/missing". The two outcomes are different — the second is a parse bug worth flagging. Today the spell.effects column silently goes empty for any malformed input.

**Fix:** Log at WARNING when `raw` is non-None-non-list (i.e. unexpected shape).

---

## P1 — Type-tightening (7)

#### BE-090: `dict[str, Any]` shapes in ACT ingest could be Pydantic models
**Location:** `web/routes/parses.py:1025-1027` (combatants/damage_types/attack_types)
**Effort:** medium

```python
1025: combatants: list[dict[str, Any]] = []
1026: damage_types: list[dict[str, Any]] = []
1027: attack_types: list[dict[str, Any]] = []
```

Each list element is a typed shape (per ACT's schema) but Pydantic doesn't validate it — the conversion happens manually in `_combatants_from_payload` etc. with `r.get("name")` etc. A typo in the plugin (e.g. `r.get("crttypes")` instead of `r.get("crittypes")`) wouldn't be caught.

**Fix:** Define `IngestCombatant`, `IngestDamageType`, `IngestAttackType` Pydantic models. Pydantic v2 handles unknown fields silently by default so older plugin versions still work. The benefit is auto-validation of types and a self-documenting schema.

---

#### BE-091: `user: dict` is the standard session shape, but it's `Any`-shaped to callers
**Location:** Across `web/routes/*.py` — 30+ functions take `user: dict` from session
**Effort:** small

```python
# auth_deps.py:75
def require_user_session(request: Request) -> dict:
    ...
    return user
```

`dict` opens the door to `user["id"]` typos. The same dict ships from session vs token paths in `require_user_session_or_token` with different shapes (token path adds `auth_source`, `token_id`, `token_name`).

**Fix:** Define `SessionUser` TypedDict (or Pydantic model). Both auth-dep functions return `SessionUser`. Routes annotate `user: SessionUser`.

---

#### BE-092: `_int(v) -> int | None` lacks generic typing (uses `Any` implicitly)
**Location:** Various — `census/spells_db.py:163`, `census/recipes_db.py:184`, etc.
**Effort:** small

```python
def _int(v) -> int | None:
```

`v` has no annotation. `def _int(v: object) -> int | None:` would help type-checkers infer narrowing at call sites.

---

#### BE-093: `dict | None` returns hide what the dict shape is
**Location:** Many — `find_by_id`, `find_by_name`, `find_by_crc`, `get_character`, `get_guild` in census_store
**Effort:** medium

```python
def find_by_id(spell_id: int, path: Path = DB_PATH) -> dict | None:
```

Callers index into the returned dict (`row["effects"]`, `row["tier"]`) without any type-checker assistance. Misspelled keys produce a runtime `KeyError`.

**Fix:** TypedDict per-table return shape (`SpellRow`, `RecipeRow`, `ZoneRow`). Or — since each `*_db.py` already has a canonical column list (`_SELECT_COLS`) — generate the TypedDict from that list.

---

#### BE-094: `pyproject.toml` package name still `eq2censusbot`
**Location:** `pyproject.toml:2`
**Effort:** small

Post-rename leftover (BE-012 covers the conftest.py side). 

**Fix:** Update `name = "eq2lexicon"`.

---

#### BE-095: FastAPI title still `"EQ2 TLE Companion"` post-rename
**Location:** `web/app.py:269`
**Effort:** small

```python
269:     title="EQ2 TLE Companion",
```

**Fix:** Update to `"EQ2 Lexicon"`. Also `web/metrics.py:84` `Info("eq2_companion", ...)` should change to `Info("eq2_lexicon", ...)` — but that's a Prometheus label rename so callers would need to know.

---

#### BE-096: `tests/conftest.py` env var setup happens at module import — fragile vs pytest plugin order
**Location:** `tests/conftest.py:14-44`
**Effort:** small

The `os.environ.setdefault("DB_USERS_PATH", ...)` calls run at conftest import. This works because pytest imports conftest before test modules — but if anyone adds a plugin (`pytest-asyncio`, etc.) that imports `web.app` during plugin discovery (rare but possible), the env vars haven't been set yet, and the test suite picks up the dev DB.

**Fix:** Use a `pytest_configure` hook in conftest instead of module-level statements — guaranteed-ordered.

---

## P1 — Env / config / magic numbers (6)

#### BE-100: 4 sites with the same `os.getenv("ADMIN_DISCORD_IDS","").split(",")` pattern
**Location:** Covered by BE-003. **Withdrawn** (duplicate).

---

#### BE-101: Magic numbers throughout — TTLs, throttles, batch sizes
**Location:**
- `web/census_refresh.py:29` `_THROTTLE = 900`
- `web/cache.py:170-173` ttl=300, max_age=3600 hardcoded per cache
- `web/routes/parses.py:388` `MIRROR_WINDOW_S = 60`
- `web/routes/parses.py:747` `inner_cap = max(limit * 30, 2000)` (no comment explains 30)
- `web/routes/admin.py:332` `limit = max(1, min(limit, 1000))`
- `web/routes/parses.py:736` `limit = max(1, min(limit, 500))`
**Effort:** small

Each magic number is justified by a comment, but they're scattered across files. A single `web/constants.py` with named constants would document them in one place.

**Fix:** `web/constants.py` with `CENSUS_REFRESH_THROTTLE_S`, `CHARACTER_CACHE_TTL_S`, `CHARACTER_CACHE_MAX_AGE_S`, `PARSE_MIRROR_WINDOW_S`, `PARSE_LIST_MAX_LIMIT`, `ADMIN_PARSE_LIST_MAX_LIMIT`, etc.

---

#### BE-102: `STALE_S = 900` defined inside `get_character` instead of as module constant
**Location:** `web/routes/character.py:448`
**Effort:** small

```python
447:     now = int(time.time())
448:     STALE_S = 900  # 15 min
```

The same 900-second window is also `_THROTTLE` in census_refresh.py and the comparison threshold in `guild.py:653, 715`. Three independent literals for the same concept.

**Fix:** `CHARACTER_STALE_S` in the constants module (BE-101).

---

#### BE-103: `ALLOWED_SERVERS` lowercased on every parse ingest
**Location:** `web/routes/parses.py:64`, `web/routes/parses.py:1395`
**Effort:** small

```python
64: _ALLOWED_SERVERS_LOWER: frozenset[str] = frozenset(s.lower() for s in _ALLOWED_SERVERS)
```

Actually this is computed once at module load (good). But the comparison is `sanitized_server.lower() in _ALLOWED_SERVERS_LOWER` — sanitized_server is already validated by `_sanitize_world` which preserves case. The .lower() comparison loses the case info we just kept. Tiny nit.

**Fix:** Decide: case-insensitive throughout (lowercase the registry too), or case-sensitive (drop the .lower()). Mixing means a future "rename Wuoshi → Wuoshi'" via case-change works in one place but not the other.

---

#### BE-104: `LAUNCH_DT_ISO` default `2026-06-09T20:00:00Z` is a date that has passed for current users
**Location:** `census/config.py:43`
**Effort:** small

```python
43: LAUNCH_DT_ISO: str = os.getenv("LAUNCH_DT", "2026-06-09T20:00:00Z")
```

For any deploy without `LAUNCH_DT` env var set after June 2026, the countdown widget shows a date in the past. The comment at line 41-42 says "Set to an empty string or a past date to suppress the countdown widget" — so the past-date case is handled gracefully — but the default value will silently lie for any contributor running locally without env config.

**Fix:** Default to empty string `""` so the countdown is hidden when unset.

---

#### BE-105: `web/config.py` is a 16-line re-export shim — adds zero value
**Location:** `web/config.py`
**Effort:** small

```python
from census.config import (
    ALLOWED_SERVERS,
    CORS_ORIGINS,
    DISCORD_SYNC_GUILD_IDS,
    LAUNCH_DT_ISO,
    SERVER_MAX_LEVEL,
    SERVICE_ID,
    SESSION_COOKIE_DOMAIN,
    WORLD,
)
```

Per the file docstring: "All new web routes should import from here; all bot/census code from census.config." But routes today import directly from `census.config` in some places (e.g. `census_refresh.py:17`, `bot/cogs/*.py`). The split is mostly cosmetic — if it were to enforce a real distinction (e.g. web-only overrides) it'd be useful. As-is it's a one-extra-import-hop.

**Fix:** Either commit to the split (move web-only config into web/config.py — e.g. `SESSION_COOKIE_DOMAIN`, `CORS_ORIGINS`) or delete the shim and have everyone import from `census.config`.

---

## P1 — Other (7)

#### BE-110: `_log.info("[Census] HTTP %s url=%s", resp.status, resp.url)` logs URL with service_id (covered by BE-007)
**Withdrawn** — duplicate of BE-007.

---

#### BE-111: `_TIER_DB_MAP = {t.upper(): t for t in _CANONICAL_TIERS}` runs at module load (good)
**Location:** `web/routes/item.py:64`
**Withdrawn** — not a finding.

---

#### BE-112: `census/zones_db.py` has 25 list/find helpers with similar `if not path.exists(): return [] / None` boilerplate
**Location:** Throughout `census/zones_db.py:421-450, 455-481, 484-494, 497-511, 578-624, 627-653, …`
**Effort:** medium

Every public read function starts with:
```python
def list_xxx(...):
    if not path.exists():
        return []
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
```

A decorator (or context manager) that handles "open RO if exists, else return empty default" would shave ~80 lines of boilerplate.

**Fix:** `@with_zones_db_or_default([])` decorator that injects `conn` and short-circuits when DB missing.

---

#### BE-113: `_handle_zone` editor functions use `with sqlite3.connect(path) as conn:` but writes — `as conn` doesn't commit
**Location:** `census/zones_db.py:721-749` (`_zone_name_and_expansion`), `add_encounter`, `update_encounter`, etc.
**Effort:** small

```python
with sqlite3.connect(path) as conn:
    conn.execute("INSERT INTO ...")
```

The context manager commits only on exception-less exit AND only if a transaction is active. For implicit autocommit usage, this works; for `PRAGMA foreign_keys = ON;` + an INSERT it sometimes silently doesn't commit on Windows (sqlite3.connect's autocommit behaviour is platform-dependent and confusing).

**Fix:** Add explicit `conn.commit()` before the `with` block exits for any write path.

---

#### BE-114: `_find_by_name_sync` exists alongside `find_by_name` async — sync path is fallback for "no aiosqlite"
**Location:** `census/db.py:926-955`
**Effort:** small

```python
async def find_by_name(name: str, path: Path = DB_PATH) -> dict | None:
    try:
        import aiosqlite
    except ImportError:
        return _find_by_name_sync(name, path)
```

The `try: import aiosqlite; except ImportError:` fallback runs on every call. aiosqlite is in pyproject.toml deps — it's always available. The fallback is dead code in practice.

**Fix:** Drop the try/except; move the aiosqlite import to module top. Remove `_find_by_name_sync` + `_find_by_id_sync` (covered by `gear_for_ids`-style sync helpers used by `scripts/`).

---

#### BE-115: `bot/cogs/items.py` etc. instantiate `CensusClient` per-cog, holding the session for the bot's lifetime
**Location:** `bot/cogs/aacheck.py:59`, `bot/cogs/guild.py:76`, `bot/cogs/items.py`, `bot/cogs/spellcheck.py:92`
**Effort:** small

Each cog holds its own `CensusClient`. The bot has 4 cogs → 4 aiohttp.ClientSession objects. Sharing one session would be the same fix as BE-010 but for the bot.

**Fix:** Move the CensusClient to the bot instance (`self.bot.census`), close once in `bot.on_shutdown`.

---

#### BE-116: `prewarm_character_cache` doesn't iterate the server registry
**Location:** `web/routes/character.py:389-436`
**Effort:** small

```python
395:     # NOTE: pre-warm runs at startup OUTSIDE any request, so current_world() here
396:     # resolves to the default server only. Non-default servers warm on first
397:     # request rather than at boot. (Per-server pre-warm would iterate the registry.)
```

Currently only the default server's claimed characters are pre-warmed. For a Wuoshi-only user, every page on Wuoshi starts cold for 10 seconds. The TODO in the comment is the fix.

**Fix:** `for srv in list_public_servers(): await prewarm_for_world(srv.world)`. Existing semaphore limits Census concurrency across all worlds combined.

---

# P2 — Polish (41)

These are smaller naming / readability / micro-perf items. Each is justified individually but lower-priority.

- **BE-200** `_log = logging.getLogger(__name__)` declared in 16 files — keep, conventional, no fix needed. **Withdrawn**.
- **BE-201** `_int` defined as `def _int(v):` (untyped param) in `web/routes/guild.py:166` — should be `def _int(v: object) -> int | None:`.
- **BE-202** `web/cache.py:170-173` cache instances created at module-import as singletons — fine, but the `name="character"` etc. labels are stringly-typed. A `CacheName` Literal would help type-checkers narrow at call sites.
- **BE-203** `web/routes/aa.py:139-167` — `get_aa_tree` parses JSON every request. Cache `dict[tree_id, AATreeResponse]` at module load (small data, ~50 files).
- **BE-204** `web/routes/aa.py:46-56` `_load_tree_index()` silently swallows all errors per tree file. Log warnings.
- **BE-205** `bot/cogs/aacheck.py:23-33` `_load_tree_index()` is duplicated structurally with `web/routes/aa.py:45-56` — same JSON parsing, same key extraction. Extract to `image/aa_tree.py` (already has `detect_tree_type`).
- **BE-206** `web/routes/parses.py:710` uses `strict=True` for zip — good Python 3.10+ practice; not done at other zip sites (none in this codebase actually, **Withdrawn**).
- **BE-207** `web/routes/parses.py:560` `SIZE_BUCKETS: dict[str, tuple[int, int]]` could be a frozen dict via `MappingProxyType` to prevent accidental mutation.
- **BE-208** `web/routes/parses.py:533-540` `_PLAYER_COUNT_SQL` is a multi-line string concatenation — readable but multi-line raw string with explicit triple-quote would be clearer.
- **BE-209** `web/routes/parses.py:1041-1067` `_combatants_from_payload` constructs 30-field dataclass with 30 `r.get(...)` lookups. Could iterate over a `_COLUMN_MAP: dict[str, str]` to halve the code. Low ROI.
- **BE-210** `web/routes/raid_strategies.py:163-167` `for boss in z.get("bosses", []):` — could be a dict lookup if `bosses` was indexed by position. Not on hot path.
- **BE-211** `web/db.py:550-557` `list_role_requests` SQL uses string concatenation — fine, params are bound, but the `where_sql = "WHERE " + " AND ".join(where)` pattern is repeated in many files. A query-builder helper.
- **BE-212** `web/routes/zones.py:283-313` `_compute_progress_sync` chunks lookup at 900 — a constant like `SQLITE_VAR_LIMIT_SAFE = 900` would document the 999 SQLite default.
- **BE-213** `census/zones_db.py:629-653` `find_zones_by_boss` uses `LIKE` not `=` on `mob_name_lower` — exact match is what we want here. **Re-reading: it's `=`. Withdrawn.**
- **BE-214** `web/auth_deps.py:212-217` lazy import inside `dep` function — fine, but the import happens on every editor request even when admin shortcut applies (no, admin returns at line 200, before the lazy import). **Re-reading: correct. Withdrawn.**
- **BE-215** `web/server_context.py:104-108` `set_active_server` / `reset_active_server` could be a single `@contextlib.contextmanager active_server(...)` to reduce middleware boilerplate.
- **BE-216** `web/server_context.py:131-145` middleware does manual `for part in qs.split("&")` parsing — use `urllib.parse.parse_qs(scope.get("query_string", b"").decode())["server"][0]` for correctness around URL-encoded values.
- **BE-217** `web/app.py:197-201` mount paths hardcoded — `_FRONTEND_DIST`, `_ICONS_DIR`, etc. Could be a dict-driven mount table.
- **BE-218** `web/app.py:308-333` 26 router includes — one-per-line is fine but a loop over a list of routers would be ~3 lines.
- **BE-219** `web/cache.py:160-173` 4 cache instances — `TTLCache(ttl=300, max_age=3600, ...)` repeated. Default args could be set on the class.
- **BE-220** `bot/bot.py:23-27` 5 cog imports lazy inside `setup_hook` — could be module-level imports (no obvious circular risk).
- **BE-221** `web/routes/raid_strategies.py:215-296` `_write_overview_sync` is 80 lines — could split into "create new" + "update existing" sub-helpers.
- **BE-222** `web/routes/admin.py:249` non-PEP8 placement: `from web.routes.role_requests import RoleRequestEntry  # noqa: E402` happens mid-module. Move to top.
- **BE-223** `parses/db.py:863-877` `_DAMAGE_SWING_TYPES = (1, 2)` etc. — could be `IntFlag` enum for clarity.
- **BE-224** `parses/models.py:21-103` `_to_*` helpers in models.py shadowed by `parses/db.py`'s use of `_to_unix`. Different concern; fine.
- **BE-225** `census/recipes_db.py:31-39` `SPELL_TIERS: tuple[str, ...]` could be an `IntEnum` for ordering.
- **BE-226** `census/client.py:30` `BASE_URL = "https://census.daybreakgames.com"` — module constant; could move to `census/config.py`.
- **BE-227** `web/routes/parses.py:84-93` regexes defined at module load — good. `_VALID_WORLD_RE` has a max-length built into the regex (30) AND `_sanitize_world` strips first — defence in depth, fine.
- **BE-228** `web/routes/parses.py:1191-1256` `_ingest_payload_sync` is 65 lines — could be split.
- **BE-229** `web/metrics.py:111-191` `_DBCollector.collect` runs every scrape and re-opens 3 connections. Could maintain one read-only conn per DB.
- **BE-230** `web/routes/recipes.py:79-106` `_ADVENTURE_CLASSES` is a hardcoded list of 25 strings. Could come from `census/classes_db.py` `CLASS_SEED` for one source of truth.
- **BE-231** `census/classes_db.py:30` `_F, _P, _S, _M = "#f87171", "#4ade80", "#fbbf24", "#93b4ff"` — comment says "carried from the old frontend classConstants.ts". Frontend now uses tokens (per the audit). Backend should source these from a single canonical place too.
- **BE-232** `web/db.py:1102-1107` `_run(path, sql, params)` exists for one use — `update_item_watch_check` — could just be inlined.
- **BE-233** `web/routes/parses.py:1442` `loop = asyncio.get_event_loop()` declared but only used once on next line.
- **BE-234** `web/routes/zones.py:226-247` `_resolve_primary_guild` function doc says "Either value may be None" — `Optional[tuple[str | None, str | None]]` would be a stricter signature.
- **BE-235** `web/routes/character.py:484-498` self-heal write back to census_store inside `try/except: pass` — log at debug already, good. **Withdrawn**.
- **BE-236** `census/spells_db.py:354` `find_by_crc` is `@lru_cache(maxsize=4096)` — module-level cache that doesn't invalidate. If a spell is re-downloaded with new tier data, this cache lies. Likely fine because spell data rarely changes — but documenting the invalidation gap (or adding a `find_by_crc.cache_clear()` in `upsert_spells`) would be safer.
- **BE-237** `web/routes/parses.py:265-282` `_cached_snapshots` — duplicate of part of `_resolve_combatant_snapshots`. Covered by BE-025.
- **BE-238** `bot/cogs/items.py:12` `_log = logging.getLogger(__name__)` but cog itself doesn't appear to log anything (need to verify; not investigated).
- **BE-239** `web/routes/raid_strategies.py:51-76` `_resolve_primary_guild_cached` is "cached" only in the sense that it reads from the cache, not that it caches its own result. The name is misleading.
- **BE-240** `web/routes/raid_strategies.py:559` `loop = asyncio.get_event_loop()` then 3 `await loop.run_in_executor(None, ...)` calls — fine, but extracting the loop var is unusual when used once.

---

## Cross-cutting recommendations

Things that emerged as patterns across multiple findings rather than fitting a single one:

### 1. Introduce `web/lib/` for shared helpers
Mirroring the frontend's `lib/` introduction (`toErrorMessage`, `handle<T>(r)`). Suggested initial contents:
- `web/lib/executor.py` — `run_sync(fn, *args)` wrapping run_in_executor (BE-024)
- `web/lib/log_safety.py` — `scrub(value)` for log-line injection (BE-022)
- `web/lib/cache_keys.py` — `char_cache_key`, `guild_cache_key` (BE-023)
- `web/lib/validation.py` — character-name, world, guild-name regex helpers (BE-030)
- `web/lib/db_helpers.py` — connection-opening + read-only context managers (BE-021)
- `web/lib/primary_guild.py` — shared primary-character/guild resolution (BE-026)
- `web/lib/session_user.py` — `SessionUser` TypedDict (BE-091)

A single PR can stand these up; later PRs migrate call sites. Same shape as the frontend audit's "shared frontend infrastructure" section.

### 2. CensusClient singleton (BE-010, BE-115)
By far the highest-ROI single change. Removes 18 boilerplate try/finally blocks, eliminates the per-call session-construction cost, and aligns with aiohttp's documented usage. The bot cog change is the same pattern, scaled to 4 cogs.

### 3. Split the three giant files (BE-050, BE-051, BE-053)
`parses.py` (1687), `web/db.py` (1309), `character.py` (933) are all >2× the next biggest. They've already grown past the "easy to navigate" point. The split conventions are established (the frontend audit's `pages/admin/`, `pages/guild/`, `pages/parse/` subdirs mirror this).

### 4. One canonical place for ENV vars (BE-003, BE-100, BE-101)
`ADMIN_DISCORD_IDS` read in 4 places, the same `_ADMIN_IDS` frozenset constructed 4 times — the third party to add a new env var read does so by copy-paste. A `web/config.py` (real one, not just a re-export shim) that owns *all* env-var-driven config would close this gap. Documenting the per-deploy override story in one place would also save the next contributor the "where do I add this env var?" question.

### 5. Schema-as-data with migration assertions (BE-070, BE-074, BE-063)
The "CREATE then ALTER then CREATE INDEX" dance is correct but brittle — it's encoded in comments rather than in code. Either (a) move to an Alembic-style migration framework (probably overkill for a 5-table app), or (b) have init_db assert that every column in the current SCHEMA is also covered by either the initial CREATE or by an ALTER. A 20-line `assert_schema_complete(conn)` helper run after init_db on test startup would catch every "I forgot the migration" regression at test time.

### 6. Stop using `except Exception: pass` as a catch-all
22 sites, mostly correctly used for "don't break on metrics increment / cache write failure". But the pattern is too easy to copy into places where the silent swallow IS the bug (BE-080, BE-082, BE-083). A `swallow(category="metrics", level="debug")` context manager would make the intent explicit and ensure something is logged.

### 7. Lifespan-based startup/shutdown (BE-045)
Three untracked background tasks (`prewarm_character_cache`, `_cache_sweep_loop`, `census_health.poll_loop`) are the documented cause of dev-server hangs (user memory: "Backend `--reload` hangs on untracked bg tasks"). A `lifespan` context manager with a `tasks: list[asyncio.Task]` that's cancelled on shutdown is the FastAPI-blessed fix.

### 8. Connection pooling / read-only connections (BE-044, BE-229)
Every sync handler currently opens + closes its own sqlite3 connection. SQLite is fast at this, but it leaves perf on the table for the metrics scraper, which opens 3 connections every 30 seconds. A module-level `_RO_CONN: contextvars.ContextVar[sqlite3.Connection]` populated by middleware would let each request reuse one read-only connection across all helpers it calls.
