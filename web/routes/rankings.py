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

from collections import defaultdict

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


def _is_player_combatant(c: dict) -> bool:
    name = (c.get("name") or "").strip()
    return bool(c.get("ally")) and bool(name) and " " not in name and name != "Unknown"


def _build_character_board(
    kills: list[dict], *, size: str, zone: str, boss: str, metric: str
) -> tuple[list[dict], list[str]]:
    """Per-character best for Damage/Healing. Returns (rows sorted by score
    desc, sorted class list). Percentile is computed within each class."""
    field = _METRIC_FIELD.get(metric)
    if field is None:
        raise ValueError(f"Unsupported metric for character board: {metric!r}")
    best: dict[str, dict] = {}  # name.lower() -> entry
    for k in kills:
        if k["scope"] != size or k["zone"] != zone or k["title"] != boss:
            continue
        for c in k["combatants"]:
            if not _is_player_combatant(c) or not c.get("cls"):
                continue
            score = c.get(field) or 0.0
            key = c["name"].strip().lower()
            cur = best.get(key)
            if cur is None or score > cur["score"]:
                best[key] = {
                    "kind": "character",
                    "name": c["name"].strip(),
                    "guild_name": c.get("guild_name"),
                    "level": c.get("level"),
                    "cls": c["cls"],
                    "score": score,
                    "encounter_id": k["id"],
                    "size": k["player_count"],
                    "started_at": k["started_at"],
                }
    entries = list(best.values())
    by_cls: dict[str, list[dict]] = defaultdict(list)
    for e in entries:
        by_cls[e["cls"]].append(e)
    for cls_rows in by_cls.values():
        cls_rows.sort(key=lambda e: e["score"], reverse=True)
        n = len(cls_rows)
        for i, e in enumerate(cls_rows):
            e["percentile"] = _percentile(i + 1, n)
    entries.sort(key=lambda e: e["score"], reverse=True)
    return entries, sorted(by_cls.keys())


def _build_speed_board(kills: list[dict], *, size: str, zone: str, boss: str) -> list[dict]:
    """Per-guild fastest clear. Returns rows sorted by time asc with percentile."""
    best: dict[str, dict] = {}  # guild.lower() -> entry
    for k in kills:
        if k["scope"] != size or k["zone"] != zone or k["title"] != boss:
            continue
        guild = (k.get("guild_name") or "").strip()
        if not guild:
            continue
        cur = best.get(guild.lower())
        if cur is None or k["duration_s"] < cur["duration_s"]:
            best[guild.lower()] = {
                "kind": "guild",
                "guild_name": guild,
                "duration_s": k["duration_s"],
                "encounter_id": k["id"],
                "size": k["player_count"],
                "started_at": k["started_at"],
            }
    rows = sorted(best.values(), key=lambda e: e["duration_s"])
    n = len(rows)
    for i, e in enumerate(rows):
        e["percentile"] = _percentile(i + 1, n)
    return rows


def _build_filters(kills: list[dict]) -> dict:
    """Scope -> zone -> boss tree for the dropdowns, populated from the data."""
    tree: dict[str, dict[str, set]] = {"raid": defaultdict(set), "group": defaultdict(set)}
    for k in kills:
        scope = k.get("scope")
        if scope not in tree:
            continue
        tree[scope][k.get("zone") or "(unknown zone)"].add(k["title"])
    return {
        "scopes": [
            {
                "key": scope,
                "label": _SCOPE_LABELS[scope],
                "zones": [{"zone": z, "bosses": sorted(bosses)} for z, bosses in sorted(zones.items())],
            }
            for scope, zones in tree.items()
            if zones
        ]
    }
