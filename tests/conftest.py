"""Shared pytest fixtures for the EQ2 Lexicon test suite.

Test isolation note
-------------------
Both ``web.db.DB_PATH`` and ``parses.db.DB_PATH`` are evaluated at module
import time. To stop the test suite from touching the developer's real
``data/users.db`` / ``data/parses/parses.db`` (the production files), we
redirect both via env vars **before** any ``web.*`` import below.

The tmp dir is wiped at the start of every pytest session, so tests start
from an empty DB every run. Per-test isolation is then up to individual
fixtures / mocks — most tests already mock the DB-touching calls outright.

BE-096: env vars are set inside ``pytest_configure`` (a plugin-ordered hook
that runs after plugin discovery, before test collection) to avoid a race
with plugins that import ``web.app`` during discovery.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Module-level: path resolution and temp-dir wipe.
# Must happen before pytest_configure so _TEST_DB_DIR is available
# as a module-level constant (imported by some test modules directly).
# ---------------------------------------------------------------------------

_TEST_DB_DIR = Path(tempfile.gettempdir()) / "eq2lexicon-pytest"
if _TEST_DB_DIR.exists():
    shutil.rmtree(_TEST_DB_DIR, ignore_errors=True)
_TEST_DB_DIR.mkdir(parents=True)


def pytest_configure(config: pytest.Config) -> None:  # noqa: ARG001
    """Plugin-ordered env var setup. Runs after plugin discovery, before
    test collection — guarantees web.app sees the right DB_*_PATH values.

    BE-096: moved from module-level os.environ calls to avoid a race with
    pytest plugins (e.g. pytest-asyncio) that may import web.app during
    plugin discovery."""
    os.environ["DB_USERS_PATH"] = str(_TEST_DB_DIR / "users.db")
    os.environ["DB_PARSES_PATH"] = str(_TEST_DB_DIR / "parses.db")
    os.environ["DB_CENSUS_PATH"] = str(_TEST_DB_DIR / "census.db")

    # web.app reads SESSION_SECRET at module-import time and raises if it's
    # unset or shorter than 32 chars. CI and fresh contributor checkouts have
    # no .env, so provide a throwaway value here (setdefault leaves a real
    # local SESSION_SECRET untouched). Must be >= 32 chars to pass the check.
    os.environ.setdefault("SESSION_SECRET", "pytest-session-secret-not-real-0123456789")

    # Force non-Secure session cookies for the test suite. HTTPS_ONLY defaults
    # to "true" (Secure flag), but the test client always talks http://, so a
    # Secure cookie would never be sent back — the OAuth-callback test would
    # lose its CSRF state and 400. Forced (not setdefault) so a contributor
    # with HTTPS_ONLY=true in their env still gets a working test run.
    os.environ["HTTPS_ONLY"] = "false"

    # Imports below this line read the env vars above when they evaluate their
    # module-level constants (DB_PATH, SESSION_SECRET, ...).
    from parses import db as parses_db
    from web import db as users_db

    # Create both schemas immediately. FastAPI's startup hooks (which would
    # normally call init_db) don't fire under ASGITransport, so without this
    # step API-token / parses tests would hit a missing-table OperationalError
    # the first time they read from the DB.
    users_db.init_db()
    parses_db.init_db()


from unittest.mock import AsyncMock, MagicMock  # noqa: E402

_TEST_SECRET = "test-secret-for-pytest"


@pytest.fixture
def app():
    """FastAPI application instance with a fixed session secret."""
    from web.app import create_app

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
