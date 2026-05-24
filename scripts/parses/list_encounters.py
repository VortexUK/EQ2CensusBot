"""
Print recent encounters from the normalized parses DB.

    uv run python scripts/parses/list_encounters.py
    uv run python scripts/parses/list_encounters.py --limit 50
    uv run python scripts/parses/list_encounters.py --zone "Antonica"
"""

from __future__ import annotations

import argparse
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
    ap.add_argument("--parses-db", type=Path, default=parses_db.DB_PATH)
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--zone", default=None)
    args = ap.parse_args()

    if not args.parses_db.exists():
        print(f"No parses DB at {args.parses_db} — run ingest first.", file=sys.stderr)
        return 1

    conn = parses_db.init_db(args.parses_db)
    try:
        rows = parses_db.recent_encounters(conn, limit=args.limit, zone=args.zone)
    finally:
        conn.close()

    if not rows:
        print("No encounters.")
        return 0

    # Header
    print(f"{'ENCID':<10} {'STARTED (UTC)':<22} {'DUR':>7}  {'DMG':>10}  {'DPS':>8}  ZONE / TITLE")
    print("-" * 100)
    for r in rows:
        print(
            f"{r['act_encid']:<10} "
            f"{_fmt_ts(r['started_at']):<22} "
            f"{_fmt_dur(r['duration_s']):>7}  "
            f"{r['total_damage']:>10,}  "
            f"{int(r['encdps']):>8,}  "
            f"{(r['zone'] or '—')[:30]:<30}  {r['title']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
