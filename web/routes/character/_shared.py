"""Shared cache-first + Census-fallback character fetch.

Audit BE-028: the same ~25-line flow appeared in get_character_spells,
get_upgrade_materials, get_upgrade_recipes. Extracted here so the three
handlers can shrink to one line.

Why not just call _build_char_response directly? Because the flow has TWO
sources — character_cache (the fast path) and Census (the cold path) —
and the response shape comes from _build_char_response which lives in
views.py. _shared.py imports from views.py lazily to avoid the circular
(views.py → _shared.py, _shared.py → views.py).

NOTE: spells.py and upgrades.py inline the cache-first fetch rather than
calling _get_or_fetch_character, so that their module-level names
(character_cache, CensusClient, etc.) remain patchable via the
``web.routes.character.spells.*`` and ``web.routes.character.upgrades.*``
namespace — required for the existing test suite.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

from web.cache import character_cache
from web.lib.census_lifecycle import shared_census_client
from web.server_context import current_world

_log = logging.getLogger(__name__)


async def _get_or_fetch_character(name: str):
    """Return a ``CharacterResponse`` for ``name`` — cached if available, else
    fetched live from Census + cached.

    Raises HTTPException(404) when Census returns no character. Raises
    HTTPException(503) when Census is unreachable.
    """
    # Lazy import — views.py imports this helper at module load.
    from web.lib.cache_keys import char_cache_key
    from web.routes.character.views import _build_char_response

    cache_key = char_cache_key(name, current_world())
    cached, _ = character_cache.get_stale(cache_key)
    if cached is not None:
        return cached

    try:
        async with shared_census_client() as client:
            char = await client.get_character(name, current_world())
    except Exception as exc:
        _log.warning("Census fetch failed for %r: %s", name, exc)
        raise HTTPException(status_code=503, detail="Census is unavailable; please retry shortly.") from exc

    if char is None:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found on {current_world()}")

    result = _build_char_response(char)
    character_cache.set(cache_key, result)
    return result
