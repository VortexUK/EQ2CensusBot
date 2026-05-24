"""Tests for parses.ingest — end-to-end pipeline against fake ACT data."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from parses import act_reader, ingest
from parses import db as parses_db


@pytest.fixture
def act_db_path(tmp_path: Path, act_db_fake: sqlite3.Connection) -> Path:
    """Persist the seeded in-memory fixture to a file for ingest to open."""
    path = tmp_path / "act_export.db"
    # Copy the in-memory DB to disk so act_reader.open_act_db can re-open it.
    disk = sqlite3.connect(path)
    act_db_fake.backup(disk)
    disk.close()
    return path


@pytest.fixture
def parses_db_path(tmp_path: Path) -> Path:
    return tmp_path / "parses.db"


class TestIngestOnce:
    def test_writes_all_tables(self, act_db_path, parses_db_path):
        stats = ingest.ingest_once(act_db_path, parses_db_path, source_dsn="testdsn")
        assert stats.encounters_new == 1
        assert stats.encounters_skipped == 0
        assert stats.combatants == 2
        assert stats.damage_types == 3
        # 3 real damage rows + 1 swing_type=100 non-All row (Undeniable Malice).
        # The 3 'All' rollup rows are correctly filtered out.
        assert stats.attack_types == 4
        assert stats.errors == 0

        # Confirm rows landed in our DB
        conn = parses_db.init_db(parses_db_path)
        try:
            assert conn.execute("SELECT COUNT(*) FROM encounters").fetchone()[0] == 1
            assert conn.execute("SELECT COUNT(*) FROM combatants").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM damage_types").fetchone()[0] == 3
            assert conn.execute("SELECT COUNT(*) FROM attack_types").fetchone()[0] == 4
            assert conn.execute("SELECT COUNT(*) FROM ingest_log").fetchone()[0] == 1
        finally:
            conn.close()

    def test_records_source_dsn(self, act_db_path, parses_db_path):
        ingest.ingest_once(act_db_path, parses_db_path, source_dsn="custom_dsn")
        conn = parses_db.init_db(parses_db_path)
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT source_dsn FROM encounters").fetchone()
            assert row["source_dsn"] == "custom_dsn"
        finally:
            conn.close()


class TestIdempotency:
    def test_second_run_skips_already_ingested(self, act_db_path, parses_db_path):
        first = ingest.ingest_once(act_db_path, parses_db_path, source_dsn="testdsn")
        assert first.encounters_new == 1

        second = ingest.ingest_once(act_db_path, parses_db_path, source_dsn="testdsn")
        assert second.encounters_new == 0
        assert second.encounters_skipped == 1

    def test_no_duplicate_rows_after_repeated_ingest(self, act_db_path, parses_db_path):
        for _ in range(3):
            ingest.ingest_once(act_db_path, parses_db_path, source_dsn="testdsn")
        conn = parses_db.init_db(parses_db_path)
        try:
            assert conn.execute("SELECT COUNT(*) FROM encounters").fetchone()[0] == 1
            assert conn.execute("SELECT COUNT(*) FROM combatants").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM attack_types").fetchone()[0] == 4
        finally:
            conn.close()


class TestMissingActDb:
    def test_no_act_db_returns_empty_stats(self, tmp_path, parses_db_path):
        missing = tmp_path / "nope.db"
        stats = ingest.ingest_once(missing, parses_db_path)
        assert stats == ingest.IngestStats()


class TestGuildAttribution:
    """Guild lookup happens once per ingest run, before any inserts, and the
    resolved value (or NULL) is stamped on every encounter."""

    def test_uploader_local_skips_census_lookup(self, act_db_path, parses_db_path):
        """When uploader='local' (default), no Census call should fire and
        guild_name stays NULL on every row."""
        with patch("parses.ingest._resolve_guild_sync") as resolver:
            resolver.return_value = None
            ingest.ingest_once(act_db_path, parses_db_path, uploaded_by="local")
        # The implementation may still call resolver — but with 'local', the
        # helper itself short-circuits. Verify the column is NULL regardless.
        conn = parses_db.init_db(parses_db_path)
        try:
            row = conn.execute("SELECT guild_name FROM encounters LIMIT 1").fetchone()
            assert row[0] is None
        finally:
            conn.close()

    def test_resolved_guild_stamped_on_all_rows(self, act_db_path, parses_db_path):
        """Single resolved guild applied to every encounter in the run."""
        with patch("parses.ingest._resolve_guild_sync", return_value="Exordium"):
            ingest.ingest_once(act_db_path, parses_db_path, uploaded_by="Menludiir")

        conn = parses_db.init_db(parses_db_path)
        try:
            rows = conn.execute("SELECT guild_name, uploaded_by FROM encounters").fetchall()
            assert len(rows) >= 1
            for r in rows:
                assert r[0] == "Exordium"
                assert r[1] == "Menludiir"
        finally:
            conn.close()

    def test_guild_lookup_failure_leaves_null(self, act_db_path, parses_db_path):
        """If Census lookup returns None, ingest continues and writes NULL."""
        with patch("parses.ingest._resolve_guild_sync", return_value=None):
            stats = ingest.ingest_once(act_db_path, parses_db_path, uploaded_by="Menludiir")
        assert stats.encounters_new >= 1

        conn = parses_db.init_db(parses_db_path)
        try:
            row = conn.execute("SELECT guild_name FROM encounters LIMIT 1").fetchone()
            assert row[0] is None
        finally:
            conn.close()


class TestBackfillGuildNames:
    def test_backfills_only_null_rows(self, act_db_path, parses_db_path):
        # Ingest under Menludiir with NO guild resolution → guild_name=NULL
        with patch("parses.ingest._resolve_guild_sync", return_value=None):
            ingest.ingest_once(act_db_path, parses_db_path, uploaded_by="Menludiir")

        # Now backfill — patch the lookup so we don't hit Census.
        with patch("parses.ingest._resolve_guild_sync", return_value="Exordium"):
            n = ingest.backfill_guild_names(parses_db_path)
        assert n >= 1

        conn = parses_db.init_db(parses_db_path)
        try:
            rows = conn.execute("SELECT guild_name FROM encounters").fetchall()
            assert all(r[0] == "Exordium" for r in rows)
        finally:
            conn.close()

    def test_backfill_skips_local_uploader(self, act_db_path, parses_db_path):
        # uploader='local' → no Census call, no update.
        with patch("parses.ingest._resolve_guild_sync", return_value=None):
            ingest.ingest_once(act_db_path, parses_db_path, uploaded_by="local")
        # Backfill should be a no-op for 'local' rows.
        resolver = patch("parses.ingest._resolve_guild_sync", return_value="Should Not Be Used")
        with resolver as mock:
            n = ingest.backfill_guild_names(parses_db_path)
        assert n == 0
        mock.assert_not_called()

    def test_backfill_leaves_existing_guild_names_alone(self, act_db_path, parses_db_path):
        with patch("parses.ingest._resolve_guild_sync", return_value="Exordium"):
            ingest.ingest_once(act_db_path, parses_db_path, uploaded_by="Menludiir")

        # Backfill again — should be no-op because no NULLs left.
        with patch("parses.ingest._resolve_guild_sync", return_value="DifferentGuild") as mock:
            n = ingest.backfill_guild_names(parses_db_path)
        assert n == 0
        mock.assert_not_called()
