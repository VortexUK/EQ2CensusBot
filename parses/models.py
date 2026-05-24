"""
Dataclasses that mirror ACT's ODBC export schema at AttackType depth.

ACT writes four tables when "Export down to AttackType tables" is selected:
  encounter_table   – one row per fight
  combatant_table   – one row per player per fight
  damagetype_table  – one row per damage type per combatant
  attacktype_table  – one row per ability per combatant

These dataclasses preserve the source data with two defensive renames:
  * ACT's `class` column        → `eq2_class` (avoids Python keyword)
  * ACT's `grouping` column     → `grouping_label` (cleaner across DB engines)

TIMESTAMP coercion supports both formats ACT may emit when targeting SQLite:
  * ISO 8601 with 'T' separator
  * "YYYY-MM-DD HH:MM:SS" (the more common form)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


def _to_int(v) -> int:
    if v is None or v == "":
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _to_float(v) -> float:
    if v is None or v == "":
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _to_str_or_none(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _to_ts(v) -> datetime | None:
    """Parse ACT's TIMESTAMP into a naive datetime, trying common formats.

    Returns None for empty/unparseable input rather than raising — the caller
    decides whether to skip the row or fail loudly.
    """
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


@dataclass(frozen=True)
class Encounter:
    encid: str
    title: str
    zone: str | None
    started_at: datetime
    ended_at: datetime
    duration_s: int
    total_damage: int
    encdps: float
    kills: int
    deaths: int


@dataclass(frozen=True)
class Combatant:
    encid: str
    name: str
    eq2_class: str | None
    role: str | None
    duration_s: int
    damage: int
    dps: float
    encdps: float
    hps: float
    healed: int
    crits: int
    max_hit: int
    kills: int
    deaths: int
    grouping_label: str | None


@dataclass(frozen=True)
class DamageType:
    encid: str
    combatant_name: str
    damage_type: str
    damage: int
    swings: int
    hits: int
    misses: int


@dataclass(frozen=True)
class AttackType:
    encid: str
    combatant_name: str
    attack_name: str
    swings: int
    hits: int
    misses: int
    blocked: int
    crit_hits: int
    damage: int
    max_hit: int
    min_hit: int
    average: float
    median: float
    dps: float
    char_dps: float
    enc_dps: float
    duration_s: int
    average_delay: float
    to_hit: float
    crit_perc: float
    resist: str | None
