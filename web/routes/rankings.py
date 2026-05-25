"""
GET /api/rankings/filters  — the smart-dropdown tree (scopes -> zones -> bosses).
GET /api/rankings          — a ranked board for one (size, zone, boss, metric[, class]).

Computed-on-read over the existing parses tables (no separate ranking store).
Boss kills are detected with parses.boss.is_boss, mirror-grouped to their
primary upload, then ranked. Soft-deleted parses still rank (the leaderboard
ignores hidden_at); only a hard purge removes them. See
docs/superpowers/specs/2026-05-25-eq2logs-rankings-design.md.
"""

from __future__ import annotations

from fastapi import APIRouter

from web.cache import TTLCache

router = APIRouter(tags=["rankings"])

# Raid spans 12 and 24; the table's Size column shows the real count.
_SCOPES: dict[str, tuple[int, int]] = {"group": (2, 6), "raid": (7, 24)}
_SCOPE_LABELS = {"group": "Group", "raid": "Raid"}
_METRIC_FIELD = {"dps": "encdps", "hps": "enchps"}  # speed handled separately

# Short-lived cache of the expensive load+group step (boards are cheap on top).
rankings_cache: TTLCache = TTLCache(ttl=60, max_age=600, name="rankings", maxsize=4)
_KILLS_KEY = "primary_boss_kills"


def _percentile(rank: int, n: int) -> int:
    """Rank-based percentile, 1 = best. Best is always 100; n=4 -> 100/75/50/25."""
    if n <= 0:
        return 0
    return round(100 * (n - rank + 1) / n)


def _scope_for(player_count: int) -> str | None:
    for scope, (lo, hi) in _SCOPES.items():
        if lo <= player_count <= hi:
            return scope
    return None
