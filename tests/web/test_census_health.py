from __future__ import annotations

import pytest

from web import census_health as ch


def test_initial_state_is_unknown_up():
    ch._reset_for_test()
    s = ch.get_state()
    assert s["status"] in ("up", "unknown")
    assert "checked_at" in s


@pytest.mark.asyncio
async def test_probe_marks_up_on_200(monkeypatch):
    ch._reset_for_test()

    async def fake_probe() -> bool:
        return True

    monkeypatch.setattr(ch, "_probe_census", fake_probe)
    await ch.refresh_health()
    assert ch.get_state()["status"] == "up"


@pytest.mark.asyncio
async def test_probe_marks_down_on_failure(monkeypatch):
    ch._reset_for_test()

    async def fake_probe() -> bool:
        return False

    monkeypatch.setattr(ch, "_probe_census", fake_probe)
    await ch.refresh_health()
    assert ch.get_state()["status"] == "down"
    assert ch.is_down() is True
