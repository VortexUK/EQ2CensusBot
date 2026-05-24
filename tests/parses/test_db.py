"""Tests for parses.db — schema, migrations, helpers."""

from __future__ import annotations

import sqlite3
from datetime import datetime

import pytest

from parses import db as parses_db
from parses.models import AttackType, Combatant, DamageType, Encounter


class TestInitDb:
    def test_creates_all_tables(self, parses_db_conn):
        tables = {r[0] for r in parses_db_conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert tables >= {"encounters", "combatants", "damage_types", "attack_types", "ingest_log"}

    def test_creates_indexes(self, parses_db_conn):
        indexes = {r[0] for r in parses_db_conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
        assert "idx_encounters_started_desc" in indexes
        assert "idx_attack_types_damage_desc" in indexes
        assert "idx_combatants_ally" in indexes

    def test_migrations_idempotent(self, parses_db_conn):
        # Re-running every CREATE / migration on the same connection should be safe.
        for stmt in (
            parses_db._CREATE_ENCOUNTERS,
            parses_db._CREATE_COMBATANTS,
            parses_db._CREATE_DAMAGE_TYPES,
            parses_db._CREATE_ATTACK_TYPES,
            parses_db._CREATE_INGEST_LOG,
        ):
            parses_db_conn.execute(stmt)
        for idx in parses_db._CREATE_INDEXES:
            parses_db_conn.execute(idx)


def _sample_encounter() -> Encounter:
    return Encounter(
        encid="18cf3eb9",
        title="a krait patriarch",
        zone="Great Divide",
        started_at=datetime(2026, 5, 24, 13, 51, 56),
        ended_at=datetime(2026, 5, 24, 13, 52, 42),
        duration_s=46,
        total_damage=502718,
        encdps=10928.65,
        kills=4,
        deaths=0,
    )


def _sample_combatant(name: str, *, ally: bool, damage: int) -> Combatant:
    return Combatant(
        encid="18cf3eb9",
        name=name,
        ally=ally,
        started_at=datetime(2026, 5, 24, 13, 51, 56),
        ended_at=datetime(2026, 5, 24, 13, 52, 42),
        duration_s=46,
        damage=damage,
        damage_perc=100.0 if ally else 0.0,
        kills=4 if ally else 0,
        healed=11637 if ally else 0,
        healed_perc=100.0 if ally else 0.0,
        crit_heals=1,
        heals=40,
        cure_dispels=0,
        power_drain=0,
        power_replenish=0,
        dps=10696.13,
        encdps=10928.65,
        enchps=252.98,
        hits=132,
        crit_hits=123,
        blocked=0,
        misses=0,
        swings=132,
        heals_taken=11637,
        damage_taken=27557 if ally else 145877,
        deaths=0 if ally else 1,
        to_hit=100.0,
        crit_dam_perc=93.0,
        crit_heal_perc=3.0,
        crit_types="0.8%L - 0.0%F - 0.0%M",
        threat_str="+(0)20000/-(0)0",
        threat_delta=20000,
    )


class TestInsertHelpers:
    def test_insert_encounter_returns_id(self, parses_db_conn):
        eid = parses_db.insert_encounter(
            parses_db_conn,
            _sample_encounter(),
            source_dsn="eq2act",
            ingested_at=1700000000,
        )
        assert eid >= 1

    def test_full_ingest_chain(self, parses_db_conn):
        enc = _sample_encounter()
        eid = parses_db.insert_encounter(
            parses_db_conn,
            enc,
            source_dsn="eq2act",
            ingested_at=1700000000,
        )
        combatants = [
            _sample_combatant("Menludiir", ally=True, damage=502718),
            _sample_combatant("a krait patriarch", ally=False, damage=5716),
        ]
        name_to_id = parses_db.insert_combatants_bulk(parses_db_conn, eid, combatants)
        assert set(name_to_id) == {"Menludiir", "a krait patriarch"}

        damage_types = [
            DamageType(
                encid=enc.encid,
                combatant_name="Menludiir",
                grouping_label="Group 1",
                damage_type="divine",
                started_at=datetime(2026, 5, 24, 13, 51, 56),
                ended_at=datetime(2026, 5, 24, 13, 52, 42),
                duration_s=46,
                damage=400000,
                encdps=8000.0,
                char_dps=8000.0,
                dps=8500.0,
                average=3030.0,
                median=3000,
                min_hit=100,
                max_hit=8000,
                hits=100,
                crit_hits=90,
                blocked=0,
                misses=0,
                swings=100,
                to_hit=100.0,
                average_delay=0.47,
                crit_perc=90.0,
                crit_types="0.8%L - 0.0%F - 0.0%M",
            ),
        ]
        n = parses_db.insert_damage_types_bulk(parses_db_conn, name_to_id, damage_types)
        assert n == 1

        attacks = [
            AttackType(
                encid=enc.encid,
                combatant_name="Menludiir",
                victim="a krait patriarch",
                swing_type=1,
                attack_name="Smite",
                started_at=datetime(2026, 5, 24, 13, 51, 56),
                ended_at=datetime(2026, 5, 24, 13, 52, 42),
                duration_s=46,
                damage=400000,
                encdps=8000.0,
                char_dps=8500.0,
                dps=8500.0,
                average=4000.0,
                median=3500,
                min_hit=100,
                max_hit=8000,
                resist="divine",
                hits=100,
                crit_hits=90,
                blocked=0,
                misses=0,
                swings=100,
                to_hit=100.0,
                average_delay=0.47,
                crit_perc=90.0,
                crit_types="0.8%L - 0.0%F - 0.0%M",
            ),
        ]
        n = parses_db.insert_attack_types_bulk(parses_db_conn, name_to_id, attacks)
        assert n == 1

        parses_db.mark_ingested(
            parses_db_conn,
            enc.encid,
            eid,
            source_dsn="eq2act",
            ingested_at=1700000000,
        )
        assert parses_db.is_ingested(parses_db_conn, enc.encid)
        assert not parses_db.is_ingested(parses_db_conn, "NOTREAL")


class TestUniqueConstraints:
    def test_duplicate_act_encid_rejected(self, parses_db_conn):
        parses_db.insert_encounter(
            parses_db_conn,
            _sample_encounter(),
            source_dsn="eq2act",
            ingested_at=1700000000,
        )
        with pytest.raises(sqlite3.IntegrityError):
            parses_db.insert_encounter(
                parses_db_conn,
                _sample_encounter(),
                source_dsn="eq2act",
                ingested_at=1700000001,
            )

    def test_duplicate_combatant_in_encounter_rejected(self, parses_db_conn):
        enc = _sample_encounter()
        eid = parses_db.insert_encounter(
            parses_db_conn,
            enc,
            source_dsn="eq2act",
            ingested_at=1700000000,
        )
        cs = [_sample_combatant("Menludiir", ally=True, damage=1)]
        parses_db.insert_combatants_bulk(parses_db_conn, eid, cs)
        with pytest.raises(sqlite3.IntegrityError):
            parses_db.insert_combatants_bulk(parses_db_conn, eid, cs)


class TestLookupHelpers:
    def test_recent_encounters_orders_by_started_desc(self, parses_db_conn):
        e1 = _sample_encounter()
        e2 = Encounter(
            encid="2B3C4D5E",
            title="a goblin shaman",
            zone="Antonica",
            started_at=datetime(2026, 5, 24, 14, 5, 0),
            ended_at=datetime(2026, 5, 24, 14, 5, 30),
            duration_s=30,
            total_damage=20000,
            encdps=666.66,
            kills=1,
            deaths=0,
        )
        parses_db.insert_encounter(parses_db_conn, e1, source_dsn="eq2act", ingested_at=1)
        parses_db.insert_encounter(parses_db_conn, e2, source_dsn="eq2act", ingested_at=2)
        rows = parses_db.recent_encounters(parses_db_conn, limit=10)
        assert [r["act_encid"] for r in rows] == ["2B3C4D5E", "18cf3eb9"]

    def test_recent_encounters_zone_filter(self, parses_db_conn):
        e1 = _sample_encounter()
        e2 = Encounter(
            encid="2B3C4D5E",
            title="b",
            zone="Commonlands",
            started_at=datetime(2026, 5, 24, 15, 0, 0),
            ended_at=datetime(2026, 5, 24, 15, 0, 30),
            duration_s=30,
            total_damage=1,
            encdps=1,
            kills=0,
            deaths=0,
        )
        parses_db.insert_encounter(parses_db_conn, e1, source_dsn="eq2act", ingested_at=1)
        parses_db.insert_encounter(parses_db_conn, e2, source_dsn="eq2act", ingested_at=2)
        rows = parses_db.recent_encounters(parses_db_conn, zone="Great Divide")
        assert [r["act_encid"] for r in rows] == ["18cf3eb9"]

    def test_find_encounter_by_act_encid(self, parses_db_conn):
        parses_db.insert_encounter(
            parses_db_conn,
            _sample_encounter(),
            source_dsn="eq2act",
            ingested_at=1700000000,
        )
        row = parses_db.find_encounter_by_act_encid(parses_db_conn, "18cf3eb9")
        assert row is not None
        assert row["title"] == "a krait patriarch"

    def test_find_encounter_missing_returns_none(self, parses_db_conn):
        assert parses_db.find_encounter_by_act_encid(parses_db_conn, "NOPE") is None
