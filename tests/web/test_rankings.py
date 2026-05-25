from __future__ import annotations

from web.routes.rankings import _percentile, _scope_for


class TestPercentile:
    def test_best_is_100(self):
        assert _percentile(1, 4) == 100

    def test_quartiles(self):
        assert [_percentile(r, 4) for r in (1, 2, 3, 4)] == [100, 75, 50, 25]

    def test_single_entry_is_100(self):
        assert _percentile(1, 1) == 100


class TestScopeFor:
    def test_group(self):
        assert _scope_for(2) == "group" and _scope_for(6) == "group"

    def test_raid(self):
        assert _scope_for(7) == "raid" and _scope_for(24) == "raid"

    def test_individual_and_oversize_excluded(self):
        assert _scope_for(1) is None and _scope_for(0) is None


from web.routes.rankings import _build_character_board


def _kill(eid, *, zone, title, pcount, combatants):
    return {
        "id": eid,
        "title": title,
        "zone": zone,
        "guild_name": "Exordium",
        "started_at": 1700000000,
        "duration_s": 60,
        "player_count": pcount,
        "scope": "raid",
        "combatants": combatants,
    }


def _c(name, cls, encdps, *, ally=1, guild="Exordium", level=95):
    return {
        "name": name,
        "cls": cls,
        "ally": ally,
        "encdps": encdps,
        "enchps": 0.0,
        "guild_name": guild,
        "level": level,
    }


class TestCharacterBoard:
    def test_keeps_personal_best_per_character(self):
        kills = [
            _kill(1, zone="Z", title="Tarinax", pcount=24, combatants=[_c("Menludiir", "Wizard", 500.0)]),
            _kill(2, zone="Z", title="Tarinax", pcount=24, combatants=[_c("Menludiir", "Wizard", 900.0)]),
        ]
        rows, classes = _build_character_board(kills, size="raid", zone="Z", boss="Tarinax", metric="dps")
        assert len(rows) == 1
        assert rows[0]["score"] == 900.0 and rows[0]["encounter_id"] == 2
        assert classes == ["Wizard"]

    def test_percentile_within_class(self):
        kills = [
            _kill(
                1,
                zone="Z",
                title="Tarinax",
                pcount=24,
                combatants=[
                    _c("A", "Wizard", 900.0),
                    _c("B", "Wizard", 500.0),
                    _c("H", "Templar", 100.0),
                ],
            )
        ]
        rows, classes = _build_character_board(kills, size="raid", zone="Z", boss="Tarinax", metric="dps")
        pct = {r["name"]: r["percentile"] for r in rows}
        assert pct["A"] == 100 and pct["B"] == 50  # two Wizards
        assert pct["H"] == 100  # only Templar
        assert classes == ["Templar", "Wizard"]

    def test_excludes_unresolved_class_and_pets(self):
        kills = [
            _kill(
                1,
                zone="Z",
                title="Tarinax",
                pcount=24,
                combatants=[
                    _c("Menludiir", "Wizard", 900.0),
                    _c("Nopclass", None, 800.0),  # unresolved class -> excluded
                    _c("a pet thing", "Wizard", 700.0),  # multi-word -> excluded
                    _c("Enemy", "Wizard", 999.0, ally=0),  # not ally -> excluded
                ],
            )
        ]
        rows, _ = _build_character_board(kills, size="raid", zone="Z", boss="Tarinax", metric="dps")
        assert [r["name"] for r in rows] == ["Menludiir"]
