"""Tests for parses.act_reader — read ACT-shaped SQLite."""

from __future__ import annotations

from datetime import datetime

from parses import act_reader


class TestListEncounterIds:
    def test_lists_complete_encounters(self, act_db_fake):
        assert act_reader.list_encounter_ids(act_db_fake) == ["18cf3eb9"]

    def test_skips_encounters_with_null_endtime(self, act_db_fake):
        act_db_fake.execute(
            """
            INSERT INTO encounter_table VALUES
                ('FFFFFFFF', 'in progress', '2026-05-24 14:00:00', NULL,
                 0, 0, 0, 'X', 0, 0)
            """
        )
        act_db_fake.execute("INSERT INTO combatant_table (encid, name) VALUES ('FFFFFFFF', 'X')")
        act_db_fake.commit()
        ids = act_reader.list_encounter_ids(act_db_fake)
        assert "FFFFFFFF" not in ids
        assert "18cf3eb9" in ids

    def test_skips_encounters_with_no_combatants(self, act_db_fake):
        act_db_fake.execute(
            """
            INSERT INTO encounter_table VALUES
                ('EEEEEEEE', 'empty', '2026-05-24 14:00:00', '2026-05-24 14:00:10',
                 10, 0, 0, 'X', 0, 0)
            """
        )
        act_db_fake.commit()
        ids = act_reader.list_encounter_ids(act_db_fake)
        assert "EEEEEEEE" not in ids


class TestGetEncounter:
    def test_returns_typed_encounter(self, act_db_fake):
        enc = act_reader.get_encounter(act_db_fake, "18cf3eb9")
        assert enc is not None
        assert enc.encid == "18cf3eb9"
        assert enc.title == "a krait patriarch"
        assert enc.zone == "Great Divide"
        assert enc.started_at == datetime(2026, 5, 24, 13, 51, 56)
        assert enc.duration_s == 46
        assert enc.total_damage == 502718
        assert enc.kills == 4

    def test_missing_returns_none(self, act_db_fake):
        assert act_reader.get_encounter(act_db_fake, "NOPE") is None


class TestGetCombatants:
    def test_returns_all_combatants(self, act_db_fake):
        combatants = act_reader.get_combatants(act_db_fake, "18cf3eb9")
        assert len(combatants) == 2
        names = {c.name for c in combatants}
        assert names == {"Menludiir", "a krait patriarch"}

    def test_ally_flag_parsed(self, act_db_fake):
        combatants = act_reader.get_combatants(act_db_fake, "18cf3eb9")
        menludiir = next(c for c in combatants if c.name == "Menludiir")
        mob = next(c for c in combatants if c.name == "a krait patriarch")
        assert menludiir.ally is True  # ACT's 'T'
        assert mob.ally is False  # ACT's 'F'

    def test_percent_columns_parsed(self, act_db_fake):
        combatants = act_reader.get_combatants(act_db_fake, "18cf3eb9")
        menludiir = next(c for c in combatants if c.name == "Menludiir")
        mob = next(c for c in combatants if c.name == "a krait patriarch")
        # '100%' → 100.0
        assert menludiir.damage_perc == 100.0
        assert menludiir.crit_dam_perc == 93.0
        # '--' → 0.0
        assert mob.damage_perc == 0.0
        assert mob.healed_perc == 0.0

    def test_threat_and_crit_types_preserved_raw(self, act_db_fake):
        combatants = act_reader.get_combatants(act_db_fake, "18cf3eb9")
        menludiir = next(c for c in combatants if c.name == "Menludiir")
        assert menludiir.threat_str == "+(0)20000/-(0)0"
        assert menludiir.threat_delta == 20000
        assert menludiir.crit_types == "0.8%L - 0.0%F - 0.0%M"


class TestGetDamageTypes:
    def test_returns_all_for_encounter(self, act_db_fake):
        rows = act_reader.get_damage_types(act_db_fake, "18cf3eb9")
        assert len(rows) == 3
        divine = next(r for r in rows if r.damage_type == "divine")
        assert divine.combatant_name == "Menludiir"
        assert divine.damage == 400000

    def test_filter_by_combatant_uses_combatant_column(self, act_db_fake):
        rows = act_reader.get_damage_types(act_db_fake, "18cf3eb9", "a krait patriarch")
        assert len(rows) == 1
        assert rows[0].combatant_name == "a krait patriarch"
        assert rows[0].damage_type == "physical"

    def test_grouping_column_lives_here(self, act_db_fake):
        rows = act_reader.get_damage_types(act_db_fake, "18cf3eb9", "Menludiir")
        assert all(r.grouping_label == "Group 1" for r in rows)


class TestGetAttackTypes:
    def test_filters_out_all_rollup_rows(self, act_db_fake):
        """swingtype=100 with type='All' is ACT's per-combatant rollup —
        the reader must drop it or we'd double-count."""
        rows = act_reader.get_attack_types(act_db_fake, "18cf3eb9")
        # Fixture has 5 attacktype rows total: 2 'All' rollups + 3 real abilities.
        # The reader should return only the 3 real ones.
        assert len(rows) == 3
        assert all(r.swing_type != 100 for r in rows)
        assert all(r.attack_name != "All" for r in rows)
        attack_names = {r.attack_name for r in rows}
        assert attack_names == {"Smite", "Auto-Attack", "melee"}

    def test_filter_by_combatant_uses_attacker_column(self, act_db_fake):
        rows = act_reader.get_attack_types(act_db_fake, "18cf3eb9", "Menludiir")
        assert len(rows) == 2
        assert {r.attack_name for r in rows} == {"Smite", "Auto-Attack"}

    def test_crit_perc_parsed_from_varchar(self, act_db_fake):
        rows = act_reader.get_attack_types(act_db_fake, "18cf3eb9", "Menludiir")
        smite = next(r for r in rows if r.attack_name == "Smite")
        assert smite.crit_perc == 90.0  # parsed from '90%'

    def test_typed_fields_correct(self, act_db_fake):
        rows = act_reader.get_attack_types(act_db_fake, "18cf3eb9", "Menludiir")
        smite = next(r for r in rows if r.attack_name == "Smite")
        assert smite.combatant_name == "Menludiir"
        assert smite.victim == "a krait patriarch"
        assert smite.swing_type == 1
        assert smite.damage == 400000
        assert smite.max_hit == 8000
        assert smite.resist == "divine"
