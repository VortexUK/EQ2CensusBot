"""
One-off diagnostic: characterise ACT's attacktype_table by swing_type and
resist column so we can map the categories ACT writes (damage / heal /
threat / cure / power / etc.).

Confirmed mappings so far from real data:
  swing_type=1                            melee auto-attack damage
  swing_type=2                            skill/spell damage
  swing_type=3                            heal events (resist='Hitpoints'
                                          for regular heals, 'Absorption'
                                          for wards)
  swing_type=100, type='All'              per-combatant rollup (filter out)
  swing_type=100, type!='All',
                  resist='Increase'       threat/buff procs (e.g. Undeniable
                                          Malice — Templar/Inquisitor)

Unknowns: cures (likely a distinct swing_type), power drain/replenish,
debuff procs. Need raid data to characterise further.

    uv run python scripts/parses/dev_inspect_swingtypes.py
    uv run python scripts/parses/dev_inspect_swingtypes.py --attacker Menludiir
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
    ap.add_argument("--attacker", default=None, help="Restrict output to one attacker (omit for whole DB).")
    args = ap.parse_args()

    if not args.db.exists():
        print(f"ERROR: {args.db} does not exist.", file=sys.stderr)
        return 1

    uri = f"file:{args.db.as_posix()}?mode=ro"
    where = "WHERE attacker = ?" if args.attacker else ""
    params: tuple = (args.attacker,) if args.attacker else ()

    with sqlite3.connect(uri, uri=True) as conn:
        conn.row_factory = sqlite3.Row

        scope = f"attacker={args.attacker!r}" if args.attacker else "WHOLE DB"
        print(f"=== (swing_type, resist) histogram — {scope} ===")
        rows = conn.execute(
            f"""
            SELECT swingtype, resist, COUNT(*) AS n,
                   SUM(damage) AS total, MAX(maxhit) AS biggest_hit,
                   GROUP_CONCAT(DISTINCT type) AS sample_types
            FROM attacktype_table
            {where}
            GROUP BY swingtype, resist
            ORDER BY swingtype, n DESC
            """,
            params,
        ).fetchall()
        for r in rows:
            sample = r["sample_types"] or ""
            if len(sample) > 60:
                sample = sample[:57] + "..."
            print(
                f"  st={r['swingtype']:<4}  resist={r['resist']!r:<14}  "
                f"rows={r['n']:<4}  total={r['total']:<10}  "
                f"sample_types={sample}"
            )
        if not rows:
            print(f"  (no rows for {scope})")
            return 0

        print()
        print(f"=== distinct (swing_type, type, resist) for swingtype=100 — {scope} ===")
        print("This is the category we previously over-filtered (threat/buff procs etc).")
        rows = conn.execute(
            f"""
            SELECT swingtype, type, resist, COUNT(*) AS n,
                   SUM(damage) AS total
            FROM attacktype_table
            {where + (" AND " if where else "WHERE ")} swingtype = 100
            GROUP BY swingtype, type, resist
            ORDER BY total DESC
            """,
            params,
        ).fetchall()
        for r in rows:
            print(f"  type={r['type']!r:<32}  resist={r['resist']!r:<14}  rows={r['n']:<4}  total={r['total']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
