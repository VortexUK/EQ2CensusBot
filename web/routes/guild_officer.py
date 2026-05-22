from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from web.db import (
    get_claim_by_id,
    list_claims,
    review_claim,
)
from web.routes.claim import _refresh_claim_cache
from web.routes.guild import _officer_chars, _roster_rank_map

router = APIRouter(tags=["guild"])


# ---------------------------------------------------------------------------
# Models — officer claim review
# ---------------------------------------------------------------------------

class GuildClaimItem(BaseModel):
    id: int
    discord_id: str
    discord_name: str
    avatar: str | None = None
    character_name: str
    requested_at: int
    is_own: bool = False   # True when this claim belongs to the requesting officer


class RejectNoteRequest(BaseModel):
    note: str | None = None


# ---------------------------------------------------------------------------
# Officer claim-review endpoints
# ---------------------------------------------------------------------------

@router.get("/guild/{guild_name}/officer-status")
async def get_officer_status(guild_name: str, request: Request) -> dict:
    """
    Return whether the current user holds an officer rank in this guild.
    Always returns 200 (unauthenticated / non-officer users get is_officer: false).
    """
    user = request.session.get("user")
    if not user:
        return {"is_officer": False}
    chars = await _officer_chars(user["id"], guild_name)
    return {"is_officer": bool(chars)}


@router.get("/guild/{guild_name}/claims", response_model=list[GuildClaimItem])
async def get_guild_claims(guild_name: str, request: Request) -> list[GuildClaimItem]:
    """
    List all pending claims for characters that are members of this guild.
    Requires the requesting user to be an officer (rank 0 or 1) of the guild.
    """
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not await _officer_chars(user["id"], guild_name):
        raise HTTPException(status_code=403, detail="Officer access required")

    rank_map = await _roster_rank_map(guild_name)
    pending  = await list_claims(status="pending")

    return [
        GuildClaimItem(
            id             = c["id"],
            discord_id     = c["discord_id"],
            discord_name   = c["discord_name"],
            avatar         = c.get("avatar"),
            character_name = c["character_name"],
            requested_at   = c["requested_at"],
            is_own         = c["discord_id"] == user["id"],
        )
        for c in pending
        if c["character_name"].lower() in rank_map
    ]


@router.post("/guild/{guild_name}/claims/{claim_id}/approve", response_model=GuildClaimItem)
async def officer_approve_claim(guild_name: str, claim_id: int, request: Request) -> GuildClaimItem:
    """Approve a pending claim.  Officers cannot approve their own claims."""
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not await _officer_chars(user["id"], guild_name):
        raise HTTPException(status_code=403, detail="Officer access required")

    claim = await get_claim_by_id(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim["discord_id"] == user["id"]:
        raise HTTPException(status_code=403, detail="You cannot approve your own claim")

    result = await review_claim(claim_id, "approved", user["id"])
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    asyncio.create_task(_refresh_claim_cache(result["discord_id"]))
    return GuildClaimItem(
        id             = result["id"],
        discord_id     = result["discord_id"],
        discord_name   = result["discord_name"],
        avatar         = result.get("avatar"),
        character_name = result["character_name"],
        requested_at   = result["requested_at"],
        is_own         = False,
    )


@router.post("/guild/{guild_name}/claims/{claim_id}/reject")
async def officer_reject_claim(
    guild_name: str,
    claim_id: int,
    body: RejectNoteRequest,
    request: Request,
) -> dict:
    """Reject a pending claim, optionally with a note.  Officers cannot reject their own claims."""
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not await _officer_chars(user["id"], guild_name):
        raise HTTPException(status_code=403, detail="Officer access required")

    claim = await get_claim_by_id(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    if claim["discord_id"] == user["id"]:
        raise HTTPException(status_code=403, detail="You cannot reject your own claim")

    result = await review_claim(claim_id, "rejected", user["id"], note=body.note)
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    asyncio.create_task(_refresh_claim_cache(result["discord_id"]))
    return {"ok": True}
