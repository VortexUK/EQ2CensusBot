# Standalone Spell Timers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let editors author/manage raid spell timers that aren't tied to an ACT trigger (they fire off the named skill/combat-art via ACT's native matching), and include them in the boss's ACT XML export.

**Architecture:** No schema change — a "standalone" timer is an existing `act_spell_timers` row no trigger references; its `Name` is the ability ACT detects. Two changes only: the boss-level `export.xml` stops filtering timers to trigger-referenced ones (emits all), and the frontend gains a "Spell Timers" section (list all timers with a used-by/standalone badge + full CRUD, sharing an extracted editor with the trigger form).

**Tech Stack:** FastAPI / Python 3.13 (`web/routes/act_triggers.py`), pytest + httpx ASGITransport; React 19 + TS + Vite + Tailwind v4 (`frontend/src/components/ActTriggers.tsx`). Tooling: `uv run …` (uv on PATH), ruff, pyright; `npm run typecheck`/`build`. Branch: `feature/standalone-spell-timers` (already created off `origin/main` with the spec commit).

Spec: `docs/superpowers/specs/2026-05-27-standalone-spell-timers-design.md`.

---

## File Structure

- **Modify** `web/routes/act_triggers.py` — `export_all_triggers` emits all encounter spell timers (drop the `_spell_timers_referenced_by` filter there); `export_trigger` and `_spell_timers_referenced_by` unchanged; CRUD endpoints unchanged.
- **Modify** `tests/web/test_act_triggers.py` — add a regression test that a standalone (unreferenced) timer now appears in the boss export; update the `export_all_triggers` docstring expectation if any test referenced it (none assert the old exclusion).
- **Modify** `frontend/src/components/ActTriggers.tsx` — extract the timer sub-form from `TriggerEditor` into a shared `SpellTimerEditor`; add a `SpellTimersSection` (list all timers + used-by/standalone badge + create/edit/delete). Existing trigger UI/behaviour unchanged.

No new files unless the component grows unwieldy — if `ActTriggers.tsx` becomes hard to hold in context after adding the section, split `SpellTimerEditor` + `SpellTimersSection` into a sibling file `frontend/src/components/SpellTimers.tsx` (note it in the task if you do).

**Conventions:** `uv run ruff format`/`ruff check`/`pyright` on touched Python; `npm run typecheck && npm run build` for frontend. Commit per task; stage only the task's files. Frontend is visual — **hold the frontend commits for user review** before they ship (the controller will surface them).

---

## Task 1: Export all spell timers in the boss-level XML (backend)

**Files:**
- Modify: `web/routes/act_triggers.py` (`export_all_triggers`, ~line 398-415)
- Test: `tests/web/test_act_triggers.py`

- [ ] **Step 1: Write the failing test** — append to `tests/web/test_act_triggers.py` (mirrors the existing export tests; `_TRIGGER_ROW` and `_SPELL_ROW` + `_resolved()` already exist in the file):
```python
@pytest.mark.asyncio
async def test_export_all_triggers_includes_standalone_spell_timer(app):
    """A spell timer that NO trigger references must still appear in the boss
    export (standalone timers fire off ACT's native skill/CA name match)."""
    # A trigger with no timer link, plus a standalone timer in the encounter.
    trigger_no_timer = {**_TRIGGER_ROW, "id": 11, "timer": 0, "timer_name": None}
    standalone = {**_SPELL_ROW, "id": 99, "name": "Manaward Reuse", "name_lower": "manaward reuse"}
    with (
        patch("web.routes.act_triggers._resolve_encounter_sync", return_value=_resolved()),
        patch(
            "web.routes.act_triggers.raids_db.list_act_triggers_for_encounter",
            return_value=[trigger_no_timer],
        ),
        patch(
            "web.routes.act_triggers.raids_db.list_act_spell_timers_for_encounter",
            return_value=[standalone],
        ),
    ):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            r = await client.get("/api/zones/The Emerald Halls/encounters/1/triggers/export.xml")
    assert r.status_code == 200
    body = r.text
    assert "<Trigger " in body
    assert '<Spell ' in body
    assert 'Name="Manaward Reuse"' in body  # standalone timer is exported
```

- [ ] **Step 2: Run it — expect FAIL** (today the standalone timer is filtered out → no `<Spell>`).
Run: `uv run pytest tests/web/test_act_triggers.py::test_export_all_triggers_includes_standalone_spell_timer -v`
Expected: FAIL (`assert '<Spell ' in body` — body has an empty `<SpellTimers>` section).

- [ ] **Step 3: Make the change** — in `web/routes/act_triggers.py` `export_all_triggers`, replace the filtered build with emitting all timers, and update the docstring. Change:
```python
    triggers = await loop.run_in_executor(None, raids_db.list_act_triggers_for_encounter, encounter_id)
    spells = await loop.run_in_executor(None, raids_db.list_act_spell_timers_for_encounter, encounter_id)
    used_spells = _spell_timers_referenced_by(triggers, spells)
    xml = _build_xml(triggers, used_spells)
```
to:
```python
    triggers = await loop.run_in_executor(None, raids_db.list_act_triggers_for_encounter, encounter_id)
    spells = await loop.run_in_executor(None, raids_db.list_act_spell_timers_for_encounter, encounter_id)
    # Emit EVERY spell timer for this encounter — both the ones a trigger
    # references and standalone ones (which fire off ACT's native skill/CA
    # name-match). The table's UNIQUE(encounter, name_lower) keeps <Spell>
    # rows unique without extra dedup.
    xml = _build_xml(triggers, spells)
```
And update the function docstring (replace the "standalone-defined-but-unreferenced spell timers stay out of the export" sentence) with:
```python
    """Bundle every trigger + every spell timer for this encounter into a
    single ACT-importable file. Both trigger-referenced and standalone
    spell timers are included so ACT picks up timers that fire off a
    skill/combat-art via native name-matching."""
```
Leave `_spell_timers_referenced_by` in place (still used by `export_trigger`) and leave `export_trigger` unchanged.

- [ ] **Step 4: Run the new test + the full export suite — expect PASS.**
Run: `uv run pytest tests/web/test_act_triggers.py -v`
Expected: PASS — the new test passes; `test_export_all_triggers_dedupes_spell_timers` (one unique timer → one `<Spell>`) and `test_export_all_triggers_empty_encounter` (no timers → no `<Spell>`) stay green; `export_trigger` tests unchanged.

- [ ] **Step 5: Lint/type.**
Run: `uv run ruff format web/routes/act_triggers.py tests/web/test_act_triggers.py && uv run ruff check web/routes/act_triggers.py tests/web/test_act_triggers.py && uv run pyright web/routes/act_triggers.py`
Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add web/routes/act_triggers.py tests/web/test_act_triggers.py
git commit -m "feat(raids): include standalone spell timers in the boss ACT export"
```
End the message with a trailing `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` line (blank line before it).

---

## Task 2: Extract a shared `SpellTimerEditor` (frontend refactor, no behaviour change)

**Files:**
- Modify: `frontend/src/components/ActTriggers.tsx`

Context: `TriggerEditor` (around lines 507-613) contains the spell-timer sub-form (the fields rendered when `draft.timer` is on — name, `timer_duration_s`, colour, and the other `<Spell>` attributes from the `SpellTimer` interface). Pull that into a reusable component so the new section and the trigger editor share one form.

- [ ] **Step 1: Read** `frontend/src/components/ActTriggers.tsx` fully — the `SpellTimer` interface (~lines 30-53), `defaultSpellTimerDraft`, the timer-field JSX inside `TriggerEditor`, and the spell-timer save logic (POST → 409 → PUT-by-id).

- [ ] **Step 2: Create `SpellTimerEditor`** in the same file (or `frontend/src/components/SpellTimers.tsx` if the file is getting large). It is a controlled form over a spell-timer draft:
```tsx
interface SpellTimerDraft {
  name: string
  timer_duration_s: number
  checked: boolean
  only_master_ticks: boolean
  restrict: boolean
  absolute: boolean
  start_wav: string
  warning_wav: string
  warning_value: number
  radial_display: boolean
  modable: boolean
  tooltip: string
  fill_color: number
  panel1: boolean
  panel2: boolean
  remove_value: number
  category: string | null
  restrict_category: boolean
}

function SpellTimerEditor({
  draft,
  onChange,
  nameEditable = true,
}: {
  draft: SpellTimerDraft
  onChange: (next: SpellTimerDraft) => void
  nameEditable?: boolean
}) {
  // Render the SAME inputs the trigger editor's timer sub-form renders today
  // (name, duration, colour, tooltip, the boolean ACT attrs, warning/remove
  // values, category). Reuse the existing field components/classes. Every
  // raw <input>/<select> keeps its existing appearance-none/theme reset
  // (NO Tailwind Preflight). `nameEditable=false` is used when editing a
  // timer that triggers reference by name (renaming would orphan them) —
  // render the name read-only in that case.
  ...
}
```
Move the field markup verbatim from `TriggerEditor` into `SpellTimerEditor`; keep the exact input types, classes, and value/onChange wiring (this is a pure extraction — no visual or behavioural change).

- [ ] **Step 3: Use `SpellTimerEditor` inside `TriggerEditor`** — replace the inlined timer fields with `<SpellTimerEditor draft={timerDraft} onChange={setTimerDraft} />`, preserving the existing `onTimerNameBlur` auto-snap and the existing save flow. The trigger editor behaves identically.

- [ ] **Step 4: Typecheck + build (refactor must be inert).**
Run: `cd frontend && npm run typecheck && npm run build`
Expected: 0 type errors; clean build. Manually confirm the trigger editor's timer sub-form still renders/saves exactly as before (no field lost).

- [ ] **Step 5: Commit** (frontend — see hold-for-review note; commit on the branch, the controller gates shipping):
```bash
git add frontend/src/components/ActTriggers.tsx
# (+ frontend/src/components/SpellTimers.tsx if you split it out)
git commit -m "refactor(raids): extract shared SpellTimerEditor from TriggerEditor"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 3: "Spell Timers" section — list all timers, badges, CRUD

**Files:**
- Modify: `frontend/src/components/ActTriggers.tsx` (+ `SpellTimers.tsx` if split)

Context: the component already fetches `triggers: Trigger[]` and `spellTimers: SpellTimer[]` (the `Promise.all` at ~lines 134-142) and already has `timersByName`. The section reuses those arrays; the backend `GET/POST/PUT/DELETE …/spell-timers` endpoints already exist.

- [ ] **Step 1: Derive the "used by" count per timer** — a memo mapping timer name → number of triggers referencing it:
```tsx
const triggerUsageByTimer = useMemo(() => {
  const m = new Map<string, number>()  // key: timer name lower-cased
  for (const t of triggers) {
    if (t.timer && t.timer_name) {
      const k = t.timer_name.toLowerCase()
      m.set(k, (m.get(k) ?? 0) + 1)
    }
  }
  return m
}, [triggers])
```

- [ ] **Step 2: Add the `SpellTimersSection`** rendered below the existing ACT Triggers list (reuse the page's section/card styling — match the triggers section's heading + accordion/card classes). It:
  - Lists **all** `spellTimers` (sorted by name), each row showing name + `timer_duration_s` + key attrs, and a badge derived from `triggerUsageByTimer.get(timer.name.toLowerCase()) ?? 0`: `> 0` → `used by N trigger${N>1?'s':''}`; `0` → `standalone`.
  - For editors (the component already knows `canEdit` from the auth/role check used by the trigger UI — reuse it): a **"New spell timer"** button + per-row **Edit**/**Delete**. Editing opens `SpellTimerEditor`; when the timer's used-by count is `> 0`, pass `nameEditable={false}` (renaming would orphan referencing triggers). For non-editors, render read-only (no buttons), same as triggers.
  - Skeleton:
```tsx
function SpellTimersSection({
  base, spellTimers, triggerUsageByTimer, canEdit, onChanged,
}: {
  base: string
  spellTimers: SpellTimer[]
  triggerUsageByTimer: Map<string, number>
  canEdit: boolean
  onChanged: () => void  // re-fetch timers + triggers after a mutation
}) {
  // list rows + badge + (editor-only) New/Edit/Delete using SpellTimerEditor
  // create:  POST   `${base}/spell-timers`
  // update:  PUT    `${base}/spell-timers/${id}`
  // delete:  DELETE `${base}/spell-timers/${id}`
  // all with { credentials: 'include' }; on success call onChanged()
  ...
}
```

- [ ] **Step 3: Wire it in** — render `<SpellTimersSection base={base} spellTimers={spellTimers} triggerUsageByTimer={triggerUsageByTimer} canEdit={canEdit} onChanged={reload} />` after the triggers list, where `reload` is the existing function that re-runs the `Promise.all` fetch (reuse it; create/edit/delete must refresh both arrays so badges + the trigger editor's timer list stay consistent). Don't change the existing triggers rendering.

- [ ] **Step 4: Edge behaviour** — a create whose name collides (409 from the UNIQUE constraint) surfaces the same inline error the trigger editor's timer-save already handles; deleting a timer a trigger still references is allowed (the trigger keeps its existing "referenced but not defined" warning). Match the existing error-display pattern.

- [ ] **Step 5: Typecheck + build.**
Run: `cd frontend && npm run typecheck && npm run build`
Expected: 0 errors; clean build.

- [ ] **Step 6: Commit** (frontend — hold for user review before shipping):
```bash
git add frontend/src/components/ActTriggers.tsx
# (+ frontend/src/components/SpellTimers.tsx if split)
git commit -m "feat(raids): Spell Timers section (all timers, used-by/standalone badge, CRUD)"
```
(Trailing `Co-Authored-By:` line.)

---

## Task 4: Full gate

**Files:** none (verification).

- [ ] **Step 1: Backend gate.**
```bash
uv run ruff format --check .
uv run ruff check .
uv run pyright
uv run pytest tests/web/test_act_triggers.py -q
uv run pytest -q
```
Expected: all green (the new export test passes; existing suite unaffected).

- [ ] **Step 2: Frontend gate.**
```bash
cd frontend && npm run typecheck && npm run build
```
Expected: 0 errors; clean build.

- [ ] **Step 3: Finish** — invoke `superpowers:finishing-a-development-branch`.

---

## Self-review (against the spec)

- §"Backend — XML export": `export_all_triggers` emits all timers → Task 1; `export_trigger` + `_spell_timers_referenced_by` retained → Task 1 (left untouched). ✓
- §"Frontend — Spell Timers section": extract `SpellTimerEditor` → Task 2; section with all timers + used-by/standalone badge + CRUD, editor-gated, existing trigger UI unchanged → Task 3. ✓
- §"Trigger model: Name = ability, no new field / no schema change": no DB/model task — confirmed none needed. ✓
- §"Testing": backend standalone-in-export test → Task 1 Step 1; per-trigger export unchanged (existing tests retained) → Task 1 Step 4; frontend tsc/build + badges → Tasks 2-4. ✓
- Type consistency: `SpellTimerDraft`/`SpellTimerEditor`/`SpellTimersSection`/`triggerUsageByTimer` names used consistently across Tasks 2-3; `SpellTimer` is the existing interface; endpoints match the existing `…/spell-timers` routes. ✓
- No placeholders; the one backend code change is shown in full; the frontend extraction is a described refactor of existing in-file markup plus concrete new code for the section + badge.
