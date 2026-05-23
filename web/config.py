"""Centralised runtime configuration read from environment variables."""
from __future__ import annotations

import os

SERVICE_ID: str       = os.getenv("CENSUS_SERVICE_ID", "example")
WORLD: str            = os.getenv("EQ2_WORLD", "Varsoon")
SERVER_MAX_LEVEL: int = int(os.getenv("SERVER_MAX_LEVEL", "50"))
