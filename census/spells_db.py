"""
Local SQLite mirror of the Census /spell/ collection.

Each row is one spell entry — a specific tier of a specific spell (e.g.
"Divine Strike III Adept" is a separate row from "Divine Strike III Master").
The `crc` field groups all tier-variants of the same base spell together.

167 k rows total; download once with scripts/download_spells.py and refresh
whenever spells are patched (rare — typically expansion launches only).

Character spell-check looks up spell IDs in this table so the per-character
Census call can return bare IDs instead of resolved spell objects, making it
faster and removing the c:resolve overhead.
"""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _db_path() -> Path:
    env = os.getenv("SPELLS_DB_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "data" / "spells" / "spells.db"


DB_PATH: Path = _db_path()

# Roman-numeral suffix pattern (I–XX) used for base_name computation.
# Matches a space-separated Roman numeral at the end of a spell name.
_ROMAN_RE = re.compile(
    r"\s+(?:XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)$",
    re.IGNORECASE,
)


def strip_roman(name: str) -> str:
    """Strip a trailing Roman-numeral rank (I–XX) from a spell name."""
    return _ROMAN_RE.sub("", name).strip()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_CREATE_META = """
CREATE TABLE IF NOT EXISTS _meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS spells (
    -- Identity
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    name_lower      TEXT    NOT NULL,

    -- Pre-computed base name (Roman-numeral suffix stripped)
    base_name       TEXT    NOT NULL,
    base_name_lower TEXT    NOT NULL,

    -- Classification
    tier            INTEGER,            -- numeric tier id (1=Novice, 2=Apprentice, 5=Adept …)
    tier_name       TEXT,               -- "Apprentice", "Adept", "Master", "Grandmaster" …
    type            TEXT,               -- "spells", "arts", "pcinnates", "tradeskill" …
    typeid          INTEGER,
    level           INTEGER,            -- minimum level to use
    given_by        TEXT,               -- "any", "class", "alternateadvancement" …
    crc             INTEGER,            -- base-spell grouping key: all tiers of the same spell share a CRC
    beneficial      INTEGER,            -- 1 = beneficial, 0 = hostile

    -- Pre-computed spellcheck eligibility:
    --   level > 0  AND  type IN ('spells','arts')
    --   AND given_by NOT IN ('alternateadvancement','class')
    passes_spellcheck INTEGER NOT NULL DEFAULT 0,

    -- Timing
    cast_secs       REAL,               -- cast_secs_hundredths / 100
    recast_secs     REAL,
    recovery_secs   REAL,               -- recovery_secs_tenths / 10

    -- Targeting
    target_type     TEXT,               -- "self", "single", "group", "ae" …
    aoe_radius      REAL,
    max_targets     INTEGER,

    -- Display
    description     TEXT,
    icon_id         INTEGER,
    icon_backdrop   INTEGER,

    -- Metadata
    last_update     INTEGER
);
"""

_CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_name_lower       ON spells (name_lower);",
    "CREATE INDEX IF NOT EXISTS idx_base_name_lower  ON spells (base_name_lower);",
    "CREATE INDEX IF NOT EXISTS idx_crc              ON spells (crc);",
    "CREATE INDEX IF NOT EXISTS idx_type             ON spells (type);",
    "CREATE INDEX IF NOT EXISTS idx_given_by         ON spells (given_by);",
    "CREATE INDEX IF NOT EXISTS idx_level            ON spells (level);",
    "CREATE INDEX IF NOT EXISTS idx_tier_name        ON spells (tier_name);",
    "CREATE INDEX IF NOT EXISTS idx_last_update      ON spells (last_update);",
    # Composite indexes for common query patterns
    "CREATE INDEX IF NOT EXISTS idx_sc_level         ON spells (passes_spellcheck, level);",
    "CREATE INDEX IF NOT EXISTS idx_base_tier        ON spells (base_name_lower, tier);",
]

_UPSERT_SQL = """
INSERT OR REPLACE INTO spells (
    id, name, name_lower, base_name, base_name_lower,
    tier, tier_name, type, typeid, level, given_by, crc, beneficial,
    passes_spellcheck,
    cast_secs, recast_secs, recovery_secs,
    target_type, aoe_radius, max_targets,
    description, icon_id, icon_backdrop,
    last_update
) VALUES (
    :id, :name, :name_lower, :base_name, :base_name_lower,
    :tier, :tier_name, :type, :typeid, :level, :given_by, :crc, :beneficial,
    :passes_spellcheck,
    :cast_secs, :recast_secs, :recovery_secs,
    :target_type, :aoe_radius, :max_targets,
    :description, :icon_id, :icon_backdrop,
    :last_update
)
"""


# ---------------------------------------------------------------------------
# Row conversion
# ---------------------------------------------------------------------------

def _str(v) -> Optional[str]:
    if v is None or isinstance(v, dict):
        return None
    s = str(v).strip()
    return s or None


def _int(v) -> Optional[int]:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _passes_spellcheck(row: dict) -> int:
    """Return 1 if this spell row would survive the spellcheck filter, else 0."""
    level    = row.get("level") or 0
    typ      = row.get("type") or ""
    given_by = row.get("given_by") or ""
    if level <= 0:
        return 0
    if typ not in ("spells", "arts"):
        return 0
    if given_by in ("alternateadvancement", "class"):
        return 0
    return 1


def spell_to_row(spell: dict) -> dict:
    """Convert a raw Census /spell/ dict into a flat DB row dict."""
    icon   = spell.get("icon") or {}
    cast_h = _int(spell.get("cast_secs_hundredths"))
    rec_t  = _int(spell.get("recovery_secs_tenths"))
    desc   = spell.get("description")
    if isinstance(desc, dict):
        desc = None  # Census sometimes returns {} for empty descriptions

    name       = str(spell.get("name") or "")
    name_lower = name.lower()
    base       = strip_roman(name)
    base_lower = base.lower()

    row = {
        "id":               _int(spell.get("id")),
        "name":             name,
        "name_lower":       name_lower,
        "base_name":        base,
        "base_name_lower":  base_lower,
        "tier":             _int(spell.get("tier")),
        "tier_name":        _str(spell.get("tier_name")),
        "type":             _str(spell.get("type")),
        "typeid":           _int(spell.get("typeid")),
        "level":            _int(spell.get("level")),
        "given_by":         _str(spell.get("given_by")),
        "crc":              _int(spell.get("crc")),
        "beneficial":       1 if spell.get("beneficial") == 1 else 0,
        "cast_secs":        cast_h / 100.0 if cast_h is not None else None,
        "recast_secs":      _float(spell.get("recast_secs")),
        "recovery_secs":    rec_t  / 10.0  if rec_t  is not None else None,
        "target_type":      _str(spell.get("target_type")),
        "aoe_radius":       _float(spell.get("aoe_radius_meters")),
        "max_targets":      _int(spell.get("max_targets")),
        "description":      _str(desc),
        "icon_id":          _int(icon.get("id")),
        "icon_backdrop":    _int(icon.get("backdrop")),
        "last_update":      _int(spell.get("last_update")),
    }
    row["passes_spellcheck"] = _passes_spellcheck(row)
    return row


# ---------------------------------------------------------------------------
# DB management (synchronous — used by download script and web startup)
# ---------------------------------------------------------------------------

def init_db(path: Path = DB_PATH) -> sqlite3.Connection:
    """Create tables/indexes if missing. Returns an open connection."""
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous  = NORMAL;")
    conn.execute(_CREATE_META)
    conn.execute(_CREATE_TABLE)
    for idx in _CREATE_INDEXES:
        conn.execute(idx)
    conn.commit()
    return conn


def get_meta(conn: sqlite3.Connection, key: str, default: Optional[str] = None) -> Optional[str]:
    row = conn.execute("SELECT value FROM _meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute("INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)", (key, value))
    conn.commit()


def upsert_spells(spells: list[dict], conn: sqlite3.Connection) -> int:
    """Upsert a batch of raw Census spell dicts. Returns the number inserted/replaced."""
    rows = [spell_to_row(s) for s in spells if s.get("id") is not None]
    conn.executemany(_UPSERT_SQL, rows)
    conn.commit()
    return len(rows)


def spell_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM spells").fetchone()[0]


# ---------------------------------------------------------------------------
# Lookup helpers (async-friendly via asyncio.to_thread)
# ---------------------------------------------------------------------------

# All non-rowid columns we select for spell row dicts.
_SELECT_COLS = (
    "id, name, name_lower, base_name, base_name_lower, "
    "tier, tier_name, type, typeid, level, given_by, crc, beneficial, "
    "passes_spellcheck, "
    "cast_secs, recast_secs, recovery_secs, "
    "target_type, aoe_radius, max_targets, "
    "description, icon_id, icon_backdrop, last_update"
)


def _row_to_dict(row: sqlite3.Row) -> dict:
    return dict(row)


def find_by_id(spell_id: int, path: Path = DB_PATH) -> Optional[dict]:
    """Return a spell row dict for the given ID, or None."""
    if not path.exists():
        return None
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            f"SELECT {_SELECT_COLS} FROM spells WHERE id = ? LIMIT 1", (spell_id,)
        ).fetchone()
    return _row_to_dict(row) if row else None


def find_by_ids(spell_ids: list[int], path: Path = DB_PATH) -> dict[int, dict]:
    """Return {spell_id: row_dict} for all matching IDs. Missing IDs are omitted."""
    if not spell_ids or not path.exists():
        return {}
    placeholders = ",".join("?" * len(spell_ids))
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM spells WHERE id IN ({placeholders})",
            spell_ids,
        ).fetchall()
    return {row["id"]: _row_to_dict(row) for row in rows}


def find_by_name(name: str, path: Path = DB_PATH) -> list[dict]:
    """Return all spell rows whose name matches (exact, then LIKE). Ordered by level."""
    if not path.exists():
        return []
    with sqlite3.connect(path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM spells WHERE name_lower = ? ORDER BY level",
            (name.lower(),),
        ).fetchall()
        if not rows:
            rows = conn.execute(
                f"SELECT {_SELECT_COLS} FROM spells WHERE name_lower LIKE ? ORDER BY level",
                (f"%{name.lower()}%",),
            ).fetchall()
    return [_row_to_dict(r) for r in rows]
