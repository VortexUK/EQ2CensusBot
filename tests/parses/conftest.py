"""
Fixtures for the parses test suite.

`parses_db_conn` provides an in-memory init_db connection.
`act_db_fake` provides an in-memory SQLite shaped like ACT's four tables,
pre-populated with one encounter and two combatants so reader tests have
realistic input.
"""

from __future__ import annotations

import sqlite3

import pytest

from parses import db as parses_db


@pytest.fixture
def parses_db_conn():
    conn = parses_db.init_db(":memory:")  # type: ignore[arg-type]
    yield conn
    conn.close()


# ---------------------------------------------------------------------------
# Fake ACT export DB
# ---------------------------------------------------------------------------

# Schema mirrors what ACT creates at AttackType depth. Columns kept as TEXT for
# permissiveness — matches what SQLite would emit through the ODBC driver where
# TIMESTAMP / BIGINT have no native storage class.
_ACT_SCHEMA = """
CREATE TABLE encounter_table (
    encid     TEXT PRIMARY KEY,
    title     TEXT,
    zone      TEXT,
    starttime TEXT,
    endtime   TEXT,
    duration  INTEGER,
    damage    INTEGER,
    encdps    REAL,
    kills     INTEGER,
    deaths    INTEGER
);

CREATE TABLE combatant_table (
    encid    TEXT,
    name     TEXT,
    class    TEXT,
    role     TEXT,
    duration INTEGER,
    damage   INTEGER,
    dps      REAL,
    encdps   REAL,
    hps      REAL,
    healed   INTEGER,
    crits    INTEGER,
    maxhit   INTEGER,
    kills    INTEGER,
    deaths   INTEGER,
    "grouping" TEXT
);

CREATE TABLE damagetype_table (
    encid    TEXT,
    attacker TEXT,
    type     TEXT,
    damage   INTEGER,
    swings   INTEGER,
    hits     INTEGER,
    misses   INTEGER
);

CREATE TABLE attacktype_table (
    encid        TEXT,
    attacker     TEXT,
    type         TEXT,
    swings       INTEGER,
    hits         INTEGER,
    misses       INTEGER,
    blocked      INTEGER,
    crithits     INTEGER,
    damage       INTEGER,
    maxhit       INTEGER,
    minhit       INTEGER,
    average      REAL,
    median       REAL,
    dps          REAL,
    chardps      REAL,
    encdps       REAL,
    duration     INTEGER,
    averagedelay REAL,
    tohit        REAL,
    critperc     REAL,
    resist       TEXT
);
"""


def _seed_act_db(conn: sqlite3.Connection) -> None:
    conn.executescript(_ACT_SCHEMA)

    conn.execute(
        """
        INSERT INTO encounter_table VALUES
            ('1A2B3C4D', 'a goblin grunt', 'Antonica',
             '2026-05-24 12:00:00', '2026-05-24 12:00:30',
             30, 12500, 416.66, 1, 0)
        """
    )
    conn.executemany(
        """
        INSERT INTO combatant_table (
            encid, name, class, role, duration, damage, dps, encdps,
            hps, healed, crits, maxhit, kills, deaths, "grouping"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("1A2B3C4D", "Sihtric", "Wizard", "DPS", 30, 8000, 266.6, 266.6, 0.0, 0, 5, 1500, 1, 0, "Group 1"),
            (
                "1A2B3C4D",
                "Menludiir",
                "Templar",
                "Healer",
                30,
                4500,
                150.0,
                150.0,
                200.0,
                6000,
                1,
                700,
                0,
                0,
                "Group 1",
            ),
        ],
    )
    conn.executemany(
        """
        INSERT INTO damagetype_table VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            ("1A2B3C4D", "Sihtric", "magic", 7500, 30, 28, 2),
            ("1A2B3C4D", "Sihtric", "physical", 500, 3, 3, 0),
            ("1A2B3C4D", "Menludiir", "physical", 4500, 18, 17, 1),
        ],
    )
    conn.executemany(
        """
        INSERT INTO attacktype_table VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "1A2B3C4D",
                "Sihtric",
                "Ice Comet",
                8,
                8,
                0,
                0,
                3,
                6000,
                1500,
                200,
                750.0,
                700.0,
                200.0,
                200.0,
                200.0,
                30,
                3.75,
                100.0,
                37.5,
                None,
            ),
            (
                "1A2B3C4D",
                "Sihtric",
                "Auto-Attack",
                12,
                10,
                2,
                0,
                2,
                2000,
                350,
                100,
                200.0,
                180.0,
                66.6,
                66.6,
                66.6,
                30,
                2.5,
                83.3,
                20.0,
                None,
            ),
            (
                "1A2B3C4D",
                "Menludiir",
                "Smite",
                18,
                17,
                1,
                0,
                1,
                4500,
                700,
                100,
                264.0,
                250.0,
                150.0,
                150.0,
                150.0,
                30,
                1.66,
                94.4,
                5.8,
                None,
            ),
        ],
    )
    conn.commit()


@pytest.fixture
def act_db_fake():
    """In-memory ACT-shaped SQLite seeded with a 1-encounter / 2-combatant fixture."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _seed_act_db(conn)
    yield conn
    conn.close()
