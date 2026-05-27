# Standalone Spell Timers — Design

**Date:** 2026-05-27
**Status:** Design approved, pending implementation plan

## Problem

On a raid boss page, ACT **spell timers** are only ever surfaced as children of an
**ACT trigger** (a trigger with `timer=true` + `timer_name` pointing at a timer).
But in ACT a spell timer can stand on its own — it starts when ACT detects the
named skill/combat-art in the combat log (ACT's native `<SpellTimers>` matching),
with no custom trigger involved. There's currently no way to author or export
those standalone timers.

## Key finding (from the codebase)

The data model already supports standalone timers — only the UI and the export
filter assume the trigger-linked case:

- `census/raids_db.py` `act_spell_timers` is keyed `UNIQUE(raid_encounter_id, name_lower)`
  with **no foreign key to triggers**. A timer row exists independently; a trigger
  merely *references* it loosely by name (`act_triggers.timer_name`). A timer that
  no trigger references is already a valid "standalone" row.
- `web/routes/act_triggers.py` already exposes full CRUD for timers:
  `GET/POST/PUT/DELETE /api/zones/{zone}/encounters/{position}/spell-timers`.
- **Gap 1 — export:** the boss-level `export.xml` (`export_all_triggers`) emits only
  `_spell_timers_referenced_by(triggers, spells)` — standalone timers are filtered
  out, so they never reach ACT.
- **Gap 2 — UI:** `frontend/src/components/ActTriggers.tsx` renders timers only
  nested under their trigger; there is no section to see/create/edit a timer that
  isn't tied to a trigger.

In ACT, a `<Spell Name="X" Timer="N">` auto-starts when ACT detects ability "X" —
so the timer's **`Name` is the skill/combat-art it fires off**. No new field is
needed to record "what triggers it".

## Goal

Let editors author and export **standalone spell timers** (not linked to any ACT
trigger) on a raid boss, managed in their own section, and include them in the
ACT XML export so ACT picks them up via native name-matching.

## Approved decisions

| Decision | Choice |
|---|---|
| Trigger model for a standalone timer | The timer's **`Name` is the ability ACT detects** — no new field, no skill-picker. A standalone timer is an `act_spell_timers` row no trigger references. |
| Schema change | **None.** Reuse the existing `act_spell_timers` table + CRUD endpoints. |
| Export | **One combined** boss-level `export.xml` that includes **all** the encounter's spell timers (trigger-linked + standalone) in `<SpellTimers>`. Per-trigger export unchanged. |
| Spell Timers section contents | Lists **all** timers for the encounter, each badged **"used by N trigger(s)"** or **"standalone"** — the one place to manage every timer. |
| Per-server scoping | None — raids data (zones/encounters/triggers/timers) stays **global reference data**, as today. |

## Architecture

### Backend — `web/routes/act_triggers.py`

Single behavioural change: in `export_all_triggers` (the boss-level
`…/triggers/export.xml`), stop filtering the timers. Today:

```python
used_spells = _spell_timers_referenced_by(triggers, spells)
xml = _build_xml(triggers, used_spells)
```

becomes: pass **all** of the encounter's spell timers, so `<SpellTimers>` carries
both linked and standalone timers:

```python
xml = _build_xml(triggers, spells)   # spells = every act_spell_timers row for the encounter
```

`_spell_timers_referenced_by` is retained only where the **single-trigger** export
(`export_trigger`, `…/{id}/export.xml`) needs the one timer that trigger
references — that endpoint is unchanged. `_build_xml`, `_spell_to_xml`,
`_trigger_to_xml`, and the CRUD endpoints are unchanged. (The `act_spell_timers`
UNIQUE on `(encounter, name_lower)` already guarantees no duplicate `<Spell>`
entries.)

### Frontend — `frontend/src/components/ActTriggers.tsx`

1. **Extract the timer sub-form.** The timer fields already live inside
   `TriggerEditor` (the bit that co-creates a timer when `timer_name` is set).
   Extract that into a reusable `SpellTimerEditor` (name, duration, colour, the
   ACT `<Spell>` attributes) so both the trigger editor and the new section share
   one form — no duplicated field logic.
2. **New "Spell Timers" section** rendered on the boss page below the ACT Triggers
   section, using the `spellTimers` + `triggers` arrays the component already
   fetches:
   - One row per timer: name, duration, key attributes.
   - A badge derived client-side: count triggers whose `timer_name` (case-insensitive)
     equals this timer's name → **"used by N trigger(s)"**; zero → **"standalone"**.
   - **Create / edit / delete** via the existing `POST/PUT/DELETE /spell-timers`
     endpoints, using the extracted `SpellTimerEditor`. A "New spell timer" action
     creates a standalone timer.
   - Edit controls gated by the same `contributor`/admin check (`require_editor`)
     the trigger UI uses; read-only for everyone else.
3. **Existing trigger UI unchanged** — triggers still show their linked-timer badge,
   the trigger editor still co-creates/links a timer by name. The new section is
   purely additive (the canonical place to manage all timers, especially standalone
   ones).

### Data flow

Unchanged endpoints. The section reuses already-loaded data; the "used by" count is
computed on the client. After a create/edit/delete the component re-fetches
`spell-timers` (and `triggers`) as it does today. The boss `export.xml` download now
contains standalone timers automatically.

## Edge cases

| Situation | Behaviour |
|---|---|
| Timer referenced by ≥1 trigger | Badged "used by N"; editable in the section; still exported (as today). |
| Timer referenced by no trigger | Badged "standalone"; now editable in the section AND included in the boss export. |
| Delete a timer a trigger still references | Allowed; the trigger keeps today's "referenced but not defined" warning (unchanged). |
| Create a standalone timer whose name later matches a trigger's `timer_name` | They link by name automatically (existing convention) — the badge flips to "used by N". |
| Duplicate timer name in one encounter | Prevented by the existing `UNIQUE(raid_encounter_id, name_lower)` (POST returns 409 as today). |

## Out of scope

- Any schema change, new column, or new table.
- A skill/combat-art picker or validating timer names against a known ability list.
- Changing the trigger↔timer name-link mechanism.
- Per-server scoping of raids data.
- A separate spell-timers-only XML export (combined export only).

## Testing

- **Backend:** boss-level `export.xml` includes a standalone (unreferenced) timer in
  `<SpellTimers>`; a trigger-linked timer still appears; the per-trigger
  `…/{id}/export.xml` is unchanged (only its referenced timer). Existing
  trigger/spell-timer CRUD tests stay green.
- **Frontend:** the Spell Timers section lists all timers with correct
  "used by N" / "standalone" badges; create/edit/delete a standalone timer works
  and re-fetches; edit controls hidden for non-editors; `tsc` + `vite build` green.

## Rollout

Additive + backwards-compatible. No migration. Existing triggers and their linked
timers are unaffected; standalone timers (which could already exist as orphaned rows)
simply become visible/editable and start appearing in the export.
