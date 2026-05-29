"""Tests for web/lib/validation.py — pinning the regex shapes."""

from __future__ import annotations

import pytest

from web.lib.validation import (
    sanitize_world,
    validate_character_name,
    validate_guild_name,
)


@pytest.mark.parametrize("name", ["Vortex", "Sihtric", "Menludiir"])
def test_character_name_accepts_valid(name: str) -> None:
    assert validate_character_name(name) == name


@pytest.mark.parametrize("name", ["", " ", "X" * 16, "Vor:tex", "Vortex Smith", "Vortex1"])
def test_character_name_rejects_invalid(name: str) -> None:
    assert validate_character_name(name) is None


@pytest.mark.parametrize("world", ["Varsoon", "Wuoshi", "Kaladim", "Test Server"])
def test_world_accepts_valid(world: str) -> None:
    assert sanitize_world(world) == world


@pytest.mark.parametrize("world", ["", " ", "X" * 32, "/etc/passwd", "1Varsoon"])
def test_world_rejects_invalid(world: str) -> None:
    assert sanitize_world(world) is None


@pytest.mark.parametrize("name", ["Exordium", "The Spitting Cobras", "Knights-Templar"])
def test_guild_accepts_valid(name: str) -> None:
    assert validate_guild_name(name) == name


@pytest.mark.parametrize("name", ["", " ", "'BadStart", "X" * 65])
def test_guild_rejects_invalid(name: str) -> None:
    assert validate_guild_name(name) is None
