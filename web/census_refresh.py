"""Background refresh orchestration for census-backed lookups. The ONLY place
that triggers a Census call from the web layer. Throttled (>=15 min between
attempts per entity), deduped (one in-flight per key), and skipped entirely when
Census health is down. On success: merge into census_store, update the hot
in-memory cache, and publish an SSE record event."""

from __future__ import annotations

import asyncio
import logging
import time

from census import census_store
from census.client import CensusClient
from web import census_events, census_health
from web.cache import character_cache
from web.config import SERVICE_ID as _SERVICE_ID
from web.config import WORLD as _WORLD

_log = logging.getLogger(__name__)

_THROTTLE = 900  # 15 minutes between refresh attempts per entity
_last_attempt: dict[str, float] = {}
_in_flight: set[str] = set()


def _reset_for_test() -> None:
    _last_attempt.clear()
    _in_flight.clear()


def _should_refresh(key: str) -> bool:
    if census_health.is_down():
        return False
    if key in _in_flight:
        return False
    last = _last_attempt.get(key)
    return last is None or (time.monotonic() - last) >= _THROTTLE


def _mark_attempt(key: str) -> None:
    _last_attempt[key] = time.monotonic()


def request_character_refresh(name: str) -> None:
    """Fire-and-forget a throttled background character refresh."""
    key = f"{name.lower()}:{_WORLD.lower()}"
    if not _should_refresh(key):
        return
    _mark_attempt(key)
    _in_flight.add(key)
    asyncio.create_task(_run_character_refresh(name, key))


async def _run_character_refresh(name: str, key: str) -> None:
    from web.routes.character import _build_char_response  # local: avoid import cycle

    try:
        client = CensusClient(service_id=_SERVICE_ID)
        try:
            char = await client.get_character(name, _WORLD)
        finally:
            await client.close()
        if char is None:
            return  # not found / not resolved → keep best-known
        resp = _build_char_response(char)  # CharacterResponse (pydantic)
        data = resp.model_dump()
        resolved = bool(data.get("cls") or data.get("level"))
        conn = census_store.init_db(census_store.DB_PATH)
        try:
            census_store.upsert_character(conn, name, _WORLD, data, resolved=resolved)
        finally:
            conn.close()
        if resolved:
            character_cache.set(key, resp)
            census_events.publish({"type": "character", "key": key, "data": data, "fetched_at": int(time.time())})
    except Exception as exc:
        _log.warning("[census-refresh] character %s failed: %s", name, exc)
    finally:
        _in_flight.discard(key)
