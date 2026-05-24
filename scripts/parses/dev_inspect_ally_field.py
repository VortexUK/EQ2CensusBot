"""
Diagnostic: examine the `ally` column on combatant_table across the whole
ACT export DB to see if it carries more than a T/F flag. If it does — e.g.
'T' for the logging character, some other letter for group members — we
could use it to auto-detect the logging character without needing
PARSES_UPLOADER configuration.

Run after parsing at least one group/raid fight so non-logger allies are
present in the data.

    uv run python scripts/parses/dev_inspect_ally_field.py
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
    ap.add_argument("--db", type=Path, default=ACT_DB_PATH)
    args = ap.parse_args()

    if not args.db.exists():
        print(f"ERROR: {args.db} does not exist.", file=sys.stderr)
        return 1

    uri = f"file:{args.db.as_posix()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        conn.row_factory = sqlite3.Row

        print("=== distinct values of `ally` across the whole DB ===")
        rows = conn.execute("SELECT ally, COUNT(*) AS n FROM combatant_table GROUP BY ally ORDER BY n DESC").fetchall()
        for r in rows:
            print(f"  ally={r['ally']!r:<6}  rows={r['n']}")
        print()

        print("=== distinct (ally, encid) → names — first 10 encounters ===")
        # Show for each encounter the names grouped by ally letter so we can
        # see if the logger gets a different letter from groupies.
        encids = [
            r["encid"]
            for r in conn.execute("SELECT DISTINCT encid FROM combatant_table ORDER BY encid LIMIT 10").fetchall()
        ]
        for encid in encids:
            print(f"  encounter {encid}:")
            for r in conn.execute(
                "SELECT ally, GROUP_CONCAT(name, ', ') AS names "
                "FROM combatant_table WHERE encid = ? GROUP BY ally ORDER BY ally",
                (encid,),
            ).fetchall():
                print(f"    ally={r['ally']!r:<6}  names={r['names']}")
            print()

        print("=== single-word ally combatants (likely players), by encounter ===")
        print("If only ONE single-word ally appears across all/most encounters,")
        print("that's strong evidence for the logger heuristic. If many distinct")
        print("players appear with the same ally letter, the letter alone can't")
        print("identify the logger.")
        rows = conn.execute(
            """
            SELECT name, COUNT(DISTINCT encid) AS encs_seen
            FROM combatant_table
            WHERE ally != 'F'
              AND instr(name, ' ') = 0
              AND name != ''
              AND name != 'Unknown'
            GROUP BY name
            ORDER BY encs_seen DESC
            """
        ).fetchall()
        for r in rows:
            print(f"  {r['name']:<24} appears in {r['encs_seen']} encounters")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
