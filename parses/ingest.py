"""
Top-level ingest orchestrator: read new encounters from ACT's SQLite export,
write them into our normalized `parses.db`.

Idempotent — each ACT encid is checked against `ingest_log` before insertion.
The full copy of one encounter runs in a single transaction so an interrupted
ingest leaves no half-written fights behind.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path

from parses import act_reader
from parses import db as parses_db

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class IngestStats:
    encounters_new: int = 0
    encounters_skipped: int = 0
    combatants: int = 0
    damage_types: int = 0
    attack_types: int = 0
    errors: int = 0


def ingest_once(
    act_db_path: Path = act_reader.ACT_DB_PATH,
    parses_db_path: Path = parses_db.DB_PATH,
    source_dsn: str = "eq2act",
) -> IngestStats:
    """One pass: copy any new encounters from `act_db_path` into `parses_db_path`."""
    if not act_db_path.exists():
        _log.warning("ACT export DB not present at %s; nothing to ingest.", act_db_path)
        return IngestStats()

    new = 0
    skipped = 0
    n_combatants = 0
    n_damage_types = 0
    n_attack_types = 0
    errors = 0

    parses_conn = parses_db.init_db(parses_db_path)
    act_conn = act_reader.open_act_db(act_db_path)
    try:
        encids = act_reader.list_encounter_ids(act_conn)
        for encid in encids:
            if parses_db.is_ingested(parses_conn, encid):
                skipped += 1
                continue

            enc = act_reader.get_encounter(act_conn, encid)
            if enc is None:
                # Half-written or unparseable — skip silently and try again next pass.
                continue
            combatants = act_reader.get_combatants(act_conn, encid)
            if not combatants:
                continue
            damage_types = act_reader.get_damage_types(act_conn, encid)
            attack_types = act_reader.get_attack_types(act_conn, encid)

            ingested_at = int(time.time())
            try:
                with parses_conn:
                    encounter_id = parses_db.insert_encounter(
                        parses_conn,
                        enc,
                        source_dsn=source_dsn,
                        ingested_at=ingested_at,
                    )
                    name_to_id = parses_db.insert_combatants_bulk(
                        parses_conn,
                        encounter_id,
                        combatants,
                    )
                    n_dt = parses_db.insert_damage_types_bulk(
                        parses_conn,
                        name_to_id,
                        damage_types,
                    )
                    n_at = parses_db.insert_attack_types_bulk(
                        parses_conn,
                        name_to_id,
                        attack_types,
                    )
                    parses_db.mark_ingested(
                        parses_conn,
                        encid,
                        encounter_id,
                        source_dsn=source_dsn,
                        ingested_at=ingested_at,
                    )
                new += 1
                n_combatants += len(combatants)
                n_damage_types += n_dt
                n_attack_types += n_at
                _log.info(
                    "Ingested encounter %s (%s, %d combatants).",
                    encid,
                    enc.title,
                    len(combatants),
                )
            except Exception as exc:
                errors += 1
                _log.exception("Failed to ingest encounter %s: %s", encid, exc)
    finally:
        act_conn.close()
        parses_conn.close()

    return IngestStats(
        encounters_new=new,
        encounters_skipped=skipped,
        combatants=n_combatants,
        damage_types=n_damage_types,
        attack_types=n_attack_types,
        errors=errors,
    )


def watch(
    interval_s: float = 5.0,
    act_db_path: Path = act_reader.ACT_DB_PATH,
    parses_db_path: Path = parses_db.DB_PATH,
    source_dsn: str = "eq2act",
) -> None:
    """Poll ACT's DB every `interval_s` seconds. Ctrl-C to stop."""
    _log.info(
        "Watching %s every %.1fs (writing to %s). Ctrl-C to stop.",
        act_db_path,
        interval_s,
        parses_db_path,
    )
    try:
        while True:
            stats = ingest_once(act_db_path, parses_db_path, source_dsn)
            if stats.encounters_new or stats.errors:
                _log.info("Tick: %s", stats)
            time.sleep(interval_s)
    except KeyboardInterrupt:
        _log.info("Watcher stopped by user.")
