"""Tests for the guild route — caching behaviour and endpoint responses."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from census.models import GuildData, GuildMember
from web.routes.guild import GuildInfoResponse, GuildMemberResponse, GuildResponse

_SECRET = "test-secret-fixed"


@pytest.fixture
def app():
    from web.app import create_app

    return create_app(session_secret=_SECRET)


def _make_member(
    name: str = "Sihtric", cls: str = "Shadowknight", rank: str = "Officer", rank_id: int = 1
) -> GuildMemberResponse:
    return GuildMemberResponse(name=name, level=100, cls=cls, rank=rank, rank_id=rank_id)


def _make_guild_response(name: str = "Exordium") -> GuildResponse:
    return GuildResponse(
        name=name,
        world="Varsoon",
        members=[
            _make_member("Sihtric", rank="Officer", rank_id=1),
            _make_member("Menludiir", cls="Wizard", rank="Member", rank_id=2),
        ],
    )


def _make_guild_info(name: str = "Exordium") -> GuildInfoResponse:
    return GuildInfoResponse(name=name, world="Varsoon", level=300, members=42)


def _make_guild_member_model(name: str = "Sihtric") -> GuildMember:
    return GuildMember(
        name=name,
        level=100,
        cls="Shadowknight",
        ts_class=None,
        ts_level=None,
        aa_level=320,
        deity=None,
        rank="Officer",
        rank_id=1,
    )


# ---------------------------------------------------------------------------
# Roster endpoint  (GET /api/guild/{guild_name})
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_guild_roster_cache_hit(app):
    """Returns cached roster immediately without calling Census."""
    cached_roster = _make_guild_response()

    with patch("web.routes.guild.guild_cache") as mock_cache:
        mock_cache.get_stale.return_value = (cached_roster, False)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/guild/Exordium")

    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Exordium"
    assert len(data["members"]) == 2
    names = {m["name"] for m in data["members"]}
    assert "Sihtric" in names


@pytest.mark.asyncio
async def test_guild_roster_not_found(app):
    """404 when Census returns nothing for an unknown guild."""
    with (
        patch("web.routes.guild.guild_cache") as mock_cache,
        patch("web.routes.guild._fetch_and_cache_guild", new_callable=AsyncMock) as mock_fetch,
    ):
        mock_cache.get_stale.return_value = (None, False)
        mock_fetch.return_value = None

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/guild/NoSuchGuild")

    assert r.status_code == 404


@pytest.mark.asyncio
async def test_guild_roster_stale_triggers_background_refresh(app):
    """Stale cache hit returns data immediately and schedules a background refresh."""
    cached_roster = _make_guild_response()

    created_coros = []

    def _capture_task(coro):
        # Immediately close the coroutine so Python doesn't emit a "never awaited" warning.
        coro.close()
        created_coros.append(True)

    with (
        patch("web.routes.guild.guild_cache") as mock_cache,
        patch("web.routes.guild.asyncio") as mock_asyncio,
    ):
        mock_cache.get_stale.return_value = (cached_roster, True)  # stale=True
        mock_asyncio.create_task = MagicMock(side_effect=_capture_task)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/guild/Exordium")

    assert r.status_code == 200
    assert len(created_coros) == 1, "Expected exactly one background refresh task"


# ---------------------------------------------------------------------------
# Info endpoint  (GET /api/guild/{guild_name}/info)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_guild_info_cache_hit(app):
    """Returns cached guild info without calling Census."""
    cached_info = _make_guild_info()

    with patch("web.routes.guild.guild_cache") as mock_cache:
        mock_cache.get_stale.return_value = (cached_info, False)

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/guild/Exordium/info")

    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Exordium"
    assert data["world"] == "Varsoon"
    assert data["level"] == 300


@pytest.mark.asyncio
async def test_guild_info_not_found(app):
    """404 when Census returns nothing."""
    with (
        patch("web.routes.guild.guild_cache") as mock_cache,
        patch("web.routes.guild._fetch_and_cache_guild", new_callable=AsyncMock) as mock_fetch,
    ):
        mock_cache.get_stale.return_value = (None, False)
        mock_fetch.return_value = None

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/guild/NoSuchGuild/info")

    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Cache pre-warming: single fetch sets both roster and info keys
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fetch_and_cache_guild_populates_roster_and_info(app):
    """After a cache miss, _fetch_and_cache_guild sets both roster and info keys."""
    guild_data = GuildData(
        name="Exordium",
        world="Varsoon",
        members=[_make_guild_member_model()],
    )
    overviews = []
    guild_info = {
        "name": "Exordium",
        "world": "Varsoon",
        "level": 300,
        "members": 42,
        "accounts": 30,
        "achievement_count": 5,
        "dateformed": None,
        "description": None,
        "alignment": None,
        "type": None,
    }

    mock_client = AsyncMock()
    mock_client.get_guild_full = AsyncMock(return_value=(guild_data, overviews, guild_info))
    mock_client.close = AsyncMock()

    set_calls: list[tuple] = []

    def _record_set(key, value):
        set_calls.append((key, value))

    roster_response = GuildResponse(
        name="Exordium",
        world="Varsoon",
        members=[GuildMemberResponse(name="Sihtric", level=100, cls="Shadowknight")],
    )

    call_count = 0

    def _get_stale_side_effect(key):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return (None, False)  # first call → cache miss, triggers fetch
        if "roster" in key:
            return (roster_response, False)
        return (None, False)

    with (
        patch("web.routes.guild.guild_cache") as mock_cache,
        patch("web.routes.guild.character_cache"),
        patch("web.routes.guild.CensusClient", return_value=mock_client),
    ):
        mock_cache.get_stale.side_effect = _get_stale_side_effect
        mock_cache.set.side_effect = _record_set

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.get("/api/guild/Exordium")

    # Both roster and info cache keys should have been written
    written_keys = {k for k, _ in set_calls}
    assert any("roster:" in k for k in written_keys), f"Expected roster key in {written_keys}"
    assert any("info:" in k for k in written_keys), f"Expected info key in {written_keys}"
