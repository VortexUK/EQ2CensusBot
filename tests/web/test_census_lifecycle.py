"""Tests for the shared CensusClient lifecycle (web/lib/census_lifecycle)."""

from __future__ import annotations

import asyncio
from collections.abc import Generator

import pytest

from web.lib import census_lifecycle


@pytest.fixture(autouse=True)
def _reset() -> Generator[None]:
    census_lifecycle._reset_for_test()
    yield
    census_lifecycle._reset_for_test()


@pytest.mark.asyncio
async def test_get_shared_returns_same_instance_within_loop() -> None:
    c1 = await census_lifecycle.get_shared_census_client()
    c2 = await census_lifecycle.get_shared_census_client()
    assert c1 is c2


@pytest.mark.asyncio
async def test_context_manager_yields_shared() -> None:
    flat = await census_lifecycle.get_shared_census_client()
    async with census_lifecycle.shared_census_client() as ctx:
        assert ctx is flat


@pytest.mark.asyncio
async def test_aclose_all_clears_map() -> None:
    await census_lifecycle.get_shared_census_client()
    await census_lifecycle.aclose_all()
    assert census_lifecycle._clients == {}


def test_per_loop_isolation() -> None:
    """Two different event loops get two different singletons. Bound to id(loop)
    so the second loop's call doesn't reuse the first loop's aiohttp session."""

    async def _get() -> int:
        return id(await census_lifecycle.get_shared_census_client())

    loop1 = asyncio.new_event_loop()
    loop2 = asyncio.new_event_loop()
    try:
        c1_id = loop1.run_until_complete(_get())
        c2_id = loop2.run_until_complete(_get())
        assert c1_id != c2_id
    finally:
        loop1.close()
        loop2.close()
