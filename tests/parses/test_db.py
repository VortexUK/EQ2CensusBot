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
        # Just a couple of representative ones; full set is enforced by init_db
        assert "idx_encounters_started_desc" in indexes
        assert "idx_attack_types_damage_desc" in indexes

    def test_migrations_idempotent(self, parses_db_conn):
        # Calling init_db again on the SAME path should be safe. We can't share
        # a :memory: DB across calls, so prove idempotency by re-running the
        # CREATE / migration SQL on the existing connection directly.
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
        encid="1A2B3C4D",
        title="a goblin grunt",
        zone="Antonica",
        started_at=datetime(2026, 5, 24, 12, 0, 0),
        ended_at=datetime(2026, 5, 24, 12, 0, 30),
        duration_s=30,
        total_damage=12500,
        encdps=416.66,
        kills=1,
        deaths=0,
    )


def _sample_combatants(encid: str) -> list[Combatant]:
    return [
        Combatant(
            encid=encid,
            name="Sihtric",
            eq2_class="Wizard",
            role="DPS",
            duration_s=30,
            damage=8000,
            dps=266.6,
            encdps=266.6,
            hps=0.0,
            healed=0,
            crits=5,
            max_hit=1500,
            kills=1,
            deaths=0,
            grouping_label="Group 1",
        ),
        Combatant(
            encid=encid,
            name="Menludiir",
            eq2_class="Templar",
            role="Healer",
            duration_s=30,
            damage=4500,
            dps=150.0,
            encdps=150.0,
            hps=200.0,
            healed=6000,
            crits=1,
            max_hit=700,
            kills=0,
            deaths=0,
            grouping_label="Group 1",
        ),
    ]


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
        name_to_id = parses_db.insert_combatants_bulk(parses_db_conn, eid, _sample_combatants(enc.encid))
        assert set(name_to_id) == {"Sihtric", "Menludiir"}

        damage_types = [
            DamageType(
                encid=enc.encid,
                combatant_name="Sihtric",
                damage_type="magic",
                damage=7500,
                swings=30,
                hits=28,
                misses=2,
            ),
        ]
        n = parses_db.insert_damage_types_bulk(parses_db_conn, name_to_id, damage_types)
        assert n == 1

        attacks = [
            AttackType(
                encid=enc.encid,
                combatant_name="Sihtric",
                attack_name="Ice Comet",
                swings=8,
                hits=8,
                misses=0,
                blocked=0,
                crit_hits=3,
                damage=6000,
                max_hit=1500,
                min_hit=200,
                average=750.0,
                median=700.0,
                dps=200.0,
                char_dps=200.0,
                enc_dps=200.0,
                duration_s=30,
                average_delay=3.75,
                to_hit=100.0,
                crit_perc=37.5,
                resist=None,
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
        parses_db.insert_combatants_bulk(parses_db_conn, eid, _sample_combatants(enc.encid))
        with pytest.raises(sqlite3.IntegrityError):
            parses_db.insert_combatants_bulk(parses_db_conn, eid, _sample_combatants(enc.encid))


class TestLookupHelpers:
    def test_recent_encounters_orders_by_started_desc(self, parses_db_conn):
        e1 = _sample_encounter()
        e2 = Encounter(
            encid="2B3C4D5E",
            title="a goblin shaman",
            zone="Antonica",
            started_at=datetime(2026, 5, 24, 12, 5, 0),
            ended_at=datetime(2026, 5, 24, 12, 5, 30),
            duration_s=30,
            total_damage=20000,
            encdps=666.66,
            kills=1,
            deaths=0,
        )
        parses_db.insert_encounter(parses_db_conn, e1, source_dsn="eq2act", ingested_at=1)
        parses_db.insert_encounter(parses_db_conn, e2, source_dsn="eq2act", ingested_at=2)
        rows = parses_db.recent_encounters(parses_db_conn, limit=10)
        assert [r["act_encid"] for r in rows] == ["2B3C4D5E", "1A2B3C4D"]

    def test_recent_encounters_zone_filter(self, parses_db_conn):
        e1 = _sample_encounter()
        e2 = Encounter(
            encid="2B3C4D5E",
            title="b",
            zone="Commonlands",
            started_at=datetime(2026, 5, 24, 13, 0, 0),
            ended_at=datetime(2026, 5, 24, 13, 0, 30),
            duration_s=30,
            total_damage=1,
            encdps=1,
            kills=0,
            deaths=0,
        )
        parses_db.insert_encounter(parses_db_conn, e1, source_dsn="eq2act", ingested_at=1)
        parses_db.insert_encounter(parses_db_conn, e2, source_dsn="eq2act", ingested_at=2)
        rows = parses_db.recent_encounters(parses_db_conn, zone="Antonica")
        assert [r["act_encid"] for r in rows] == ["1A2B3C4D"]

    def test_find_encounter_by_act_encid(self, parses_db_conn):
        parses_db.insert_encounter(
            parses_db_conn,
            _sample_encounter(),
            source_dsn="eq2act",
            ingested_at=1700000000,
        )
        row = parses_db.find_encounter_by_act_encid(parses_db_conn, "1A2B3C4D")
        assert row is not None
        assert row["title"] == "a goblin grunt"

    def test_find_encounter_missing_returns_none(self, parses_db_conn):
        assert parses_db.find_encounter_by_act_encid(parses_db_conn, "NOPE") is None
