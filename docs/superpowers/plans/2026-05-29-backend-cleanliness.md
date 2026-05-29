# Backend Cleanliness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Burn down all 108 findings from the backend cleanliness audit (`docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md`) in five sub-phases — security/bug fixes first, then shared infrastructure, then file splits, then mechanical migrations, then polish.

**Architecture:** Phase 1 (P0) ships small surgical fixes for real-risk items (timing-attack, LIKE wildcards, log injection of SERVICE_ID, env-var drift, write storms). Phase 2a stands up the canonical helpers everything else builds on (`web/lib/executor.py`, `web/lib/census_lifecycle.py`, `census/_coerce.py`, `web/lib/log_safety.py`, `web/lib/cache_keys.py`, `web/lib/validation.py`, `web/lib/db_helpers.py`, `web/lib/primary_guild.py`, `web/lib/session_user.py`, `web/constants.py`, and a FastAPI `lifespan` task-tracker). Phase 2b splits the three giant files (`parses.py` 1687 lines, `web/db.py` 1309 lines, `character.py` 933 lines) into focused siblings mirroring the frontend `pages/admin/` convention. Phase 2c is mechanical migration — every hand-rolled `run_in_executor`, `CensusClient(...)`, `_int(...)` coercion, `scrub` variant, and `except Exception: pass` site adopts the canonical helper. Phase 3 is 41 polish items batched by category.

**Tech Stack:** Python 3.12+, FastAPI, aiohttp, aiosqlite, SQLite (WAL mode), Pydantic v2, pytest. `uv` for dependency + script execution (no PATH prefix; `uv run …` works straight from PowerShell — see memory `uv-on-path-no-prefix.md`). Per-server architecture uses `current_world()` / `current_server()` contextvars (see CLAUDE.md "Per-server architecture"). Discord bot is a separate process; `census/` code is shared between bot and web. HMAC-validated parse uploads from the EQ2LexiconACTPlugin land at `/api/parses/ingest`.

Spec: `docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md` (108 findings: P0 = 11, P1 = 56, P2 = 41). Each task references the spec's BE-NNN IDs.

---

## File Structure

### New files created across all phases

**Phase 1 (P0):**
- No new modules — surgical edits to existing files.

**Phase 2a (P1a shared infrastructure):**
- `web/lib/__init__.py` — empty package marker.
- `web/lib/executor.py` — `run_sync(fn, *args, **kwargs)` wrapping `loop.run_in_executor`. (BE-024)
- `web/lib/census_lifecycle.py` — `shared_census_client()` async context manager + module-level `get_shared_census_client()`. (BE-009/010, BE-115)
- `web/lib/log_safety.py` — `scrub(value: object) -> str` log-injection helper. (BE-022)
- `web/lib/cache_keys.py` — `char_cache_key`, `guild_cache_key`, `aa_cache_key`. (BE-023)
- `web/lib/validation.py` — `validate_character_name`, `sanitize_world`, `validate_guild_name` + the regex constants. (BE-030)
- `web/lib/db_helpers.py` — `read_only_conn(path)` ctx mgr + `select_one`/`select_many`. (BE-021)
- `web/lib/primary_guild.py` — `cached_primary_guild(discord_id, world)` shared helper. (BE-026)
- `web/lib/session_user.py` — `SessionUser` TypedDict + `TokenUser` TypedDict. (BE-091)
- `web/lib/officer_gate.py` — `require_officer_of(user, guild_name)` shared helper. (BE-027)
- `web/lib/silent_swallow.py` — `swallow(category, level)` context manager for intentional exception swallows. (BE-080 cross-cutting)
- `web/constants.py` — magic-number constants module. (BE-101)
- `census/_coerce.py` — `coerce_int`, `coerce_float`, `coerce_str`, `coerce_str_or_none` (consolidates 5× duplication). (BE-020, BE-092)

**Phase 2b (P1b file splits):**
- `web/routes/parses/__init__.py` — re-exports the router.
- `web/routes/parses/models.py` — all Pydantic models from the original `parses.py`.
- `web/routes/parses/ingest.py` — POST `/parses/ingest` + HMAC validation + snapshot helpers.
- `web/routes/parses/list.py` — GET `/parses` + GET `/parses/{id}` + SQL helpers.
- `web/routes/parses/delete.py` — DELETE endpoints + `_can_delete_encounter`.
- `web/db/__init__.py` — `init_db()` orchestrator, `DB_PATH`, exports the per-domain helpers as flat names (preserves the existing `from web import db as users_db` API).
- `web/db/schema.py` — the `_SCHEMA` SQL string.
- `web/db/migrations.py` — every `ALTER TABLE` migration moved here.
- `web/db/users.py` — `upsert_user`, `set_user_access`, `list_pending_users`, role/role_request/role_permission helpers.
- `web/db/claims.py` — `add_claim`, `get_active_claims`, `review_claim`, `list_claims`, etc.
- `web/db/item_watch.py` — `add_item_watch`, `list_item_watches`, `update_item_watch_check`, etc.
- `web/db/tokens.py` — `create_api_token`, `lookup_api_token`, `revoke_api_token`, etc.
- `web/db/servers.py` — `load_registry`, `list_public_servers`, `upsert_server`, etc.
- `web/routes/character/__init__.py` — re-exports the router.
- `web/routes/character/views.py` — GET `/character/{name}`, `_build_char_response`, equipment helpers.
- `web/routes/character/spells.py` — GET `/character/{name}/spells`.
- `web/routes/character/upgrades.py` — GET `/character/{name}/upgrade-materials` + `/upgrade-recipes`.
- `web/routes/character/_shared.py` — `_get_or_fetch_character` helper used by all three.

### Modified files
The bulk of Phase 1, all of Phase 2c, and all of Phase 3 edits existing files in place. See per-task sections.

---

## Conventions for every task

1. **Verification per task** runs `uv` directly — no PATH prefix needed (memory `uv-on-path-no-prefix.md`):
   - `uv run ruff format <touched-files>` — auto-fmt; non-fatal.
   - `uv run ruff check <touched-files>` — lint must pass clean.
   - `uv run pyright <touched-files>` — type check must pass clean (warnings OK if pre-existing in untouched code).
   - `uv run pytest <relevant-test-dir> -v -x` — bail on first failure. Test dir per task: `tests/web` for web changes, `tests/parses` for parses changes, `tests/census` for census changes, `tests/` (whole suite) for cross-cutting changes.
2. **NO commits inside tasks.** Per memory [[hold-commits-on-visual-work]] — even though backend isn't visual, the pattern is kept consistent so the user can spot-check before each phase ships. Every change is held for user review. Each phase ends with a single **commit-checkpoint task** the user runs after approval.
3. **Stage ONLY the named files at each checkpoint.** Never `git add -A` — the user may have unrelated WIP. The commit-checkpoint task explicitly lists the files to add.
4. **Branch:** the user works on `main`. Each phase commit can push direct to main via `git push origin main` (the pre-push hook in `.githooks/pre-push` runs ruff/pyright/pytest; this plan's per-task verification ensures pre-push passes).
5. **No `--no-verify`.** If the pre-push hook fires on the commit step, fix the failure — don't bypass.
6. **DB schema changes:** any task that modifies `_SCHEMA` or adds a `_MIGRATIONS` entry MUST include a "test against pre-migration DB shape" verification step (see memory [[test-migrations-against-old-db-shape]]). The repo has been bitten by this before — a column-dependent index in `_SCHEMA` crashed prod startup because the index was created BEFORE the `ALTER TABLE` that added the column on existing DBs.
7. **Cross-DB helpers:** any helper that writes to a secondary persistent file (e.g. mirrors to `census_store.db` from the parses path) MUST call `init_db()` itself rather than assuming the caller did (memory [[local-passing-tests-can-mask-fresh-env-bugs]]). Verify with a `DB_<NAME>_PATH=/tmp/fresh.db uv run pytest <relevant-test>` invocation.
8. **lru_cache invalidation:** any new `@lru_cache` MUST have a sibling `invalidate_*_cache()` function called from every mutation path. See `web/routes/rankings.py:195-203` (`invalidate_zones_cache` calls `_cached_zones_data.cache_clear()`) as the canonical pattern.
9. **HMAC defensive validation** (`web/routes/parses.py:_validate_payload_signature`): the body bytes the HMAC hashes are the wire bytes (Starlette caches them after FastAPI's body-injection). Any task that adds a middleware between SessionMiddleware and a route MUST extend the HMAC regression test in Task 1.8 to cover that path.
10. **Single-process assumption:** the codebase runs as one uvicorn process; SSE pub/sub (`web/census_events.py`) and `_cached_zones_data` LRU rely on that. Tasks that touch process-local state must reference this assumption in a comment.

---

## Per-task numbering

Tasks are `<phase>.<task>` where phase is `1`, `2a`, `2b`, `2c`, or `3`. Each task ends with a verification step; the phase-end commit-checkpoint task ends with the staging + commit commands.

---

# Phase 1 — P0: bugs, security, drift (11 fixes)

After Phase 1: timing-attack-safe metrics auth, LIKE-pattern-injection-safe SQL searches, SERVICE_ID redacted from logs, single canonical `_ADMIN_IDS`, write-storm-coalesced `last_used_at`, HMAC-against-middleware regression test, gear-rating cached, `eq2censusbot-pytest` → `eq2lexicon-pytest`, and the `_cached_zones_data` single-process assumption explicitly documented + asserted at startup.

Sequence rationale: small surgical fixes first (1.1–1.7) so the codebase is safer immediately. The CensusClient lifecycle pattern (BE-009/BE-010) doesn't ship its canonical fix until Phase 2a — the audit explicitly groups them — but Phase 1 adds a `# CENSUS-CLIENT-LIFECYCLE: see Phase 2a` marker comment on the 18 sites so the migration is grep-able. The HMAC regression test (1.8) lands as P0 because the assumption it pins is one middleware addition away from breaking every plugin upload.

---

## Task 1.1: Use `hmac.compare_digest` for `/metrics` token check (BE-002)

**Files:** `web/metrics.py:313-323`

The metrics endpoint compares the bearer token via `==`, which is timing-attackable. The HMAC ingest path already uses `hmac.compare_digest` (parses.py:1333) — this aligns.

- [ ] **Step 1: Edit `web/metrics.py`**

Before (lines 313-323):
```python
METRICS_TOKEN: str = os.getenv("METRICS_TOKEN", "")


def check_metrics_auth(authorization: str | None) -> bool:
    """Return True if the request is authorised to view /metrics."""
    if not METRICS_TOKEN:
        return True  # no token configured → open access
    if not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    return scheme.lower() == "bearer" and token == METRICS_TOKEN
```

After:
```python
import hmac as _hmac

METRICS_TOKEN: str = os.getenv("METRICS_TOKEN", "")


def check_metrics_auth(authorization: str | None) -> bool:
    """Return True if the request is authorised to view /metrics.

    Uses ``hmac.compare_digest`` to avoid the timing-attack window that ``==``
    on the token string would open. Consistent with
    ``web.routes.parses._validate_payload_signature`` which uses the same
    helper for the plugin-upload HMAC.
    """
    if not METRICS_TOKEN:
        return True  # no token configured → open access
    if not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return False
    return _hmac.compare_digest(token, METRICS_TOKEN)
```

(Add `import hmac as _hmac` near the top of the file alongside the other stdlib imports if it isn't already imported.)

- [ ] **Step 2: Verify**

```
uv run ruff format web/metrics.py
uv run ruff check web/metrics.py
uv run pyright web/metrics.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 1.2: Collapse `_ADMIN_IDS` to one canonical import (BE-003, BE-029, BE-100)

**Files:**
- `web/routes/auth.py:24-28` (delete local `_ADMIN_IDS`)
- `web/routes/guild_officer.py:19` (delete local `_ADMIN_IDS`) + `:154-160` (delete local `_require_admin`)
- `web/routes/notifications.py:27` (delete local `_ADMIN_IDS`)

`web/auth_deps.ADMIN_IDS` is the canonical frozenset and is already exported. Three other modules re-declare an identical frozenset and one (`guild_officer.py`) duplicates `require_admin` too.

- [ ] **Step 1: Patch `web/routes/auth.py`**

Find at line ~24:
```python
_ADMIN_IDS: frozenset[str] = frozenset(filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(",")))
if not _ADMIN_IDS:
    _log.warning(
        "ADMIN_DISCORD_IDS is not set — no users will have admin access. Set this env var to your Discord user ID."
    )
```

Replace with:
```python
# Imported for consumer use within this module — auth_deps already logs the
# "ADMIN_DISCORD_IDS not set" warning once at import.
from web.auth_deps import ADMIN_IDS as _ADMIN_IDS  # noqa: F401  (re-exported via callers below)
```

Then grep within `web/routes/auth.py` for uses of `_ADMIN_IDS` — every site should now resolve via the import. Delete the unused local `os` import if it has no other call sites in the file.

- [ ] **Step 2: Patch `web/routes/guild_officer.py`**

Find at line ~19:
```python
_ADMIN_IDS: frozenset[str] = frozenset(filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(",")))
```

Delete the line. Replace `_require_admin` at line ~154-160 with an import from `auth_deps`:

Before (lines ~154-160):
```python
def _require_admin(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["id"] not in _ADMIN_IDS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
```

After (delete the function entirely). Then at the top of the file add the import:

```python
from web.auth_deps import require_admin as _require_admin
```

Grep within the file for `_require_admin` — every call site (e.g. `Depends(_require_admin)`) keeps working via the alias. Delete the unused local `os` import.

- [ ] **Step 3: Patch `web/routes/notifications.py`**

Find at line ~27:
```python
_ADMIN_IDS: frozenset[str] = frozenset(filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(",")))
```

Replace with:
```python
from web.auth_deps import ADMIN_IDS as _ADMIN_IDS  # noqa: F401  (used by handlers below)
```

Then grep within the file for `_ADMIN_IDS` — confirm the import covers every site. Delete the unused `os` import if appropriate.

- [ ] **Step 4: Verify**

```
uv run ruff format web/routes/auth.py web/routes/guild_officer.py web/routes/notifications.py
uv run ruff check web/routes/auth.py web/routes/guild_officer.py web/routes/notifications.py
uv run pyright web/routes/auth.py web/routes/guild_officer.py web/routes/notifications.py
uv run pytest tests/web -v -x
```

All clean. Pay particular attention to the auth tests under `tests/web/test_auth.py` and `tests/web/test_guild_officer.py` to confirm the `_require_admin` alias keeps existing test overrides working.

---

## Task 1.3: Escape `%`/`_` in user-supplied LIKE patterns (BE-006)

**Files:**
- `census/db.py:906` — items search LIKE
- `census/spells_db.py` — spells `find_by_name` LIKE fallback (the spec cites line 502; verify via grep)
- `census/recipes_db.py` — recipes `find_by_name` LIKE fallback (the spec cites line 406; verify via grep)
- `web/routes/admin.py` — `list_encounters_for_admin` LIKE clauses if present

A name containing `%` silently broadens the match and forces a table scan. Not arbitrary-SQL injection (params are bound) but it is arbitrary-pattern injection.

- [ ] **Step 1: Add `_like_escape` helper to each affected module**

In `census/db.py` near the top of the helpers section, add:

```python
def _like_escape(s: str) -> str:
    """Escape SQLite ``LIKE`` wildcards so a user-supplied search string can't
    silently broaden the match (``%``) or force a table scan (``_``).

    The matching SQL must use ``ESCAPE '\\'`` for these escapes to take effect.
    """
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
```

Add the same helper in `census/spells_db.py` and `census/recipes_db.py`. (We'll consolidate in Phase 2a, but per-module duplication is acceptable for the P0 fix — Phase 2a's `web/lib/db_helpers.py` will absorb these.)

- [ ] **Step 2: Patch `census/db.py:906`**

Before:
```python
        # LIKE fallback
        row = await _best("displayname_lower LIKE ?", (f"%{name.lower()}%",))
        return json.loads(row["raw_json"]) if row else None
```

After:
```python
        # LIKE fallback — escape user input so '%' / '_' in a literal name can't
        # silently broaden the match or force a full-table scan (~1M item rows).
        row = await _best(
            "displayname_lower LIKE ? ESCAPE '\\'",
            (f"%{_like_escape(name.lower())}%",),
        )
        return json.loads(row["raw_json"]) if row else None
```

Apply the same `LIKE ? ESCAPE '\\'` pattern to the sync `_find_by_name_sync` helper at line ~954 in the same file.

- [ ] **Step 3: Patch `census/spells_db.py` LIKE fallback**

Grep `census/spells_db.py` for `LIKE ?` to find the fallback in `find_by_name`. Apply the same `_like_escape` + `ESCAPE '\\'` pattern.

- [ ] **Step 4: Patch `census/recipes_db.py` LIKE fallback**

Same — grep `census/recipes_db.py` for `LIKE ?` to find the fallback in `find_by_name`. Apply the same pattern.

- [ ] **Step 5: Patch `web/routes/admin.py` if it uses LIKE**

Grep `web/routes/admin.py` for `LIKE`. If `list_encounters_for_admin` (or any other handler) builds a LIKE pattern from a query-string filter, add the same escape + ESCAPE clause. If no LIKE site exists, skip this step.

- [ ] **Step 6: Add a regression test**

Create `tests/census/test_like_escape.py` (or extend the closest existing test file under `tests/census/`):

```python
"""Regression test for BE-006: LIKE-pattern escape on user-supplied names.

A name containing '%' or '_' must not match more rows than the literal name.
This used to silently broaden the match and force a table scan.
"""
from __future__ import annotations

import pytest

from census.db import _like_escape


def test_like_escape_percent() -> None:
    assert _like_escape("foo%bar") == "foo\\%bar"


def test_like_escape_underscore() -> None:
    assert _like_escape("foo_bar") == "foo\\_bar"


def test_like_escape_backslash() -> None:
    assert _like_escape("foo\\bar") == "foo\\\\bar"


def test_like_escape_plain() -> None:
    assert _like_escape("foobar") == "foobar"
```

(Add a second module-import line for `census.spells_db._like_escape` etc. if the per-module helpers are present.)

- [ ] **Step 7: Verify**

```
uv run ruff format census/db.py census/spells_db.py census/recipes_db.py tests/census/test_like_escape.py
uv run ruff check census/db.py census/spells_db.py census/recipes_db.py tests/census/test_like_escape.py
uv run pyright census/db.py census/spells_db.py census/recipes_db.py
uv run pytest tests/census tests/web -v -x
```

All clean.

---

## Task 1.4: Cache `gear_rating.json` at module import (BE-005)

**Files:** `web/routes/health.py:29-36, 56-64`

`/api/config` is hit on every page load and re-parses ~1 KB of JSON every time. Read it once at module import.

- [ ] **Step 1: Edit `web/routes/health.py`**

Before (lines 29-36, 56-64):
```python
def _load_gear_rating() -> dict[str, Any]:
    try:
        raw = json.loads(_GEAR_RATING_PATH.read_text(encoding="utf-8"))
        raw.pop("_comment", None)
        return raw
    except Exception:
        return _GEAR_RATING_DEFAULTS

# ...

@router.get("/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Public server configuration used by the frontend."""
    return ConfigResponse(
        server_max_level=SERVER_MAX_LEVEL,
        world=WORLD,
        gear_rating=_load_gear_rating(),
        launch_dt=LAUNCH_DT_ISO or None,
    )
```

After:
```python
def _load_gear_rating() -> dict[str, Any]:
    """Read + parse the gear-rating config once at module import.

    The file is static reference data — it doesn't change at runtime, so
    re-reading on every /api/config hit (every page load) was pointless I/O.
    A future hot-reload toggle would re-run this helper; today it's
    module-load-only.
    """
    try:
        raw = json.loads(_GEAR_RATING_PATH.read_text(encoding="utf-8"))
        raw.pop("_comment", None)
        return raw
    except Exception:
        return _GEAR_RATING_DEFAULTS


# Cached at module import — config file is reference data; rebuild requires
# a process restart (Railway redeploys on push, so this is fine).
_GEAR_RATING_CACHED: dict[str, Any] = _load_gear_rating()

# ...

@router.get("/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Public server configuration used by the frontend."""
    return ConfigResponse(
        server_max_level=SERVER_MAX_LEVEL,
        world=WORLD,
        gear_rating=_GEAR_RATING_CACHED,
        launch_dt=LAUNCH_DT_ISO or None,
    )
```

- [ ] **Step 2: Verify**

```
uv run ruff format web/routes/health.py
uv run ruff check web/routes/health.py
uv run pyright web/routes/health.py
uv run pytest tests/web -v -x
```

All clean. Pay particular attention to any test under `tests/web/test_health.py` (or similar) that mocks `_load_gear_rating` — it now runs at import, so the mock has to be applied via `monkeypatch.setattr("web.routes.health._GEAR_RATING_CACHED", ...)` rather than patching the function.

---

## Task 1.5: Redact SERVICE_ID from Census INFO logs (BE-007)

**Files:** `census/client.py` — every `_log.info("[Census] GET %s …")` and `_log.info("[Census] HTTP %s url=%s", resp.status, resp.url)` site.

The Census base URL embeds the paid SERVICE_ID (`/s:{service_id}/json/...`). Logging it at INFO leaks the deployment identifier to log aggregators — not a credential in the strict sense, but a griefable handle that should be DEBUG at most.

- [ ] **Step 1: Add a redaction helper near the top of `census/client.py`**

After the existing `_log = logging.getLogger(__name__)` declaration, add:

```python
import re as _re

# Strip the /s:<service_id>/ segment from a URL before logging. Pre-compiled at
# module load so the regex isn't rebuilt per log line.
_SERVICE_ID_RE = _re.compile(r"/s:[^/]+/")


def _redact_url(url: str) -> str:
    """Return the URL with the SERVICE_ID segment redacted.

    Census URLs are shaped ``https://census.daybreakgames.com/s:<id>/json/...``.
    The ``s:<id>`` segment is the paid API key identifier — fine to log at
    DEBUG, but at INFO it ends up in third-party log aggregators where it
    could be exfiltrated and griefed (rate-limited by an attacker).
    """
    return _SERVICE_ID_RE.sub("/s:REDACTED/", url)
```

- [ ] **Step 2: Drop the per-call INFO logs to DEBUG and redact remaining URLs**

For every site matching `_log.info("[Census] GET %s …` (the spec cites 12 lines: `:175, 336, 411, 471, 520, 666, 698, 745, 793, 884, 925, 983`), replace `_log.info(` with `_log.debug(`. Both the `GET %s params=%s` and the `HTTP %s url=%s` logs go to DEBUG.

For the `HTTP %s url=%s` lines (which receive a `yarl.URL`, not a `str`), explicitly `str(resp.url)` first and then `_redact_url(str(resp.url))` so the redaction applies even after stringification:

Before (example at line ~178):
```python
                _log.info("[Census] HTTP %s url=%s", resp.status, resp.url)
```

After:
```python
                _log.debug("[Census] HTTP %s url=%s", resp.status, _redact_url(str(resp.url)))
```

Do the same for every `_log.info("[Census] GET %s", url, …` line — `_log.debug(... _redact_url(url) ...)`.

Skip any log line whose payload doesn't include a URL (e.g. error logs at line 183 which log only the exception type + message — those stay at the level they were).

- [ ] **Step 3: Verify**

```
uv run ruff format census/client.py
uv run ruff check census/client.py
uv run pyright census/client.py
uv run pytest tests/census tests/web -v -x
```

All clean. The TraceConfig in `metrics.py` still records every Census call's status — no observability is lost by dropping these to DEBUG.

---

## Task 1.6: Coalesce `last_used_at` writes to 60s buckets (BE-011)

**Files:** `web/db.py:1276-1310` — `lookup_api_token`

Every HMAC-validated plugin upload (multiple per second during a raid) commits a row to `users.db` just to bump `last_used_at`. The field's precision below a minute isn't useful for the UI.

- [ ] **Step 1: Edit `lookup_api_token` in `web/db.py`**

Find the existing token bump (lines ~1303-1308):

```python
        # Bump last_used_at — fire and forget, don't fail the auth on this.
        await db.execute(
            "UPDATE api_tokens SET last_used_at = strftime('%s','now') WHERE id = ?",
            (row["token_id"],),
        )
        await db.commit()
```

Replace with:

```python
        # Coalesce last_used_at writes to 60s buckets.
        #
        # Plugin uploads fire multiple times per second during a raid; committing
        # an UPDATE on every upload was a real write-storm risk (WAL mitigates
        # locking but the disk write itself is the cost). Sub-minute precision
        # on this column isn't useful — the UI shows "last used 5 min ago",
        # not "last used 0.6 seconds ago". The existing SELECT already pulled
        # the current value as part of the row fetch in lookup callers; check
        # against it here.
        now = int(time.time())
        last_used = row["last_used_at"]
        if last_used is None or (now - int(last_used)) >= 60:
            await db.execute(
                "UPDATE api_tokens SET last_used_at = ? WHERE id = ?",
                (now, row["token_id"]),
            )
            await db.commit()
```

Confirm the SELECT at line ~1290 already pulls `last_used_at` — if not, add it to the SELECT column list. Add `import time` near the top of `web/db.py` if it isn't already imported.

- [ ] **Step 2: Add a regression test**

In `tests/web/test_api_tokens.py` (or create one if it doesn't exist), add:

```python
async def test_lookup_api_token_coalesces_writes(api_token: str) -> None:
    """BE-011: two lookups within 60 s should issue at most one UPDATE."""
    from web import db as users_db

    # First lookup — should write.
    row1 = await users_db.lookup_api_token(api_token)
    assert row1 is not None
    last_after_first = row1["last_used_at"]
    # Second lookup immediately after — should NOT write.
    row2 = await users_db.lookup_api_token(api_token)
    assert row2 is not None
    # last_used_at returned by the second call is whatever's in the row;
    # since we didn't update, it equals what the first call wrote.
    assert row2["last_used_at"] == last_after_first
```

(Reuse whatever `api_token` fixture already exists in the test module; if there isn't one, add a minimal one that calls `users_db.create_api_token` for a freshly-inserted user.)

- [ ] **Step 3: Verify**

```
uv run ruff format web/db.py tests/web/test_api_tokens.py
uv run ruff check web/db.py tests/web/test_api_tokens.py
uv run pyright web/db.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 1.7: Rename `eq2censusbot-pytest` test-DB dir + `pyproject.toml` package name (BE-012, BE-094, BE-095)

**Files:** `tests/conftest.py:22`, `pyproject.toml:2`, `web/app.py:269`.

Three stale references to the pre-rename name `eq2censusbot`. None are functional bugs — but they signal "missed during rename" to any new contributor.

- [ ] **Step 1: Patch `tests/conftest.py:22`**

Before:
```python
_TEST_DB_DIR = Path(tempfile.gettempdir()) / "eq2censusbot-pytest"
```

After:
```python
_TEST_DB_DIR = Path(tempfile.gettempdir()) / "eq2lexicon-pytest"
```

- [ ] **Step 2: Patch `pyproject.toml:2`**

Find:
```toml
name = "eq2censusbot"
```

Replace with:
```toml
name = "eq2lexicon"
```

- [ ] **Step 3: Patch `web/app.py:269`**

Find:
```python
        title="EQ2 TLE Companion",
```

Replace with:
```python
        title="EQ2 Lexicon",
```

Leave `web/metrics.py:84`'s `Info("eq2_companion", ...)` alone for now — that's a Prometheus label rename which would break callers' dashboards. Phase 3 (BE-095 polish task) handles the metrics rename with the dashboard-migration note.

- [ ] **Step 4: Verify**

```
uv run ruff format tests/conftest.py web/app.py
uv run ruff check tests/conftest.py web/app.py
uv run pyright tests/conftest.py web/app.py
uv run pytest tests/ -v -x
```

All clean. `uv` reads `pyproject.toml` for `name` — confirm `uv run` still resolves the project after the rename by running any uv command (the verification step above already does this).

---

## Task 1.8: Add HMAC-vs-middleware regression test (BE-008)

**Files:** `tests/web/test_parses_ingest_hmac.py` (create or extend)

The HMAC strict-mode rollout depends on Starlette caching `request.body()` after FastAPI's body-injection has consumed it. A future body-rewriting middleware (gzip decode, JSON normaliser, etc.) would silently break the assumption — the recomputed HMAC stops matching and every plugin upload starts 401-ing.

- [ ] **Step 1: Locate the existing HMAC test**

Find the current happy-path HMAC test under `tests/web/`. The spec references `web/routes/parses.py:1326` (the body re-read site); the corresponding test is probably in `tests/web/test_parses.py` or `tests/web/test_parses_ingest.py`. If neither exists, create `tests/web/test_parses_ingest_hmac.py`.

- [ ] **Step 2: Add the middleware-regression test**

```python
"""Regression: HMAC validation must survive a body-rewriting middleware
between SessionMiddleware and the ingest route.

The strict-mode HMAC check (web/routes/parses._validate_payload_signature)
reads ``request.body()`` after FastAPI has already injected the body into the
handler signature. Starlette caches the wire bytes so the second read is
free — but if any future middleware reads the body via the ASGI receive()
loop without preserving the cache, the bytes the HMAC hashes diverge from
the bytes the body model parsed, and every upload 401s.

This test inserts a no-op BaseHTTPMiddleware that calls ``await
request.body()`` and re-emits a response, then exercises the happy-path
ingest. If the test breaks, the middleware-ordering assumption documented
at parses.py:1324-1326 needs revisiting.
"""
from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response


class _NoOpBodyReadingMiddleware(BaseHTTPMiddleware):
    """Reads body, then forwards unchanged — proves the cache survives."""

    async def dispatch(self, request: Request, call_next):
        _ = await request.body()  # The exact pattern a debugging middleware would use.
        return await call_next(request)


@pytest.mark.asyncio
async def test_hmac_validation_survives_body_reading_middleware(
    app, api_token_fixture, valid_ingest_payload
) -> None:
    # Inject the middleware AFTER SessionMiddleware so the chain mirrors prod
    # ordering (auth → reads → ingest).
    app.add_middleware(_NoOpBodyReadingMiddleware)

    body_bytes = json.dumps(valid_ingest_payload).encode("utf-8")
    signature = hmac.new(api_token_fixture.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()

    with TestClient(app) as client:
        res = client.post(
            "/api/parses/ingest",
            content=body_bytes,
            headers={
                "Authorization": f"Bearer {api_token_fixture}",
                "X-Lexicon-Signature": signature,
                "Content-Type": "application/json",
            },
        )

    assert res.status_code == 201, res.text
```

Substitute `api_token_fixture` + `valid_ingest_payload` with whatever existing fixtures the parses-ingest tests use. If they don't exist, model after `tests/web/test_parses_ingest.py`'s existing happy-path test and share the fixtures via `conftest.py`.

- [ ] **Step 3: Add a defensive comment in `parses.py`**

In `web/routes/parses.py` around line 1324, extend the existing comment:

Before:
```python
    # Request.body() is cached after FastAPI's body-injection consumes it
    # to build `body: IngestRequest`, so re-reading here is free.
    body_bytes = await request.body()
```

After:
```python
    # Request.body() is cached after FastAPI's body-injection consumes it
    # to build `body: IngestRequest`, so re-reading here is free.
    #
    # ASSUMPTION: no middleware between this handler and the body-injection
    # mutates or re-emits the body in a way that breaks the cache. Adding
    # such a middleware will silently break every plugin upload. The
    # regression test in tests/web/test_parses_ingest_hmac.py pins this
    # behaviour against a no-op body-reading middleware — if you add a
    # middleware that rewrites the body (gzip decode, JSON normaliser,
    # etc.), extend that test to cover the new middleware before shipping.
    body_bytes = await request.body()
```

- [ ] **Step 4: Verify**

```
uv run ruff format web/routes/parses.py tests/web/test_parses_ingest_hmac.py
uv run ruff check web/routes/parses.py tests/web/test_parses_ingest_hmac.py
uv run pyright web/routes/parses.py tests/web/test_parses_ingest_hmac.py
uv run pytest tests/web/test_parses_ingest_hmac.py -v -x
uv run pytest tests/web -v -x
```

All clean. The new test passes; the broader web suite still passes.

---

## Task 1.9: Document `_cached_zones_data` single-process assumption + startup assert (BE-001)

**Files:** `web/app.py:223-260` (startup), `web/routes/rankings.py:195-270` (comment).

The `_cached_zones_data` LRU is invalidated per-process. Today this works because the deploy runs one uvicorn process (the SSE pub/sub in `web/census_events.py` documents the same). A future multi-worker config change would silently break invalidation. The spec offers option (a) "document + assert" or option (b) "swap to mtime-based reload". Per the brainstorm in the spec, we go with option (a) for P0 — fewer moving parts, no risk of mtime-based bugs, the multi-worker future is hypothetical.

- [ ] **Step 1: Add a startup assertion in `web/app.py:_startup`**

Find the existing `_startup` function (line ~224):

```python
    def _startup() -> None:
        users_db.init_db()
        server_context.load_registry()
        # Initialise the parses DB too so the schema + migrations are in place
        # before the first /api/parses/ingest hits — otherwise the first
        # upload's request pays that cost on the request thread.
        from parses import db as parses_db

        parses_db.init_db()
```

Insert at the top of the function (before `users_db.init_db()`):

```python
    def _startup() -> None:
        # Assert the single-process assumption baked into:
        #   - web/census_events.py — SSE pub/sub uses an in-process asyncio
        #     queue; cross-worker fan-out would need Redis.
        #   - web/routes/rankings.py:_cached_zones_data — LRU is per-process;
        #     invalidate_zones_cache() only clears the LRU on THIS worker.
        #
        # Set GUNICORN_WORKERS=1 (or unset it for uvicorn's default) on the
        # deploy. If you ever need to scale workers, the SSE + LRU layers
        # need a Redis-backed rewrite before that flip is safe.
        _workers = int(os.getenv("WEB_CONCURRENCY", "1"))
        if _workers != 1:
            raise RuntimeError(
                f"WEB_CONCURRENCY={_workers} is incompatible with the in-process "
                f"SSE pub/sub (web/census_events.py) and _cached_zones_data LRU "
                f"(web/routes/rankings.py). Set WEB_CONCURRENCY=1 or rewrite "
                f"both layers to use a cross-process backplane before scaling."
            )
        users_db.init_db()
        # ... rest unchanged ...
```

Add `import os` to the top of `web/app.py` if it isn't already imported.

- [ ] **Step 2: Extend the docstring on `_cached_zones_data`**

In `web/routes/rankings.py` at the existing docstring (line ~207):

Before:
```python
@lru_cache(maxsize=1)
def _cached_zones_data() -> tuple[dict[str, list[tuple[str, str]]], list[dict], list[dict]]:
    """Authoritative zone/boss data from zones.db, built once per process.
```

After:
```python
@lru_cache(maxsize=1)
def _cached_zones_data() -> tuple[dict[str, list[tuple[str, str]]], list[dict], list[dict]]:
    """Authoritative zone/boss data from zones.db, built once per process.

    PROCESS-LOCAL: this LRU lives in one Python process. invalidate_zones_cache()
    only clears it on the worker that handled the mutation; sibling workers
    serve stale data until they happen to evict. A startup assertion in
    web/app.py:_startup pins WEB_CONCURRENCY=1 so this is safe — if that
    assertion is ever loosened, swap this for an mtime-based reload (compare
    ``zones.db.stat().st_mtime`` against the cached value on each call) or
    move invalidation to a Redis-backed fan-out.
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/app.py web/routes/rankings.py
uv run ruff check web/app.py web/routes/rankings.py
uv run pyright web/app.py web/routes/rankings.py
uv run pytest tests/web -v -x
```

All clean. The assertion's check uses `WEB_CONCURRENCY` env var (Railway/uvicorn's standard); if unset, default `"1"` means "no-op".

---

## Task 1.10: Mark the 18 hand-rolled `CensusClient(...)` sites with a `# CENSUS-CLIENT-LIFECYCLE` comment (BE-009, BE-010)

**Files:** all 18 sites — see spec for the grep. Examples: `web/routes/character.py:422, 511, 576, 756, 867`, `web/routes/claim.py:100, 235`, `web/routes/parses.py:152, 218, 238`, `web/routes/aa.py:200, 235`, `web/census_refresh.py:67`.

The canonical fix (shared CensusClient lifecycle helper) ships in Phase 2a Task 2a.2; the migration ships in Phase 2c Task 2c.2. This task just marks every site so the Phase 2c grep is trivial — and so a contributor adding a 19th site between now and then knows to use the shared helper instead.

- [ ] **Step 1: Find every CensusClient instantiation**

Run (output not consumed by the next step — used only to confirm count):

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'CensusClient\\(service_id=', '--type=py'])"
```

Expected count: ~18 sites across `web/` + the bot cogs under `bot/cogs/`. The audit excluded the bot cogs from this finding; this task marks both for the same Phase 2c migration.

- [ ] **Step 2: Annotate each web/ site**

For each `client = CensusClient(service_id=_SERVICE_ID)` line, add a one-line marker comment directly above:

```python
# CENSUS-CLIENT-LIFECYCLE: migrate to web.lib.census_lifecycle.shared_census_client (Phase 2c.2)
client = CensusClient(service_id=_SERVICE_ID)
```

Don't change behaviour. The marker is grep-able for the Phase 2c migration.

- [ ] **Step 3: Annotate each bot/cogs/ site**

Same pattern for `bot/cogs/aacheck.py:59`, `bot/cogs/guild.py:76`, `bot/cogs/items.py`, `bot/cogs/spellcheck.py:92`. The bot ships its own shared instance in Phase 2c.

- [ ] **Step 4: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

(Replace `<touched-files>` with the actual list — typically 6–8 files.) All clean. No behaviour change.

---

## Task 1.11: Phase 1 commit checkpoint

After approval, the user stages + commits only the named files.

- [ ] **Step 1: Stage exactly these files**

```
git add web/metrics.py web/routes/auth.py web/routes/guild_officer.py web/routes/notifications.py
git add census/db.py census/spells_db.py census/recipes_db.py
git add web/routes/health.py
git add census/client.py
git add web/db.py tests/web/test_api_tokens.py
git add tests/conftest.py pyproject.toml web/app.py
git add tests/web/test_parses_ingest_hmac.py web/routes/parses.py
git add web/routes/rankings.py
git add tests/census/test_like_escape.py
# Phase 1 Task 1.10 marker comments — list each touched file explicitly:
git add web/routes/character.py web/routes/claim.py web/routes/aa.py web/census_refresh.py
git add bot/cogs/aacheck.py bot/cogs/guild.py bot/cogs/items.py bot/cogs/spellcheck.py
```

- [ ] **Step 2: Confirm staged set is exactly what we expect**

```
git status
git diff --staged --stat
```

If any unrelated file is staged, `git restore --staged <file>` to unstage. Stop and ask the user if anything looks wrong.

- [ ] **Step 3: Commit**

```
git commit -m "Backend cleanliness Phase 1: P0 bugs + drift fixes

- BE-002: hmac.compare_digest for /metrics token
- BE-003/029/100: collapse _ADMIN_IDS to single canonical import
- BE-006: escape %/_ in user-supplied LIKE patterns
- BE-005: cache gear_rating.json at module import
- BE-007: redact SERVICE_ID from Census INFO logs (drop to DEBUG)
- BE-011: coalesce api_tokens.last_used_at writes to 60s buckets
- BE-012/094/095: rename eq2censusbot leftovers (test dir, pyproject name, FastAPI title)
- BE-008: HMAC-vs-middleware regression test
- BE-001: WEB_CONCURRENCY=1 assertion + docstring re LRU process-locality
- BE-009/010: marker comments on the 18 CensusClient sites for Phase 2c migration

Closes Phase 1 of the backend cleanliness audit.

Spec: docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md
Plan: docs/superpowers/plans/2026-05-29-backend-cleanliness.md"
```

Do NOT push. The user pushes after confirming the local commit looks right.

---


# Phase 2a — P1a: shared infrastructure (13 pure additions)

After Phase 2a: every canonical helper the codebase has been hand-rolling exists as one named module under `web/lib/` or as a sibling under `census/`. NOTHING migrates in this phase — pure additions. Phase 2c migrates the call sites.

Sequence rationale: simple modules first (constants, log_safety, cache_keys, validation) → coercion module (it has its own consumers) → CensusClient lifecycle (the centrepiece) → executor + officer-gate + primary-guild + session-user (DB-dependent) → lifespan task tracker (touches app.py).

---

## Task 2a.1: Create `web/lib/` package + `web/constants.py` (BE-101, BE-102)

**Files:**
- Create: `web/lib/__init__.py`
- Create: `web/constants.py`

Magic-number constants live in a single owned module. Phase 2c migrates the call sites to import from here.

- [ ] **Step 1: Create `web/lib/__init__.py`**

```python
"""Shared backend helpers — every module here is pure infrastructure that has
no domain logic. Routes / DB / cache code imports from these; nothing here
imports from a route module (no circular risk).
"""
```

- [ ] **Step 2: Create `web/constants.py`**

```python
"""Named constants for magic numbers scattered across the backend.

Owns: cache TTLs, refresh throttles, mirror/dedup windows, request-list caps,
SQLite parameter-chunk safety limit. Each constant carries a comment naming
the code path it gates so a future contributor can search by intent rather
than by literal value.

Adding a new constant: append here, then `from web.constants import FOO`
at the consumer site. Never re-declare a constant for "local" use — the
audit found three independent `_THROTTLE = 900` / `STALE_S = 900` / `> 900`
literals for the same concept; this module exists to make that mistake
visible.
"""
from __future__ import annotations

# --- Cache TTLs ------------------------------------------------------------

# stale-while-revalidate window for character/guild/aa caches.
# Below this age → return directly; above → return + fire background refresh.
CACHE_STALE_TTL_S: int = 300  # 5 min

# Hard-expiry window — entries older than this are evicted and the next
# request MUST do a sync fetch. Bounds memory growth for never-revisited
# keys (see web/cache.TTLCache.sweep).
CACHE_MAX_AGE_S: int = 3600  # 1 hr


# --- Census refresh orchestration -----------------------------------------

# Per-entity throttle: subsequent refresh attempts before this elapses are
# silently dropped. Stops a hot-cache miss from triggering hundreds of
# in-flight Census calls for the same character. Same value as the
# character-row staleness window so a stale row triggers exactly one refresh.
CENSUS_REFRESH_THROTTLE_S: int = 900  # 15 min

# A character record in census_store is "stale" once last_resolved_at is
# older than this. Surfaced on CharacterResponse.stale so the frontend can
# render a small "may be outdated" badge.
CHARACTER_STALE_S: int = 900  # 15 min


# --- Parses listing + mirroring -------------------------------------------

# Mirror grouping: two uploads are the same fight when their (guild, title)
# match and their start times fall within this window. Faithful to the
# pre-server-side ParsesPage detectMirrors rule.
PARSE_MIRROR_WINDOW_S: int = 60

# Maximum FIGHT cap on /api/parses?limit=... — protects the browser from
# stalling on a multi-thousand-row render rather than the server. The
# inner SQL cap is `limit * PARSE_INNER_CAP_MULTIPLIER` (see below).
PARSE_LIST_MAX_LIMIT: int = 500

# Inner SQL cap multiplier — worst-case 24 mirror uploads per fight, so a
# 500-fight request needs 12_000 raw upload rows; round up to 15_000 for
# headroom. Floor of 2000 covers very small page requests.
PARSE_INNER_CAP_MULTIPLIER: int = 30
PARSE_INNER_CAP_FLOOR: int = 2000

# Admin parses listing cap — looser than the public one (an admin reviewing
# uploads needs a wider view than a casual reader).
ADMIN_PARSE_LIST_MAX_LIMIT: int = 1000


# --- SQLite ---------------------------------------------------------------

# SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999; chunked lookups need
# to stay under this. 900 leaves headroom for the surrounding fixed params
# in the same query.
SQLITE_VAR_CHUNK_SAFE: int = 900


# --- API tokens -----------------------------------------------------------

# Per-token last_used_at coalescing window (BE-011). UPDATE only fires if
# the existing value is older than this — sub-minute precision isn't
# useful to the UI and the write storm during a raid was a real cost.
API_TOKEN_LAST_USED_COALESCE_S: int = 60


# --- Background tasks -----------------------------------------------------

# Cache-sweep loop interval (see web/app.py:_cache_sweep_loop).
CACHE_SWEEP_INTERVAL_S: int = 600  # 10 min
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/lib/__init__.py web/constants.py
uv run ruff check web/lib/__init__.py web/constants.py
uv run pyright web/lib/__init__.py web/constants.py
uv run pytest tests/ -v -x
```

All clean. No call-site migration in this task — Phase 2c switches the consumers.

---

## Task 2a.2: Create `web/lib/log_safety.py` (BE-022)

**Files:** Create `web/lib/log_safety.py`

Consolidates three `_scrub` / `_safe_for_log` variants under one name.

- [ ] **Step 1: Write the module**

```python
"""Strip CR/LF from values before they hit a log line.

Without this, a hostile user-controlled value (a character name, a guild
name, a header value) could inject forged log lines via embedded CR/LF
sequences — CWE-117 log injection. The fix is mechanical: stringify, then
strip the two characters that delimit log records.

Replaces three duplicated variants in census_refresh.py / claim.py / guild.py
(and the inline one in parses.py).
"""
from __future__ import annotations


def scrub(value: object) -> str:
    """Return ``str(value)`` with CR and LF replaced by spaces.

    Use this everywhere a user-supplied value (character name, guild name,
    Authorization header, etc.) is about to be interpolated into a log line.
    A no-op for already-safe values, so the cost of using it defensively is
    negligible.
    """
    return str(value).replace("\r", " ").replace("\n", " ")
```

- [ ] **Step 2: Verify**

```
uv run ruff format web/lib/log_safety.py
uv run ruff check web/lib/log_safety.py
uv run pyright web/lib/log_safety.py
```

All clean.

---

## Task 2a.3: Create `web/lib/cache_keys.py` (BE-023)

**Files:** Create `web/lib/cache_keys.py`

Owns every cache-key shape so a typo on one side of a `=` can't silently miss the cache.

- [ ] **Step 1: Write the module**

```python
"""Canonical cache-key shapes for every TTLCache instance.

Every cache key in the app is shaped ``{kind}:{name.lower()}:{world.lower()}``
(or a variant). The same format string was hand-rolled in 10+ sites; a typo
(dropping ``.lower()`` on one side) silently missed the cache. This module
owns every shape so the typo class is impossible.

Pair each cache instance (web/cache.py) with one key-builder here. If a new
cache flavour is added, add its key-builder here too — never hand-roll a
key in route code.
"""
from __future__ import annotations


def char_cache_key(name: str, world: str) -> str:
    """Key for ``character_cache``. Used by every character read path."""
    return f"{name.lower()}:{world.lower()}"


def aa_cache_key(name: str, world: str) -> str:
    """Key for ``aa_cache``. ``aas:`` prefix distinguishes from char_cache."""
    return f"aas:{name.lower()}:{world.lower()}"


def guild_roster_key(guild: str, world: str) -> str:
    """``guild_cache`` key for the full roster fetch."""
    return f"roster:{guild.lower()}:{world.lower()}"


def guild_info_key(guild: str, world: str) -> str:
    """``guild_cache`` key for the guild summary (name + world + rank list)."""
    return f"info:{guild.lower()}:{world.lower()}"


def guild_adorns_key(guild: str, world: str) -> str:
    """``guild_cache`` key for the adorn-check rollup."""
    return f"adorns:{guild.lower()}:{world.lower()}"


def guild_spells_key(guild: str, world: str) -> str:
    """``guild_cache`` key for the spell-check rollup."""
    return f"spells:{guild.lower()}:{world.lower()}"


def census_refresh_key(name: str, world: str) -> str:
    """Key into ``web/census_refresh.py`` ``_last_attempt`` / ``_in_flight``.
    Same shape as ``char_cache_key`` so the throttle + cache line up."""
    return f"{name.lower()}:{world.lower()}"


def census_refresh_guild_key(guild: str, world: str) -> str:
    """Key into ``_last_attempt`` / ``_in_flight`` for guild refreshes."""
    return f"guild:{guild.lower()}:{world.lower()}"
```

- [ ] **Step 2: Verify**

```
uv run ruff format web/lib/cache_keys.py
uv run ruff check web/lib/cache_keys.py
uv run pyright web/lib/cache_keys.py
```

All clean.

---

## Task 2a.4: Create `web/lib/validation.py` (BE-030)

**Files:** Create `web/lib/validation.py`

Promote `_VALID_CHARACTER_NAME_RE` / `_sanitize_world` / `_validate_guild_name` to one shared module so the GET endpoints validate input the same way the ingest endpoint does.

- [ ] **Step 1: Write the module**

```python
"""Conservative input validators for the public API surface.

EQ2 has well-defined shapes for character names, guild names, and server
names. Validating against the real shape on the way in is defence in depth:
- Keeps obvious injection shapes (paths, ``:``, control chars) out of
  Census API URLs.
- Stops a hostile name with ``:`` from colliding with cache keys (the keys
  are shaped ``name.lower():world.lower()`` throughout the app — a name
  containing ``:`` could read or poison another player's cache entry).
- Makes invalid input fail loudly at the route layer rather than producing
  a 502 from a downstream Census error.

Originally lived inline in web/routes/parses.py:84-107 — promoted here so
every route applies the same rules, not just the ingest endpoint.
"""
from __future__ import annotations

import re

# EQ2 character names are letters only, max 15 chars. Daybreak's naming rules.
CHARACTER_NAME_RE = re.compile(r"^[A-Za-z]{1,15}$")

# EQ2 server names: letters, digits, spaces, apostrophes, hyphens, underscores.
# Max 30 chars to match the Pydantic max_length=30 on logger_server.
WORLD_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 '_-]{0,30}$")

# Guild names allow spaces and apostrophes. Looser than character names by
# necessity ("The Spitting Cobras" is a real guild). Max 64 chars matches
# the existing _validate_guild_name in web/routes/guild.py.
GUILD_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 '_-]{0,63}$")


def validate_character_name(name: str | None) -> str | None:
    """Return ``name`` if it matches the EQ2 character-name shape, else None.

    Strips surrounding whitespace before matching. Use as a `if not ...: raise
    HTTPException(400, ...)` gate at the top of every route that takes a
    character name from the URL or query string.
    """
    if not name:
        return None
    candidate = name.strip()
    if not candidate:
        return None
    return candidate if CHARACTER_NAME_RE.match(candidate) else None


def sanitize_world(world: str | None) -> str | None:
    """Return ``world`` if it matches the EQ2 server-name shape, else None.

    Callers typically use the result as ``sanitize_world(w) or DEFAULT_WORLD``
    so a missing or malformed value falls back to the deployment default
    rather than feeding garbage into a Census API URL. Replaces the
    private ``_sanitize_world`` in parses.py."""
    if not world:
        return None
    candidate = world.strip()
    if not candidate:
        return None
    return candidate if WORLD_NAME_RE.match(candidate) else None


def validate_guild_name(name: str | None) -> str | None:
    """Return ``name`` if it matches a plausible EQ2 guild-name shape.

    Looser than character names (spaces, apostrophes allowed). Replaces the
    private ``_validate_guild_name`` in web/routes/guild.py."""
    if not name:
        return None
    candidate = name.strip()
    if not candidate:
        return None
    return candidate if GUILD_NAME_RE.match(candidate) else None
```

- [ ] **Step 2: Add a test**

Create `tests/web/test_validation.py`:

```python
"""Tests for web/lib/validation.py — pinning the regex shapes."""
from __future__ import annotations

import pytest

from web.lib.validation import (
    sanitize_world,
    validate_character_name,
    validate_guild_name,
)


@pytest.mark.parametrize("name", ["Vortex", "Sihtric", "Menludiir"])
def test_character_name_accepts_valid(name: str) -> None:
    assert validate_character_name(name) == name


@pytest.mark.parametrize("name", ["", " ", "X" * 16, "Vor:tex", "Vortex Smith", "Vortex1"])
def test_character_name_rejects_invalid(name: str) -> None:
    assert validate_character_name(name) is None


@pytest.mark.parametrize("world", ["Varsoon", "Wuoshi", "Kaladim", "Test Server"])
def test_world_accepts_valid(world: str) -> None:
    assert sanitize_world(world) == world


@pytest.mark.parametrize("world", ["", " ", "X" * 32, "/etc/passwd", "1Varsoon"])
def test_world_rejects_invalid(world: str) -> None:
    assert sanitize_world(world) is None


@pytest.mark.parametrize("name", ["Exordium", "The Spitting Cobras", "Knights-Templar"])
def test_guild_accepts_valid(name: str) -> None:
    assert validate_guild_name(name) == name


@pytest.mark.parametrize("name", ["", " ", "'BadStart", "X" * 65])
def test_guild_rejects_invalid(name: str) -> None:
    assert validate_guild_name(name) is None
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/lib/validation.py tests/web/test_validation.py
uv run ruff check web/lib/validation.py tests/web/test_validation.py
uv run pyright web/lib/validation.py tests/web/test_validation.py
uv run pytest tests/web/test_validation.py -v -x
```

All clean.

---

## Task 2a.5: Create `census/_coerce.py` (BE-020, BE-092)

**Files:** Create `census/_coerce.py`

Five modules hand-roll `_int(v) -> int | None`. Consolidate. The parses-side variants (`parses/models.py:_to_int`) deliberately return 0 not None — those stay where they are.

- [ ] **Step 1: Write the module**

```python
"""Low-level type-coercion helpers for Census API JSON.

Census returns most fields as strings even when they're numeric (``"42"`` not
``42``). These helpers wrap the ``int()``/``float()``/``str()`` calls + the
``None``-and-error fallbacks the codebase ended up hand-rolling in five
places (census/client.py, census/spells_db.py, census/recipes_db.py,
census/item_parser.py, census/db.py).

The leading underscore in the module name is a soft "don't import this
outside ``census/``" — the parses-side coercers in ``parses/models.py``
deliberately have different semantics (return 0 not None) for downstream
non-null fields and shouldn't migrate here.
"""
from __future__ import annotations


def coerce_int(value: object) -> int | None:
    """Coerce a Census-string-or-int to ``int | None``.

    Returns None for None, empty strings, and anything that doesn't parse
    as an int.
    """
    if value is None:
        return None
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def coerce_float(value: object) -> float | None:
    """Coerce a Census-string-or-number to ``float | None``."""
    if value is None:
        return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def coerce_str(value: object) -> str:
    """Coerce to ``str``, with ``None`` becoming the empty string.

    Useful for downstream string-required fields (display names, etc.)
    where None is semantically equivalent to "missing"."""
    if value is None:
        return ""
    return str(value)


def coerce_str_or_none(value: object) -> str | None:
    """Coerce to ``str | None`` — keeps the missing-vs-empty distinction.

    Strips whitespace and treats whitespace-only values as None too."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None
```

- [ ] **Step 2: Add a test**

Create `tests/census/test_coerce.py`:

```python
"""Tests for census/_coerce.py — pins the None/0/empty-string semantics."""
from __future__ import annotations

import pytest

from census._coerce import coerce_float, coerce_int, coerce_str, coerce_str_or_none


@pytest.mark.parametrize("v,expected", [("42", 42), (42, 42), ("0", 0), (0, 0)])
def test_coerce_int_valid(v: object, expected: int) -> None:
    assert coerce_int(v) == expected


@pytest.mark.parametrize("v", [None, "", "abc", [1], {}])
def test_coerce_int_invalid(v: object) -> None:
    assert coerce_int(v) is None


@pytest.mark.parametrize("v,expected", [("3.14", 3.14), (3.14, 3.14), ("0", 0.0)])
def test_coerce_float_valid(v: object, expected: float) -> None:
    assert coerce_float(v) == expected


@pytest.mark.parametrize("v", [None, "", "abc"])
def test_coerce_float_invalid(v: object) -> None:
    assert coerce_float(v) is None


def test_coerce_str_none_to_empty() -> None:
    assert coerce_str(None) == ""


def test_coerce_str_or_none_whitespace_to_none() -> None:
    assert coerce_str_or_none("   ") is None
    assert coerce_str_or_none("") is None
    assert coerce_str_or_none("foo") == "foo"
    assert coerce_str_or_none(" foo ") == "foo"
```

- [ ] **Step 3: Verify**

```
uv run ruff format census/_coerce.py tests/census/test_coerce.py
uv run ruff check census/_coerce.py tests/census/test_coerce.py
uv run pyright census/_coerce.py tests/census/test_coerce.py
uv run pytest tests/census/test_coerce.py -v -x
```

All clean.

---

## Task 2a.6: Create `web/lib/census_lifecycle.py` (BE-009, BE-010, BE-115)

**Files:** Create `web/lib/census_lifecycle.py`

The centrepiece of Phase 2a. 18 sites hand-roll `CensusClient(...); try: ...; finally: await client.close()` — each spawning a new aiohttp.ClientSession and paying a TLS handshake on every Census call. The fix: a module-level lazy-singleton CensusClient that re-uses one aiohttp session for the process. The bot stays separate (different process, different event loop) and gets its own singleton via Phase 2c.5.

The module exposes BOTH a context-manager flavour (`async with shared_census_client() as c:`) and a flat accessor (`get_shared_census_client()`). The context manager is the preferred call shape for new code; the flat accessor exists so existing `client = CensusClient(...)` sites that just need one method call migrate to a 1-line change (`client = await get_shared_census_client()`) — see Phase 2c.2 for the migration plan.

CRITICAL: the singleton must be tied to the running event loop, not the process. `pytest-asyncio` creates fresh loops per test, and an aiohttp.ClientSession created on a closed loop raises RuntimeError on use. We use `asyncio.get_running_loop()` as the lookup key and rebuild on loop change.

- [ ] **Step 1: Write the module**

```python
"""Process-wide shared CensusClient lifecycle.

Audit BE-010: 18 sites hand-rolled ``CensusClient(...); try: ...; finally:
await client.close()``. Each invocation built a new ``aiohttp.ClientSession``
+ TraceConfig; each Census call paid a TLS handshake. ``aiohttp``'s own
docs warn against this pattern — a long-lived ``ClientSession`` is the
intended shape.

This module owns the singleton + its lifecycle. Two equivalent call shapes:

  async with shared_census_client() as c:
      char = await c.get_character(name, world)

  # Or, for one-line migration of a single `client = CensusClient(...)`:
  client = await get_shared_census_client()
  char = await client.get_character(name, world)
  # NB: do NOT await client.close() — the lifecycle is owned by this module.

The singleton is keyed by the running event loop, because:
  - pytest-asyncio creates a fresh loop per test
  - an aiohttp.ClientSession opened on a closed loop raises RuntimeError on
    next use
So a per-test-loop rebuild is necessary for the tests to stay green. In prod
the loop is created once at startup and never closed mid-process, so the
rebuild path is effectively dead.

Shutdown: the FastAPI lifespan (web/app.py) calls ``aclose_all()`` so the
process exits cleanly without aiohttp's "Unclosed client session" warning.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from census.client import CensusClient
from web.config import SERVICE_ID

_log = logging.getLogger(__name__)

# Loop → CensusClient. dict keyed on id(loop) so a stale (closed) loop
# entry GCs once the loop object itself goes (tests).
_clients: dict[int, CensusClient] = {}


async def get_shared_census_client() -> CensusClient:
    """Return the singleton CensusClient for the current running event loop.

    Creates it lazily on first call. Do NOT close the returned client; its
    lifecycle is owned by this module. The aiohttp session is bound to the
    running event loop — calling this from a different loop returns a
    different singleton (per-loop scoping).
    """
    loop = asyncio.get_running_loop()
    key = id(loop)
    client = _clients.get(key)
    if client is None:
        client = CensusClient(service_id=SERVICE_ID)
        _clients[key] = client
        _log.debug("[census-lifecycle] Created shared CensusClient for loop %d", key)
    return client


@asynccontextmanager
async def shared_census_client() -> AsyncIterator[CensusClient]:
    """Context-manager flavour. Preferred for new code.

    Idiomatically reads as ``async with shared_census_client() as c:`` so
    new contributors don't accidentally write ``await c.close()`` at the
    end — the context manager makes lifecycle ownership explicit (it
    belongs to this module, not the caller).
    """
    yield await get_shared_census_client()


async def aclose_all() -> None:
    """Close every per-loop singleton — called from the FastAPI lifespan
    shutdown handler so the process exits without aiohttp's "Unclosed client
    session" warning. Safe to call multiple times."""
    for key, client in list(_clients.items()):
        try:
            await client.close()
        except Exception as exc:
            _log.warning("[census-lifecycle] Error closing CensusClient for loop %d: %s", key, exc)
        _clients.pop(key, None)


def _reset_for_test() -> None:
    """Clear the singleton map without calling close() — used by tests that
    swap the underlying ``CensusClient`` for a mock. The closed-loop entries
    GC naturally once the test's loop is collected."""
    _clients.clear()
```

- [ ] **Step 2: Add a test**

Create `tests/web/test_census_lifecycle.py`:

```python
"""Tests for the shared CensusClient lifecycle (web/lib/census_lifecycle)."""
from __future__ import annotations

import asyncio

import pytest

from web.lib import census_lifecycle


@pytest.fixture(autouse=True)
def _reset() -> None:
    census_lifecycle._reset_for_test()
    yield
    census_lifecycle._reset_for_test()


@pytest.mark.asyncio
async def test_get_shared_returns_same_instance_within_loop() -> None:
    c1 = await census_lifecycle.get_shared_census_client()
    c2 = await census_lifecycle.get_shared_census_client()
    assert c1 is c2


@pytest.mark.asyncio
async def test_context_manager_yields_shared() -> None:
    flat = await census_lifecycle.get_shared_census_client()
    async with census_lifecycle.shared_census_client() as ctx:
        assert ctx is flat


@pytest.mark.asyncio
async def test_aclose_all_clears_map() -> None:
    await census_lifecycle.get_shared_census_client()
    await census_lifecycle.aclose_all()
    assert census_lifecycle._clients == {}


def test_per_loop_isolation() -> None:
    """Two different event loops get two different singletons. Bound to id(loop)
    so the second loop's call doesn't reuse the first loop's aiohttp session."""

    async def _get() -> int:
        return id(await census_lifecycle.get_shared_census_client())

    loop1 = asyncio.new_event_loop()
    loop2 = asyncio.new_event_loop()
    try:
        c1_id = loop1.run_until_complete(_get())
        c2_id = loop2.run_until_complete(_get())
        assert c1_id != c2_id
    finally:
        loop1.close()
        loop2.close()
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/lib/census_lifecycle.py tests/web/test_census_lifecycle.py
uv run ruff check web/lib/census_lifecycle.py tests/web/test_census_lifecycle.py
uv run pyright web/lib/census_lifecycle.py tests/web/test_census_lifecycle.py
uv run pytest tests/web/test_census_lifecycle.py -v -x
```

All clean.

---

## Task 2a.7: Create `web/lib/executor.py` (BE-024, BE-042)

**Files:** Create `web/lib/executor.py`

55 grep hits for `asyncio.get_event_loop()` across `web/`. Each does the same `loop = asyncio.get_event_loop(); await loop.run_in_executor(None, fn, *args)` ritual. `asyncio.get_event_loop()` is also deprecated in Python 3.12+ outside coroutine contexts; centralising the helper future-proofs the codebase.

- [ ] **Step 1: Write the module**

```python
"""Single canonical wrapper around ``loop.run_in_executor``.

Audit BE-024: 55 grep hits for ``asyncio.get_event_loop()`` across web/,
each followed by ``await loop.run_in_executor(None, fn, *args)``. The
boilerplate was repeated literally — sometimes three times in 15 lines.

This module owns one helper. Phase 2c migrates every site.

Why not just ``asyncio.to_thread``? It accepts only positional args + kwargs
forwarded as kwargs — fine for new code, but the existing call sites
sometimes pass keyword args that would need re-shaping. ``run_sync`` accepts
both, so the migration is mechanical.
"""
from __future__ import annotations

import asyncio
import functools
from collections.abc import Callable
from typing import ParamSpec, TypeVar

_P = ParamSpec("_P")
_T = TypeVar("_T")


async def run_sync(fn: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs) -> _T:
    """Run a synchronous function in the default executor.

    Replaces the ``loop = asyncio.get_running_loop(); await
    loop.run_in_executor(None, fn, *args)`` boilerplate. Both positional and
    keyword arguments are forwarded — kwargs via ``functools.partial`` since
    ``run_in_executor`` only accepts positional args.

    Example:
        result = await run_sync(parses_db.init_db)
        rows = await run_sync(parses_db.list_encounters, world="Varsoon")
    """
    loop = asyncio.get_running_loop()
    if kwargs:
        return await loop.run_in_executor(None, functools.partial(fn, *args, **kwargs))
    return await loop.run_in_executor(None, fn, *args)
```

- [ ] **Step 2: Add a test**

Create `tests/web/test_executor.py`:

```python
"""Tests for web/lib/executor.run_sync."""
from __future__ import annotations

import threading

import pytest

from web.lib.executor import run_sync


def _sync_add(a: int, b: int) -> int:
    return a + b


def _sync_kw(a: int, b: int = 0, c: int = 0) -> int:
    return a + b + c


def _capture_thread() -> int:
    return threading.get_ident()


@pytest.mark.asyncio
async def test_positional() -> None:
    assert await run_sync(_sync_add, 1, 2) == 3


@pytest.mark.asyncio
async def test_keyword() -> None:
    assert await run_sync(_sync_kw, 1, b=2, c=3) == 6


@pytest.mark.asyncio
async def test_runs_off_event_loop_thread() -> None:
    main_tid = threading.get_ident()
    other_tid = await run_sync(_capture_thread)
    assert main_tid != other_tid
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/lib/executor.py tests/web/test_executor.py
uv run ruff check web/lib/executor.py tests/web/test_executor.py
uv run pyright web/lib/executor.py tests/web/test_executor.py
uv run pytest tests/web/test_executor.py -v -x
```

All clean.

---

## Task 2a.8: Create `web/lib/db_helpers.py` (BE-021, BE-112)

**Files:** Create `web/lib/db_helpers.py`

Every local-DB module (`spells_db`, `recipes_db`, `zones_db`, `classes_db`, `census.db`) opens its own `with sqlite3.connect(path) as conn:` block, sets `row_factory = sqlite3.Row`, and short-circuits on `path.exists() == False`. Consolidate the connection lifecycle; the bespoke SQL stays per-module. Also: `zones_db.py` has 25 public functions with `if not path.exists(): return [] / None` boilerplate (BE-112) — the decorator helper here covers that pattern too.

The helper module ALSO carries `like_escape` (Task 1.3's per-module helpers consolidate here).

- [ ] **Step 1: Write the module**

```python
"""Shared SQLite read-helpers for the local catalogue databases.

Every `census/*_db.py` module repeats the same opening dance: check
``path.exists()``, open with ``sqlite3.connect``, set ``row_factory =
sqlite3.Row``, close on exit. The fallback for missing DB is also
identical — either return None (find_by_*) or empty list (list_*).

This module owns the connection lifecycle + the missing-DB fallback as a
decorator. The bespoke SQL stays per-module — only the boilerplate moves.
"""
from __future__ import annotations

import sqlite3
from collections.abc import Callable
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from typing import Any, ParamSpec, TypeVar

_P = ParamSpec("_P")
_T = TypeVar("_T")


@contextmanager
def read_only_conn(path: Path):
    """Open a read-only SQLite connection with ``sqlite3.Row`` factory.

    Uses URI mode ``file:<path>?mode=ro`` so the connection can't accidentally
    write — useful for the metrics scraper and the rankings query path
    where any write would be a bug. Caller must check ``path.exists()``
    first; opening a ro connection to a non-existent file raises
    ``sqlite3.OperationalError("unable to open database file")``.
    """
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def fallback_if_missing(
    path_attr: str,
    default: Any,
) -> Callable[[Callable[_P, _T]], Callable[_P, _T | Any]]:
    """Decorator: short-circuit a sync DB helper with ``default`` when the DB
    file is missing.

    ``path_attr``: module attribute name (e.g. ``"DB_PATH"``) used to resolve
    the file location on each call. Looked up on the decorated function's
    defining module, so the helper picks up env-var-driven re-paths during
    tests without rebinding.

    Usage::

        @fallback_if_missing("DB_PATH", [])
        def list_xxx(...) -> list[dict]:
            with read_only_conn(DB_PATH) as conn:
                ...
    """
    def _decorator(fn: Callable[_P, _T]) -> Callable[_P, _T | Any]:
        @wraps(fn)
        def _wrapper(*args: _P.args, **kwargs: _P.kwargs):
            module = __import__(fn.__module__, fromlist=[path_attr])
            path = getattr(module, path_attr)
            if not path.exists():
                return default
            return fn(*args, **kwargs)
        return _wrapper
    return _decorator


def like_escape(s: str) -> str:
    """Escape SQLite ``LIKE`` wildcards so a user-supplied search string can't
    silently broaden the match (``%``) or force a table scan (``_``).

    The matching SQL must use ``ESCAPE '\\'`` for these escapes to take
    effect. Consolidates the per-module ``_like_escape`` helpers added in
    Phase 1 Task 1.3.
    """
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
```

- [ ] **Step 2: Add a test**

Create `tests/web/test_db_helpers.py`:

```python
"""Tests for web/lib/db_helpers — connection lifecycle + LIKE escape."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from web.lib.db_helpers import like_escape, read_only_conn


def test_like_escape_handles_wildcards() -> None:
    assert like_escape("foo%bar") == "foo\\%bar"
    assert like_escape("foo_bar") == "foo\\_bar"
    assert like_escape("foo\\bar") == "foo\\\\bar"
    assert like_escape("plain") == "plain"


def test_read_only_conn_returns_row_factory(tmp_path: Path) -> None:
    db = tmp_path / "test.db"
    # Seed the DB first via a writable connection.
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE foo (id INTEGER, name TEXT)")
        conn.execute("INSERT INTO foo VALUES (1, 'bar')")
        conn.commit()

    with read_only_conn(db) as ro:
        row = ro.execute("SELECT * FROM foo").fetchone()
        assert row["id"] == 1
        assert row["name"] == "bar"


def test_read_only_conn_blocks_writes(tmp_path: Path) -> None:
    db = tmp_path / "test.db"
    with sqlite3.connect(db) as conn:
        conn.execute("CREATE TABLE foo (id INTEGER)")
        conn.commit()

    with read_only_conn(db) as ro:
        with pytest.raises(sqlite3.OperationalError):
            ro.execute("INSERT INTO foo VALUES (1)")
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/lib/db_helpers.py tests/web/test_db_helpers.py
uv run ruff check web/lib/db_helpers.py tests/web/test_db_helpers.py
uv run pyright web/lib/db_helpers.py tests/web/test_db_helpers.py
uv run pytest tests/web/test_db_helpers.py -v -x
```

All clean.

---

## Task 2a.9: Create `web/lib/session_user.py` (BE-091)

**Files:** Create `web/lib/session_user.py`

`user: dict` is the standard return shape from `require_user_session` / `require_user_session_or_token` — but a `dict` opens the door to `user["id"]` typos. Define a TypedDict so route handlers can annotate `user: SessionUser` and get pyright assistance.

- [ ] **Step 1: Write the module**

```python
"""Typed shape for the session-user dict returned by web/auth_deps.

The two auth-dep flavours produce slightly different dicts:

  * ``require_user_session`` — session cookie only. Shape: {id, username,
    discord_name, avatar, ...}. Anything else is what Discord OAuth stashed
    at login.
  * ``require_user_session_or_token`` — either session OR an
    Authorization: Bearer header. Adds ``auth_source`` ("session"|"token"),
    and on the token path also ``token_id`` + ``token_name``.

Routes that take a ``user: dict`` parameter (30+ of them in the audit)
should annotate with ``SessionUser`` so pyright catches a ``user["i"]``
typo at type-check time. Phase 2c.6 migrates the annotations.
"""
from __future__ import annotations

from typing import Literal, TypedDict


class SessionUser(TypedDict, total=False):
    """Session-derived user shape. ``id`` is the only required field; the
    others are populated from the Discord OAuth profile and may be missing
    on legacy sessions or session-replays from third-party admin tools.

    All fields strings except where noted. ``id`` is the Discord snowflake.
    """

    id: str
    username: str
    discord_name: str
    discord_username: str | None
    avatar: str | None


class TokenUser(SessionUser, total=False):
    """Extended shape returned by ``require_user_session_or_token`` when the
    request authenticated via a bearer token rather than a session cookie.

    The ``auth_source`` literal lets handlers gate behaviour (e.g. forbid
    destructive operations on token auth, or attribute uploads via
    ``token_name``)."""

    auth_source: Literal["session", "token"]
    token_id: int
    token_name: str | None
```

- [ ] **Step 2: Verify**

```
uv run ruff format web/lib/session_user.py
uv run ruff check web/lib/session_user.py
uv run pyright web/lib/session_user.py
```

All clean. No call-site migration in this task.

---

## Task 2a.10: Create `web/lib/primary_guild.py` (BE-026, BE-031)

**Files:** Create `web/lib/primary_guild.py`

`_resolve_primary_guild` is duplicated in `zones.py` and `raid_strategies.py`. The shared cheap path (active-claims fetch + primary filter + character_cache lookup) goes here; per-call-site extensions stay in the call site.

Also includes the `get_primary_claim` helper for BE-031 (3 sites repeat the `next((c for c in claims["approved"] if c.get("is_primary")), None)` pattern).

- [ ] **Step 1: Write the module**

```python
"""Shared primary-character + primary-guild resolution.

Audit BE-026 + BE-031: two route modules (zones, raid_strategies) and one
more (item_watch) hand-roll the same "find the user's primary approved
character + read its guild from character_cache" flow. Extracted here.

Call sites that need extra fallback logic (e.g. zones.py falls back to
the most-recent parsed guild) apply that fallback after the helper returns.
"""
from __future__ import annotations

from typing import Any

from web.cache import character_cache
from web.db import get_active_claims
from web.lib.cache_keys import char_cache_key


def get_primary_claim(claims_payload: dict) -> dict[str, Any] | None:
    """Return the ``is_primary=True`` row from a ``get_active_claims`` payload.

    Replaces three independent ``next((c for c in claims["approved"] if
    c.get("is_primary")), None)`` comprehensions. The payload shape comes
    from ``web/db.get_active_claims`` which returns a dict with an
    ``approved`` list."""
    for claim in claims_payload.get("approved") or []:
        if claim.get("is_primary"):
            return claim
    return None


async def cached_primary_guild(
    discord_id: str,
    world: str,
) -> tuple[str | None, str | None]:
    """Return (primary_character_name, guild_name) for ``discord_id``.

    Cheap path: get_active_claims → primary claim → character_cache lookup
    → guild_name from cached row. Both members of the returned tuple may be
    None (no primary claim, or primary character not in cache).

    Callers that need a fallback (e.g. "most recent parsed guild") apply
    it themselves after this returns ``(_, None)`` — see web/routes/zones.py
    for the canonical pattern.
    """
    claims = await get_active_claims(discord_id, world=world)
    primary = get_primary_claim(claims)
    if primary is None:
        return None, None
    char_name = primary.get("character_name")
    if not char_name:
        return None, None
    cached, _ = character_cache.get_stale(char_cache_key(char_name, world))
    if cached is None:
        return char_name, None
    return char_name, getattr(cached, "guild_name", None) or None
```

- [ ] **Step 2: Verify**

```
uv run ruff format web/lib/primary_guild.py
uv run ruff check web/lib/primary_guild.py
uv run pyright web/lib/primary_guild.py
uv run pytest tests/web -v -x
```

All clean. Migration happens in Phase 2c.7.

---

## Task 2a.11: Create `web/lib/officer_gate.py` (BE-027)

**Files:** Create `web/lib/officer_gate.py`

Three different patterns for officer auth-checking. The hand-rolled `_officer_chars(user["id"], guild_name)` + raise-403-if-empty is repeated 6+ times in `item_watch.py` and `guild_officer.py`. Centralise as a single helper.

We deliberately don't make this a FastAPI `Depends(...)` factory — the guild name comes from a path param + the user from session in different shapes per route, so a regular `await require_officer_of(user, guild_name)` call inline at the top of each handler is cleaner than a Depends-able.

- [ ] **Step 1: Write the module**

```python
"""Per-guild officer gate.

Audit BE-027: 6+ sites in item_watch.py / guild_officer.py duplicate this
shape::

    user = require_user_session(request)
    if not await _officer_chars(user["id"], guild_name):
        raise HTTPException(403, "Not an officer of that guild")

The `_officer_chars` lookup itself stays in web/routes/guild.py — it's the
only place that knows the rank-list logic. This helper wraps the gate.

NOT a FastAPI Depends factory: the guild name typically comes from a path
parameter (`/guild/{guild_name}/...`) so a route-level Depends would need
a closure per-route to capture the name. An inline ``await
require_officer_of(user, guild_name)`` is cleaner.
"""
from __future__ import annotations

from fastapi import HTTPException


async def require_officer_of(user: dict, guild_name: str) -> list[str]:
    """Raise 403 if ``user`` is not an officer of ``guild_name``.

    Returns the list of officer-rank characters the user holds in that guild
    (always non-empty on the success path) so the caller can use them for
    further logic (e.g. picking the lead officer for audit-log attribution).

    The ``_officer_chars`` lookup is imported lazily to dodge the
    routes→lib circular dependency.
    """
    # Lazy import: web/routes/guild.py imports from web/lib indirectly via
    # other helpers, so importing it at module load creates a cycle.
    from web.routes.guild import _officer_chars

    chars = await _officer_chars(user["id"], guild_name)
    if not chars:
        raise HTTPException(
            status_code=403,
            detail=f"You are not an officer of {guild_name!r}.",
        )
    return chars
```

- [ ] **Step 2: Verify**

```
uv run ruff format web/lib/officer_gate.py
uv run ruff check web/lib/officer_gate.py
uv run pyright web/lib/officer_gate.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 2a.12: Create `web/lib/silent_swallow.py` (BE-080 cross-cutting)

**Files:** Create `web/lib/silent_swallow.py`

22 `except Exception: pass` sites in the audit. Some are intentional (metrics increments, cache writes); others are real bugs (BE-080's `_load_tree_index`, BE-083). A context manager that DOCUMENTS intent — and logs at DEBUG so a real failure isn't completely invisible — lets Phase 2c migrate the intentional-swallow sites and turns the bug-shaped sites into bugs we can fix.

- [ ] **Step 1: Write the module**

```python
"""Intent-marking context manager for "swallow + keep going" exception paths.

Audit BE-080: 22 ``except Exception: pass`` sites. About half are intentional
(metrics increments / cache-write best-effort), half are bugs hiding behind
the silent swallow (a malformed JSON in data/AAs/trees silently disappears
from the index; a Pydantic error in _overview_to_char_response silently drops
a guild member from the cache).

The fix is two-step:
  1. Phase 2a (this task): create a ``swallow(category)`` context manager so
     the intentional sites have a named, log-emitting alternative.
  2. Phase 2c.4: walk every existing ``except Exception: pass`` site, decide
     whether it's intentional or bug-shaped, refactor accordingly.

Even the "intentional" sites benefit — a real failure inside a metric-
increment block today is completely invisible. ``swallow`` logs at DEBUG so
``LOG_LEVEL=DEBUG`` surfaces it on demand.
"""
from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager

_log = logging.getLogger(__name__)


@contextmanager
def swallow(category: str, *, level: int = logging.DEBUG) -> Iterator[None]:
    """Context manager that swallows ``Exception`` and logs at ``level``.

    ``category`` is a short string (e.g. ``"metrics"``, ``"cache-write"``)
    that identifies the intent of the swallow — surfaces in the log message
    so a contributor grepping for the failure has a fighting chance.

    Use only where the work is genuinely best-effort (metrics increments,
    cache writes, opportunistic enrichment). For real "the caller might not
    care but we should still know" sites, log at WARNING via a regular
    ``try/except Exception as exc: _log.warning(...)`` block instead.

    Example::

        with swallow("metrics"):
            CACHE_HITS.labels(cache="character").inc()
    """
    try:
        yield
    except Exception as exc:  # noqa: BLE001 — this IS the catch-all helper
        _log.log(level, "[swallow:%s] %s: %r", category, type(exc).__name__, exc)
```

- [ ] **Step 2: Verify**

```
uv run ruff format web/lib/silent_swallow.py
uv run ruff check web/lib/silent_swallow.py
uv run pyright web/lib/silent_swallow.py
```

All clean.

---

## Task 2a.13: Lifespan task tracker for the three background tasks (BE-045)

**Files:** `web/app.py:240-260`

Three untracked background tasks (`prewarm_character_cache`, `_cache_sweep_loop`, `census_health.poll_loop`) are the documented cause of dev-server hangs (memory note: "Backend `--reload` hangs on untracked bg tasks"). The proper fix is a FastAPI `lifespan` context manager that tracks the handles and cancels them on shutdown. Also: hook in the CensusClient `aclose_all` so prod exits cleanly.

- [ ] **Step 1: Read the existing startup block**

Confirm the current shape in `web/app.py`:

```python
def create_app(session_secret: str | None = None) -> FastAPI:
    def _startup() -> None:
        ...
        users_db.init_db()
        server_context.load_registry()
        from parses import db as parses_db
        parses_db.init_db()
        t = threading.Thread(target=_ensure_item_stats, daemon=True, name="item-stats-backfill")
        t.start()

    async def _prewarm() -> None:
        import asyncio as _asyncio
        _asyncio.create_task(prewarm_character_cache())
        _asyncio.create_task(_cache_sweep_loop())
        from web import census_health
        _asyncio.create_task(census_health.poll_loop())

    async def _cache_sweep_loop() -> None:
        import asyncio as _asyncio
        while True:
            await _asyncio.sleep(600)
            for cache in (character_cache, guild_cache, claim_cache, aa_cache):
                cache.sweep()
    # ...
    app = FastAPI(
        on_startup=[_startup, _prewarm, _init_metrics],
        ...
    )
```

- [ ] **Step 2: Convert to a lifespan context manager**

Replace the three startup hooks with a single `lifespan` async context manager:

```python
import asyncio
import contextlib
import threading
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from web.constants import CACHE_SWEEP_INTERVAL_S
from web.lib import census_lifecycle


def create_app(session_secret: str | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        # ---- startup (sync) ----
        # Process-locality assertion + DB schemas + item-stats backfill —
        # same shape as the pre-lifespan _startup.
        _workers = int(os.getenv("WEB_CONCURRENCY", "1"))
        if _workers != 1:
            raise RuntimeError(
                f"WEB_CONCURRENCY={_workers} is incompatible with the in-process "
                f"SSE pub/sub (web/census_events.py) and _cached_zones_data LRU "
                f"(web/routes/rankings.py). Set WEB_CONCURRENCY=1 or rewrite "
                f"both layers to use a cross-process backplane before scaling."
            )
        users_db.init_db()
        server_context.load_registry()
        from parses import db as parses_db
        parses_db.init_db()
        threading.Thread(target=_ensure_item_stats, daemon=True, name="item-stats-backfill").start()
        _register_db_collector()
        APP_INFO.info({"world": _WORLD, "version": "0.1.0"})

        # ---- async background tasks (tracked so shutdown can cancel) ----
        from web import census_health
        tasks: list[asyncio.Task] = [
            asyncio.create_task(prewarm_character_cache(), name="prewarm-character-cache"),
            asyncio.create_task(_cache_sweep_loop(), name="cache-sweep-loop"),
            asyncio.create_task(census_health.poll_loop(), name="census-health-poll"),
        ]

        try:
            yield
        finally:
            # ---- shutdown ----
            for task in tasks:
                task.cancel()
            # Collect cancellation acknowledgements; swallow CancelledError
            # because that's exactly what we asked for.
            await asyncio.gather(*tasks, return_exceptions=True)
            # Close the shared aiohttp session(s) so the process exits
            # without aiohttp's "Unclosed client session" warning.
            await census_lifecycle.aclose_all()

    async def _cache_sweep_loop() -> None:
        # CancelledError propagates out of asyncio.sleep — letting it bubble
        # gives the lifespan cleanup deterministic shutdown. No try/except
        # around the sleep.
        while True:
            await asyncio.sleep(CACHE_SWEEP_INTERVAL_S)
            for cache in (character_cache, guild_cache, claim_cache, aa_cache):
                cache.sweep()

    app = FastAPI(
        lifespan=lifespan,
        title="EQ2 Lexicon",
        version="0.1.0",
        docs_url="/api/docs" if _SHOW_DOCS else None,
        redoc_url="/api/redoc" if _SHOW_DOCS else None,
        openapi_url="/api/openapi.json" if _SHOW_DOCS else None,
    )
    # ... rest of create_app (middleware, routers) unchanged ...
```

Delete the standalone `_startup`, `_prewarm`, `_init_metrics` inner functions — their content has all moved into `lifespan`.

Update `census_health.poll_loop` if it uses `try/except` around its sleep — `CancelledError` MUST propagate so the lifespan cleanup is deterministic. (Read it; if the existing loop already lets cancellation bubble, no change. If it swallows, add a `except asyncio.CancelledError: raise` re-raise.)

- [ ] **Step 3: Add a test pinning shutdown**

In `tests/web/test_app_lifespan.py`:

```python
"""Tests for the lifespan context manager — pins task cancellation on shutdown.

Without this, the three background tasks (prewarm, cache-sweep, census-health-
poll) hang the dev server on Ctrl-C / --reload (see memory note
'backend-reload-hangs-untracked-bg-tasks.md').
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from web.app import create_app


def test_lifespan_starts_and_stops_cleanly() -> None:
    """Entering and exiting the TestClient drives the lifespan startup +
    shutdown. If a background task hangs on shutdown, this test times out."""
    app = create_app(session_secret="x" * 32)
    with TestClient(app) as client:
        # One request just to confirm startup completed and routes are wired.
        res = client.get("/api/health")
        assert res.status_code == 200
    # Exiting the `with` block triggers shutdown — if a task hangs, pytest
    # times out per pytest.ini configuration.
```

- [ ] **Step 4: Verify**

```
uv run ruff format web/app.py tests/web/test_app_lifespan.py
uv run ruff check web/app.py tests/web/test_app_lifespan.py
uv run pyright web/app.py
uv run pytest tests/web -v -x
```

All clean. Particular attention to:
- Any test that called `app.router.startup()` directly (it would need to use TestClient instead).
- Any test that relied on the old `on_startup=[…]` API (it should still work via TestClient — the lifespan replaces both `on_startup` and `on_shutdown`).
- The `dev_backend.ps1` `--timeout-graceful-shutdown 2` workaround can be removed in Phase 3 (BE-045 polish), once we've confirmed the lifespan fix works in dev.

---

## Task 2a.14: Phase 2a commit checkpoint

After approval, the user stages + commits only the named files.

- [ ] **Step 1: Stage exactly these files**

```
git add web/lib/__init__.py web/constants.py
git add web/lib/log_safety.py
git add web/lib/cache_keys.py
git add web/lib/validation.py tests/web/test_validation.py
git add census/_coerce.py tests/census/test_coerce.py
git add web/lib/census_lifecycle.py tests/web/test_census_lifecycle.py
git add web/lib/executor.py tests/web/test_executor.py
git add web/lib/db_helpers.py tests/web/test_db_helpers.py
git add web/lib/session_user.py
git add web/lib/primary_guild.py
git add web/lib/officer_gate.py
git add web/lib/silent_swallow.py
git add web/app.py tests/web/test_app_lifespan.py
```

- [ ] **Step 2: Confirm staged set**

```
git status
git diff --staged --stat
```

If anything unrelated is staged, `git restore --staged <file>`.

- [ ] **Step 3: Commit**

```
git commit -m "Backend cleanliness Phase 2a: shared infrastructure

Pure-addition phase. No call-site migrations (those land in Phase 2c).

New modules under web/lib/:
- log_safety.scrub  (BE-022)
- cache_keys.{char,aa,guild_*}_key  (BE-023)
- validation.{validate_character_name,sanitize_world,validate_guild_name}  (BE-030)
- census_lifecycle.{get_shared_census_client,shared_census_client,aclose_all}  (BE-009/010/115)
- executor.run_sync  (BE-024)
- db_helpers.{read_only_conn,fallback_if_missing,like_escape}  (BE-021/112)
- session_user.{SessionUser,TokenUser}  (BE-091)
- primary_guild.{get_primary_claim,cached_primary_guild}  (BE-026/031)
- officer_gate.require_officer_of  (BE-027)
- silent_swallow.swallow  (BE-080 cross-cutting)

New modules at top level:
- web/constants.py — magic-number constants module  (BE-101/102)
- census/_coerce.py — coerce_int/float/str  (BE-020/092)

web/app.py: convert on_startup hooks to a single FastAPI lifespan ctx
manager that tracks the 3 background tasks + cancels them on shutdown
(BE-045). Also closes web/lib/census_lifecycle shared sessions on exit.

Spec: docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md
Plan: docs/superpowers/plans/2026-05-29-backend-cleanliness.md"
```

Do NOT push. The user reviews + pushes.

---

# Phase 2c — P1c: migrate to the canonical helpers (mechanical, file-spanning)

After Phase 2c: every hand-rolled pattern from Phase 1's audit is gone — `run_in_executor` → `run_sync`, `CensusClient(...)` → `shared_census_client()`, `_int`/`_str` → `census._coerce`, three `scrub` variants → one `web.lib.log_safety.scrub`, the AA endpoint serves from census_store, every `except Exception: pass` is either explicitly intentional (via `swallow("category")`) or refactored to log at WARNING, the duplicated `_resolve_primary_guild` becomes one helper, and the duplicated `_require_admin` is gone.

Phase 2c is **mechanical** — bundled by HELPER, not by file. A single migration sweep across N files lands together so the diff per task is one pattern × N call sites. This is how the frontend audit's Phase 2c was structured.

Sequence rationale: simpler migrations first (validation, log_safety, cache_keys → broadest reach, lowest risk) → coercion (touches census/ only) → executor (55 sites; pure refactor) → CensusClient lifecycle (changes lifecycle semantics; needs the most testing) → AA endpoint census_store integration (BE-041; net-new code path) → except-Exception audit (22 sites; intent decisions needed) → primary-guild dedup + require_admin dedup (small but file-spanning).

---

## Task 2c.1: Migrate every `loop.run_in_executor(None, fn, …)` to `run_sync(fn, …)` (BE-024, BE-042)

**Files:** every file with `asyncio.get_event_loop()` — confirmed ~55 sites. The audit cites:
- `web/routes/parses/list.py` + `ingest.py` + `delete.py` (post-2b split)
- `web/routes/recipes.py`
- `web/routes/zones.py`
- `web/routes/zones_admin.py`
- `web/routes/raid_strategies.py`
- `web/routes/admin.py`
- `web/routes/act_triggers.py`
- `web/routes/character/views.py` + others as found by grep

- [ ] **Step 1: Confirm the call-site list via grep**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'asyncio\\.get_event_loop\\(\\)', '--type=py', 'web/'])"
```

Save the output. Expected ~55 hits.

- [ ] **Step 2: Per-file migration**

For each match, replace the boilerplate:

Before:
```python
loop = asyncio.get_event_loop()
result = await loop.run_in_executor(None, fn, arg1, arg2)
```

After:
```python
from web.lib.executor import run_sync

result = await run_sync(fn, arg1, arg2)
```

For sites with kwargs:

Before:
```python
loop = asyncio.get_event_loop()
result = await loop.run_in_executor(None, functools.partial(fn, arg1, kw=val))
```

After:
```python
result = await run_sync(fn, arg1, kw=val)
```

For sites that use `loop` for ONLY this one purpose, delete the `loop = asyncio.get_event_loop()` line too. For sites that use `loop` for something else (asyncio.create_task / asyncio.run_coroutine_threadsafe), keep `loop` — those aren't covered by `run_sync`.

Where the file has multiple consecutive `await loop.run_in_executor(None, …)` calls (`raid_strategies.py:406, 447, 488, 562, 595, 635` per BE-042), drop the shared `loop = …` line and use `run_sync` per call — the helper resolves the loop itself.

Remove now-unused `import asyncio` if no other asyncio reference remains in the file. Pyright will flag unused imports.

- [ ] **Step 3: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/web tests/parses -v -x
```

All clean. Spot-check via `rg "asyncio\\.get_event_loop\\(\\)" --type=py web/` — should print 0 hits (or only intentional ones for asyncio.create_task / asyncio.run_coroutine_threadsafe usage).

---

## Task 2c.2: Migrate every `CensusClient(service_id=…)` to `shared_census_client()` (BE-009, BE-010)

**Files:** every site marked with `# CENSUS-CLIENT-LIFECYCLE` from Phase 1 Task 1.10. Expected ~18 web sites + 4 bot cog sites (the bot is Task 2c.5).

This is the highest-perf-impact single change in the plan. Each migration removes a TLS handshake per Census call.

- [ ] **Step 1: Find every marker comment**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'CENSUS-CLIENT-LIFECYCLE', '--type=py', 'web/'])"
```

- [ ] **Step 2: Migrate each web site**

For each marked instantiation:

Before:
```python
# CENSUS-CLIENT-LIFECYCLE: migrate to web.lib.census_lifecycle.shared_census_client (Phase 2c.2)
client = CensusClient(service_id=_SERVICE_ID)
try:
    char = await client.get_character(name, current_world())
finally:
    await client.close()
```

After:
```python
from web.lib.census_lifecycle import shared_census_client

async with shared_census_client() as client:
    char = await client.get_character(name, current_world())
```

For sites with a `try/except/finally` that catches `Exception`, preserve the except path:

Before:
```python
# CENSUS-CLIENT-LIFECYCLE: ...
client = CensusClient(service_id=_SERVICE_ID)
try:
    char = await client.get_character(name, current_world())
except Exception as exc:
    _log.warning("Census fetch failed for %r: %s", name, exc)
    char = None
finally:
    await client.close()
```

After:
```python
async with shared_census_client() as client:
    try:
        char = await client.get_character(name, current_world())
    except Exception as exc:
        _log.warning("Census fetch failed for %r: %s", name, exc)
        char = None
```

For sites where the client is needed across multiple calls (e.g. `_resolve_combatant_snapshots` in `web/routes/parses/ingest.py` which sometimes constructs `client` lazily inside a loop), the migration is even cleaner — pull the `async with` to the OUTER scope and drop the inner lazy `if client is None: client = CensusClient(...)` checks. Be careful: only do this if the surrounding logic still makes sense (no early returns mid-loop that would skip the close — context manager handles it).

- [ ] **Step 3: Remove the marker comments**

After every web site is migrated, run:

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'CENSUS-CLIENT-LIFECYCLE', '--type=py', 'web/'])"
```

Should print 0 hits. If any marker remains, that's a site you missed.

- [ ] **Step 4: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/web -v -x
```

All clean. The HMAC regression test from Phase 1 (`test_parses_ingest_hmac.py`) still passes — that pinned behaviour is unchanged.

Pay particular attention to ingest path tests under `tests/web/test_parses_ingest.py` — the lifetime change is the trickiest semantic shift in the whole plan.

---

## Task 2c.3: Migrate `_int` / `_str` / `_float` to `census._coerce` (BE-020, BE-092)

**Files:**
- `census/client.py:1002, 1011` — local `_int`/`_str` helpers; delete after migration.
- `census/spells_db.py:156-179` — local `_int` helper; delete.
- `census/recipes_db.py:184` — local `_int` helper; delete.
- `census/item_parser.py:31, 40` — local `_int`/`_str` helpers; delete (per the file's own self-deprecating comment "Low-level helpers (duplicated from client.py to avoid circular import)").
- `census/db.py:408, 416, 425` — the `_int_field`/`_int_field_zero`/`_str_field` variants STAY (specialised semantics, per audit).

The parses-side `_to_int` / `_to_float` / `_to_str_or_none` in `parses/models.py` deliberately return 0/None differently — they STAY put. Confirm with grep that no `census/*` file is importing from `parses/models.py`.

- [ ] **Step 1: Migrate `census/client.py`**

Find at lines ~1002, 1011:
```python
def _int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _str(value: Any) -> str:
    ...
```

Delete both. At the top of the file, add:

```python
from census._coerce import coerce_int as _int, coerce_str as _str
```

Existing call sites (`_int(spell.get("level"))`) keep working — the names are preserved via the alias.

- [ ] **Step 2: Migrate `census/spells_db.py`**

Find the local `_int` at line ~163. Delete it. Add:

```python
from census._coerce import coerce_int as _int
```

If `_str` / `_float` helpers also exist locally, migrate them the same way.

- [ ] **Step 3: Migrate `census/recipes_db.py`**

Same pattern. Delete local helper, import the canonical name with the existing alias.

- [ ] **Step 4: Migrate `census/item_parser.py`**

Per the file's docstring, the helpers were duplicated only to dodge a circular import with `client.py`. The new `census._coerce` module has no dependency on `client.py`, so the cycle is gone — drop the local duplicates and import.

- [ ] **Step 5: Verify**

```
uv run ruff format census/client.py census/spells_db.py census/recipes_db.py census/item_parser.py
uv run ruff check census/client.py census/spells_db.py census/recipes_db.py census/item_parser.py
uv run pyright census/
uv run pytest tests/census tests/web tests/parses -v -x
```

All clean.

---

## Task 2c.4: Migrate scrub variants to `web.lib.log_safety.scrub` (BE-022)

**Files:**
- `web/census_refresh.py:23-26` — local `_scrub`; delete.
- `web/routes/claim.py:133-140` — local `_safe_for_log`; delete (rename callers).
- `web/routes/guild.py:44-47` — local `_scrub`; delete.
- `web/routes/parses/ingest.py` — inline `.replace("\r"," ").replace("\n"," ")`; replace with `scrub(...)`.

- [ ] **Step 1: For each file, delete the local helper + add the import**

Before (in each file):
```python
def _scrub(value: object) -> str:
    return str(value).replace("\r", " ").replace("\n", " ")
```

After:
```python
from web.lib.log_safety import scrub as _scrub
```

(Aliasing to `_scrub` preserves existing call sites without rewriting them. For `claim.py` which uses `_safe_for_log`, alias to that name instead: `from web.lib.log_safety import scrub as _safe_for_log`.)

- [ ] **Step 2: Inline string-replace sites**

Grep for `.replace("\r", " ").replace("\n", " ")` and replace each with `scrub(value)` (import as needed):

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'replace.*\\\\r.*replace.*\\\\n', '--type=py'])"
```

- [ ] **Step 3: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/web -v -x
```

All clean.

---

## Task 2c.5: Migrate the bot cogs to a shared CensusClient (BE-115)

**Files:** `bot/bot.py`, `bot/cogs/items.py`, `bot/cogs/guild.py`, `bot/cogs/spellcheck.py`, `bot/cogs/aacheck.py`.

The bot is a separate process from the web app, so it gets its own shared singleton. The clean place to hold it is on the `bot` instance itself: `self.bot.census` populated in `setup_hook`, closed in `close()`.

- [ ] **Step 1: Add the shared client to `bot/bot.py`**

Find the `setup_hook` (or equivalent startup) on the bot instance:

```python
async def setup_hook(self) -> None:
    from census.client import CensusClient
    from census.config import SERVICE_ID

    self.census = CensusClient(service_id=SERVICE_ID)
    # ... existing cog loading ...
```

And in the bot's `close()` (or `on_disconnect`, whichever fires reliably on shutdown):

```python
async def close(self) -> None:
    try:
        await self.census.close()
    finally:
        await super().close()
```

If the bot class doesn't override `close()` today, add the override.

- [ ] **Step 2: Migrate each cog to use `self.bot.census`**

For each cog file:

Before:
```python
# CENSUS-CLIENT-LIFECYCLE: ...
client = CensusClient(service_id=SERVICE_ID)
try:
    item = await client.get_item(query)
finally:
    await client.close()
```

After:
```python
item = await self.bot.census.get_item(query)
```

Drop the now-unused `from census.client import CensusClient` and `from census.config import SERVICE_ID` imports if no other call site needs them.

- [ ] **Step 3: Remove the `# CENSUS-CLIENT-LIFECYCLE` markers**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'CENSUS-CLIENT-LIFECYCLE', '--type=py'])"
```

Should print 0 hits across the whole repo.

- [ ] **Step 4: Verify**

```
uv run ruff format bot/
uv run ruff check bot/
uv run pyright bot/
uv run pytest tests/ -v -x
```

All clean. There may be no bot-cog tests; that's fine — the verification is "ruff/pyright clean + the discord.py bot starts when launched locally". Note in your task report that a manual `uv run python -m bot.bot` smoke test is recommended before push.

---

## Task 2c.6: AA endpoint — integrate census_store (BE-041)

**Files:** `web/routes/aa.py:219-250`

The AA endpoint is the only major character endpoint that does NOT serve from `census_store` on cold cache. Mirror `web/routes/character/views.py:get_character` (the canonical pattern after Phase 2b).

- [ ] **Step 1: Add AA helpers to `census/census_store.py`**

The existing module has `get_character` / `upsert_character` / `get_guild` / `upsert_guild`. Add a parallel pair for AA data:

```python
def get_character_aas(
    conn: sqlite3.Connection, name: str, world: str
) -> dict | None:
    """Return the persisted CharAAsResponse dict (or None) for (name, world).

    Same shape as get_character — the record carries the model_dump() of the
    response + a last_resolved_at unix timestamp."""
    row = conn.execute(
        "SELECT data_json, last_resolved_at FROM character_aas "
        "WHERE name_lower = ? AND world = ?",
        (name.lower(), world),
    ).fetchone()
    if row is None:
        return None
    return {
        "data": json.loads(row["data_json"]),
        "last_resolved_at": row["last_resolved_at"],
    }


def upsert_character_aas(
    conn: sqlite3.Connection,
    name: str,
    world: str,
    data: dict,
    *,
    now: int | None = None,
) -> None:
    """Insert or update the (name, world) AA record. Always overwrites — AAs
    have no 'best-known merge' equivalent because the Census response is
    authoritative."""
    if now is None:
        now = int(time.time())
    conn.execute(
        "INSERT OR REPLACE INTO character_aas (name_lower, world, data_json, last_resolved_at) "
        "VALUES (?, ?, ?, ?)",
        (name.lower(), world, json.dumps(data), now),
    )
    conn.commit()
```

Add the supporting table to the SCHEMA:

```sql
CREATE TABLE IF NOT EXISTS character_aas (
    name_lower         TEXT NOT NULL,
    world              TEXT NOT NULL,
    data_json          TEXT NOT NULL,
    last_resolved_at   INTEGER NOT NULL,
    PRIMARY KEY (name_lower, world)
);
```

Memory [[test-migrations-against-old-db-shape]]: add this CREATE to the SCHEMA only (no migration needed — new table). A test in `tests/web/test_aa_census_store.py` should verify init_db on a pre-existing census_store DB doesn't crash.

- [ ] **Step 2: Update `web/routes/aa.py:get_character_aas` to mirror `character/views.py`**

Before (lines ~219-250):
```python
@router.get("/character/{name}/aas", response_model=CharAAsResponse)
async def get_character_aas(name: str) -> CharAAsResponse:
    cache_key = f"aas:{name.lower()}:{current_world().lower()}"
    cached, is_stale = aa_cache.get_stale(cache_key)
    if cached is not None:
        if is_stale:
            asyncio.create_task(_bg_refresh_aas(name, cache_key))
        return cached

    client = CensusClient(service_id=_SERVICE_ID)
    try:
        char_aas = await client.get_character_aas(name, current_world())
    finally:
        await client.close()
    if char_aas is None:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found")

    result = CharAAsResponse(
        character_name=char_aas.character_name,
        total_spent=sum(aa.tier for aa in char_aas.aa_list),
        trees=_build_trees(char_aas.aa_list),
        profiles=[CharAAProfile(name=prof.name, trees=_build_trees(prof.aa_list)) for prof in char_aas.profiles],
    )
    aa_cache.set(cache_key, result)
    return result
```

After:
```python
@router.get("/character/{name}/aas", response_model=CharAAsResponse)
async def get_character_aas(name: str) -> CharAAsResponse:
    """Serve last-known AA data instantly from census_store; refresh from
    Census only in the background. Mirrors the character read path so AA
    data survives container restarts the same way."""
    from census import census_store
    from web.constants import CHARACTER_STALE_S
    from web.lib.cache_keys import aa_cache_key
    from web.lib.census_lifecycle import shared_census_client
    from web.lib.executor import run_sync

    cache_key = aa_cache_key(name, current_world())
    now = int(time.time())

    # 1) Hot in-memory copy.
    cached, is_stale = aa_cache.get_stale(cache_key)
    if cached is not None and not is_stale:
        return cached

    # 2) Durable store.
    def _read():
        conn = census_store.init_db(census_store.DB_PATH)
        try:
            return census_store.get_character_aas(conn, name, current_world())
        finally:
            conn.close()
    rec = await run_sync(_read)
    if rec is not None:
        stale = (now - rec["last_resolved_at"]) > CHARACTER_STALE_S
        if stale:
            asyncio.create_task(_bg_refresh_aas(name, cache_key))
        resp = CharAAsResponse(**rec["data"])
        aa_cache.set(cache_key, resp)
        return resp

    # 3) Never seen — try one live fetch.
    async with shared_census_client() as client:
        char_aas = await client.get_character_aas(name, current_world())
    if char_aas is None:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found")

    result = CharAAsResponse(
        character_name=char_aas.character_name,
        total_spent=sum(aa.tier for aa in char_aas.aa_list),
        trees=_build_trees(char_aas.aa_list),
        profiles=[CharAAProfile(name=prof.name, trees=_build_trees(prof.aa_list)) for prof in char_aas.profiles],
    )

    # Persist + cache.
    def _write():
        conn = census_store.init_db(census_store.DB_PATH)
        try:
            census_store.upsert_character_aas(conn, name, current_world(), result.model_dump(), now=now)
        finally:
            conn.close()
    await run_sync(_write)
    aa_cache.set(cache_key, result)
    return result
```

Also update `_bg_refresh_aas` to persist the refreshed data into `census_store` the same way (per the audit's stale-while-revalidate pattern).

- [ ] **Step 3: Add a test pinning the cold-cache flow**

`tests/web/test_aa_census_store.py` should mock the Census client, assert that:
- A first cold request issues the Census call + writes to census_store.
- A second request (after `aa_cache.delete(cache_key)` to simulate cache eviction) reads from census_store, NOT from Census.
- A stale store record triggers a background refresh.

- [ ] **Step 4: Verify**

```
uv run ruff format web/routes/aa.py census/census_store.py tests/web/test_aa_census_store.py
uv run ruff check web/routes/aa.py census/census_store.py tests/web/test_aa_census_store.py
uv run pyright web/routes/aa.py census/census_store.py
uv run pytest tests/web -v -x
```

All clean. Per memory [[local-passing-tests-can-mask-fresh-env-bugs]], also run:

```
DB_CENSUS_PATH=/tmp/fresh-census.db uv run pytest tests/web/test_aa_census_store.py -v -x
```

(PowerShell: `$env:DB_CENSUS_PATH = "$env:TEMP/fresh-census.db"; uv run pytest tests/web/test_aa_census_store.py -v -x; Remove-Item $env:TEMP/fresh-census.db`.)

---

## Task 2c.7: Audit every `except Exception: pass` — refactor (BE-080, BE-083, BE-088)

**Files:** the 22 sites from the audit. Grep:

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', '-B1', 'except Exception:\\s*$', '--type=py'])"
```

(The `-B1` flag shows the surrounding `try:` so you can see what's being protected.)

For EACH site, decide intent:

- **Intentional metric / cache write best-effort** → migrate to `swallow("category")`:

  Before:
  ```python
  try:
      CACHE_HITS.labels(cache="character").inc()
  except Exception:
      pass
  ```

  After:
  ```python
  from web.lib.silent_swallow import swallow

  with swallow("metrics"):
      CACHE_HITS.labels(cache="character").inc()
  ```

- **Real failure being hidden** → log at WARNING:

  Before (`web/routes/aa.py:55` `_load_tree_index`):
  ```python
  for path in _TREES_DIR.glob("*.json"):
      try:
          data = json.loads(path.read_text(encoding="utf-8"))
          ...
      except Exception:
          pass
  ```

  After:
  ```python
  for path in _TREES_DIR.glob("*.json"):
      try:
          data = json.loads(path.read_text(encoding="utf-8"))
          ...
      except Exception as exc:
          _log.warning("[aa] Failed to load tree index %s: %s", path.name, exc)
  ```

- **Best-effort enrichment that's actively bug-shaped** (BE-083 `_check_watch`): log at WARNING with the entity id so the failure is at least visible:

  Before:
  ```python
  for w in watches:
      try:
          await _check_watch(w)
      except Exception:
          pass
  ```

  After:
  ```python
  for w in watches:
      try:
          await _check_watch(w)
      except Exception as exc:
          _log.warning("[item_watch] Check failed for watch_id=%s: %s", w.get("id"), exc)
  ```

- **BE-088** (`_parse_effects` in `spells_db.py`): log at WARNING when `raw` is non-None-non-list (unexpected shape) — keep returning "[]" but emit the warning so a Census-schema drift is visible:

  ```python
  raw = spell.get("effect_list")
  if raw is None:
      return "[]"
  if not isinstance(raw, list):
      _log.warning(
          "[spells_db] effect_list for spell %s has unexpected shape %s — returning empty",
          spell.get("id"),
          type(raw).__name__,
      )
      return "[]"
  ```

- [ ] **Step 1: Walk the grep output, classifying each site**

In your task notes, list each (file:line, category) so the user can review your classifications during the commit-checkpoint.

- [ ] **Step 2: Apply the refactor per site**

For each site, edit per the matching template above.

- [ ] **Step 3: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean. Re-grep:

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'except Exception:\\s*$', '--type=py'])"
```

Surviving hits should be ONLY in the new `web/lib/silent_swallow.py` (the helper itself) and in tests that intentionally test the swallow behaviour.

---

## Task 2c.8: Dedup `_resolve_primary_guild` to `cached_primary_guild` (BE-026, BE-031)

**Files:** `web/routes/zones.py:224-251`, `web/routes/raid_strategies.py:57-76`, `web/routes/item_watch.py:175`

Replace the inline cache-or-fetch flow with the shared `web.lib.primary_guild.cached_primary_guild` from Phase 2a.

- [ ] **Step 1: `web/routes/raid_strategies.py`**

Before (lines ~57-76):
```python
async def _resolve_primary_guild_cached(discord_id: str) -> str | None:
    """Return the user's primary character's guild name from cache, or None."""
    claims = await get_active_claims(discord_id, world=current_world())
    primary = next((c for c in claims["approved"] if c.get("is_primary")), None)
    if primary is None:
        return None
    cached, _ = character_cache.get_stale(f"{primary['character_name'].lower()}:{current_world().lower()}")
    if cached is None:
        return None
    return getattr(cached, "guild_name", None) or None
```

After:
```python
from web.lib.primary_guild import cached_primary_guild


async def _resolve_primary_guild_cached(discord_id: str) -> str | None:
    """Return the user's primary character's guild name from cache, or None.

    Thin wrapper around web.lib.primary_guild.cached_primary_guild that
    discards the character name — auth_deps.require_capability uses this
    helper which only needs the guild name."""
    _, guild_name = await cached_primary_guild(discord_id, current_world())
    return guild_name
```

- [ ] **Step 2: `web/routes/zones.py`**

The function in this file has an extra fallback step (most-recent parsed guild). Migrate the shared part, keep the fallback:

Before (lines ~224-251):
```python
async def _resolve_primary_guild(discord_id: str) -> tuple[str | None, str | None]:
    claims = await get_active_claims(discord_id, world=current_world())
    primary = next((c for c in claims["approved"] if c.get("is_primary")), None)
    if primary:
        cached, _ = character_cache.get_stale(f"{primary['character_name'].lower()}:{current_world().lower()}")
        if cached is not None:
            return primary["character_name"], getattr(cached, "guild_name", None)
    # Fallback: most recent parsed guild
    # ... existing fallback code ...
```

After:
```python
async def _resolve_primary_guild(discord_id: str) -> tuple[str | None, str | None]:
    from web.lib.primary_guild import cached_primary_guild

    char_name, guild_name = await cached_primary_guild(discord_id, current_world())
    if guild_name:
        return char_name, guild_name
    # Fallback: most recent parsed guild (kept verbatim from pre-refactor)
    # ... existing fallback code ...
```

- [ ] **Step 3: `web/routes/item_watch.py:175`** (BE-031)

Before:
```python
primary_claim = next((c for c in officer_claims["approved"] if c.get("is_primary")), None)
```

After:
```python
from web.lib.primary_guild import get_primary_claim

primary_claim = get_primary_claim(officer_claims)
```

- [ ] **Step 4: Verify**

```
uv run ruff format web/routes/zones.py web/routes/raid_strategies.py web/routes/item_watch.py
uv run ruff check web/routes/zones.py web/routes/raid_strategies.py web/routes/item_watch.py
uv run pyright web/routes/
uv run pytest tests/web -v -x
```

All clean.

---

## Task 2c.9: Migrate route handlers to `web/lib/validation.py` + `cache_keys.py` (BE-030, BE-023)

**Files:** every route that takes a `name: str` path param OR a `world: str | None` query/body field.

For BE-030 (validation): apply `validate_character_name` / `sanitize_world` consistently. Today only ingest validates names; GET endpoints take whatever the client sends.

For BE-023 (cache keys): migrate every `f"{name.lower()}:{current_world().lower()}"` to `char_cache_key(name, current_world())`.

- [ ] **Step 1: Grep cache-key sites**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', '\\.lower\\(\\).*\\.lower\\(\\)', '--type=py', 'web/'])"
```

- [ ] **Step 2: Per-site migration**

For each match (expected ~10 sites across `character/`, `aa.py`, `census_refresh.py`, `parses/`, `characters.py`):

Before:
```python
cache_key = f"{name.lower()}:{current_world().lower()}"
```

After:
```python
from web.lib.cache_keys import char_cache_key

cache_key = char_cache_key(name, current_world())
```

For guild-roster cache keys:
```python
# Before:
cache_key = f"roster:{guild.lower()}:{world.lower()}"
# After:
from web.lib.cache_keys import guild_roster_key
cache_key = guild_roster_key(guild, world)
```

- [ ] **Step 3: Apply validation to GET endpoints**

For every `async def get_character(..., name: str, ...)` or similar, add a validation gate at the top:

Before:
```python
async def get_character(request: Request, name: str) -> CharacterResponse:
    if len(name) > 64:
        raise HTTPException(status_code=400, detail="Character name is too long")
    cache_key = char_cache_key(name, current_world())
    # ...
```

After:
```python
async def get_character(request: Request, name: str) -> CharacterResponse:
    sanitised = validate_character_name(name)
    if sanitised is None:
        raise HTTPException(status_code=400, detail="Character name is invalid (must be 1-15 letters).")
    name = sanitised
    cache_key = char_cache_key(name, current_world())
    # ...
```

Routes that take a guild name from a path param: same pattern with `validate_guild_name`.

For the existing `_validate_guild_name` in `web/routes/guild.py` and `_sanitize_world` in `web/routes/parses/ingest.py`, replace the local helper with an alias re-export so call sites don't need to change:

```python
from web.lib.validation import validate_guild_name as _validate_guild_name
from web.lib.validation import sanitize_world as _sanitize_world
```

Delete the old local definitions.

- [ ] **Step 4: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean. The validation gates may cause existing tests that pass a long name or an invalid character to start returning 400 instead of working — update those tests to use a valid name OR explicitly assert the new 400 if the test was about the validation gate.

---

## Task 2c.10: Migrate to `web/constants.py` named constants (BE-101, BE-102)

**Files:** every file referenced in BE-101 + BE-102.

- [ ] **Step 1: Per-file migration**

`web/census_refresh.py:29` — replace `_THROTTLE = 900` with `from web.constants import CENSUS_REFRESH_THROTTLE_S as _THROTTLE`.

`web/cache.py:170-173` — replace the hardcoded `ttl=300, max_age=3600` literals with `CACHE_STALE_TTL_S, CACHE_MAX_AGE_S` from `web.constants`.

`web/routes/parses/ingest.py` — `MIRROR_WINDOW_S = 60` → `from web.constants import PARSE_MIRROR_WINDOW_S as MIRROR_WINDOW_S`.

`web/routes/parses/list.py` — `inner_cap = max(limit * 30, 2000)` → `inner_cap = max(limit * PARSE_INNER_CAP_MULTIPLIER, PARSE_INNER_CAP_FLOOR)`.

`web/routes/admin.py:332` — `limit = max(1, min(limit, 1000))` → `limit = max(1, min(limit, ADMIN_PARSE_LIST_MAX_LIMIT))`.

`web/routes/parses/list.py` — `limit = max(1, min(limit, 500))` → `limit = max(1, min(limit, PARSE_LIST_MAX_LIMIT))`.

`web/routes/character/views.py:448` — `STALE_S = 900` → `from web.constants import CHARACTER_STALE_S as STALE_S` (or just inline `CHARACTER_STALE_S`).

`web/routes/zones.py:283-313` — chunk limit 900 → `from web.constants import SQLITE_VAR_CHUNK_SAFE`.

`web/app.py` cache-sweep loop interval 600 → `CACHE_SWEEP_INTERVAL_S`.

- [ ] **Step 2: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean.

---

## Task 2c.11: Notifications gather + connection pool nit (BE-040, BE-044)

**Files:** `web/routes/notifications.py:81-99`

BE-040: `_roster_rank_map` is awaited sequentially per guild. `asyncio.gather` the lookups.

- [ ] **Step 1: Edit `web/routes/notifications.py`**

Before:
```python
for guild_name in guilds_seen:
    rank_map = await _roster_rank_map(guild_name)
    # ... process rank_map ...
```

After:
```python
import asyncio

rank_maps = await asyncio.gather(*[_roster_rank_map(g) for g in guilds_seen])
for guild_name, rank_map in zip(guilds_seen, rank_maps, strict=True):
    # ... process rank_map ...
```

BE-044 (connection pool nit): the spec calls out `parses_db.init_db(parses_db.DB_PATH)` in tight loops. The fix is a module-level lazy connection — but the spec marks it as "medium" effort and the current behaviour is correct (WAL handles concurrent connections fine). **Defer to Phase 3 polish.** Cite this deferral in the task notes.

- [ ] **Step 2: Verify**

```
uv run ruff format web/routes/notifications.py
uv run ruff check web/routes/notifications.py
uv run pyright web/routes/notifications.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 2c.12: Misc P1 cleanups landing during the migration sweep

**Files:** various.

This task batches the remaining P1 items that don't warrant their own task but are small enough to land here.

- [ ] **Step 1: BE-025 `_snapshot_from_cache` extraction**

`web/routes/parses/ingest.py` + `web/routes/parses/list.py` both have:
```python
CombatantSnapshot(
    level=getattr(cached, "level", None),
    guild_name=getattr(cached, "guild_name", None),
    cls=getattr(cached, "cls", None),
    ilvl=getattr(cached, "ilvl", None),
)
```

Extract a sibling helper in `web/routes/parses/ingest.py`:

```python
def _snapshot_from_cache(cached) -> CombatantSnapshot:
    """Build a CombatantSnapshot from a cached CharacterResponse-shaped object."""
    return CombatantSnapshot(
        level=getattr(cached, "level", None),
        guild_name=getattr(cached, "guild_name", None),
        cls=getattr(cached, "cls", None),
        ilvl=getattr(cached, "ilvl", None),
    )
```

Re-export from `list.py` via `from web.routes.parses.ingest import _snapshot_from_cache`. Both call sites collapse to one line.

- [ ] **Step 2: BE-043 `_resolve_encounter` init_db once per process**

`web/routes/act_triggers.py:145-216` calls `raids_db.init_db().close()` on EVERY trigger read. Replace with a module-level flag:

```python
_RAIDS_DB_INIT_DONE = False


def _ensure_raids_db_inited() -> None:
    global _RAIDS_DB_INIT_DONE
    if not _RAIDS_DB_INIT_DONE:
        raids_db.init_db().close()
        _RAIDS_DB_INIT_DONE = True
```

Then call `_ensure_raids_db_inited()` at the top of `_resolve_encounter_sync` instead of the unconditional `raids_db.init_db().close()`.

- [ ] **Step 3: BE-063 `_backfill_pvp_flag` version-gate**

`census/db.py:712-725`. Apply the same pattern as `_backfill_effect_stats`:

Before:
```python
def _backfill_pvp_flag(conn: sqlite3.Connection) -> None:
    conn.execute("""
        UPDATE items
        SET flag_pvp = 1
        WHERE flag_pvp = 0
          AND raw_json IS NOT NULL
          AND LOWER(raw_json) LIKE '%pvp%'
    """)
```

After:
```python
def _backfill_pvp_flag(conn: sqlite3.Connection) -> None:
    if get_meta(conn, "pvp_backfill_version") == "1":
        return  # already done
    conn.execute("""
        UPDATE items
        SET flag_pvp = 1
        WHERE flag_pvp = 0
          AND raw_json IS NOT NULL
          AND LOWER(raw_json) LIKE '%pvp%'
    """)
    set_meta(conn, "pvp_backfill_version", "1")
```

(Reuse the existing `_meta` table + `get_meta`/`set_meta` helpers in `census/db.py`.)

- [ ] **Step 4: BE-071 census_store migrations swallow log**

`census/census_store.py:65-69`. Log the swallowed error at DEBUG so a real DDL failure isn't completely invisible:

Before:
```python
for stmt in _MIGRATIONS:
    try:
        conn.execute(stmt)
    except sqlite3.OperationalError:
        pass
```

After:
```python
for stmt in _MIGRATIONS:
    try:
        conn.execute(stmt)
    except sqlite3.OperationalError as exc:
        _log.debug("[census_store] migration swallowed: %s (%s)", stmt[:60], exc)
```

- [ ] **Step 5: BE-074 `tier_display` UPDATE version-gate**

`census/zones_db.py:294-310`. Same pattern as BE-063 — guard via `set_meta(conn, "encounter_name_normalised_v1", "1")`.

- [ ] **Step 6: BE-114 drop `aiosqlite` try/except fallback**

`census/db.py:910-915`. The fallback to a sync helper exists because `aiosqlite` was historically optional — it's now a required dep, so the fallback is dead code.

Before:
```python
async def find_by_id(item_id: int, path: Path = DB_PATH) -> dict | None:
    try:
        import aiosqlite
    except ImportError:
        return _find_by_id_sync(item_id, path)
    # ...
```

After:
```python
async def find_by_id(item_id: int, path: Path = DB_PATH) -> dict | None:
    # ... (drop the try/except, move `import aiosqlite` to module top) ...
```

Delete the unused `_find_by_id_sync` + `_find_by_name_sync` helpers if no other call site references them. Grep first:

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', '_find_by_(id|name)_sync', '--type=py'])"
```

If `scripts/` references them, keep them and just trim the try/except.

- [ ] **Step 7: BE-085 transactional review_and_grant_role**

`web/routes/admin.py:294-298` + the TODO in `web/db/users.py:283`. Add a new helper:

```python
async def review_and_grant_role(
    request_id: int, status: str, admin_id: str, note: str | None = None
) -> dict | None:
    """Atomically mark a role request approved + insert the user_roles row.

    Single transaction so a process crash between the two writes can't leave
    the queue with a phantom-approved row whose grant never landed. Returns
    the reviewed request dict (or None if not found / already reviewed)."""
    # ... single BEGIN/COMMIT around the two existing helpers' SQL ...
```

Replace the two-step call in `admin.py:approve_role_request` with one call to the new helper.

- [ ] **Step 8: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean.

---

## Task 2c.13: Phase 2c commit checkpoint

After approval, the user stages + commits only the named files. The list is large — every file that picked up an import from `web/lib/*` or `web/constants` qualifies.

- [ ] **Step 1: Stage**

The simplest is `git add -u` (modified only) PLUS the new module additions:

```
git add -u    # picks up every migrated file
git add web/lib/   # (already committed in Phase 2a — should be a no-op)
git add tests/web/test_aa_census_store.py    # new test from 2c.6
git add census/census_store.py    # AA table addition
```

- [ ] **Step 2: Confirm staged set**

```
git status
git diff --staged --stat
```

Sanity-check: the diff should be many small per-file changes (import swaps, name renames), NOT large rewrites. If a file appears with a huge diff, inspect — you may have accidentally clobbered something.

- [ ] **Step 3: Commit**

```
git commit -m "Backend cleanliness Phase 2c: migrate to canonical helpers

Mechanical migration sweep. Every hand-rolled pattern from Phase 1's
audit adopts a shared helper from Phase 2a:

- BE-024/042: 55 sites: asyncio.get_event_loop() + run_in_executor → web.lib.executor.run_sync
- BE-009/010: 18 sites: CensusClient(...) lifecycle → web.lib.census_lifecycle.shared_census_client
- BE-115: 4 bot cogs: per-cog CensusClient → self.bot.census shared singleton
- BE-020/092: 5 sites: per-module _int/_str → census._coerce
- BE-022: 4 sites: _scrub/_safe_for_log variants → web.lib.log_safety.scrub
- BE-023: 10+ sites: f-string cache keys → web.lib.cache_keys.*
- BE-030: GET endpoints validate names/worlds via web.lib.validation
- BE-101/102: magic-number constants → web.constants imports
- BE-041: AA endpoint integrated with census_store (stale-while-revalidate)
- BE-080/083/088: 22 except Exception sites refactored — intentional ones
  use web.lib.silent_swallow.swallow, real failures log at WARNING
- BE-026/031: _resolve_primary_guild dedup → web.lib.primary_guild
- BE-040: notifications.py gathers _roster_rank_map calls in parallel
- BE-025: _snapshot_from_cache helper extracted
- BE-043: act_triggers raids_db init runs once per process
- BE-063/071/074: schema migrations version-gated / debug-logged
- BE-114: drop dead aiosqlite ImportError fallback
- BE-085: atomic review_and_grant_role transaction

Spec: docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md
Plan: docs/superpowers/plans/2026-05-29-backend-cleanliness.md"
```

Do NOT push.

---

# Phase 2b — P1b: file splits (3 files → 14 focused siblings)

> **Reading-order note:** Phase 2b appears AFTER Phase 2c in this document because of the order tasks were written, but **execute Phase 2b BEFORE Phase 2c**. The frontend cleanliness plan landed in 2a → 2b → 2c order and this plan should too. The dependency: Phase 2c migrates call sites by FILE; if Phase 2b reshapes those files mid-migration, every Phase 2c diff has to be re-resolved. Ship the splits first, then run the mechanical migration sweep over the split layout.

After Phase 2b: `web/routes/parses.py` (1687 lines), `web/db.py` (1309 lines), and `web/routes/character.py` (933 lines) are split into focused siblings under same-named subdirs — mirroring the frontend `pages/admin/`, `pages/guild/`, `pages/parse/` convention. Each split preserves the existing import API by re-exporting from the `__init__.py`:

```python
# Before:  from web import db as users_db; users_db.get_active_claims(...)
# After:   from web import db as users_db; users_db.get_active_claims(...)
#          (still works; web.db.__init__ re-exports the helpers)
```

Sequence rationale: `parses.py` first (it's the biggest and the structure is cleanest — clear ingest/list/delete sections). `web/db.py` second (touches the most call sites — every route imports from it). `character.py` third (depends on Phase 2a's `_get_or_fetch_character` extraction; the duplicated cache-or-fetch flow becomes the `_shared.py` helper).

Each file-split is broken into ~3 sub-tasks: extract module 1, extract module 2, etc., then trim the parent to a thin re-export shell.

CRITICAL: in the parent shell after extraction, ALL the existing imports the rest of the app uses must still resolve. Grep for `from web.routes.parses import` and `from web.db import` (and `from web.routes.character import`) BEFORE deleting anything from the parent file. The shell re-exports preserve the API surface.

---

## Task 2b.1: parses.py — extract `models.py` (sub-task 1 of 4)

**Files:**
- Create: `web/routes/parses/__init__.py`
- Create: `web/routes/parses/models.py`
- Modify: `web/routes/parses.py` (leave as transitional file — final trim is Task 2b.4)

Pydantic models (13 of them) at lines 312-513 are self-contained — no DB / no Census / no helpers. Extract them first; the rest of the file imports them from the new location.

- [ ] **Step 1: Create the package**

```
mkdir web/routes/parses
```

Create `web/routes/parses/__init__.py`:

```python
"""Route package — split from the original 1687-line web/routes/parses.py.

Public API: the module exposes ``router`` (a single FastAPI APIRouter)
plus the Pydantic models other modules consume. Sub-modules:

  - models       — Pydantic models (responses + ingest payloads)
  - ingest       — POST /parses/ingest + HMAC validation + snapshot helpers
  - list         — GET /parses + GET /parses/{id}
  - delete       — DELETE /parses, DELETE /parses/{id}, DELETE /parses/batch

The router itself is assembled here so external `app.include_router(parses_router)`
calls keep working unchanged.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["parses"])

# Sub-module imports must come AFTER `router` is defined — each sub-module
# adds its handlers to this router instance.
from web.routes.parses import delete as _delete  # noqa: E402,F401
from web.routes.parses import ingest as _ingest  # noqa: E402,F401
from web.routes.parses import list as _list  # noqa: E402,F401

# Re-export the models so existing `from web.routes.parses import IngestRequest`
# imports keep working.
from web.routes.parses.models import (  # noqa: E402
    AttackSummary,
    CombatantSummary,
    CureSummary,
    DamageTypeBreakdown,
    DeleteParsesResponse,
    HealSummary,
    IngestEncounter,
    IngestRequest,
    IngestResponse,
    ParseDetailResponse,
    ParseEncounterSummary,
    ParsePermissions,
    ParsesListResponse,
    ParseUploadSummary,
    ThreatSummary,
)

__all__ = [
    "router",
    "AttackSummary",
    "CombatantSummary",
    "CureSummary",
    "DamageTypeBreakdown",
    "DeleteParsesResponse",
    "HealSummary",
    "IngestEncounter",
    "IngestRequest",
    "IngestResponse",
    "ParseDetailResponse",
    "ParseEncounterSummary",
    "ParsePermissions",
    "ParsesListResponse",
    "ParseUploadSummary",
    "ThreatSummary",
]
```

- [ ] **Step 2: Move every Pydantic model into `models.py`**

Create `web/routes/parses/models.py`. Copy verbatim from `web/routes/parses.py` lines 307-513 (every `class X(BaseModel):` block from `ParsePermissions` through `ParseDetailResponse`), the IngestRequest/IngestEncounter/IngestResponse classes from lines 996-1043, and `class DeleteParsesResponse(BaseModel)` at line 1486. Add a module docstring + the necessary imports at the top:

```python
"""Pydantic models shared across the parses route sub-modules.

Carved out of the original 1687-line web/routes/parses.py. NOTHING in this
file imports from another parses sub-module — keep it that way to avoid
circular-import pain.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Response models — GET /parses and GET /parses/{id}
# ---------------------------------------------------------------------------

# ... (paste classes here verbatim from parses.py:312-513) ...

# ---------------------------------------------------------------------------
# Ingest models — POST /parses/ingest
# ---------------------------------------------------------------------------

# ... (paste IngestEncounter, IngestRequest, IngestResponse from parses.py:996-1043) ...

# ---------------------------------------------------------------------------
# Delete-response model
# ---------------------------------------------------------------------------

# ... (paste DeleteParsesResponse from parses.py:1486-...) ...

# Mirror grouping window — moved here so models.py owns the magic number too.
# (Also exported via web/constants.py for cross-module use.)
from web.constants import PARSE_MIRROR_WINDOW_S as MIRROR_WINDOW_S  # noqa: F401
```

The existing `MIRROR_WINDOW_S = 60` in parses.py at line 388 was used by the helper code — keep one named constant via the import. The next sub-tasks will swap their references to `web.constants.PARSE_MIRROR_WINDOW_S`.

- [ ] **Step 3: Verify the models module imports cleanly**

```
uv run ruff format web/routes/parses/__init__.py web/routes/parses/models.py
uv run ruff check web/routes/parses/__init__.py web/routes/parses/models.py
uv run pyright web/routes/parses/__init__.py web/routes/parses/models.py
uv run python -c "from web.routes.parses.models import IngestRequest, ParseDetailResponse; print('OK')"
```

The ingest/list/delete sub-modules don't exist yet — the `__init__.py` imports of `_delete`, `_ingest`, `_list` will fail. That's expected at this sub-task boundary; we'll complete it in Tasks 2b.2 and 2b.3. To make THIS task's verify pass, comment out those three imports temporarily:

```python
# from web.routes.parses import delete as _delete  # noqa: E402,F401   TODO Task 2b.3
# from web.routes.parses import ingest as _ingest  # noqa: E402,F401   TODO Task 2b.2
# from web.routes.parses import list as _list  # noqa: E402,F401      TODO Task 2b.2
```

Then re-run the verify and confirm clean.

`uv run pytest tests/web -v -x` will fail because the old `web/routes/parses.py` is still the canonical module — that's expected mid-split. Acknowledge the partial state in your task notes and move to 2b.2.

---

## Task 2b.2: parses.py — extract `list.py` + `ingest.py` (sub-task 2 of 4)

**Files:**
- Create: `web/routes/parses/list.py`
- Create: `web/routes/parses/ingest.py`
- Modify: `web/routes/parses/__init__.py` (re-enable the imports)
- Modify: `web/routes/parses.py` (transitional — final trim in 2b.4)

- [ ] **Step 1: Create `web/routes/parses/list.py`**

Move from `web/routes/parses.py`:
- Lines 71-77: `_uploader_discord_id` helper.
- Lines 522-541: `SIZE_BUCKETS` + `_PLAYER_COUNT_SQL`.
- Lines 543-590: `_list_encounters_sync`.
- Lines 592-651: `_group_into_fights`.
- Lines 654-680: `_encounter_detail_sync`.
- Lines 265-282: `_cached_snapshots` (used by list path for the cached snapshot section).
- Lines 688-720: `_compute_permissions`.
- Lines 723-820: `@router.get("/parses")` handler.
- Lines 822-993: `@router.get("/parses/{encounter_id}")` handler.

Module shape:

```python
"""GET /parses + GET /parses/{id} — paginated list + detail of recent encounters.

Carved out of the original 1687-line web/routes/parses.py. All helpers used
ONLY by the read paths live here. Helpers shared with ingest live in
ingest.py (and the read paths import them).
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
from typing import Any

from fastapi import HTTPException, Request

from parses import db as parses_db
from web.auth_deps import (
    is_admin as _is_admin,
    require_user_session as _require_user,
)
from web.cache import character_cache
from web.constants import (
    PARSE_INNER_CAP_FLOOR,
    PARSE_INNER_CAP_MULTIPLIER,
    PARSE_LIST_MAX_LIMIT,
)
from web.lib.executor import run_sync
from web.lib.validation import sanitize_world
from web.limiter import limiter
from web.routes.parses import router  # the package-level router
from web.routes.parses.models import (
    CombatantSummary,
    ParseDetailResponse,
    ParseEncounterSummary,
    ParsePermissions,
    ParsesListResponse,
    ParseUploadSummary,
)
from web.server_context import current_world

_log = logging.getLogger(__name__)

# ... (paste helpers + handlers here, swapping internal references):
#   - `loop = asyncio.get_event_loop(); await loop.run_in_executor(...)` lines
#     stay as-is for now — Phase 2c.1 migrates them to `run_sync`.
#   - `_sanitize_world` references → `sanitize_world` (web.lib.validation).
#     The first occurrence (in _cached_snapshots) covers this path.
#   - `MIRROR_WINDOW_S` references → `from web.constants import
#     PARSE_MIRROR_WINDOW_S` (already imported by models.py if needed).
#   - `CombatantSnapshot` (from parses.models) — keep the existing import.
```

CRITICAL: every helper that the OTHER sub-modules will need to import is exported via its module name (e.g. `from web.routes.parses.list import _compute_permissions`). Do NOT alias them via `__init__.py` — keep the per-module surface minimal.

- [ ] **Step 2: Create `web/routes/parses/ingest.py`**

Move from `web/routes/parses.py`:
- Lines 60-64: `_ALLOWED_SERVERS_LOWER` + the import block above it.
- Lines 80-107: `_VALID_WORLD_RE`, `_VALID_CHARACTER_NAME_RE`, `_sanitize_world` (note: post-Phase-2a these regexes are duplicated by `web/lib/validation.py` — for THIS task keep the local copies; Phase 2c migrates).
- Lines 110-169: `_resolve_uploader_guild_async`.
- Lines 172-182: `_prewarm_guild_silently`.
- Lines 185-262: `_resolve_combatant_snapshots`.
- Lines 285-305: `_update_snapshots_sync`, `_resolve_and_update_snapshots`.
- Lines 1045-1109: `_encounter_from_payload`, `_combatants_from_payload`.
- Lines 1111-1189: `_damage_types_from_payload`, `_attack_types_from_payload`.
- Lines 1191-1263: `_ingest_payload_sync`.
- Lines 1265-1338: `_validate_payload_signature`.
- Lines 1340-1484: the `@router.post("/parses/ingest")` handler.

Module shape:

```python
"""POST /parses/ingest — ACT-plugin upload + HMAC validation + snapshot resolve.

Carved out of the original 1687-line web/routes/parses.py. HMAC validation
+ regression tests live here. The Pydantic ingest models live in models.py
so they can be type-imported without dragging the helpers along.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import sqlite3
import time

from fastapi import BackgroundTasks, HTTPException, Request

from census.client import CensusClient
from parses import db as parses_db
from parses.boss import is_boss
from parses.models import (
    AttackType,
    Combatant,
    CombatantSnapshot,
    DamageType,
    Encounter,
    _to_bool_tf,
    _to_float,
    _to_int,
    _to_perc,
    _to_str_or_none,
    _to_ts,
)
from web.auth_deps import require_user_session_or_token
from web.cache import character_cache
from web.config import ALLOWED_SERVERS as _ALLOWED_SERVERS
from web.config import SERVICE_ID as _SERVICE_ID
from web.config import WORLD as _WORLD
from web.limiter import limiter
from web.routes.parses import router
from web.routes.parses.models import (
    IngestRequest,
    IngestResponse,
)
from web.server_context import current_world

_log = logging.getLogger(__name__)

_ALLOWED_SERVERS_LOWER: frozenset[str] = frozenset(s.lower() for s in _ALLOWED_SERVERS)

# ... (paste helpers + the ingest handler here) ...
```

- [ ] **Step 3: Re-enable the imports in `__init__.py`**

In `web/routes/parses/__init__.py`, uncomment:

```python
from web.routes.parses import ingest as _ingest  # noqa: E402,F401
from web.routes.parses import list as _list  # noqa: E402,F401
# (delete import still commented — Task 2b.3 adds it)
```

- [ ] **Step 4: Verify**

```
uv run ruff format web/routes/parses/list.py web/routes/parses/ingest.py web/routes/parses/__init__.py
uv run ruff check web/routes/parses/list.py web/routes/parses/ingest.py web/routes/parses/__init__.py
uv run pyright web/routes/parses/
uv run python -c "from web.routes.parses import router, IngestRequest; print('OK')"
```

The full pytest run will still fail because the old `web/routes/parses.py` is the canonical module that `app.py` includes — wait for Task 2b.4.

---

## Task 2b.3: parses.py — extract `delete.py` (sub-task 3 of 4)

**Files:**
- Create: `web/routes/parses/delete.py`
- Modify: `web/routes/parses/__init__.py` (re-enable delete import)

- [ ] **Step 1: Create `web/routes/parses/delete.py`**

Move from `web/routes/parses.py`:
- Lines 1486-1488: `DeleteParsesResponse` — wait, this already moved to `models.py` in Task 2b.1. Skip.
- Lines 1490-1505: `_can_delete_encounter`.
- Lines 1506-1521: `_fetch_encounter_auth_rows`.
- Lines 1523-1530: `_apply_delete`.
- Lines 1532-1593: `@router.delete("/parses/batch")` handler.
- Lines 1595-1629: `@router.delete("/parses/{encounter_id}")` handler.
- Lines 1631-end: `@router.delete("/parses")` handler.

Module shape:

```python
"""DELETE /parses/* — batch / single / bulk encounter deletion.

Soft-delete (hidden_at set) is the default; admin bulk-delete can purge=true
for a hard delete. Auth: admin sees all; officer of an encounter's guild
or the original uploader can soft-delete their own.
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
import time
from typing import Any

from fastapi import HTTPException, Request

from parses import db as parses_db
from web.auth_deps import (
    is_admin as _is_admin,
    require_user_session as _require_user,
)
from web.limiter import limiter
from web.routes.parses import router
from web.routes.parses.models import DeleteParsesResponse
from web.server_context import current_world

_log = logging.getLogger(__name__)

# ... (paste helpers + handlers, importing _uploader_discord_id from
#     web.routes.parses.list if needed) ...
```

- [ ] **Step 2: Re-enable the delete import**

In `web/routes/parses/__init__.py`, uncomment the last import:

```python
from web.routes.parses import delete as _delete  # noqa: E402,F401
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/parses/delete.py web/routes/parses/__init__.py
uv run ruff check web/routes/parses/
uv run pyright web/routes/parses/
uv run python -c "from web.routes.parses import router; print(len(router.routes), 'routes')"
```

The route count should be 6 (list, detail, ingest, delete-batch, delete-single, delete-bulk).

---

## Task 2b.4: parses.py — delete original file + update consumers (sub-task 4 of 4)

**Files:**
- Delete: `web/routes/parses.py` (after confirming the package re-exports cover every consumer)
- Modify: `web/app.py` import of `parses_router`
- Modify: any other file importing from `web.routes.parses`

- [ ] **Step 1: Grep every consumer**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'from web\\.routes\\.parses', '--type=py'])"
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'import web\\.routes\\.parses', '--type=py'])"
```

List every match. For each: the import target must already be re-exported via `web/routes/parses/__init__.py`. If a consumer imports a PRIVATE helper (e.g. `from web.routes.parses import _resolve_uploader_guild_async`), either:
- Promote the helper to public (drop the underscore) in its new home (`ingest.py`) AND re-export it from `__init__.py`, OR
- Update the consumer to import from the sub-module directly: `from web.routes.parses.ingest import _resolve_uploader_guild_async`.

Document each consumer's chosen path in your task notes.

- [ ] **Step 2: Delete `web/routes/parses.py`**

```
git rm web/routes/parses.py
```

(Or just delete the file via the editor — `git rm` is for the commit step.)

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/parses/ web/app.py
uv run ruff check web/routes/parses/ web/app.py
uv run pyright web/routes/parses/ web/app.py
uv run pytest tests/web tests/parses -v -x
```

All clean — full test suite passes against the split package. The router includes the same 6 endpoints (verify via `print(len(router.routes), 'routes')`).

If any test under `tests/parses` or `tests/web` breaks due to a moved private helper, fix the import there and re-run.

---

## Task 2b.5: web/db.py — extract `schema.py` + `migrations.py` (sub-task 1 of 4)

**Files:**
- Create: `web/db/__init__.py`
- Create: `web/db/schema.py`
- Create: `web/db/migrations.py`
- Modify: `web/db.py` (transitional — final removal in 2b.7)

The biggest file split. Five unrelated domains live in one 1309-line file. Phase 2b moves the SCHEMA, the migrations, and `init_db()` first — the per-domain helpers move in 2b.6.

Memory note [[test-migrations-against-old-db-shape]] applies: every step here MUST include a verify step that exercises both fresh AND pre-migration-shape DBs.

- [ ] **Step 1: Create the package + scaffolding**

```
mkdir web/db
```

Create `web/db/__init__.py`:

```python
"""Backend user/claims/tokens/servers DB layer.

Carved out of the original 1309-line web/db.py. Five unrelated domains
each get their own module:

  - users.py     — users table + role/role_request/role_permission helpers
  - claims.py    — character_claims table
  - item_watch.py — item_watch table
  - tokens.py    — api_tokens table
  - servers.py   — servers (per-server registry) table

The init_db() orchestrator + the DB_PATH constant live here. Every
per-domain helper is re-exported from this module so the existing
`from web import db as users_db; users_db.get_active_claims(...)` API
shape is preserved — no consumer rewrites needed.
"""
from __future__ import annotations

import os
from pathlib import Path

from web.db.migrations import apply_migrations
from web.db.schema import SCHEMA


def _db_path() -> Path:
    env = os.getenv("DB_USERS_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent / "data" / "users.db"


DB_PATH = _db_path()


def init_db(path: Path = DB_PATH) -> None:
    """Create tables if they don't exist + apply migrations.

    Called once at startup. Idempotent. Order:
      1. executescript SCHEMA — creates tables + the indices known at v1.
      2. apply_migrations(conn) — ALTER TABLE + post-ALTER index creates.

    Memory [[test-migrations-against-old-db-shape]]: any new column added
    here MUST be added to BOTH SCHEMA (for fresh DBs) and migrations.py
    (for existing DBs). Column-dependent indexes live in migrations.py
    AFTER the ADD COLUMN — never in SCHEMA.
    """
    import sqlite3

    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        apply_migrations(conn)


# ---------------------------------------------------------------------------
# Re-export the per-domain helpers so the existing API shape is preserved.
# Order matters: each domain only imports from web.db (this module) at the
# helper level — no inter-domain imports.
# ---------------------------------------------------------------------------

from web.db.claims import (  # noqa: E402,F401
    delete_claim,
    delete_claims_for_user,
    get_active_claims,
    get_claim_by_id,
    list_claims,
    review_claim,
    set_primary,
    submit_claim,
    withdraw_claim,
)
from web.db.item_watch import (  # noqa: E402,F401
    add_item_watch,
    list_item_watches,
    remove_item_watch,
    update_item_watch_check,
)
from web.db.servers import (  # noqa: E402,F401
    get_server_by_subdomain_sync,
    get_server_by_world_sync,
    list_servers_sync,
    set_default_server_sync,
    upsert_server_settings_sync,
)
from web.db.tokens import (  # noqa: E402,F401
    generate_token,
    hash_token,
    list_api_tokens,
    lookup_api_token,
    mint_api_token,
    revoke_api_token,
)
from web.db.users import (  # noqa: E402,F401
    create_role_request,
    get_display_names_for_discord_ids,
    get_role_request,
    get_user_access_status,
    grant_role,
    has_role,
    list_all_users,
    list_pending_users,
    list_role_assignments,
    list_role_requests,
    list_roles_for_user,
    review_role_request,
    revoke_role,
    role_has_capability,
    set_user_access,
    upsert_user,
    user_has_capability_via_db,
    withdraw_role_request,
)
```

- [ ] **Step 2: Create `web/db/schema.py`**

Copy the `_SCHEMA = """..."""` string verbatim from `web/db.py:34-195` into:

```python
"""DDL — current shape of every table.

ONLY contains CREATE TABLE / CREATE INDEX statements that are safe to run
on both a fresh DB and an existing DB. Any column-dependent statement
(e.g. CREATE INDEX on a column added by ALTER) MUST live in migrations.py
AFTER the corresponding ADD COLUMN. Adding such a statement here will
silently crash on existing DBs — see memory
[[test-migrations-against-old-db-shape]].
"""
from __future__ import annotations

SCHEMA = """
-- ... (paste the full SCHEMA string verbatim from web/db.py:34-195) ...
"""
```

- [ ] **Step 3: Create `web/db/migrations.py`**

Copy from `web/db.py:215-330` (the post-`executescript` block in `init_db`). Each `ALTER` + post-ALTER index becomes a self-contained section:

```python
"""ALTER TABLE migrations for users.db.

Each section adds a column or rebuilds a table for a constraint change.
Idempotent — guarded on PRAGMA table_info checks so re-runs are no-ops.

Pattern:
  cols = {row[1] for row in conn.execute("PRAGMA table_info(X)")}
  if "new_col" not in cols:
      conn.execute("ALTER TABLE X ADD COLUMN new_col ...")
      conn.execute("CREATE INDEX IF NOT EXISTS idx_x_new ON X(new_col)")

Memory [[test-migrations-against-old-db-shape]]: every consumer-visible
column-add MUST also be reflected in schema.py for the fresh-DB path. Drift
between the two has bitten the repo before (a column-dependent index in
SCHEMA crashed prod startup against an existing DB).
"""
from __future__ import annotations

import sqlite3


def apply_migrations(conn: sqlite3.Connection) -> None:
    """Apply every idempotent ALTER + post-ALTER index. Called from init_db."""
    # ... paste from web/db.py:215-330 verbatim, each ALTER block intact ...
```

Anything that the original `init_db()` did AFTER the migrations (the INSERT OR IGNORE seed of role_permissions, the seed of the default server row from env, etc.) also moves into this function (or a sibling `seed_initial_data(conn)` called after `apply_migrations`).

- [ ] **Step 4: Add a regression test pinning the old-DB-shape upgrade path**

Create `tests/web/test_db_migrations.py`:

```python
"""Memory [[test-migrations-against-old-db-shape]]: init_db must succeed
on a pre-migration-shape DB, not just a fresh one. The repo has crashed
in prod before because a column-dependent index in _SCHEMA referenced a
column not yet added on an existing DB.

This test seeds a v1-shape DB by hand, then runs init_db and asserts
every modern column + index is present afterwards.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from web import db as users_db


@pytest.fixture
def v1_db(tmp_path: Path) -> Path:
    """A user-table-only DB that mirrors the original schema BEFORE any
    of the column-add migrations (users.access_status,
    character_claims.world, character_claims.is_primary, etc.)."""
    db = tmp_path / "users.db"
    with sqlite3.connect(db) as conn:
        conn.executescript("""
            CREATE TABLE users (
                discord_id TEXT PRIMARY KEY,
                discord_name TEXT NOT NULL,
                avatar TEXT,
                first_seen INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                last_seen INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE character_claims (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_id TEXT NOT NULL,
                character_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending'
            );
            INSERT INTO users (discord_id, discord_name) VALUES ('123', 'OldUser');
            INSERT INTO character_claims (discord_id, character_name) VALUES ('123', 'Vortex');
        """)
    return db


def test_init_db_migrates_v1_to_current(v1_db: Path) -> None:
    """The v1-shape DB should upgrade cleanly to the current schema."""
    users_db.init_db(v1_db)

    with sqlite3.connect(v1_db) as conn:
        # Modern columns exist on users.
        users_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        assert "access_status" in users_cols
        assert "discord_username" in users_cols

        # Modern columns exist on character_claims.
        claims_cols = {row[1] for row in conn.execute("PRAGMA table_info(character_claims)")}
        assert "world" in claims_cols
        assert "is_primary" in claims_cols

        # The column-dependent index exists.
        indexes = {row[1] for row in conn.execute("PRAGMA index_list(character_claims)")}
        assert "idx_claims_world" in indexes

        # Existing data survived.
        assert conn.execute("SELECT discord_name FROM users WHERE discord_id='123'").fetchone()[0] == "OldUser"


def test_init_db_on_fresh_db(tmp_path: Path) -> None:
    """The fresh-DB path also works (no pre-existing tables)."""
    db = tmp_path / "users.db"
    users_db.init_db(db)
    with sqlite3.connect(db) as conn:
        # Both old and modern columns present.
        users_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
        assert "access_status" in users_cols


def test_init_db_idempotent(v1_db: Path) -> None:
    """Running init_db twice in a row is safe — no double-ALTER errors."""
    users_db.init_db(v1_db)
    users_db.init_db(v1_db)  # must not raise
```

- [ ] **Step 5: Verify**

```
uv run ruff format web/db/__init__.py web/db/schema.py web/db/migrations.py tests/web/test_db_migrations.py
uv run ruff check web/db/__init__.py web/db/schema.py web/db/migrations.py tests/web/test_db_migrations.py
uv run pyright web/db/__init__.py web/db/schema.py web/db/migrations.py
uv run pytest tests/web/test_db_migrations.py -v -x
```

The migration test must pass. The full test suite will fail because the per-domain helpers still live in `web/db.py` and `web/db/__init__.py` tries to import them from `web/db/users.py` etc. (which don't exist yet). Move to 2b.6 immediately.

---

## Task 2b.6: web/db.py — extract per-domain helper modules (sub-task 2 of 4)

**Files:**
- Create: `web/db/users.py`, `web/db/claims.py`, `web/db/item_watch.py`, `web/db/tokens.py`, `web/db/servers.py`.
- Modify: `web/db.py` (still the canonical helpers for now — keep as a back-up; the `__init__.py` re-exports from the new modules but the old file's functions remain for any consumer we miss).

Each new module owns the helpers for one table. Pattern: copy the relevant `async def`/`def` blocks verbatim from `web/db.py`, replace internal references (e.g. `from web.db import DB_PATH` → `from web.db import DB_PATH` still works since `web.db` is now the package). Each helper still accepts `path: Path = DB_PATH` so test paths can be injected via the existing fixture pattern.

- [ ] **Step 1: Create `web/db/users.py`**

Copy verbatim from `web/db.py:333-700`:
- `upsert_user`
- `get_user_access_status`
- `get_display_names_for_discord_ids`
- `list_pending_users`
- `list_all_users`
- `set_user_access`
- `grant_role`, `revoke_role`
- `list_roles_for_user`, `has_role`
- `create_role_request`, `list_role_requests`, `get_role_request`
- `review_role_request`, `withdraw_role_request`
- `user_has_capability_via_db`, `role_has_capability`
- `list_role_assignments`

Module shape:

```python
"""users.db users table + role / role_request / role_permission helpers.

Carved out of the original 1309-line web/db.py. Async (aiosqlite) helpers
for the users domain. ``path: Path = DB_PATH`` parameter on every public
function so tests can inject a temp DB.
"""
from __future__ import annotations

from pathlib import Path

import aiosqlite

from web.db import DB_PATH

# ... paste helpers ...
```

- [ ] **Step 2: Create `web/db/claims.py`**

Copy verbatim from `web/db.py:705-998`:
- `get_active_claims`, `submit_claim`, `withdraw_claim`, `set_primary`
- `get_claim_by_id`, `list_claims`, `review_claim`, `delete_claim`, `delete_claims_for_user`

Add the index migration BE-072 concern: `is_primary` lacks an index. Add to `web/db/migrations.py`:

```python
    # BE-072: idx_claims_primary supports the "primary claim per (user, world)"
    # filter that hits get_active_claims on every read. Without it, the WHERE
    # is_primary = 1 was a full scan across the user's claims (small per-user
    # but multiplied across every read).
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_claims_primary "
        "ON character_claims(discord_id, world, is_primary)"
    )
```

And BE-073: `users.access_status` lacks an index. Add:

```python
    # BE-073: notifications endpoint polls list_pending_users every 60s for
    # every logged-in admin — without this index, the WHERE access_status =
    # 'pending' is a full table scan. Selectivity is high (most users are
    # approved), so the index pays for itself.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_users_access ON users(access_status)"
    )
```

Update `tests/web/test_db_migrations.py` to assert both new indexes exist after init_db on both fresh and v1 DBs.

- [ ] **Step 3: Create `web/db/item_watch.py`**

Copy from `web/db.py:1000-1101`:
- `add_item_watch`, `list_item_watches`, `remove_item_watch`, `update_item_watch_check`

The `_run(path, sql, params)` helper at `web/db.py:1102-1107` exists for only one consumer (`update_item_watch_check`) — inline it per BE-232 (P2). For now keep it as a private helper inside `item_watch.py`; Phase 3 task will inline it.

- [ ] **Step 4: Create `web/db/tokens.py`**

Copy from `web/db.py:1119-1310`:
- `generate_token`, `hash_token`
- `mint_api_token`, `list_api_tokens`, `revoke_api_token`, `lookup_api_token`

The `lookup_api_token` coalescing change from Phase 1 Task 1.6 is already in this code — bring it forward as-is.

- [ ] **Step 5: Create `web/db/servers.py`**

Copy from `web/db.py:1206-1278`:
- `_server_row`
- `list_servers_sync`, `get_server_by_subdomain_sync`, `get_server_by_world_sync`
- `upsert_server_settings_sync`, `set_default_server_sync`

- [ ] **Step 6: Verify**

```
uv run ruff format web/db/users.py web/db/claims.py web/db/item_watch.py web/db/tokens.py web/db/servers.py
uv run ruff check web/db/users.py web/db/claims.py web/db/item_watch.py web/db/tokens.py web/db/servers.py
uv run pyright web/db/
uv run pytest tests/web -v -x
```

All clean — full web test suite passes against the package layout because the `__init__.py` re-exports preserve the API.

If a test imports a private helper directly (e.g. `from web.db import _run`), update the test to import from the new home (`from web.db.item_watch import _run`) — but only after confirming no production code does the same; the private prefix means we don't owe an alias.

- [ ] **Step 7: Re-verify against a pre-migration-shape DB**

Memory [[local-passing-tests-can-mask-fresh-env-bugs]]: run the suite with a fresh DB path env var to confirm the package's `init_db` self-heals correctly:

```
DB_USERS_PATH=/tmp/fresh-web-db-test.db uv run pytest tests/web -v -x
rm /tmp/fresh-web-db-test.db
```

(On Windows PowerShell: `$env:DB_USERS_PATH = "$env:TEMP/fresh-web-db-test.db"; uv run pytest tests/web -v -x; Remove-Item $env:TEMP/fresh-web-db-test.db`.)

---

## Task 2b.7: web/db.py — delete original file (sub-task 3 of 3)

**Files:**
- Delete: `web/db.py`
- Modify: any file with a stale import (the `__init__.py` re-exports cover most; verify via grep).

- [ ] **Step 1: Grep every consumer**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'from web\\.db import', '--type=py'])"
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'from web import db', '--type=py'])"
```

Every match must resolve via the new `web/db/__init__.py` re-exports. If a consumer imports a private helper directly (`from web.db import _SCHEMA` or `from web.db import _run`), either:
- Re-export it from `__init__.py` (for `_SCHEMA`, keep it private — point the consumer at `web.db.schema.SCHEMA`).
- Update the consumer to import from the sub-module.

- [ ] **Step 2: Delete the old file**

```
# Confirm via Python that all imports resolve before removing:
uv run python -c "from web import db as users_db; print([n for n in dir(users_db) if not n.startswith('_')][:20])"
# Then remove:
rm web/db.py
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/db/
uv run ruff check web/db/
uv run pyright web/db/
uv run pytest tests/ -v -x
```

Full test suite passes against the package layout.

---

## Task 2b.8: character.py — extract `_shared.py` + `views.py` (sub-task 1 of 3)

**Files:**
- Create: `web/routes/character/__init__.py`
- Create: `web/routes/character/_shared.py`
- Create: `web/routes/character/views.py`
- Modify: `web/routes/character.py` (transitional — final removal in 2b.10)

The cache-or-fetch flow is duplicated 3 times across `get_character`, `get_upgrade_materials`, `get_upgrade_recipes` (BE-028). The split is the perfect place to extract the shared helper.

- [ ] **Step 1: Create the package + __init__.py**

```
mkdir web/routes/character
```

Create `web/routes/character/__init__.py`:

```python
"""Route package — split from the original 933-line web/routes/character.py.

Sub-modules:
  - views   — GET /character/{name}, _build_char_response, equipment helpers
  - spells  — GET /character/{name}/spells
  - upgrades — GET /character/{name}/upgrade-materials + /upgrade-recipes

Shared:
  - _shared._get_or_fetch_character — the cache-first + Census-fallback flow
    that all three handlers share. Extracted to kill the BE-028 duplication.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["character"])

from web.routes.character import spells as _spells  # noqa: E402,F401
from web.routes.character import upgrades as _upgrades  # noqa: E402,F401
from web.routes.character import views as _views  # noqa: E402,F401

# Re-export the public response models.
from web.routes.character.views import CharacterResponse  # noqa: E402,F401
# prewarm_character_cache is called from web/app.py startup.
from web.routes.character.views import prewarm_character_cache  # noqa: E402,F401

__all__ = ["router", "CharacterResponse", "prewarm_character_cache"]
```

- [ ] **Step 2: Create `web/routes/character/_shared.py`**

```python
"""Shared cache-first + Census-fallback character fetch.

Audit BE-028: the same ~25-line flow appeared in get_character_spells,
get_upgrade_materials, get_upgrade_recipes. Extracted here so the three
handlers shrink to one line.

Why not just call _build_char_response directly? Because the flow has TWO
sources — character_cache (the fast path) and Census (the cold path) —
and the response shape comes from _build_char_response which lives in
views.py. _shared.py imports from views.py lazily to avoid the circular
(views.py → _shared.py, _shared.py → views.py)."""
from __future__ import annotations

import logging

from fastapi import HTTPException

from census.client import CensusClient
from web.cache import character_cache
from web.config import SERVICE_ID as _SERVICE_ID
from web.server_context import current_world

_log = logging.getLogger(__name__)


async def _get_or_fetch_character(name: str):
    """Return a ``CharacterResponse`` for ``name`` — cached if available, else
    fetched live from Census + cached.

    Raises HTTPException(404) when Census returns no character. Raises
    HTTPException(503) when Census is unreachable.
    """
    # Lazy import — views.py imports this helper at module load.
    from web.lib.cache_keys import char_cache_key
    from web.routes.character.views import _build_char_response

    cache_key = char_cache_key(name, current_world())
    cached, _ = character_cache.get_stale(cache_key)
    if cached is not None:
        return cached

    # CENSUS-CLIENT-LIFECYCLE: migrate to web.lib.census_lifecycle in Phase 2c.2
    client = CensusClient(service_id=_SERVICE_ID)
    try:
        char = await client.get_character(name, current_world())
    except Exception as exc:
        _log.warning("Census fetch failed for %r: %s", name, exc)
        raise HTTPException(status_code=503, detail="Census is unavailable; please retry shortly.") from exc
    finally:
        await client.close()

    if char is None:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found on {current_world()}")

    result = _build_char_response(char)
    character_cache.set(cache_key, result)
    return result
```

- [ ] **Step 3: Create `web/routes/character/views.py`**

Move from `web/routes/character.py` lines 1-538:
- All imports + module-level constants.
- `class AdornSlotResponse`, `class EquipmentSlotResponse`.
- `_heal_equipment_placeholders`.
- `class CharacterStats` + `_f`, `_i`, `_parse_stats`.
- `class CharacterResponse`, `_ilvl_from_gear`, `_equipment_lookup_ids`, `_adorn_ilvl_bonus`, `_build_char_response`.
- `prewarm_character_cache`.
- `@router.get("/character/{name}")` handler.

```python
"""GET /character/{name} + the shared CharacterResponse model + equipment helpers.

Carved out of the original 933-line web/routes/character.py.
"""
from __future__ import annotations

# ... (imports) ...
from web.routes.character import router  # the package-level router

# ... (paste the classes / helpers / handler) ...
```

- [ ] **Step 4: Verify**

```
uv run ruff format web/routes/character/__init__.py web/routes/character/_shared.py web/routes/character/views.py
uv run ruff check web/routes/character/__init__.py web/routes/character/_shared.py web/routes/character/views.py
uv run pyright web/routes/character/
uv run python -c "from web.routes.character import router, CharacterResponse, prewarm_character_cache; print('OK')"
```

The package-level imports work. Full pytest still partial — spells.py and upgrades.py don't exist yet.

---

## Task 2b.9: character.py — extract `spells.py` + `upgrades.py` (sub-task 2 of 3)

**Files:**
- Create: `web/routes/character/spells.py`
- Create: `web/routes/character/upgrades.py`

- [ ] **Step 1: Create `web/routes/character/spells.py`**

Move from `web/routes/character.py` lines 540-640:
- `class SpellEntryResponse`, `class CharacterSpellsResponse`.
- `@router.get("/character/{name}/spells")` handler.

Update the handler to call `_get_or_fetch_character(name)` instead of the duplicated cache-or-fetch block. The pre-refactor handler at line ~556-587 had this shape:

```python
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

Replace with:

```python
char_resp = await _get_or_fetch_character(name)
char_name = char_resp.name
spell_ids = char_resp.spell_ids
```

Module shape:

```python
"""GET /character/{name}/spells — per-character scribed-spells tier rollup.

Carved out of the original 933-line web/routes/character.py.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException, Request
from pydantic import BaseModel

from census.spells_db import find_by_ids, load_blocklist, strip_roman, unique_highest_entries
from web.limiter import limiter
from web.routes.character import router
from web.routes.character._shared import _get_or_fetch_character

_log = logging.getLogger(__name__)

# ... paste models + handler ...
```

- [ ] **Step 2: Create `web/routes/character/upgrades.py`**

Move from `web/routes/character.py` lines 642-933:
- `_lookup_items_by_name`.
- `class IngredientResponse`, `class UpgradeMaterialsResponse`.
- `@router.get("/character/{name}/upgrade-materials")` handler.
- `class UpgradeRecipesResponse`.
- `@router.get("/character/{name}/upgrade-recipes")` handler.

Update both handlers to use `await _get_or_fetch_character(name)` per the same pattern.

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/character/spells.py web/routes/character/upgrades.py
uv run ruff check web/routes/character/spells.py web/routes/character/upgrades.py
uv run pyright web/routes/character/
uv run pytest tests/web -v -x
```

Full pytest passes against the new package shape.

---

## Task 2b.10: character.py — delete original file (sub-task 3 of 3)

**Files:**
- Delete: `web/routes/character.py`
- Modify: consumers (very limited — `web/app.py` imports the router; `census_refresh.py` imports `_build_char_response`).

- [ ] **Step 1: Grep consumers**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'from web\\.routes\\.character', '--type=py'])"
```

Key consumers to update:
- `web/app.py`: `from web.routes.character import router as character_router` → resolves via the package's `__init__.py`. No change needed.
- `web/census_refresh.py:64`: `from web.routes.character import _build_char_response` — needs update to `from web.routes.character.views import _build_char_response`.
- `web/routes/parses/ingest.py` (Phase 2b.2): `from web.routes.character import _build_char_response` — same update.

- [ ] **Step 2: Delete the old file**

```
rm web/routes/character.py
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/character/ web/census_refresh.py web/routes/parses/ingest.py
uv run ruff check web/routes/character/ web/census_refresh.py web/routes/parses/ingest.py
uv run pyright web/routes/character/ web/census_refresh.py web/routes/parses/ingest.py
uv run pytest tests/ -v -x
```

Full test suite passes.

---

## Task 2b.11: Phase 2b commit checkpoint

After approval, the user stages + commits only the named files.

- [ ] **Step 1: Stage exactly these files**

```
git add web/routes/parses/
git add web/routes/character/
git add web/db/
git add web/app.py
git add web/census_refresh.py
git add tests/web/test_db_migrations.py
# Deleted files (need explicit `git rm` if not already done):
git rm web/routes/parses.py
git rm web/db.py
git rm web/routes/character.py
```

- [ ] **Step 2: Confirm staged set**

```
git status
git diff --staged --stat
```

Expect the three deleted files + the three new packages. If anything else is staged, restore it.

- [ ] **Step 3: Commit**

```
git commit -m "Backend cleanliness Phase 2b: split 3 oversized files

- web/routes/parses.py (1687 lines) → web/routes/parses/ package
  (models.py / ingest.py / list.py / delete.py)  [BE-050]
- web/db.py (1309 lines) → web/db/ package
  (schema.py / migrations.py / users.py / claims.py /
   item_watch.py / tokens.py / servers.py)  [BE-051]
- web/routes/character.py (933 lines) → web/routes/character/ package
  (_shared.py / views.py / spells.py / upgrades.py) — BE-028 dedup
  via _get_or_fetch_character  [BE-053]

Schema additions during the split:
- BE-072: idx_claims_primary on character_claims(discord_id, world, is_primary)
- BE-073: idx_users_access on users(access_status)
- Regression test for [[test-migrations-against-old-db-shape]] memory:
  tests/web/test_db_migrations.py exercises both fresh and v1-shape DBs.

API preserved: every existing `from web import db as users_db`,
`from web.routes.parses import IngestRequest`, etc. resolves unchanged
via the package __init__.py re-exports.

Spec: docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md
Plan: docs/superpowers/plans/2026-05-29-backend-cleanliness.md"
```

Do NOT push. The user reviews + pushes.

---

# Phase 3 — P2: polish (41 items in 3 sub-batches)

After Phase 3: every P2 polish item from the audit is addressed (or explicitly noted as withdrawn during audit). Three sub-batches by category so the diffs stay narrow:

- **3a — Type tightening (~12 items):** Any → TypedDict, missing param annotations, return-type sharpening.
- **3b — Misc small refactors (~14 items):** lru_cache adds, IntEnum tightening, single-use helper inlining.
- **3c — Naming + organisation (~15 items):** rename leftovers, docstring fixes, import-order PEP8, helper extractions.

Each batch ends with its own commit checkpoint.

Note on withdrawn findings (do not require any code change — they're either already fine or duplicates of higher-priority items):
- BE-004 (false positive on initial inspection)
- BE-062 (all three `_reset_for_test` are used)
- BE-086 (bare raise is correct; not a finding)
- BE-100 (duplicate of BE-003 — handled in Phase 1 Task 1.2)
- BE-110 (duplicate of BE-007 — handled in Phase 1 Task 1.5)
- BE-111 (not a finding — module-load constant)
- BE-200 (intentional convention — not a finding)
- BE-206, BE-213, BE-214, BE-235 (all noted as re-read withdrawals in the audit)

That leaves 41 actionable P2 items. They map to the three sub-batches below.

---

## Task 3a.1: Type tightening — `SessionUser`/`TokenUser` annotations (BE-091)

**Files:** every route handler that takes `user: dict`. Expected ~30 sites across `web/routes/`.

Phase 2a created the `SessionUser` / `TokenUser` TypedDict. This task migrates the annotations so pyright catches `user["i"]` typos.

- [ ] **Step 1: Grep `user: dict` route signatures**

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'user:\\s*dict', '--type=py', 'web/routes/'])"
```

- [ ] **Step 2: Per-handler migration**

For each handler:

Before:
```python
async def get_x(user: dict = Depends(require_user_session_or_token)) -> ...:
    ...
```

After:
```python
from web.lib.session_user import TokenUser

async def get_x(user: TokenUser = Depends(require_user_session_or_token)) -> ...:
    ...
```

For `require_user_session` (which returns a `SessionUser`, no token fields), use `SessionUser` instead.

For helpers that take `user: dict` as a parameter (e.g. `_compute_permissions(request, encounters)` reads `request.session.get("user")` and assigns to `user`):

```python
user: SessionUser | None = request.session.get("user")
if not user:
    return ...
```

Pyright will start flagging real bugs — fix them inline. The TypedDict is `total=False` so optional fields can still be `.get(...)`-accessed without a type complaint.

Also update the return type annotation on `require_user_session` / `require_user_session_or_token` themselves (in `web/auth_deps.py`):

```python
def require_user_session(request: Request) -> SessionUser:
    ...


async def require_user_session_or_token(request: Request) -> TokenUser:
    ...
```

- [ ] **Step 3: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright web/
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3a.2: TypedDict-typed local DB return shapes (BE-093)

**Files:** `census/spells_db.py`, `census/recipes_db.py`, `census/zones_db.py`, `census/classes_db.py`, `census/census_store.py`.

Each `find_by_*` / `list_*` currently returns `dict | None` or `list[dict]`. Callers index in with stringly keys (`row["effects"]`, `row["tier"]`) — typos produce a runtime `KeyError`. Define a TypedDict per table and tighten the return types.

- [ ] **Step 1: For each `*_db.py`, define the row TypedDict near the top**

Example for `census/spells_db.py`:

```python
from typing import TypedDict


class SpellRow(TypedDict, total=False):
    """One row out of the spells table (sqlite3.Row → dict)."""
    id: int
    crc: int
    name: str
    tier: int
    tier_name: str
    type: str
    level: int
    given_by: str
    effects: str  # JSON-encoded list of effect dicts
```

Same for `RecipeRow` in `recipes_db.py`, `ZoneRow` in `zones_db.py`, etc. Use `total=False` so callers don't need to assert every key — but with the TypedDict in place, pyright will at least know which keys are valid.

- [ ] **Step 2: Update return-type annotations**

```python
def find_by_id(spell_id: int, path: Path = DB_PATH) -> SpellRow | None:
    ...


def find_by_ids(ids: list[int], path: Path = DB_PATH) -> list[SpellRow]:
    ...
```

- [ ] **Step 3: Verify**

```
uv run ruff format census/spells_db.py census/recipes_db.py census/zones_db.py census/classes_db.py census/census_store.py
uv run ruff check census/
uv run pyright census/ web/
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3a.3: Per-payload Pydantic models for ingest combatants (BE-090)

**Files:** `web/routes/parses/ingest.py`, `web/routes/parses/models.py`.

Combatants/damage_types/attack_types in the ingest payload are typed as `list[dict[str, Any]]`. Define Pydantic models so the keys are validated.

- [ ] **Step 1: Define the models in `web/routes/parses/models.py`**

```python
class IngestCombatant(BaseModel):
    """One ACT combatant row as shipped by the plugin."""
    model_config = {"extra": "allow"}  # forwards-compat with newer plugin versions

    name: str
    ally: bool | None = None
    damage: int | None = None
    healed: int | None = None
    deaths: int | None = None
    kills: int | None = None
    # ... (every field the existing _combatants_from_payload reads via r.get(...)) ...


class IngestDamageType(BaseModel):
    model_config = {"extra": "allow"}
    # ... fields ...


class IngestAttackType(BaseModel):
    model_config = {"extra": "allow"}
    # ... fields ...
```

Then change `IngestEncounter` to use the new types:

```python
class IngestEncounter(BaseModel):
    # ... existing fields ...
    combatants: list[IngestCombatant] = Field(default_factory=list)
    damage_types: list[IngestDamageType] = Field(default_factory=list)
    attack_types: list[IngestAttackType] = Field(default_factory=list)
```

- [ ] **Step 2: Update `_combatants_from_payload` + siblings**

The helpers in `ingest.py` already consume the parsed Pydantic model — they just need their parameter types tightened:

```python
def _combatants_from_payload(rows: list[IngestCombatant], encid: str) -> list[Combatant]:
    ...
```

Inside the helpers, `r.get("name")` → `r.name` (Pydantic attribute access). A typo at this point is caught at type-check time.

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/parses/
uv run ruff check web/routes/parses/
uv run pyright web/routes/parses/
uv run pytest tests/web -v -x
```

All clean. Pay particular attention to the ingest happy-path test in `tests/web/test_parses_ingest.py` — older plugin versions may send fields the new models forbid; `model_config = {"extra": "allow"}` keeps them working.

---

## Task 3a.4: Misc small type fixes (BE-201, BE-234)

**Files:** `web/routes/guild.py:166`, `web/routes/zones.py:226-247`.

- [ ] **Step 1: BE-201 — type the parameter on `_int`**

`web/routes/guild.py:166`: `def _int(v):` → `def _int(v: object) -> int | None:` (after the migration in 2c.3 this might already be imported as an alias of `coerce_int` — if so, delete the local def entirely).

- [ ] **Step 2: BE-234 — sharpen `_resolve_primary_guild` signature**

`web/routes/zones.py:226-247`. Signature comment says "Either value may be None". Tighten:

Before:
```python
async def _resolve_primary_guild(discord_id: str) -> tuple[str | None, str | None]:
```

After: same signature but add a docstring `Returns: (character_name | None, guild_name | None) — both may be None when no primary character has yet resolved a guild.`

This is mostly a documentation tidy — the typing was already correct.

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/guild.py web/routes/zones.py
uv run ruff check web/routes/guild.py web/routes/zones.py
uv run pyright web/routes/guild.py web/routes/zones.py
```

All clean.

---

## Task 3a.5: `CacheName` literal + cache-instance typing (BE-202)

**Files:** `web/cache.py`

Today `name="character"` etc. is stringly-typed; pyright can't narrow at call sites.

- [ ] **Step 1: Add a `Literal`**

```python
from typing import Literal

CacheName = Literal["character", "guild", "claim", "aa"]


class TTLCache:
    def __init__(
        self,
        ttl: int = 300,
        max_age: int | None = None,
        name: CacheName = "default",  # type: ignore[assignment]  # "default" is fallback only
        maxsize: int = 1000,
    ):
        ...
```

(The `# type: ignore` is because `"default"` isn't in the Literal — it's only used by the bare-instance default; every real cache instance passes a named one. The alternative is widening the Literal which loses the type-safety win.)

- [ ] **Step 2: Verify**

```
uv run ruff format web/cache.py
uv run ruff check web/cache.py
uv run pyright web/cache.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 3a.6: Type-fixes commit checkpoint

- [ ] **Step 1: Stage**

```
git add -u
```

- [ ] **Step 2: Confirm + commit**

```
git status
git diff --staged --stat
git commit -m "Backend cleanliness Phase 3a: type tightening

- BE-091: SessionUser/TokenUser TypedDict applied to ~30 route handlers
- BE-093: TypedDict return shapes for census/*_db.py find_by_*/list_*
- BE-090: Pydantic IngestCombatant/IngestDamageType/IngestAttackType
- BE-201/234: small per-function annotation tightening
- BE-202: CacheName Literal in web/cache.py

Spec: docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md
Plan: docs/superpowers/plans/2026-05-29-backend-cleanliness.md"
```

Do NOT push.

---

## Task 3b.1: lru_cache adds for AA tree data (BE-203)

**Files:** `web/routes/aa.py:139-167`

`get_aa_tree` parses tree JSON every request. Cache at module load.

- [ ] **Step 1: Add the cache**

```python
from functools import lru_cache


@lru_cache(maxsize=128)
def _load_tree_for_response(tree_id: int) -> AATreeResponse:
    """Parse + build the AATreeResponse for a single tree id.

    Invalidation: tree JSON is static reference data on disk; rebuild via a
    process restart. If the data/AAs/trees/ files ever become hot-editable,
    add a sibling _load_tree_for_response.cache_clear() on the mutation
    path — see the canonical pattern at web/routes/rankings.py:195-203
    (invalidate_zones_cache).
    """
    # ... existing parse logic from get_aa_tree's body, returning AATreeResponse ...
```

Update `get_aa_tree` to call `_load_tree_for_response(tree_id)` and return the cached AATreeResponse.

- [ ] **Step 2: Verify**

```
uv run ruff format web/routes/aa.py
uv run ruff check web/routes/aa.py
uv run pyright web/routes/aa.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 3b.2: Bot tidy — dedup tree index loader + lazy-import promotion + unused logger (BE-205, BE-204, BE-220, BE-238)

**Files:** `bot/cogs/aacheck.py:23-33`, `web/routes/aa.py:46-56`, `bot/bot.py:23-27`, `bot/cogs/items.py:12`, `image/aa_tree.py`.

- [ ] **Step 1: BE-205 + BE-204 — dedup `_load_tree_index` to `image/aa_tree.py`**

Both `web/routes/aa.py:45-56` and `bot/cogs/aacheck.py:23-33` parse the same JSON and key it the same way. Extract to `image/aa_tree.py` (already hosts `detect_tree_type` — fits the module's role):

```python
# image/aa_tree.py
@lru_cache(maxsize=1)
def load_tree_index() -> dict[str, AATreeIndexEntry]:
    """Return {tree_id_str: {name, type, ...}} parsed from data/AAs/trees/*.json.
    Single source for both web and bot consumers. Cached at module load.

    BE-204: log at WARNING on per-file parse failure so a corrupt JSON doesn't
    silently disappear from the index.
    """
    out = {}
    for path in _TREES_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            # ... extract + populate ...
        except Exception as exc:
            _log.warning("[aa] Failed to load tree index %s: %s", path.name, exc)
    return out
```

Both consumers import `from image.aa_tree import load_tree_index` and replace their per-call file loops with `load_tree_index()`.

- [ ] **Step 2: BE-220 — promote lazy cog imports**

`bot/bot.py:23-27` — five cog imports lazy inside `setup_hook`. Move to module top:

Before (inside `setup_hook`):
```python
async def setup_hook(self) -> None:
    from bot.cogs.items import ItemCog
    from bot.cogs.guild import GuildCog
    # ... etc
```

After (module top):
```python
from bot.cogs.aacheck import AACheckCog
from bot.cogs.guild import GuildCog
from bot.cogs.items import ItemCog
from bot.cogs.spellcheck import SpellCheckCog


class Bot(commands.Bot):
    async def setup_hook(self) -> None:
        await self.add_cog(ItemCog(self))
        await self.add_cog(GuildCog(self))
        # ... etc
```

Run pytest — if a circular import shows up, the lazy import was load-bearing; revert and document the cycle.

- [ ] **Step 3: BE-238 — drop unused logger in `bot/cogs/items.py`**

Grep `bot/cogs/items.py` for any `_log.` call. If none, delete the `_log = logging.getLogger(__name__)` declaration + the `import logging`.

- [ ] **Step 4: Verify**

```
uv run ruff format bot/ web/routes/aa.py image/aa_tree.py
uv run ruff check bot/ web/routes/aa.py image/aa_tree.py
uv run pyright bot/ web/routes/aa.py image/aa_tree.py
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3b.3: Sub-helper extractions (BE-221, BE-228)

**Files:** `web/routes/raid_strategies.py:215-296`, `web/routes/parses/ingest.py` (the post-2b home of `_ingest_payload_sync`).

- [ ] **Step 1: BE-221 — split `_write_overview_sync`**

`_write_overview_sync` in `raid_strategies.py` is 80 lines that branch on "create new" vs "update existing". Split into:

```python
def _create_overview_sync(...) -> int:
    """Insert a brand-new raid_zone overview row."""
    ...


def _update_overview_sync(zone_id: int, ...) -> bool:
    """Update an existing raid_zone overview row + write a revision entry."""
    ...


def _write_overview_sync(...):
    """Dispatch — picks the right sub-helper based on whether the zone already exists."""
    if existing_zone_id is None:
        return _create_overview_sync(...)
    return _update_overview_sync(existing_zone_id, ...)
```

- [ ] **Step 2: BE-228 — split `_ingest_payload_sync`**

The 65-line helper has a clear structure: validate → upsert encounter → upsert combatants → upsert damage_types → upsert attack_types → commit. Extract one helper per section. The dispatcher stays in `_ingest_payload_sync`.

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/raid_strategies.py web/routes/parses/ingest.py
uv run ruff check web/routes/raid_strategies.py web/routes/parses/ingest.py
uv run pyright web/routes/raid_strategies.py web/routes/parses/ingest.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 3b.4: Misc constants + IntEnum + frozen dicts (BE-207, BE-208, BE-223, BE-225)

**Files:** `web/routes/parses/list.py`, `web/routes/parses/ingest.py`, `parses/db.py`, `census/recipes_db.py`.

- [ ] **Step 1: BE-207 — `SIZE_BUCKETS` as MappingProxyType**

`web/routes/parses/list.py`: `SIZE_BUCKETS: dict[str, tuple[int, int]]` → frozen via `MappingProxyType`:

```python
from types import MappingProxyType
from collections.abc import Mapping

SIZE_BUCKETS: Mapping[str, tuple[int, int]] = MappingProxyType({
    "individual": (1, 1),
    "group": (2, 6),
    "raid12": (7, 12),
    "raid24": (13, 24),
})
```

- [ ] **Step 2: BE-208 — `_PLAYER_COUNT_SQL` as triple-quoted string**

`web/routes/parses/list.py`. Convert the concatenation:

Before:
```python
_PLAYER_COUNT_SQL = (
    "SELECT COUNT(*) FROM combatants c "
    "WHERE c.encounter_id = e.id "
    ...
)
```

After:
```python
_PLAYER_COUNT_SQL = """\
    SELECT COUNT(*) FROM combatants c
    WHERE c.encounter_id = e.id
      AND c.ally = 1
      AND c.name != ''
      AND c.name != 'Unknown'
      AND instr(c.name, ' ') = 0
"""
```

- [ ] **Step 3: BE-223 — `_DAMAGE_SWING_TYPES` as IntEnum**

`parses/db.py:863-877`. Convert `(1, 2)` tuples into a named enum.

```python
from enum import IntEnum


class SwingType(IntEnum):
    """ACT swingtype values — see parses/act_reader.py for the source."""
    MELEE = 1
    NONMELEE = 2
    HEAL = 3
    CURE = 20
    PROC = 100


_DAMAGE_SWING_TYPES = frozenset({SwingType.MELEE, SwingType.NONMELEE})
```

- [ ] **Step 4: BE-225 — `SPELL_TIERS` as IntEnum**

`census/recipes_db.py:31-39`. The audit calls it out as a candidate but warns it'd touch every consumer of the constant. Verify the consumer count first — if it's just internal to recipes_db.py, do the conversion. If external callers depend on the tuple shape, defer with a comment.

- [ ] **Step 5: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3b.5: Delete dead code + inline single-use helper (BE-061, BE-060, BE-232, BE-233)

**Files:** `parses/act_reader.py`, `parses/db.py`, `web/db/item_watch.py`, `web/routes/parses/ingest.py`.

- [ ] **Step 1: BE-060 — delete `delete_encounters_by_filter`**

`parses/db.py:781-815`. Helper is unused by production (only tests reference it). Delete the function. Update the test file `tests/parses/test_db.py:701-738` — delete the four tests that called it.

- [ ] **Step 2: BE-061 — drop unused `combatant_name` argument**

`parses/act_reader.py:223-272, 292-345`. `get_damage_types` and `get_attack_types` accept `combatant_name: str | None = None`. Grep callers — confirm none pass it:

```
uv run python -c "import subprocess; subprocess.run(['rg', '-n', 'get_damage_types\\(|get_attack_types\\(', '--type=py'])"
```

If no caller passes the argument, drop it from both signatures + the conditional branches that test for it.

- [ ] **Step 3: BE-232 — inline `_run` in `update_item_watch_check`**

`web/db/item_watch.py` (post-2b6 home). The `_run(path, sql, params)` helper has exactly one caller — inline the body.

- [ ] **Step 4: BE-233 — drop single-use `loop` variable**

`web/routes/parses/ingest.py`. The variable was already migrated to `run_sync` in Phase 2c.1 — confirm via grep that no `loop = asyncio.get_event_loop()` line remains here. If one does, this task removes it.

- [ ] **Step 5: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3b.6: Misc-refactors commit checkpoint

- [ ] **Step 1: Stage + commit**

```
git add -u
git status
git diff --staged --stat
git commit -m "Backend cleanliness Phase 3b: misc small refactors

- BE-203: @lru_cache on AA tree JSON parsing
- BE-205/204: shared image.aa_tree.load_tree_index for web + bot
- BE-220: promote bot/bot.py lazy cog imports to module top
- BE-238: drop unused logger in bot/cogs/items.py
- BE-221: split _write_overview_sync into create + update sub-helpers
- BE-228: split _ingest_payload_sync into focused sections
- BE-207: SIZE_BUCKETS as MappingProxyType
- BE-208: _PLAYER_COUNT_SQL as triple-quoted
- BE-223: SwingType IntEnum
- BE-225: SPELL_TIERS conditional conversion to IntEnum
- BE-060: delete unused delete_encounters_by_filter + its tests
- BE-061: drop unused combatant_name parameter
- BE-232: inline single-use _run helper
- BE-233: drop residual loop = asyncio.get_event_loop() line

Spec: docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md
Plan: docs/superpowers/plans/2026-05-29-backend-cleanliness.md"
```

Do NOT push.

---

## Task 3c.1: Rename leftovers + Prometheus label coordination (BE-095, BE-104, BE-105)

**Files:** `web/metrics.py:84`, `census/config.py:43`, `web/config.py`.

- [ ] **Step 1: BE-095 — Prometheus `Info("eq2_companion", ...)` rename**

`web/metrics.py:84`. The Prometheus label rename is a coordination point — any dashboard / alert that filters on `eq2_companion` will need to switch to `eq2_lexicon`.

Approach: ship BOTH labels in parallel for one release, then drop the old one in a follow-up.

```python
# Old metric kept alive for one release so Grafana dashboards have time to
# switch their filters from eq2_companion → eq2_lexicon. Drop in the next
# polish PR after dashboards have moved.
APP_INFO_LEGACY = Info("eq2_companion", "DEPRECATED — use eq2_lexicon")
APP_INFO = Info("eq2_lexicon", "Per-deployment app info (world, version).")
```

And in the lifespan startup:
```python
APP_INFO.info({"world": _WORLD, "version": "0.1.0"})
APP_INFO_LEGACY.info({"world": _WORLD, "version": "0.1.0"})  # legacy; drop next release
```

Document in the commit message that the user needs to update dashboards before the follow-up PR drops `APP_INFO_LEGACY`.

- [ ] **Step 2: BE-104 — empty default for LAUNCH_DT_ISO**

`census/config.py:43`:

Before:
```python
LAUNCH_DT_ISO: str = os.getenv("LAUNCH_DT", "2026-06-09T20:00:00Z")
```

After:
```python
# Empty default — the file docstring + frontend code treat empty/past dates
# as "hide the countdown". A hardcoded past date would silently surface as
# a stale countdown widget for any contributor running without LAUNCH_DT set.
LAUNCH_DT_ISO: str = os.getenv("LAUNCH_DT", "")
```

- [ ] **Step 3: BE-105 — commit to or delete the `web/config.py` re-export shim**

The current shim re-exports 8 names from `census/config.py`. Per the audit option, **commit to the split**: move web-only config into `web/config.py` (specifically `SESSION_COOKIE_DOMAIN` + `CORS_ORIGINS`), have other route files import from there. Bot-only config stays in `census/config.py`.

Update `web/config.py`:

```python
"""Web-app-specific configuration.

Bot-only / shared config lives in census/config.py. This module owns config
that ONLY the web layer cares about — session cookies, CORS, anything that
doesn't make sense for the Discord bot process."""
from __future__ import annotations

import os

from census.config import (  # re-exported for backward compat — web routes use these constants
    ALLOWED_SERVERS,
    LAUNCH_DT_ISO,
    SERVER_MAX_LEVEL,
    SERVICE_ID,
    WORLD,
)

SESSION_COOKIE_DOMAIN: str | None = os.getenv("SESSION_COOKIE_DOMAIN") or None
CORS_ORIGINS: list[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
```

Then grep for any `from census.config import SESSION_COOKIE_DOMAIN` / `from census.config import CORS_ORIGINS` and redirect to `web.config`.

- [ ] **Step 4: Verify**

```
uv run ruff format web/metrics.py census/config.py web/config.py
uv run ruff check web/metrics.py census/config.py web/config.py
uv run pyright web/ census/
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3c.2: PEP8 import ordering + `ALLOWED_SERVERS` case (BE-222, BE-103)

**Files:** `web/routes/admin.py:249`, `web/routes/parses/ingest.py`.

- [ ] **Step 1: BE-222 — move mid-module import to top**

`web/routes/admin.py:249`: `from web.routes.role_requests import RoleRequestEntry  # noqa: E402` is mid-module. Move to the top alongside the other imports. Delete the `# noqa: E402`.

If a real circular-import shows up (the original reason for the noqa), keep the lazy import but ADD a comment explaining the cycle:

```python
# Lazy import — top-level import would cycle through web.routes.role_requests
# → web.db.users → ... → web.routes.admin.
from web.routes.role_requests import RoleRequestEntry  # noqa: E402
```

- [ ] **Step 2: BE-103 — `ALLOWED_SERVERS` casing**

`web/routes/parses/ingest.py`. The pre-lowered `_ALLOWED_SERVERS_LOWER` is computed at module load (good), but the comparison `sanitized_server.lower() in _ALLOWED_SERVERS_LOWER` loses case info that `_sanitize_world` just preserved. Decide:

- Per the audit's note "Mixing means a future 'rename Wuoshi → Wuoshi-with-apostrophe' via case-change works in one place but not the other" — **commit to case-insensitive throughout**. Drop the case preservation; lowercase server names everywhere.

Replace:
```python
sanitized_server = _sanitize_world(raw_server)
if sanitized_server is None:
    raise HTTPException(...)
if sanitized_server.lower() not in _ALLOWED_SERVERS_LOWER:
    raise HTTPException(...)
```

With:
```python
sanitized_server = _sanitize_world(raw_server)
if sanitized_server is None:
    raise HTTPException(...)
sanitized_lower = sanitized_server.lower()
if sanitized_lower not in _ALLOWED_SERVERS_LOWER:
    raise HTTPException(...)
sanitized_server = sanitized_lower   # canonicalised
```

(The DB world column then always stores lower-case names. If any existing record has mixed-case, an admin one-off migration normalises them — but per the audit the current DB is small enough that this is fine.)

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/admin.py web/routes/parses/ingest.py
uv run ruff check web/routes/admin.py web/routes/parses/ingest.py
uv run pyright web/routes/
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3c.3: Server-context contextmanager + correct URL parsing (BE-215, BE-216)

**Files:** `web/server_context.py`

- [ ] **Step 1: BE-215 — combine `set_active_server` + `reset_active_server` into one context manager**

```python
import contextlib
from collections.abc import Iterator


@contextlib.contextmanager
def active_server(record: ServerRecord) -> Iterator[None]:
    """Push ``record`` onto the per-request server contextvar; pop on exit."""
    token = _active_server_var.set(record)
    try:
        yield
    finally:
        _active_server_var.reset(token)
```

Update the middleware to use:

Before:
```python
set_active_server(server_record)
try:
    response = await call_next(request)
finally:
    reset_active_server()
```

After:
```python
with active_server(server_record):
    response = await call_next(request)
```

Keep `set_active_server` / `reset_active_server` as thin wrappers if tests use them; otherwise delete.

- [ ] **Step 2: BE-216 — replace manual `qs.split("&")` with `urllib.parse.parse_qs`**

`web/server_context.py:131-145`. The middleware parses `?server=foo` from the ASGI `scope["query_string"]` by hand. URL-encoded values would be mishandled. Replace:

Before:
```python
qs = scope.get("query_string", b"").decode()
for part in qs.split("&"):
    if part.startswith("server="):
        server_override = part[len("server="):]
        break
```

After:
```python
from urllib.parse import parse_qs

qs = scope.get("query_string", b"").decode()
server_override = parse_qs(qs).get("server", [None])[0]
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/server_context.py
uv run ruff check web/server_context.py
uv run pyright web/server_context.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 3c.4: Mount + router include tables (BE-217, BE-218)

**Files:** `web/app.py`

Convert the 26-line router-include block + 4-line mount block into data-driven loops. Mostly cosmetic — the readability win comes from a clear table.

- [ ] **Step 1: BE-217 — mount table**

```python
_STATIC_MOUNTS: list[tuple[str, Path]] = [
    ("/", _FRONTEND_DIST),
    ("/icons", _ICONS_DIR),
    ("/spell-icons", _SPELL_ICONS_DIR),
    ("/aa-icons", _AA_ICONS_DIR),
]

for mount, dir_path in _STATIC_MOUNTS:
    if dir_path.exists():
        app.mount(
            mount,
            StaticFiles(directory=dir_path, html=mount == "/"),
            name=mount.strip("/") or "frontend",
        )
```

- [ ] **Step 2: BE-218 — router include table**

```python
_ROUTERS: list[APIRouter] = [
    health_router,
    auth_router,
    auth_tokens_router,
    character_router,
    item_router,
    claim_router,
    admin_router,
    guild_router,
    guild_officer_router,
    item_watch_router,
    characters_router,
    # ... (the full list — copy from the existing 26 include_router lines) ...
]

for r in _ROUTERS:
    app.include_router(r, prefix="/api")
```

- [ ] **Step 3: Verify**

```
uv run ruff format web/app.py
uv run ruff check web/app.py
uv run pyright web/app.py
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3c.5: TTLCache default factory (BE-219)

**Files:** `web/cache.py`

Four cache instances repeat `TTLCache(ttl=300, max_age=3600, name=…, maxsize=…)`. Defaults are already 300/3600; the explicit per-instance value is just clutter.

- [ ] **Step 1: Drop redundant default args**

Before:
```python
character_cache: TTLCache = TTLCache(ttl=300, max_age=3600, name="character", maxsize=500)
guild_cache: TTLCache = TTLCache(ttl=300, max_age=3600, name="guild", maxsize=50)
claim_cache: TTLCache = TTLCache(ttl=300, max_age=3600, name="claim", maxsize=200)
aa_cache: TTLCache = TTLCache(ttl=300, max_age=3600, name="aa", maxsize=200)
```

After (post-2c.10 the `CACHE_STALE_TTL_S` / `CACHE_MAX_AGE_S` constants already replaced the literals):
```python
character_cache: TTLCache = TTLCache(name="character", maxsize=500)
guild_cache: TTLCache = TTLCache(name="guild", maxsize=50)
claim_cache: TTLCache = TTLCache(name="claim", maxsize=200)
aa_cache: TTLCache = TTLCache(name="aa", maxsize=200)
```

(The class defaults `ttl=CACHE_STALE_TTL_S, max_age=CACHE_MAX_AGE_S` should ALREADY reference the constants from Phase 2c.10; if they don't, fix that here.)

- [ ] **Step 2: Verify**

```
uv run ruff format web/cache.py
uv run ruff check web/cache.py
uv run pyright web/cache.py
uv run pytest tests/web -v -x
```

All clean.

---

## Task 3c.6: Misc naming (BE-226, BE-230, BE-231, BE-239)

**Files:** various.

- [ ] **Step 1: BE-226 — move `BASE_URL` to config**

`census/client.py:30`: `BASE_URL = "https://census.daybreakgames.com"` is a module-level constant. Move to `census/config.py`:

```python
# census/config.py
CENSUS_BASE_URL: str = "https://census.daybreakgames.com"
```

```python
# census/client.py
from census.config import CENSUS_BASE_URL as BASE_URL
```

- [ ] **Step 2: BE-230 — source `_ADVENTURE_CLASSES` from classes_db**

`web/routes/recipes.py:79-106`. The hardcoded list of 25 strings duplicates `census/classes_db.py:CLASS_SEED`. Source it:

```python
from census.classes_db import iter_adventure_class_names  # add the iter helper if it doesn't exist

_ADVENTURE_CLASSES = tuple(iter_adventure_class_names())
```

If the helper doesn't exist in `classes_db.py`, add it as a small wrapper around the existing CLASS_SEED data.

- [ ] **Step 3: BE-231 — source class colours from a single canonical place**

`census/classes_db.py:30`: `_F, _P, _S, _M = "#f87171", "#4ade80", "#fbbf24", "#93b4ff"`. The frontend now uses tokens — but the BACKEND class colours still flow through this constant for use in renders / image generation. Define them once in `census/constants.py` (which already exists per CLAUDE.md):

```python
# census/constants.py
CLASS_ARCHETYPE_COLOURS = {
    "FIGHTER": "#f87171",
    "PRIEST": "#4ade80",
    "SCOUT": "#fbbf24",
    "MAGE": "#93b4ff",
}
```

Update `classes_db.py` to import:
```python
from census.constants import CLASS_ARCHETYPE_COLOURS as _ARCHETYPE_COLOURS
_F = _ARCHETYPE_COLOURS["FIGHTER"]
_P = _ARCHETYPE_COLOURS["PRIEST"]
# ... etc
```

- [ ] **Step 4: BE-239 — rename misleading `_resolve_primary_guild_cached`**

`web/routes/raid_strategies.py:51-76`. Post-Phase-2c.8 this is a thin wrapper around `web.lib.primary_guild.cached_primary_guild`. The "cached" in the name is misleading — it doesn't cache its own result, it reads from `character_cache`. Rename to `_primary_guild_from_cache`:

```python
async def _primary_guild_from_cache(discord_id: str) -> str | None:
    """Return the user's primary character's guild from character_cache, or None."""
    ...
```

Update the call site in `web/auth_deps.py:215` (the lazy import in `require_capability`).

- [ ] **Step 5: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3c.7: Misc cosmetic cleanups (BE-209, BE-210, BE-211, BE-212, BE-227, BE-229, BE-236, BE-237, BE-240)

**Files:** various. These are tiny per-file edits batched together to avoid a "10 commits for 10 trivial things" outcome.

- [ ] **Step 1: BE-209 — column-map iteration in `_combatants_from_payload`**

Already partially addressed via the Pydantic migration in 3a.3. If `_combatants_from_payload` still has 30 `r.get(...)` lines, build a `_COLUMN_MAP: dict[str, str]` and iterate.

- [ ] **Step 2: BE-210 — `bosses` as dict if needed**

`web/routes/raid_strategies.py:163-167`. Audit notes this is not on a hot path; defer with a comment instead of touching. (Confirm in your task notes that this is intentionally not done.)

- [ ] **Step 3: BE-211 — query-builder helper for WHERE clauses**

`web/db/users.py` (post-2b6 home of `list_role_requests`). Many files have the `where_sql = "WHERE " + " AND ".join(where)` pattern. Extract one small helper:

```python
# web/lib/sql_helpers.py (new module)
def build_where(clauses: list[str]) -> str:
    """Return 'WHERE c1 AND c2 AND ...' or '' for an empty list."""
    return "WHERE " + " AND ".join(clauses) if clauses else ""
```

Migrate `list_role_requests` + any other site that builds dynamic WHERE clauses. ONE site is fine — the helper exists for next time.

- [ ] **Step 4: BE-212 — name the chunk constant**

`web/routes/zones.py:283-313`. Post-Phase-2c.10 this already imports `SQLITE_VAR_CHUNK_SAFE`. Confirm.

- [ ] **Step 5: BE-227 — `_VALID_WORLD_RE` defence-in-depth comment**

Already covered by Phase 2c.9 migration to `web.lib.validation`. If a comment was lost during migration, restore it.

- [ ] **Step 6: BE-229 — DB collector connection pool**

`web/metrics.py:111-191`. The `_DBCollector.collect` re-opens 3 connections every 30s scrape. Move to module-level read-only connections that stay open:

```python
class _DBCollector:
    def __init__(self) -> None:
        self._conns: dict[str, sqlite3.Connection] = {}

    def _get_conn(self, name: str, path: Path) -> sqlite3.Connection | None:
        conn = self._conns.get(name)
        if conn is None and path.exists():
            conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
            self._conns[name] = conn
        return conn
    # ... existing collect() uses self._get_conn(...) instead of opening per scrape ...
```

- [ ] **Step 7: BE-236 — invalidate `find_by_crc` cache on upsert_spells**

`census/spells_db.py`. The `@lru_cache(maxsize=4096)` on `find_by_crc` doesn't invalidate. Add a call to `find_by_crc.cache_clear()` in `upsert_spells`:

```python
def upsert_spells(rows: list[dict], conn: sqlite3.Connection | None = None) -> None:
    # ... existing INSERT/UPDATE logic ...
    find_by_crc.cache_clear()  # spell data changed; stale CRC lookups would lie
```

- [ ] **Step 8: BE-237 — already covered by Phase 2c.12 (BE-025 dedup)**

Confirm `_cached_snapshots` and `_resolve_combatant_snapshots` share the `_snapshot_from_cache` helper. If not, this task does it.

- [ ] **Step 9: BE-240 — drop single-use `loop` variable**

`web/routes/raid_strategies.py:559`. Same as BE-233 — post-Phase-2c.1 this should already be gone. If not, do it here.

- [ ] **Step 10: Verify**

```
uv run ruff format <touched-files>
uv run ruff check <touched-files>
uv run pyright <touched-files>
uv run pytest tests/ -v -x
```

All clean.

---

## Task 3c.8: Per-server prewarm + dev_backend.ps1 cleanup (BE-116, BE-045 follow-up)

**Files:** `web/routes/character/views.py:389-436` (post-2b home of `prewarm_character_cache`), `scripts/dev_backend.ps1` (if present).

- [ ] **Step 1: BE-116 — prewarm iterates the server registry**

`prewarm_character_cache` only pre-warms the default server. For Wuoshi-only users, every page on Wuoshi starts cold for 10s. Per the audit:

```python
async def prewarm_character_cache() -> None:
    from web.db import list_servers_sync
    from web.lib.executor import run_sync

    servers = await run_sync(list_servers_sync)
    for srv in servers:
        if not srv.get("is_public", True):
            continue
        await _prewarm_for_world(srv["world"])


async def _prewarm_for_world(world: str) -> None:
    # ... existing prewarm body, but accept a world parameter explicitly
    # instead of relying on current_world() ...
```

The existing semaphore (3 concurrent Census fetches) limits across ALL worlds combined — the per-server iteration just changes which character set warms in which order.

- [ ] **Step 2: BE-045 follow-up — remove dev_backend.ps1 graceful-shutdown workaround**

The pre-Phase-2a `--timeout-graceful-shutdown 2` workaround in `dev_backend.ps1` exists because background tasks weren't tracked. Phase 2a.13's lifespan fix made it unnecessary. Drop the flag from the script's uvicorn args.

Verify locally: `./scripts/dev_backend.ps1` should start + exit cleanly on Ctrl-C without the workaround.

- [ ] **Step 3: Verify**

```
uv run ruff format web/routes/character/views.py
uv run ruff check web/routes/character/views.py
uv run pyright web/routes/character/views.py
uv run pytest tests/ -v -x
```

All clean. Manual smoke test of the dev backend (per the convention #11 — single-process check).

---

## Task 3c.9: Naming + organisation commit checkpoint

- [ ] **Step 1: Stage + commit**

```
git add -u
git status
git diff --staged --stat
git commit -m "Backend cleanliness Phase 3c: naming + organisation

- BE-095: Prometheus eq2_companion → eq2_lexicon (legacy kept in parallel)
- BE-104: empty LAUNCH_DT_ISO default (hides countdown by default)
- BE-105: commit to web.config split — web-only keys moved here
- BE-222: PEP8 import ordering in admin.py
- BE-103: case-insensitive ALLOWED_SERVERS throughout
- BE-215: server_context active_server context manager
- BE-216: parse_qs replaces hand-rolled query-string parsing
- BE-217/218: data-driven mount + router-include tables
- BE-219: drop redundant TTLCache default args
- BE-226: CENSUS_BASE_URL moves to census.config
- BE-230: _ADVENTURE_CLASSES sourced from classes_db
- BE-231: CLASS_ARCHETYPE_COLOURS canonical in census.constants
- BE-239: _resolve_primary_guild_cached → _primary_guild_from_cache rename
- BE-209/211/229/236/237/240: misc tiny tidy-ups
- BE-116: prewarm iterates the server registry
- BE-045 followup: dev_backend.ps1 graceful-shutdown workaround removed

Dashboard migration note for the user: any Grafana dashboard filtering on
the eq2_companion Prometheus metric should switch to eq2_lexicon before
the next polish PR (which drops the legacy parallel metric).

Spec: docs/superpowers/specs/2026-05-29-backend-cleanliness-audit.md
Plan: docs/superpowers/plans/2026-05-29-backend-cleanliness.md"
```

Do NOT push.

---

# Done

All 108 findings addressed:
- 11 P0 (Phase 1)
- 56 P1 (Phases 2a/2b/2c)
- 41 P2 actionable + 10 withdrawn = 51 listed (Phase 3)

After the user pushes Phases 1 → 2a → 2b → 2c → 3a → 3b → 3c (in that order, with their own review between each), the backend matches the level of cleanliness the frontend audit achieved.

For agentic workers picking up execution: see the file-by-file list at the top of this plan. The recommended execution mode is **Subagent-Driven** — each task is small + self-contained + has its own verification step, and the phase boundaries are explicit commit checkpoints the user runs after review.

---

# Appendix A — Additional P1/P2 tasks (not yet bundled into a sub-batch above)

The cross-reference between this plan and the spec surfaced 11 findings that needed dedicated treatment. They land in the existing phase commits per the file each one touches.

## A.1: BE-052 — Split `web/routes/act_triggers.py` (1098 lines)

**Files:** `web/routes/act_triggers.py` → `web/routes/act/triggers.py` + `web/routes/act/spell_timers.py` + `web/routes/act/xml_import.py` + `web/routes/act/xml_export.py`.

Mirrors the parses/character split convention. **Land in Phase 2b** as Task 2b.12 (after 2b.11's commit checkpoint, before Phase 2c). Same template as Task 2b.8 — create the package, extract by concern, update consumers.

Same 4-step shape: extract sub-modules with their own state + helpers; trim parent to a thin shell + verify. Each sub-module gets its own `__init__.py` re-export hook.

Verify per the standard template; the touched-files list is `web/routes/act/` + any consumer that did `from web.routes.act_triggers import ...`.

Commit-checkpoint message addition: `- BE-052: web/routes/act_triggers.py (1098 lines) → web/routes/act/ package`.

## A.2: BE-054 — Split `web/routes/guild.py` (857 lines)

**Files:** `web/routes/guild.py` (857 lines) → keep the route handlers in `web/routes/guild.py` + extract the cache-orchestration helpers to a new `web/guild_cache.py` (mirrors `web/census_refresh.py`'s shape).

The cache helpers (`_fetch_and_cache_guild`, `_persist_and_publish_guild`, `_overview_to_char_response`) are imported by `census_refresh.py`, `parses/ingest.py`, `notifications.py`, `auth_deps.py` — effectively shared infrastructure, not route code.

**Land in Phase 2b** as Task 2b.13. After the extraction:
- `web/routes/guild.py` keeps the route handlers + `_officer_chars` / `_roster_rank_map` / `_OFFICER_RANKS`.
- `web/guild_cache.py` owns the cache flow + `_overview_to_char_response`.

The lazy in-function imports in 6+ files (introduced to dodge `web.routes.guild` ↔ caller cycles) become module-level imports of `web.guild_cache`.

Commit-checkpoint message addition: `- BE-054: web/routes/guild.py cache helpers → web/guild_cache.py`.

## A.3: BE-055 — Split `census/raids_db.py` (962 lines)

**Files:** `census/raids_db.py` → `census/raids_db.py` (zones + encounters + revisions) + `census/raids_act_db.py` (act_triggers + act_spell_timers).

**Land in Phase 2b** as Task 2b.14. Both share `init_db` + `DB_PATH` — keep the init helper in `raids_db.py` and have `raids_act_db.py` import it. The ACT tables support the editor route only, so the split aligns with the act_triggers route split from A.1.

Commit-checkpoint message addition: `- BE-055: census/raids_db.py (962 lines) → raids_db.py + raids_act_db.py`.

## A.4: BE-070 — Schema-vs-migrations drift assertion

**Files:** Already partially addressed by Phase 2b.5 (split into `web/db/schema.py` + `web/db/migrations.py`) and Phase 2b.5 Step 4 (regression test against pre-migration shape).

The additional task is the audit's recommended **assertion** that every column in the current SCHEMA is also reachable via the migrations on a pre-existing DB. **Land in Phase 2b** as Task 2b.15 (post-A.3):

Add `web/db/_assertions.py`:

```python
"""Schema-vs-migrations drift assertion. Run from init_db AFTER migrations,
so any column added to SCHEMA but missed in migrations.py raises loudly at
test startup rather than crashing at runtime on a pre-migration-shape DB.
"""
from __future__ import annotations

import re
import sqlite3

from web.db.schema import SCHEMA


def assert_schema_complete(conn: sqlite3.Connection) -> None:
    """Raise AssertionError if any column in SCHEMA is missing from the live DB."""
    # Parse SCHEMA for every "CREATE TABLE x (col1 ..., col2 ...)" block.
    create_re = re.compile(r"CREATE TABLE IF NOT EXISTS (\w+) \(([^;]+)\);", re.DOTALL)
    for table_name, columns_block in create_re.findall(SCHEMA):
        expected_cols = {
            line.strip().split()[0]
            for line in columns_block.split(",")
            if line.strip() and not line.strip().startswith("PRIMARY") and not line.strip().startswith("FOREIGN")
        }
        actual_cols = {row[1] for row in conn.execute(f"PRAGMA table_info({table_name})")}
        missing = expected_cols - actual_cols
        assert not missing, (
            f"Schema drift on table {table_name!r}: SCHEMA declares "
            f"columns {missing} that don't exist on the live DB. The migration "
            f"for these columns is missing from web/db/migrations.py."
        )
```

Call from `init_db` after `apply_migrations`. The assertion only runs in `assert -O` mode (the default for tests), so prod is unaffected.

Extend `tests/web/test_db_migrations.py` with a regression case that adds a fake column to SCHEMA and asserts the assertion fires.

Commit-checkpoint message addition: `- BE-070: schema-vs-migrations drift assertion`.

## A.5: BE-081 — `census/client.py` `_census_get` helper extraction

**Files:** `census/client.py`

15 identical `try: async with self._session_().get(url, ...) as resp: ... except Exception as exc: _log.error(...); return None` wrappers across `census/client.py`. Extract one helper.

**Land in Phase 2c** as Task 2c.14 (post-2c.13 commit checkpoint, before Phase 3):

```python
async def _census_get(
    self,
    path: str,
    params: dict[str, str],
    *,
    timeout_s: int = 30,
) -> dict | None:
    """One canonical Census HTTP+parse+error-swallow wrapper.

    Returns the parsed JSON dict, or None on any HTTP / network / parse
    error (already logged at WARN). Replaces 15 hand-rolled try/except
    blocks in the public methods.
    """
    url = f"{BASE_URL}/s:{self.service_id}/json/get/eq2/{path}"
    _log.debug("[Census] GET %s params=%s", _redact_url(url), params)
    try:
        async with self._session_().get(
            url, params=params, timeout=aiohttp.ClientTimeout(total=timeout_s)
        ) as resp:
            _log.debug("[Census] HTTP %s url=%s", resp.status, _redact_url(str(resp.url)))
            if resp.status != 200:
                return None
            return await resp.json(content_type=None)
    except Exception as exc:
        _log.warning("[Census] API error on %s: %s: %r", path, type(exc).__name__, exc)
        return None
```

Migrate every public method (`get_item`, `get_guild`, `get_character`, `get_character_aas`, etc.) to a one-line `data = await self._census_get("guild/", params)` + the existing per-method parse logic.

The redaction helper from Phase 1 Task 1.5 keeps working — it's referenced directly.

Verify with the full census test suite + the integration tests that hit Census via mocked sessions.

Commit-checkpoint message addition (to the existing Phase 2c.13 commit, after staging): `- BE-081: extract _census_get helper (15 hand-rolled try/except blocks → one)`.

## A.6: BE-082 — Distinguish "Census down" from "unguilded" in `_resolve_uploader_guild_async`

**Files:** `web/routes/parses/ingest.py` (post-2b home).

The current `try: ... except Exception: _log.warning(...); return None` flattens "Census API/network error" and "character has no guild" to the same None — the caller can't tell whether to retry.

**Land in Phase 2c** as Task 2c.15:

Introduce a sentinel class:

```python
class _CensusUnavailable:
    """Sentinel — distinct from None. Signals 'try again later' vs
    'definitively no guild'."""
    __slots__ = ()

CENSUS_UNAVAILABLE = _CensusUnavailable()
```

Update the helper to return `str | None | _CensusUnavailable`:

```python
async def _resolve_uploader_guild_async(
    uploader: str,
    world: str | None = None,
) -> str | None | _CensusUnavailable:
    # ... existing cache-hit path ...
    try:
        guild_name = await client.get_character_guild_name(uploader, effective_world)
    except Exception as exc:
        _log.warning("Census guild lookup failed for %r: %s", uploader, exc)
        return CENSUS_UNAVAILABLE  # ← new
    # ... existing logic ...
```

Update `ingest_parse` to handle the sentinel — schedule a background retry rather than committing NULL on `CENSUS_UNAVAILABLE`. NULL is still stored for the genuine "unguilded" case.

Verify: the existing happy-path ingest test still passes. Add a new test exercising the Census-error case (mock the client to raise) and assert the encounter row's `guild_name` is NULL + a retry was scheduled.

Commit-checkpoint message addition: `- BE-082: sentinel return for Census-unavailable vs unguilded`.

## A.7: BE-084 — Consistent 503-vs-404 across Census-touching endpoints

**Files:** `web/routes/character/views.py`, `web/routes/guild.py`, `web/routes/aa.py`, `web/routes/claim.py`.

**Land in Phase 2c** as Task 2c.16: pick one rule — **503 for "Census degraded, retry later", 404 for "definitively not found"** — and apply across every endpoint.

Per-handler patch:
- Each `try: char = await ...; except Exception as exc: raise HTTPException(503, ...) from exc` block stays as-is (these are the canonical 503).
- Each "Census returned None → not found" path uses HTTPException(404).
- The `claim.py:243` ("not found on {current_world()}") path needs a try/except wrapping the Census call — currently lets the exception bubble to a 500.

Verify against `tests/web/test_character.py`, `tests/web/test_guild.py`, `tests/web/test_claim.py`. Update any test that asserts a specific status to match the new rule.

Commit-checkpoint message addition: `- BE-084: consistent 503 (Census down) vs 404 (not found) across handlers`.

## A.8: BE-087 — `_handle_search_chars_single` raises `CensusError` instead of returning `[]`

**Files:** `census/client.py:864-893`, plus the route caller in `web/routes/characters.py`.

Same shape as BE-082 but for searches. Today `[]` from a Census error UX-wise looks like "no characters found".

**Land in Phase 2c** as Task 2c.17:

```python
class CensusError(Exception):
    """Raised when a Census API call fails for non-data reasons (network /
    HTTP error). Distinct from "no results" — callers should turn this into
    a 503 with a useful message, not an empty result list."""


async def _handle_search_chars_single(self, ...) -> list[...]:
    # ... existing logic ...
    except Exception as exc:
        raise CensusError(f"Census search failed: {exc}") from exc
```

Update the route caller to catch `CensusError` and raise `HTTPException(503, ...)`. Add a test exercising the new path.

Commit-checkpoint message addition: `- BE-087: CensusError exception class for search path`.

## A.9: BE-096 — `tests/conftest.py` env vars via `pytest_configure` hook

**Files:** `tests/conftest.py`

Module-level `os.environ.setdefault(...)` calls work because pytest imports conftest before test modules — but a plugin (`pytest-asyncio`, etc.) that imports `web.app` during plugin discovery would race. Use `pytest_configure` instead.

**Land in Phase 3b** as Task 3b.7 (insert into the misc-refactors batch):

```python
def pytest_configure(config: pytest.Config) -> None:
    """Plugin-ordered env var setup. Runs after plugin discovery, before
    test collection — guarantees web.app sees the right DB_*_PATH values."""
    _TEST_DB_DIR.mkdir(parents=True, exist_ok=True)
    # ... existing setdefault logic ...
```

Keep the path-resolution at module load (immediate `_TEST_DB_DIR.mkdir` etc. can stay), but the env-var sets move into `pytest_configure`.

The trade-off: `web.app` can't be imported at conftest module load. Confirm by running `uv run pytest --collect-only` — collection should still succeed.

Commit-checkpoint message addition: `- BE-096: tests/conftest.py uses pytest_configure for env var setup`.

## A.10: BE-113 — Explicit `conn.commit()` on `zones_db.py` write paths

**Files:** `census/zones_db.py:721-749` (`_zone_name_and_expansion`), `add_encounter`, `update_encounter`, etc.

The `with sqlite3.connect(path) as conn:` pattern commits only on no-exception exit AND only if a transaction is active. On Windows the autocommit behaviour is platform-dependent — silent missing-commit on writes has been observed.

**Land in Phase 3b** as Task 3b.8:

For every write path in `census/zones_db.py`, add explicit `conn.commit()` before the `with` block exits:

Before:
```python
with sqlite3.connect(path) as conn:
    conn.execute("INSERT INTO ...")
```

After:
```python
with sqlite3.connect(path) as conn:
    conn.execute("INSERT INTO ...")
    conn.commit()
```

Verify against `tests/census/test_zones_db.py` — most tests already round-trip a write + re-read so the missing commit would have failed them, but the fix is mechanical.

Commit-checkpoint message addition: `- BE-113: explicit conn.commit() on zones_db write paths`.

## A.11: BE-224 — `parses/models.py` _to_* helpers (intentional non-action)

**Files:** none.

The audit notes the `_to_*` helpers in `parses/models.py` are intentionally separate from `census/_coerce.py` (return 0 not None) and stay where they are. **No code change.** Documented here for spec-coverage completeness.

---


