"""Per-guild officer gate.

Audit BE-027: 6+ sites in item_watch.py / guild_officer.py duplicate this
shape::

    user = require_user_session(request)
    if not await _officer_chars(user["id"], guild_name):
        raise HTTPException(403, "Not an officer of that guild")

The `_officer_chars` lookup itself stays in web/routes/guild.py — it's the
only place that knows the rank-list logic. This helper wraps the gate.

NOT a FastAPI Depends factory: the guild name typically comes from a path
parameter (`/guild/{guild_name}/...`) so a route-level Depends would need
a closure per-route to capture the name. An inline ``await
require_officer_of(user, guild_name)`` is cleaner.
"""

from __future__ import annotations

from fastapi import HTTPException

from web.lib.session_user import SessionUser


async def require_officer_of(user: SessionUser, guild_name: str) -> list[str]:
    """Raise 403 if ``user`` is not an officer of ``guild_name``.

    Returns the list of officer-rank characters the user holds in that guild
    (always non-empty on the success path) so the caller can use them for
    further logic (e.g. picking the lead officer for audit-log attribution).

    The ``_officer_chars`` lookup is imported lazily to dodge the
    routes→lib circular dependency.
    """
    # Lazy import: web/routes/guild.py imports from web/lib indirectly via
    # other helpers, so importing it at module load creates a cycle.
    from web.routes.guild import _officer_chars

    chars = await _officer_chars(user["id"], guild_name)
    if not chars:
        raise HTTPException(
            status_code=403,
            detail=f"You are not an officer of {guild_name!r}.",
        )
    return list(chars)
