"""Item level ("ilvl") — a single WoW-style power number for wearable gear.

Single source of the ilvl formula. Pure and dependency-free so it can be reused
by the item parser (live tooltip), the DB upsert path (materialised column), and
the backfill script, all guaranteeing the same result.

    ilvl = SCALE * (L^2 / REF^2) * Tier * (1 + Potency / K)

See docs/superpowers/specs/2026-05-26-item-ilvl-design.md for the rationale.
"""

from __future__ import annotations

# Item types that count as "wearable gear". All three carry an equip slot;
# adornments live under a different type, so this set excludes them for free.
GEAR_TYPES = frozenset({"Armor", "Weapon", "Shield"})

# Fixed reference level. Deliberately a constant (not the server max level) so an
# item's ilvl never re-bases when the level cap rises.
ILVL_REF = 100.0
# Display scale — lands ilvls in a readable range.
ILVL_SCALE = 100.0
# Potency dampening: turns potency's ~1000x raw range into a ~1-5x contribution.
ILVL_POTENCY_K = 1000.0

# Quality keyword -> band (1-6). A tier string maps to the band of the strongest
# keyword it contains, so compound strings ("Mastercrafted Legendary") resolve
# to their highest quality.
_TIER_KEYWORD_BANDS: tuple[tuple[str, int], ...] = (
    ("common", 1),
    ("uncommon", 2),
    ("handcrafted", 2),
    ("treasured", 3),
    ("mastercrafted", 4),
    ("legendary", 4),
    ("fabled", 5),
    ("celestial", 6),
    ("mythical", 6),
    ("ethereal", 6),
)


def tier_band(tier_display: str | None) -> int:
    """Map a tier/quality string to its 1-6 band.

    Takes the strongest keyword present, so "Mastercrafted Celestial" -> 6 and
    "Mastercrafted Legendary" -> 4. (The "common" substring inside "uncommon" is
    harmless: max() picks 2.) Unknown/empty -> 1.
    """
    if not tier_display:
        return 1
    s = tier_display.lower()
    bands = [band for keyword, band in _TIER_KEYWORD_BANDS if keyword in s]
    return max(bands) if bands else 1


def compute_ilvl(
    level_to_use: int | None,
    tier_display: str | None,
    potency: float,
    item_type: str | None,
) -> float | None:
    """Return the item level for a piece of wearable gear, or None if out of scope.

    None when the item is not gear (type not in GEAR_TYPES) or has no equip level
    (heritage/appearance pieces) — both render as "no ilvl" rather than a
    misleading 0.
    """
    if item_type not in GEAR_TYPES:
        return None
    if not level_to_use or level_to_use <= 0:
        return None
    tier = tier_band(tier_display)
    base = ILVL_SCALE * (level_to_use**2 / ILVL_REF**2) * tier
    bonus = 1.0 + (potency or 0.0) / ILVL_POTENCY_K
    return round(base * bonus, 1)
