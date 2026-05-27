from __future__ import annotations

from web import server_context as sc


def _seed(monkeypatch, tmp_path):
    from web import db

    p = tmp_path / "users.db"
    db.init_db(p)
    monkeypatch.setattr(db, "DB_PATH", p)
    sc.load_registry()
    return p


def test_resolve_known_subdomain(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    assert sc.resolve_host("wuoshi.eq2lexicon.com").world == "Wuoshi"
    assert sc.resolve_host("varsoon.eq2lexicon.com").world == "Varsoon"


def test_resolve_unknown_falls_back_to_default(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    assert sc.resolve_host("localhost:8000").world == "Varsoon"
    assert sc.resolve_host("eq2lexicon.com").world == "Varsoon"
    assert sc.resolve_host("").world == "Varsoon"


def test_current_world_default_outside_request(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    assert sc.current_world() == "Varsoon"


def test_contextvar_roundtrip(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    wuoshi = sc.resolve_host("wuoshi.eq2lexicon.com")
    token = sc.set_active_server(wuoshi)
    try:
        assert sc.current_world() == "Wuoshi"
        assert sc.current_server().display_name == "Wuoshi"
    finally:
        sc.reset_active_server(token)
    assert sc.current_world() == "Varsoon"


def test_override_ignored_when_disabled(monkeypatch, tmp_path):
    _seed(monkeypatch, tmp_path)
    # Simulate production: the X-Server/?server= override must be ignored.
    monkeypatch.setattr(sc, "_ALLOW_OVERRIDE", False)
    assert sc.resolve_host("varsoon.eq2lexicon.com", override="wuoshi").world == "Varsoon"
    # And when allowed (dev), the override wins.
    monkeypatch.setattr(sc, "_ALLOW_OVERRIDE", True)
    assert sc.resolve_host("varsoon.eq2lexicon.com", override="wuoshi").world == "Wuoshi"
