"""Tests for the editable raid-roster helpers added to zones_db."""

from __future__ import annotations

import sqlite3

from census import zones_db


def _seed_legacy_zone(path) -> tuple[int, int]:
    """Build a minimal zones.db with one zone + one comma-joined encounter
    (two mobs at positions 0 + 1). Returns (zone_id, encounter_id)."""
    conn = zones_db.init_db(path)
    try:
        conn.execute(
            "INSERT INTO zones (name, name_lower, expansion_short, expansion_name, "
            "expansion_confidence, expansion_source) "
            "VALUES ('Shard of Hate', 'shard of hate', 'RoK', 'Rise of Kunark', 'test', 'test')"
        )
        zone_id = conn.execute("SELECT id FROM zones WHERE name = 'Shard of Hate'").fetchone()[0]
        conn.execute(
            "INSERT INTO zone_encounters (zone_id, encounter_name, position) VALUES (?, 'Ire, Malevolence', 3)",
            (zone_id,),
        )
        enc_id = conn.execute(
            "SELECT id FROM zone_encounters WHERE zone_id = ? AND position = 3", (zone_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO zone_encounter_mobs (encounter_id, mob_name, mob_name_lower, position) "
            "VALUES (?, 'Ire', 'ire', 0)",
            (enc_id,),
        )
        conn.execute(
            "INSERT INTO zone_encounter_mobs (encounter_id, mob_name, mob_name_lower, position) "
            "VALUES (?, 'Malevolence', 'malevolence', 1)",
            (enc_id,),
        )
        conn.commit()
        return zone_id, enc_id
    finally:
        conn.close()


def test_init_db_normalizes_comma_joined_encounter_name(tmp_path):
    """A legacy encounter whose name is the comma-joined mob list is rewritten
    to the position-0 mob's name. Non-comma names are left alone. Idempotent."""
    p = tmp_path / "zones.db"
    zone_id, enc_id = _seed_legacy_zone(p)
    # Add a non-comma encounter that should NOT be touched.
    with sqlite3.connect(p) as conn:
        conn.execute(
            "INSERT INTO zone_encounters (zone_id, encounter_name, position) VALUES (?, 'Demetrius Crane', 1)",
            (zone_id,),
        )
        enc_id2 = conn.execute(
            "SELECT id FROM zone_encounters WHERE zone_id = ? AND position = 1", (zone_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO zone_encounter_mobs (encounter_id, mob_name, mob_name_lower, position) "
            "VALUES (?, 'Demetrius Crane', 'demetrius crane', 0)",
            (enc_id2,),
        )
        conn.commit()

    # Re-init to trigger normalization (init_db is idempotent).
    conn = zones_db.init_db(p)
    try:
        rows = {r[0]: r[1] for r in conn.execute("SELECT id, encounter_name FROM zone_encounters")}
        assert rows[enc_id] == "Ire"  # comma-joined collapsed to primary
        assert rows[enc_id2] == "Demetrius Crane"  # untouched
    finally:
        conn.close()

    # Second run is a no-op (encounter_name no longer contains a comma).
    conn = zones_db.init_db(p)
    try:
        assert conn.execute("SELECT encounter_name FROM zone_encounters WHERE id = ?", (enc_id,)).fetchone()[0] == "Ire"
    finally:
        conn.close()
