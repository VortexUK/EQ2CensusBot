"""Tests for per-server world scoping on the parses ingest and list paths.

Covers:
  * ingest with logger_server='Wuoshi' stores encounter under world='Wuoshi'
  * list endpoint (Varsoon context) excludes Wuoshi encounters
  * _resolve_parse_world maps logger_server to registry world with fallback
  * _ingest_payload_sync deduplication is world-scoped
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from parses import db as parses_db
from parses.models import Encounter
from web.routes.parses import IngestRequest, _ingest_payload_sync, _resolve_parse_world

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _minimal_payload(encid: str = "ABCD1234") -> dict:
    return {
        "logger_name": "Menludiir",
        "encounter": {
            "encid": encid,
            "title": "a krait patriarch",
            "zone": "Great Divide",
            "starttime": "2026-05-24 13:51:56",
            "endtime": "2026-05-24 13:52:42",
            "duration": 46,
            "damage": 502718,
            "encdps": 10928.65,
            "kills": 4,
            "deaths": 0,
        },
        "combatants": [
            {
                "name": "Menludiir",
                "ally": "T",
                "starttime": "2026-05-24 13:51:56",
                "endtime": "2026-05-24 13:52:43",
                "duration": 47,
                "damage": 502718,
                "damageperc": "100%",
                "kills": 4,
                "healed": 11637,
                "healedperc": "100%",
                "critheals": 1,
                "heals": 40,
                "curedispels": 0,
                "powerdrain": 0,
                "powerreplenish": 0,
                "dps": 10696.13,
                "encdps": 10928.65,
                "enchps": 252.98,
                "hits": 132,
                "crithits": 123,
                "blocked": 0,
                "misses": 0,
                "swings": 132,
                "healstaken": 11637,
                "damagetaken": 27557,
                "deaths": 0,
                "tohit": 100.0,
                "critdamperc": "93%",
                "crithealperc": "3%",
            },
        ],
    }


# ---------------------------------------------------------------------------
# _resolve_parse_world
# ---------------------------------------------------------------------------


class TestResolveParsaWorld:
    def test_known_world_from_registry(self):
        """A logger_server that matches a registry entry returns the canonical
        world name (exact case from the registry)."""
        fake_registry = {"Varsoon": object(), "Wuoshi": object()}
        with patch("web.routes.parses._server_registry_by_world", fake_registry):
            assert _resolve_parse_world("Varsoon") == "Varsoon"
            assert _resolve_parse_world("Wuoshi") == "Wuoshi"

    def test_case_insensitive_match(self):
        """'varsoon' and 'VARSOON' both resolve to the canonical casing."""
        fake_registry = {"Varsoon": object()}
        with (
            patch("web.routes.parses._server_registry_by_world", fake_registry),
            patch("web.routes.parses.current_world", return_value="Varsoon"),
        ):
            assert _resolve_parse_world("varsoon") == "Varsoon"
            assert _resolve_parse_world("VARSOON") == "Varsoon"

    def test_unknown_world_falls_back_to_current_world(self):
        """A logger_server that isn't in the registry falls back to the active
        request world (current_world())."""
        fake_registry = {"Varsoon": object()}
        with (
            patch("web.routes.parses._server_registry_by_world", fake_registry),
            patch("web.routes.parses.current_world", return_value="Varsoon"),
        ):
            assert _resolve_parse_world("UnknownServer") == "Varsoon"

    def test_none_falls_back_to_current_world(self):
        """Absent logger_server falls back to current_world()."""
        fake_registry = {"Varsoon": object()}
        with (
            patch("web.routes.parses._server_registry_by_world", fake_registry),
            patch("web.routes.parses.current_world", return_value="Varsoon"),
        ):
            assert _resolve_parse_world(None) == "Varsoon"

    def test_empty_string_falls_back_to_current_world(self):
        fake_registry = {"Varsoon": object()}
        with (
            patch("web.routes.parses._server_registry_by_world", fake_registry),
            patch("web.routes.parses.current_world", return_value="Varsoon"),
        ):
            assert _resolve_parse_world("") == "Varsoon"

    def test_invalid_shape_falls_back_to_current_world(self):
        """logger_server that fails sanitisation falls back."""
        fake_registry = {"Varsoon": object()}
        with (
            patch("web.routes.parses._server_registry_by_world", fake_registry),
            patch("web.routes.parses.current_world", return_value="Varsoon"),
        ):
            assert _resolve_parse_world("varsoon:hack") == "Varsoon"


# ---------------------------------------------------------------------------
# _ingest_payload_sync — world attribution
# ---------------------------------------------------------------------------


class TestIngestPayloadSyncWorldAttribution:
    def test_logger_server_wuoshi_stores_under_wuoshi(self, tmp_path, monkeypatch):
        """When ingest is called with world='Wuoshi', the encounter row has
        world='Wuoshi'."""
        db_file = tmp_path / "parses.db"
        monkeypatch.setattr(parses_db, "DB_PATH", db_file)
        parses_db.init_db(db_file).close()

        payload = IngestRequest(**_minimal_payload())
        status, eid, *_ = _ingest_payload_sync(payload, "Menludiir", None, "plugin:123", {}, world="Wuoshi")
        assert status == "inserted"

        conn = parses_db.init_db(db_file)
        try:
            row = conn.execute("SELECT world FROM encounters WHERE id = ?", (eid,)).fetchone()
            assert row[0] == "Wuoshi"
        finally:
            conn.close()

    def test_ingest_log_world_matches_encounter(self, tmp_path, monkeypatch):
        """ingest_log.world must match the encounter's world."""
        db_file = tmp_path / "parses.db"
        monkeypatch.setattr(parses_db, "DB_PATH", db_file)
        parses_db.init_db(db_file).close()

        payload = IngestRequest(**_minimal_payload())
        _ingest_payload_sync(payload, "Menludiir", None, "plugin:123", {}, world="Kaladim")

        conn = parses_db.init_db(db_file)
        try:
            row = conn.execute(
                "SELECT world FROM ingest_log WHERE act_encid = ?", (payload.encounter.encid,)
            ).fetchone()
            assert row[0] == "Kaladim"
        finally:
            conn.close()

    def test_same_encid_different_world_both_inserted(self, tmp_path, monkeypatch):
        """Two ingest calls with the same act_encid but different worlds must
        both succeed (no UNIQUE collision)."""
        db_file = tmp_path / "parses.db"
        monkeypatch.setattr(parses_db, "DB_PATH", db_file)
        parses_db.init_db(db_file).close()

        payload = IngestRequest(**_minimal_payload())
        status_v, eid_v, *_ = _ingest_payload_sync(payload, "Menludiir", None, "plugin:123", {}, world="Varsoon")
        status_w, eid_w, *_ = _ingest_payload_sync(payload, "Menludiir", None, "plugin:123", {}, world="Wuoshi")
        assert status_v == "inserted"
        assert status_w == "inserted"
        assert eid_v != eid_w

        conn = parses_db.init_db(db_file)
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM encounters WHERE act_encid = ?", (payload.encounter.encid,)
            ).fetchone()[0]
            assert count == 2
        finally:
            conn.close()

    def test_idempotency_is_world_scoped(self, tmp_path, monkeypatch):
        """Re-uploading the same (world, act_encid) returns 'skipped'; uploading
        the same act_encid under a DIFFERENT world is NOT skipped."""
        db_file = tmp_path / "parses.db"
        monkeypatch.setattr(parses_db, "DB_PATH", db_file)
        parses_db.init_db(db_file).close()

        payload = IngestRequest(**_minimal_payload())
        _ingest_payload_sync(payload, "Menludiir", None, "plugin:123", {}, world="Varsoon")

        # Same world → skipped.
        status2, *_ = _ingest_payload_sync(payload, "Menludiir", None, "plugin:123", {}, world="Varsoon")
        assert status2 == "skipped"

        # Different world → inserted.
        status3, *_ = _ingest_payload_sync(payload, "Menludiir", None, "plugin:123", {}, world="Wuoshi")
        assert status3 == "inserted"


# ---------------------------------------------------------------------------
# _list_encounters_sync — world scoping
# ---------------------------------------------------------------------------


class TestListEncountersSyncWorldScoping:
    def test_varsoon_list_excludes_wuoshi_encounters(self, tmp_path, monkeypatch):
        """_list_encounters_sync(world='Varsoon') must not return encounters
        stored under 'Wuoshi'."""
        db_file = tmp_path / "parses.db"
        monkeypatch.setattr(parses_db, "DB_PATH", db_file)
        parses_db.init_db(db_file).close()

        payload_v = IngestRequest(**_minimal_payload("VARSOON1"))
        payload_w = IngestRequest(**_minimal_payload("WUOSHI01"))

        _ingest_payload_sync(payload_v, "Menludiir", "Exordium", "plugin:123", {}, world="Varsoon")
        _ingest_payload_sync(payload_w, "Menludiir", "Exordium", "plugin:456", {}, world="Wuoshi")

        from web.routes.parses import _list_encounters_sync

        v_rows = _list_encounters_sync(100, None, None, world="Varsoon")
        w_rows = _list_encounters_sync(100, None, None, world="Wuoshi")

        v_encids = {r["act_encid"] for r in v_rows}
        w_encids = {r["act_encid"] for r in w_rows}
        assert "VARSOON1" in v_encids
        assert "WUOSHI01" not in v_encids
        assert "WUOSHI01" in w_encids
        assert "VARSOON1" not in w_encids
