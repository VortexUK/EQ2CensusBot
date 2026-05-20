from __future__ import annotations

import asyncio
import os
import re
from collections import Counter

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from census.client import CensusClient
from census.models import SpellEntry

router = APIRouter(tags=["guild"])

_SERVICE_ID = os.getenv("CENSUS_SERVICE_ID", "example")
_WORLD      = os.getenv("EQ2_WORLD", "Varsoon")

# Slots whose adornments are excluded from the adorn check (same as character page)
_SKIP_SLOTS = frozenset({"ammo", "event slot", "mount adornment", "mount armor"})

# Canonical adorn-colour display order
_COLOUR_ORDER = ["White", "Yellow", "Red", "Blue", "Turquoise", "Green", "Orange", "Purple"]

# Spell tier order (lowest → highest)
_TIER_ORDER = ["Apprentice", "Journeyman", "Adept", "Expert", "Master", "Grandmaster"]

# Matches trailing Roman numeral suffix so we can deduplicate spell names
_ROMAN_SUFFIX = re.compile(
    r'\s+(?:XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X'
    r'|IX|VIII|VII|VI|V|IV|III|II|I)$',
    re.IGNORECASE,
)


def _base_name(name: str) -> str:
    return _ROMAN_SUFFIX.sub("", name.strip())


def _unique_highest(entries: list[SpellEntry]) -> list[SpellEntry]:
    """For each base spell name, keep only the highest-level entry."""
    best: dict[tuple, SpellEntry] = {}
    for e in entries:
        key = (_base_name(e.name), e.spell_type)
        if key not in best or e.level > best[key].level:
            best[key] = e
    return list(best.values())


# ---------------------------------------------------------------------------
# Models — roster
# ---------------------------------------------------------------------------

class GuildMemberResponse(BaseModel):
    name: str
    level: int | None = None
    cls: str | None = None
    ts_class: str | None = None
    ts_level: int | None = None
    aa_level: int | None = None
    deity: str | None = None
    rank: str | None = None
    rank_id: int | None = None


class GuildResponse(BaseModel):
    name: str
    world: str
    members: list[GuildMemberResponse]


# ---------------------------------------------------------------------------
# Models — spell check
# ---------------------------------------------------------------------------

class MemberSpellTiers(BaseModel):
    name: str
    rank: str | None = None
    tiers: dict[str, int]   # tier_name → count  (all _TIER_ORDER keys present)
    total: int


class GuildSpellCheckResponse(BaseModel):
    guild_name: str
    world: str
    tiers: list[str]        # ordered list of tier columns that have any data
    members: list[MemberSpellTiers]


# ---------------------------------------------------------------------------
# Models — adorn check
# ---------------------------------------------------------------------------

class AdornColorStats(BaseModel):
    filled: int
    total: int


class MemberAdornStats(BaseModel):
    name: str
    rank: str | None = None
    adorns: dict[str, AdornColorStats]  # colour → stats


class GuildAdornCheckResponse(BaseModel):
    guild_name: str
    world: str
    colors: list[str]       # ordered colour columns that appear in the data
    members: list[MemberAdornStats]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


async def _resolve_guild_name(client: CensusClient, name: str) -> str:
    """
    Accept either a character name (looks up their guild) or a guild name directly.
    Character lookup is tried first; if it returns nothing, `name` is used as-is.
    """
    guild_name = await client.get_character_guild_name(name, _WORLD)
    return guild_name if guild_name else name


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/guild/{character_name}", response_model=GuildResponse)
async def get_guild_for_character(character_name: str) -> GuildResponse:
    """
    Return the guild roster for the guild that *character_name* belongs to.
    Sorted by rank then level descending.  Only members with census data.
    """
    client = CensusClient(service_id=_SERVICE_ID)
    try:
        guild_name = await _resolve_guild_name(client, character_name)
        guild_data = await client.get_guild(guild_name, _WORLD)
        if not guild_data or not guild_data.members:
            raise HTTPException(status_code=404, detail=f"Guild '{guild_name}' not found on {_WORLD}.")
    finally:
        await client.close()

    members = sorted(
        guild_data.members,
        key=lambda m: (m.rank_id if m.rank_id is not None else 9999, -(m.level or 0)),
    )
    return GuildResponse(
        name=guild_data.name,
        world=guild_data.world,
        members=[
            GuildMemberResponse(
                name=m.name, level=m.level, cls=m.cls,
                ts_class=m.ts_class, ts_level=m.ts_level,
                aa_level=m.aa_level, deity=m.deity,
                rank=m.rank, rank_id=m.rank_id,
            )
            for m in members
        ],
    )


@router.get("/guild/{character_name}/spell-check", response_model=GuildSpellCheckResponse)
async def guild_spell_check(character_name: str) -> GuildSpellCheckResponse:
    """
    For every member of the guild, fetch their spell list and summarise counts
    per tier (Apprentice → Grandmaster), using the same deduplication logic
    as the /spellcheck bot command.
    Concurrent requests are rate-limited to 8 in-flight at a time.
    """
    client = CensusClient(service_id=_SERVICE_ID)
    try:
        guild_name = await _resolve_guild_name(client, character_name)
        guild_data = await client.get_guild(guild_name, _WORLD)
        if not guild_data or not guild_data.members:
            raise HTTPException(status_code=404, detail=f"Guild '{guild_name}' not found on {_WORLD}.")

        rank_by_name = {m.name: (m.rank, m.rank_id) for m in guild_data.members}
        member_names = [m.name for m in guild_data.members]

        sem = asyncio.Semaphore(8)

        async def fetch_spells(name: str):
            async with sem:
                return name, await client.get_character_spells(name, _WORLD)

        results = await asyncio.gather(*[fetch_spells(n) for n in member_names])
    finally:
        await client.close()

    out_members: list[MemberSpellTiers] = []
    tiers_with_data: set[str] = set()

    for name, spells in results:
        if spells is None:
            continue
        entries = _unique_highest(spells.entries)
        count = Counter(e.tier for e in entries)
        tiers_with_data.update(count.keys())
        rank, rank_id = rank_by_name.get(name, (None, None))
        out_members.append(MemberSpellTiers(
            name=name,
            rank=rank,
            tiers={t: count.get(t, 0) for t in _TIER_ORDER},
            total=sum(count.values()),
        ))

    out_members.sort(key=lambda m: (
        rank_by_name.get(m.name, (None, 9999))[1] if rank_by_name.get(m.name, (None, None))[1] is not None else 9999,
        m.name,
    ))

    active_tiers = [t for t in _TIER_ORDER if t in tiers_with_data]

    return GuildSpellCheckResponse(
        guild_name=guild_data.name,
        world=guild_data.world,
        tiers=active_tiers,
        members=out_members,
    )


@router.get("/guild/{character_name}/adorn-check", response_model=GuildAdornCheckResponse)
async def guild_adorn_check(character_name: str) -> GuildAdornCheckResponse:
    """
    For every member of the guild, count adornment slots by colour (filled vs total).
    Uses a single enhanced guild Census call with equipmentslot_list resolved.
    """
    client = CensusClient(service_id=_SERVICE_ID)
    try:
        guild_name = await _resolve_guild_name(client, character_name)
        rank_map, raw_members = await client.get_guild_equipment_data(guild_name, _WORLD)
        if not raw_members:
            raise HTTPException(status_code=404, detail=f"Guild '{guild_name}' not found on {_WORLD}.")
    finally:
        await client.close()

    all_colours: set[str] = set()
    out_members: list[MemberAdornStats] = []

    for m in raw_members:
        if not isinstance(m, dict):
            continue
        name = m.get("name") or m.get("displayname", "Unknown")
        raw_rank = _int((m.get("guild") or {}).get("rank"))
        rank_name = rank_map.get(raw_rank) if raw_rank is not None else None

        colour_stats: dict[str, list[int]] = {}  # colour → [filled, total]

        for slot in (m.get("equipmentslot_list") or []):
            if not isinstance(slot, dict):
                continue
            slot_display = slot.get("displayname", "").lower()
            if slot_display in _SKIP_SLOTS:
                continue
            item_data = slot.get("item")
            if not isinstance(item_data, dict):
                continue
            for adorn in (item_data.get("adornment_list") or []):
                if not isinstance(adorn, dict):
                    continue
                colour = adorn.get("color", "").capitalize()
                if not colour:
                    continue
                filled = adorn.get("id") is not None
                if colour not in colour_stats:
                    colour_stats[colour] = [0, 0]
                if filled:
                    colour_stats[colour][0] += 1
                colour_stats[colour][1] += 1
                all_colours.add(colour)

        if not colour_stats:
            continue  # skip members with no equipment data at all

        out_members.append(MemberAdornStats(
            name=name,
            rank=rank_name,
            adorns={c: AdornColorStats(filled=v[0], total=v[1]) for c, v in colour_stats.items()},
        ))

    # Sort members by rank id
    rank_id_by_name = {
        (m.get("name") or m.get("displayname", "")): _int((m.get("guild") or {}).get("rank"))
        for m in raw_members if isinstance(m, dict)
    }
    out_members.sort(key=lambda m: (
        rank_id_by_name.get(m.name, 9999) if rank_id_by_name.get(m.name) is not None else 9999,
        m.name,
    ))

    # Ordered colour columns: canonical order first, then any extras alphabetically
    ordered_colours = [c for c in _COLOUR_ORDER if c in all_colours]
    ordered_colours += sorted(c for c in all_colours if c not in _COLOUR_ORDER)

    return GuildAdornCheckResponse(
        guild_name=guild_name,
        world=_WORLD,
        colors=ordered_colours,
        members=out_members,
    )
