"""Tests for census.item_level — the ilvl formula and tier banding."""

from __future__ import annotations

import pytest

from census.item_level import (
    GEAR_TYPES,
    ILVL_POTENCY_K,
    compute_ilvl,
    tier_band,
)


@pytest.mark.parametrize(
    "tier_string,expected",
    [
        ("COMMON", 1),
        ("UNCOMMON", 2),
        ("HANDCRAFTED", 2),
        ("TREASURED", 3),
        ("MASTERCRAFTED", 4),
        ("LEGENDARY", 4),
        ("FABLED", 5),
        ("CELESTIAL", 6),
        ("MYTHICAL", 6),
        ("ETHEREAL", 6),
        # Compound strings take the strongest keyword.
        ("MASTERCRAFTED LEGENDARY", 4),
        ("MASTERCRAFTED FABLED", 5),
        ("MASTERCRAFTED MYTHICAL", 6),
        ("MASTERCRAFTED CELESTIAL", 6),
        # Case-insensitive; mixed case from the live parser.
        ("Fabled", 5),
        # Unknown / empty -> band 1.
        ("", 1),
        (None, 1),
        ("Glowing", 1),
    ],
)
def test_tier_band(tier_string, expected):
    assert tier_band(tier_string) == expected


def test_uncommon_substring_does_not_demote_to_common():
    # "uncommon" contains "common"; max() must still pick 2.
    assert tier_band("UNCOMMON") == 2


def test_non_gear_has_no_ilvl():
    assert compute_ilvl(100, "FABLED", 0.0, "Spell Scroll") is None
    assert compute_ilvl(100, "FABLED", 0.0, "House Item") is None
    assert compute_ilvl(100, "FABLED", 0.0, None) is None


def test_gear_types_membership():
    assert GEAR_TYPES == {"Armor", "Weapon", "Shield"}


def test_missing_level_has_no_ilvl():
    assert compute_ilvl(None, "FABLED", 0.0, "Armor") is None
    assert compute_ilvl(0, "FABLED", 0.0, "Armor") is None


def test_no_potency_returns_base():
    # Fabled (tier 5), level 100: SCALE(100) * (100^2/100^2=1) * 5 * (1+0) = 500.
    assert compute_ilvl(100, "FABLED", 0.0, "Armor") == 500.0


def test_potency_is_a_bonus_not_a_gate():
    # An item with no potency still ranks; potency only adds on top.
    base = compute_ilvl(100, "FABLED", 0.0, "Weapon")
    boosted = compute_ilvl(100, "FABLED", ILVL_POTENCY_K, "Weapon")  # +100%
    assert base == 500.0
    assert boosted == pytest.approx(1000.0)


@pytest.mark.parametrize(
    "level,tier,potency,expected",
    [
        (50, "TREASURED", 0.0, 75.0),  # 100 * 0.25 * 3 * 1
        (100, "FABLED", 0.0, 500.0),
        (100, "FABLED", 480.0, 740.0),  # 500 * 1.48
        (100, "FABLED", 3578.0, 2289.0),  # 500 * 4.578
        (120, "CELESTIAL", 3578.0, 3955.4),  # 100*1.44*6*4.578
    ],
)
def test_worked_examples(level, tier, potency, expected):
    assert compute_ilvl(level, tier, potency, "Armor") == expected
