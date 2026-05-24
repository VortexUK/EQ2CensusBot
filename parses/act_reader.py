"""
Read encounters from the SQLite file ACT writes via its ODBC export.

ACT writes through the SQLite ODBC driver, but once the .db file exists we
can read it directly with stdlib sqlite3 — no need for pyodbc on the read
side. We open read-only via URI to avoid any chance of locking ACT out.

ACT's tables at AttackType depth (option 4):
  encounter_table   – fight-level
  combatant_table   – per-player-per-fight
  damagetype_table  – per-combatant per damage type
  attacktype_table  – per-combatant per ability

SELECTs alias `class` → `eq2_class` (Python keyword) and quote `grouping`
defensively (MySQL reserved keyword in 8+; harmless in SQLite).
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from parses.models import (
    AttackType,
    Combatant,
    DamageType,
    Encounter,
    _to_float,
    _to_int,
    _to_str_or_none,
    _to_ts,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def _default_act_db_path() -> Path:
    env = os.getenv("ACT_EXPORT_DB_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent / "data" / "parses" / "act_export.db"


ACT_DB_PATH: Path = _default_act_db_path()


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------


def open_act_db(path: Path = ACT_DB_PATH) -> sqlite3.Connection:
    """Open ACT's export DB read-only. Caller is responsible for closing."""
    if not path.exists():
        raise FileNotFoundError(
            f"ACT export DB not found at {path}. "
            "Has ACT written at least one encounter? "
            "See data/parses/ and your ODBC DSN configuration."
        )
    uri = f"file:{path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# ---------------------------------------------------------------------------
# Encounters
# ---------------------------------------------------------------------------


def list_encounter_ids(
    conn: sqlite3.Connection,
    since_encid: str | None = None,
) -> list[str]:
    """Return encids in starttime ascending order.

    If `since_encid` is given, return only encounters that started strictly
    after that encid's starttime. Used by the watcher to pull new fights.

    Only encounters with a non-NULL `endtime` AND at least one combatant are
    returned — this filters out half-written rows regardless of whether ACT
    writes atomically.
    """
    if since_encid is None:
        rows = conn.execute(
            """
            SELECT e.encid
            FROM encounter_table e
            WHERE e.endtime IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM combatant_table c WHERE c.encid = e.encid
              )
            ORDER BY e.starttime ASC
            """
        ).fetchall()
        return [r["encid"] for r in rows]

    since_row = conn.execute(
        "SELECT starttime FROM encounter_table WHERE encid = ?",
        (since_encid,),
    ).fetchone()
    if since_row is None:
        # Unknown anchor — fall back to all encounters
        return list_encounter_ids(conn)
    rows = conn.execute(
        """
        SELECT e.encid
        FROM encounter_table e
        WHERE e.starttime > ?
          AND e.endtime IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM combatant_table c WHERE c.encid = e.encid
          )
        ORDER BY e.starttime ASC
        """,
        (since_row["starttime"],),
    ).fetchall()
    return [r["encid"] for r in rows]


def get_encounter(conn: sqlite3.Connection, encid: str) -> Encounter | None:
    row = conn.execute(
        """
        SELECT encid, title, zone, starttime, endtime, duration,
               damage, encdps, kills, deaths
        FROM encounter_table
        WHERE encid = ?
        """,
        (encid,),
    ).fetchone()
    if row is None:
        return None
    started = _to_ts(row["starttime"])
    ended = _to_ts(row["endtime"])
    if started is None or ended is None:
        return None
    return Encounter(
        encid=row["encid"],
        title=str(row["title"] or ""),
        zone=_to_str_or_none(row["zone"]),
        started_at=started,
        ended_at=ended,
        duration_s=_to_int(row["duration"]),
        total_damage=_to_int(row["damage"]),
        encdps=_to_float(row["encdps"]),
        kills=_to_int(row["kills"]),
        deaths=_to_int(row["deaths"]),
    )


# ---------------------------------------------------------------------------
# Combatants
# ---------------------------------------------------------------------------


def get_combatants(conn: sqlite3.Connection, encid: str) -> list[Combatant]:
    rows = conn.execute(
        """
        SELECT encid, name,
               class AS eq2_class,
               role, duration, damage, dps, encdps,
               hps, healed, crits, maxhit, kills, deaths,
               "grouping" AS grouping_label
        FROM combatant_table
        WHERE encid = ?
        """,
        (encid,),
    ).fetchall()
    return [
        Combatant(
            encid=r["encid"],
            name=str(r["name"] or ""),
            eq2_class=_to_str_or_none(r["eq2_class"]),
            role=_to_str_or_none(r["role"]),
            duration_s=_to_int(r["duration"]),
            damage=_to_int(r["damage"]),
            dps=_to_float(r["dps"]),
            encdps=_to_float(r["encdps"]),
            hps=_to_float(r["hps"]),
            healed=_to_int(r["healed"]),
            crits=_to_int(r["crits"]),
            max_hit=_to_int(r["maxhit"]),
            kills=_to_int(r["kills"]),
            deaths=_to_int(r["deaths"]),
            grouping_label=_to_str_or_none(r["grouping_label"]),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Damage types
# ---------------------------------------------------------------------------


def get_damage_types(
    conn: sqlite3.Connection,
    encid: str,
    combatant_name: str | None = None,
) -> list[DamageType]:
    if combatant_name is None:
        rows = conn.execute(
            """
            SELECT encid, attacker, type, damage, swings, hits, misses
            FROM damagetype_table
            WHERE encid = ?
            """,
            (encid,),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT encid, attacker, type, damage, swings, hits, misses
            FROM damagetype_table
            WHERE encid = ? AND attacker = ?
            """,
            (encid, combatant_name),
        ).fetchall()
    return [
        DamageType(
            encid=r["encid"],
            combatant_name=str(r["attacker"] or ""),
            damage_type=str(r["type"] or ""),
            damage=_to_int(r["damage"]),
            swings=_to_int(r["swings"]),
            hits=_to_int(r["hits"]),
            misses=_to_int(r["misses"]),
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# Attack types
# ---------------------------------------------------------------------------


def get_attack_types(
    conn: sqlite3.Connection,
    encid: str,
    combatant_name: str | None = None,
) -> list[AttackType]:
    base_select = """
        SELECT encid, attacker, type AS attack_name,
               swings, hits, misses, blocked, crithits,
               damage, maxhit, minhit, average, median,
               dps, chardps, encdps,
               duration, averagedelay, tohit, critperc, resist
        FROM attacktype_table
    """
    if combatant_name is None:
        rows = conn.execute(base_select + " WHERE encid = ?", (encid,)).fetchall()
    else:
        rows = conn.execute(
            base_select + " WHERE encid = ? AND attacker = ?",
            (encid, combatant_name),
        ).fetchall()
    return [
        AttackType(
            encid=r["encid"],
            combatant_name=str(r["attacker"] or ""),
            attack_name=str(r["attack_name"] or ""),
            swings=_to_int(r["swings"]),
            hits=_to_int(r["hits"]),
            misses=_to_int(r["misses"]),
            blocked=_to_int(r["blocked"]),
            crit_hits=_to_int(r["crithits"]),
            damage=_to_int(r["damage"]),
            max_hit=_to_int(r["maxhit"]),
            min_hit=_to_int(r["minhit"]),
            average=_to_float(r["average"]),
            median=_to_float(r["median"]),
            dps=_to_float(r["dps"]),
            char_dps=_to_float(r["chardps"]),
            enc_dps=_to_float(r["encdps"]),
            duration_s=_to_int(r["duration"]),
            average_delay=_to_float(r["averagedelay"]),
            to_hit=_to_float(r["tohit"]),
            crit_perc=_to_float(r["critperc"]),
            resist=_to_str_or_none(r["resist"]),
        )
        for r in rows
    ]
