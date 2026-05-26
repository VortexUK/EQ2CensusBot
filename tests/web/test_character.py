from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from web.app import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.mark.asyncio
async def test_character_not_found(app):
    """Census returns nothing → 404."""
    with patch("web.routes.character.CensusClient") as MockClient:
        instance = MockClient.return_value
        instance.get_character = AsyncMock(return_value=None)
        instance.close = AsyncMock()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/character/NoSuchChar")

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_character_returns_data(app):
    """Valid Census response → 200 with character fields."""
    from census.models import CharacterOverview

    fake_char = CharacterOverview(
        id="123",
        name="Vortex",
        level=70,
        cls="Wizard",
        race="High Elf",
        gender="Male",
        deity=None,
        aa_count=50,
        world="Varsoon",
        ts_class="Sage",
        ts_level=70,
        equipment=[],
    )

    with patch("web.routes.character.CensusClient") as MockClient:
        instance = MockClient.return_value
        instance.get_character = AsyncMock(return_value=fake_char)
        instance.close = AsyncMock()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/api/character/Vortex")

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Vortex"
    assert data["level"] == 70
    assert data["cls"] == "Wizard"
    assert data["aa_count"] == 50
    assert data["ts_class"] == "Sage"
    assert data["ts_level"] == 70


def test_adorn_ilvl_bonus_from_gear():
    from census.db import GearRow
    from census.item_level import adorn_bonus
    from census.models import AdornSlot
    from web.routes.character import _adorn_ilvl_bonus

    gear = {200: GearRow(ilvl=None, wield_style=None, level=90, tier_display="FABLED")}
    filled = AdornSlot(color="white", adorn_name="Adorn", adorn_id="200")
    empty = AdornSlot(color="yellow", adorn_name=None, adorn_id=None)
    assert _adorn_ilvl_bonus(filled, gear) == round(adorn_bonus(90, "FABLED"), 1)
    assert _adorn_ilvl_bonus(empty, gear) == 0.0


def test_ilvl_from_gear_folds_adorn_into_host_item():
    from census.db import GearRow
    from census.item_level import adorn_bonus
    from census.models import AdornSlot, EquipmentSlot
    from web.routes.character import _ilvl_from_gear

    gear = {
        100: GearRow(ilvl=400.0, wield_style="One-Handed", level=90, tier_display="FABLED"),
        200: GearRow(ilvl=None, wield_style=None, level=90, tier_display="FABLED"),  # adorn
    }
    equip = [
        EquipmentSlot(
            slot_name="head",
            item_name="Helm",
            item_id="100",
            adorn_slots=[AdornSlot(color="white", adorn_name="Adorn", adorn_id="200")],
        )
    ]
    # (host 400 + adorn bonus) averaged over the fixed 21-slot denominator.
    expected = round((400.0 + adorn_bonus(90, "FABLED")) / 21, 1)
    assert _ilvl_from_gear(equip, gear) == expected
