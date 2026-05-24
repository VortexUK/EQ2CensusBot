"""
GET /api/parses          — paginated list of recent encounters.
GET /api/parses/{id}     — encounter detail with combatants + top attacks each.

Reads from the local `data/parses/parses.db` populated by `parses.ingest`.
Sync DB helpers from `parses.db` are dispatched to a thread via
run_in_executor — same pattern as web/routes/recipes.py.

Auth: any authenticated session can read. Officer-only / guild-scoped
filtering is a Phase 3 concern (when uploads are added).
"""

from __future__ import annotations

import asyncio
import sqlite3

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from parses import db as parses_db
from web.limiter import limiter

router = APIRouter(tags=["parses"])


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ParseEncounterSummary(BaseModel):
    id: int
    act_encid: str
    title: str
    zone: str | None
    started_at: int  # unix seconds, UTC
    ended_at: int
    duration_s: int
    total_damage: int
    encdps: float
    kills: int
    deaths: int
    combatant_count: int
    player_count: int  # ally combatants with single-word names, excluding 'Unknown'
    uploaded_by: str  # who ingested this encounter; 'local' for the local-only era
    guild_name: str | None  # stamped at ingest time from uploader's Census guild


class ParsesListResponse(BaseModel):
    results: list[ParseEncounterSummary]
    total: int


class AttackSummary(BaseModel):
    attack_name: str
    damage: int
    hits: int
    swings: int
    crit_perc: float
    max_hit: int


class HealSummary(BaseModel):
    """Per-ability heal rollup. ACT writes heals into attacktype_table at
    swing_type=3; the `damage` column there is the amount healed, and
    `resist` distinguishes regular heals ('Hitpoints') from wards
    ('Absorption')."""

    heal_name: str
    healed: int
    hits: int
    swings: int
    crit_perc: float
    max_hit: int
    heal_type: str | None  # 'Hitpoints' (regular heal) or 'Absorption' (ward)


class CureSummary(BaseModel):
    """Cure events (swing_type=20). `effects_removed` is the count of
    detrimental effects cleared (ACT writes this into the `damage` column);
    `times_cast` is hit count."""

    cure_name: str
    effects_removed: int
    times_cast: int
    max_at_once: int


class ThreatSummary(BaseModel):
    """Threat / buff proc (swing_type=100, type != 'All'). For threat
    procs `value` is the threat amount; `procs` is how many times it fired."""

    ability_name: str
    value: int
    procs: int
    max_proc: int
    kind: str | None  # ACT's `resist` column — 'Increase' for threat procs


class DamageTypeBreakdown(BaseModel):
    damage_type: str
    damage: int
    dps: float
    hits: int
    swings: int
    max_hit: int
    crit_perc: float


class CombatantSummary(BaseModel):
    id: int
    name: str
    ally: bool
    duration_s: int
    damage: int
    damage_perc: float
    dps: float
    encdps: float
    healed: int
    enchps: float
    heals: int
    crit_heals: int
    cure_dispels: int
    power_drain: int
    power_replenish: int
    heals_taken: int
    damage_taken: int
    threat_delta: int
    deaths: int
    kills: int
    crit_hits: int
    crit_dam_perc: float
    top_attacks: list[AttackSummary]
    top_heals: list[HealSummary]
    top_cures: list[CureSummary]
    top_threats: list[ThreatSummary]
    damage_types: list[DamageTypeBreakdown]


class ParseDetailResponse(BaseModel):
    id: int
    act_encid: str
    title: str
    zone: str | None
    started_at: int
    ended_at: int
    duration_s: int
    total_damage: int
    encdps: float
    kills: int
    deaths: int
    combatants: list[CombatantSummary]


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _require_user(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ---------------------------------------------------------------------------
# Sync query helpers (run via run_in_executor)
# ---------------------------------------------------------------------------


# Encounter "size" buckets — mapped to a (min_players, max_players) range
# inclusive on both ends. Used to filter the list endpoint via ?size=...
SIZE_BUCKETS: dict[str, tuple[int, int]] = {
    "individual": (1, 1),
    "group": (2, 6),
    "raid12": (7, 12),
    "raid24": (13, 24),
}

# Player detection: ally combatants whose name is one word and isn't the
# 'Unknown' fallback row ACT writes for un-attributed damage. Pets nearly
# always either consolidate into the owner or have multi-word descriptive
# names, so this catches real player count without false positives.
_PLAYER_COUNT_SQL = (
    "SELECT COUNT(*) FROM combatants c "
    "WHERE c.encounter_id = e.id "
    "  AND c.ally = 1 "
    "  AND c.name != '' "
    "  AND c.name != 'Unknown' "
    "  AND instr(c.name, ' ') = 0"
)


def _list_encounters_sync(
    limit: int,
    zone: str | None,
    size: str | None,
) -> tuple[list[dict], int]:
    """Return (encounters_with_counts, total_count) ordered started_at DESC."""
    if not parses_db.DB_PATH.exists():
        return [], 0

    # Build the encounter list (with computed player_count + combatant_count).
    where_clauses: list[str] = []
    params: list = []
    if zone:
        where_clauses.append("e.zone = ?")
        params.append(zone)
    if size and size in SIZE_BUCKETS:
        lo, hi = SIZE_BUCKETS[size]
        where_clauses.append("player_count BETWEEN ? AND ?")
        params.extend([lo, hi])
    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    list_sql = f"""
        SELECT * FROM (
            SELECT e.*,
                ({_PLAYER_COUNT_SQL}) AS player_count,
                (SELECT COUNT(*) FROM combatants c2 WHERE c2.encounter_id = e.id) AS combatant_count
            FROM encounters e
        )
        {where_sql}
        ORDER BY started_at DESC
        LIMIT ?
    """
    count_sql = f"""
        SELECT COUNT(*) FROM (
            SELECT e.id,
                ({_PLAYER_COUNT_SQL}) AS player_count
            FROM encounters e
        )
        {where_sql}
    """

    conn = parses_db.init_db()
    try:
        conn.row_factory = sqlite3.Row
        encounters = [dict(r) for r in conn.execute(list_sql, [*params, limit]).fetchall()]
        total = conn.execute(count_sql, params).fetchone()[0]
        return encounters, total
    finally:
        conn.close()


def _encounter_detail_sync(encounter_id: int, top_attacks_per_combatant: int) -> dict | None:
    """Return the encounter + its combatants + top attacks per combatant."""
    if not parses_db.DB_PATH.exists():
        return None
    conn = parses_db.init_db()
    try:
        conn.row_factory = sqlite3.Row
        enc_row = conn.execute("SELECT * FROM encounters WHERE id = ?", (encounter_id,)).fetchone()
        if enc_row is None:
            return None
        enc = dict(enc_row)

        combatants = parses_db.get_combatants_for_encounter(conn, enc["id"])
        for c in combatants:
            c["top_attacks"] = parses_db.get_top_attacks_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["top_heals"] = parses_db.get_top_heals_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["top_cures"] = parses_db.get_top_cures_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["top_threats"] = parses_db.get_top_threats_for_combatant(conn, c["id"], limit=top_attacks_per_combatant)
            c["damage_types"] = parses_db.get_damage_types_for_combatant(conn, c["id"])
            c["ally"] = bool(c["ally"])
        enc["combatants"] = combatants
        return enc
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/parses", response_model=ParsesListResponse)
@limiter.limit("30/minute")
async def list_parses(
    request: Request,
    limit: int = 200,
    zone: str | None = None,
    size: str | None = None,
) -> ParsesListResponse:
    _require_user(request)

    # Clamp limit so a hostile caller can't ask for millions.
    limit = max(1, min(limit, 500))

    # Unknown `size` value is silently dropped (no filter applied) — same
    # forgiving behaviour as the recipes route's bench filter.
    if size and size not in SIZE_BUCKETS:
        size = None

    loop = asyncio.get_event_loop()
    encounters, total = await loop.run_in_executor(None, _list_encounters_sync, limit, zone, size)

    results = [
        ParseEncounterSummary(
            id=e["id"],
            act_encid=e["act_encid"],
            title=e["title"],
            zone=e["zone"],
            started_at=e["started_at"],
            ended_at=e["ended_at"],
            duration_s=e["duration_s"],
            total_damage=e["total_damage"],
            encdps=e["encdps"],
            kills=e["kills"],
            deaths=e["deaths"],
            combatant_count=e.get("combatant_count", 0),
            player_count=e.get("player_count", 0),
            uploaded_by=e.get("uploaded_by") or "local",
            guild_name=e.get("guild_name"),
        )
        for e in encounters
    ]
    return ParsesListResponse(results=results, total=total)


@router.get("/parses/{encounter_id}", response_model=ParseDetailResponse)
@limiter.limit("60/minute")
async def get_parse(
    request: Request,
    encounter_id: int,
    top_attacks: int = 15,
) -> ParseDetailResponse:
    _require_user(request)

    top_attacks = max(1, min(top_attacks, 50))

    loop = asyncio.get_event_loop()
    enc = await loop.run_in_executor(None, _encounter_detail_sync, encounter_id, top_attacks)
    if enc is None:
        raise HTTPException(status_code=404, detail="Parse not found")

    combatants = [
        CombatantSummary(
            id=c["id"],
            name=c["name"],
            ally=c["ally"],
            duration_s=c["duration_s"],
            damage=c["damage"],
            damage_perc=c["damage_perc"],
            dps=c["dps"],
            encdps=c["encdps"],
            healed=c["healed"],
            enchps=c["enchps"],
            heals=c["heals"],
            crit_heals=c["crit_heals"],
            cure_dispels=c["cure_dispels"],
            power_drain=c["power_drain"],
            power_replenish=c["power_replenish"],
            heals_taken=c["heals_taken"],
            damage_taken=c["damage_taken"],
            threat_delta=c["threat_delta"],
            deaths=c["deaths"],
            kills=c["kills"],
            crit_hits=c["crit_hits"],
            crit_dam_perc=c["crit_dam_perc"],
            top_attacks=[
                AttackSummary(
                    attack_name=a["attack_name"],
                    damage=a["damage"],
                    hits=a["hits"],
                    swings=a["swings"],
                    crit_perc=a["crit_perc"],
                    max_hit=a["max_hit"],
                )
                for a in c["top_attacks"]
            ],
            top_heals=[
                HealSummary(
                    heal_name=h["attack_name"],
                    healed=h["damage"],  # `damage` column = amount healed for swing_type=3
                    hits=h["hits"],
                    swings=h["swings"],
                    crit_perc=h["crit_perc"],
                    max_hit=h["max_hit"],
                    heal_type=h["resist"],
                )
                for h in c["top_heals"]
            ],
            top_cures=[
                CureSummary(
                    cure_name=cu["attack_name"],
                    effects_removed=cu["damage"],
                    times_cast=cu["hits"],
                    max_at_once=cu["max_hit"],
                )
                for cu in c["top_cures"]
            ],
            top_threats=[
                ThreatSummary(
                    ability_name=t["attack_name"],
                    value=t["damage"],
                    procs=t["hits"],
                    max_proc=t["max_hit"],
                    kind=t["resist"],
                )
                for t in c["top_threats"]
            ],
            damage_types=[
                DamageTypeBreakdown(
                    damage_type=d["damage_type"],
                    damage=d["damage"],
                    dps=d["dps"],
                    hits=d["hits"],
                    swings=d["swings"],
                    max_hit=d["max_hit"],
                    crit_perc=d["crit_perc"],
                )
                for d in c["damage_types"]
            ],
        )
        for c in enc["combatants"]
    ]
    return ParseDetailResponse(
        id=enc["id"],
        act_encid=enc["act_encid"],
        title=enc["title"],
        zone=enc["zone"],
        started_at=enc["started_at"],
        ended_at=enc["ended_at"],
        duration_s=enc["duration_s"],
        total_damage=enc["total_damage"],
        encdps=enc["encdps"],
        kills=enc["kills"],
        deaths=enc["deaths"],
        combatants=combatants,
    )
