# Class Database — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A SQLite class catalogue (`data/classes/classes.db`) of all 26 EQ2 adventure classes — archetype, subclass, role, colour, display order, icon — built from a hand-authored seed, exposed via `GET /api/classes`, with class icons, consolidating the class data currently split across `census/constants.py` and the frontend.

**Architecture:** `census/classes_db.py` holds the canonical `CLASS_SEED` (26 `ClassInfo` records) plus the SQLite schema + access helpers (mirroring `census/recipes_db.py`). `scripts/build_classes_db.py` builds the (gitignored) DB from the seed. `census/constants.py`'s archetype frozensets derive from the seed. A cached `GET /api/classes` serves the records; icons download from EQ2wire to `data/classes/icons/{id}.png` and serve at `/class-icons/{id}.png`. A `useClasses` frontend hook exposes the single source for future features.

**Tech Stack:** Python 3.13 / SQLite / FastAPI; pytest; React/TypeScript/Vite. Tooling: `uv`, `ruff`, `pyright`, `tsc`.

**Spec:** `docs/superpowers/specs/2026-05-25-class-database-design.md`

**Conventions:** run tests with `uv run pytest …`; lint/type with `uv run ruff check`/`ruff format`/`pyright`; frontend `cd frontend && npx tsc --noEmit`. Commit messages end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Work on a branch: `git checkout -b feature/class-database` before Task 1. **Only stage the files each task names** — never `pyproject.toml`, `uv.lock`, or untracked `census/raids_db.py` / `census/wikitext_md.py` / `scripts/dev/*` (unrelated WIP).

---

## File structure

**Create:** `census/classes_db.py`, `scripts/build_classes_db.py`, `scripts/download_class_icons.py`, `web/routes/classes.py`, `frontend/src/useClasses.ts`, `tests/census/test_classes_db.py`, `tests/web/test_classes.py`, `data/classes/icons/*.png` (committed).
**Modify:** `census/constants.py` (derive archetype sets), `web/app.py` (mount `/class-icons`, register router), `.gitignore` (ignore `classes.db`), `frontend/src/pages/{HomePage,GuildPage,ParsePage}.tsx` (consume `useClasses`).
**Delete:** `frontend/src/classConstants.ts` (after migrating its 3 consumers).

---

## Task 1: `census/classes_db.py` — seed + schema + access

**Files:**
- Create: `census/classes_db.py`
- Test: `tests/census/test_classes_db.py`

- [ ] **Step 1: Write the failing test** — `tests/census/test_classes_db.py`:

```python
from __future__ import annotations

from census import classes_db
from census.classes_db import CLASS_SEED


class TestSeedIntegrity:
    def test_has_26_unique_classes(self):
        names = [c.name for c in CLASS_SEED]
        assert len(names) == 26
        assert len(set(names)) == 26

    def test_valid_archetypes_and_roles(self):
        archetypes = {"Fighter", "Priest", "Scout", "Mage"}
        roles = {"Tank", "Healer", "Melee DPS", "Ranged DPS", "Support"}
        for c in CLASS_SEED:
            assert c.archetype in archetypes, c.name
            assert c.role in roles, c.name

    def test_role_counts(self):
        from collections import Counter

        counts = Counter(c.role for c in CLASS_SEED)
        assert counts == {
            "Tank": 6, "Healer": 7, "Support": 4, "Melee DPS": 4, "Ranged DPS": 5
        }

    def test_icon_ids_unique(self):
        ids = [c.icon_id for c in CLASS_SEED]
        assert len(set(ids)) == 26

    def test_only_beastlord_channeler_lack_subclass(self):
        no_sub = {c.name for c in CLASS_SEED if c.subclass is None}
        assert no_sub == {"Beastlord", "Channeler"}

    def test_known_icon_ids(self):
        by_name = {c.name: c for c in CLASS_SEED}
        assert by_name["Templar"].icon_id == 13
        assert by_name["Inquisitor"].icon_id == 14
        assert by_name["Swashbuckler"].icon_id == 33
        assert by_name["Channeler"].icon_id == 44


class TestDbRoundTrip:
    def test_seed_and_list_all(self):
        conn = classes_db.init_db(__import__("pathlib").Path(":memory:"))
        try:
            n = classes_db.seed(conn)
            assert n == 26
            conn.row_factory = __import__("sqlite3").Row
            rows = [dict(r) for r in conn.execute("SELECT * FROM classes ORDER BY display_order")]
            assert len(rows) == 26
            assert rows[0]["name"] == "Guardian"  # first in archetype/icon order
            assert rows[0]["display_order"] == 0
            # display_order is dense 0..25
            assert [r["display_order"] for r in rows] == list(range(26))
        finally:
            conn.close()
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/census/test_classes_db.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'census.classes_db'`.

- [ ] **Step 3: Implement** — create `census/classes_db.py`:

```python
"""EQ2 adventure-class catalogue.

The 26 classes are static, so the canonical data lives here as CLASS_SEED and
the SQLite catalogue (data/classes/classes.db) is built from it by
scripts/build_classes_db.py (there's no Census download — unlike recipes/spells).
Keyed by class NAME: EQ2 has several unrelated class-id schemes (our icon_id is
the EQ2wire icon id; AA trees and Census type.classid use different ids), so
name is the only stable cross-reference.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ClassInfo:
    name: str
    archetype: str  # Fighter | Priest | Scout | Mage
    subclass: str | None  # middle tier; None for Beastlord & Channeler
    role: str  # Tank | Healer | Melee DPS | Ranged DPS | Support
    colour: str  # hex (archetype colour)
    icon_id: int  # EQ2wire class_medium icon id


# Archetype colours (carried from the old frontend classConstants.ts).
_F, _P, _S, _M = "#f87171", "#4ade80", "#fbbf24", "#93b4ff"

# Ordered: archetype [Fighter, Priest, Scout, Mage], icon_id ascending within
# each archetype. display_order is assigned from this order at seed time.
CLASS_SEED: tuple[ClassInfo, ...] = (
    ClassInfo("Guardian", "Fighter", "Warrior", "Tank", _F, 3),
    ClassInfo("Berserker", "Fighter", "Warrior", "Tank", _F, 4),
    ClassInfo("Monk", "Fighter", "Brawler", "Tank", _F, 6),
    ClassInfo("Bruiser", "Fighter", "Brawler", "Tank", _F, 7),
    ClassInfo("Shadowknight", "Fighter", "Crusader", "Tank", _F, 9),
    ClassInfo("Paladin", "Fighter", "Crusader", "Tank", _F, 10),
    ClassInfo("Templar", "Priest", "Cleric", "Healer", _P, 13),
    ClassInfo("Inquisitor", "Priest", "Cleric", "Healer", _P, 14),
    ClassInfo("Warden", "Priest", "Druid", "Healer", _P, 16),
    ClassInfo("Fury", "Priest", "Druid", "Healer", _P, 17),
    ClassInfo("Mystic", "Priest", "Shaman", "Healer", _P, 19),
    ClassInfo("Defiler", "Priest", "Shaman", "Healer", _P, 20),
    ClassInfo("Channeler", "Priest", None, "Healer", _P, 44),
    ClassInfo("Swashbuckler", "Scout", "Rogue", "Melee DPS", _S, 33),
    ClassInfo("Brigand", "Scout", "Rogue", "Melee DPS", _S, 34),
    ClassInfo("Troubador", "Scout", "Bard", "Support", _S, 36),
    ClassInfo("Dirge", "Scout", "Bard", "Support", _S, 37),
    ClassInfo("Ranger", "Scout", "Predator", "Ranged DPS", _S, 39),
    ClassInfo("Assassin", "Scout", "Predator", "Melee DPS", _S, 40),
    ClassInfo("Beastlord", "Scout", None, "Melee DPS", _S, 42),
    ClassInfo("Wizard", "Mage", "Sorcerer", "Ranged DPS", _M, 23),
    ClassInfo("Warlock", "Mage", "Sorcerer", "Ranged DPS", _M, 24),
    ClassInfo("Coercer", "Mage", "Enchanter", "Support", _M, 26),
    ClassInfo("Illusionist", "Mage", "Enchanter", "Support", _M, 27),
    ClassInfo("Conjuror", "Mage", "Summoner", "Ranged DPS", _M, 29),
    ClassInfo("Necromancer", "Mage", "Summoner", "Ranged DPS", _M, 30),
)


def _db_path() -> Path:
    env = os.getenv("CLASSES_DB_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "data" / "classes" / "classes.db"


DB_PATH: Path = _db_path()

_CREATE_CLASSES = """
CREATE TABLE IF NOT EXISTS classes (
    name           TEXT PRIMARY KEY,
    archetype      TEXT    NOT NULL,
    subclass       TEXT,
    role           TEXT    NOT NULL,
    colour         TEXT    NOT NULL,
    display_order  INTEGER NOT NULL,
    icon_id        INTEGER NOT NULL
);
"""

_CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_classes_archetype ON classes (archetype);",
    "CREATE INDEX IF NOT EXISTS idx_classes_role ON classes (role);",
]


def init_db(path: Path = DB_PATH) -> sqlite3.Connection:
    """Create the classes table/indexes if missing. Returns an open connection."""
    if str(path) == ":memory:":
        conn = sqlite3.connect(":memory:")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute(_CREATE_CLASSES)
    for idx in _CREATE_INDEXES:
        conn.execute(idx)
    conn.commit()
    return conn


def seed(conn: sqlite3.Connection) -> int:
    """(Re)populate the classes table from CLASS_SEED. display_order = the
    index of each record in CLASS_SEED. Returns the row count."""
    rows = [
        (c.name, c.archetype, c.subclass, c.role, c.colour, i, c.icon_id)
        for i, c in enumerate(CLASS_SEED)
    ]
    with conn:
        conn.execute("DELETE FROM classes")
        conn.executemany(
            "INSERT INTO classes (name, archetype, subclass, role, colour, display_order, icon_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
    return len(rows)


def list_all(path: Path = DB_PATH) -> list[dict]:
    """All classes ordered by display_order. Empty list if the DB is missing/unseeded."""
    conn = init_db(path)
    try:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute("SELECT * FROM classes ORDER BY display_order").fetchall()]
    finally:
        conn.close()


def find_by_name(name: str, path: Path = DB_PATH) -> dict | None:
    conn = init_db(path)
    try:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM classes WHERE name = ?", (name,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def by_role(role: str, path: Path = DB_PATH) -> list[dict]:
    return [c for c in list_all(path) if c["role"] == role]


def by_archetype(archetype: str, path: Path = DB_PATH) -> list[dict]:
    return [c for c in list_all(path) if c["archetype"] == archetype]
```

- [ ] **Step 4: Run it, verify it passes**

Run: `uv run pytest tests/census/test_classes_db.py -q`
Expected: PASS.

- [ ] **Step 5: Lint/type + commit**

```bash
uv run ruff check census/classes_db.py tests/census/test_classes_db.py && uv run ruff format census/classes_db.py tests/census/test_classes_db.py && uv run pyright census/classes_db.py
git add census/classes_db.py tests/census/test_classes_db.py
git commit -m "feat(classes): class catalogue module with CLASS_SEED + schema"
```

---

## Task 2: Build script + gitignore + build the DB

**Files:**
- Create: `scripts/build_classes_db.py`
- Modify: `.gitignore`

- [ ] **Step 1: Implement the build script** — `scripts/build_classes_db.py`:

```python
"""Build data/classes/classes.db from the static CLASS_SEED.

Instant (no network). The DB is gitignored — rebuild locally and copy to the
Railway volume, same as recipes.db / spells.db.

Usage:
    uv run python scripts/build_classes_db.py
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from census import classes_db  # noqa: E402


def main() -> None:
    conn = classes_db.init_db(classes_db.DB_PATH)
    try:
        n = classes_db.seed(conn)
    finally:
        conn.close()
    print(f"seeded {n} classes -> {classes_db.DB_PATH}")
    roles = Counter(c.role for c in classes_db.CLASS_SEED)
    for role, count in roles.most_common():
        print(f"  {count:2d}  {role}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Ignore the built DB** — append to `.gitignore`:

```
# Class catalogue (built locally from CLASS_SEED, copied to Railway volume)
data/classes/classes.db
data/classes/classes.db-wal
data/classes/classes.db-shm
```

- [ ] **Step 3: Build it and verify**

Run: `uv run python scripts/build_classes_db.py`
Expected output: `seeded 26 classes -> …/data/classes/classes.db` then the role counts (6 Healer… etc.). Then confirm: `uv run python -c "from census import classes_db; print(len(classes_db.list_all()))"` → `26`.

- [ ] **Step 4: Commit** (script + gitignore only — NOT the .db)

```bash
uv run ruff check scripts/build_classes_db.py && uv run ruff format scripts/build_classes_db.py
git add scripts/build_classes_db.py .gitignore
git commit -m "feat(classes): build script for classes.db (gitignored)"
```

---

## Task 3: Derive archetype sets in `constants.py`

**Files:**
- Modify: `census/constants.py` (the `FIGHTERS/PRIESTS/SCOUTS/MAGES` block, ~lines 74-77)
- Test: `tests/census/test_classes_db.py` (append)

**Scope note:** We derive the four archetype frozensets from `CLASS_SEED` (the genuinely duplicated data — archetype membership also drove the frontend colours). `ARTISANS`, `ARCHETYPES`, `ALL_CLASSES`, and `CLASS_GROUPS` stay as-is: they're tradeskill/grouping constructs not represented in the adventure-class DB, and `CLASS_GROUPS` already references the (now-derived) `FIGHTERS/…` sets so its content is unchanged. A regression test guards that the derived sets equal today's literals.

- [ ] **Step 1: Write the failing regression test** (append to `tests/census/test_classes_db.py`):

```python
class TestConstantsDerivation:
    def test_archetype_sets_match_legacy_literals(self):
        from census import constants

        assert constants.FIGHTERS == frozenset(
            ["Guardian", "Berserker", "Monk", "Bruiser", "Shadowknight", "Paladin"]
        )
        assert constants.PRIESTS == frozenset(
            ["Templar", "Inquisitor", "Fury", "Warden", "Mystic", "Defiler", "Channeler"]
        )
        assert constants.SCOUTS == frozenset(
            ["Troubador", "Dirge", "Assassin", "Ranger", "Swashbuckler", "Brigand", "Beastlord"]
        )
        assert constants.MAGES == frozenset(
            ["Coercer", "Illusionist", "Conjuror", "Necromancer", "Wizard", "Warlock"]
        )

    def test_archetype_sets_come_from_seed(self):
        # Every adventure class in the seed is in exactly one archetype set.
        from census import constants
        from census.classes_db import CLASS_SEED

        union = constants.FIGHTERS | constants.PRIESTS | constants.SCOUTS | constants.MAGES
        assert union == {c.name for c in CLASS_SEED}
```

- [ ] **Step 2: Run it, verify it passes already, then refactor** — the first test passes against the current literals. Run `uv run pytest tests/census/test_classes_db.py -k Constants -q` → PASS (guards current behaviour before refactor).

- [ ] **Step 3: Refactor `constants.py`** — replace the four literal frozenset definitions (lines ~74-77) with derivation from the seed. Add near the top of the file (after the existing imports):

```python
from census.classes_db import CLASS_SEED

_CLASSES_BY_ARCHETYPE: dict[str, frozenset[str]] = {
    archetype: frozenset(c.name for c in CLASS_SEED if c.archetype == archetype)
    for archetype in ("Fighter", "Priest", "Scout", "Mage")
}
```

Then replace the four lines:

```python
FIGHTERS = frozenset(["Guardian", "Berserker", "Monk", "Bruiser", "Shadowknight", "Paladin"])
PRIESTS = frozenset(["Templar", "Inquisitor", "Fury", "Warden", "Mystic", "Defiler", "Channeler"])
SCOUTS = frozenset(["Troubador", "Dirge", "Assassin", "Ranger", "Swashbuckler", "Brigand", "Beastlord"])
MAGES = frozenset(["Coercer", "Illusionist", "Conjuror", "Necromancer", "Wizard", "Warlock"])
```

with:

```python
FIGHTERS = _CLASSES_BY_ARCHETYPE["Fighter"]
PRIESTS = _CLASSES_BY_ARCHETYPE["Priest"]
SCOUTS = _CLASSES_BY_ARCHETYPE["Scout"]
MAGES = _CLASSES_BY_ARCHETYPE["Mage"]
```

(Leave `ARTISANS`, `ARCHETYPES`, `ALL_CLASSES`, `ALL_WITH_ARTISANS`, `CLASS_GROUPS` exactly as they are — they build on these names.)

Confirm no circular import: `census/classes_db.py` imports only stdlib, so `constants.py` importing it is one-directional.

- [ ] **Step 4: Run the full census + item suites** (constants is widely imported)

Run: `uv run pytest tests/census tests/web/test_item.py -q` (and `uv run pytest tests/census/test_classes_db.py -k Constants -q`)
Expected: PASS — the derived sets equal the literals, so item class-collapsing etc. are unchanged.

- [ ] **Step 5: Lint/type + commit**

```bash
uv run ruff check census/constants.py && uv run ruff format census/constants.py && uv run pyright census/constants.py
git add census/constants.py tests/census/test_classes_db.py
git commit -m "refactor(classes): derive archetype sets in constants.py from CLASS_SEED"
```

---

## Task 4: Download + commit the 26 class icons

**Files:**
- Create: `scripts/download_class_icons.py`
- Create (committed): `data/classes/icons/*.png`

- [ ] **Step 1: Implement the download script** — `scripts/download_class_icons.py`:

```python
"""Download the 26 EQ2 class icons from EQ2wire into data/classes/icons/.

Source: https://u.eq2wire.com/images/class_medium/{icon_id}.png
Saved as data/classes/icons/{icon_id}.png. These are small static assets and
ARE committed (unlike the gitignored classes.db).

Usage:
    uv run python scripts/download_class_icons.py
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from census.classes_db import CLASS_SEED  # noqa: E402

_BASE = "https://u.eq2wire.com/images/class_medium/{id}.png"
_DEST = Path(__file__).resolve().parent.parent / "data" / "classes" / "icons"


def main() -> None:
    _DEST.mkdir(parents=True, exist_ok=True)
    for c in CLASS_SEED:
        url = _BASE.format(id=c.icon_id)
        out = _DEST / f"{c.icon_id}.png"
        req = urllib.request.Request(url, headers={"User-Agent": "EQ2Lexicon/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
            data = resp.read()
        out.write_bytes(data)
        print(f"{c.name:14s} id={c.icon_id:<3} {len(data):>6} bytes -> {out.name}")
    print(f"\nDownloaded {len(CLASS_SEED)} icons to {_DEST}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `uv run python scripts/download_class_icons.py`
Expected: 26 lines (each class, id, byte count > 0), then "Downloaded 26 icons". If any URL 404s or returns 0 bytes, STOP — the icon_id mapping is wrong for that class; report it.

- [ ] **Step 3: Visually verify a sample** — open a few against the known mapping using the Read tool (it renders images): confirm `data/classes/icons/13.png` is the Templar icon, `3.png` Guardian, `44.png` Channeler, `42.png` Beastlord, and one intra-pair (e.g. `33.png` Swashbuckler vs `34.png` Brigand). If any are mismatched, the `CLASS_SEED.icon_id` for that class is wrong — fix the seed (Task 1 file), re-run, re-verify.

- [ ] **Step 4: Commit** (script + the 26 icons)

```bash
uv run ruff check scripts/download_class_icons.py && uv run ruff format scripts/download_class_icons.py
git add scripts/download_class_icons.py data/classes/icons/
git commit -m "feat(classes): download + commit the 26 class icons"
```

---

## Task 5: Serve icons at `/class-icons`

**Files:**
- Modify: `web/app.py` (the icon-mount block, near `_SPELL_ICONS_DIR` ~line 179 and the `app.mount(...)` calls ~line 316-326)

- [ ] **Step 1: Add the directory constant** — next to `_SPELL_ICONS_DIR`:

```python
_CLASS_ICONS_DIR = Path(__file__).resolve().parent.parent / "data" / "classes" / "icons"
```

- [ ] **Step 2: Mount it** — next to the spell-icons mount (mirror the existing guarded pattern):

```python
    # Class icons
    if _CLASS_ICONS_DIR.is_dir():
        app.mount("/class-icons", StaticFiles(directory=_CLASS_ICONS_DIR), name="class-icons")
```

- [ ] **Step 3: Verify it imports + mounts**

Run: `uv run python -c "from web.app import create_app; app = create_app(); print(any(getattr(r, 'name', '') == 'class-icons' for r in app.routes))"`
Expected: `True` (the icons dir exists from Task 4, so the mount is registered).

- [ ] **Step 4: Lint + commit**

```bash
uv run ruff check web/app.py && uv run ruff format web/app.py
git add web/app.py
git commit -m "feat(classes): serve class icons at /class-icons"
```

(If `create_app` has a different name/signature, adapt the verify command to how `web/app.py` builds the app — the change itself is just the constant + mount.)

---

## Task 6: `GET /api/classes`

**Files:**
- Create: `web/routes/classes.py`
- Modify: `web/app.py` (import + `include_router`)
- Test: `tests/web/test_classes.py`

- [ ] **Step 1: Write the failing test** — `tests/web/test_classes.py`:

```python
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test_classes_endpoint_returns_all_26(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/classes")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 26
    by_name = {c["name"]: c for c in data}
    templar = by_name["Templar"]
    assert templar["archetype"] == "Priest"
    assert templar["subclass"] == "Cleric"
    assert templar["role"] == "Healer"
    assert templar["icon_url"] == "/class-icons/13.png"
    assert by_name["Channeler"]["subclass"] is None
    # ordered by display_order
    assert [c["display_order"] for c in data] == list(range(26))
```

- [ ] **Step 2: Run it, verify it fails**

Run: `uv run pytest tests/web/test_classes.py -q`
Expected: FAIL — 404 (route not registered).

- [ ] **Step 3: Implement the route** — `web/routes/classes.py`:

```python
"""
GET /api/classes — the static class catalogue (archetype, subclass, role,
colour, display order, icon URL). Public (non-sensitive reference data used by
pre-login pages). Served from classes.db with an in-code CLASS_SEED fallback so
it works before the DB is built/copied to a fresh environment. Cached in-memory
(the data never changes at runtime).
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from census import classes_db
from census.classes_db import CLASS_SEED

router = APIRouter(tags=["classes"])


class ClassResponse(BaseModel):
    name: str
    archetype: str
    subclass: str | None
    role: str
    colour: str
    display_order: int
    icon_url: str


_cache: list[ClassResponse] | None = None


def _rows() -> list[dict]:
    rows = classes_db.list_all()
    if rows:
        return rows
    # DB not built/copied yet — fall back to the in-code seed.
    return [
        {
            "name": c.name, "archetype": c.archetype, "subclass": c.subclass,
            "role": c.role, "colour": c.colour, "display_order": i, "icon_id": c.icon_id,
        }
        for i, c in enumerate(CLASS_SEED)
    ]


@router.get("/classes", response_model=list[ClassResponse])
async def list_classes() -> list[ClassResponse]:
    global _cache
    if _cache is None:
        rows = await asyncio.get_event_loop().run_in_executor(None, _rows)
        _cache = [
            ClassResponse(
                name=r["name"], archetype=r["archetype"], subclass=r["subclass"],
                role=r["role"], colour=r["colour"], display_order=r["display_order"],
                icon_url=f"/class-icons/{r['icon_id']}.png",
            )
            for r in rows
        ]
    return _cache
```

- [ ] **Step 4: Register the router** in `web/app.py` — add beside the other route imports:

```python
from web.routes.classes import router as classes_router
```

and beside the other `include_router` calls:

```python
    app.include_router(classes_router, prefix="/api")
```

- [ ] **Step 5: Run it, verify it passes**

Run: `uv run pytest tests/web/test_classes.py -q`
Expected: PASS.

- [ ] **Step 6: Lint/type + commit**

```bash
uv run ruff check web/routes/classes.py web/app.py tests/web/test_classes.py && uv run ruff format web/routes/classes.py web/app.py tests/web/test_classes.py && uv run pyright web/routes/classes.py
git add web/routes/classes.py web/app.py tests/web/test_classes.py
git commit -m "feat(classes): GET /api/classes endpoint"
```

---

## Task 7: Frontend `useClasses` hook

**Files:**
- Create: `frontend/src/useClasses.ts`

(No FE unit-test harness; gate is `tsc`. This provides the single source for future rankings features; it does not yet migrate the existing `classConstants.ts` consumers — see the deferred follow-up note at the end of the plan.)

- [ ] **Step 1: Implement** — `frontend/src/useClasses.ts`:

```typescript
import { useEffect, useState } from 'react'

export interface ClassInfo {
  name: string
  archetype: string
  subclass: string | null
  role: string
  colour: string
  display_order: number
  icon_url: string
}

// Module-level cache + in-flight promise so /api/classes is fetched once per
// app load (the data never changes within a session).
let _cache: ClassInfo[] | null = null
let _inflight: Promise<ClassInfo[]> | null = null

function loadClasses(): Promise<ClassInfo[]> {
  if (_cache) return Promise.resolve(_cache)
  if (!_inflight) {
    _inflight = fetch('/api/classes', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`/api/classes ${r.status}`))))
      .then((data: ClassInfo[]) => {
        _cache = data
        return data
      })
      .catch(() => {
        _inflight = null // allow a retry on the next mount
        return [] as ClassInfo[]
      })
  }
  return _inflight
}

const FALLBACK_COLOUR = 'var(--text-muted)'

export function useClasses() {
  const [classes, setClasses] = useState<ClassInfo[]>(_cache ?? [])
  useEffect(() => {
    let cancelled = false
    loadClasses().then(data => {
      if (!cancelled) setClasses(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const byName = new Map(classes.map(c => [c.name, c]))
  const colourFor = (name: string | null | undefined, fallback: string = FALLBACK_COLOUR): string =>
    (name ? byName.get(name)?.colour : undefined) ?? fallback
  const iconUrlFor = (name: string | null | undefined): string | null =>
    (name ? byName.get(name)?.icon_url : undefined) ?? null

  return { classes, byName, colourFor, iconUrlFor }
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/useClasses.ts
git commit -m "feat(classes): useClasses hook (single source from /api/classes)"
```

---

## Task 8: Migrate colour consumers to `useClasses`; remove `classConstants.ts`

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`, `frontend/src/pages/GuildPage.tsx`, `frontend/src/pages/ParsePage.tsx`
- Delete: `frontend/src/classConstants.ts`

These three pages currently read the hardcoded `CLASS_COLOURS` map. Move them onto `useClasses` (the single source from `/api/classes`), then delete the map. Colours become async — pre-fetch, `colourFor` returns the per-site fallback; this is the accepted brief-flash behaviour. `ItemSearchPage` does **not** use `CLASS_COLOURS` (do not touch it).

- [ ] **Step 1: HomePage.tsx**

Replace the import `import { CLASS_COLOURS } from '../classConstants'` with `import { useClasses } from '../useClasses'`.

In the `CharacterCard` component body, add near the top (before `accentColour`):
```tsx
  const { colourFor } = useClasses()
```
Replace:
```tsx
  const accentColour = detail?.cls ? (CLASS_COLOURS[detail.cls] ?? 'var(--gold)') : 'var(--gold)'
```
with:
```tsx
  const accentColour = colourFor(detail?.cls, 'var(--gold)')
```
And replace the `color:` expression:
```tsx
                  color: detail.cls ? (CLASS_COLOURS[detail.cls] ?? 'var(--text)') : 'var(--text-muted)',
```
with:
```tsx
                  color: detail.cls ? colourFor(detail.cls, 'var(--text)') : 'var(--text-muted)',
```

- [ ] **Step 2: GuildPage.tsx**

Replace the import `import { CLASS_COLOURS } from '../classConstants'` with `import { useClasses } from '../useClasses'`.

Add `const { colourFor } = useClasses()` to the component that renders the roster rows (the one containing the `<td className={TD_CLS} style={{ color: ... }}>` line). Replace:
```tsx
              <td className={TD_CLS} style={{ color: m.cls ? (CLASS_COLOURS[m.cls] ?? 'var(--text)') : 'var(--text-muted)' }}>{clsLabel}</td>
```
with:
```tsx
              <td className={TD_CLS} style={{ color: m.cls ? colourFor(m.cls, 'var(--text)') : 'var(--text-muted)' }}>{clsLabel}</td>
```

- [ ] **Step 3: ParsePage.tsx**

Replace the import `import { CLASS_COLOURS } from '../classConstants'` with `import { useClasses } from '../useClasses'`.

Change `rowTintFor` to take a colour (raw hex) instead of a class name (it can't call the hook — it's module-level):
```tsx
// Subtle row tint derived from the class colour (alpha ~10%) — 8-digit hex.
// Takes the resolved hex colour (or null/undefined) and returns null when
// there's no colour, so the row stays untinted.
function rowTintFor(colour: string | null | undefined): string | null {
  return colour ? `${colour}1A` : null  // 0x1A = ~10% alpha
}
```
In `CombatantRow` (where `const cls = c.cls ?? lookupEntry?.cls ?? null` and `const tint = rowTintFor(cls)` are), add the hook and feed the resolved hex:
```tsx
  const { byName } = useClasses()
```
and replace `const tint = rowTintFor(cls)` with:
```tsx
  const tint = rowTintFor(cls ? byName.get(cls)?.colour : null)
```
In `NameCell`, add `const { colourFor } = useClasses()` near the top of its body, and replace:
```tsx
  const classColor = cls ? (CLASS_COLOURS[cls] ?? 'var(--text-muted)') : null
```
with:
```tsx
  const classColor = cls ? colourFor(cls) : null
```

- [ ] **Step 4: Delete `classConstants.ts` and confirm no references remain**

Run: `grep -rn "classConstants\|CLASS_COLOURS" frontend/src` → expect **no matches**. Then:
```bash
git rm frontend/src/classConstants.ts
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/HomePage.tsx frontend/src/pages/GuildPage.tsx frontend/src/pages/ParsePage.tsx
git commit -m "refactor(classes): consume class colours from useClasses; remove classConstants.ts"
```

---

## Task 9: Final gate

- [ ] **Step 1: Backend**

Run: `uv run pytest -q && uv run ruff check . && uv run pyright`
Expected: all pass, 0 errors. (`ruff check .` may flag the unrelated untracked `census/wikitext_md.py` / `scripts/dev/*` WIP — if so, scope the check to the touched files: `uv run ruff check census/classes_db.py census/constants.py web/routes/classes.py web/app.py scripts/build_classes_db.py scripts/download_class_icons.py tests/`.)

- [ ] **Step 2: Frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Push the branch** (only when the user asks)

```bash
git push -u origin feature/class-database
```

Note for the user: `classes.db` is gitignored — build it locally (`uv run python scripts/build_classes_db.py`) and copy it to the Railway volume, same as `recipes.db`/`spells.db`. The endpoint's CLASS_SEED fallback means `/api/classes` still works before the copy. The 26 icons are committed, so they deploy automatically.

---

## Self-review notes (addressed)

- **Spec coverage:** SQLite catalogue + `classes_db.py` + `CLASS_SEED` (T1), build script + gitignore (T2), constants de-dup (T3 — archetype sets derived; `CLASS_GROUPS` left literal-but-consistent, flagged), icons download + commit (T4) + serving (T5), `GET /api/classes` (T6), `useClasses` hook (T7), and migrating the colour consumers (HomePage/GuildPage/ParsePage) off `classConstants.ts` + deleting it (T8). The class-id-spaces caveat is encoded by keying on name. (`ItemSearchPage` was listed in the spec but doesn't actually use `CLASS_COLOURS` — verified, so it's correctly untouched.)
- **No placeholders:** every step has runnable code/commands.
- **Type consistency:** `ClassInfo` fields (name/archetype/subclass/role/colour/icon_id) consistent across `classes_db.py`, the seed rows (+ derived display_order), the `/api/classes` `ClassResponse` (adds display_order + icon_url), and the TS `ClassInfo` (mirrors the API response).
