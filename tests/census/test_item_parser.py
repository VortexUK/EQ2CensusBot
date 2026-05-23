"""Tests for census.item_parser — helper functions and parse_item smoke test."""

from __future__ import annotations

import pytest

from census.item_parser import (
    _armor_type,
    _fmt_duration,
    _slot_type,
    parse_flags,
    parse_item,
    parse_set_bonuses,
)


# ---------------------------------------------------------------------------
# _armor_type
# ---------------------------------------------------------------------------


class TestArmorType:
    def test_returns_knowledgedesc_when_present(self):
        typeinfo = {"knowledgedesc": "Plate Armor", "name": "heavy_armor", "color": "plate"}
        assert _armor_type(typeinfo) == "Plate Armor"

    def test_skips_magic_affinity_knowledgedesc(self):
        typeinfo = {
            "knowledgedesc": "Magic Affinity",
            "name": "adornment",
            "color": "white",
        }
        result = _armor_type(typeinfo)
        # Falls back to color+name combo
        assert result == "White Adornment"

    def test_returns_empty_knowledgedesc_fallback(self):
        typeinfo = {"knowledgedesc": "", "name": "adornment", "color": "red"}
        result = _armor_type(typeinfo)
        assert result == "Red Adornment"

    def test_fallback_name_only_when_no_color(self):
        typeinfo = {"knowledgedesc": "", "name": "ring", "color": ""}
        result = _armor_type(typeinfo)
        assert result == "Ring"

    def test_underscore_replaced_in_name(self):
        typeinfo = {"knowledgedesc": "", "name": "chain_armor", "color": ""}
        result = _armor_type(typeinfo)
        assert result == "Chain Armor"

    def test_empty_typeinfo(self):
        result = _armor_type({})
        assert result == ""

    def test_none_knowledgedesc(self):
        typeinfo = {"knowledgedesc": None, "name": "bracelet", "color": "yellow"}
        result = _armor_type(typeinfo)
        assert result == "Yellow Bracelet"


# ---------------------------------------------------------------------------
# _slot_type
# ---------------------------------------------------------------------------


class TestSlotType:
    def test_top_level_slot_list_takes_priority(self):
        slot_list = [{"name": "Head"}]
        typeinfo = {"slot_list": [{"displayname": "Finger"}]}
        assert _slot_type(slot_list, typeinfo) == "Head"

    def test_falls_back_to_typeinfo_slot_list(self):
        slot_list = []
        typeinfo = {"slot_list": [{"displayname": "Finger"}]}
        assert _slot_type(slot_list, typeinfo) == "Finger"

    def test_empty_both(self):
        assert _slot_type([], {}) == ""

    def test_typeinfo_slot_list_not_dict_returns_empty(self):
        slot_list = []
        typeinfo = {"slot_list": ["not a dict"]}
        assert _slot_type(slot_list, typeinfo) == ""

    def test_slot_list_missing_name_key(self):
        slot_list = [{"displayname": "Chest"}]  # no "name" key
        assert _slot_type(slot_list, {}) == ""


# ---------------------------------------------------------------------------
# _fmt_duration
# ---------------------------------------------------------------------------


class TestFmtDuration:
    def test_seconds_only(self):
        assert _fmt_duration(30) == "30 sec"

    def test_exactly_one_minute(self):
        assert _fmt_duration(60) == "1 min"

    def test_minutes_only(self):
        assert _fmt_duration(300) == "5 min"

    def test_exactly_one_hour(self):
        assert _fmt_duration(3600) == "1 hr"

    def test_multiple_hours(self):
        assert _fmt_duration(7200) == "2 hr"

    def test_fractional_seconds(self):
        result = _fmt_duration(45.5)
        assert "45.5" in result or "45" in result  # format may vary slightly

    def test_fractional_minutes(self):
        result = _fmt_duration(90)
        assert "1.5" in result or "90" in result  # 90 sec → "1.5 min"

    def test_zero_seconds(self):
        result = _fmt_duration(0)
        assert "0" in result


# ---------------------------------------------------------------------------
# parse_flags
# ---------------------------------------------------------------------------


class TestParseFlags:
    def test_single_flag_set(self):
        flags = {"notrade": {"value": 1}}
        result = parse_flags(flags)
        assert "NO-TRADE" in result

    def test_multiple_flags(self):
        flags = {
            "heirloom": {"value": 1},
            "lore": {"value": 1},
            "notrade": {"value": 0},
        }
        result = parse_flags(flags)
        assert "HEIRLOOM" in result
        assert "LORE" in result
        assert "NO-TRADE" not in result

    def test_unrecognised_flag_skipped(self):
        flags = {"unknown_flag": {"value": 1}}
        result = parse_flags(flags)
        assert result == []

    def test_empty_flags(self):
        assert parse_flags({}) == []

    def test_prestige_flag(self):
        flags = {"prestige": {"value": 1}}
        assert "PRESTIGE" in parse_flags(flags)

    def test_relic_flag(self):
        flags = {"relic": {"value": 1}}
        assert "RELIC" in parse_flags(flags)

    def test_plain_int_value(self):
        # Non-dict value: plain 1
        flags = {"lore": 1}
        result = parse_flags(flags)
        assert "LORE" in result


# ---------------------------------------------------------------------------
# parse_set_bonuses
# ---------------------------------------------------------------------------


class TestParseSetBonuses:
    def test_empty_list(self):
        assert parse_set_bonuses({}) == []

    def test_skips_bonuses_without_effect(self):
        item = {"setbonus_list": [{"requireditems": 2, "effect": ""}]}
        assert parse_set_bonuses(item) == []

    def test_parses_single_bonus(self):
        item = {
            "setbonus_list": [
                {
                    "requireditems": 3,
                    "effect": "Applies Focus: Smite",
                    "descriptiontag_1": "+100 potency",
                }
            ]
        }
        result = parse_set_bonuses(item)
        assert len(result) == 1
        assert result[0].required_items == 3
        assert result[0].effect == "Applies Focus: Smite"
        assert "+100 potency" in result[0].lines

    def test_sorted_by_required_items(self):
        item = {
            "setbonus_list": [
                {"requireditems": 5, "effect": "Five piece"},
                {"requireditems": 2, "effect": "Two piece"},
                {"requireditems": 3, "effect": "Three piece"},
            ]
        }
        result = parse_set_bonuses(item)
        assert [e.required_items for e in result] == [2, 3, 5]

    def test_multiple_description_tags(self):
        item = {
            "setbonus_list": [
                {
                    "requireditems": 2,
                    "effect": "Some effect",
                    "descriptiontag_1": "Line one",
                    "descriptiontag_2": "Line two",
                    "descriptiontag_3": "Line three",
                }
            ]
        }
        result = parse_set_bonuses(item)
        assert result[0].lines == ["Line one", "Line two", "Line three"]

    def test_empty_description_tags_skipped(self):
        item = {
            "setbonus_list": [
                {
                    "requireditems": 2,
                    "effect": "Effect",
                    "descriptiontag_1": "Real line",
                    "descriptiontag_2": "  ",  # whitespace only → stripped and skipped
                    "descriptiontag_3": "Another line",
                }
            ]
        }
        result = parse_set_bonuses(item)
        # Whitespace-only tags are skipped
        assert "  " not in result[0].lines


# ---------------------------------------------------------------------------
# parse_item — smoke test
# ---------------------------------------------------------------------------


class TestParseItem:
    def _minimal_item(self):
        return {
            "id": "99999",
            "displayname": "Faded Hood",
            "tier": "FABLED",
            "iconid": "1234",
            "typeinfo": {
                "knowledgedesc": "Cloth Armor",
                "classes": {"wizard": {"displayname": "Wizard", "level": 90}},
            },
            "slot_list": [{"name": "Head"}],
            "flags": {},
            "modifiers": {},
            "effect_list": [],
            "adornment_list": [],
            "adornmentslot_list": [],
            "setbonus_list": [],
        }

    def test_returns_item_data(self):
        from census.models import ItemData

        item = parse_item(self._minimal_item())
        assert isinstance(item, ItemData)

    def test_name(self):
        item = parse_item(self._minimal_item())
        assert item.name == "Faded Hood"

    def test_id(self):
        item = parse_item(self._minimal_item())
        assert item.id == "99999"

    def test_quality_lowercased(self):
        item = parse_item(self._minimal_item())
        assert item.quality == "fabled"

    def test_slot_type(self):
        item = parse_item(self._minimal_item())
        assert item.slot_type == "Head"

    def test_armor_type(self):
        item = parse_item(self._minimal_item())
        assert item.armor_type == "Cloth Armor"

    def test_classes(self):
        item = parse_item(self._minimal_item())
        assert "Wizard" in item.classes

    def test_no_stats_for_empty_modifiers(self):
        item = parse_item(self._minimal_item())
        assert item.stats == []

    def test_no_effects_for_empty_effect_list(self):
        item = parse_item(self._minimal_item())
        assert item.effects == []

    def test_no_flags_for_empty_flags(self):
        item = parse_item(self._minimal_item())
        assert item.flags == []
