# Character Item Level

**Date:** 2026-05-26
**Status:** Built

## Summary

A character's **average gear ilvl**, derived from the per-item ilvls
([2026-05-26-item-ilvl-design](2026-05-26-item-ilvl-design.md)). Shown on the
character page, frozen onto each combatant at parse-ingest time, and surfaced as
a new leaderboard column.

## Computation

`character_ilvl` = the sum of per-item ilvls across a character's **standard gear
slots**, divided by a **fixed slot denominator**.

- **Numerator:** the sum of the equipped *gear* items' ilvls. Only
  Armor/Weapon/Shield carry an ilvl, so consumables and appearance pieces
  (no `level_to_use`) contribute 0 automatically. We do **not** match by slot
  name — the parsed `EquipmentSlot.slot_name` is a Census *display* name
  ("Primary", "Left Ring", "Charm") that varies and collides, so the per-item
  ilvl is the reliable signal for "is this a gear piece".
- **Denominator is fixed at `CHARACTER_GEAR_SLOT_COUNT` = 21** (the standard gear
  slots: primary, secondary, ranged, head, chest, shoulders, forearms, hands,
  legs, feet, cloak, neck, 2×ear, 2×ring, 2×wrist, waist, 2×charm) — *not* the
  number of items present. Empty slots and appearance/0-ilvl items count as 0
  against the /21, so a character isn't "fully geared" just because the pieces
  they *do* wear are good. (`_parse_equipment` already drops ammo/event/mount.)
- **The only exception is a two-handed weapon.** It fills the primary slot while
  the off-hand is necessarily empty, so the denominator drops to **20** rather
  than penalising the unavoidable empty off-hand. Detected via any equipped
  item's `wield_style == "Two-Handed"`. (The 2H weapon's own ilvl is already
  potency-halved upstream.)
- Returns None only when no equipped item carries an ilvl at all.

Each equipped item's `(ilvl, wield_style)` is looked up in items.db
(`gear_for_ids`, read-only batch). No Census calls beyond the one the character
page already makes.

Verified against `scripts/dev/example_census_character.json` (Menludiir): **354.4**
(20 real items + 1 appearance cloak counting as 0, over 21 slots; not 2H).

## Where it lives

| Layer | Change |
|---|---|
| `census/item_level.py` | `CHARACTER_GEAR_SLOTS` + pure `character_ilvl(equipped)` |
| `census/db.py` | `gear_for_ids(ids)` read-only batch lookup → `(ilvl, wield_style)` |
| `web/routes/character.py` | `CharacterResponse.ilvl`, computed **once** in `_build_char_response` (so it's cached, and the parse snapshot gets it for free) |
| `frontend CharacterPage` | "Item Level N" line in the raid-ready box, under the check (the check itself is untouched — it stays the basic per-item grade) |
| `web/routes/guild.py` + `frontend GuildPage` | `GuildMemberResponse.ilvl`, computed batched (one items.db query for the whole roster via the shared `_ilvl_from_gear`); roster gains an **iLvl** column after AA, and the **Play Time** column is dropped |
| `parses/db.py` + `parses/models.py` | `combatants.ilvl` column + migration; `CombatantSnapshot.ilvl`; insert/update carry it |
| `web/routes/parses.py` | snapshot resolution reads `cached.ilvl` (same `getattr` path as level/guild/cls) |
| `web/routes/rankings.py` + `frontend RankingsPage` | new `iLvl` column |

## Parse snapshot

Like level/guild/class, a combatant's ilvl is **frozen at ingest** from the
website's `character_cache` (which stores the full `CharacterResponse`, ilvl
included). It's not shown on the parse detail page — it exists so that when a
parse becomes a PB it carries the gear level the character had at that kill.
Subject to the same Census recent-login limitation as the other snapshot fields
(combatants that don't resolve store NULL).

## Leaderboard column

- **Character boards (Damage/Healing):** the PB character's snapshotted ilvl.
- **Speed board (per-guild):** the **average** ilvl of the resolved player
  combatants in that kill — a "raid ilvl" for the guild's run.
- NULL/unresolved ilvls render as `—`.

## Out of scope
- Showing ilvl on the parse detail page (deliberately not shown there).
- Changing the raid-ready check logic.
