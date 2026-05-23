"""Shared pytest fixtures for the EQ2CensusBot test suite."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from web.app import create_app

_TEST_SECRET = "test-secret-for-pytest"


@pytest.fixture
def app():
    """FastAPI application instance with a fixed session secret."""
    return create_app(session_secret=_TEST_SECRET)


@pytest.fixture
def mock_census():
    """AsyncMock CensusClient that can be customised per-test."""
    client = AsyncMock()
    client.close = AsyncMock()
    return client


@pytest.fixture
def mock_guild_cache():
    """MagicMock that mimics TTLCache.get_stale / .set behaviour (cache miss by default)."""
    cache = MagicMock()
    cache.get_stale.return_value = (None, False)
    cache.set = MagicMock()
    return cache


@pytest.fixture
def mock_character_cache():
    """MagicMock that mimics TTLCache.get_stale / .set behaviour (cache miss by default)."""
    cache = MagicMock()
    cache.get_stale.return_value = (None, False)
    cache.set = MagicMock()
    return cache
