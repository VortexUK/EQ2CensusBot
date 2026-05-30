"""
Fixtures for the parses test suite.

`parses_db_conn` provides an in-memory init_db connection.
`act_db_fake` provides an in-memory SQLite shaped like ACT's four tables,
pre-populated with one encounter, two combatants and a swingtype=100 'All'
rollup row in attacktype_table so the filter behaviour is exercised.

Schema and sample values are copied from real ACT-via-SQLite-ODBC output
(see `uv run python -c "...SELECT * FROM ..."` snapshots used during
development), so coercion edge cases (`'--'` percentages, `'T'`/`'F'` ally
flag, VARCHAR percentage columns) are realistic.

The raw SQL schema and seed data have been extracted to:
  tests/parses/fixtures/act_schema.sql  (per TEST-020 / Phase 2b.4)
  tests/parses/fixtures/act_seed.json
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

# parses_db_conn is now provided globally via tests/conftest.py
# (hoisted from here per TEST-011 / Phase 2a.2).

# ---------------------------------------------------------------------------
# Fake ACT export DB — mirrors what the SQLite ODBC driver writes.
# ---------------------------------------------------------------------------

_FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _seed_act_db(conn: sqlite3.Connection) -> None:
    """Load schema + seed rows from the JSON fixtures (TEST-020 / Phase 2b.4)."""
    schema_sql = (_FIXTURES_DIR / "act_schema.sql").read_text()
    seed_data = json.loads((_FIXTURES_DIR / "act_seed.json").read_text())
    conn.executescript(schema_sql)
    for table_name, rows in seed_data.items():
        if not rows:
            continue
        cols = ",".join(rows[0].keys())
        placeholders = ",".join("?" for _ in rows[0])
        sql = f"INSERT INTO {table_name} ({cols}) VALUES ({placeholders})"  # noqa: S608
        conn.executemany(sql, [tuple(row.values()) for row in rows])
    conn.commit()


@pytest.fixture
def act_db_fake():
    """In-memory ACT-shaped SQLite seeded with a 1-encounter / 2-combatant fixture."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _seed_act_db(conn)
    yield conn
    conn.close()
