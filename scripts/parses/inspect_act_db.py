"""
Diagnostic: dump schema + row counts of ACT's exported SQLite DB.

Use after configuring the SQLite ODBC DSN and triggering at least one
encounter from EQ2 — confirms ACT actually wrote rows and at the expected
depth (you should see encounter_table, combatant_table, damagetype_table,
and attacktype_table all non-empty).

    uv run python scripts/parses/inspect_act_db.py
    uv run python scripts/parses/inspect_act_db.py --db path/to/other.db
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

# Allow imports from the project root when run as a standalone script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from parses.act_reader import ACT_DB_PATH


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=ACT_DB_PATH, help="Path to ACT's export DB (default: %(default)s)")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"ERROR: {args.db} does not exist.", file=sys.stderr)
        print("Has ACT written at least one encounter? Check the ODBC DSN and 'Validate Table Setup'.", file=sys.stderr)
        return 1

    uri = f"file:{args.db.as_posix()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        tables = [
            r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        ]

        if not tables:
            print(f"{args.db} contains no tables.")
            return 1

        print(f"DB: {args.db}")
        print(f"Tables: {len(tables)}")
        print()

        for t in tables:
            print(f"=== {t} ===")
            cols = conn.execute(f"PRAGMA table_info({t})").fetchall()
            for col in cols:
                # col = (cid, name, type, notnull, dflt_value, pk)
                pk_marker = " PK" if col[5] else ""
                null_marker = " NOT NULL" if col[3] else ""
                print(f"  {col[1]:<24} {col[2]:<16}{null_marker}{pk_marker}")
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                print(f"  rows: {count}")
            except sqlite3.OperationalError as exc:
                print(f"  rows: <error: {exc}>")
            print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
