from __future__ import annotations

import aiosqlite
from fastapi import APIRouter
from pydantic import BaseModel

from census.client import CensusClient
from web.config import SERVICE_ID as _SERVICE_ID, WORLD as _WORLD
from web.db import DB_PATH

router = APIRouter(tags=["characters"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CharNameResult(BaseModel):
    name:       str
    cls:        str | None = None
    level:      int | None = None
    guild_name: str | None = None


class CharSearchResponse(BaseModel):
    results: list[CharNameResult]
    total:   int
    source:  str = "census"   # "census" | "local"


# ---------------------------------------------------------------------------
# Local fallback — claimed characters whose name starts with the query
# ---------------------------------------------------------------------------

async def _local_search(q: str) -> list[CharNameResult]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT DISTINCT character_name
            FROM character_claims
            WHERE LOWER(character_name) LIKE ?
              AND status IN ('approved', 'pending')
            ORDER BY character_name
            LIMIT 50
            """,
            (f"{q.lower()}%",),
        ) as cur:
            rows = await cur.fetchall()
    return [CharNameResult(name=r["character_name"]) for r in rows]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/characters/search", response_model=CharSearchResponse)
async def search_characters(name: str = "") -> CharSearchResponse:
    """
    Search characters by name prefix.
    Queries the Census API for all characters on the configured world whose
    name starts with *name*.  Falls back to locally-registered claimed
    characters if Census is unavailable.
    Requires at least 2 characters.
    """
    q = name.strip()
    if len(q) < 2:
        return CharSearchResponse(results=[], total=0)
    if len(q) > 64:
        return CharSearchResponse(results=[], total=0)

    client = CensusClient(service_id=_SERVICE_ID)
    try:
        raw = await client.search_characters_by_name(q, _WORLD)

        if not raw:
            # Prefix search missed — try exact-name lookup (handles cases like "Exobroker"
            # where the prefix index doesn't return results for a complete name)
            try:
                brief = await client.get_character_brief(q, _WORLD)
                if brief:
                    raw = [brief]
            except Exception:
                pass
    except Exception:
        raw = []
    finally:
        await client.close()

    if raw:
        results = [CharNameResult(**r) for r in raw]
        return CharSearchResponse(results=results, total=len(results), source="census")

    # Census returned nothing or failed — fall back to local claims
    results = await _local_search(q)
    return CharSearchResponse(results=results, total=len(results), source="local")
