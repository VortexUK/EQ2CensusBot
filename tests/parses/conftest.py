"""
Fixtures for the parses test suite.

`parses_db_conn` provides an in-memory init_db connection.
`act_db_fake` provides an in-memory SQLite shaped like ACT's four tables,
pre-populated with one encounter, two combatants and a swingtype=100 'All'
rollup row in attacktype_table so the filter behaviour is exercised.

Schema and sample values are copied from real ACT-via-SQLite-ODBC output
(see `uv run python -c "...SELECT * FROM ..."` snapshots used during
development), so coercion edge cases (`'--'` percentages, `'T'`/`'F'` ally
flag, VARCHAR percentage columns) are realistic.
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
# Fake ACT export DB — mirrors what the SQLite ODBC driver writes.
# Types kept loose (INTEGER/REAL/TEXT) matching post-compat-hack reality.
# ---------------------------------------------------------------------------

_ACT_SCHEMA = """
CREATE TABLE encounter_table (
    encid     CHAR(8) PRIMARY KEY,
    title     VARCHAR(64),
    starttime TEXT,
    endtime   TEXT,
    duration  INT,
    damage    INTEGER,
    encdps    REAL,
    zone      VARCHAR(64),
    kills     INT,
    deaths    INT
);

CREATE TABLE combatant_table (
    encid          CHAR(8),
    ally           CHAR(1),
    name           VARCHAR(64),
    starttime      TEXT,
    endtime        TEXT,
    duration       INT,
    damage         INTEGER,
    damageperc     VARCHAR(4),
    kills          INT,
    healed         INTEGER,
    healedperc     VARCHAR(4),
    critheals      INT,
    heals          INT,
    curedispels    INT,
    powerdrain     INTEGER,
    powerreplenish INTEGER,
    dps            REAL,
    encdps         REAL,
    enchps         REAL,
    hits           INT,
    crithits       INT,
    blocked        INT,
    misses         INT,
    swings         INT,
    healstaken     INTEGER,
    damagetaken    INTEGER,
    deaths         INT,
    tohit          REAL,
    critdamperc    VARCHAR(8),
    crithealperc   VARCHAR(8),
    crittypes      VARCHAR(32),
    threatstr      VARCHAR(32),
    threatdelta    INTEGER
);

CREATE TABLE damagetype_table (
    encid        CHAR(8),
    combatant    VARCHAR(64),
    "grouping"   VARCHAR(92),
    type         VARCHAR(64),
    starttime    TEXT,
    endtime      TEXT,
    duration     INT,
    damage       INTEGER,
    encdps       REAL,
    chardps      REAL,
    dps          REAL,
    average      REAL,
    median       INTEGER,
    minhit       INTEGER,
    maxhit       INTEGER,
    hits         INT,
    crithits     INT,
    blocked      INT,
    misses       INT,
    swings       INT,
    tohit        REAL,
    averagedelay REAL,
    critperc     VARCHAR(8),
    crittypes    VARCHAR(32)
);

CREATE TABLE attacktype_table (
    encid        CHAR(8),
    attacker     VARCHAR(64),
    victim       VARCHAR(64),
    swingtype    INTEGER,
    type         VARCHAR(64),
    starttime    TEXT,
    endtime      TEXT,
    duration     INT,
    damage       INTEGER,
    encdps       REAL,
    chardps      REAL,
    dps          REAL,
    average      REAL,
    median       INTEGER,
    minhit       INTEGER,
    maxhit       INTEGER,
    resist       VARCHAR(64),
    hits         INT,
    crithits     INT,
    blocked      INT,
    misses       INT,
    swings       INT,
    tohit        REAL,
    averagedelay REAL,
    critperc     VARCHAR(8),
    crittypes    VARCHAR(32)
);
"""


def _seed_act_db(conn: sqlite3.Connection) -> None:
    conn.executescript(_ACT_SCHEMA)

    conn.execute(
        """
        INSERT INTO encounter_table VALUES
            ('18cf3eb9', 'a krait patriarch',
             '2026-05-24 13:51:56', '2026-05-24 13:52:42',
             46, 502718, 10928.65, 'Great Divide', 4, 0)
        """
    )

    # 2 combatants: one ally (player Menludiir, 100% damage), one enemy (the mob).
    # Real ACT data uses '100%' / '--' for damageperc; 'T'/'F' for ally.
    conn.executemany(
        """
        INSERT INTO combatant_table (
            encid, ally, name, starttime, endtime, duration,
            damage, damageperc, kills,
            healed, healedperc, critheals, heals, curedispels,
            powerdrain, powerreplenish,
            dps, encdps, enchps,
            hits, crithits, blocked, misses, swings,
            healstaken, damagetaken, deaths,
            tohit, critdamperc, crithealperc, crittypes,
            threatstr, threatdelta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "18cf3eb9",
                "T",
                "Menludiir",
                "2026-05-24 13:51:56",
                "2026-05-24 13:52:43",
                47,
                502718,
                "100%",
                4,
                11637,
                "100%",
                1,
                40,
                0,
                0,
                0,
                10696.13,
                10928.65,
                252.98,
                132,
                123,
                0,
                0,
                132,
                11637,
                27557,
                0,
                100.0,
                "93%",
                "3%",
                "0.8%L - 0.0%F - 0.0%M",
                "+(0)20000/-(0)0",
                20000,
            ),
            (
                "18cf3eb9",
                "F",
                "a krait patriarch",
                "2026-05-24 13:52:27",
                "2026-05-24 13:52:42",
                15,
                5716,
                "--",
                0,
                0,
                "--",
                0,
                0,
                0,
                0,
                0,
                381.07,
                124.26,
                0.0,
                11,
                0,
                0,
                1,
                12,
                0,
                145877,
                1,
                91.67,
                "0%",
                "0%",
                "-",
                "+(0)0/-(0)0",
                0,
            ),
        ],
    )

    # damagetype_table — combatant column (not attacker), grouping lives here
    conn.executemany(
        """
        INSERT INTO damagetype_table (
            encid, combatant, "grouping", type,
            starttime, endtime, duration,
            damage, encdps, chardps, dps,
            average, median, minhit, maxhit,
            hits, crithits, blocked, misses, swings,
            tohit, averagedelay, critperc, crittypes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "18cf3eb9",
                "Menludiir",
                "Group 1",
                "divine",
                "2026-05-24 13:51:56",
                "2026-05-24 13:52:43",
                47,
                400000,
                8000.0,
                8000.0,
                8500.0,
                3030.0,
                3000,
                100,
                8000,
                100,
                90,
                0,
                0,
                100,
                100.0,
                0.47,
                "90%",
                "0.8%L - 0.0%F - 0.0%M",
            ),
            (
                "18cf3eb9",
                "Menludiir",
                "Group 1",
                "melee",
                "2026-05-24 13:51:56",
                "2026-05-24 13:52:43",
                47,
                102718,
                2185.0,
                2185.0,
                3210.0,
                3210.0,
                3000,
                500,
                4500,
                32,
                33,
                0,
                0,
                32,
                100.0,
                1.47,
                "100%",
                "0.0%L - 0.0%F - 0.0%M",
            ),
            (
                "18cf3eb9",
                "a krait patriarch",
                "",
                "physical",
                "2026-05-24 13:52:27",
                "2026-05-24 13:52:42",
                15,
                5716,
                124.26,
                381.07,
                381.07,
                519.6,
                710,
                0,
                1297,
                11,
                0,
                0,
                1,
                12,
                91.67,
                1.67,
                "0%",
                "-",
            ),
        ],
    )

    # attacktype_table — includes a swingtype=100 'All' rollup row that the
    # reader MUST filter out, plus two real per-ability rows for Menludiir
    # and one for the mob.
    conn.executemany(
        """
        INSERT INTO attacktype_table (
            encid, attacker, victim, swingtype, type,
            starttime, endtime, duration,
            damage, encdps, chardps, dps,
            average, median, minhit, maxhit, resist,
            hits, crithits, blocked, misses, swings,
            tohit, averagedelay, critperc, crittypes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            # 'All' rollup — this row MUST be filtered out by the reader
            (
                "18cf3eb9",
                "Menludiir",
                "",
                100,
                "All",
                "2026-05-24 13:51:56",
                "2026-05-24 13:52:43",
                47,
                502718,
                10928.65,
                10696.13,
                10696.13,
                3808.0,
                3000,
                100,
                8000,
                "All",
                132,
                123,
                0,
                0,
                132,
                100.0,
                0.36,
                "93%",
                "0.8%L - 0.0%F - 0.0%M",
            ),
            (
                "18cf3eb9",
                "Menludiir",
                "a krait patriarch",
                1,
                "Smite",
                "2026-05-24 13:51:56",
                "2026-05-24 13:52:43",
                47,
                400000,
                8000.0,
                8500.0,
                8500.0,
                4000.0,
                3500,
                100,
                8000,
                "divine",
                100,
                90,
                0,
                0,
                100,
                100.0,
                0.47,
                "90%",
                "0.8%L - 0.0%F - 0.0%M",
            ),
            (
                "18cf3eb9",
                "Menludiir",
                "a krait patriarch",
                1,
                "Auto-Attack",
                "2026-05-24 13:51:56",
                "2026-05-24 13:52:43",
                47,
                102718,
                2185.0,
                3210.0,
                3210.0,
                3210.0,
                3000,
                500,
                4500,
                "melee",
                32,
                33,
                0,
                0,
                32,
                100.0,
                1.47,
                "100%",
                "0.0%L - 0.0%F - 0.0%M",
            ),
            # 'All' rollup for the enemy (also filtered)
            (
                "18cf3eb9",
                "a krait patriarch",
                "",
                100,
                "All",
                "2026-05-24 13:52:27",
                "2026-05-24 13:52:42",
                15,
                5716,
                124.26,
                381.07,
                381.07,
                519.6,
                710,
                0,
                1297,
                "All",
                11,
                0,
                0,
                1,
                12,
                91.67,
                1.67,
                "0%",
                "-",
            ),
            (
                "18cf3eb9",
                "a krait patriarch",
                "Menludiir",
                1,
                "melee",
                "2026-05-24 13:52:27",
                "2026-05-24 13:52:42",
                15,
                5716,
                124.26,
                381.07,
                381.07,
                519.6,
                710,
                0,
                1297,
                "physical",
                11,
                0,
                0,
                1,
                12,
                91.67,
                1.67,
                "0%",
                "-",
            ),
            # Edge case observed in real ACT data: an 'All' rollup row
            # written for the 'Unknown' synthetic combatant uses swingtype=2
            # (the swingtype of its dominant attack), NOT 100. The reader's
            # filter must catch type='All' regardless of swingtype.
            (
                "18cf3eb9",
                "Unknown",
                "",
                2,
                "All",
                "2026-05-24 13:52:34",
                "2026-05-24 13:52:34",
                0,
                3775,
                82.07,
                0.0,
                0.0,
                1887.5,
                1310,
                1310,
                2465,
                "All",
                2,
                2,
                0,
                0,
                2,
                100.0,
                0.0,
                "100%",
                "0.0%L - 0.0%F - 0.0%M",
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
