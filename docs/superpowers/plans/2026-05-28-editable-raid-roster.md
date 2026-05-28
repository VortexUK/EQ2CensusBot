# Editable Raid Boss Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins + the `contributor` role add, remove, rename, drag-reorder bosses per raid zone, and manage the "encounter mobs" within each boss — with the boss display name becoming the *primary* mob (not the comma-joined list of every mob).

**Architecture:** No schema migration. The existing `zones_db` tables already support this: `zone_encounters` is the per-zone boss list, `zone_encounter_mobs` is the mob list per encounter. The change is a convention shift — `zone_encounters.encounter_name` becomes the primary mob's name, kept in sync with the `zone_encounter_mobs` row at `position=0`. Siblings live at `position>=1`. New backend helpers + write endpoints on top of the existing tables; each write keeps the `raids_db.raid_encounters` mirror in sync so triggers/timers/strategies (FK by `encounter_id`) are unaffected.

**Tech Stack:** Python 3.13 (`census/zones_db.py`, `census/raids_db.py`, `web/routes/zones.py`), FastAPI + pytest + httpx; React 19 + Vite + TypeScript + Tailwind v4 (`frontend/src/pages/RaidZonePage.tsx`, new `BossRosterEditor.tsx`); `@dnd-kit/sortable` for drag-reorder (new dep). Tooling: `uv run …` (uv on PATH), ruff, pyright, `npm run typecheck`/`build`. Branch: `feature/editable-raid-roster` (already created off `origin/main` with the spec commit).

Spec: `docs/superpowers/specs/2026-05-28-editable-raid-roster-design.md`.

---

## File Structure

- **Modify** `census/zones_db.py` — one-time idempotent `encounter_name` normalization inside `init_db`; new helpers `add_encounter`, `update_encounter`, `delete_encounter`, `reorder_encounters`, `add_mob`, `update_mob`, `promote_mob`, `delete_mob`. Each write keeps the `raids_db.raid_encounters` mirror in sync via `raids_db.upsert_raid_encounter` (rename/reorder) or a deletion helper (delete).
- **Add (if missing)** `census/raids_db.py` — `delete_raid_encounter_by_zone_mob(zone_name, mob_name)` helper that the new `delete_encounter` calls; if a `raid_encounters` row exists for the deleted zone-encounter, removing it cascades triggers/timers/strategies.
- **Create** `web/routes/zones_admin.py` — the new write endpoints (POST/PUT/DELETE under `/api/zones/{zone}/encounters[/...]`), `@Depends(require_editor)`. Keeping them in a sibling file (rather than growing `web/routes/zones.py`) keeps reads and writes separable.
- **Register** in `web/app.py` — `app.include_router(zones_admin_router, prefix="/api")`.
- **Add tests** `tests/census/test_zones_db_editable.py` (normalization + helpers), `tests/web/test_zones_admin.py` (routes + auth gate + mirror sync).
- **Modify** `frontend/src/pages/RaidZonePage.tsx` — render an `<EditRosterToggle/>` for editors; when on, mount `<BossRosterEditor/>` instead of the read-only sidebar.
- **Create** `frontend/src/components/BossRosterEditor.tsx` — drag-reorder (dnd-kit) + per-boss edit panel (rename primary, manage siblings, add/delete with safety rules) + add-boss action.
- **Modify** `frontend/package.json` — add `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`.
- **Modify** `scripts/build_zones_db.py` — remove `--curated-bosses` arg, `DEFAULT_CURATED`, `parse_curated_bosses`, `_load_curated_bosses_into_db`, the bosses load step from `main`, and the `bosses_*` meta fields.
- **Delete** `scripts/dev/eq2_raid_bosses.review.txt`.
- **Modify** `litestream.yml` — add a `zones.db` replica block alongside `users.db` / `parses.db`.
- **Modify** `railway.toml` — add a third `litestream restore -if-replica-exists … zones.db` line to the startCommand.
- **Modify** `CLAUDE.md` — drop the curated-source mention; note the roster is web-editable + zones.db is now litestream-replicated.

**Conventions:** `uv run ruff format`/`ruff check`/`pyright` on touched Python; `npm run typecheck && npm run build` from `frontend/` on touched TS. Commit per task; stage only the task's files. Frontend tasks (6) are visual — **hold the commit for user review** (the controller will surface it).

---

## Task 1: Normalize legacy comma-joined `encounter_name` in `init_db`

**Files:**
- Modify: `census/zones_db.py` (`init_db`, ~line 265-289)
- Test: `tests/census/test_zones_db_editable.py` (new)

The spec wants `encounter_name` to be a single primary mob name. Existing rows in production have comma-joined names like `"Ire, Malevolence"`. Normalize them once on boot — idempotent, no-op for non-comma rows. Both indexes the spec mentions are already in `_CREATE_INDEXES`, so this task adds nothing else to `init_db`.

- [ ] **Step 1: Write the failing test** — create `tests/census/test_zones_db_editable.py`:
```python
"""Tests for the editable raid-roster helpers added to zones_db."""

from __future__ import annotations

import sqlite3

from census import zones_db


def _seed_legacy_zone(path) -> tuple[int, int]:
    """Build a minimal zones.db with one zone + one comma-joined encounter
    (two mobs at positions 0 + 1). Returns (zone_id, encounter_id)."""
    conn = zones_db.init_db(path)
    try:
        conn.execute(
            "INSERT INTO zones (name, name_lower, expansion_short, expansion_source) "
            "VALUES ('Shard of Hate', 'shard of hate', 'RoK', 'test')"
        )
        zone_id = conn.execute("SELECT id FROM zones WHERE name = 'Shard of Hate'").fetchone()[0]
        # The bug: encounter_name is the comma-joined display
        conn.execute(
            "INSERT INTO zone_encounters (zone_id, encounter_name, position) "
            "VALUES (?, 'Ire, Malevolence', 3)",
            (zone_id,),
        )
        enc_id = conn.execute(
            "SELECT id FROM zone_encounters WHERE zone_id = ? AND position = 3", (zone_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO zone_encounter_mobs (encounter_id, mob_name, mob_name_lower, position) "
            "VALUES (?, 'Ire', 'ire', 0)",
            (enc_id,),
        )
        conn.execute(
            "INSERT INTO zone_encounter_mobs (encounter_id, mob_name, mob_name_lower, position) "
            "VALUES (?, 'Malevolence', 'malevolence', 1)",
            (enc_id,),
        )
        conn.commit()
        return zone_id, enc_id
    finally:
        conn.close()


def test_init_db_normalizes_comma_joined_encounter_name(tmp_path):
    """A legacy encounter whose name is the comma-joined mob list is rewritten
    to the position-0 mob's name. Non-comma names are left alone."""
    p = tmp_path / "zones.db"
    zone_id, enc_id = _seed_legacy_zone(p)
    # Add a non-comma encounter that should NOT be touched.
    with sqlite3.connect(p) as conn:
        conn.execute(
            "INSERT INTO zone_encounters (zone_id, encounter_name, position) "
            "VALUES (?, 'Demetrius Crane', 1)",
            (zone_id,),
        )
        enc_id2 = conn.execute(
            "SELECT id FROM zone_encounters WHERE zone_id = ? AND position = 1", (zone_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO zone_encounter_mobs (encounter_id, mob_name, mob_name_lower, position) "
            "VALUES (?, 'Demetrius Crane', 'demetrius crane', 0)",
            (enc_id2,),
        )
        conn.commit()

    # Re-init to trigger the normalization.
    conn = zones_db.init_db(p)
    try:
        rows = {
            r[0]: r[1]
            for r in conn.execute("SELECT id, encounter_name FROM zone_encounters")
        }
        assert rows[enc_id] == "Ire"             # comma-joined collapsed to primary
        assert rows[enc_id2] == "Demetrius Crane"  # untouched
    finally:
        conn.close()

    # Idempotent: second run is a no-op.
    conn = zones_db.init_db(p)
    try:
        assert conn.execute(
            "SELECT encounter_name FROM zone_encounters WHERE id = ?", (enc_id,)
        ).fetchone()[0] == "Ire"
    finally:
        conn.close()
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `uv run pytest tests/census/test_zones_db_editable.py::test_init_db_normalizes_comma_joined_encounter_name -v`
Expected: FAIL — `encounter_name` is still `"Ire, Malevolence"`.

- [ ] **Step 3: Add the normalization to `init_db`**

In `census/zones_db.py` `init_db`, just before the `conn.commit()`, append:
```python
        # One-time data normalization (idempotent): legacy `encounter_name`
        # values were the comma-joined display of every mob in the encounter
        # ("Ire, Malevolence"). The web roster editor treats encounter_name
        # as the PRIMARY mob's name (kept in sync with the mob at
        # position 0). Rewrite any comma-containing row to its position-0
        # mob name; rows without a position-0 mob are left untouched.
        conn.execute(
            """
            UPDATE zone_encounters
               SET encounter_name = (
                       SELECT mob_name FROM zone_encounter_mobs m
                        WHERE m.encounter_id = zone_encounters.id
                        ORDER BY position ASC
                        LIMIT 1
                   )
             WHERE encounter_name LIKE '%,%'
               AND EXISTS (
                       SELECT 1 FROM zone_encounter_mobs m
                        WHERE m.encounter_id = zone_encounters.id
                   )
            """
        )
```

- [ ] **Step 4: Run it — expect PASS**

Run: `uv run pytest tests/census/test_zones_db_editable.py -v`
Expected: PASS.

- [ ] **Step 5: Lint/type**

Run: `uv run ruff format census/zones_db.py tests/census/test_zones_db_editable.py && uv run ruff check census/zones_db.py tests/census/test_zones_db_editable.py && uv run pyright census/zones_db.py`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add census/zones_db.py tests/census/test_zones_db_editable.py
git commit -m "feat(zones): normalize comma-joined encounter_name to primary mob on init"
```
End with a trailing `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` line (blank line before it).

---

## Task 2: Encounter helpers — `add_encounter`, `update_encounter`, `delete_encounter`

**Files:**
- Modify: `census/zones_db.py` (new helpers, near the existing `replace_bosses_for_zone`)
- Modify: `census/raids_db.py` (add `delete_raid_encounter_by_zone_mob` helper if missing — see Step 3)
- Test: `tests/census/test_zones_db_editable.py`

Each write keeps the `raid_encounters` mirror in sync. Add takes the primary mob (creates a single position-0 row in `zone_encounter_mobs`). Update renames the primary (cascades to the position-0 mob + `encounter_name`). Delete cascades siblings (already via FK) plus the matching `raid_encounters` row (which CASCADEs triggers/timers/strategies).

- [ ] **Step 1: Read the existing `raids_db.upsert_raid_encounter` signature** so the mirror calls match. (`grep -n "def upsert_raid_encounter\|def delete_raid_encounter\|def get_raid_encounter" census/raids_db.py`.) Note whether a delete-by-(zone,mob) helper exists; if not, add it in Step 3.

- [ ] **Step 2: Failing tests** — append to `tests/census/test_zones_db_editable.py`:
```python
def _bootstrap_zone(p):
    """Single zone + zero encounters. Returns zone_id."""
    conn = zones_db.init_db(p)
    try:
        conn.execute(
            "INSERT INTO zones (name, name_lower, expansion_short, expansion_source) "
            "VALUES ('Test Zone', 'test zone', 'RoK', 'test')"
        )
        zid = conn.execute("SELECT id FROM zones WHERE name = 'Test Zone'").fetchone()[0]
        conn.commit()
        return zid
    finally:
        conn.close()


def test_add_encounter_creates_row_and_position0_mob(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Adkar Vyx", path=p)
    assert enc["encounter_name"] == "Adkar Vyx"
    assert enc["position"] == 1   # first append
    assert enc["mobs"] == [{"mob_name": "Adkar Vyx", "position": 0}]


def test_add_encounter_appends_after_existing(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    zones_db.add_encounter(zid, primary_mob="First", path=p)
    enc2 = zones_db.add_encounter(zid, primary_mob="Second", path=p)
    assert enc2["position"] == 2


def test_update_encounter_renames_primary_and_position0_mob(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Old Name", path=p)
    updated = zones_db.update_encounter(enc["id"], primary_mob="New Name", path=p)
    assert updated["encounter_name"] == "New Name"
    assert updated["mobs"][0]["mob_name"] == "New Name"


def test_delete_encounter_cascades_mobs(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Doomed", path=p)
    assert zones_db.delete_encounter(enc["id"], path=p) is True
    import sqlite3
    with sqlite3.connect(p) as c:
        assert c.execute(
            "SELECT COUNT(*) FROM zone_encounters WHERE id = ?", (enc["id"],)
        ).fetchone()[0] == 0
        assert c.execute(
            "SELECT COUNT(*) FROM zone_encounter_mobs WHERE encounter_id = ?", (enc["id"],)
        ).fetchone()[0] == 0
```

- [ ] **Step 3: Implement** — append to `census/zones_db.py`:
```python
def _row_to_encounter(conn: sqlite3.Connection, row: sqlite3.Row) -> dict:
    """Shape the encounter the way list_bosses_for_zone already returns."""
    mobs = [
        {"mob_name": r["mob_name"], "position": r["position"]}
        for r in conn.execute(
            "SELECT mob_name, position FROM zone_encounter_mobs "
            "WHERE encounter_id = ? ORDER BY position ASC",
            (row["id"],),
        )
    ]
    return {
        "id": row["id"],
        "zone_id": row["zone_id"],
        "encounter_name": row["encounter_name"],
        "position": row["position"],
        "stage": row["stage"],
        "wiki_url": row["wiki_url"],
        "mobs": mobs,
    }


def _mirror_raid_encounter(
    conn_raids,
    *,
    zone_name: str,
    expansion_short: str,
    mob_name: str | None = None,
    position: int | None = None,
) -> None:
    """If a raids_db.raid_encounters row exists for this (zone, original mob),
    update its mob_name and/or position to match. Lazy-creation is the
    existing _resolve_encounter_sync path's job; we only sync when a row
    is already present, so we don't materialize raid_encounters rows the
    user hasn't touched."""
    # Deferred import to avoid the census→web import cycle at module load.
    from census import raids_db as _raids_db
    _raids_db.update_raid_encounter_if_exists(
        conn_raids,
        zone_name=zone_name,
        expansion_short=expansion_short,
        mob_name=mob_name,
        position=position,
    )


def add_encounter(
    zone_id: int,
    *,
    primary_mob: str,
    position: int | None = None,
    stage: str | None = None,
    wiki_url: str | None = None,
    path: Path = DB_PATH,
) -> dict:
    """Append a new encounter to a zone with a single primary mob at position 0.

    If `position` is None, appends after the current max. If provided, inserts
    at that slot — the caller is responsible for ensuring it's unique within
    the zone (UNIQUE(zone_id, position) will raise otherwise). Returns the new
    encounter shape (id, encounter_name, position, stage, wiki_url, mobs)."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        if position is None:
            row = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 AS p FROM zone_encounters WHERE zone_id = ?",
                (zone_id,),
            ).fetchone()
            position = int(row["p"])
        cur = conn.execute(
            "INSERT INTO zone_encounters (zone_id, encounter_name, position, stage, wiki_url) "
            "VALUES (?, ?, ?, ?, ?)",
            (zone_id, primary_mob, position, stage, wiki_url),
        )
        enc_id = cur.lastrowid
        conn.execute(
            "INSERT INTO zone_encounter_mobs (encounter_id, mob_name, mob_name_lower, position) "
            "VALUES (?, ?, ?, 0)",
            (enc_id, primary_mob, primary_mob.lower()),
        )
        conn.commit()
        encounter_row = conn.execute(
            "SELECT id, zone_id, encounter_name, position, stage, wiki_url FROM zone_encounters WHERE id = ?",
            (enc_id,),
        ).fetchone()
        return _row_to_encounter(conn, encounter_row)


def update_encounter(
    encounter_id: int,
    *,
    primary_mob: str | None = None,
    stage: str | None = ...,   # sentinel: unset means don't touch
    wiki_url: str | None = ...,
    path: Path = DB_PATH,
) -> dict:
    """Edit encounter metadata. When `primary_mob` is given, also renames the
    position-0 mob in zone_encounter_mobs (the canonical primary) so the two
    stay in sync. `stage` and `wiki_url` use a sentinel default so callers
    can explicitly set them to None vs leave unchanged."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        row = conn.execute(
            "SELECT id, zone_id, encounter_name, position, stage, wiki_url FROM zone_encounters WHERE id = ?",
            (encounter_id,),
        ).fetchone()
        if row is None:
            raise LookupError(f"zone_encounter {encounter_id} not found")
        new_name = primary_mob if primary_mob is not None else row["encounter_name"]
        new_stage = row["stage"] if stage is ... else stage
        new_wiki = row["wiki_url"] if wiki_url is ... else wiki_url
        conn.execute(
            "UPDATE zone_encounters SET encounter_name = ?, stage = ?, wiki_url = ? WHERE id = ?",
            (new_name, new_stage, new_wiki, encounter_id),
        )
        if primary_mob is not None:
            conn.execute(
                "UPDATE zone_encounter_mobs SET mob_name = ?, mob_name_lower = ? "
                "WHERE encounter_id = ? AND position = 0",
                (primary_mob, primary_mob.lower(), encounter_id),
            )
        conn.commit()
        updated = conn.execute(
            "SELECT id, zone_id, encounter_name, position, stage, wiki_url FROM zone_encounters WHERE id = ?",
            (encounter_id,),
        ).fetchone()
        result = _row_to_encounter(conn, updated)
    # Mirror the rename onto raids_db (if a row exists there).
    if primary_mob is not None:
        zone_name, expansion_short = _zone_name_and_expansion(row["zone_id"], path)
        if zone_name is not None:
            from census import raids_db as _raids_db
            with sqlite3.connect(_raids_db.DB_PATH) as rconn:
                rconn.row_factory = sqlite3.Row
                rconn.execute("PRAGMA foreign_keys = ON;")
                _raids_db.rename_raid_encounter_if_exists(
                    rconn,
                    zone_name=zone_name,
                    old_mob_name=row["encounter_name"],
                    new_mob_name=primary_mob,
                )
                rconn.commit()
    return result


def delete_encounter(encounter_id: int, path: Path = DB_PATH) -> bool:
    """Delete the encounter row. Cascades to zone_encounter_mobs (FK), and
    deletes the matching raids_db row if present (which CASCADEs triggers,
    spell timers, and strategy revisions)."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        row = conn.execute(
            "SELECT id, zone_id, encounter_name FROM zone_encounters WHERE id = ?",
            (encounter_id,),
        ).fetchone()
        if row is None:
            return False
        zone_name, _ = _zone_name_and_expansion(row["zone_id"], path)
        conn.execute("DELETE FROM zone_encounters WHERE id = ?", (encounter_id,))
        conn.commit()
    # Drop the raids_db mirror (if any).
    if zone_name is not None:
        from census import raids_db as _raids_db
        with sqlite3.connect(_raids_db.DB_PATH) as rconn:
            rconn.execute("PRAGMA foreign_keys = ON;")
            _raids_db.delete_raid_encounter_by_zone_mob(
                rconn, zone_name=zone_name, mob_name=row["encounter_name"]
            )
            rconn.commit()
    return True


def _zone_name_and_expansion(zone_id: int, path: Path) -> tuple[str | None, str | None]:
    """Look up the canonical zone name + expansion for the raids_db mirror."""
    with sqlite3.connect(path) as conn:
        r = conn.execute(
            "SELECT name, expansion_short FROM zones WHERE id = ?", (zone_id,)
        ).fetchone()
        return (r[0], r[1]) if r else (None, None)
```

In `census/raids_db.py`, add (next to existing `upsert_raid_encounter`):
```python
def rename_raid_encounter_if_exists(
    conn: sqlite3.Connection,
    *,
    zone_name: str,
    old_mob_name: str,
    new_mob_name: str,
) -> bool:
    """If a raid_encounters row matches (zone_name, old_mob_name), rename its
    mob_name + mob_name_lower. No-op otherwise. Returns True if updated."""
    cur = conn.execute(
        """
        UPDATE raid_encounters
           SET mob_name = ?,
               mob_name_lower = ?,
               last_edited_at = strftime('%s','now')
         WHERE id IN (
             SELECT re.id FROM raid_encounters re
             JOIN raid_zones rz ON rz.id = re.raid_zone_id
             WHERE rz.zone_name_lower = ?
               AND re.mob_name_lower = ?
         )
        """,
        (new_mob_name, new_mob_name.lower(), zone_name.lower(), old_mob_name.lower()),
    )
    return cur.rowcount > 0


def update_raid_encounter_if_exists(
    conn: sqlite3.Connection,
    *,
    zone_name: str,
    expansion_short: str,
    mob_name: str | None = None,
    position: int | None = None,
) -> bool:
    """Update mob_name and/or position on an existing raid_encounters row
    found by (zone_name, current mob_name). For position-only updates,
    callers should pass the CURRENT mob_name (post-rename) so the row is
    located. No-op if no matching row. Returns True if updated."""
    if mob_name is None and position is None:
        return False
    sets = []
    params: list = []
    if mob_name is not None:
        sets.append("mob_name = ?")
        sets.append("mob_name_lower = ?")
        params.extend([mob_name, mob_name.lower()])
    if position is not None:
        sets.append("position = ?")
        params.append(position)
    sets.append("last_edited_at = strftime('%s','now')")
    where_params = [zone_name.lower(), (mob_name or "").lower()]
    sql = f"""
        UPDATE raid_encounters
           SET {", ".join(sets)}
         WHERE id IN (
             SELECT re.id FROM raid_encounters re
             JOIN raid_zones rz ON rz.id = re.raid_zone_id
             WHERE rz.zone_name_lower = ?
               AND re.mob_name_lower = ?
         )
    """
    cur = conn.execute(sql, params + where_params)
    return cur.rowcount > 0


def delete_raid_encounter_by_zone_mob(
    conn: sqlite3.Connection, *, zone_name: str, mob_name: str
) -> bool:
    """Delete a raid_encounters row by its (zone_name, mob_name) lookup.
    CASCADEs to triggers, spell timers, strategy revisions via the FK.
    Returns True if a row was deleted."""
    cur = conn.execute(
        """
        DELETE FROM raid_encounters
         WHERE id IN (
             SELECT re.id FROM raid_encounters re
             JOIN raid_zones rz ON rz.id = re.raid_zone_id
             WHERE rz.zone_name_lower = ?
               AND re.mob_name_lower = ?
         )
        """,
        (zone_name.lower(), mob_name.lower()),
    )
    return cur.rowcount > 0
```

- [ ] **Step 4: Run — expect PASS**

Run: `uv run pytest tests/census/test_zones_db_editable.py -v`
Expected: all PASS.

- [ ] **Step 5: Lint/type**

Run: `uv run ruff format census/zones_db.py census/raids_db.py tests/census/test_zones_db_editable.py && uv run ruff check census/zones_db.py census/raids_db.py tests/census/test_zones_db_editable.py && uv run pyright census/zones_db.py census/raids_db.py`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add census/zones_db.py census/raids_db.py tests/census/test_zones_db_editable.py
git commit -m "feat(zones): add_encounter / update_encounter / delete_encounter helpers + raids mirror"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 3: `reorder_encounters` — atomic bulk reorder

**Files:**
- Modify: `census/zones_db.py`
- Test: `tests/census/test_zones_db_editable.py`

The drag-reorder UI commits a single PUT with the full desired ordering. Atomic, validated as a complete permutation of the zone's encounter ids, mirrored to `raid_encounters` rows where present.

- [ ] **Step 1: Failing tests** — append:
```python
def test_reorder_encounters_atomic_permutation(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    a = zones_db.add_encounter(zid, primary_mob="A", path=p)
    b = zones_db.add_encounter(zid, primary_mob="B", path=p)
    c = zones_db.add_encounter(zid, primary_mob="C", path=p)
    # Reverse order: C, B, A
    zones_db.reorder_encounters(zid, [c["id"], b["id"], a["id"]], path=p)
    import sqlite3
    with sqlite3.connect(p) as conn:
        positions = {
            r[0]: r[1]
            for r in conn.execute(
                "SELECT id, position FROM zone_encounters WHERE zone_id = ?", (zid,)
            )
        }
    assert positions[c["id"]] == 1
    assert positions[b["id"]] == 2
    assert positions[a["id"]] == 3


def test_reorder_encounters_rejects_missing_id(tmp_path):
    import pytest as _pytest
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    a = zones_db.add_encounter(zid, primary_mob="A", path=p)
    b = zones_db.add_encounter(zid, primary_mob="B", path=p)
    with _pytest.raises(ValueError):
        zones_db.reorder_encounters(zid, [a["id"]], path=p)  # missing b
    with _pytest.raises(ValueError):
        zones_db.reorder_encounters(zid, [a["id"], b["id"], 9999], path=p)  # extra
```

- [ ] **Step 2: Implement** — append to `census/zones_db.py`:
```python
def reorder_encounters(
    zone_id: int,
    ordered_encounter_ids: list[int],
    path: Path = DB_PATH,
) -> None:
    """Atomically renumber the zone's encounters to 1..N matching the given
    order. The list MUST be a complete permutation of that zone's current
    encounter ids (no duplicates, no missing ids, no foreign ids) — raises
    ValueError otherwise. The two-phase write (NULL then 1..N) is needed
    because UNIQUE(zone_id, position) would otherwise reject mid-update
    collisions."""
    if len(ordered_encounter_ids) != len(set(ordered_encounter_ids)):
        raise ValueError("ordered_encounter_ids contains duplicates")
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        current = {
            r["id"]: (r["encounter_name"], r["position"])
            for r in conn.execute(
                "SELECT id, encounter_name, position FROM zone_encounters WHERE zone_id = ?",
                (zone_id,),
            )
        }
        if set(ordered_encounter_ids) != set(current.keys()):
            missing = set(current.keys()) - set(ordered_encounter_ids)
            extra = set(ordered_encounter_ids) - set(current.keys())
            raise ValueError(
                f"reorder_encounters: not a permutation of zone {zone_id}'s "
                f"encounters (missing={sorted(missing)}, extra={sorted(extra)})"
            )
        zone_row = conn.execute(
            "SELECT name, expansion_short FROM zones WHERE id = ?", (zone_id,)
        ).fetchone()
        zone_name = zone_row["name"] if zone_row else None
        with conn:  # single transaction
            # Two-phase to dodge the UNIQUE(zone_id, position) collision on
            # mid-update overlap: write negative sentinels first, then 1..N.
            for tmp_neg, enc_id in enumerate(ordered_encounter_ids, start=1):
                conn.execute(
                    "UPDATE zone_encounters SET position = ? WHERE id = ?",
                    (-tmp_neg, enc_id),
                )
            for new_pos, enc_id in enumerate(ordered_encounter_ids, start=1):
                conn.execute(
                    "UPDATE zone_encounters SET position = ? WHERE id = ?",
                    (new_pos, enc_id),
                )
    # Mirror onto raids_db: for each encounter whose mob has a raid_encounters
    # row, update its position. Look up by current encounter_name (post-rename).
    if zone_name is None:
        return
    from census import raids_db as _raids_db
    with sqlite3.connect(_raids_db.DB_PATH) as rconn:
        rconn.execute("PRAGMA foreign_keys = ON;")
        for new_pos, enc_id in enumerate(ordered_encounter_ids, start=1):
            name, _old_pos = current[enc_id]
            _raids_db.update_raid_encounter_if_exists(
                rconn,
                zone_name=zone_name,
                expansion_short="",  # unused for position-only update
                mob_name=name,
                position=new_pos,
            )
        rconn.commit()
```

- [ ] **Step 3: Run — expect PASS**

Run: `uv run pytest tests/census/test_zones_db_editable.py -v`
Expected: all PASS (Tasks 1-3 tests).

- [ ] **Step 4: Lint/type/commit**

```bash
uv run ruff format census/zones_db.py tests/census/test_zones_db_editable.py
uv run ruff check  census/zones_db.py tests/census/test_zones_db_editable.py
uv run pyright    census/zones_db.py
git add census/zones_db.py tests/census/test_zones_db_editable.py
git commit -m "feat(zones): reorder_encounters atomic permutation with raids mirror"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 4: Mob helpers — `add_mob`, `update_mob`, `promote_mob`, `delete_mob`

**Files:**
- Modify: `census/zones_db.py`
- Test: `tests/census/test_zones_db_editable.py`

Convention: position 0 = primary; positions 1..N = siblings. Promote = swap 0↔N + update `encounter_name`. Delete refuses last-mob and primary-while-siblings-exist.

- [ ] **Step 1: Failing tests** — append:
```python
def test_add_mob_appends_sibling(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Primary", path=p)
    sib = zones_db.add_mob(enc["id"], mob_name="Sibling", path=p)
    assert sib["position"] == 1
    enc2 = zones_db.add_mob(enc["id"], mob_name="Third", path=p)
    assert enc2["position"] == 2


def test_add_mob_make_primary_shifts_old_primary(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="OldPrimary", path=p)
    zones_db.add_mob(enc["id"], mob_name="NewPrimary", make_primary=True, path=p)
    import sqlite3
    with sqlite3.connect(p) as conn:
        mobs = [
            (r[0], r[1]) for r in conn.execute(
                "SELECT mob_name, position FROM zone_encounter_mobs "
                "WHERE encounter_id = ? ORDER BY position", (enc["id"],),
            )
        ]
    assert mobs[0] == ("NewPrimary", 0)
    assert ("OldPrimary", 1) in mobs
    # encounter_name follows the primary
    with sqlite3.connect(p) as conn:
        name = conn.execute(
            "SELECT encounter_name FROM zone_encounters WHERE id = ?", (enc["id"],)
        ).fetchone()[0]
    assert name == "NewPrimary"


def test_update_mob_renames_primary_updates_encounter_name(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Primary", path=p)
    sib = zones_db.add_mob(enc["id"], mob_name="Sibling", path=p)
    # Rename the primary (pos 0) - cascades to encounter_name
    primary_id = next(
        m["id"] for m in zones_db.list_mobs(enc["id"], path=p) if m["position"] == 0
    )
    zones_db.update_mob(primary_id, mob_name="Renamed", path=p)
    import sqlite3
    with sqlite3.connect(p) as conn:
        assert conn.execute(
            "SELECT encounter_name FROM zone_encounters WHERE id = ?", (enc["id"],)
        ).fetchone()[0] == "Renamed"
    # Rename a sibling — encounter_name NOT updated
    zones_db.update_mob(sib["id"], mob_name="SibRenamed", path=p)
    with sqlite3.connect(p) as conn:
        assert conn.execute(
            "SELECT encounter_name FROM zone_encounters WHERE id = ?", (enc["id"],)
        ).fetchone()[0] == "Renamed"


def test_promote_mob_swaps_with_primary(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Primary", path=p)
    sib = zones_db.add_mob(enc["id"], mob_name="Sibling", path=p)
    zones_db.promote_mob(sib["id"], path=p)
    import sqlite3
    with sqlite3.connect(p) as conn:
        mobs = [
            (r[0], r[1]) for r in conn.execute(
                "SELECT mob_name, position FROM zone_encounter_mobs "
                "WHERE encounter_id = ? ORDER BY position", (enc["id"],),
            )
        ]
        name = conn.execute(
            "SELECT encounter_name FROM zone_encounters WHERE id = ?", (enc["id"],)
        ).fetchone()[0]
    assert mobs == [("Sibling", 0), ("Primary", 1)]
    assert name == "Sibling"


def test_delete_mob_refuses_last_mob(tmp_path):
    import pytest as _pytest
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Only", path=p)
    only_id = next(
        m["id"] for m in zones_db.list_mobs(enc["id"], path=p) if m["position"] == 0
    )
    with _pytest.raises(ValueError, match="last mob"):
        zones_db.delete_mob(only_id, path=p)


def test_delete_mob_refuses_primary_while_siblings_exist(tmp_path):
    import pytest as _pytest
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Primary", path=p)
    zones_db.add_mob(enc["id"], mob_name="Sibling", path=p)
    primary_id = next(
        m["id"] for m in zones_db.list_mobs(enc["id"], path=p) if m["position"] == 0
    )
    with _pytest.raises(ValueError, match="primary"):
        zones_db.delete_mob(primary_id, path=p)


def test_delete_mob_sibling_succeeds(tmp_path):
    p = tmp_path / "zones.db"
    zid = _bootstrap_zone(p)
    enc = zones_db.add_encounter(zid, primary_mob="Primary", path=p)
    sib = zones_db.add_mob(enc["id"], mob_name="Sibling", path=p)
    assert zones_db.delete_mob(sib["id"], path=p) is True
    mobs = zones_db.list_mobs(enc["id"], path=p)
    assert [m["mob_name"] for m in mobs] == ["Primary"]
```

- [ ] **Step 2: Implement** — append to `census/zones_db.py`:
```python
def list_mobs(encounter_id: int, path: Path = DB_PATH) -> list[dict]:
    """All mobs for an encounter, ordered by position. Each row is
    {id, mob_name, position}."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        return [
            {"id": r["id"], "mob_name": r["mob_name"], "position": r["position"]}
            for r in conn.execute(
                "SELECT id, mob_name, position FROM zone_encounter_mobs "
                "WHERE encounter_id = ? ORDER BY position ASC",
                (encounter_id,),
            )
        ]


def _encounter_zone_id(conn: sqlite3.Connection, encounter_id: int) -> int | None:
    row = conn.execute(
        "SELECT zone_id, encounter_name FROM zone_encounters WHERE id = ?",
        (encounter_id,),
    ).fetchone()
    return (row[0], row[1]) if row else (None, None)


def add_mob(
    encounter_id: int,
    *,
    mob_name: str,
    make_primary: bool = False,
    path: Path = DB_PATH,
) -> dict:
    """Add a mob to an encounter. By default appends as a sibling at the
    next available position. With make_primary=True, inserts at position 0
    and shifts the existing primary to position 1, then updates the parent
    encounter_name to the new primary."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        with conn:
            if make_primary:
                # Shift every existing mob down by 1 (use negative sentinels
                # to dodge any unique-ish collisions, even though there is no
                # UNIQUE on (encounter_id, position) — keeping the pattern
                # consistent with reorder_encounters).
                conn.execute(
                    "UPDATE zone_encounter_mobs SET position = -position - 1 "
                    "WHERE encounter_id = ?",
                    (encounter_id,),
                )
                conn.execute(
                    "UPDATE zone_encounter_mobs SET position = -position "
                    "WHERE encounter_id = ?",
                    (encounter_id,),
                )
                # Now positions are 1..N; insert new primary at 0.
                cur = conn.execute(
                    "INSERT INTO zone_encounter_mobs "
                    "(encounter_id, mob_name, mob_name_lower, position) "
                    "VALUES (?, ?, ?, 0)",
                    (encounter_id, mob_name, mob_name.lower()),
                )
                new_id = cur.lastrowid
                conn.execute(
                    "UPDATE zone_encounters SET encounter_name = ? WHERE id = ?",
                    (mob_name, encounter_id),
                )
            else:
                next_pos = conn.execute(
                    "SELECT COALESCE(MAX(position), -1) + 1 FROM zone_encounter_mobs "
                    "WHERE encounter_id = ?",
                    (encounter_id,),
                ).fetchone()[0]
                cur = conn.execute(
                    "INSERT INTO zone_encounter_mobs "
                    "(encounter_id, mob_name, mob_name_lower, position) "
                    "VALUES (?, ?, ?, ?)",
                    (encounter_id, mob_name, mob_name.lower(), next_pos),
                )
                new_id = cur.lastrowid
        row = conn.execute(
            "SELECT id, mob_name, position FROM zone_encounter_mobs WHERE id = ?",
            (new_id,),
        ).fetchone()
        return {"id": row["id"], "mob_name": row["mob_name"], "position": row["position"]}


def update_mob(mob_id: int, *, mob_name: str, path: Path = DB_PATH) -> dict:
    """Rename a mob. If it's at position 0 (the primary), also updates the
    parent encounter_name so the two stay in sync."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        row = conn.execute(
            "SELECT encounter_id, position FROM zone_encounter_mobs WHERE id = ?",
            (mob_id,),
        ).fetchone()
        if row is None:
            raise LookupError(f"zone_encounter_mob {mob_id} not found")
        with conn:
            conn.execute(
                "UPDATE zone_encounter_mobs SET mob_name = ?, mob_name_lower = ? WHERE id = ?",
                (mob_name, mob_name.lower(), mob_id),
            )
            if row["position"] == 0:
                conn.execute(
                    "UPDATE zone_encounters SET encounter_name = ? WHERE id = ?",
                    (mob_name, row["encounter_id"]),
                )
        out = conn.execute(
            "SELECT id, mob_name, position FROM zone_encounter_mobs WHERE id = ?",
            (mob_id,),
        ).fetchone()
        return {"id": out["id"], "mob_name": out["mob_name"], "position": out["position"]}


def promote_mob(mob_id: int, path: Path = DB_PATH) -> dict:
    """Swap a sibling with the current primary (position 0). No-op if the
    mob is already primary. Updates the parent encounter_name to the new
    primary."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        row = conn.execute(
            "SELECT id, encounter_id, mob_name, position FROM zone_encounter_mobs WHERE id = ?",
            (mob_id,),
        ).fetchone()
        if row is None:
            raise LookupError(f"zone_encounter_mob {mob_id} not found")
        if row["position"] == 0:
            return {"id": row["id"], "mob_name": row["mob_name"], "position": 0}
        primary = conn.execute(
            "SELECT id, mob_name FROM zone_encounter_mobs "
            "WHERE encounter_id = ? AND position = 0",
            (row["encounter_id"],),
        ).fetchone()
        with conn:
            # Negative sentinel to swap atomically without colliding.
            conn.execute(
                "UPDATE zone_encounter_mobs SET position = -1 WHERE id = ?",
                (primary["id"],),
            )
            conn.execute(
                "UPDATE zone_encounter_mobs SET position = 0 WHERE id = ?",
                (mob_id,),
            )
            conn.execute(
                "UPDATE zone_encounter_mobs SET position = ? WHERE id = ?",
                (row["position"], primary["id"]),
            )
            conn.execute(
                "UPDATE zone_encounters SET encounter_name = ? WHERE id = ?",
                (row["mob_name"], row["encounter_id"]),
            )
        out = conn.execute(
            "SELECT id, mob_name, position FROM zone_encounter_mobs WHERE id = ?",
            (mob_id,),
        ).fetchone()
        return {"id": out["id"], "mob_name": out["mob_name"], "position": out["position"]}


def delete_mob(mob_id: int, path: Path = DB_PATH) -> bool:
    """Delete a mob. Refuses with ValueError when it's the only mob in the
    encounter (encounter needs ≥1 mob) or when it's the primary while
    siblings exist (the user must promote a sibling first so encounter_name
    has somewhere to point)."""
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        row = conn.execute(
            "SELECT id, encounter_id, position FROM zone_encounter_mobs WHERE id = ?",
            (mob_id,),
        ).fetchone()
        if row is None:
            return False
        total = conn.execute(
            "SELECT COUNT(*) FROM zone_encounter_mobs WHERE encounter_id = ?",
            (row["encounter_id"],),
        ).fetchone()[0]
        if total <= 1:
            raise ValueError("cannot delete the last mob of an encounter")
        if row["position"] == 0:
            raise ValueError(
                "cannot delete the primary mob while siblings exist; "
                "promote a sibling to primary first"
            )
        conn.execute("DELETE FROM zone_encounter_mobs WHERE id = ?", (mob_id,))
        conn.commit()
        return True
```

- [ ] **Step 3: Run — expect PASS**

Run: `uv run pytest tests/census/test_zones_db_editable.py -v`
Expected: all PASS.

- [ ] **Step 4: Lint/type/commit**

```bash
uv run ruff format census/zones_db.py tests/census/test_zones_db_editable.py
uv run ruff check  census/zones_db.py tests/census/test_zones_db_editable.py
uv run pyright    census/zones_db.py
git add census/zones_db.py tests/census/test_zones_db_editable.py
git commit -m "feat(zones): mob helpers add/update/promote/delete with primary-mob invariants"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 5: Write endpoints — `web/routes/zones_admin.py`

**Files:**
- Create: `web/routes/zones_admin.py`
- Modify: `web/app.py` (register router)
- Test: `tests/web/test_zones_admin.py`

All endpoints `@Depends(require_editor)`. Each resolves zone name → zone_id, calls the matching helper, returns the updated encounter (or 204 for delete). Helpers run via `asyncio.get_event_loop().run_in_executor(None, …)` to match the existing pattern in `act_triggers.py`.

- [ ] **Step 1: Failing test** — `tests/web/test_zones_admin.py`:
```python
"""Tests for the new write endpoints on /api/zones/{zone}/encounters."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_add_encounter_requires_editor(app):
    """A request with no editor session is rejected (auth gate)."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/api/zones/Shard of Hate/encounters",
            json={"primary_mob": "Hackerman"},
        )
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_add_encounter_happy_path(app, editor_session):
    """Editor adds a new boss; helper called with the zone_id resolved
    from zones_db.find_by_name."""
    with (
        patch(
            "web.routes.zones_admin.zones_db.find_by_name",
            return_value={"id": 12, "name": "Shard of Hate"},
        ),
        patch(
            "web.routes.zones_admin.zones_db.add_encounter",
            return_value={
                "id": 99, "zone_id": 12, "encounter_name": "Newboss",
                "position": 7, "stage": None, "wiki_url": None,
                "mobs": [{"mob_name": "Newboss", "position": 0}],
            },
        ) as add_mock,
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await editor_session.post(
                client,
                "/api/zones/Shard of Hate/encounters",
                json={"primary_mob": "Newboss"},
            )
    assert r.status_code == 200
    assert r.json()["encounter_name"] == "Newboss"
    add_mock.assert_called_once()
    kwargs = add_mock.call_args.kwargs
    assert kwargs["zone_id"] == 12
    assert kwargs["primary_mob"] == "Newboss"
```

> Reuse whatever editor-session fixture `tests/web/test_act_triggers.py` already uses (look at its conftest setup or its inline auth-token override). If no fixture exists, look at how `test_act_triggers.py`'s `require_editor`-gated tests authenticate (mock `web.auth_deps.require_editor` to return a fake session, or set a session cookie). Match the existing pattern exactly. If the pattern is "patch `require_editor` to be a no-op," do that — the goal is to confirm the route plumbing, not re-test auth.

- [ ] **Step 2: Run — expect FAIL** (router not registered).

Run: `uv run pytest tests/web/test_zones_admin.py -v`
Expected: 404 / module import error.

- [ ] **Step 3: Implement the router** — create `web/routes/zones_admin.py`:
```python
"""Write endpoints for the per-zone raid boss roster — add/edit/delete/reorder
encounters and add/edit/promote/delete mobs within an encounter. All gated by
require_editor (admin OR contributor). Reads still live in web/routes/zones.py;
this sibling file keeps the read/write split clean."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from census import zones_db
from web.auth_deps import require_editor

router = APIRouter(tags=["zones-admin"])


def _resolve_zone_id_sync(zone_name: str) -> int | None:
    z = zones_db.find_by_name(zone_name)
    return z["id"] if z else None


async def _resolve_zone_id(zone_name: str) -> int:
    loop = asyncio.get_event_loop()
    zid = await loop.run_in_executor(None, _resolve_zone_id_sync, zone_name)
    if zid is None:
        raise HTTPException(status_code=404, detail=f"Zone {zone_name!r} not found")
    return zid


# --- request bodies ----------------------------------------------------------


class EncounterCreateBody(BaseModel):
    primary_mob: str = Field(..., min_length=1)
    position: int | None = None
    stage: str | None = None
    wiki_url: str | None = None


class EncounterUpdateBody(BaseModel):
    primary_mob: str | None = Field(None, min_length=1)
    stage: str | None = None
    wiki_url: str | None = None


class ReorderBody(BaseModel):
    ordered_encounter_ids: list[int] = Field(..., min_length=1)


class MobCreateBody(BaseModel):
    mob_name: str = Field(..., min_length=1)
    make_primary: bool = False


class MobUpdateBody(BaseModel):
    mob_name: str = Field(..., min_length=1)


# --- endpoints ---------------------------------------------------------------


@router.post("/zones/{zone_name}/encounters", dependencies=[Depends(require_editor)])
async def create_encounter(zone_name: str, body: EncounterCreateBody) -> dict:
    zone_id = await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: zones_db.add_encounter(
            zone_id=zone_id,
            primary_mob=body.primary_mob,
            position=body.position,
            stage=body.stage,
            wiki_url=body.wiki_url,
        ),
    )


@router.put(
    "/zones/{zone_name}/encounters/{encounter_id}",
    dependencies=[Depends(require_editor)],
)
async def edit_encounter(
    zone_name: str, encounter_id: int, body: EncounterUpdateBody
) -> dict:
    await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(
            None,
            lambda: zones_db.update_encounter(
                encounter_id,
                primary_mob=body.primary_mob,
                stage=body.stage if body.stage is not None else ...,
                wiki_url=body.wiki_url if body.wiki_url is not None else ...,
            ),
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/zones/{zone_name}/encounters/{encounter_id}",
    status_code=204,
    dependencies=[Depends(require_editor)],
)
async def remove_encounter(zone_name: str, encounter_id: int) -> None:
    await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    ok = await loop.run_in_executor(None, zones_db.delete_encounter, encounter_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Encounter not found")


@router.put(
    "/zones/{zone_name}/encounters/reorder",
    dependencies=[Depends(require_editor)],
)
async def reorder_zone_encounters(zone_name: str, body: ReorderBody) -> dict:
    zone_id = await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            zones_db.reorder_encounters,
            zone_id,
            body.ordered_encounter_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Return the freshly-ordered zone so the front-end can re-render
    # without a second round trip.
    z = await loop.run_in_executor(None, zones_db.find_by_name, zone_name)
    return z or {}


@router.post(
    "/zones/{zone_name}/encounters/{encounter_id}/mobs",
    dependencies=[Depends(require_editor)],
)
async def create_mob(
    zone_name: str, encounter_id: int, body: MobCreateBody
) -> dict:
    await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: zones_db.add_mob(
            encounter_id,
            mob_name=body.mob_name,
            make_primary=body.make_primary,
        ),
    )


@router.put(
    "/zones/{zone_name}/encounters/{encounter_id}/mobs/{mob_id}",
    dependencies=[Depends(require_editor)],
)
async def edit_mob(
    zone_name: str, encounter_id: int, mob_id: int, body: MobUpdateBody
) -> dict:
    await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(
            None, lambda: zones_db.update_mob(mob_id, mob_name=body.mob_name)
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/zones/{zone_name}/encounters/{encounter_id}/mobs/{mob_id}/promote",
    dependencies=[Depends(require_editor)],
)
async def promote_mob_route(zone_name: str, encounter_id: int, mob_id: int) -> dict:
    await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(None, zones_db.promote_mob, mob_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete(
    "/zones/{zone_name}/encounters/{encounter_id}/mobs/{mob_id}",
    status_code=204,
    dependencies=[Depends(require_editor)],
)
async def remove_mob(zone_name: str, encounter_id: int, mob_id: int) -> None:
    await _resolve_zone_id(zone_name)
    loop = asyncio.get_event_loop()
    try:
        ok = await loop.run_in_executor(None, zones_db.delete_mob, mob_id)
    except ValueError as exc:
        # 422: refuse last-mob or primary-while-siblings
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Mob not found")
```

- [ ] **Step 4: Register** in `web/app.py`. Add alongside the other route imports:
```python
from web.routes.zones_admin import router as zones_admin_router
```
And include alongside the other `app.include_router(...)` calls:
```python
    app.include_router(zones_admin_router, prefix="/api")
```

- [ ] **Step 5: Run — expect PASS**

Run: `uv run pytest tests/web/test_zones_admin.py -v` (then `uv run pytest tests/web -q` to confirm nothing else regressed).
Expected: PASS on the new tests; full web suite green.

- [ ] **Step 6: Lint/type/commit**

```bash
uv run ruff format web/routes/zones_admin.py web/app.py tests/web/test_zones_admin.py
uv run ruff check  web/routes/zones_admin.py web/app.py tests/web/test_zones_admin.py
uv run pyright    web/routes/zones_admin.py web/app.py
git add web/routes/zones_admin.py web/app.py tests/web/test_zones_admin.py
git commit -m "feat(zones): editor-gated write endpoints for the boss roster"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 6: Frontend — `BossRosterEditor` + drag-reorder + RaidZonePage integration

**Files:**
- Modify: `frontend/package.json` (add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`)
- Create: `frontend/src/components/BossRosterEditor.tsx`
- Modify: `frontend/src/pages/RaidZonePage.tsx` (mount the editor when the toggle is on)

**HOLD COMMIT FOR USER REVIEW.** Build + typecheck only; do NOT commit. The controller will present this for visual sign-off before shipping.

### REQUIRED first reading

- `frontend/src/pages/RaidZonePage.tsx` — the existing read-only sidebar, the `canEdit` derivation (mirror exactly what the triggers UI uses), the fetch that loads the zone with bosses (the response shape — boss = `{id, encounter_name, position, stage, wiki_url, mobs:[{mob_name, position}]}` after this work; check whether the read endpoint already returns `id` for each mob — if it doesn't, the editor still works on `(encounter_id, mob_position)` for mob ops; prefer fetching mob ids via the new `/encounters/{id}/mobs`-list pattern if available, otherwise rely on indices).
- `frontend/src/components/ActTriggers.tsx` — for the editor-role-gate pattern (the same `canEdit` derivation), error-handling style, and how it calls reload after mutations.
- `frontend/src/components/ui/` — Button, Card, primitives. Match their look.

### Steps

- [ ] **Step 1: Install dnd-kit**

```bash
cd frontend
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```
Expected: clean install, three deps added to `package.json` + `package-lock.json`.

- [ ] **Step 2: Build `BossRosterEditor.tsx`** — `frontend/src/components/BossRosterEditor.tsx`:
```tsx
import { useMemo, useState } from 'react'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from './ui/Button'

interface Mob { mob_name: string; position: number; id?: number }
interface Encounter {
  id: number
  encounter_name: string
  position: number
  stage: string | null
  wiki_url: string | null
  mobs: Mob[]
}

interface Props {
  zoneName: string
  encounters: Encounter[]
  onReload: () => Promise<void> | void
}

export function BossRosterEditor({ zoneName, encounters, onReload }: Props) {
  const [order, setOrder] = useState<number[]>(() => encounters.map(e => e.id))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Keep local order in sync if the parent reloads with new data.
  const byId = useMemo(() => new Map(encounters.map(e => [e.id, e])), [encounters])
  const orderedEncounters = order
    .map(id => byId.get(id))
    .filter((e): e is Encounter => Boolean(e))

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function commitReorder(newOrder: number[]) {
    const base = `/api/zones/${encodeURIComponent(zoneName)}/encounters/reorder`
    setErr(null)
    const r = await fetch(base, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ordered_encounter_ids: newOrder }),
    })
    if (!r.ok) {
      setErr(`Reorder failed: ${r.status}`)
      // Revert local order — refetch authoritative state.
      await onReload()
      return
    }
    await onReload()
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = order.indexOf(active.id as number)
    const newIdx = order.indexOf(over.id as number)
    const next = arrayMove(order, oldIdx, newIdx)
    setOrder(next)
    void commitReorder(next)
  }

  async function deleteEncounter(id: number, name: string) {
    if (!window.confirm(
      `Delete "${name}" and ALL its triggers / spell timers / strategy? This can't be undone.`,
    )) return
    const r = await fetch(
      `/api/zones/${encodeURIComponent(zoneName)}/encounters/${id}`,
      { method: 'DELETE', credentials: 'include' },
    )
    if (!r.ok && r.status !== 204) {
      setErr(`Delete failed: ${r.status}`)
      return
    }
    await onReload()
  }

  return (
    <div>
      {err && <div className="text-danger text-sm py-2">{err}</div>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {orderedEncounters.map(enc => (
            <SortableBossRow
              key={enc.id}
              encounter={enc}
              isEditing={editingId === enc.id}
              onStartEdit={() => setEditingId(enc.id)}
              onCancelEdit={() => setEditingId(null)}
              onDelete={() => deleteEncounter(enc.id, enc.encounter_name)}
              onReload={onReload}
              zoneName={zoneName}
            />
          ))}
        </SortableContext>
      </DndContext>
      {!addingNew && (
        <Button variant="primary" size="sm" onClick={() => setAddingNew(true)}>
          + Add boss
        </Button>
      )}
      {addingNew && (
        <NewBossForm
          zoneName={zoneName}
          onCancel={() => setAddingNew(false)}
          onSaved={async () => { setAddingNew(false); await onReload() }}
        />
      )}
    </div>
  )
}

function SortableBossRow({
  encounter, isEditing, onStartEdit, onCancelEdit, onDelete, onReload, zoneName,
}: {
  encounter: Encounter
  isEditing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
  onReload: () => Promise<void> | void
  zoneName: string
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: encounter.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className="card mb-2 p-3">
      <div className="flex items-center gap-2">
        <button
          {...attributes} {...listeners}
          className="appearance-none border-0 bg-transparent cursor-grab text-text-muted text-lg"
          title="Drag to reorder"
        >⋮⋮</button>
        <span className="flex-1 font-heading text-gold">{encounter.encounter_name}</span>
        {encounter.mobs.length > 1 && (
          <span className="text-text-muted text-xs">+{encounter.mobs.length - 1} sibling{encounter.mobs.length - 1 === 1 ? '' : 's'}</span>
        )}
        <Button size="sm" variant="secondary" onClick={onStartEdit}>Edit</Button>
        <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
      </div>
      {isEditing && (
        <EncounterEditPanel
          zoneName={zoneName}
          encounter={encounter}
          onCancel={onCancelEdit}
          onSaved={async () => { onCancelEdit(); await onReload() }}
        />
      )}
    </div>
  )
}

function NewBossForm({
  zoneName, onCancel, onSaved,
}: { zoneName: string; onCancel: () => void; onSaved: () => void | Promise<void> }) {
  const [primaryMob, setPrimaryMob] = useState('')
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!primaryMob.trim()) return
    const r = await fetch(
      `/api/zones/${encodeURIComponent(zoneName)}/encounters`,
      {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_mob: primaryMob.trim() }),
      },
    )
    if (!r.ok) { setErr(`Create failed: ${r.status}`); return }
    await onSaved()
  }
  return (
    <div className="card mt-2 p-3">
      {err && <div className="text-danger text-sm">{err}</div>}
      <input
        value={primaryMob} onChange={e => setPrimaryMob(e.target.value)}
        placeholder="Primary mob name"
        className="appearance-none bg-surface border border-border rounded-md px-3 py-1 text-text w-full mb-2"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={save}>Add</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function EncounterEditPanel({
  zoneName, encounter, onCancel, onSaved,
}: {
  zoneName: string; encounter: Encounter
  onCancel: () => void; onSaved: () => void | Promise<void>
}) {
  // Local draft of the encounter's metadata + mob ops invoke the API
  // directly and call onSaved() (parent reload) on success.
  const [primary, setPrimary] = useState(encounter.encounter_name)
  const [stage, setStage] = useState(encounter.stage ?? '')
  const [wikiUrl, setWikiUrl] = useState(encounter.wiki_url ?? '')
  const [newSibling, setNewSibling] = useState('')
  const [err, setErr] = useState<string | null>(null)

  async function saveMeta() {
    const r = await fetch(
      `/api/zones/${encodeURIComponent(zoneName)}/encounters/${encounter.id}`,
      {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_mob: primary !== encounter.encounter_name ? primary : null,
          stage: stage || null,
          wiki_url: wikiUrl || null,
        }),
      },
    )
    if (!r.ok) { setErr(`Save failed: ${r.status}`); return }
    await onSaved()
  }

  async function addSibling() {
    if (!newSibling.trim()) return
    const r = await fetch(
      `/api/zones/${encodeURIComponent(zoneName)}/encounters/${encounter.id}/mobs`,
      {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mob_name: newSibling.trim() }),
      },
    )
    if (!r.ok) { setErr(`Add mob failed: ${r.status}`); return }
    setNewSibling('')
    await onSaved()
  }

  // Mob-level promote / delete / rename — call the matching endpoints and
  // refresh. The mob row needs the mob's id (not just position); if the
  // read endpoint doesn't include mob ids today, we surface only add/delete
  // by position and skip promote/rename for sibling rows until the read
  // endpoint is extended. (Backend support exists; reading the existing
  // read endpoint will confirm whether ids ship out today.)

  return (
    <div className="mt-2 border-t border-border pt-2">
      {err && <div className="text-danger text-sm">{err}</div>}
      <label className="block text-xs text-text-muted">Primary mob</label>
      <input
        value={primary} onChange={e => setPrimary(e.target.value)}
        className="appearance-none bg-surface border border-border rounded-md px-3 py-1 text-text w-full mb-2"
      />
      <label className="block text-xs text-text-muted">Stage</label>
      <input
        value={stage} onChange={e => setStage(e.target.value)}
        placeholder="(optional)"
        className="appearance-none bg-surface border border-border rounded-md px-3 py-1 text-text w-full mb-2"
      />
      <label className="block text-xs text-text-muted">Wiki URL</label>
      <input
        value={wikiUrl} onChange={e => setWikiUrl(e.target.value)}
        placeholder="(optional)"
        className="appearance-none bg-surface border border-border rounded-md px-3 py-1 text-text w-full mb-2"
      />
      <div className="mt-2">
        <div className="text-xs text-text-muted mb-1">Sibling mobs</div>
        {encounter.mobs.filter(m => m.position > 0).map(m => (
          <div key={m.position} className="text-sm">{m.mob_name}</div>
        ))}
        <div className="flex gap-2 mt-1">
          <input
            value={newSibling} onChange={e => setNewSibling(e.target.value)}
            placeholder="Add sibling mob"
            className="appearance-none bg-surface border border-border rounded-md px-3 py-1 text-text flex-1"
          />
          <Button size="sm" variant="secondary" onClick={addSibling}>Add</Button>
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <Button size="sm" variant="primary" onClick={saveMeta}>Save</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
```

> Note on mob ids: the implementer should check whether `GET /api/zones/{zone}` (which feeds `zone.bosses`) returns mob `id` per mob today. If not, extend the read-shape to include it (a one-line `id` add in `_row_to_encounter` / wherever the read serializer lives) so the sibling-row Edit/Promote/Delete actions in the edit panel can be added in a follow-up commit within this task. The skeleton above intentionally ships add-sibling as the working sibling action and leaves rename/promote/delete on sibling rows as a TODO if mob ids aren't present — but the goal is to ship them all wired in this task. Update the read serializer if needed.

- [ ] **Step 3: Wire it into `RaidZonePage.tsx`** — read the page; below the existing read-only sidebar, add an Edit-roster toggle visible only when `canEdit` (mirror the triggers UI's auth derivation):
```tsx
import { BossRosterEditor } from '../components/BossRosterEditor'

// inside the page render, where the boss sidebar is:
const [editingRoster, setEditingRoster] = useState(false)
// ... and somewhere visible near the sidebar header:
{canEdit && (
  <button
    className="text-xs text-gold underline ml-2"
    onClick={() => setEditingRoster(v => !v)}
  >{editingRoster ? 'Done editing' : 'Edit roster'}</button>
)}
{editingRoster ? (
  <BossRosterEditor
    zoneName={zone.name}
    encounters={zone.bosses}
    onReload={refetchZone}   // the existing zone-fetch function
  />
) : (
  /* existing read-only sidebar */ null /* keep what's there */
)}
```
Don't break the existing sidebar — render it when `!editingRoster`.

- [ ] **Step 4: Verify build**

```bash
cd frontend
npm run typecheck
npm run build
```
Expected: 0 type errors; clean build (pre-existing chunk-size warning is fine).

- [ ] **Step 5: DO NOT COMMIT.**

Leave the changes in the working tree. The controller will present them to the user for visual review and commit them after approval.

---

## Task 7: Decommission the curated source file + build flag

**Files:**
- Delete: `scripts/dev/eq2_raid_bosses.review.txt`
- Modify: `scripts/build_zones_db.py` (remove `--curated-bosses`, `DEFAULT_CURATED`, `parse_curated_bosses`, `_load_curated_bosses_into_db`, the bosses load step in `main`, the `bosses_*` meta fields)
- Modify: `CLAUDE.md` (drop curated-source mentions in the "Manual upload: zones.db" section; note bosses are web-editable now and zones.db is litestream-replicated)

- [ ] **Step 1: Delete the file**

```bash
git rm scripts/dev/eq2_raid_bosses.review.txt
```

- [ ] **Step 2: Strip the curated-bosses code path** from `scripts/build_zones_db.py`:
  - Remove the `DEFAULT_CURATED` constant.
  - Remove the `--curated-bosses` argument from the `argparse.ArgumentParser`.
  - Delete the `parse_curated_bosses` function.
  - Delete the `_load_curated_bosses_into_db` function.
  - In `main()`, remove the block that loads curated bosses (the `if args.curated_bosses.exists(): _load_curated_bosses_into_db(...)`) and the `bosses_*` keys from the meta dict the script reports.
  - Leave the rest of the script (cleaned-JSON → zones/types/aliases) intact.

- [ ] **Step 3: Update `CLAUDE.md`** — find the "Manual upload: zones.db" section. Remove references to `eq2_raid_bosses.review.txt` and the `--curated-bosses` flag. Add a short note:
> Boss rosters are web-editable by admins + contributors (see the per-zone editor in the raids UI) and stored in `zone_encounters` / `zone_encounter_mobs`. The curated source file was decommissioned with the editable-roster feature; only zone metadata is built from the cleaned JSON now. `zones.db` is included in `litestream.yml` replication, so curator edits are backed up to R2.

- [ ] **Step 4: Verify the build still runs**

```bash
uv run python scripts/build_zones_db.py
uv run python scripts/dev/_smoke_test_zones_db.py
```
Expected: builds successfully against the cleaned JSON; smoke test passes. (Existing `zone_encounters` data in your local DB is untouched — the script no longer touches that table.)

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff format scripts/build_zones_db.py
uv run ruff check  scripts/build_zones_db.py
git add scripts/build_zones_db.py scripts/dev/eq2_raid_bosses.review.txt CLAUDE.md
git commit -m "chore(zones): decommission curated boss-roster file (roster is web-editable)"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 8: Add `zones.db` to litestream replication

**Files:**
- Modify: `litestream.yml`
- Modify: `railway.toml` (add a third `litestream restore` line in the start command)

zones.db now holds curator edits — back it up to R2 alongside `users.db` / `parses.db`.

- [ ] **Step 1: Read the existing `litestream.yml`** to copy the block shape exactly (path, replicas, retention, sync-interval).

- [ ] **Step 2: Add the zones.db block** — append to `litestream.yml`, matching the existing entries verbatim except for the path/name:
```yaml
  - path: /app/data/zones/zones.db
    replicas:
      - type: s3
        bucket: ${R2_BUCKET}
        path: zones
        endpoint: ${R2_ENDPOINT}
        access-key-id: ${R2_ACCESS_KEY_ID}
        secret-access-key: ${R2_SECRET_ACCESS_KEY}
        sync-interval: 1s
        retention: 168h
        snapshot-interval: 24h
```
(If the existing entries use slightly different field names, MIRROR them — don't introduce new keys.)

- [ ] **Step 3: Add the restore line** to `railway.toml`'s `startCommand`. The current command runs two `litestream restore -if-replica-exists … || true` lines (for users + parses); add a third for zones, in the same pattern:
```
(litestream restore -if-replica-exists -config /app/litestream.yml /app/data/zones/zones.db || true)
```
Place it adjacent to the existing two restore calls.

- [ ] **Step 4: Commit**

```bash
git add litestream.yml railway.toml
git commit -m "ops(litestream): replicate zones.db to R2 alongside users + parses"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 9: Full gate + finish

**Files:** none (verification).

- [ ] **Step 1: Full backend gate**

```bash
uv run ruff format --check .
uv run ruff check .
uv run pyright
uv run pytest -q
```
Expected: all green.

- [ ] **Step 2: Frontend gate** (after the user approves the held Task-6 frontend commits):

```bash
cd frontend && npm run typecheck && npm run build
```
Expected: 0 errors; clean build.

- [ ] **Step 3: Finish** — invoke `superpowers:finishing-a-development-branch`. The controller will open the PR; on merge, the rollout in the spec applies (first boot normalizes any comma-joined `encounter_name`, creates indexes (already present), starts replicating zones.db).

---

## Self-review (against the spec)

- §"No schema migration" → Task 1 only adds the normalization to `init_db`; verified both indexes the spec mentioned already exist in `_CREATE_INDEXES`. ✓
- §"Primary mob convention" → encounter_name kept in sync with position-0 mob across `add_encounter` (Task 2), `update_encounter` (Task 2), `add_mob make_primary=True` (Task 4), `update_mob` for position-0 (Task 4), `promote_mob` (Task 4). ✓
- §"Refuse delete-last-mob; refuse delete-primary-while-siblings; promote = swap 0↔N; reorder = atomic permutation validated" → Tasks 3 + 4. ✓
- §"Each write keeps raid_encounters mirror in sync" → Task 2 (`update_encounter` rename, `delete_encounter`) + Task 3 (reorder loops the mirror update) via new `rename_raid_encounter_if_exists` / `update_raid_encounter_if_exists` / `delete_raid_encounter_by_zone_mob` helpers in raids_db. ✓
- §"All 8 routes + require_editor gate" → Task 5. ✓
- §"Frontend: Edit-roster toggle + BossRosterEditor + @dnd-kit/sortable" → Task 6 (visual; hold commit). ✓
- §"Decommission curated source" → Task 7. ✓
- §"Add zones.db to litestream.yml + start command" → Task 8. ✓
- §"Future 'any mob' leaderboard supported with zero schema work" → no task needed; the indexes already exist and zone_encounter_mobs captures all mobs. ✓
- §"Auth: require_editor (admin OR contributor)" → enforced on every write endpoint via `Depends(require_editor)` in Task 5. ✓
- Type / name consistency across tasks: `add_encounter`/`update_encounter`/`delete_encounter`/`reorder_encounters`/`add_mob`/`update_mob`/`promote_mob`/`delete_mob`/`list_mobs`/`rename_raid_encounter_if_exists`/`update_raid_encounter_if_exists`/`delete_raid_encounter_by_zone_mob`/`BossRosterEditor` used consistently across Tasks 2-6. ✓
- No placeholders / TODO-comments / "similar to Task N" lines.
