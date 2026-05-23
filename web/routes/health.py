from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from web.config import SERVER_MAX_LEVEL, WORLD

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str


class ConfigResponse(BaseModel):
    server_max_level: int
    world: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness check — used by Railway and uptime monitors."""
    return HealthResponse(status="ok", version="0.1.0")


@router.get("/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Public server configuration used by the frontend."""
    return ConfigResponse(server_max_level=SERVER_MAX_LEVEL, world=WORLD)
