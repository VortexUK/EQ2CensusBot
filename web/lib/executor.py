"""Single canonical wrapper around ``loop.run_in_executor``.

Audit BE-024: 55 grep hits for ``asyncio.get_event_loop()`` across web/,
each followed by ``await loop.run_in_executor(None, fn, *args)``. The
boilerplate was repeated literally — sometimes three times in 15 lines.

This module owns one helper. Phase 2c migrates every site.

Why not just ``asyncio.to_thread``? It accepts only positional args + kwargs
forwarded as kwargs — fine for new code, but the existing call sites
sometimes pass keyword args that would need re-shaping. ``run_sync`` accepts
both, so the migration is mechanical.
"""

from __future__ import annotations

import asyncio
import functools
from collections.abc import Callable
from typing import ParamSpec, TypeVar

_P = ParamSpec("_P")
_T = TypeVar("_T")


async def run_sync(fn: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs) -> _T:  # noqa: UP047
    """Run a synchronous function in the default executor.

    Replaces the ``loop = asyncio.get_running_loop(); await
    loop.run_in_executor(None, fn, *args)`` boilerplate. Both positional and
    keyword arguments are forwarded — kwargs via ``functools.partial`` since
    ``run_in_executor`` only accepts positional args.

    Example:
        result = await run_sync(parses_db.init_db)
        rows = await run_sync(parses_db.list_encounters, world="Varsoon")
    """
    loop = asyncio.get_running_loop()
    # run_in_executor only accepts positional args; functools.partial handles
    # both positional and keyword arguments cleanly.  pyright can't verify the
    # _P.args unpack into run_in_executor's *args, so we always go via partial.
    return await loop.run_in_executor(None, functools.partial(fn, *args, **kwargs))  # type: ignore[arg-type]
