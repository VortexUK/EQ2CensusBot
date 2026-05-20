from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from census.client import CensusClient

router = APIRouter(tags=["guild"])

_SERVICE_ID = os.getenv("CENSUS_SERVICE_ID", "example")
_WORLD = os.getenv("EQ2_WORLD", "Varsoon")


# ---------------------------------------------------------------------------
# Models
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
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/guild/{character_name}", response_model=GuildResponse)
async def get_guild_for_character(character_name: str) -> GuildResponse:
    """
    Look up which guild a character belongs to, then return the full
    guild roster sorted by rank then level descending.
    Only members with census data are included (same filter as the Discord bot).
    """
    client = CensusClient(service_id=_SERVICE_ID)
    try:
        guild_name = await client.get_character_guild_name(character_name, _WORLD)
        if guild_name is None:
            raise HTTPException(
                status_code=404,
                detail=f"'{character_name}' is not in a guild or was not found on {_WORLD}.",
            )
        guild_data = await client.get_guild(guild_name, _WORLD)
        if guild_data is None or not guild_data.members:
            raise HTTPException(
                status_code=404,
                detail=f"Guild '{guild_name}' not found on {_WORLD}.",
            )
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
                name=m.name,
                level=m.level,
                cls=m.cls,
                ts_class=m.ts_class,
                ts_level=m.ts_level,
                aa_level=m.aa_level,
                deity=m.deity,
                rank=m.rank,
                rank_id=m.rank_id,
            )
            for m in members
        ],
    )
