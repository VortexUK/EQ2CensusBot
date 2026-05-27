from __future__ import annotations

from web import census_refresh as cr


def test_should_refresh_respects_throttle(monkeypatch):
    cr._reset_for_test()
    monkeypatch.setattr(cr.census_health, "is_down", lambda: False)
    key = "menludiir:varsoon"
    assert cr._should_refresh(key) is True
    cr._mark_attempt(key)
    assert cr._should_refresh(key) is False  # within 15 min


def test_should_refresh_skips_when_down(monkeypatch):
    cr._reset_for_test()
    monkeypatch.setattr(cr.census_health, "is_down", lambda: True)
    assert cr._should_refresh("anykey:varsoon") is False
