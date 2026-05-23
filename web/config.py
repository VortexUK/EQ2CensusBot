"""
Web-layer configuration — re-exports from census.config for backward compat.
All new web routes should import from here; all bot/census code from census.config.
"""
from census.config import (  # noqa: F401
    SERVICE_ID,
    WORLD,
    SERVER_MAX_LEVEL,
    LAUNCH_DT_ISO,
    CORS_ORIGINS,
    DISCORD_SYNC_GUILD_IDS,
)
