"""
Web-layer configuration — re-exports from census.config for backward compat.
All new web routes should import from here; all bot/census code from census.config.
"""
from census.config import SERVICE_ID, WORLD, SERVER_MAX_LEVEL  # noqa: F401
