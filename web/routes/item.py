from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from census import db as item_db
from census.client import CensusClient

router = APIRouter(tags=["item"])
_SERVICE_ID = os.getenv("CENSUS_SERVICE_ID", "example")


class ItemStatResponse(BaseModel):
    display_name: str
    value: float
    stat_group: str


class EffectLineResponse(BaseModel):
    indentation: int
    text: str


class ItemEffectResponse(BaseModel):
    name: str
    trigger: str
    lines: list[EffectLineResponse]


class ItemResponse(BaseModel):
    id: str
    name: str
    quality: str
    icon_id: str | None = None
    slot_type: str = ""
    armor_type: str = ""
    mitigation: int | None = None
    item_level: int | None = None
    required_level: int | None = None
    classes: list[str] = []
    stats: list[ItemStatResponse] = []
    effects: list[ItemEffectResponse] = []
    adornment_slots: list[str] = []
    flags: list[str] = []
    extra_info: list[tuple[str, str]] = []


@router.get("/item/{item_id}", response_model=ItemResponse)
async def get_item(item_id: str) -> ItemResponse:
    """Return full item detail from the local DB."""
    try:
        iid = int(item_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Item ID must be numeric")

    db_row = await item_db.find_by_id(iid)
    if db_row is None:
        raise HTTPException(status_code=404, detail=f"Item {item_id} not found")

    client = CensusClient(service_id=_SERVICE_ID)
    try:
        item = client._parse_item(db_row)
    finally:
        await client.close()

    return ItemResponse(
        id=item.id,
        name=item.name,
        quality=item.quality,
        icon_id=item.icon_id,
        slot_type=item.slot_type,
        armor_type=item.armor_type,
        mitigation=item.mitigation,
        item_level=item.item_level,
        required_level=item.required_level,
        classes=item.classes,
        stats=[
            ItemStatResponse(
                display_name=s.display_name,
                value=s.value,
                stat_group=s.stat_group,
            )
            for s in item.stats
        ],
        effects=[
            ItemEffectResponse(
                name=e.name,
                trigger=e.trigger,
                lines=[EffectLineResponse(indentation=ln[0], text=ln[1]) for ln in e.lines],
            )
            for e in item.effects
        ],
        adornment_slots=item.adornment_slots,
        flags=item.flags,
        extra_info=item.extra_info,
    )
