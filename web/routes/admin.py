from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from web.cache import claim_cache
from web.db import (
    delete_claim,
    delete_claims_for_user,
    get_claim_by_id,
    list_all_users,
    list_claims,
    review_claim,
    set_user_access,
)
from web.routes.claim import _refresh_claim_cache

router = APIRouter(tags=["admin"])

_ADMIN_IDS: frozenset[str] = frozenset(
    filter(None, os.getenv("ADMIN_DISCORD_IDS", "").split(","))
)


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _require_admin(request: Request) -> dict:
    user = request.session.get("user")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["id"] not in _ADMIN_IDS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ClaimDetail(BaseModel):
    id: int
    discord_id: str
    discord_name: str | None = None   # NULL when user row missing (LEFT JOIN)
    discord_username: str | None = None
    avatar: str | None = None
    character_name: str
    status: str
    requested_at: int
    reviewed_at: int | None = None
    reviewed_by: str | None = None
    note: str | None = None


class RejectRequest(BaseModel):
    note: str | None = None


class UserItem(BaseModel):
    discord_id:       str
    discord_name:     str | None = None
    discord_username: str | None = None
    avatar:           str | None = None
    first_seen:       int
    last_seen:        int
    access_status:    str
    claim_count:      int = 0


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/admin/claims", response_model=list[ClaimDetail])
async def list_all_claims(
    request: Request,
    status: str | None = None,
) -> list[ClaimDetail]:
    """
    List character claims, optionally filtered by status.
    Pending claims are sorted oldest-first (queue order).
    """
    _require_admin(request)
    claims = await list_claims(status=status)
    return [ClaimDetail(**c) for c in claims]


@router.post("/admin/claims/{claim_id}/approve", response_model=ClaimDetail)
async def approve_claim(claim_id: int, request: Request) -> ClaimDetail:
    """Approve a pending claim.  Supersedes any existing approved claim for the user."""
    admin = _require_admin(request)
    result = await review_claim(claim_id, "approved", admin["id"])
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim_cache.delete(f"claims:{result['discord_id']}")
    asyncio.create_task(_refresh_claim_cache(result["discord_id"]))
    return ClaimDetail(**result)


@router.delete("/admin/claims/{claim_id}", status_code=200)
async def remove_claim(claim_id: int, request: Request) -> dict:
    """Permanently delete a claim record."""
    _require_admin(request)
    claim = await get_claim_by_id(claim_id)
    if not claim:
        raise HTTPException(status_code=404, detail="Claim not found")
    await delete_claim(claim_id)
    claim_cache.delete(f"claims:{claim['discord_id']}")
    asyncio.create_task(_refresh_claim_cache(claim["discord_id"]))
    return {"ok": True}


@router.post("/admin/claims/{claim_id}/reject", response_model=ClaimDetail)
async def reject_claim(
    claim_id: int,
    body: RejectRequest,
    request: Request,
) -> ClaimDetail:
    """Reject a pending claim, optionally with a note explaining why."""
    admin = _require_admin(request)
    result = await review_claim(claim_id, "rejected", admin["id"], note=body.note)
    if not result:
        raise HTTPException(status_code=404, detail="Claim not found")
    claim_cache.delete(f"claims:{result['discord_id']}")
    asyncio.create_task(_refresh_claim_cache(result["discord_id"]))
    return ClaimDetail(**result)


@router.delete("/admin/users/{discord_id}/claims", status_code=200)
async def remove_all_user_claims(discord_id: str, request: Request) -> dict:
    """Permanently delete every claim record for a user."""
    _require_admin(request)
    count = await delete_claims_for_user(discord_id)
    claim_cache.delete(f"claims:{discord_id}")
    asyncio.create_task(_refresh_claim_cache(discord_id))
    return {"ok": True, "deleted": count}


@router.get("/admin/users", response_model=list[UserItem])
async def list_users(request: Request) -> list[UserItem]:
    """List all users with access status and claim counts. Admin only."""
    _require_admin(request)
    rows = await list_all_users()
    return [UserItem(**r) for r in rows]


@router.post("/admin/users/{discord_id}/kick", status_code=200)
async def kick_user(discord_id: str, request: Request) -> dict:
    """
    Deny a user's access and permanently delete all their claims.
    Use this to fully remove a user's presence from the system.
    Admin cannot kick themselves.
    """
    admin = _require_admin(request)
    if discord_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot kick yourself")
    if not await set_user_access(discord_id, "denied"):
        raise HTTPException(status_code=404, detail="User not found")
    count = await delete_claims_for_user(discord_id)
    claim_cache.delete(f"claims:{discord_id}")
    asyncio.create_task(_refresh_claim_cache(discord_id))
    return {"ok": True, "claims_deleted": count}
