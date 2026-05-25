# EQ2Logs Boss-Kill Rankings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Warcraft-Logs–style boss-kill rankings (Damage/Healing per character, Speed per guild) computed on-read over the existing parses, with percentile colouring and a soft-delete change that preserves leaderboard entries when a parse is deleted.

**Architecture:** No new ranking tables. A new read-only `web/routes/rankings.py` builds boards from `encounters`+`combatants` (cached briefly via `TTLCache`), reusing the existing mirror-grouping to pick the primary upload of each fight. The only schema change is a nullable `hidden_at` soft-delete marker on `encounters`: the parses list hides soft-deleted rows, while rankings and the detail endpoint still serve them.

**Tech Stack:** Python 3.13 / FastAPI / aiosqlite-style sync SQLite via `run_in_executor`; pytest + pytest-asyncio; React 19 / TypeScript / Vite / Tailwind v4. Tooling: `uv`, `ruff`, `pyright`, `tsc`.

**Spec:** `docs/superpowers/specs/2026-05-25-eq2logs-rankings-design.md`

**Conventions for every task:**
- Run backend tests with `uv run pytest <path> -v` (prepend `export PATH="$HOME/.local/bin:$PATH"` if `uv` isn't found).
- Lint/type before each commit: `uv run ruff check <files> && uv run ruff format <files>` and `uv run pyright <files>`.
- Frontend type-check: `cd frontend && npx tsc --noEmit`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Work on a branch: `git checkout -b feature/eq2logs-rankings` before Task 1.

---

## File structure

**Create:**
- `parses/boss.py` — `is_boss(title)` (authoritative server-side boss detection).
- `web/routes/rankings.py` — rankings read endpoints + pure board builders.
- `frontend/src/percentileColors.ts` — percentile → WCL bracket colour.
- `frontend/src/pages/RankingsPage.tsx` — the rankings page.
- `tests/parses/test_boss.py`, `tests/web/test_rankings.py`.

**Modify:**
- `parses/db.py` — `hidden_at` column + migration + `soft_delete_encounter`.
- `web/routes/parses.py` — list hides soft-deleted; detail exposes `hidden`; delete paths soft-delete bosses + admin purge.
- `web/app.py` — register the rankings router.
- `frontend/src/App.tsx` — `/rankings` route + nav link.
- `tests/web/test_parses.py`, `tests/web/test_parses_ingest.py` — updated delete expectations.

---

## Task 1: `is_boss` server-side helper

**Files:**
- Create: `parses/boss.py`
- Test: `tests/parses/test_boss.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/parses/test_boss.py
from __future__ import annotations

from parses.boss import is_boss


class TestIsBoss:
    def test_named_boss_is_boss(self):
        assert is_boss("Tarinax") is True
        assert is_boss("The Shadowed One") is True

    def test_trash_article_names_are_not(self):
        assert is_boss("a krait patriarch") is False
        assert is_boss("an ancient guard") is False

    def test_empty_or_none_is_not(self):
        assert is_boss("") is False
        assert is_boss(None) is False  # type: ignore[arg-type]
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/parses/test_boss.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'parses.boss'`.

- [ ] **Step 3: Implement**

```python
# parses/boss.py
"""Authoritative server-side boss detection.

EQ2 trash mobs are named with a lowercase article ("a krait warrior",
"an ancient guard"); bosses have a proper capitalised name. First-character
uppercase is the simplest reliable signal. The frontend keeps a matching copy
in ParsesPage.tsx; this server version is authoritative for rankings + deletes.
"""

from __future__ import annotations


def is_boss(title: str | None) -> bool:
    return bool(title) and "A" <= title[0] <= "Z"
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/parses/test_boss.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
uv run ruff check parses/boss.py tests/parses/test_boss.py && uv run ruff format parses/boss.py tests/parses/test_boss.py
git add parses/boss.py tests/parses/test_boss.py
git commit -m "feat(parses): authoritative server-side is_boss helper"
```

---

## Task 2: `hidden_at` soft-delete column + migration

**Files:**
- Modify: `parses/db.py` (the `_CREATE_ENCOUNTERS` SQL near the top of the file, and the `_MIGRATIONS` list ~line 198)
- Test: `tests/parses/test_db.py`

- [ ] **Step 1: Write the failing test** (append to `tests/parses/test_db.py`, inside the existing schema test class or as a new test)

```python
def test_encounters_has_hidden_at_column(self, parses_db_conn):
    cols = [r[1] for r in parses_db_conn.execute("PRAGMA table_info(encounters)").fetchall()]
    assert "hidden_at" in cols
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/parses/test_db.py -k hidden_at -v`
Expected: FAIL — `assert 'hidden_at' in [...]`.

- [ ] **Step 3: Implement** — in `parses/db.py`, add the column to the `encounters` CREATE table (just before the closing `);` of `_CREATE_ENCOUNTERS`):

```python
    -- Soft-delete marker (unix seconds). NULL = visible. Set when a boss-kill
    -- parse is "deleted" so the leaderboard entry + its link survive while the
    -- row is hidden from the /parses list. Hard purge removes the row entirely.
    hidden_at       INTEGER,
```

Then append to the `_MIGRATIONS` list:

```python
    # Soft-delete marker for parses. Pre-existing rows are visible (NULL).
    "ALTER TABLE encounters ADD COLUMN hidden_at INTEGER",
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/parses/test_db.py -k "hidden_at or migrations_idempotent" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
uv run ruff check parses/db.py && uv run ruff format parses/db.py
git add parses/db.py tests/parses/test_db.py
git commit -m "feat(parses): add hidden_at soft-delete column to encounters"
```

---

## Task 3: `soft_delete_encounter` db helper

**Files:**
- Modify: `parses/db.py` (add next to `delete_encounter`, ~line 588)
- Test: `tests/parses/test_db.py`

- [ ] **Step 1: Write the failing test** (append to `tests/parses/test_db.py`)

```python
def test_soft_delete_sets_hidden_at(self, parses_db_conn):
    enc = _sample_encounter()
    eid = parses_db.insert_encounter(parses_db_conn, enc, source_dsn="eq2act", ingested_at=1700000000)
    assert parses_db.soft_delete_encounter(parses_db_conn, eid, hidden_at=1700001111) is True
    row = parses_db.find_encounter_by_act_encid(parses_db_conn, enc.encid)
    assert row["hidden_at"] == 1700001111
    # Idempotent: re-soft-deleting an already-hidden row is a no-op (returns False).
    assert parses_db.soft_delete_encounter(parses_db_conn, eid, hidden_at=1700002222) is False
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/parses/test_db.py -k soft_delete -v`
Expected: FAIL — `AttributeError: module 'parses.db' has no attribute 'soft_delete_encounter'`.

- [ ] **Step 3: Implement** in `parses/db.py`:

```python
def soft_delete_encounter(conn: sqlite3.Connection, encounter_id: int, hidden_at: int) -> bool:
    """Hide an encounter from the parses list without removing it, so any
    leaderboard entry sourced from it survives and its link still opens.
    Only acts on a currently-visible row; returns True if it flipped one."""
    with conn:
        cur = conn.execute(
            "UPDATE encounters SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL",
            (hidden_at, encounter_id),
        )
    return cur.rowcount > 0
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/parses/test_db.py -k soft_delete -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
uv run ruff check parses/db.py && uv run ruff format parses/db.py
git add parses/db.py tests/parses/test_db.py
git commit -m "feat(parses): soft_delete_encounter helper"
```

---

## Task 4: Parses list hides soft-deleted rows

**Files:**
- Modify: `web/routes/parses.py` — `_list_encounters_sync` (~line 450, the `where_clauses` setup)
- Test: `tests/web/test_parses.py`

- [ ] **Step 1: Write the failing test** (append to `tests/web/test_parses.py`)

```python
@pytest.mark.asyncio
async def test_list_excludes_hidden_rows(app, tmp_path, monkeypatch):
    # Real temp DB: one visible boss kill, one soft-deleted.
    import time as _t

    from parses import db as pdb
    from parses.models import Encounter

    db_file = tmp_path / "parses.db"
    monkeypatch.setattr(pdb, "DB_PATH", db_file)
    conn = pdb.init_db(db_file)
    for encid, title in [("AAA", "Tarinax"), ("BBB", "Venekor")]:
        enc = Encounter(
            encid=encid, title=title, zone="Zone", started_at=None, ended_at=None,
            duration_s=60, total_damage=1, encdps=1.0, kills=1, deaths=0, success_level=1,
        )
        eid = pdb.insert_encounter(conn, enc, source_dsn="eq2act", ingested_at=int(_t.time()))
        if encid == "BBB":
            pdb.soft_delete_encounter(conn, eid, hidden_at=int(_t.time()))
    conn.close()

    with patch("web.routes.parses._require_user", _fake_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses")
    titles = {f["title"] for f in r.json()["results"]}
    assert "Tarinax" in titles
    assert "Venekor" not in titles  # soft-deleted → hidden from list
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_parses.py -k excludes_hidden -v`
Expected: FAIL — both titles present (no `hidden_at` filter yet).

- [ ] **Step 3: Implement** — in `_list_encounters_sync`, change the `where_clauses` initialisation from `where_clauses: list[str] = []` to always exclude hidden rows:

```python
    # Soft-deleted parses are hidden from the list (but still feed rankings).
    where_clauses: list[str] = ["hidden_at IS NULL"]
    params: list = []
```

(The `hidden_at` column is part of `e.*` in the inner SELECT, so it resolves in the outer `WHERE`.)

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/web/test_parses.py -k excludes_hidden -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
uv run ruff check web/routes/parses.py && uv run ruff format web/routes/parses.py tests/web/test_parses.py
git add web/routes/parses.py tests/web/test_parses.py
git commit -m "feat(parses): hide soft-deleted parses from the list"
```

---

## Task 5: Detail response exposes `hidden`

**Files:**
- Modify: `web/routes/parses.py` — `ParseDetailResponse` model + `get_parse` population
- Test: `tests/web/test_parses.py`

- [ ] **Step 1: Write the failing test** (append to `tests/web/test_parses.py`)

```python
@pytest.mark.asyncio
async def test_detail_reports_hidden_flag(app):
    enc = {
        "id": 1, "act_encid": "X", "title": "Tarinax", "zone": "Z",
        "started_at": 1, "ended_at": 2, "duration_s": 1, "total_damage": 0,
        "encdps": 0.0, "kills": 0, "deaths": 0, "success_level": 1,
        "hidden_at": 1700000000, "combatants": [],
    }
    with (
        patch("web.routes.parses._require_user", _fake_user),
        patch("web.routes.parses._encounter_detail_sync", MagicMock(return_value=enc)),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/parses/1")
    assert r.status_code == 200
    assert r.json()["hidden"] is True
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_parses.py -k reports_hidden -v`
Expected: FAIL — response has no `hidden` key (Pydantic ignores unknown / KeyError).

- [ ] **Step 3: Implement** — add the field to `ParseDetailResponse` (after `success_level`):

```python
    hidden: bool = False  # True when the parse is soft-deleted (still openable via a ranking link)
```

And in the `return ParseDetailResponse(...)` at the end of `get_parse`, add:

```python
        hidden=bool(enc.get("hidden_at")),
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/web/test_parses.py -k reports_hidden -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
uv run ruff check web/routes/parses.py && uv run ruff format web/routes/parses.py tests/web/test_parses.py
git add web/routes/parses.py tests/web/test_parses.py
git commit -m "feat(parses): expose hidden flag on parse detail"
```

---

## Task 6: Single + batch delete soft-delete bosses, with admin purge

**Files:**
- Modify: `web/routes/parses.py` — `_fetch_encounter_auth_rows`, `delete_parse`, `delete_parses_batch`
- Test: `tests/web/test_parses.py`

- [ ] **Step 1: Write the failing tests** (append to `tests/web/test_parses.py`)

```python
@pytest.mark.asyncio
async def test_delete_boss_soft_deletes(app):
    enc = {"id": 1, "guild_name": "Exordium", "source_dsn": "plugin:123456789", "title": "Tarinax", "hidden_at": None}
    soft = MagicMock(return_value=True)
    hard = MagicMock(return_value=True)
    with (
        patch("web.routes.parses._require_user", _fake_user),
        patch("web.routes.parses._is_admin", return_value=True),
        patch("web.routes.parses.parses_db.init_db", return_value=_fake_conn_for_fetch(enc)),
        patch("web.routes.parses.parses_db.soft_delete_encounter", soft),
        patch("web.routes.parses.parses_db.delete_encounter", hard),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete("/api/parses/1")
    assert r.status_code == 200 and r.json() == {"deleted": 1}
    soft.assert_called_once()
    hard.assert_not_called()


@pytest.mark.asyncio
async def test_delete_trash_hard_deletes(app):
    enc = {"id": 1, "guild_name": "Exordium", "source_dsn": "plugin:123456789", "title": "a krait patriarch", "hidden_at": None}
    soft = MagicMock(return_value=True)
    hard = MagicMock(return_value=True)
    with (
        patch("web.routes.parses._require_user", _fake_user),
        patch("web.routes.parses._is_admin", return_value=True),
        patch("web.routes.parses.parses_db.init_db", return_value=_fake_conn_for_fetch(enc)),
        patch("web.routes.parses.parses_db.soft_delete_encounter", soft),
        patch("web.routes.parses.parses_db.delete_encounter", hard),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete("/api/parses/1")
    assert r.status_code == 200
    hard.assert_called_once()
    soft.assert_not_called()


@pytest.mark.asyncio
async def test_admin_purge_hard_deletes_boss(app):
    enc = {"id": 1, "guild_name": "Exordium", "source_dsn": "plugin:OTHER", "title": "Tarinax", "hidden_at": None}
    soft = MagicMock(return_value=True)
    hard = MagicMock(return_value=True)
    with (
        patch("web.routes.parses._require_user", _fake_user),
        patch("web.routes.parses._is_admin", return_value=True),
        patch("web.routes.parses.parses_db.init_db", return_value=_fake_conn_for_fetch(enc)),
        patch("web.routes.parses.parses_db.soft_delete_encounter", soft),
        patch("web.routes.parses.parses_db.delete_encounter", hard),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete("/api/parses/1?purge=1")
    assert r.status_code == 200
    hard.assert_called_once()
    soft.assert_not_called()


@pytest.mark.asyncio
async def test_purge_forbidden_for_non_admin(app):
    enc = {"id": 1, "guild_name": "Exordium", "source_dsn": "plugin:123456789", "title": "Tarinax", "hidden_at": None}
    with (
        patch("web.routes.parses._require_user", _fake_user),
        patch("web.routes.parses._is_admin", return_value=False),
        patch("web.routes.parses.parses_db.init_db", return_value=_fake_conn_for_fetch(enc)),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete("/api/parses/1?purge=1")
    assert r.status_code == 403
```

Update `_fake_conn_for_fetch` rows already include the keys above; the existing single-delete tests pass `enc` dicts without `title`/`hidden_at` — add `"title": "a krait patriarch", "hidden_at": None` to those existing `enc` dicts (in `test_delete_parse_admin_can_delete`, `_uploader_`, `_officer_`, `_random_user_403`) so they exercise the hard-delete path unchanged. The batch-test rows (`_fake_conn_multi`) likewise need `"title"` + `"hidden_at"` keys added.

- [ ] **Step 2: Run them, verify they fail**

Run: `uv run pytest tests/web/test_parses.py -k "soft_deletes or hard_deletes or purge" -v`
Expected: FAIL — purge param unknown / soft path absent.

- [ ] **Step 3: Implement** — in `web/routes/parses.py`:

(a) `_fetch_encounter_auth_rows` — add `title` and `hidden_at` to the SELECT:

```python
        rows = conn.execute(
            f"SELECT id, guild_name, source_dsn, title, hidden_at FROM encounters WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
```

(b) Add a shared apply-delete helper (place above `delete_parse`):

```python
def _apply_delete(conn: sqlite3.Connection, enc: dict, *, purge: bool, hidden_at: int) -> bool:
    """Hard-purge wins; otherwise boss kills are soft-deleted (preserve any
    ranking) and trash is hard-deleted. Caller has already authorised + (for
    purge) checked admin."""
    if purge or not is_boss(enc.get("title")):
        return parses_db.delete_encounter(conn, enc["id"])
    return parses_db.soft_delete_encounter(conn, enc["id"], hidden_at)
```

Add imports at the top of the file: `import time` (already present) and `from parses.boss import is_boss`.

(c) `delete_parse` — add `purge: bool = False` param, enforce admin for purge, and use the helper:

```python
async def delete_parse(
    request: Request,
    encounter_id: int,
    purge: bool = False,
) -> DeleteParsesResponse:
    user = _require_user(request)
    if purge and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only an admin may hard-purge a parse")

    loop = asyncio.get_event_loop()
    rows = await loop.run_in_executor(None, _fetch_encounter_auth_rows, [encounter_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Parse not found")
    if not await _can_delete_encounter(user, rows[0]):
        raise HTTPException(status_code=403, detail="Not authorised to delete this parse")

    enc = rows[0]
    now = int(time.time())

    def _delete_sync() -> bool:
        conn = parses_db.init_db()
        try:
            return _apply_delete(conn, enc, purge=purge, hidden_at=now)
        finally:
            conn.close()

    removed = await loop.run_in_executor(None, _delete_sync)
    return DeleteParsesResponse(deleted=1 if removed else 0)
```

(d) `delete_parses_batch` — add `purge: bool = False`, the same admin gate, and route each allowed id through `_apply_delete`:

```python
async def delete_parses_batch(
    request: Request,
    ids: str,
    purge: bool = False,
) -> DeleteParsesResponse:
    user = _require_user(request)
    if purge and not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only an admin may hard-purge parses")
    # ... existing id parsing unchanged up to building `rows` ...
    allowed_rows = [enc for enc in rows if await _can_delete_encounter(user, enc)]
    if not allowed_rows:
        raise HTTPException(status_code=403, detail="Not authorised to delete these parses")
    now = int(time.time())

    def _delete_many() -> int:
        conn = parses_db.init_db()
        try:
            n = 0
            with conn:
                for enc in allowed_rows:
                    if _apply_delete(conn, enc, purge=purge, hidden_at=now):
                        n += 1
            return n
        finally:
            conn.close()

    n = await loop.run_in_executor(None, _delete_many)
    return DeleteParsesResponse(deleted=n)
```

Note: `_apply_delete` already opens its own `with conn:` inside the db helpers; calling it within an outer `with conn:` is fine (SQLite nested context is a savepoint-free no-op here because the helpers use their own `with conn`). To avoid a nested-transaction error, drop the outer `with conn:` in `_delete_many` and rely on each helper's own transaction:

```python
    def _delete_many() -> int:
        conn = parses_db.init_db()
        try:
            return sum(1 for enc in allowed_rows if _apply_delete(conn, enc, purge=purge, hidden_at=now))
        finally:
            conn.close()
```

- [ ] **Step 4: Run them, verify they pass**

Run: `uv run pytest tests/web/test_parses.py -k "delete or purge or batch" -v`
Expected: PASS (existing + new delete tests).

- [ ] **Step 5: Commit**

```bash
uv run ruff check web/routes/parses.py && uv run ruff format web/routes/parses.py tests/web/test_parses.py
git add web/routes/parses.py tests/web/test_parses.py
git commit -m "feat(parses): soft-delete boss kills, hard-delete trash, admin purge"
```

---

## Task 7: Bulk-by-filter delete soft-deletes bosses

**Files:**
- Modify: `parses/db.py` — add `find_encounters_by_filter` (mirror of `delete_encounters_by_filter`'s WHERE)
- Modify: `web/routes/parses.py` — `delete_parses_bulk` routes each match through `_apply_delete`
- Test: `tests/parses/test_db.py`, `tests/web/test_parses.py`

- [ ] **Step 1: Write the failing db test** (append to `tests/parses/test_db.py`)

```python
def test_find_encounters_by_filter_returns_id_and_title(self, parses_db_conn):
    enc = _sample_encounter()
    eid = parses_db.insert_encounter(
        parses_db_conn, enc, source_dsn="eq2act", ingested_at=1700000000, guild_name="Exordium",
    )
    rows = parses_db.find_encounters_by_filter(parses_db_conn, guild_name="Exordium")
    assert {"id", "title"} <= set(rows[0].keys())
    assert rows[0]["id"] == eid
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/parses/test_db.py -k find_encounters_by_filter -v`
Expected: FAIL — `AttributeError`.

- [ ] **Step 3: Implement** in `parses/db.py` (next to `delete_encounters_by_filter`):

```python
def find_encounters_by_filter(
    conn: sqlite3.Connection,
    *,
    guild_name: str,
    zone: str | None = None,
    date: str | None = None,
    uploaded_by: str | None = None,
) -> list[dict]:
    """Return (id, title, guild_name, source_dsn) for encounters matching the
    same filter `delete_encounters_by_filter` uses — so the route can decide
    soft-vs-hard delete per row. `guild_name` is mandatory."""
    if not guild_name:
        raise ValueError("guild_name is required")
    clauses = ["guild_name = ?"]
    params: list = [guild_name]
    if zone:
        clauses.append("zone = ?")
        params.append(zone)
    if uploaded_by:
        clauses.append("uploaded_by = ?")
        params.append(uploaded_by)
    if date:
        clauses.append("date(started_at, 'unixepoch', 'localtime') = ?")
        params.append(date)
    conn.row_factory = sqlite3.Row
    sql = f"SELECT id, title, guild_name, source_dsn FROM encounters WHERE {' AND '.join(clauses)}"
    return [dict(r) for r in conn.execute(sql, params).fetchall()]
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/parses/test_db.py -k find_encounters_by_filter -v`
Expected: PASS.

- [ ] **Step 5: Write the failing route test** (append to `tests/web/test_parses.py`)

```python
@pytest.mark.asyncio
async def test_bulk_delete_soft_deletes_bosses(app):
    matches = [
        {"id": 1, "title": "Tarinax", "guild_name": "Exordium", "source_dsn": "plugin:OTHER"},
        {"id": 2, "title": "a krait patriarch", "guild_name": "Exordium", "source_dsn": "plugin:OTHER"},
    ]
    soft = MagicMock(return_value=True)
    hard = MagicMock(return_value=True)
    with (
        patch("web.routes.parses._require_user", _fake_user),
        patch("web.routes.parses._is_admin", return_value=True),
        patch("web.routes.parses.parses_db.init_db", return_value=MagicMock()),
        patch("web.routes.parses.parses_db.find_encounters_by_filter", MagicMock(return_value=matches)),
        patch("web.routes.parses.parses_db.soft_delete_encounter", soft),
        patch("web.routes.parses.parses_db.delete_encounter", hard),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.delete("/api/parses?guild=Exordium")
    assert r.status_code == 200 and r.json() == {"deleted": 2}
    soft.assert_called_once()   # Tarinax
    hard.assert_called_once()   # trash
```

- [ ] **Step 6: Run it, verify it fails**

Run: `uv run pytest tests/web/test_parses.py -k bulk_delete_soft -v`
Expected: FAIL — bulk path still calls `delete_encounters_by_filter`.

- [ ] **Step 7: Implement** — rewrite the `_delete_sync` inside `delete_parses_bulk` to fetch matches and route each (add `purge: bool = False` param + admin gate like Task 6):

```python
    now = int(time.time())

    def _delete_sync() -> int:
        conn = parses_db.init_db()
        try:
            matches = parses_db.find_encounters_by_filter(
                conn, guild_name=guild, zone=zone, date=date, uploaded_by=uploader,
            )
            return sum(1 for enc in matches if _apply_delete(conn, enc, purge=purge, hidden_at=now))
        finally:
            conn.close()
```

- [ ] **Step 8: Run it, verify it passes**

Run: `uv run pytest tests/web/test_parses.py -k "bulk" -v`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
uv run ruff check parses/db.py web/routes/parses.py && uv run ruff format parses/db.py web/routes/parses.py tests/parses/test_db.py tests/web/test_parses.py
git add parses/db.py web/routes/parses.py tests/parses/test_db.py tests/web/test_parses.py
git commit -m "feat(parses): bulk delete soft-deletes bosses, hard-deletes trash"
```

---

## Task 8: Rankings pure helpers — percentile + scope

**Files:**
- Create: `web/routes/rankings.py` (helpers only for now)
- Test: `tests/web/test_rankings.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/web/test_rankings.py
from __future__ import annotations

from web.routes.rankings import _percentile, _scope_for


class TestPercentile:
    def test_best_is_100(self):
        assert _percentile(1, 4) == 100

    def test_quartiles(self):
        assert [_percentile(r, 4) for r in (1, 2, 3, 4)] == [100, 75, 50, 25]

    def test_single_entry_is_100(self):
        assert _percentile(1, 1) == 100


class TestScopeFor:
    def test_group(self):
        assert _scope_for(2) == "group" and _scope_for(6) == "group"

    def test_raid(self):
        assert _scope_for(7) == "raid" and _scope_for(24) == "raid"

    def test_individual_and_oversize_excluded(self):
        assert _scope_for(1) is None and _scope_for(0) is None
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_rankings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'web.routes.rankings'`.

- [ ] **Step 3: Implement** — create `web/routes/rankings.py`:

```python
"""
GET /api/rankings/filters  — the smart-dropdown tree (scopes → zones → bosses).
GET /api/rankings          — a ranked board for one (size, zone, boss, metric[, class]).

Computed-on-read over the existing parses tables (no separate ranking store).
Boss kills are detected with parses.boss.is_boss, mirror-grouped to their
primary upload, then ranked. Soft-deleted parses still rank (the leaderboard
ignores hidden_at); only a hard purge removes them. See
docs/superpowers/specs/2026-05-25-eq2logs-rankings-design.md.
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from parses import db as parses_db
from parses.boss import is_boss
from web.auth_deps import require_user_session as _require_user
from web.cache import TTLCache
from web.limiter import limiter
from web.routes.parses import _PLAYER_COUNT_SQL, _group_into_fights

router = APIRouter(tags=["rankings"])

# Raid spans 12 and 24; the table's Size column shows the real count.
_SCOPES: dict[str, tuple[int, int]] = {"group": (2, 6), "raid": (7, 24)}
_SCOPE_LABELS = {"group": "Group", "raid": "Raid"}
_METRIC_FIELD = {"dps": "encdps", "hps": "enchps"}  # speed handled separately

# Short-lived cache of the expensive load+group step (boards are cheap on top).
rankings_cache: TTLCache = TTLCache(ttl=60, max_age=600, name="rankings", maxsize=4)
_KILLS_KEY = "primary_boss_kills"


def _percentile(rank: int, n: int) -> int:
    """Rank-based percentile, 1 = best. Best is always 100; n=4 → 100/75/50/25."""
    if n <= 0:
        return 0
    return round(100 * (n - rank + 1) / n)


def _scope_for(player_count: int) -> str | None:
    for scope, (lo, hi) in _SCOPES.items():
        if lo <= player_count <= hi:
            return scope
    return None
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/web/test_rankings.py -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
uv run ruff check web/routes/rankings.py tests/web/test_rankings.py && uv run ruff format web/routes/rankings.py tests/web/test_rankings.py
git add web/routes/rankings.py tests/web/test_rankings.py
git commit -m "feat(rankings): percentile + scope helpers"
```

---

## Task 9: Character board builder (Damage / Healing)

**Files:**
- Modify: `web/routes/rankings.py`
- Test: `tests/web/test_rankings.py`

- [ ] **Step 1: Write the failing test** (append to `tests/web/test_rankings.py`)

```python
from web.routes.rankings import _build_character_board


def _kill(eid, *, zone, title, pcount, combatants):
    return {
        "id": eid, "title": title, "zone": zone, "guild_name": "Exordium",
        "started_at": 1700000000, "duration_s": 60, "player_count": pcount,
        "scope": "raid", "combatants": combatants,
    }


def _c(name, cls, encdps, *, ally=1, guild="Exordium", level=95):
    return {"name": name, "cls": cls, "ally": ally, "encdps": encdps, "enchps": 0.0,
            "guild_name": guild, "level": level}


class TestCharacterBoard:
    def test_keeps_personal_best_per_character(self):
        kills = [
            _kill(1, zone="Z", title="Tarinax", pcount=24, combatants=[_c("Menludiir", "Wizard", 500.0)]),
            _kill(2, zone="Z", title="Tarinax", pcount=24, combatants=[_c("Menludiir", "Wizard", 900.0)]),
        ]
        rows, classes = _build_character_board(kills, size="raid", zone="Z", boss="Tarinax", metric="dps")
        assert len(rows) == 1
        assert rows[0]["score"] == 900.0 and rows[0]["encounter_id"] == 2
        assert classes == ["Wizard"]

    def test_percentile_within_class(self):
        kills = [_kill(1, zone="Z", title="Tarinax", pcount=24, combatants=[
            _c("A", "Wizard", 900.0), _c("B", "Wizard", 500.0), _c("H", "Templar", 100.0),
        ])]
        rows, classes = _build_character_board(kills, size="raid", zone="Z", boss="Tarinax", metric="dps")
        pct = {r["name"]: r["percentile"] for r in rows}
        assert pct["A"] == 100 and pct["B"] == 50   # two Wizards
        assert pct["H"] == 100                       # only Templar
        assert classes == ["Templar", "Wizard"]

    def test_excludes_unresolved_class_and_pets(self):
        kills = [_kill(1, zone="Z", title="Tarinax", pcount=24, combatants=[
            _c("Menludiir", "Wizard", 900.0),
            _c("Nopclass", None, 800.0),            # unresolved class → excluded
            _c("a pet thing", "Wizard", 700.0),      # multi-word → excluded
            _c("Enemy", "Wizard", 999.0, ally=0),    # not ally → excluded
        ])]
        rows, _ = _build_character_board(kills, size="raid", zone="Z", boss="Tarinax", metric="dps")
        assert [r["name"] for r in rows] == ["Menludiir"]
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_rankings.py -k CharacterBoard -v`
Expected: FAIL — `_build_character_board` undefined.

- [ ] **Step 3: Implement** — append to `web/routes/rankings.py`:

```python
def _is_player_combatant(c: dict) -> bool:
    name = (c.get("name") or "").strip()
    return bool(c.get("ally")) and bool(name) and " " not in name and name != "Unknown"


def _build_character_board(
    kills: list[dict], *, size: str, zone: str, boss: str, metric: str
) -> tuple[list[dict], list[str]]:
    """Per-character best for Damage/Healing. Returns (rows sorted by score
    desc, sorted class list). Percentile is computed within each class."""
    field = _METRIC_FIELD[metric]
    best: dict[str, dict] = {}  # name.lower() → entry
    for k in kills:
        if k["scope"] != size or k["zone"] != zone or k["title"] != boss:
            continue
        for c in k["combatants"]:
            if not _is_player_combatant(c) or not c.get("cls"):
                continue
            score = c.get(field) or 0.0
            key = c["name"].strip().lower()
            cur = best.get(key)
            if cur is None or score > cur["score"]:
                best[key] = {
                    "kind": "character",
                    "name": c["name"].strip(),
                    "guild_name": c.get("guild_name"),
                    "level": c.get("level"),
                    "cls": c["cls"],
                    "score": score,
                    "encounter_id": k["id"],
                    "size": k["player_count"],
                    "started_at": k["started_at"],
                }
    entries = list(best.values())
    by_cls: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_cls[e["cls"]].append(e)
    for cls_rows in by_cls.values():
        cls_rows.sort(key=lambda e: e["score"], reverse=True)
        n = len(cls_rows)
        for i, e in enumerate(cls_rows):
            e["percentile"] = _percentile(i + 1, n)
    entries.sort(key=lambda e: e["score"], reverse=True)
    return entries, sorted(by_cls.keys())
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/web/test_rankings.py -k CharacterBoard -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
uv run ruff check web/routes/rankings.py && uv run ruff format web/routes/rankings.py tests/web/test_rankings.py
git add web/routes/rankings.py tests/web/test_rankings.py
git commit -m "feat(rankings): per-character Damage/Healing board builder"
```

---

## Task 10: Speed board builder + filters tree

**Files:**
- Modify: `web/routes/rankings.py`
- Test: `tests/web/test_rankings.py`

- [ ] **Step 1: Write the failing test** (append to `tests/web/test_rankings.py`)

```python
from web.routes.rankings import _build_filters, _build_speed_board


class TestSpeedBoard:
    def test_best_time_per_guild(self):
        kills = [
            {"id": 1, "title": "Tarinax", "zone": "Z", "guild_name": "Exordium", "started_at": 1,
             "duration_s": 200, "player_count": 24, "scope": "raid", "combatants": []},
            {"id": 2, "title": "Tarinax", "zone": "Z", "guild_name": "Exordium", "started_at": 2,
             "duration_s": 168, "player_count": 24, "scope": "raid", "combatants": []},
            {"id": 3, "title": "Tarinax", "zone": "Z", "guild_name": "Misfits", "started_at": 3,
             "duration_s": 211, "player_count": 24, "scope": "raid", "combatants": []},
        ]
        rows = _build_speed_board(kills, size="raid", zone="Z", boss="Tarinax")
        assert [r["guild_name"] for r in rows] == ["Exordium", "Misfits"]
        assert rows[0]["duration_s"] == 168 and rows[0]["encounter_id"] == 2
        assert rows[0]["percentile"] == 100 and rows[1]["percentile"] == 50

    def test_excludes_unresolved_guild(self):
        kills = [{"id": 1, "title": "Tarinax", "zone": "Z", "guild_name": None, "started_at": 1,
                  "duration_s": 100, "player_count": 24, "scope": "raid", "combatants": []}]
        assert _build_speed_board(kills, size="raid", zone="Z", boss="Tarinax") == []


class TestFilters:
    def test_tree_groups_by_scope_zone_boss(self):
        kills = [
            {"scope": "raid", "zone": "Vetrovia", "title": "Tarinax"},
            {"scope": "raid", "zone": "Vetrovia", "title": "Cazel"},
            {"scope": "group", "zone": "Crypt", "title": "Bonebreaker"},
        ]
        tree = _build_filters(kills)
        raid = next(s for s in tree["scopes"] if s["key"] == "raid")
        zone = raid["zones"][0]
        assert zone["zone"] == "Vetrovia" and zone["bosses"] == ["Cazel", "Tarinax"]
        assert {s["key"] for s in tree["scopes"]} == {"raid", "group"}
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_rankings.py -k "SpeedBoard or Filters" -v`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Implement** — append to `web/routes/rankings.py`:

```python
def _build_speed_board(kills: list[dict], *, size: str, zone: str, boss: str) -> list[dict]:
    """Per-guild fastest clear. Returns rows sorted by time asc with percentile."""
    best: dict[str, dict] = {}  # guild.lower() → entry
    for k in kills:
        if k["scope"] != size or k["zone"] != zone or k["title"] != boss:
            continue
        guild = (k.get("guild_name") or "").strip()
        if not guild:
            continue
        cur = best.get(guild.lower())
        if cur is None or k["duration_s"] < cur["duration_s"]:
            best[guild.lower()] = {
                "kind": "guild",
                "guild_name": guild,
                "duration_s": k["duration_s"],
                "encounter_id": k["id"],
                "size": k["player_count"],
                "started_at": k["started_at"],
            }
    rows = sorted(best.values(), key=lambda e: e["duration_s"])
    n = len(rows)
    for i, e in enumerate(rows):
        e["percentile"] = _percentile(i + 1, n)
    return rows


def _build_filters(kills: list[dict]) -> dict:
    """Scope → zone → boss tree for the dropdowns, populated from the data."""
    tree: dict[str, dict[str, set]] = {"raid": defaultdict(set), "group": defaultdict(set)}
    for k in kills:
        scope = k.get("scope")
        if scope not in tree:
            continue
        tree[scope][k.get("zone") or "(unknown zone)"].add(k["title"])
    return {
        "scopes": [
            {
                "key": scope,
                "label": _SCOPE_LABELS[scope],
                "zones": [
                    {"zone": z, "bosses": sorted(bosses)}
                    for z, bosses in sorted(zones.items())
                ],
            }
            for scope, zones in tree.items()
            if zones
        ]
    }
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/web/test_rankings.py -k "SpeedBoard or Filters" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
uv run ruff check web/routes/rankings.py && uv run ruff format web/routes/rankings.py tests/web/test_rankings.py
git add web/routes/rankings.py tests/web/test_rankings.py
git commit -m "feat(rankings): speed board + filters tree builders"
```

---

## Task 11: Kills loader (DB → primary boss kills)

**Files:**
- Modify: `web/routes/rankings.py`
- Test: `tests/web/test_rankings.py`

- [ ] **Step 1: Write the failing test** (append to `tests/web/test_rankings.py`) — real temp DB:

```python
import time as _time

import pytest

from parses import db as pdb
from parses.models import Combatant, Encounter


def _ins(conn, encid, title, *, success, players, guild, duration):
    enc = Encounter(encid=encid, title=title, zone="Vetrovia", started_at=None, ended_at=None,
                    duration_s=duration, total_damage=1, encdps=1.0, kills=1, deaths=0, success_level=success)
    eid = pdb.insert_encounter(conn, enc, source_dsn="eq2act", ingested_at=int(_time.time()),
                               uploaded_by="Up", guild_name=guild)
    combs = [Combatant(encid=encid, name=f"P{i}", ally=True, started_at=None, ended_at=None,
                       duration_s=duration, damage=1, damage_perc=0.0, kills=0, healed=0, healed_perc=0.0,
                       crit_heals=0, heals=0, cure_dispels=0, power_drain=0, power_replenish=0,
                       dps=0.0, encdps=float(100 - i), enchps=0.0, hits=0, crit_hits=0, blocked=0,
                       misses=0, swings=0, heals_taken=0, damage_taken=0, deaths=0, to_hit=0.0,
                       crit_dam_perc=0.0, crit_heal_perc=0.0, crit_types=None, threat_str=None, threat_delta=0)
              for i in range(players)]
    snaps = {f"P{i}": __import__("parses.models", fromlist=["CombatantSnapshot"]).CombatantSnapshot(
        level=95, guild_name=guild, cls="Wizard") for i in range(players)}
    pdb.insert_combatants_bulk(conn, eid, combs, snaps)


@pytest.fixture()
def rankings_db(tmp_path, monkeypatch):
    db_file = tmp_path / "parses.db"
    monkeypatch.setattr(pdb, "DB_PATH", db_file)
    conn = pdb.init_db(db_file)
    _ins(conn, "WIN", "Tarinax", success=1, players=8, guild="Exordium", duration=60)   # boss, raid
    _ins(conn, "TRASH", "a krait", success=1, players=8, guild="Exordium", duration=30)  # not boss
    _ins(conn, "LOSS", "Cazel", success=2, players=8, guild="Exordium", duration=90)     # not a win
    conn.close()
    from web.routes import rankings as rk
    rk.rankings_cache.delete(rk._KILLS_KEY)
    return db_file


def test_loader_keeps_only_winning_boss_kills(rankings_db):
    from web.routes.rankings import _load_primary_boss_kills

    kills = _load_primary_boss_kills()
    assert [k["title"] for k in kills] == ["Tarinax"]
    assert kills[0]["scope"] == "raid" and kills[0]["player_count"] == 8
    assert len(kills[0]["combatants"]) == 8
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_rankings.py -k loader -v`
Expected: FAIL — `_load_primary_boss_kills` undefined.

- [ ] **Step 3: Implement** — append to `web/routes/rankings.py`:

```python
def _load_primary_boss_kills() -> list[dict]:
    """Load winning boss-kill encounters, mirror-group them, and return one
    'primary' (longest) upload per fight with its combatants attached. Ignores
    hidden_at so soft-deleted parses still rank. Runs in an executor."""
    if not parses_db.DB_PATH.exists():
        return []
    conn = parses_db.init_db()
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"""
            SELECT e.id, e.title, e.zone, e.guild_name, e.uploaded_by,
                   e.started_at, e.duration_s, e.success_level,
                   ({_PLAYER_COUNT_SQL}) AS player_count
            FROM encounters e
            WHERE e.success_level = 1
            ORDER BY e.started_at DESC
            """
        ).fetchall()
        encs = [dict(r) for r in rows if is_boss(r["title"])]
        kills: list[dict] = []
        for g in _group_into_fights(encs):
            scope = _scope_for(g.get("player_count") or 0)
            if scope is None:
                continue
            kills.append({
                "id": g["id"],
                "title": g["title"],
                "zone": g["zone"],
                "guild_name": g.get("guild_name"),
                "started_at": g["started_at"],
                "duration_s": g["duration_s"],
                "player_count": g.get("player_count") or 0,
                "scope": scope,
                "combatants": parses_db.get_combatants_for_encounter(conn, g["id"]),
            })
        return kills
    finally:
        conn.close()


def _cached_kills() -> list[dict]:
    cached = rankings_cache.get(_KILLS_KEY)
    if cached is not None:
        return cached
    kills = _load_primary_boss_kills()
    rankings_cache.set(_KILLS_KEY, kills)
    return kills
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/web/test_rankings.py -k loader -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
uv run ruff check web/routes/rankings.py && uv run ruff format web/routes/rankings.py tests/web/test_rankings.py
git add web/routes/rankings.py tests/web/test_rankings.py
git commit -m "feat(rankings): load + mirror-group primary boss kills"
```

---

## Task 12: Rankings endpoints + router registration

**Files:**
- Modify: `web/routes/rankings.py` (models + endpoints), `web/app.py` (register)
- Test: `tests/web/test_rankings.py`

- [ ] **Step 1: Write the failing test** (append to `tests/web/test_rankings.py`)

```python
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient


def _fake_user(request=None) -> dict:
    return {"id": "123", "username": "alice"}


@pytest.mark.asyncio
async def test_filters_endpoint(app, rankings_db):
    with patch("web.routes.rankings._require_user", _fake_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/rankings/filters")
    assert r.status_code == 200
    scopes = {s["key"] for s in r.json()["scopes"]}
    assert "raid" in scopes


@pytest.mark.asyncio
async def test_rankings_dps_board(app, rankings_db):
    with patch("web.routes.rankings._require_user", _fake_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/rankings?size=raid&zone=Vetrovia&boss=Tarinax&metric=dps")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 8 and body["rows"][0]["kind"] == "character"
    assert body["rows"][0]["percentile"] == 100
    assert body["classes"] == ["Wizard"]


@pytest.mark.asyncio
async def test_rankings_rejects_bad_metric(app, rankings_db):
    with patch("web.routes.rankings._require_user", _fake_user):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/rankings?size=raid&zone=Vetrovia&boss=Tarinax&metric=bogus")
    assert r.status_code == 400
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_rankings.py -k "endpoint or board or bad_metric" -v`
Expected: FAIL — 404 (routes/registration absent).

- [ ] **Step 3: Implement** — append models + endpoints to `web/routes/rankings.py`:

```python
class RankingRow(BaseModel):
    kind: str  # "character" | "guild"
    encounter_id: int
    percentile: int
    size: int
    started_at: int
    # character rows
    name: str | None = None
    guild_name: str | None = None
    level: int | None = None
    cls: str | None = None
    score: float | None = None
    # guild rows (Speed)
    duration_s: int | None = None


class RankingsResponse(BaseModel):
    rows: list[RankingRow]
    classes: list[str]
    total: int


@router.get("/rankings/filters")
@limiter.limit("60/minute")
async def get_ranking_filters(request: Request) -> dict:
    _require_user(request)
    loop = asyncio.get_event_loop()
    kills = await loop.run_in_executor(None, _cached_kills)
    return _build_filters(kills)


@router.get("/rankings", response_model=RankingsResponse)
@limiter.limit("60/minute")
async def get_rankings(
    request: Request,
    size: str,
    zone: str,
    boss: str,
    metric: str,
    class_name: str | None = Query(None, alias="class"),
) -> RankingsResponse:
    _require_user(request)
    if size not in _SCOPES:
        raise HTTPException(status_code=400, detail="size must be 'raid' or 'group'")
    if metric not in ("dps", "hps", "speed"):
        raise HTTPException(status_code=400, detail="metric must be 'dps', 'hps' or 'speed'")

    loop = asyncio.get_event_loop()
    kills = await loop.run_in_executor(None, _cached_kills)

    if metric == "speed":
        rows = _build_speed_board(kills, size=size, zone=zone, boss=boss)
        classes: list[str] = []
    else:
        rows, classes = _build_character_board(kills, size=size, zone=zone, boss=boss, metric=metric)
        if class_name:
            rows = [r for r in rows if r["cls"] == class_name]

    return RankingsResponse(
        rows=[RankingRow(**r) for r in rows],
        classes=classes,
        total=len(rows),
    )
```

Then register in `web/app.py`: add the import beside the other route imports:

```python
from web.routes.rankings import router as rankings_router
```

and the include beside the others:

```python
    app.include_router(rankings_router, prefix="/api")
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/web/test_rankings.py -v`
Expected: PASS (all rankings tests).

- [ ] **Step 5: Full backend gate**

Run: `uv run pytest -q && uv run ruff check . && uv run pyright web/routes/rankings.py parses/boss.py parses/db.py web/routes/parses.py`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
uv run ruff format web/routes/rankings.py web/app.py tests/web/test_rankings.py
git add web/routes/rankings.py web/app.py tests/web/test_rankings.py
git commit -m "feat(rankings): /api/rankings + /filters endpoints, register router"
```

---

## Task 13: Frontend percentile colours

**Files:**
- Create: `frontend/src/percentileColors.ts`

- [ ] **Step 1: Implement** (no FE unit-test harness; `tsc` is the gate)

```typescript
// frontend/src/percentileColors.ts
// Warcraft-Logs-style percentile colour scale. Distinct from rarityColors.ts
// (item quality) on purpose — this is a performance percentile, not item tier.

export function percentileColor(p: number): string {
  if (p >= 100) return '#e5cc80' // gold
  if (p >= 99) return '#e268a8'  // pink
  if (p >= 95) return '#ff8000'  // orange
  if (p >= 75) return '#a335ee'  // purple
  if (p >= 50) return '#0070ff'  // blue
  if (p >= 25) return '#1eff00'  // green
  return '#666666'               // grey
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/percentileColors.ts
git commit -m "feat(rankings): percentile colour scale (frontend)"
```

---

## Task 14: Rankings page + route + nav

**Files:**
- Create: `frontend/src/pages/RankingsPage.tsx`
- Modify: `frontend/src/App.tsx` (import, `/rankings` route, nav link)

- [ ] **Step 1: Implement the page** — `frontend/src/pages/RankingsPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import Breadcrumb from '../components/Breadcrumb'
import { Card } from '../components/ui'
import { fmtDuration, fmtLocalDate, fmtNum } from '../formatters'
import { percentileColor } from '../percentileColors'

interface FilterZone { zone: string; bosses: string[] }
interface FilterScope { key: string; label: string; zones: FilterZone[] }
interface FiltersResponse { scopes: FilterScope[] }

interface RankingRow {
  kind: 'character' | 'guild'
  encounter_id: number
  percentile: number
  size: number
  started_at: number
  name: string | null
  guild_name: string | null
  level: number | null
  cls: string | null
  score: number | null
  duration_s: number | null
}
interface RankingsResponse { rows: RankingRow[]; classes: string[]; total: number }

const METRICS = [
  { key: 'dps', label: 'Damage (DPS)' },
  { key: 'hps', label: 'Healing (HPS)' },
  { key: 'speed', label: 'Speed' },
]

const CTRL = 'bg-surface border border-border rounded-md text-text px-2 py-1 text-sm'

export default function RankingsPage() {
  const [filters, setFilters] = useState<FiltersResponse>({ scopes: [] })
  const [params, setParams] = useSearchParams()
  const [board, setBoard] = useState<RankingsResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const size = params.get('size') || ''
  const zone = params.get('zone') || ''
  const boss = params.get('boss') || ''
  const metric = params.get('metric') || 'dps'
  const cls = params.get('class') || ''

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v); else next.delete(k)
    }
    setParams(next)
  }

  useEffect(() => {
    fetch('/api/rankings/filters', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: FiltersResponse) => setFilters(j))
      .catch(() => setFilters({ scopes: [] }))
  }, [])

  const scope = useMemo(() => filters.scopes.find(s => s.key === size), [filters, size])
  const zoneObj = useMemo(() => scope?.zones.find(z => z.zone === zone), [scope, zone])

  useEffect(() => {
    if (!size || !zone || !boss) { setBoard(null); return }
    const u = new URL('/api/rankings', window.location.origin)
    u.searchParams.set('size', size); u.searchParams.set('zone', zone)
    u.searchParams.set('boss', boss); u.searchParams.set('metric', metric)
    if (cls && metric !== 'speed') u.searchParams.set('class', cls)
    let cancelled = false
    setLoading(true)
    fetch(u.toString(), { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: RankingsResponse) => { if (!cancelled) setBoard(j) })
      .catch(() => { if (!cancelled) setBoard(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [size, zone, boss, metric, cls])

  const isSpeed = metric === 'speed'

  return (
    <main className="page-enter mx-auto max-w-5xl px-4 py-6">
      <Breadcrumb items={[{ label: 'Rankings' }]} />
      <h1 className="font-heading text-[1.7rem] text-gold mb-3">EQ2Logs — Rankings</h1>

      <div className="flex flex-wrap gap-2 mb-4">
        <select className={CTRL} value={size} onChange={e => update({ size: e.target.value, zone: '', boss: '' })}>
          <option value="">Scope…</option>
          {filters.scopes.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className={CTRL} value={zone} disabled={!scope} onChange={e => update({ zone: e.target.value, boss: '' })}>
          <option value="">Zone…</option>
          {scope?.zones.map(z => <option key={z.zone} value={z.zone}>{z.zone}</option>)}
        </select>
        <select className={CTRL} value={boss} disabled={!zoneObj} onChange={e => update({ boss: e.target.value })}>
          <option value="">Boss…</option>
          {zoneObj?.bosses.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className={CTRL} value={metric} onChange={e => update({ metric: e.target.value })}>
          {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
        {!isSpeed && (
          <select className={CTRL} value={cls} onChange={e => update({ class: e.target.value })}>
            <option value="">All classes</option>
            {(board?.classes ?? []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {loading && <p className="text-text-muted">Loading…</p>}
      {!loading && (!size || !zone || !boss) && (
        <p className="text-text-muted">Pick a scope, zone, and boss to see the rankings.</p>
      )}
      {!loading && board && size && zone && boss && (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-muted text-left text-[0.72rem] uppercase tracking-wide border-b border-border">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">%</th>
                <th className="px-3 py-2">{isSpeed ? 'Guild' : 'Player'}</th>
                {!isSpeed && <th className="px-3 py-2">Lvl</th>}
                {!isSpeed && <th className="px-3 py-2">Class</th>}
                <th className="px-3 py-2 text-right">{isSpeed ? 'Time' : metric === 'hps' ? 'HPS' : 'DPS'}</th>
                <th className="px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2 text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r, i) => (
                <tr
                  key={`${r.encounter_id}-${r.name ?? r.guild_name}`}
                  className="border-b border-border/40 hover:bg-surface/60 cursor-pointer"
                  onClick={() => { window.location.href = `/parse/${r.encounter_id}` }}
                >
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: percentileColor(r.percentile) }}>{r.percentile}</td>
                  <td className="px-3 py-2">
                    {isSpeed ? r.guild_name : (
                      <>
                        <Link to={`/parse/${r.encounter_id}`} className="text-text underline decoration-dotted underline-offset-2" onClick={e => e.stopPropagation()}>
                          {r.name}
                        </Link>
                        {r.guild_name && <span className="text-text-muted text-[0.7rem] ml-1">‹{r.guild_name}›</span>}
                      </>
                    )}
                  </td>
                  {!isSpeed && <td className="px-3 py-2 tabular-nums">{r.level ?? '—'}</td>}
                  {!isSpeed && <td className="px-3 py-2">{r.cls ?? '—'}</td>}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {isSpeed ? fmtDuration(r.duration_s ?? 0) : fmtNum(Math.round(r.score ?? 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.size}</td>
                  <td className="px-3 py-2 text-right text-text-muted">{fmtLocalDate(r.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {board.rows.length === 0 && <p className="text-text-muted p-3">No ranked kills yet for this board.</p>}
        </Card>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Wire the route + nav in `frontend/src/App.tsx`**

Add the import near the other page imports:

```tsx
import RankingsPage from './pages/RankingsPage'
```

Add the route beside `/parses`:

```tsx
        <Route path="/rankings" element={<RankingsPage />} />
```

Add the nav item in `NavLinks` (after Parses):

```tsx
      <NavItem to="/rankings"   label="Rankings" />
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0. (If `Breadcrumb`'s prop type differs, match the shape used in `ParsePage.tsx` — `items={[{ label: 'Rankings' }]}`.)

- [ ] **Step 4: Manual smoke test**

Run the dev stack and visit `/rankings`. Verify: dropdowns populate (Scope → Zone → Boss), a DPS board renders with percentile colours, switching to Speed shows guild rows, clicking a row opens `/parse/:id`. (Requires seeded `parses.db` with at least one winning boss kill.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/RankingsPage.tsx frontend/src/App.tsx
git commit -m "feat(rankings): rankings page, route, and nav link"
```

---

## Task 15: Frontend — "removed from listing" note on hidden parses

**Files:**
- Modify: `frontend/src/pages/ParsePage.tsx` (`ParseDetail` interface + a banner)

- [ ] **Step 1: Implement** — add `hidden?: boolean` to the `ParseDetail` interface, and render a banner under the header when `data.hidden`:

```tsx
{data.hidden && (
  <p className="text-text-muted text-[0.8rem] mb-3 border border-border rounded-md px-3 py-2">
    This parse has been removed from the parses list, but is preserved here because it holds a ranking.
  </p>
)}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ParsePage.tsx
git commit -m "feat(parses): note when viewing a soft-deleted (ranking-preserved) parse"
```

---

## Task 16: Final full-suite gate

- [ ] **Step 1: Backend**

Run: `uv run pytest -q && uv run ruff check . && uv run pyright`
Expected: all pass, 0 errors.

- [ ] **Step 2: Frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Push the branch and open a PR** (only when the user asks)

```bash
git push -u origin feature/eq2logs-rankings
```

Note for the user: the `hidden_at` migration is additive and runs automatically on startup; no data regeneration. Re-copying `parses.db` to the Railway volume is not required for this feature (schema migrates in place), but boards only populate from win-flagged boss kills.

---

## Self-review notes (addressed)

- **Spec coverage:** boss detection (T1), soft-delete schema + list/detail (T2–T5), all three delete paths with admin purge (T6–T7), computed-on-read boards Damage/Healing/Speed (T8–T12), data-driven dropdowns (T10/T12/T14), percentile + WCL colours (T8/T13), per-parse-state level/guild reused via the existing snapshot, click-through + soft-delete preservation (T14/T15). Edge cases (unresolved class/guild, pets) covered by T9–T10 tests.
- **Type consistency:** `_build_character_board(... metric)` ↔ `_METRIC_FIELD`; `RankingRow.kind` ∈ {character, guild} matches both builders; `_scope_for`/`_SCOPES` keys (`raid`,`group`) used consistently across loader, builders, endpoint validation, and the filters tree.
- **No placeholders:** every code step is complete and runnable.
