"""Site-wide Census availability signal. A background loop probes Census every
5 minutes; the request/refresh paths read this (live, in-memory) state to decide
whether to attempt a refresh and what to tell the user."""

from __future__ import annotations

import asyncio
import logging
import time

import aiohttp

from web.config import SERVICE_ID as _SERVICE_ID

_log = logging.getLogger(__name__)

_POLL_INTERVAL = 300  # 5 minutes
_PROBE_URL = f"https://census.daybreakgames.com/s:{_SERVICE_ID}/json/get/eq2/"

_status: str = "unknown"  # "up" | "down" | "unknown"
_checked_at: int = 0


def _reset_for_test() -> None:
    global _status, _checked_at
    _status, _checked_at = "unknown", 0


def get_state() -> dict:
    return {"status": _status, "checked_at": _checked_at}


def is_down() -> bool:
    return _status == "down"


async def _probe_census() -> bool:
    """True if Census answers 200 within a short timeout, else False."""
    timeout = aiohttp.ClientTimeout(total=8)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as s, s.get(_PROBE_URL) as r:
            return r.status == 200
    except Exception:
        return False


async def refresh_health() -> str:
    """Probe once, update state, return the new status. Publishes an SSE health
    event on change (import is local to avoid a cycle)."""
    global _status, _checked_at
    ok = await _probe_census()
    new = "up" if ok else "down"
    changed = new != _status
    _status, _checked_at = new, int(time.time())
    if changed:
        from web import census_events

        census_events.publish({"type": "health", "status": _status, "checked_at": _checked_at})
    return _status


async def poll_loop() -> None:
    """Background task: probe now, then every 5 minutes. Never raises."""
    while True:
        try:
            await refresh_health()
        except Exception as exc:  # pragma: no cover - defensive
            _log.warning("[census-health] probe error: %s", exc)
        await asyncio.sleep(_POLL_INTERVAL)
