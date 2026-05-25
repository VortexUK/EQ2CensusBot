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
