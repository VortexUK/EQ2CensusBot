from __future__ import annotations

import os

from fastapi import APIRouter, Query
from pydantic import BaseModel

from census.client import CensusClient

router = APIRouter(tags=["characters"])

_SERVICE_ID = os.getenv("CENSUS_SERVICE_ID", "example")
_WORLD       = os.getenv("EQ2_WORLD", "Varsoon")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CharSearchResult(BaseModel):
    name: str
    cls: str | None = None
    class_id: int | None = None
    level: int | None = None
    aa_level: int | None = None
    race: str | None = None
    guild_name: str | None = None


class CharSearchResponse(BaseModel):
    results: list[CharSearchResult]
    total: int
    page: int
    per_page: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/characters/search", response_model=CharSearchResponse)
async def search_characters(
    class_id: list[int] = Query(default=[]),
    min_level: int | None = None,
    max_level: int | None = None,
    sort_by: str = "level",   # level | aa | name
    sort_dir: str = "desc",   # desc | asc
    page: int = 1,
) -> CharSearchResponse:
    """
    Search server characters with optional class and level filters.
    At least one of class_id or min_level must be provided.
    Archetype selections should be pre-expanded to leaf class IDs by the caller.
    """
    per_page = 100

    # Require at least one filter to avoid fetching the entire server population
    if not class_id and min_level is None and max_level is None:
        return CharSearchResponse(results=[], total=0, page=1, per_page=per_page)

    client = CensusClient(service_id=_SERVICE_ID)
    try:
        data = await client.search_characters(
            world=_WORLD,
            class_ids=class_id,
            min_level=min_level,
            max_level=max_level,
            sort_by=sort_by,
            sort_dir=sort_dir,
            page=page,
            per_page=per_page,
        )
    finally:
        await client.close()

    return CharSearchResponse(
        results=[CharSearchResult(**r) for r in data["results"]],
        total=data["total"],
        page=data["page"],
        per_page=per_page,
    )
