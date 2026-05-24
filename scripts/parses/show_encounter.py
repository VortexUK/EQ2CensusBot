"""
Show encounter detail: combatants (sorted by damage) and each combatant's
top attack types.

    uv run python scripts/parses/show_encounter.py 1AB2C3D4    # by ACT encid
    uv run python scripts/parses/show_encounter.py --our-id 5  # by our row id
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow imports from the project root when run as a standalone script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from parses import db as parses_db


def _fmt_ts(unix_s: int) -> str:
    return datetime.fromtimestamp(unix_s, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")


def _fmt_dur(seconds: int) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m}m{s:02d}s"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("act_encid", nargs="?", help="ACT encounter id (8-char hex).")
    ap.add_argument("--our-id", type=int, default=None, help="Local encounter row id (alternative to positional).")
    ap.add_argument("--parses-db", type=Path, default=parses_db.DB_PATH)
    ap.add_argument("--top-attacks", type=int, default=10, help="Top N attacks per combatant (default: %(default)s).")
    args = ap.parse_args()

    if not args.act_encid and args.our_id is None:
        ap.error("provide either an act_encid positional arg or --our-id.")

    if not args.parses_db.exists():
        print(f"No parses DB at {args.parses_db} — run ingest first.", file=sys.stderr)
        return 1

    conn = parses_db.init_db(args.parses_db)
    try:
        conn.row_factory = sqlite3.Row
        if args.our_id is not None:
            enc = conn.execute(
                "SELECT * FROM encounters WHERE id = ?",
                (args.our_id,),
            ).fetchone()
        else:
            enc = conn.execute(
                "SELECT * FROM encounters WHERE act_encid = ?",
                (args.act_encid,),
            ).fetchone()

        if enc is None:
            print("Encounter not found.", file=sys.stderr)
            return 1

        enc = dict(enc)
        print(f"=== Encounter {enc['act_encid']} (our id={enc['id']}) ===")
        print(f"Title:    {enc['title']}")
        print(f"Zone:     {enc['zone'] or '—'}")
        print(f"Started:  {_fmt_ts(enc['started_at'])}")
        print(f"Duration: {_fmt_dur(enc['duration_s'])}")
        print(f"Damage:   {enc['total_damage']:,} ({int(enc['encdps']):,} dps)")
        print(f"K/D:      {enc['kills']}k / {enc['deaths']}d")
        print()

        combatants = parses_db.get_combatants_for_encounter(conn, enc["id"])
        if not combatants:
            print("(no combatants)")
            return 0

        print(f"{'COMBATANT':<22} {'CLASS':<14} {'DMG':>12} {'DPS':>10} {'HPS':>10} {'CRITS':>7} {'D':>3}")
        print("-" * 92)
        for c in combatants:
            print(
                f"{c['name'][:22]:<22} "
                f"{(c['eq2_class'] or '—')[:14]:<14} "
                f"{c['damage']:>12,} "
                f"{int(c['dps']):>10,} "
                f"{int(c['hps']):>10,} "
                f"{c['crits']:>7} "
                f"{c['deaths']:>3}"
            )

        print()
        for c in combatants:
            attacks = parses_db.get_top_attacks_for_combatant(conn, c["id"], limit=args.top_attacks)
            if not attacks:
                continue
            print(f"--- {c['name']} top {len(attacks)} attacks ---")
            print(f"  {'ATTACK':<32} {'DMG':>11} {'HITS':>5} {'CRIT%':>6} {'MAX':>10}")
            for a in attacks:
                print(
                    f"  {a['attack_name'][:32]:<32} "
                    f"{a['damage']:>11,} "
                    f"{a['hits']:>5} "
                    f"{a['crit_perc']:>5.1f}% "
                    f"{a['max_hit']:>10,}"
                )
            print()
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
