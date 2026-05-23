"""
Centralised runtime configuration read from environment variables.

All Census API consumers (web routes, bot cogs, scripts) should import
SERVICE_ID and WORLD from here rather than calling os.getenv directly,
so there is a single place to change defaults and environment variable names.

load_dotenv() is called here so that scripts don't need to worry about import
order — importing this module is sufficient to get .env values.
"""
from __future__ import annotations

import os

try:
    from dotenv import load_dotenv
    load_dotenv()          # no-op if env vars already set; safe to call multiple times
except ImportError:
    pass                   # dotenv not installed (e.g. Railway production) — fine

SERVICE_ID: str       = os.getenv("CENSUS_SERVICE_ID", "example")
WORLD: str            = os.getenv("EQ2_WORLD", "Varsoon")
SERVER_MAX_LEVEL: int = int(os.getenv("SERVER_MAX_LEVEL", "50"))
