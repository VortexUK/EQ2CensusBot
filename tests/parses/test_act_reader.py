"""Tests for parses.act_reader — read ACT-shaped SQLite."""

from __future__ import annotations

from datetime import datetime

from parses import act_reader


class TestListEncounterIds:
    def test_lists_complete_encounters(self, act_db_fake):
        assert act_reader.list_encounter_ids(act_db_fake) == ["1A2B3C4D"]

    def test_skips_encounters_with_null_endtime(self, act_db_fake):
        act_db_fake.execute(
            """
            INSERT INTO encounter_table VALUES
                ('FFFFFFFF', 'in progress', 'X',
                 '2026-05-24 13:00:00', NULL,
                 0, 0, 0, 0, 0)
            """
        )
        act_db_fake.execute("INSERT INTO combatant_table (encid, name) VALUES ('FFFFFFFF', 'X')")
        act_db_fake.commit()
        ids = act_reader.list_encounter_ids(act_db_fake)
        assert "FFFFFFFF" not in ids
        assert "1A2B3C4D" in ids

    def test_skips_encounters_with_no_combatants(self, act_db_fake):
        act_db_fake.execute(
            """
            INSERT INTO encounter_table VALUES
                ('EEEEEEEE', 'empty', 'X',
                 '2026-05-24 13:00:00', '2026-05-24 13:00:10',
                 10, 0, 0, 0, 0)
            """
        )
        act_db_fake.commit()
        ids = act_reader.list_encounter_ids(act_db_fake)
        assert "EEEEEEEE" not in ids


class TestGetEncounter:
    def test_returns_typed_encounter(self, act_db_fake):
        enc = act_reader.get_encounter(act_db_fake, "1A2B3C4D")
        assert enc is not None
        assert enc.encid == "1A2B3C4D"
        assert enc.title == "a goblin grunt"
        assert enc.zone == "Antonica"
        assert enc.started_at == datetime(2026, 5, 24, 12, 0, 0)
        assert enc.duration_s == 30
        assert enc.total_damage == 12500
        assert enc.kills == 1

    def test_missing_returns_none(self, act_db_fake):
        assert act_reader.get_encounter(act_db_fake, "NOPE") is None


class TestGetCombatants:
    def test_aliases_class_column(self, act_db_fake):
        combatants = act_reader.get_combatants(act_db_fake, "1A2B3C4D")
        assert len(combatants) == 2
        sihtric = next(c for c in combatants if c.name == "Sihtric")
        # The reader must alias ACT's `class` column to the dataclass field `eq2_class`
        assert sihtric.eq2_class == "Wizard"
        assert sihtric.role == "DPS"
        assert sihtric.damage == 8000

    def test_aliases_grouping_column(self, act_db_fake):
        combatants = act_reader.get_combatants(act_db_fake, "1A2B3C4D")
        sihtric = next(c for c in combatants if c.name == "Sihtric")
        assert sihtric.grouping_label == "Group 1"


class TestGetDamageTypes:
    def test_returns_all_for_encounter(self, act_db_fake):
        rows = act_reader.get_damage_types(act_db_fake, "1A2B3C4D")
        assert len(rows) == 3
        magic = next(r for r in rows if r.damage_type == "magic")
        assert magic.combatant_name == "Sihtric"
        assert magic.damage == 7500

    def test_filter_by_combatant(self, act_db_fake):
        rows = act_reader.get_damage_types(act_db_fake, "1A2B3C4D", "Menludiir")
        assert len(rows) == 1
        assert rows[0].combatant_name == "Menludiir"


class TestGetAttackTypes:
    def test_returns_all_for_encounter(self, act_db_fake):
        rows = act_reader.get_attack_types(act_db_fake, "1A2B3C4D")
        assert len(rows) == 3
        ice_comet = next(r for r in rows if r.attack_name == "Ice Comet")
        assert ice_comet.combatant_name == "Sihtric"
        assert ice_comet.swings == 8
        assert ice_comet.crit_hits == 3
        assert ice_comet.damage == 6000
        assert ice_comet.max_hit == 1500
        assert ice_comet.crit_perc == 37.5

    def test_filter_by_combatant(self, act_db_fake):
        rows = act_reader.get_attack_types(act_db_fake, "1A2B3C4D", "Menludiir")
        assert len(rows) == 1
        assert rows[0].attack_name == "Smite"
