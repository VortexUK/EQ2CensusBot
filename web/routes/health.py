from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from web.config import SERVER_MAX_LEVEL, WORLD

router = APIRouter(tags=["health"])

_GEAR_RATING_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "gear_rating.json"

_GEAR_RATING_DEFAULTS: dict[str, Any] = {
    "bands":            [{"label": "A", "min_below_max": 4}, {"label": "B", "min_below_max": 10}],
    "fallback_band":    "C",
    "matrix": {
        "fabled":    {"A": "A", "B": "B", "C": "E"},
        "legendary": {"A": "B", "B": "C", "C": "F"},
        "treasured": {"A": "D", "B": "E", "C": "F"},
    },
    "grade_scores":     {"A": 10, "B": 8, "C": 6, "D": 4, "E": 2, "F": 0},
    "raid_ready_min_avg": 5.5,
}


def _load_gear_rating() -> dict[str, Any]:
    try:
        raw = json.loads(_GEAR_RATING_PATH.read_text(encoding="utf-8"))
        raw.pop("_comment", None)
        return raw
    except Exception:
        return _GEAR_RATING_DEFAULTS


class HealthResponse(BaseModel):
    status: str
    version: str


class ConfigResponse(BaseModel):
    server_max_level: int
    world: str
    gear_rating: dict[str, Any]


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness check — used by Railway and uptime monitors."""
    return HealthResponse(status="ok", version="0.1.0")


@router.get("/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Public server configuration used by the frontend."""
    return ConfigResponse(
        server_max_level=SERVER_MAX_LEVEL,
        world=WORLD,
        gear_rating=_load_gear_rating(),
    )
