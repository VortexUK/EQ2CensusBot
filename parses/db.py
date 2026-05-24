"""
Normalized SQLite store for ingested ACT parses.

Mirrors the layout pattern of `census/recipes_db.py`:
  * `_CREATE_*` SQL constants
  * `init_db(path)` returns a connection with WAL/foreign-keys enabled
  * idempotent `_MIGRATIONS` list for future schema bumps
  * thin sync helpers for insert / lookup

Lives at `data/parses/parses.db` by default. Override with the
`PARSES_DB_PATH` env var.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import UTC
from pathlib import Path

from parses.models import AttackType, Combatant, DamageType, Encounter

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def _db_path() -> Path:
    env = os.getenv("PARSES_DB_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "data" / "parses" / "parses.db"


DB_PATH: Path = _db_path()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_CREATE_ENCOUNTERS = """
CREATE TABLE IF NOT EXISTS encounters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    act_encid       TEXT    NOT NULL UNIQUE,
    title           TEXT    NOT NULL,
    zone            TEXT,
    started_at      INTEGER NOT NULL,        -- unix seconds, UTC
    ended_at        INTEGER NOT NULL,
    duration_s      INTEGER NOT NULL,
    total_damage    INTEGER NOT NULL DEFAULT 0,
    encdps          REAL    NOT NULL DEFAULT 0,
    kills           INTEGER NOT NULL DEFAULT 0,
    deaths          INTEGER NOT NULL DEFAULT 0,
    source_dsn      TEXT    NOT NULL,
    ingested_at     INTEGER NOT NULL
);
"""

_CREATE_COMBATANTS = """
CREATE TABLE IF NOT EXISTS combatants (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id    INTEGER NOT NULL,
    name            TEXT    NOT NULL,
    eq2_class       TEXT,
    role            TEXT,
    duration_s      INTEGER NOT NULL DEFAULT 0,
    damage          INTEGER NOT NULL DEFAULT 0,
    dps             REAL    NOT NULL DEFAULT 0,
    encdps          REAL    NOT NULL DEFAULT 0,
    hps             REAL    NOT NULL DEFAULT 0,
    healed          INTEGER NOT NULL DEFAULT 0,
    crits           INTEGER NOT NULL DEFAULT 0,
    max_hit         INTEGER NOT NULL DEFAULT 0,
    kills           INTEGER NOT NULL DEFAULT 0,
    deaths          INTEGER NOT NULL DEFAULT 0,
    grouping_label  TEXT,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE,
    UNIQUE (encounter_id, name)
);
"""

_CREATE_DAMAGE_TYPES = """
CREATE TABLE IF NOT EXISTS damage_types (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    combatant_id    INTEGER NOT NULL,
    damage_type     TEXT    NOT NULL,
    damage          INTEGER NOT NULL DEFAULT 0,
    swings          INTEGER NOT NULL DEFAULT 0,
    hits            INTEGER NOT NULL DEFAULT 0,
    misses          INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (combatant_id) REFERENCES combatants(id) ON DELETE CASCADE,
    UNIQUE (combatant_id, damage_type)
);
"""

_CREATE_ATTACK_TYPES = """
CREATE TABLE IF NOT EXISTS attack_types (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    combatant_id    INTEGER NOT NULL,
    attack_name     TEXT    NOT NULL,
    swings          INTEGER NOT NULL DEFAULT 0,
    hits            INTEGER NOT NULL DEFAULT 0,
    misses          INTEGER NOT NULL DEFAULT 0,
    blocked         INTEGER NOT NULL DEFAULT 0,
    crit_hits       INTEGER NOT NULL DEFAULT 0,
    damage          INTEGER NOT NULL DEFAULT 0,
    max_hit         INTEGER NOT NULL DEFAULT 0,
    min_hit         INTEGER NOT NULL DEFAULT 0,
    average         REAL    NOT NULL DEFAULT 0,
    median          REAL    NOT NULL DEFAULT 0,
    dps             REAL    NOT NULL DEFAULT 0,
    char_dps        REAL    NOT NULL DEFAULT 0,
    enc_dps         REAL    NOT NULL DEFAULT 0,
    duration_s      INTEGER NOT NULL DEFAULT 0,
    average_delay   REAL    NOT NULL DEFAULT 0,
    to_hit          REAL    NOT NULL DEFAULT 0,
    crit_perc       REAL    NOT NULL DEFAULT 0,
    resist          TEXT,
    FOREIGN KEY (combatant_id) REFERENCES combatants(id) ON DELETE CASCADE,
    UNIQUE (combatant_id, attack_name)
);
"""

_CREATE_INGEST_LOG = """
CREATE TABLE IF NOT EXISTS ingest_log (
    act_encid       TEXT    PRIMARY KEY,
    encounter_id    INTEGER NOT NULL,
    ingested_at     INTEGER NOT NULL,
    source_dsn      TEXT    NOT NULL,
    FOREIGN KEY (encounter_id) REFERENCES encounters(id) ON DELETE CASCADE
);
"""

_CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_encounters_started_desc  ON encounters (started_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_encounters_zone          ON encounters (zone);",
    "CREATE INDEX IF NOT EXISTS idx_combatants_encounter     ON combatants (encounter_id);",
    "CREATE INDEX IF NOT EXISTS idx_combatants_name          ON combatants (name);",
    "CREATE INDEX IF NOT EXISTS idx_damage_types_combatant   ON damage_types (combatant_id);",
    "CREATE INDEX IF NOT EXISTS idx_attack_types_combatant   ON attack_types (combatant_id);",
    "CREATE INDEX IF NOT EXISTS idx_attack_types_damage_desc ON attack_types (combatant_id, damage DESC);",
]

# Empty for a fresh feature. Append idempotent ALTER TABLE statements here
# when schema changes — `init_db` swallows OperationalError so duplicate-column
# attempts are safe.
_MIGRATIONS: list[str] = []


# ---------------------------------------------------------------------------
# DB management
# ---------------------------------------------------------------------------


def init_db(path: Path = DB_PATH) -> sqlite3.Connection:
    """Create tables/indexes if missing. Returns an open connection."""
    if str(path) == ":memory:":
        conn = sqlite3.connect(":memory:")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute(_CREATE_ENCOUNTERS)
    conn.execute(_CREATE_COMBATANTS)
    conn.execute(_CREATE_DAMAGE_TYPES)
    conn.execute(_CREATE_ATTACK_TYPES)
    conn.execute(_CREATE_INGEST_LOG)
    for stmt in _MIGRATIONS:
        try:
            conn.execute(stmt)
        except sqlite3.OperationalError:
            pass
    for idx in _CREATE_INDEXES:
        conn.execute(idx)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Insert helpers
# ---------------------------------------------------------------------------


def _to_unix(dt) -> int:
    """Treat naive datetimes as UTC; this matches what ACT writes."""

    if dt is None:
        return 0
    if dt.tzinfo is None:
        return int(dt.replace(tzinfo=UTC).timestamp())
    return int(dt.timestamp())


def insert_encounter(
    conn: sqlite3.Connection,
    enc: Encounter,
    *,
    source_dsn: str,
    ingested_at: int,
) -> int:
    """Insert one encounter row. Returns the new row's id."""
    cur = conn.execute(
        """
        INSERT INTO encounters (
            act_encid, title, zone,
            started_at, ended_at, duration_s,
            total_damage, encdps, kills, deaths,
            source_dsn, ingested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            enc.encid,
            enc.title,
            enc.zone,
            _to_unix(enc.started_at),
            _to_unix(enc.ended_at),
            enc.duration_s,
            enc.total_damage,
            enc.encdps,
            enc.kills,
            enc.deaths,
            source_dsn,
            ingested_at,
        ),
    )
    return int(cur.lastrowid or 0)


def insert_combatants_bulk(
    conn: sqlite3.Connection,
    encounter_id: int,
    combatants: list[Combatant],
) -> dict[str, int]:
    """Insert combatants for the given encounter. Returns name → new row id."""
    name_to_id: dict[str, int] = {}
    for c in combatants:
        cur = conn.execute(
            """
            INSERT INTO combatants (
                encounter_id, name, eq2_class, role,
                duration_s, damage, dps, encdps,
                hps, healed, crits, max_hit, kills, deaths,
                grouping_label
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                encounter_id,
                c.name,
                c.eq2_class,
                c.role,
                c.duration_s,
                c.damage,
                c.dps,
                c.encdps,
                c.hps,
                c.healed,
                c.crits,
                c.max_hit,
                c.kills,
                c.deaths,
                c.grouping_label,
            ),
        )
        name_to_id[c.name] = int(cur.lastrowid or 0)
    return name_to_id


def insert_damage_types_bulk(
    conn: sqlite3.Connection,
    combatant_name_to_id: dict[str, int],
    damage_types: list[DamageType],
) -> int:
    """Insert damage types for the given combatants. Returns rows inserted."""
    rows = [
        (
            combatant_name_to_id[dt.combatant_name],
            dt.damage_type,
            dt.damage,
            dt.swings,
            dt.hits,
            dt.misses,
        )
        for dt in damage_types
        if dt.combatant_name in combatant_name_to_id
    ]
    conn.executemany(
        """
        INSERT INTO damage_types (
            combatant_id, damage_type, damage, swings, hits, misses
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


def insert_attack_types_bulk(
    conn: sqlite3.Connection,
    combatant_name_to_id: dict[str, int],
    attack_types: list[AttackType],
) -> int:
    """Insert attack types for the given combatants. Returns rows inserted."""
    rows = [
        (
            combatant_name_to_id[at.combatant_name],
            at.attack_name,
            at.swings,
            at.hits,
            at.misses,
            at.blocked,
            at.crit_hits,
            at.damage,
            at.max_hit,
            at.min_hit,
            at.average,
            at.median,
            at.dps,
            at.char_dps,
            at.enc_dps,
            at.duration_s,
            at.average_delay,
            at.to_hit,
            at.crit_perc,
            at.resist,
        )
        for at in attack_types
        if at.combatant_name in combatant_name_to_id
    ]
    conn.executemany(
        """
        INSERT INTO attack_types (
            combatant_id, attack_name,
            swings, hits, misses, blocked, crit_hits,
            damage, max_hit, min_hit, average, median,
            dps, char_dps, enc_dps, duration_s,
            average_delay, to_hit, crit_perc, resist
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        rows,
    )
    return len(rows)


def mark_ingested(
    conn: sqlite3.Connection,
    act_encid: str,
    encounter_id: int,
    *,
    source_dsn: str,
    ingested_at: int,
) -> None:
    conn.execute(
        """
        INSERT INTO ingest_log (act_encid, encounter_id, ingested_at, source_dsn)
        VALUES (?, ?, ?, ?)
        """,
        (act_encid, encounter_id, ingested_at, source_dsn),
    )


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------


def is_ingested(conn: sqlite3.Connection, act_encid: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM ingest_log WHERE act_encid = ? LIMIT 1",
        (act_encid,),
    ).fetchone()
    return row is not None


def find_encounter_by_act_encid(conn: sqlite3.Connection, act_encid: str) -> dict | None:
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM encounters WHERE act_encid = ? LIMIT 1",
        (act_encid,),
    ).fetchone()
    return dict(row) if row else None


def recent_encounters(
    conn: sqlite3.Connection,
    limit: int = 20,
    zone: str | None = None,
) -> list[dict]:
    conn.row_factory = sqlite3.Row
    if zone:
        rows = conn.execute(
            """
            SELECT * FROM encounters
            WHERE zone = ?
            ORDER BY started_at DESC
            LIMIT ?
            """,
            (zone, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM encounters ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_combatants_for_encounter(conn: sqlite3.Connection, encounter_id: int) -> list[dict]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM combatants WHERE encounter_id = ? ORDER BY damage DESC",
        (encounter_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_top_attacks_for_combatant(
    conn: sqlite3.Connection,
    combatant_id: int,
    limit: int = 10,
) -> list[dict]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT * FROM attack_types
        WHERE combatant_id = ?
        ORDER BY damage DESC
        LIMIT ?
        """,
        (combatant_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]
