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
        assert stats.attack_types == 3
        assert stats.errors == 0

        # Confirm rows landed in our DB
        conn = parses_db.init_db(parses_db_path)
        try:
            assert conn.execute("SELECT COUNT(*) FROM encounters").fetchone()[0] == 1
            assert conn.execute("SELECT COUNT(*) FROM combatants").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM damage_types").fetchone()[0] == 3
            assert conn.execute("SELECT COUNT(*) FROM attack_types").fetchone()[0] == 3
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
            assert conn.execute("SELECT COUNT(*) FROM attack_types").fetchone()[0] == 3
        finally:
            conn.close()


class TestMissingActDb:
    def test_no_act_db_returns_empty_stats(self, tmp_path, parses_db_path):
        missing = tmp_path / "nope.db"
        stats = ingest.ingest_once(missing, parses_db_path)
        assert stats == ingest.IngestStats()
