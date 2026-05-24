"""
Ingest new encounters from ACT's SQLite export into the normalized parses DB.

    uv run python scripts/parses/ingest.py                       # one shot
    uv run python scripts/parses/ingest.py --watch               # poll forever
    uv run python scripts/parses/ingest.py --watch --interval 3  # poll every 3s
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

# Allow imports from the project root when run as a standalone script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from parses import ingest
from parses.act_reader import ACT_DB_PATH
from parses.db import DB_PATH as PARSES_DB_PATH


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--act-db", type=Path, default=ACT_DB_PATH, help="ACT export DB (default: %(default)s)")
    ap.add_argument("--parses-db", type=Path, default=PARSES_DB_PATH, help="Our parses DB (default: %(default)s)")
    ap.add_argument("--source-dsn", default="eq2act", help="DSN name recorded on each row (default: %(default)s)")
    ap.add_argument(
        "--uploaded-by",
        default=None,
        help="Uploader identifier written to encounters.uploaded_by. "
        "Defaults to $PARSES_UPLOADER, or 'local' if unset.",
    )
    ap.add_argument("--watch", action="store_true", help="Poll forever instead of one-shot.")
    ap.add_argument("--interval", type=float, default=5.0, help="Poll interval in seconds (default: %(default)s).")
    ap.add_argument(
        "--backfill-guilds",
        action="store_true",
        help="One-off: resolve guild_name for existing encounters where it's NULL. "
        "Makes one Census call per distinct uploader (not per encounter). "
        "Skips uploader='local'.",
    )
    ap.add_argument("--quiet", action="store_true", help="Suppress per-encounter INFO logs.")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    if args.backfill_guilds:
        n = ingest.backfill_guild_names(parses_db_path=args.parses_db)
        print(f"Backfilled guild_name on {n} encounter row{'s' if n != 1 else ''}.")
        return 0

    if args.watch:
        ingest.watch(
            interval_s=args.interval,
            act_db_path=args.act_db,
            parses_db_path=args.parses_db,
            source_dsn=args.source_dsn,
            uploaded_by=args.uploaded_by,
        )
        return 0

    stats = ingest.ingest_once(
        act_db_path=args.act_db,
        parses_db_path=args.parses_db,
        source_dsn=args.source_dsn,
        uploaded_by=args.uploaded_by,
    )
    print(stats)
    return 1 if stats.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
