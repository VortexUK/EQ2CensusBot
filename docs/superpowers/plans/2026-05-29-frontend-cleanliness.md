# Frontend Cleanliness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Burn down all 121 findings from the frontend cleanliness audit in five sub-phases — bug fixes first, then primitives + hooks, then file splits, then remaining cleanup, then polish.

**Architecture:** P0 (bugs/drift) lands as small surgical fixes. P1a introduces shared building blocks (`useFetch`, `<TabButton>`, `<Badge>`, `<SortTh>`, `<Textarea>`, `<DiscordButton>`, `<SectionLabel variant>`, `useSortable`, `useTooltipPosition`, `isContributor`, `toErrorMessage`, `fmtNumOrDash`, design tokens). P1b uses those primitives to split the 6 oversized pages into focused sibling files. P1c handles the remaining inline-style and hooks discipline cleanup. P2 is polish (magic numbers, off-scale spacing, naming, single-use abstractions).

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4 (CSS-first config in `frontend/src/index.css` via `@theme`; no `tailwind.config.js`). NO Tailwind Preflight — raw `<input>`/`<button>` need explicit resets. UI primitives in `frontend/src/components/ui/`.

Spec: `docs/superpowers/specs/2026-05-29-frontend-cleanliness-audit.md` (read it for the full per-finding rationale).

---

## File Structure

### New files created across all phases

**Phase 1 (P0):**
- `frontend/src/hooks/useFetch.ts` — generic AbortController-based fetch hook (P0-13)
- `frontend/.eslintrc.js` or `frontend/eslint.config.js` — project ESLint config (P0-17)

**Phase 2a (P1a primitives + hooks):**
- `frontend/src/components/ui/TabButton.tsx`
- `frontend/src/components/ui/Badge.tsx`
- `frontend/src/components/ui/SortTh.tsx`
- `frontend/src/components/ui/Textarea.tsx`
- `frontend/src/components/ui/DiscordButton.tsx`
- `frontend/src/hooks/useSortable.ts`
- `frontend/src/hooks/useTooltipPosition.ts`
- `frontend/src/hooks/useDebounce.ts` (P2-35 brought forward — needed by useFetch site reviews)
- `frontend/src/lib/errors.ts` — `toErrorMessage(err: unknown): string`

**Phase 2b (P1b file splits):**
- `frontend/src/pages/guild/GuildRosterTab.tsx`
- `frontend/src/pages/guild/GuildSpellCheckTab.tsx`
- `frontend/src/pages/guild/GuildAdornCheckTab.tsx`
- `frontend/src/pages/admin/UsersTable.tsx`
- `frontend/src/pages/admin/ClaimsTable.tsx`
- `frontend/src/pages/admin/RoleRequestsTable.tsx`
- `frontend/src/pages/admin/ServersSection.tsx`
- `frontend/src/pages/admin/ParsesAdminTable.tsx`
- `frontend/src/components/act/TriggerEditor.tsx`
- `frontend/src/components/act/SpellTimerEditor.tsx`
- `frontend/src/components/act/ActImportPanel.tsx`
- `frontend/src/pages/items/ItemSearchFilters.tsx`
- `frontend/src/pages/parse/CombatantDetailPanel.tsx`
- `frontend/src/pages/recipes/ShoppingListPanel.tsx`
- `frontend/src/pages/recipes/RecipeCard.tsx`

### Modified files
The bulk of P0 + P1c + P2 work edits existing files in place. See per-task sections.

---

## Conventions for every task

1. **Verification per task:** `cd frontend && npm run typecheck && npm run build`. Both must finish clean. Pre-existing chunk-size warning is fine UNTIL Phase 1 Task 1.14 (manualChunks) ships — after that it should be gone.
2. **NO commits inside tasks.** Per [[hold-commits-on-visual-work]]: every change held for user visual review. Each phase ends with a single "commit checkpoint" task the user runs after reviewing at desktop + mobile.
3. **Desktop layout invariant:** at ≥1280px the rendered UI must be byte-identical to before each phase, unless a P0 fix changes a visible misrender (e.g. P0-6 dropdown clip, P0-7 timestamps). Spot-check.
4. **Stage ONLY the named files at each checkpoint.** Never `git add -A`. The user has unrelated WIP that must stay untouched.
5. **Branch:** `feature/editable-raid-roster` (tip == main). Each phase commit can push direct to main via `git push origin HEAD:main`.
6. **Test impact:** This is a frontend-only refactor. No Python tests are affected (the backend is untouched). For frontend, `npm run typecheck` + `npm run build` are the gates. Vitest tests live in `frontend/src/test/` — run `npm run test` if a phase touches files those tests cover (most don't).

---

# Phase 1 — P0: bugs + critical drift (17 fixes)

After Phase 1: real bugs fixed (admin silent failures, missing credentials, dropdown clip, wrong timestamps), token drift aligned, useFetch hook in place, bundle split, lazy routes wired. **Highest-impact phase by far.**

Sequence rationale: small token + utility additions land first (Tasks 1.1, 1.2) so subsequent tasks consume them. `useFetch` hook lands early (1.3) so site-by-site migrations can begin. Bug fixes in source files (1.4–1.11) land in the same files they'll later be migrated in 1.12 (useFetch adoption batch) — this avoids merge churn. Tooling (1.13–1.16) lands at the end.

---

## Task 1.1: Add missing design tokens (P0-11, P0-12, P1-27 partial)

**Files:** `frontend/src/index.css`

Add warning + accent-rgb + success-rgb tokens. These unblock P0-9/10/11 hex hardcode replacements in Task 1.5.

- [ ] **Step 1: Read the current `@theme` block**

Read `frontend/src/index.css:16-49`. Confirm it ends with the `--radius-pill: 999px;` line.

- [ ] **Step 2: Edit `@theme` block to add the warning token**

Find:
```css
  --color-danger:         #f87171;
  --color-success:        #4ade80;
  --color-discord:        #5865f2;   /* Discord sign-in button ONLY */
```

Replace with:
```css
  --color-danger:         #f87171;
  --color-success:        #4ade80;
  --color-warning:        #fbbf24;   /* amber-400 — pending status, partial-fill badges */
  --color-discord:        #5865f2;   /* Discord sign-in button ONLY */
```

- [ ] **Step 3: Edit `:root` block to add the *-rgb literals**

Find:
```css
  --danger:        var(--color-danger);
  --danger-rgb:    248, 113, 113;
  --success:       var(--color-success);
  --discord-brand: var(--color-discord);
  --accent:        var(--gold);
  --accent-hover:  var(--gold-bright);
```

Replace with:
```css
  --danger:        var(--color-danger);
  --danger-rgb:    248, 113, 113;
  --success:       var(--color-success);
  --success-rgb:   74, 222, 128;     /* literal — used in rgba(var(--success-rgb), α) */
  --warning:       var(--color-warning);
  --warning-rgb:   251, 191, 36;
  --discord-brand: var(--color-discord);
  --accent:        var(--gold);
  --accent-rgb:    var(--gold-rgb);  /* fixes 7 `rgba(var(--accent-rgb,99,210,130),α)` callsites that fell back to a wrong green */
  --accent-hover:  var(--gold-bright);
```

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Both clean.

---

## Task 1.2: Add z-index tokens (P1-28)

**Files:** `frontend/src/index.css`

Promotes the 7 z-index magic numbers to named tokens. Required before P0-6 (UserWidget) so the fix uses the token, not another magic number.

- [ ] **Step 1: Append z-index tokens to `@theme`**

After the `--radius-pill: 999px;` line (the last line of `@theme`), insert (still inside the closing `}` of `@theme`):

```css

  /* z-index ladder — header beneath dropdowns beneath modals beneath tooltips.
     Use these via Tailwind utilities: z-header, z-dropdown, z-modal, z-tooltip.
     Old z-[N] arbitrary values being phased out. */
  --z-header:       200;
  --z-nav-backdrop: 250;
  --z-nav-panel:    260;
  --z-dropdown:     300;
  --z-modal:        1000;
  --z-tooltip:      9999;
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Both clean. Tailwind v4 generates `z-header`, `z-dropdown`, etc. utilities from the `--z-*` tokens.

---

## Task 1.3: Create `useFetch` hook (P0-13 part 1: hook only)

**Files:**
- Create: `frontend/src/hooks/useFetch.ts`

The hook replaces the load/error/data triplet that's repeated 14 times. AbortController-based cancellation (cleaner than the `let cancelled = false` pattern used elsewhere). Two flavours: `useFetch(url)` for auto-fetch on mount/url-change, `useLazyFetch(fetchFn)` for tab-triggered fetches like `GuildPage.loadSpells`.

- [ ] **Step 1: Write the hook file**

```tsx
/**
 * useFetch — generic data-fetching hook.
 *
 * Replaces the load/error/data triplet repeated in 14+ pages. Cancellation
 * via AbortController so re-renders / unmounts cancel the in-flight request
 * cleanly (no setState-after-unmount warnings, no stale-data races).
 *
 * Two flavours:
 *   - `useFetch(url, opts)` — auto-fetch on mount; refetches when `url`
 *     changes; returns null `data` until the first response.
 *   - `useLazyFetch<T>()` — returns a `run()` trigger function the caller
 *     invokes on user action (tab open, button click). Used by pages whose
 *     fetches are gated on tab selection or a search button.
 *
 * Both always send `credentials: 'include'` — every API call in this app is
 * session-authenticated and the bug in P0-1 (GuildPage spell-check fetch
 * missing credentials) was caused by hand-rolled fetch missing this option.
 * The hook enforces it by construction.
 *
 * Errors:
 *   - Non-2xx responses produce an `Error` whose `message` is the response's
 *     `detail` field (if present), else `HTTP {status}`.
 *   - Network errors / abort are surfaced as the underlying error message
 *     except for AbortError which is swallowed (it's the intended cancel).
 */
import { useEffect, useRef, useState, useCallback } from 'react'

export interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export interface UseFetchOptions {
  /** Skip auto-fetch on mount and on url change. Useful when url is null
   *  while gate conditions are pending. */
  enabled?: boolean
  /** Optional transform applied to the parsed JSON before setData. */
  select?: (raw: unknown) => unknown
  /** Optional fetch init (method, headers, body). credentials is forced. */
  init?: RequestInit
}

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
      return body.detail
    }
  } catch { /* not JSON */ }
  return `HTTP ${res.status}`
}

export function useFetch<T>(url: string | null, opts: UseFetchOptions = {}): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(opts.enabled !== false && !!url)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const enabled = opts.enabled !== false
  // Hold the select/init in refs so the effect doesn't re-fire on every render
  // when the caller passes a fresh inline function/object.
  const selectRef = useRef(opts.select)
  selectRef.current = opts.select
  const initRef = useRef(opts.init)
  initRef.current = opts.init

  useEffect(() => {
    if (!enabled || !url) {
      setLoading(false)
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    fetch(url, { credentials: 'include', signal: ctrl.signal, ...(initRef.current ?? {}) })
      .then(async res => {
        if (!res.ok) throw new Error(await readError(res))
        const raw = await res.json()
        const next = selectRef.current ? selectRef.current(raw) : raw
        if (!ctrl.signal.aborted) setData(next as T)
      })
      .catch(err => {
        if (ctrl.signal.aborted) return
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [url, enabled, tick])

  const refetch = useCallback(() => setTick(t => t + 1), [])
  return { data, loading, error, refetch }
}

/**
 * useLazyFetch — for tab-triggered or button-triggered fetches.
 *
 * Returns `{ data, loading, error, run, reset }`. The caller invokes `run()`
 * with a fetch URL when the user opens the tab; subsequent renders don't
 * re-fetch.
 */
export interface UseLazyFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Trigger the fetch. Safe to call multiple times — replaces in-flight request. */
  run: (url: string, init?: RequestInit) => void
  /** Clear state (data + error). Loading is untouched. */
  reset: () => void
}

export function useLazyFetch<T>(): UseLazyFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)

  useEffect(() => () => ctrlRef.current?.abort(), [])

  const run = useCallback((url: string, init?: RequestInit) => {
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setLoading(true)
    setError(null)
    fetch(url, { credentials: 'include', signal: ctrl.signal, ...(init ?? {}) })
      .then(async res => {
        if (!res.ok) throw new Error(await readError(res))
        const raw = await res.json()
        if (!ctrl.signal.aborted) setData(raw as T)
      })
      .catch(err => {
        if (ctrl.signal.aborted) return
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
  }, [])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { data, loading, error, run, reset }
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Both clean.

---

## Task 1.4: Fix GuildPage missing credentials (P0-1)

**Files:** `frontend/src/pages/GuildPage.tsx:1083, 1097`

Surgical 2-line bug fix. The bulk migration to `useFetch` happens in Task 1.12 — this is a stopgap so the bug is fixed even if 1.12 is delayed.

- [ ] **Step 1: Add `credentials: 'include'` to the spell-check fetch**

Find at line ~1083:
```tsx
    fetch(`/api/guild/${encodeURIComponent(guildName)}/spell-check`)
```

Replace with:
```tsx
    fetch(`/api/guild/${encodeURIComponent(guildName)}/spell-check`, { credentials: 'include' })
```

- [ ] **Step 2: Same for the adorn-check fetch**

Find at line ~1097:
```tsx
    fetch(`/api/guild/${encodeURIComponent(guildName)}/adorn-check`)
```

Replace with:
```tsx
    fetch(`/api/guild/${encodeURIComponent(guildName)}/adorn-check`, { credentials: 'include' })
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 1.5: Fix admin silent-failure handlers (P0-2, P0-3, P0-4, P0-5)

**Files:** `frontend/src/pages/AdminPage.tsx`

Four `await fetch(...)` calls in admin mutation handlers that ignore `res.ok` — failed approve/deny/role/kick/reject silently call `onAction()` as if successful. Add `res.ok` checks + local error state. Surface error via existing `busy` UI or a small inline error message.

Pattern for each handler:
```tsx
const [busy, setBusy] = useState(false)
const [error, setError] = useState<string | null>(null)   // ADD

async function doX(...) {
  setBusy(true)
  setError(null)                                          // ADD
  try {
    const res = await fetch(url, { ... })                 // CAPTURE the response
    if (!res.ok) {                                        // ADD
      const body = await res.json().catch(() => ({}))
      setError(body.detail ?? `HTTP ${res.status}`)
      return                                              // skip onAction()
    }
    onAction()
  } finally {
    setBusy(false)
  }
}
```

And in the row JSX, render `error` near the action buttons:
```tsx
{error && <div className="text-danger text-[0.78rem] mt-1">{error}</div>}
```

- [ ] **Step 1: Fix `UserRow.doAccess` (P0-2)**

In `pages/AdminPage.tsx:142-174`, modify `UserRow` to add an `error` state and update `doAccess`:

Before (~line 142-174):
```tsx
function UserRow({ user, onAction }: { user: UserItem; onAction: () => void }) {
  const [busy, setBusy] = useState(false)
  const [kickConfirm, setKickConfirm] = useState(false)

  async function doAccess(action: 'approve' | 'deny' | 'kick') {
    setBusy(true)
    try {
      const url = action === 'kick'
        ? `/api/admin/users/${user.discord_id}/kick`
        : `/api/admin/users/${user.discord_id}/${action}`
      await fetch(url, { method: 'POST', credentials: 'include' })
      onAction()
    } finally {
      setBusy(false)
      setKickConfirm(false)
    }
  }

  async function toggleRole(role: string, grant: boolean) {
    setBusy(true)
    try {
      await fetch(`/api/admin/users/${user.discord_id}/roles/${role}`, {
        method: grant ? 'POST' : 'DELETE',
        credentials: 'include',
      })
      onAction()
    } finally {
      setBusy(false)
    }
  }
```

After:
```tsx
function UserRow({ user, onAction }: { user: UserItem; onAction: () => void }) {
  const [busy, setBusy] = useState(false)
  const [kickConfirm, setKickConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doAccess(action: 'approve' | 'deny' | 'kick') {
    setBusy(true)
    setError(null)
    try {
      const url = action === 'kick'
        ? `/api/admin/users/${user.discord_id}/kick`
        : `/api/admin/users/${user.discord_id}/${action}`
      const res = await fetch(url, { method: 'POST', credentials: 'include' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.detail ?? `HTTP ${res.status}`)
        return
      }
      onAction()
    } finally {
      setBusy(false)
      setKickConfirm(false)
    }
  }

  async function toggleRole(role: string, grant: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${user.discord_id}/roles/${role}`, {
        method: grant ? 'POST' : 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.detail ?? `HTTP ${res.status}`)
        return
      }
      onAction()
    } finally {
      setBusy(false)
    }
  }
```

Then in the `UserRow` return JSX, find the action buttons (around line 226 — the row of approve/deny/kick buttons + the role toggles). Append after the last action button cell:

```tsx
{error && (
  <div className="text-danger text-[0.78rem] mt-1">{error}</div>
)}
```

(If the row uses a table layout where adding a sibling is awkward, render the error in a `<td colSpan={N}>` row beneath OR in a wrapping `<div>` around the existing action group. The implementer decides based on the actual JSX shape — the requirement is "user-visible error message when the action fails", placement is flexible.)

- [ ] **Step 2: Fix `ClaimRow.doAction` (P0-5)**

`pages/AdminPage.tsx:351-370`. Same pattern.

Before:
```tsx
function ClaimRow({ claim, onDelete }: { claim: ClaimDetail; onDelete: () => void }) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function doAction(url: string, body?: object | null, method = 'POST') {
    setBusy(true)
    try {
      await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      onDelete()
    } finally {
      setBusy(false)
      setRejectOpen(false)
    }
  }
```

After:
```tsx
function ClaimRow({ claim, onDelete }: { claim: ClaimDetail; onDelete: () => void }) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function doAction(url: string, body?: object | null, method = 'POST') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        setError(errBody.detail ?? `HTTP ${res.status}`)
        return
      }
      onDelete()
    } finally {
      setBusy(false)
      setRejectOpen(false)
    }
  }
```

Then surface `error` in the row JSX (similar to UserRow).

- [ ] **Step 3: Fix `RoleRequestRow.decide` (P0-4)**

`pages/AdminPage.tsx:545-565`. Same pattern.

Before:
```tsx
function RoleRequestRow({ request, onAction }: { request: RoleRequest; onAction: () => void }) {
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState<'approve' | 'reject' | null>(null)
  const [adminNote, setAdminNote] = useState('')

  async function decide(action: 'approve' | 'reject') {
    setBusy(true)
    try {
      await fetch(`/api/admin/role-requests/${request.id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: adminNote.trim() || null }),
      })
      onAction()
    } finally {
      setBusy(false)
      setNoteOpen(null)
      setAdminNote('')
    }
  }
```

After:
```tsx
function RoleRequestRow({ request, onAction }: { request: RoleRequest; onAction: () => void }) {
  const [busy, setBusy] = useState(false)
  const [noteOpen, setNoteOpen] = useState<'approve' | 'reject' | null>(null)
  const [adminNote, setAdminNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function decide(action: 'approve' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/role-requests/${request.id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: adminNote.trim() || null }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        setError(errBody.detail ?? `HTTP ${res.status}`)
        return
      }
      onAction()
    } finally {
      setBusy(false)
      setNoteOpen(null)
      setAdminNote('')
    }
  }
```

Then surface `error` near the approve/reject buttons.

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```

(P0-3 `UserRow.toggleRole` is folded into Step 1 since both `doAccess` and `toggleRole` live in the same `UserRow` component and share the new `error` state.)

---

## Task 1.6: Fix UserWidget dropdown z-index clip (P0-6)

**Files:** `frontend/src/components/UserWidget.tsx:70`

One-line className swap. Use the new `z-dropdown` token from Task 1.2.

- [ ] **Step 1: Swap z-index**

Before (~line 70):
```tsx
          className="absolute right-0 bg-surface-raised border border-border rounded-md min-w-[160px] z-[100] overflow-hidden"
```

After:
```tsx
          className="absolute right-0 bg-surface-raised border border-border rounded-md min-w-[160px] z-dropdown overflow-hidden"
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Visually verify: open the user dropdown — should sit above the header instead of being clipped behind it.

---

## Task 1.7: Delete duplicate `relativeTime` functions (P0-7, P0-8)

**Files:** `frontend/src/pages/GuildPage.tsx`, `frontend/src/pages/AdminPage.tsx`

Both define a local `relativeTime(unix): string` function that duplicates (and in GuildPage's case, breaks) `fmtRelative` from `formatters.ts`. Delete both; import + use the canonical one.

- [ ] **Step 1: Fix GuildPage**

Find at `pages/GuildPage.tsx:826-831`:
```tsx
function relativeTime(unix: number): string {
  const now = Date.now() / 1000
  const diff = now - unix
  const hours = Math.floor(diff / 3600)
  ...
}
```

Delete the entire function. Then ensure the existing import block at the top of the file already imports from `'../formatters'`:

```tsx
import { fmtNum, fmtRelative, fmtLocalDateTime, /* etc */ } from '../formatters'
```

If `fmtRelative` is not already in the import, add it. Then `grep -n "relativeTime(" frontend/src/pages/GuildPage.tsx` to find every callsite and replace `relativeTime(x)` with `fmtRelative(x)`.

- [ ] **Step 2: Fix AdminPage**

Find at `pages/AdminPage.tsx:100-106`:
```tsx
function relativeTime(unix: number): string {
  ...
}
```

Delete. Add `fmtRelative` to the existing `'../formatters'` import. Replace every `relativeTime(x)` call with `fmtRelative(x)`.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

If `typecheck` flags unused imports for any related symbol, clean them up.

Visually verify: a GuildPage row with a recent (within 1h) timestamp should now show e.g. "30m ago" instead of "just now".

---

## Task 1.8: Replace `#22c55e` / `#ef4444` hardcodes with tokens (P0-9, P0-10)

**Files:** `frontend/src/pages/CharacterSpellsTab.tsx`, `frontend/src/pages/GuildPage.tsx`, `frontend/src/components/NotificationBell.tsx`

Five sites total across three files.

- [ ] **Step 1: CharacterSpellsTab `#22c55e`**

`pages/CharacterSpellsTab.tsx:260`. Before:
```tsx
            style={{ color: '#22c55e' }}
```

After:
```tsx
            style={{ color: 'var(--success)' }}
```

- [ ] **Step 2: GuildPage two `#22c55e` sites + one `#ef4444`**

`pages/GuildPage.tsx:116` (adornCellStyle):
```tsx
    return { color: '#22c55e' }
```
→
```tsx
    return { color: 'var(--success)' }
```

`pages/GuildPage.tsx:120` (adornCellStyle, danger branch):
```tsx
    return { color: '#ef4444' }
```
→
```tsx
    return { color: 'var(--danger)' }
```

`pages/GuildPage.tsx:786` (approve button styling):
```tsx
        background: 'rgba(34,197,94,0.15)', color: '#22c55e'
```
→
```tsx
        background: 'rgba(var(--success-rgb), 0.15)', color: 'var(--success)'
```

- [ ] **Step 3: NotificationBell `#ef4444`**

`components/NotificationBell.tsx:138`. Before:
```tsx
        style={{ background: '#ef4444', color: '#fff' }}
```

After:
```tsx
        className="bg-danger text-white"
```

(Move from `style` to className entirely; remove the `style` prop on that element.)

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 1.9: Replace `#fbbf24` warning hex with token (P0-11)

**Files:** `frontend/src/pages/AdminPage.tsx`, `frontend/src/pages/CharacterAAsTab.tsx`, `frontend/src/pages/CharacterSpellsTab.tsx`

Three files; AdminPage uses the colour twice for a status badge.

- [ ] **Step 1: AdminPage**

`pages/AdminPage.tsx:109, 115`. Find both:
```tsx
    color: '#fbbf24'
```

Replace both with:
```tsx
    color: 'var(--warning)'
```

Also normalize the badge background. Find:
```tsx
    background: 'rgba(234,179,8,0.18)',
    border: '1px solid rgba(234,179,8,0.4)',
```
(These will be in the same `ACCESS_BADGE.pending` or similar object near lines 108-119.)

Replace with:
```tsx
    background: 'rgba(var(--warning-rgb), 0.18)',
    border: '1px solid rgba(var(--warning-rgb), 0.4)',
```

- [ ] **Step 2: CharacterAAsTab**

`pages/CharacterAAsTab.tsx:67`. Find:
```tsx
    color: pct >= 70 ? '#fbbf24' : 'var(--danger)',
```

Replace:
```tsx
    color: pct >= 70 ? 'var(--warning)' : 'var(--danger)',
```

- [ ] **Step 3: CharacterSpellsTab**

`pages/CharacterSpellsTab.tsx:57`. Same ternary pattern; replace `'#fbbf24'` with `'var(--warning)'`.

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 1.10: Remove wrong `--accent-rgb` fallback (P0-12)

**Files:** `frontend/src/pages/GuildPage.tsx`, `frontend/src/pages/HomePage.tsx`, `frontend/src/pages/ItemSearchPage.tsx`

The pattern `rgba(var(--accent-rgb, 99,210,130), α)` had a wrong-green fallback. Task 1.1 added `--accent-rgb: var(--gold-rgb)` to `:root`, so the fallback is now dead. Strip it from all 7 callsites.

- [ ] **Step 1: Find all 7 callsites**

Run:
```
grep -rn "rgba(var(--accent-rgb" frontend/src/
```

Expected 7 lines: `pages/GuildPage.tsx:154,931,933`, `pages/HomePage.tsx:242,243`, `pages/ItemSearchPage.tsx:694,700`.

- [ ] **Step 2: Replace each occurrence**

For each line, change `rgba(var(--accent-rgb,99,210,130),α)` (note: spacing may vary) to `rgba(var(--accent-rgb),α)`.

Easiest with one Edit-with-replace_all per file. Example pattern:

Before:
```tsx
background: 'rgba(var(--accent-rgb,99,210,130),0.06)'
```

After:
```tsx
background: 'rgba(var(--accent-rgb),0.06)'
```

(There are different α values per site — `0.06`, `0.15`, `0.4` etc. The change is purely removing the `,99,210,130` fallback; the α stays.)

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Visually verify: any element that previously highlighted in gold-tint should now ALSO highlight in gold-tint (the fallback never fired in production because the CSS var resolves, so this is a no-op visually but kills the latent bug).

---

## Task 1.11: Migrate first useFetch site as proof of pattern (P0-13 part 2)

**Files:** `frontend/src/pages/RaidZonesPage.tsx`

Use `RaidZonesPage` as the canonical migration template — it has a clean fetch pattern with no extra wrinkles. Subsequent bulk migration in Task 1.12 mirrors this shape.

- [ ] **Step 1: Read the current implementation**

Read `pages/RaidZonesPage.tsx:57-95` to see the current effect.

- [ ] **Step 2: Replace the effect with useFetch**

The current pattern is roughly:
```tsx
const [zones, setZones] = useState<Zone[] | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
  let cancelled = false
  setLoading(true)
  setError(null)
  fetch('/api/zones?expansion_short=...', { credentials: 'include' })
    .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
    .then(data => { if (!cancelled) setZones(data.zones ?? []) })
    .catch(err => { if (!cancelled) setError(String(err)) })
    .finally(() => { if (!cancelled) setLoading(false) })
  return () => { cancelled = true }
}, [/* deps */])
```

Replace with:
```tsx
import { useFetch } from '../hooks/useFetch'

interface ZonesResponse { zones: Zone[] }

const { data, loading, error } = useFetch<ZonesResponse>(
  `/api/zones?expansion_short=${/* the actual query */}`
)
const zones = data?.zones ?? null
```

(The exact URL and the `Zone[]` shape are already in the file. The implementer reads the live code and adapts.)

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Visually verify: `/raids` still loads the zone list, still shows loading and error states correctly.

- [ ] **Step 4: Document the pattern**

Add a comment at the top of the migrated file:
```tsx
// Data fetch uses useFetch (hooks/useFetch.ts) — canonical pattern.
// See P0-13 in docs/superpowers/specs/2026-05-29-frontend-cleanliness-audit.md.
```

This is the reference for the bulk migration. The next 13 sites copy this shape.

---

## Task 1.12: Bulk-migrate remaining 13 useFetch sites (P0-13 part 3)

**Files (13 callsites across):**
- `frontend/src/pages/ItemPage.tsx:34-49`
- `frontend/src/pages/ParsePage.tsx:147-170, 181-189, 197-205` (three sequential fetches — migrate the first/main one; the chained ones can stay as `useEffect` watching `data` for now since they're transformation-style)
- `frontend/src/pages/ParsesPage.tsx:179-215`
- `frontend/src/pages/RaidZonePage.tsx:58-87`
- `frontend/src/pages/RankingsPage.tsx:41-116` (multiple fetches; migrate the main board fetch — filter dropdowns can stay)
- `frontend/src/pages/RecipesPage.tsx:249-330` (multiple; migrate the search-trigger one as `useLazyFetch`)
- `frontend/src/pages/TokensPage.tsx:33-55`
- `frontend/src/pages/RolesSettingsPage.tsx:47-68`
- `frontend/src/components/EncounterStrategy.tsx:117-157`
- `frontend/src/components/ZoneOverview.tsx:81-105`
- `frontend/src/components/ActTriggers.tsx:104-157`
- `frontend/src/pages/GuildPage.tsx:655-670, 834-851` (`loadSpells` + `loadAdorns` — convert to `useLazyFetch` since they're tab-triggered)

Each migration follows the Task 1.11 template. Convert `useEffect(...)` + `useState(null/true/null)` triplets to `useFetch(url)`; convert tab-triggered or search-triggered fetches to `useLazyFetch()` with a `run(url)` call from the click handler.

- [ ] **Step 1: Migrate each file in turn**

For each file, read the current effect, swap to the hook, run typecheck. Do them one at a time so any breakage is isolated.

Key adaptation patterns:
- **Auto-fetch on mount + url-dependency:** `useFetch(url)` — refetches when `url` changes.
- **Conditional fetch (e.g. `if (!guildName) return`):** `useFetch(guildName ? url : null)` or `useFetch(url, { enabled: !!guildName })`.
- **Tab-triggered (`loadSpells()`):** `const { data, loading, error, run } = useLazyFetch<SpellCheck>()`; in the tab-open handler: `run(`/api/...`)`.
- **Search-triggered with manual reset:** `useLazyFetch` + `run` on submit; `reset` on form clear.
- **Post-fetch transform (e.g. `.then(data => data.zones)`):** use the `select` option: `useFetch<Wrapper>(url, { select: raw => (raw as Wrapper).zones })` OR keep the transform inline after the hook returns: `const zones = data?.zones ?? []`. Prefer the latter — clearer.

- [ ] **Step 2: Bulk verify**

After all 13 files done:
```
cd frontend && npm run typecheck && npm run build
```

Then manual smoke check: load each affected page once in the browser — confirm data loads, loading state appears momentarily, error state appears if the backend is offline.

- [ ] **Step 3: Note in TodoWrite which sites converted to useLazyFetch vs useFetch**

For the Phase 1 commit message we want to enumerate the migrations. Track a brief list.

---

## Task 1.13: vite.config manualChunks (P0-14)

**Files:** `frontend/vite.config.ts`

Add bundle splitting to fix the 730KB single-bundle warning.

- [ ] **Step 1: Add `build.rollupOptions.output.manualChunks`**

Read `frontend/vite.config.ts`. The current `build` section is:
```ts
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
```

Replace with:
```ts
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // React core + router — loaded on every page, biggest single dep group.
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          // Drag-and-drop — only needed by the boss-roster editor (admin-only).
          // Splits ~50KB out of the main bundle for non-editor users.
          'vendor-dnd':      ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          // Markdown — used by encounter strategy + zone overview.
          'vendor-markdown': ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run build
```

Build output should now show multiple `dist/assets/vendor-*.js` files alongside the main `index-*.js`. The chunk-size warning should be gone (or significantly reduced if the main bundle still tops 500KB — in which case Task 1.14's lazy loading will finish the job).

---

## Task 1.14: React.lazy() for 7 low-traffic pages (P0-15)

**Files:** `frontend/src/App.tsx`

Wrap rarely-visited pages in `React.lazy()` so they ship as separate chunks loaded on demand. Targets: AdminPage, TokensPage, RolesSettingsPage, ParsePage, RaidZonePage, ParsesPage, RaidZonesPage.

- [ ] **Step 1: Replace the top-of-file static imports**

Read `App.tsx:1-30`. Current:
```tsx
import HomePage from './pages/HomePage'
import CharacterPage from './pages/CharacterPage'
import ClaimPage from './pages/ClaimPage'
import AdminPage from './pages/AdminPage'
import GuildPage from './pages/GuildPage'
import ItemPage from './pages/ItemPage'
import ItemSearchPage from './pages/ItemSearchPage'
import ParsePage from './pages/ParsePage'
import ParsesPage from './pages/ParsesPage'
import RaidZonePage from './pages/RaidZonePage'
import RaidZonesPage from './pages/RaidZonesPage'
import RankingsPage from './pages/RankingsPage'
import RecipesPage from './pages/RecipesPage'
import RolesSettingsPage from './pages/RolesSettingsPage'
import TokensPage from './pages/TokensPage'
import { CharacterSearchPage, GuildSearchPage } from './pages/SearchPage'
```

Modify so the 7 rare pages use `lazy()`:
```tsx
import { lazy, Suspense } from 'react'
import HomePage from './pages/HomePage'
import CharacterPage from './pages/CharacterPage'
import ClaimPage from './pages/ClaimPage'
import GuildPage from './pages/GuildPage'
import ItemPage from './pages/ItemPage'
import ItemSearchPage from './pages/ItemSearchPage'
import RankingsPage from './pages/RankingsPage'
import RecipesPage from './pages/RecipesPage'
import { CharacterSearchPage, GuildSearchPage } from './pages/SearchPage'

// Lazy-loaded: low-traffic pages or heavy-deps pages (admin, parse detail, raid editor).
// Each becomes a separate chunk fetched on first navigation.
const AdminPage         = lazy(() => import('./pages/AdminPage'))
const TokensPage        = lazy(() => import('./pages/TokensPage'))
const RolesSettingsPage = lazy(() => import('./pages/RolesSettingsPage'))
const ParsePage         = lazy(() => import('./pages/ParsePage'))
const ParsesPage        = lazy(() => import('./pages/ParsesPage'))
const RaidZonePage      = lazy(() => import('./pages/RaidZonePage'))
const RaidZonesPage     = lazy(() => import('./pages/RaidZonesPage'))
```

- [ ] **Step 2: Wrap the `<Routes>` in a `<Suspense>` boundary**

Find the `<Routes>` block in App.tsx. Wrap it in `<Suspense fallback={...}>`:

Before (the existing Routes block):
```tsx
<Routes>
  ...
</Routes>
```

After:
```tsx
<Suspense fallback={<div className="p-8 text-text-muted">Loading…</div>}>
  <Routes>
    ...
  </Routes>
</Suspense>
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Build output should show new chunks like `AdminPage-XXX.js`, `ParsePage-XXX.js`, etc. The main bundle size should drop significantly.

Visually verify: navigate to `/admin` — there should be a brief loading flash (the lazy chunk is fetched), then the page renders.

---

## Task 1.15: gitignore tsbuildinfo (P0-16)

**Files:** `frontend/.gitignore` (create or edit), repo-root `.gitignore` (maybe edit)

- [ ] **Step 1: Check current state**

```
cat frontend/.gitignore 2>/dev/null || echo "no frontend .gitignore"
grep -n "tsbuildinfo" .gitignore frontend/.gitignore 2>/dev/null
ls frontend/tsconfig.app.tsbuildinfo
```

- [ ] **Step 2: Decide where to add the rule**

If `frontend/.gitignore` exists, append `*.tsbuildinfo` to it.
If not, prefer adding `frontend/*.tsbuildinfo` to the repo-root `.gitignore` (one fewer file to manage).

- [ ] **Step 3: Remove the tracked tsbuildinfo from git**

```
git rm --cached frontend/tsconfig.app.tsbuildinfo
```

- [ ] **Step 4: Verify**

```
git status --short | grep tsbuildinfo
```
Should show `D frontend/tsconfig.app.tsbuildinfo` (deletion, ready to commit). The file itself stays on disk.

---

## Task 1.16: ESLint config (P0-17)

**Files:** `frontend/eslint.config.js` (create), `frontend/package.json` (modify)

Add a project-level ESLint config so all contributors get the same lint feedback and CI can lint.

- [ ] **Step 1: Add deps to `frontend/package.json`**

Read `frontend/package.json`. In `devDependencies`, add (alphabetised with the existing entries):

```json
"eslint": "^9.15.0",
"eslint-plugin-react-hooks": "^5.1.0",
"eslint-plugin-react-refresh": "^0.4.14",
"@eslint/js": "^9.15.0",
"typescript-eslint": "^8.18.0",
"globals": "^15.13.0",
```

(Exact latest minor versions — check npm if these have rotated, but the major versions are right for React 19 + ESLint 9 flat config.)

- [ ] **Step 2: Add a "lint" script**

In `frontend/package.json` `scripts`:
```json
"lint": "eslint src",
```

- [ ] **Step 3: Create `frontend/eslint.config.js`**

```js
// ESLint flat config (ESLint 9+).
// React + react-hooks + react-refresh + typescript-eslint, recommended rules.
// Tightened where the codebase has agreed conventions; lax where the project
// disagrees with defaults (e.g. unused-vars is enforced by tsc strict, not ESLint).

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '*.tsbuildinfo'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // TypeScript handles unused-vars more accurately.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      // Allow the `(err as Error)` pattern that lives throughout the codebase;
      // P1-5 will replace it with `toErrorMessage`, after which this rule
      // could be re-enabled.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
```

- [ ] **Step 4: Install + verify**

```
cd frontend
npm install
npm run lint
```

Expect: ESLint runs and reports findings. Most will be `react-hooks/exhaustive-deps` warnings already present in the codebase (the existing `eslint-disable-next-line` comments suppress them). Run should complete without ESLint config errors.

If the run reports many NEW issues (not just the existing react-hooks warnings), tighten the config or add a justification — but the rules above are deliberately the React 19 + Vite defaults, so the count should match what's already inline-disabled.

```
cd frontend && npm run typecheck && npm run build
```

Both clean.

---

## Phase 1 commit checkpoint

After the user has visually reviewed Tasks 1.1–1.16 and confirmed:
- `/admin` mutation actions surface errors instead of silently succeeding
- `/guild/<name>` spell-check and adorn-check tabs load (P0-1 fix verified)
- UserWidget dropdown sits on top of the header
- A 30-minute-old timestamp on GuildPage shows "30m ago" not "just now"
- All pages still load (useFetch migration didn't break anything)
- Bundle is split into multiple chunks
- `/admin` shows a brief loading flash before rendering (lazy chunk)

```bash
git status --short   # verify only Phase 1 files are dirty
git add frontend/src/index.css \
        frontend/src/hooks/useFetch.ts \
        frontend/src/pages/GuildPage.tsx \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/components/UserWidget.tsx \
        frontend/src/pages/CharacterSpellsTab.tsx \
        frontend/src/components/NotificationBell.tsx \
        frontend/src/pages/CharacterAAsTab.tsx \
        frontend/src/pages/HomePage.tsx \
        frontend/src/pages/ItemSearchPage.tsx \
        frontend/src/pages/RaidZonesPage.tsx \
        frontend/src/pages/ItemPage.tsx \
        frontend/src/pages/ParsePage.tsx \
        frontend/src/pages/ParsesPage.tsx \
        frontend/src/pages/RaidZonePage.tsx \
        frontend/src/pages/RankingsPage.tsx \
        frontend/src/pages/RecipesPage.tsx \
        frontend/src/pages/TokensPage.tsx \
        frontend/src/pages/RolesSettingsPage.tsx \
        frontend/src/components/EncounterStrategy.tsx \
        frontend/src/components/ZoneOverview.tsx \
        frontend/src/components/ActTriggers.tsx \
        frontend/src/App.tsx \
        frontend/vite.config.ts \
        frontend/.gitignore \
        frontend/eslint.config.js \
        frontend/package.json \
        frontend/package-lock.json
git rm --cached frontend/tsconfig.app.tsbuildinfo

# Verify nothing unrelated is staged
git diff --cached --stat

git commit -m "fix(frontend): P0 — bugs + critical drift + useFetch hook + bundle split

17 P0 items from the frontend cleanliness audit:
- Admin row mutations (approve/deny/kick/role/reject) now surface errors
  instead of silently calling onAction on failure
- GuildPage spell-check + adorn-check fetches gain credentials:include
- UserWidget dropdown z-index moved above header (was clipped)
- Local relativeTime functions in GuildPage + AdminPage deleted in favour
  of canonical fmtRelative (fixes 'just now' for sub-1h events in GuildPage)
- Color tokens added (--color-warning, --warning-rgb, --success-rgb, --accent-rgb)
- Hex hardcodes (#22c55e, #ef4444, #fbbf24) replaced with token references
- z-index tokens added (--z-header, --z-dropdown, --z-modal, --z-tooltip)
- New useFetch + useLazyFetch hooks; 14 callsites migrated
- vite.config manualChunks splits vendor-react/dnd/markdown
- 7 low-traffic pages (admin, tokens, settings, parse, raid, parses, raidlist)
  wrapped in React.lazy() with Suspense fallback
- tsbuildinfo removed from git tracking
- ESLint config added (eslint 9 flat config, react-hooks, react-refresh)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Do NOT push. User decides when to ship.

---

# Phase 2a — P1 primitives + hooks (~25 items)

Introduces shared building blocks BEFORE the file splits in Phase 2b consume them. Order: small additive helpers first, then primitives in dependency order, then larger refactors.

---

## Task 2a.1: `toErrorMessage` utility (P1-5)

**Files:**
- Create: `frontend/src/lib/errors.ts`

Replaces the `(err as Error).message ?? err` pattern repeated in 15+ sites.

- [ ] **Step 1: Create the file**

```tsx
/**
 * toErrorMessage — extract a human-readable message from any thrown value.
 *
 * Replaces the `String((err as Error).message ?? err)` pattern used in 15+
 * sites. The `as Error` cast was unsound (err could be a string or any
 * primitive); `instanceof Error` is the correct narrowing.
 */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return String(err)
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

The 15 callsite migrations happen in Phase 2c. This task just lands the utility.

---

## Task 2a.2: `fmtNumOrDash` formatter (P1-14)

**Files:** `frontend/src/formatters.ts`

Adds the `value ?? '—'` pattern as a formatter. Used 15+ times across GuildPage + CharacterPage.

- [ ] **Step 1: Append to `formatters.ts`**

After the existing `fmtRelative` function (end of file), add:

```tsx
/** Same as fmtNum, but returns an em-dash for null/undefined. */
export function fmtNumOrDash(n: number | null | undefined): string {
  return n != null ? fmtNum(n) : '—'
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Callsite migrations happen in Phase 2c.

---

## Task 2a.3: `isContributor` helper on `useAuth` (P1-12)

**Files:** `frontend/src/hooks/useAuth.ts`

Extracts the `auth.status === 'authenticated' && (auth.user.is_admin || auth.user.static_roles.includes('contributor'))` derivation that's repeated in 4 components.

- [ ] **Step 1: Add the helper export**

Append to `hooks/useAuth.ts`:

```tsx
import type { AuthState } from './useAuth'

/** True if the authed user is either an admin or has the 'contributor' role.
 *  Used to gate the Edit buttons on raid strategy / triggers / boss editor. */
export function isContributor(auth: AuthState): boolean {
  return auth.status === 'authenticated' &&
    (auth.user.is_admin || auth.user.static_roles.includes('contributor'))
}
```

If `AuthState` isn't exported from the file already, export it.

- [ ] **Step 2: Migrate the 4 callsites**

In each of these files, replace the inline computation:

- `components/ActTriggers.tsx:99-101`
- `components/EncounterStrategy.tsx:113-115` (locally named `isAdmin` — rename to `canEdit` for consistency with the others)
- `components/ZoneOverview.tsx:77-79`
- `pages/RaidZonePage.tsx:54-56`

Replace the 3-line `canEdit = useMemo(...)` or `const canEdit = auth.status === ... && ...` with:
```tsx
import { isContributor } from '../hooks/useAuth'
// ...
const canEdit = isContributor(auth)
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2a.4: Tighten `User.access_status` to union (P1-4)

**Files:** `frontend/src/hooks/useAuth.ts`

`access_status: string` → `'approved' | 'pending' | 'denied'` so the discriminant comparisons in `App.tsx` are type-checked.

- [ ] **Step 1: Edit the type**

In `hooks/useAuth.ts:9` (the `User` interface), find:
```tsx
  access_status: string
```

Replace with:
```tsx
  access_status: 'approved' | 'pending' | 'denied'
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

If TypeScript flags any string comparison or assignment that doesn't match the union, fix at the source — those are real bugs.

---

## Task 2a.5: Type guards for SSE messages + user (P1-1, P1-2, P1-3)

**Files:** `frontend/src/hooks/useCensusStream.tsx`, `frontend/src/hooks/useAuth.ts`, `frontend/src/pages/CharacterPage.tsx`, `frontend/src/pages/GuildPage.tsx`

Three related changes that remove unsound `as` casts at the unknown→domain boundary.

- [ ] **Step 1: Generic `Listener<T>` in useCensusStream**

In `hooks/useCensusStream.tsx`, change the `Listener` type (currently `(data: unknown) => void`) to a generic signature. The subscribe API becomes:
```tsx
function subscribe<T>(event: string, listener: (data: T) => void): () => void
```

Internally the listener still receives `unknown` from the SSE source; the generic is a hint to the caller about what shape to expect. Callers can then do:
```tsx
subscribe<Character>('character.refresh', char => setChar(char))
```
without an `as Character` cast at the call site.

This is a type-only change — runtime behaviour identical.

- [ ] **Step 2: Add `isUser` guard in useAuth**

In `hooks/useAuth.ts`, add a type guard:
```tsx
function isUser(data: unknown): data is User {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return typeof d.id === 'string' &&
         typeof d.is_admin === 'boolean' &&
         Array.isArray(d.static_roles)
}
```

Replace the `as User` cast with the guard:
```tsx
// BEFORE
if (data) setState({ status: 'authenticated', user: data as User })

// AFTER
if (isUser(data)) {
  setState({ status: 'authenticated', user: data })
} else {
  setState({ status: 'unauthenticated' })
}
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Update the call sites in `CharacterPage.tsx:538` and `GuildPage.tsx:1074` to use the generic instead of `as Character` / `as GuildData`.

---

## Task 2a.6: `<SectionLabel variant>` prop (P1-10)

**Files:** `frontend/src/components/ui/SectionLabel.tsx`

Adds a `variant="muted"` prop so AdminPage's `SECTION_TITLE_CLS` and CharacterPage's `sectionHeadingClass` can use the primitive.

- [ ] **Step 1: Extend the component**

Current `SectionLabel.tsx`:
```tsx
const SECTION_LABEL_CLASSES = 'text-[0.7rem] uppercase tracking-[0.08em] text-gold font-semibold mb-1'

export function SectionLabel({ children, style, className }: SectionLabelProps) {
  const cls = [SECTION_LABEL_CLASSES, className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
```

Replace with:
```tsx
type Variant = 'gold' | 'muted'

type SectionLabelProps = {
  children: ReactNode
  style?: CSSProperties
  className?: string
  /** 'gold' (default) — the brand eyebrow. 'muted' — secondary section
   *  headings used in dense forms / admin tables where gold competes too
   *  hard with surrounding gold accents. */
  variant?: Variant
}

const BASE = 'text-[0.7rem] uppercase tracking-[0.08em] font-semibold mb-1'
const VARIANT_CLASSES: Record<Variant, string> = {
  gold:  'text-gold',
  muted: 'text-text-muted',
}

export function SectionLabel({ children, style, className, variant = 'gold' }: SectionLabelProps) {
  const cls = [BASE, VARIANT_CLASSES[variant], className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Callsite migrations (replacing hand-rolled `SECTION_TITLE_CLS` etc.) happen in Phase 2c.

---

## Task 2a.7: `<Badge>` primitive (P1-9)

**Files:** `frontend/src/components/ui/Badge.tsx` (create)

Small rounded label with semantic colour. Used in AdminPage, GuildPage, ClaimPage, NotificationBell.

- [ ] **Step 1: Create the component**

```tsx
/**
 * Badge — small rounded label with semantic colour.
 *
 * Replaces the ad-hoc badge styling in AdminPage (ACCESS_BADGE, CLAIM_BADGE),
 * GuildPage (item-watch status), ClaimPage (claim status), NotificationBell
 * (unread count). One styling source, four call sites.
 */
import type { ReactNode } from 'react'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'gold'

const VARIANT_CLASSES: Record<Variant, string> = {
  success: 'bg-[rgba(var(--success-rgb),0.18)] border-[rgba(var(--success-rgb),0.4)] text-success',
  warning: 'bg-[rgba(var(--warning-rgb),0.18)] border-[rgba(var(--warning-rgb),0.4)] text-warning',
  danger:  'bg-[rgba(var(--danger-rgb),0.18)]  border-[rgba(var(--danger-rgb),0.4)]  text-danger',
  info:    'bg-surface-raised border-border text-text',
  muted:   'bg-surface-raised border-border text-text-muted',
  gold:    'bg-[rgba(var(--gold-rgb),0.15)] border-[rgba(var(--gold-rgb),0.4)] text-gold',
}

interface BadgeProps {
  variant?: Variant
  children: ReactNode
  className?: string
}

export function Badge({ variant = 'muted', children, className = '' }: BadgeProps) {
  const cls = `inline-block rounded-sm px-2 py-[2px] text-[0.72rem] font-semibold whitespace-nowrap border ${VARIANT_CLASSES[variant]} ${className}`
  return <span className={cls}>{children}</span>
}
```

- [ ] **Step 2: Export from `components/ui/index.ts` (if it exists)**

```
grep -n "export" frontend/src/components/ui/index.ts 2>/dev/null
```

If `index.ts` exists, add `export { Badge } from './Badge'`. If not, callers import directly from `'./ui/Badge'`.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Callsite migrations happen in Phase 2c.

---

## Task 2a.8: `<TabButton>` primitive (P1-8)

**Files:** `frontend/src/components/ui/TabButton.tsx` (create)

Replaces the 5 sites that hand-roll an active-underline tab button.

- [ ] **Step 1: Create the component**

```tsx
/**
 * TabButton — the active-underline tab button used by CharacterPage,
 * CharacterAAsTab (2x), GuildPage, ParsePage. Active state gets a 2px gold
 * border-bottom and brighter text.
 *
 * Use inside a `<div className="flex border-b border-border">` wrapper.
 */
import type { ReactNode } from 'react'

interface TabButtonProps {
  active: boolean
  onClick: () => void
  children: ReactNode
  /** Optional title for tooltip on hover (e.g. extra context about the tab) */
  title?: string
  /** Extra classes — e.g. `whitespace-nowrap` for tabs with long labels */
  className?: string
}

export function TabButton({ active, onClick, children, title, className = '' }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'appearance-none border-none cursor-pointer text-[0.82rem] tracking-[0.04em] px-4 py-[7px] mb-[-1px]',
        'transition-[color,border-color] duration-150',
        active ? 'bg-surface text-text font-semibold' : 'bg-transparent text-text-muted font-normal',
        active ? 'border-b-2 border-gold' : 'border-b-2 border-transparent',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Callsite migrations happen in Phase 2c (after primitives are all in place).

---

## Task 2a.9: `<Textarea>` primitive (P1-19)

**Files:** `frontend/src/components/ui/Textarea.tsx` (create)

Dark-theme textarea replicated identically in 3 places.

- [ ] **Step 1: Create the component**

```tsx
/**
 * Textarea — dark-theme textarea with project styling. Replaces the
 * `w-full bg-bg/60 border border-border rounded-md p-3 font-mono text-[0.88rem]
 * leading-relaxed text-text outline-none focus:border-gold/60 resize-y` class
 * string duplicated across EncounterStrategy, ZoneOverview, RolesSettingsPage.
 *
 * Tailwind Preflight isn't loaded, so the explicit appearance-none + bg reset
 * matter — a raw <textarea> would inherit the UA's white background.
 */
import type { TextareaHTMLAttributes } from 'react'

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Use the monospace font (markdown editors, regex inputs). */
  mono?: boolean
}

export function Textarea({ mono = false, className = '', ...rest }: TextareaProps) {
  const cls = [
    'appearance-none w-full bg-bg/60 border border-border rounded-md p-3 text-[0.88rem]',
    'leading-relaxed text-text outline-none focus:border-gold/60 resize-y',
    mono ? 'font-mono' : '',
    className,
  ].filter(Boolean).join(' ')
  return <textarea className={cls} {...rest} />
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Migrations happen in Phase 2c.

---

## Task 2a.10: `<DiscordButton>` primitive (P1-34)

**Files:** `frontend/src/components/ui/DiscordButton.tsx` (create)

Three inconsistent inline-style Discord sign-in buttons.

- [ ] **Step 1: Create the component**

```tsx
/**
 * DiscordButton — the standard "Sign in with Discord" link. Used by the
 * login gate, the user widget when signed out, and the claim flow.
 *
 * Three copies of this previously existed with subtle text-colour drift
 * (#fff in two, var(--text) in one). This is the canonical version.
 */
interface DiscordButtonProps {
  href?: string
  children?: React.ReactNode
}

export function DiscordButton({ href = '/api/auth/login', children = 'Sign in with Discord' }: DiscordButtonProps) {
  return (
    <a
      href={href}
      className={[
        'inline-block no-underline rounded-md',
        'px-4 py-2 text-[0.95rem] font-semibold tracking-[0.02em]',
        'bg-discord text-white',
        'hover:brightness-110 transition-[filter] duration-150',
      ].join(' ')}
    >
      {children}
    </a>
  )
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Migrations (App.tsx LoginGate, UserWidget, ClaimPage) happen in Phase 2c.

---

## Task 2a.11: `useSortable` hook + `<SortTh>` primitive (P1-7)

**Files:**
- Create: `frontend/src/hooks/useSortable.ts`
- Create: `frontend/src/components/ui/SortTh.tsx`

Replaces the three duplicated sort patterns in GuildPage's Roster / SpellCheck / Adorn tables.

- [ ] **Step 1: Create the hook**

```tsx
/**
 * useSortable — manages sort key + direction for a tabular dataset.
 *
 * Replaces the 3 duplicated [sortKey, sortDir] + handleSort patterns in
 * GuildPage's three tables (Roster, SpellCheck, Adorn).
 *
 * Usage:
 *   const { sorted, sortKey, sortDir, handleSort } = useSortable(
 *     rows,
 *     (row, key) => row[key],
 *     'name',
 *   )
 *
 * `getValue(row, key)` returns the value to compare. Strings sort
 * case-insensitively; numbers/dates sort numerically; null/undefined sort
 * last regardless of direction.
 */
import { useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'

export interface UseSortableResult<T, K extends string> {
  sorted: T[]
  sortKey: K
  sortDir: SortDir
  handleSort: (key: K) => void
}

export function useSortable<T, K extends string>(
  rows: T[],
  getValue: (row: T, key: K) => unknown,
  initialKey: K,
  initialDir: SortDir = 'asc',
): UseSortableResult<T, K> {
  const [sortKey, setSortKey] = useState<K>(initialKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialDir)

  function handleSort(key: K) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = getValue(a, sortKey)
      const vb = getValue(b, sortKey)
      if (va == null && vb == null) return 0
      if (va == null) return 1   // nulls last regardless of direction
      if (vb == null) return -1
      if (typeof va === 'string' && typeof vb === 'string') {
        return sign * va.localeCompare(vb)
      }
      if (typeof va === 'number' && typeof vb === 'number') {
        return sign * (va - vb)
      }
      return sign * String(va).localeCompare(String(vb))
    })
  }, [rows, sortKey, sortDir, getValue])

  return { sorted, sortKey, sortDir, handleSort }
}
```

- [ ] **Step 2: Create the SortTh primitive**

```tsx
/**
 * SortTh — table header cell with sort caret. Pairs with useSortable.
 *
 * Renders the label + a small ▲ / ▼ caret when active. Click to toggle the
 * sort key + direction (handled by the useSortable handleSort callback).
 */
import type { ReactNode, MouseEvent } from 'react'

interface SortThProps<K extends string> {
  /** The key this header sorts on. */
  sortKey: K
  /** The currently active sort key (from useSortable). */
  active: K
  /** Current direction (from useSortable). */
  dir: 'asc' | 'desc'
  /** Click handler (from useSortable). */
  onSort: (key: K) => void
  /** Extra th classes (e.g. text-right for numeric columns). */
  className?: string
  children: ReactNode
}

export function SortTh<K extends string>({
  sortKey, active, dir, onSort, className = '', children,
}: SortThProps<K>) {
  const isActive = active === sortKey
  const caret = isActive ? (dir === 'asc' ? '▲' : '▼') : ''
  function handleClick(_e: MouseEvent<HTMLTableCellElement>) {
    onSort(sortKey)
  }
  return (
    <th
      onClick={handleClick}
      className={[
        'cursor-pointer select-none',
        isActive ? 'text-gold' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {caret && <span className="text-[0.65rem] opacity-80">{caret}</span>}
      </span>
    </th>
  )
}
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

The 3 GuildPage tables will adopt these in Phase 2b (file split).

---

## Task 2a.12: `useTooltipPosition` hook (P1-6)

**Files:**
- Create: `frontend/src/hooks/useTooltipPosition.ts`

Extracts the viewport-clamp + side-flip logic shared by ItemTooltip, SpellScrollTooltip, AATree's tooltip.

- [ ] **Step 1: Create the hook**

```tsx
/**
 * useTooltipPosition — compute fixed-position coords for a tooltip near a
 * mouse/tap point, flipping to the other side of the cursor when it would
 * overflow the viewport.
 *
 * Used by ItemTooltip, SpellScrollTooltip, AATree's node tooltip — all
 * pixel-perfect game-client recreations that share the same positioning
 * math but currently have three copies of it.
 */
import { useLayoutEffect, useRef, useState } from 'react'

interface Position { left: number; top: number }

interface Options {
  /** Pointer x (clientX). */
  x: number
  /** Pointer y (clientY). */
  y: number
  /** Tooltip width in px — used for the right-edge flip check. */
  width: number
  /** Tooltip height estimate in px — used for the bottom-edge flip check. */
  heightEstimate?: number
  /** Horizontal gap between pointer and tooltip (default 16). */
  marginX?: number
  /** Vertical gap (default 8). */
  marginY?: number
}

/** Returns {left, top} clamped to the viewport, flipping sides if needed. */
export function clampTooltipPosition({
  x, y, width, heightEstimate = 200, marginX = 16, marginY = 8,
}: Options): Position {
  const W = typeof window !== 'undefined' ? window.innerWidth  : 1920
  const H = typeof window !== 'undefined' ? window.innerHeight : 1080
  const left = x + marginX + width > W ? x - width - marginX : x + marginX
  const top  = y + marginY + heightEstimate > H ? y - heightEstimate - marginY : y + marginY
  return {
    left: Math.max(0, left),
    top:  Math.max(0, top),
  }
}

/**
 * Hook variant: measures the actual rendered height after mount, then
 * re-clamps. For tooltips with variable content size where the estimate is
 * too crude.
 */
export function useTooltipPosition(opts: Options) {
  const [pos, setPos] = useState<Position>(() => clampTooltipPosition(opts))
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    setPos(clampTooltipPosition(opts))
    // After mount, re-measure with the real height.
    if (ref.current) {
      const h = ref.current.offsetHeight
      setPos(clampTooltipPosition({ ...opts, heightEstimate: h }))
    }
  }, [opts.x, opts.y, opts.width])

  return { ref, position: pos }
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

The 3 tooltip components adopt this in Phase 2c. The hook lives here so it's available when needed.

---

## Task 2a.13: `useDebounce` hook (P2-35 brought forward)

**Files:** Create: `frontend/src/hooks/useDebounce.ts`

Brought forward from P2 because it's a clean abstraction and the SpellScrollTooltip + SearchPage migrations want it.

- [ ] **Step 1: Create the hook**

```tsx
/**
 * useDebounce — debounces a callback. Returns a stable function that, when
 * called, schedules `fn` to fire after `delay` ms. Subsequent calls within
 * the window reset the timer. Cleared on unmount.
 *
 * Use for: search-as-you-type, hover-tooltip-after-150ms, save-on-idle.
 */
import { useEffect, useRef, useCallback } from 'react'

export function useDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return useCallback((...args: A) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => fnRef.current(...args), delay)
  }, [delay])
}
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Migration of SearchPage debounce + SpellScrollTooltip hover-delay happens in Phase 2c / P2.

---

## Task 2a.14: Token: `--color-stat-primary` + `--color-stat-secondary` (P1-26)

**Files:** `frontend/src/index.css`

Adds the EQ2 stat-display colours so ItemPage stops hardcoding `#22ff22` / `#00e5ff`.

- [ ] **Step 1: Edit `@theme`**

Add to the `@theme` block (group with the other `--color-*` entries near the rarity colours):

```css
  --color-stat-primary:   #22ff22;   /* EQ2 stat lime — primary attributes */
  --color-stat-secondary: #00e5ff;   /* EQ2 stat cyan — secondary stats */
```

- [ ] **Step 2: Update ItemPage**

`pages/ItemPage.tsx:144,147`. Before:
```tsx
style={{ color: s.stat_group === 'primary' ? '#22ff22' : '#00e5ff' }}
```

After:
```tsx
style={{ color: s.stat_group === 'primary' ? 'var(--color-stat-primary)' : 'var(--color-stat-secondary)' }}
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2a.15: `--radius-sm2: 6px` token (P1-29)

**Files:** `frontend/src/index.css`

Adds a 6px radius token to replace the 13 `rounded-[6px]` arbitrary-value sites.

- [ ] **Step 1: Edit `@theme`**

Find:
```css
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-pill: 999px;
```

Replace with:
```css
  --radius-sm:   4px;
  --radius-sm2:  6px;   /* between sm and md — used by table cells, tooltips */
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-pill: 999px;
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

The 13 callsite replacements happen in Phase 2c (or batched as part of Phase 2b file splits when those files are touched anyway).

---

## Task 2a.16: AdminPage useCallback fixes (P1-40)

**Files:** `frontend/src/pages/AdminPage.tsx`

The two `eslint-disable react-hooks/exhaustive-deps` sites in AdminPage (lines 697, 1132) dodge the rule by omitting `load` / `fetchData` from the deps. The real fix is `useCallback`.

- [ ] **Step 1: Wrap `load` (in ParsesAdminTable) with useCallback**

Find the `async function load()` definition in `ParsesAdminTable`. Convert to:
```tsx
const load = useCallback(async () => {
  // ... existing body ...
}, [/* its real deps: searchParams, signal, etc */])
```

Then add `load` to the `useEffect` deps array, and remove the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment.

- [ ] **Step 2: Wrap `fetchData` (in ServersSection) with useCallback**

Same treatment.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

If the new effect runs in a loop, the dep array still has a non-stable reference — investigate.

---

## Task 2a.17: Remaining P1a token + cleanup items

Bundle the smaller items here so Phase 2a wraps without a long tail of one-line commits.

- [ ] **Step 1: `pages/ClaimPage.tsx:244` border-colour fix (P1-30)**

Find:
```tsx
style={{ borderColor: 'rgba(234,179,8,0.4)' }}
```

Replace with:
```tsx
style={{ borderColor: 'rgba(var(--gold-rgb), 0.5)' }}
```

- [ ] **Step 2: Replace `rgba(200,169,110,…)` hardcodes (P1-31)**

`grep -rn "rgba(200,169,110" frontend/src/` will list the 8 sites across NotificationBell, NotFoundPage, GuildPage. For each, replace `200,169,110` with `var(--gold-rgb)`.

Example:
```tsx
// BEFORE
background: 'rgba(200,169,110,0.15)'
// AFTER
background: 'rgba(var(--gold-rgb), 0.15)'
```

- [ ] **Step 3: `px-[10px]` → `px-2.5` (P1-32)**

Three sites: `pages/CharacterAAsTab.tsx:73`, `pages/CharacterPage.tsx:224`, `pages/CharacterSpellsTab.tsx:63`. Simple find-and-replace.

- [ ] **Step 4: `#93d9ff` and `#ffc993` rarity hex (P1-33)**

`pages/ParsePage.tsx:642` — `'#93d9ff'` → `'var(--rarity-treasured)'`.
`pages/HomePage.tsx:69` — `'#ffc993'` → `'var(--rarity-legendary)'`, `'#93d9ff'` → `'var(--rarity-treasured)'`.

- [ ] **Step 5: Remove `console.error` in CharacterSpellsTab (P1-43)**

`pages/CharacterSpellsTab.tsx:244`. Delete the `console.error(...)` line. The `setError(...)` on the next line already surfaces the error.

- [ ] **Step 6: Delete dead `SECTION_TITLE_CLS` + `TABLE_CLS` (P1-45)**

`pages/AdminPage.tsx:135-136`. Find both `const` declarations, confirm they're unused (`grep -n "SECTION_TITLE_CLS\|TABLE_CLS" frontend/src/pages/AdminPage.tsx`), then delete the two lines.

- [ ] **Step 7: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Phase 2a commit checkpoint

After user visual review (most changes are zero-visual — token additions, primitive files, type tightenings — but spot-check anything in CharacterPage, ClaimPage, NotificationBell that uses the swapped colours):

```bash
git status --short

git add frontend/src/index.css \
        frontend/src/lib/errors.ts \
        frontend/src/formatters.ts \
        frontend/src/hooks/useAuth.ts \
        frontend/src/hooks/useCensusStream.tsx \
        frontend/src/hooks/useSortable.ts \
        frontend/src/hooks/useTooltipPosition.ts \
        frontend/src/hooks/useDebounce.ts \
        frontend/src/components/ui/SectionLabel.tsx \
        frontend/src/components/ui/Badge.tsx \
        frontend/src/components/ui/TabButton.tsx \
        frontend/src/components/ui/Textarea.tsx \
        frontend/src/components/ui/DiscordButton.tsx \
        frontend/src/components/ui/SortTh.tsx \
        frontend/src/components/ActTriggers.tsx \
        frontend/src/components/EncounterStrategy.tsx \
        frontend/src/components/ZoneOverview.tsx \
        frontend/src/components/NotificationBell.tsx \
        frontend/src/pages/CharacterPage.tsx \
        frontend/src/pages/CharacterSpellsTab.tsx \
        frontend/src/pages/CharacterAAsTab.tsx \
        frontend/src/pages/ClaimPage.tsx \
        frontend/src/pages/ItemPage.tsx \
        frontend/src/pages/HomePage.tsx \
        frontend/src/pages/ParsePage.tsx \
        frontend/src/pages/RaidZonePage.tsx \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/pages/NotFoundPage.tsx \
        frontend/src/pages/GuildPage.tsx

git commit -m "refactor(frontend): P1a — primitives + hooks + token additions

- New UI primitives in components/ui/: TabButton, Badge, Textarea,
  DiscordButton, SortTh. SectionLabel gains variant='muted' prop.
- New hooks: useSortable, useTooltipPosition, useDebounce.
- New lib: errors.ts (toErrorMessage utility).
- formatters.ts: + fmtNumOrDash.
- useAuth: + isContributor helper, + isUser type guard, User.access_status
  tightened to a union, AuthState exported.
- useCensusStream: Listener<T> generic, callers no longer need 'as' casts.
- index.css: + stat-primary/-secondary + radius-sm2 tokens.
- Smaller token cleanups: replaced rgba(200,169,110,...) with rgba(var(--gold-rgb),...)
  in 8 sites; replaced rarity hex literals with var(--rarity-*) in 3 sites;
  px-[10px] -> px-2.5 in 3 sites.
- AdminPage: useCallback for ParsesAdminTable.load + ServersSection.fetchData,
  removed eslint-disable comments.
- AdminPage: deleted dead SECTION_TITLE_CLS + TABLE_CLS module consts.
- CharacterSpellsTab: removed production console.error.

Primitives + hooks land here so Phase 2b file splits can use them; the
heavy callsite migrations (TabButton across 5 sites, useSortable across
3 sites etc.) happen during the file splits or in Phase 2c.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Phase 2b — P1 file splits (6 page-splits)

After Phase 2a, the ui/ primitives + hooks are available. Now split the 6 oversized pages. Each split is bounded by 2–3 sub-tasks so the implementer can read the live file fresh, extract one sub-component, verify, then move on.

For each split, the parent page becomes a thin shell that imports + renders the extracted children. Tab state, top-level data fetches, and breadcrumb/layout remain in the parent.

**General convention for each split:**

1. Read the source file end-to-end to map sub-components + their state dependencies.
2. Extract one sub-component at a time. The new file owns its own state, fetches, and JSX. Parent passes only the inputs it needs (zone name, ids, callbacks).
3. After each extraction: `cd frontend && npm run typecheck && npm run build`.
4. After all extractions for a page: load the page in browser, exercise every tab/path that was extracted.
5. NO commits per task — phase-end checkpoint.

---

## Task 2b.1: Split GuildPage — extract `GuildRosterTab` (P1-20 part 1)

**Files:**
- Create: `frontend/src/pages/guild/GuildRosterTab.tsx`
- Modify: `frontend/src/pages/GuildPage.tsx`

The roster tab is the most self-contained — own state, own table component, own filter logic. Good starting point.

- [ ] **Step 1: Read `pages/GuildPage.tsx` and identify the roster section**

The roster tab includes:
- `RosterTable` component (lines ~197–251, includes its `SortTh` and `useState<sortKey,sortDir>`).
- The `roster` data source (state owned by parent `GuildPage`).
- The `hiddenRanks` filter state.
- The `filter` text input state.

Decide: which state moves to the new file, which stays in the parent?

Recommended split:
- **In new file `GuildRosterTab.tsx`:** the `RosterTable` component + its own sort state. Receives `members: RosterMember[]`, `tiers: number[]`, `filter: string`, `hiddenRanks: Set<number>` as props.
- **Stays in parent:** the data fetch (`useFetch<GuildData>(...)`), the filter input, the rank-toggle UI, the hidden-ranks state.

- [ ] **Step 2: Create the new file**

```tsx
// frontend/src/pages/guild/GuildRosterTab.tsx
import type { RosterMember } from '../GuildPage'   // or wherever RosterMember is declared
import { useSortable } from '../../hooks/useSortable'
import { SortTh } from '../../components/ui/SortTh'

interface Props {
  members: RosterMember[]
  filter: string
  hiddenRanks: Set<number>
}

export function GuildRosterTab({ members, filter, hiddenRanks }: Props) {
  // ... extract the RosterTable JSX + sort hook usage ...
  // (Implementer adapts from the existing inline RosterTable, replacing
  //  its hand-rolled [sortKey, sortDir, handleSort] with useSortable, and
  //  its inline SortTh with the imported component.)
}
```

The implementer fills in the body by lifting the existing JSX. Where the original code defined a local `function SortTh(...)`, delete it — use the imported one.

If `RosterMember` type isn't exported from `GuildPage.tsx`, either export it there or move the type definition into a new `frontend/src/pages/guild/types.ts` and import from both sides.

- [ ] **Step 3: Update GuildPage to use the new component**

In `pages/GuildPage.tsx`, where the roster tab JSX was inlined, replace with:
```tsx
import { GuildRosterTab } from './guild/GuildRosterTab'

// ... in the tab switch:
{tab === 'roster' && (
  <GuildRosterTab
    members={data?.members ?? []}
    filter={filter}
    hiddenRanks={hiddenRanks}
  />
)}
```

Delete the now-orphaned `RosterTable` function definition + its helper `SortTh` from GuildPage.

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Visually verify `/guild/<name>` roster tab still works: filter, rank toggles, column sort, member rows.

---

## Task 2b.2: Split GuildPage — extract `GuildSpellCheckTab` (P1-20 part 2)

**Files:**
- Create: `frontend/src/pages/guild/GuildSpellCheckTab.tsx`
- Modify: `frontend/src/pages/GuildPage.tsx`

The spell-check tab owns its data fetch (`loadSpells`), its sort, its tooltip state.

- [ ] **Step 1: Identify state to lift**

Recommended split:
- **In new file `GuildSpellCheckTab.tsx`:** the `SpellCheckTable` JSX, the sort state (now `useSortable`), the on-mouse-enter tooltip state, the `useLazyFetch<SpellCheckData>()` for loading on tab open.
- **Stays in parent:** none (this tab is fully self-contained once the data fetch is a `useLazyFetch`).

- [ ] **Step 2: Create + move**

Pattern as in Task 2b.1.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2b.3: Split GuildPage — extract `GuildAdornCheckTab` (P1-20 part 3) + trim shell

**Files:**
- Create: `frontend/src/pages/guild/GuildAdornCheckTab.tsx`
- Modify: `frontend/src/pages/GuildPage.tsx`

Same pattern as 2b.2 for the adorn-check tab. After this, GuildPage.tsx should be < 400 lines — a thin shell holding tab state, the breadcrumb, and the conditional renders.

- [ ] **Step 1: Extract `GuildAdornCheckTab`**

Mirror Task 2b.2.

- [ ] **Step 2: Trim the GuildPage shell**

After all three extractions, GuildPage.tsx should hold:
- Imports
- The `GuildPage` component itself
- The `tab` state machine
- The breadcrumb + tab switcher
- The conditional render of `<GuildRosterTab>` / `<GuildSpellCheckTab>` / `<GuildAdornCheckTab>` / existing `<ClaimRequestsTab>` / `<ItemWatchTab>` (the last two are already local functions; consider whether to extract them too — if they're each < 100 lines, leave inline).
- The top-level `useFetch<GuildData>(...)` for the page data.

Delete: all the now-unused helpers (`SortTh`, the three local sort states, the spell + adorn tooltip JSX that moved into their respective tab files).

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Then `wc -l frontend/src/pages/GuildPage.tsx` — should be < 400.

Visually verify all 5 tabs on `/guild/<name>`.

---

## Task 2b.4: Split AdminPage — extract 5 sub-tables (P1-21)

**Files:**
- Create: `frontend/src/pages/admin/UsersTable.tsx`
- Create: `frontend/src/pages/admin/ClaimsTable.tsx`
- Create: `frontend/src/pages/admin/RoleRequestsTable.tsx`
- Create: `frontend/src/pages/admin/ServersSection.tsx`
- Create: `frontend/src/pages/admin/ParsesAdminTable.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx`

AdminPage is 1275 lines. Each of the 5 sub-tables is naturally self-contained — own state, own fetches, own row components. Extract one at a time.

- [ ] **Step 1: Read AdminPage end-to-end**

Map the file:
- Lines ~140–290: `UsersTable` (uses `UserRow`)
- Lines ~340–540: `ClaimsTable` (uses `ClaimRow`)
- Lines ~545–680: `RoleRequestsTable` (uses `RoleRequestRow`)
- Lines ~690–960: `ParsesAdminTable`
- Lines ~970–1130: `ServersSection` (uses `ServerRow`)
- Lines ~1200–end: the `AdminPage` main component itself

Each `*Table` + its `*Row` move into one file. Keep types in `frontend/src/pages/admin/types.ts` if shared, or inline if not.

- [ ] **Step 2: Extract `UsersTable` first**

Create `pages/admin/UsersTable.tsx`. Lift `UserRow` + `UsersTable` into it. Update imports.

Verify after each extraction: `cd frontend && npm run typecheck && npm run build`.

- [ ] **Step 3: Extract the remaining 4 sub-tables**

In this order (least → most dependent):
1. `RoleRequestsTable` + `RoleRequestRow`
2. `ClaimsTable` + `ClaimRow`
3. `ServersSection` + `ServerRow`
4. `ParsesAdminTable`

For each: read the original code, create the new file, update AdminPage to import, verify.

- [ ] **Step 4: Trim AdminPage shell**

Final AdminPage.tsx should be < 200 lines — just the page-level state, breadcrumb, conditional renders.

- [ ] **Step 5: Final verify**

```
cd frontend && npm run typecheck && npm run build
```

Load `/admin` in browser: every section visible, every action button functional.

---

## Task 2b.5: Split ActTriggers — extract 3 sibling files (P1-22)

**Files:**
- Create: `frontend/src/components/act/TriggerEditor.tsx`
- Create: `frontend/src/components/act/SpellTimerEditor.tsx`
- Create: `frontend/src/components/act/ActImportPanel.tsx`
- Modify: `frontend/src/components/ActTriggers.tsx`

ActTriggers is 1248 lines. Already has the inline `TriggerEditor`, `SpellTimerEditor` (used as both standalone + within TriggerEditor), and `XmlImporter` sub-components.

- [ ] **Step 1: Extract `SpellTimerEditor` first (used by the other two)**

Create `components/act/SpellTimerEditor.tsx`. Lift the existing `SpellTimerEditor` function (with its `defaultSpellTimerDraft`, `SpellTimerDraft` type, and the editor JSX). Also lift `buildTimerBody` and `argbToHex` if used only here — otherwise hoist to a shared utils file.

Update imports in `ActTriggers.tsx`.

- [ ] **Step 2: Extract `TriggerEditor`**

Create `components/act/TriggerEditor.tsx`. Lift `TriggerEditor` + its `TriggerDraft` type + `defaultTriggerDraft` + its imports of `SpellTimerEditor` from the sibling file.

- [ ] **Step 3: Extract `ActImportPanel`**

Create `components/act/ActImportPanel.tsx`. Lift `XmlImporter` (rename if you prefer, but keep the public API the same).

- [ ] **Step 4: Trim ActTriggers**

`ActTriggers.tsx` should now hold:
- The main `ActTriggers` component (the list view + section header + edit-state machine).
- The `SpellTimersSection` (already extracted to a local function — could move to `components/act/SpellTimersSection.tsx` too if convenient; otherwise leave inline).
- The `handle<T>` helper (P1-48 will move it to `lib/api.ts` in Phase 2c).

Target < 400 lines.

- [ ] **Step 5: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Load a raid zone page → expand a boss → ACT Triggers section: create a trigger, edit a trigger, add a spell timer, paste-import XML. All flows must work.

---

## Task 2b.6: Split ItemSearchPage — extract `ItemSearchFilters` (P1-23)

**Files:**
- Create: `frontend/src/pages/items/ItemSearchFilters.tsx`
- Modify: `frontend/src/pages/ItemSearchPage.tsx`

ItemSearchPage is 839 lines with 17 useState calls. The filter form + stat-filter management (~200 lines) is the cleanest extraction.

- [ ] **Step 1: Identify filter state**

Read `ItemSearchPage.tsx` and list all `useState` calls. Group into:
- **Filter state** (search input value, tier dropdown, slot dropdown, class dropdown, level range, stat filters): moves to new file.
- **Results state** (results array, loading, error, sort, pagination): stays in parent.

Recommended split: ItemSearchFilters owns the filter state, exposes a `onSearch(query: ItemSearchQuery)` callback that the parent uses to trigger the actual fetch.

- [ ] **Step 2: Create `pages/items/ItemSearchFilters.tsx`**

```tsx
// Shape:
interface Props {
  initial?: ItemSearchQuery   // for URL-state hydration
  onSearch: (q: ItemSearchQuery) => void
  // ... + any callback for clear/reset
}

export function ItemSearchFilters({ initial, onSearch }: Props) {
  // All the useState calls for filters
  // The form JSX
  // The submit handler that builds an ItemSearchQuery and calls onSearch
}
```

The implementer determines `ItemSearchQuery` shape from the existing code (it's whatever the current URL search params encode).

- [ ] **Step 3: Update ItemSearchPage**

Parent owns: results, sort, pagination, results table, URL sync.
Mounts: `<ItemSearchFilters initial={initialQuery} onSearch={handleSearch} />`.

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Load `/items`, exercise every filter, confirm URL state updates correctly.

---

## Task 2b.7: Split ParsePage — extract `CombatantDetailPanel` (P1-24)

**Files:**
- Create: `frontend/src/pages/parse/CombatantDetailPanel.tsx`
- Modify: `frontend/src/pages/ParsePage.tsx`

ParsePage is 793 lines. The CombatantDetailPanel is the expandable detail (attacks, heals, cures, threats) shown when you click a combatant row — naturally self-contained.

- [ ] **Step 1: Identify the panel JSX**

In `ParsePage.tsx`, find the section rendered conditionally below each `CombatantRow` when `open` is true. It includes:
- Attack breakdown table
- Heals breakdown
- Cures breakdown
- Threat breakdown
- Damage type table

All accept a `combatantName` (or id) and the parse data as props.

- [ ] **Step 2: Create the new file**

```tsx
// frontend/src/pages/parse/CombatantDetailPanel.tsx
interface Props {
  combatantName: string
  parseData: ParseData
}

export function CombatantDetailPanel({ combatantName, parseData }: Props) {
  // All the sub-tables + their grid styling
}
```

- [ ] **Step 3: Update ParsePage**

In `CombatantRow`, replace the inlined detail block with `<CombatantDetailPanel combatantName={c.name} parseData={data} />`.

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Load a parse, click a row, confirm the detail panel renders identically.

---

## Task 2b.8: Split RecipesPage — extract `ShoppingListPanel` + `RecipeCard` (P1-25)

**Files:**
- Create: `frontend/src/pages/recipes/ShoppingListPanel.tsx`
- Create: `frontend/src/pages/recipes/RecipeCard.tsx`
- Modify: `frontend/src/pages/RecipesPage.tsx`

RecipesPage is 776 lines with 15 useState. Two natural extractions: the right-column shopping cart panel, and the per-recipe card in the results.

- [ ] **Step 1: Extract `RecipeCard`**

The card that renders a single recipe in the results grid. Props: `recipe`, plus callbacks `onAddToShopping(recipe, quantity)` and `onOpenDetails(recipe)`.

- [ ] **Step 2: Extract `ShoppingListPanel`**

The right-column cart UI. Owns its own quantity-edit state, download-XML button, etc. Receives the shopping-list array from the parent (which keeps it in localStorage, or wherever it currently lives).

If the shopping list state currently lives entirely in `RecipesPage`, decide: keep it there and pass via props (simpler), OR lift to a `useShoppingList` hook (cleaner if it'll be used elsewhere — but YAGNI says no, keep in props for now).

- [ ] **Step 3: Update RecipesPage**

Parent owns: search state (now via `useLazyFetch` from Phase 1), the shopping list state, the layout grid. Mounts `<ShoppingListPanel>` in the right column and `<RecipeCard>` per result.

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Load `/recipes`, search, add to shopping list, change quantity, download. Confirm every interaction works.

---

## Phase 2b commit checkpoint

After user visual review (every split-affected page exercised end-to-end):

```bash
git status --short

git add frontend/src/pages/guild/ \
        frontend/src/pages/admin/ \
        frontend/src/pages/items/ \
        frontend/src/pages/parse/ \
        frontend/src/pages/recipes/ \
        frontend/src/components/act/ \
        frontend/src/pages/GuildPage.tsx \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/pages/ItemSearchPage.tsx \
        frontend/src/pages/ParsePage.tsx \
        frontend/src/pages/RecipesPage.tsx \
        frontend/src/components/ActTriggers.tsx

git commit -m "refactor(frontend): P1b — split 6 oversized pages into focused sibling files

- pages/guild/: GuildRosterTab, GuildSpellCheckTab, GuildAdornCheckTab
  extracted from pages/GuildPage.tsx (1290 -> ~350 lines)
- pages/admin/: UsersTable, ClaimsTable, RoleRequestsTable, ServersSection,
  ParsesAdminTable extracted from pages/AdminPage.tsx (1275 -> ~200 lines)
- components/act/: TriggerEditor, SpellTimerEditor, ActImportPanel
  extracted from components/ActTriggers.tsx (1248 -> ~400 lines)
- pages/items/ItemSearchFilters extracted from pages/ItemSearchPage.tsx
  (839 -> ~500 lines)
- pages/parse/CombatantDetailPanel extracted from pages/ParsePage.tsx
  (793 -> ~450 lines)
- pages/recipes/ShoppingListPanel + RecipeCard extracted from
  pages/RecipesPage.tsx (776 -> ~400 lines)

Each split adopts the Phase 2a primitives (TabButton, Badge, SortTh,
useSortable) where applicable. No behavioural changes — pure structural
refactor.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Phase 2c — P1 remaining (~14 items)

Smaller cleanups that don't depend on the file splits. Touches many files but each item is small. Batched together rather than per-task to keep the plan readable.

---

## Task 2c.1: Migrate the 15 `toErrorMessage` callsites (P1-5 part 2)

- [ ] **Step 1: Find every `(err as Error).message ?? err` pattern**

```
grep -rn "(err as Error)\.message" frontend/src/
```

Expected 15 hits across ActTriggers, BossRosterEditor, EncounterStrategy, RolesSettingsPage, ZoneOverview.

- [ ] **Step 2: Replace each**

Add `import { toErrorMessage } from '../../lib/errors'` (path adjusted per file).

Replace `String((err as Error).message ?? err)` with `toErrorMessage(err)`.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.2: Migrate `<TabButton>` callsites (P1-8 part 2)

Replace inline tab buttons in 5 places with `<TabButton>`:
- `pages/CharacterPage.tsx:630-642` (equipment/aas/spells)
- `pages/CharacterAAsTab.tsx:273-287` (profile selector)
- `pages/CharacterAAsTab.tsx:353-368` (tree sub-tabs)
- `pages/GuildPage.tsx:149-161` (`TabBtn` — delete the local function)
- `pages/ParsePage.tsx:532-547` (`TabButton` local — delete and import from ui)

- [ ] **Step 1: Replace each site**

Pattern:
```tsx
// BEFORE
<button
  onClick={() => setTab('foo')}
  className="border-none cursor-pointer text-[0.82rem] ..."
  style={{ background: active ? '...' : 'transparent', ... }}
>
  Foo
</button>

// AFTER
import { TabButton } from '../components/ui/TabButton'
// ...
<TabButton active={tab === 'foo'} onClick={() => setTab('foo')}>Foo</TabButton>
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

Visually verify tab styling matches the original.

---

## Task 2c.3: Migrate `<Badge>` callsites (P1-9 part 2)

Replace ad-hoc badges in:
- `pages/AdminPage.tsx` (ACCESS_BADGE, CLAIM_BADGE — turn the badge styling lookups into `<Badge variant="success|warning|danger">`)
- `pages/admin/RoleRequestsTable.tsx` (after Phase 2b split — badge for status)
- `pages/GuildPage.tsx` (item-watch status badge)
- `pages/ClaimPage.tsx` (claim status display)
- `components/NotificationBell.tsx` (unread count badge — `<Badge variant="danger">N</Badge>`)

- [ ] **Step 1: Replace each badge with the primitive**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.4: Migrate `<Textarea>` callsites (P1-19 part 2)

Replace the textarea+class string in:
- `components/EncounterStrategy.tsx:370` — `mono` variant
- `components/ZoneOverview.tsx:260` — `mono` variant
- `pages/RolesSettingsPage.tsx:251` — plain variant

Pattern:
```tsx
// BEFORE
<textarea
  className="w-full bg-bg/60 border border-border rounded-md p-3 font-mono text-[0.88rem] leading-relaxed text-text outline-none focus:border-gold/60 resize-y"
  value={x}
  onChange={...}
/>

// AFTER
import { Textarea } from '../components/ui/Textarea'
<Textarea mono value={x} onChange={...} />
```

- [ ] **Step 1: Replace each**

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.5: Migrate `<DiscordButton>` callsites (P1-34 part 2)

Replace the 3 sites:
- `App.tsx:49-60` (LoginGate)
- `components/UserWidget.tsx:29-44` (when not authed)
- `pages/ClaimPage.tsx:13-25` (sign-in CTA — also delete the local `discordBtn()` function)

Pattern:
```tsx
// BEFORE
<a href="/api/auth/login" style={{ display: 'inline-block', padding: '...', background: '...', ... }}>
  Sign in with Discord
</a>

// AFTER
import { DiscordButton } from '../components/ui/DiscordButton'
<DiscordButton />
```

- [ ] **Step 1: Replace each**

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.6: Migrate `useTooltipPosition` (P1-6 part 2)

Replace the duplicated viewport-clamp logic in 3 tooltip components with the shared hook:
- `components/ItemTooltip.tsx:157-176`
- `components/SpellScrollTooltip.tsx:160-171`
- `components/AATree.tsx:174-188`

For each: identify the inline `useLayoutEffect` + clamp math, replace with the hook from `hooks/useTooltipPosition.ts`. Game-client visual styling stays in place — only the positioning math is consolidated.

- [ ] **Step 1: Migrate one tooltip at a time**

Verify each: load a character page (item tooltip), spell tier pip (spell scroll tooltip), AA tree node (AA tooltip). Confirm position + flip behaviour matches.

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.7: `useItemTooltip` hook (P1-13)

**Files:**
- Create: `frontend/src/components/ItemTooltip.tsx` (modify — colocate the hook)

Extract the showTip/hideTip/moveTip triple-callback duplicated in CharacterPage + ItemSearchPage.

- [ ] **Step 1: Add the hook to ItemTooltip.tsx**

At the bottom of the file:
```tsx
export interface TooltipState {
  itemId: string
  x: number
  y: number
  adorns?: { color: string; bonus: number }[]
}

export function useItemTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const showTip = useCallback((itemId: string, e: React.MouseEvent, adorns?: TooltipState['adorns']) => {
    setTooltip({ itemId, x: e.clientX, y: e.clientY, adorns })
  }, [])
  const hideTip = useCallback(() => setTooltip(null), [])
  const moveTip = useCallback((e: React.MouseEvent) => {
    setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
  }, [])

  return { tooltip, showTip, hideTip, moveTip }
}
```

- [ ] **Step 2: Migrate CharacterPage + ItemSearchPage**

Replace the inline state + three useCallback declarations with one hook call.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.8: Replace `<SectionLabel variant="muted">` callsites (P1-10 part 2)

Find sites that hand-rolled the muted eyebrow:
- `pages/CharacterPage.tsx:990` (`sectionHeadingClass` — delete the const, use `<SectionLabel variant="muted">`)

Also the inline `text-[0.72rem] uppercase tracking-[0.06em] text-text-muted` pattern in:
- `pages/AdminPage.tsx:1019, 1034, 1064` (form labels) — these may make more sense as proper `<label>` elements; if so, leave them. If they're decorative headings, use `<SectionLabel variant="muted">`.
- `pages/ClaimPage.tsx:233, 248`
- `pages/RecipesPage.tsx:698, 718`
- `pages/GuildPage.tsx:1222`

- [ ] **Step 1: Audit each site**

Decide per-site: is this a label-for-input (keep as `<label>` with the existing class) or a section heading (use `<SectionLabel variant="muted">`)?

- [ ] **Step 2: Replace where appropriate**

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.9: Inline-style → utility migrations (P1-35, P1-36, P1-37, P1-38, P1-39)

Smaller migrations bundled together.

- [ ] **Step 1: P1-35 — `<Card style={{ padding: ... }}>` overrides**

Find 5 sites (ItemPage:117, SearchPage:146, ItemSearchPage:437, GuildPage:1177, TokensPage's table styles). Replace `style={{ padding: '1.1rem 1.25rem' }}` with `className="py-[1.1rem] px-[1.25rem]"`, etc. For `style={{ padding: 0, overflow: 'hidden' }}` use `className="p-0 overflow-hidden"`.

- [ ] **Step 2: P1-36 — ParsesPage `headerBtnStyle`**

`pages/ParsesPage.tsx:670-682`. Delete the `CSSProperties` const. Inline the styles as className on the button elements: `className="flex items-center gap-2 w-full bg-transparent border-none text-inherit cursor-pointer py-2 px-3 text-left"`.

- [ ] **Step 3: P1-37 — ItemSearchPage `TH`/`TD` CSSProperties**

`pages/ItemSearchPage.tsx:188-206`. Convert the `TH` and `TD` `CSSProperties` consts to className constants matching AdminPage's pattern:
```tsx
const TH = 'px-3 py-2 text-[0.72rem] uppercase tracking-[0.05em] text-text-muted font-semibold whitespace-nowrap text-left border-b-2 border-border bg-surface-raised'
const TD = 'px-3 py-2 text-[0.85rem]'
```
Update usages from `<th style={TH}>` to `<th className={TH}>`.

- [ ] **Step 4: P1-38 — CharacterPage Link**

`pages/CharacterPage.tsx:746`. Change `style={{ color: 'var(--accent)' }}` to `className="text-gold"` (or add `text-gold` to existing className).

- [ ] **Step 5: P1-39 — CharacterPage border-right**

`pages/CharacterPage.tsx:760`. Change `borderRight: '1px solid var(--border)'` inline to conditional className `'border-r border-border'`.

- [ ] **Step 6: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.10: SearchPage + App.tsx hover style mutations (P1-41)

**Files:** `frontend/src/pages/SearchPage.tsx`, `frontend/src/App.tsx`

Replace JS style mutations in `onMouseEnter`/`onMouseLeave` with Tailwind `hover:` utilities.

- [ ] **Step 1: SearchPage**

`pages/SearchPage.tsx:157-160`. Find the `onMouseEnter={e => e.currentTarget.style.background = ...}` pattern. Replace with className `hover:bg-surface-raised` (or whatever the original mutation was).

- [ ] **Step 2: App.tsx ServerBadge switch links**

`App.tsx:164-171`. Same pattern. Replace with className-based hover.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.11: CharacterPage module-level mutable state (P1-42)

**Files:** `frontend/src/pages/CharacterPage.tsx`

Convert `let _configFetched / _ratingConfig` to a Promise-cache pattern.

- [ ] **Step 1: Read current implementation**

Around lines 480–503, identify the `let _configFetched`, `let _ratingConfig`, and the function that uses them.

- [ ] **Step 2: Refactor to promise-cache**

```tsx
let _configPromise: Promise<RatingConfig> | null = null

function getRatingConfig(): Promise<RatingConfig> {
  if (!_configPromise) {
    _configPromise = fetch('/api/config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .catch(err => {
        _configPromise = null   // allow retry on next call
        throw err
      })
  }
  return _configPromise
}
```

Usage:
```tsx
useEffect(() => {
  getRatingConfig().then(setConfig).catch(/* ignore */)
}, [])
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.12: `handle<T>` to shared `lib/api.ts` (P1-48)

**Files:**
- Create: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/act/TriggerEditor.tsx` (or wherever `handle<T>` lives post-2b.5)

- [ ] **Step 1: Create `frontend/src/lib/api.ts`**

```tsx
/**
 * handle — generic fetch response handler. Throws on non-ok responses,
 * returns the parsed JSON otherwise. Used by hand-rolled fetches that
 * don't go through useFetch (e.g. mutation endpoints invoked from event
 * handlers).
 */
export async function handle<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${r.status}`)
  }
  return r.json() as Promise<T>
}
```

- [ ] **Step 2: Delete the local `handle<T>` definition + update imports**

Wherever it was (originally `components/ActTriggers.tsx:1245`, possibly moved during 2b.5): delete the local definition, add `import { handle } from '../lib/api'`.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Task 2c.13: Misc small cleanups (P1-43, P1-44, P1-46, P1-47, P1-49, P1-50, P1-52, P1-53)

Bundle the remaining nits.

- [ ] **Step 1: Confirm `frontend/.gitignore` covers dist + node_modules (P1-46)**

```
cat .gitignore | grep -E "frontend/(dist|node_modules)"
cat frontend/.gitignore 2>/dev/null
```

If neither shows the pattern, add `dist/` and `node_modules/` to whichever .gitignore is appropriate (probably root).

- [ ] **Step 2: Remove `skipLibCheck: true` (P1-47)**

`frontend/tsconfig.app.json:7`. Delete the line `"skipLibCheck": true,`. Run `cd frontend && npm run typecheck`. If it reports new errors in `node_modules` types, revert (some 3rd-party type pkg is broken — not our problem to fix). If clean, leave removed.

- [ ] **Step 3: `<Button size="icon">` variant for AdminPage emoji buttons (P1-49)**

Add an `'icon'` variant to `components/ui/Button.tsx` if not already there: smaller horizontal padding, square aspect. Update AdminPage lines 466, 479 to `<Button size="icon">…</Button>`.

- [ ] **Step 4: Dropdown shadow + positioning constants (P1-50)**

In `components/UserWidget.tsx` and `components/NotificationBell.tsx`, the `top: 'calc(100% + 6px)'` + `boxShadow` are duplicated. Either factor out into a `const DROPDOWN_STYLE = 'absolute top-[calc(100%+6px)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-dropdown ...'` shared between them, OR accept the small duplication (the values are already standardised).

The recommended action is to leave the inline styles and just unify the shadow value — pick `0 8px 24px rgba(0,0,0,0.4)` for both files.

- [ ] **Step 5: AdminPage `ServersSection` form inputs share `inputCls` (P1-52)**

Once Task 2a Phase 2a primitives are in (the `inputCls` is in `components/ui/`), update `pages/admin/ServersSection.tsx` to use the shared constant for its 4 inline inputs.

- [ ] **Step 6: Replace inline eyebrow-label sites with `<SectionLabel variant="muted">` (P1-53)**

This is the same as Task 2c.8 — handled there. No additional action.

- [ ] **Step 7: Verify**

```
cd frontend && npm run typecheck && npm run build
```

---

## Phase 2c commit checkpoint

```bash
git status --short

git add frontend/src/lib/errors.ts \
        frontend/src/lib/api.ts \
        frontend/src/components/ItemTooltip.tsx \
        frontend/src/components/SpellScrollTooltip.tsx \
        frontend/src/components/AATree.tsx \
        frontend/src/components/ActTriggers.tsx \
        frontend/src/components/act/ \
        frontend/src/components/EncounterStrategy.tsx \
        frontend/src/components/ZoneOverview.tsx \
        frontend/src/components/UserWidget.tsx \
        frontend/src/components/NotificationBell.tsx \
        frontend/src/components/BossRosterEditor.tsx \
        frontend/src/components/ui/Button.tsx \
        frontend/src/pages/App.tsx \
        frontend/src/App.tsx \
        frontend/src/pages/CharacterPage.tsx \
        frontend/src/pages/ItemSearchPage.tsx \
        frontend/src/pages/SearchPage.tsx \
        frontend/src/pages/ClaimPage.tsx \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/pages/admin/ \
        frontend/src/pages/ParsesPage.tsx \
        frontend/src/pages/ItemPage.tsx \
        frontend/src/pages/GuildPage.tsx \
        frontend/src/pages/guild/ \
        frontend/src/pages/RolesSettingsPage.tsx \
        frontend/src/pages/RecipesPage.tsx \
        frontend/src/pages/recipes/ \
        frontend/tsconfig.app.json \
        .gitignore

git commit -m "refactor(frontend): P1c — callsite migrations + inline-style cleanup

- 15 sites adopt toErrorMessage from lib/errors
- 5 sites adopt <TabButton>
- 5 sites adopt <Badge variant=...>
- 3 sites adopt <Textarea mono>
- 3 sites adopt <DiscordButton>
- 3 tooltip components adopt useTooltipPosition
- CharacterPage + ItemSearchPage adopt useItemTooltip
- SectionLabel variant='muted' adopted across CharacterPage + others
- Card padding overrides (5 sites) moved to className
- ParsesPage headerBtnStyle CSSProperties const deleted, inlined as className
- ItemSearchPage TH/TD CSSProperties consts converted to className constants
- CharacterPage 2 sites converted from inline style to utility classes
- SearchPage + App.tsx hover JS style mutations replaced with Tailwind hover:
- CharacterPage module-level mutable _configFetched/_ratingConfig replaced
  with promise-cache
- handle<T> moved from ActTriggers to lib/api
- Misc: tsconfig skipLibCheck removed, Button size='icon' variant added,
  AdminPage server-section inputs use shared inputCls

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Phase 3 — P2 polish (~51 items)

51 polish items batched into three internal sub-batches by category. Each sub-batch is one commit checkpoint.

## Task 3.1: P2 magic numbers + naming (15 items — P2-1 through P2-15)

- [ ] **Step 1: Name the magic timers** (P2-1, P2-2, P2-3, P2-4, P2-6)

For each: hoist the literal to a `const NAME_MS = N` at the top of the file. Add a one-line comment when intent isn't obvious.

- `components/SpellScrollTooltip.tsx:258` → `const TOOLTIP_HOVER_DELAY_MS = 150`
- `pages/SearchPage.tsx:91` → `const SEARCH_DEBOUNCE_MS = 300`
- `pages/TokensPage.tsx:108` → `const COPY_FEEDBACK_DURATION_MS = 1500`
- `components/BossRosterEditor.tsx:550` → add comment `// 0 ms: defer focus to after the element renders into the DOM`
- `components/BossRosterEditor.tsx:70` → `const DND_TOUCH_DELAY_MS = 250; const DND_TOUCH_TOLERANCE_PX = 5`

- [ ] **Step 2: ParsesPage `PARSES_FETCH_LIMIT` (P2-5)**

`pages/ParsesPage.tsx:198`. Hoist to module-level `const PARSES_FETCH_LIMIT = 500`.

- [ ] **Step 3: Pick `_` prefix convention (P2-7)**

Recommendation: DROP the `_` prefix uniformly (TypeScript's module system already encapsulates). For each file with `_PREFIXED_CONSTS`, rename to drop the underscore. Affected files include `pages/CharacterSpellsTab.tsx`, `pages/RecipesPage.tsx`, `components/AATree.tsx`, `pages/CharacterPage.tsx`.

Do this in one sweep: `grep -rn "^const _[A-Z]\|^type _[A-Z]\|^function _[a-z]" frontend/src/` lists every site. Rename each, update internal references.

- [ ] **Step 4: Boolean naming `open` → `isOpen` (P2-8)**

Recommendation: leave as-is. The codebase has consistent use of bare `open` for disclosure-style toggles (NotificationBell, UserWidget, MobileNav, FilterDropdown). Renaming all of them is high-churn for little semantic gain. Document the convention in a `CONVENTIONS.md` or skip.

DEFERRED: skip this finding — convention is consistent within its category.

- [ ] **Step 5: Hoist `SECTION_CLS` from render body (P2-9)**

`pages/AdminPage.tsx:1220`. Move `const SECTION_CLS = 'mb-10'` from inside `AdminPage()` to module scope.

- [ ] **Step 6: `TH_CLS`/`TD_CLS` rename or comment (P2-10)**

After Phase 2a's `tableThCls` / `tableTdCls` primitives land, this naming conflict is moot — both files use the shared constants. If they haven't been migrated yet, add a one-line comment in each: `// Local to this page; see components/ui/table for the shared variant.`

- [ ] **Step 7: Inline single-use consts (P2-11, P2-12, P2-13, P2-14)**

- `pages/ClaimPage.tsx:10` — inline `CARD_CLS` at its single usage, delete const.
- `pages/ClaimPage.tsx:13-22` — `discordBtn()` function returns static object; this is moot if Task 2c.5 migrated to `<DiscordButton>` (which it should have). Confirm + delete.
- `pages/ParsePage.tsx:785` — inline `PAGE_CLS` at its single use.
- `pages/ParsePage.tsx:314` — merge `HDR_KEY_CLS` and `HDR_CELL_CLS` into a single base + variant suffix.

- [ ] **Step 8: Simplify `isBoss` (P2-15)**

`pages/ParsesPage.tsx:82-86`. Either inline as `/^[A-Z]/.test(title)` (1-line regex) or simplify the body to `title.charCodeAt(0) >= 65 && title.charCodeAt(0) <= 90 || false`. Don't fight too hard — it's fine as-is, just flag the comment.

- [ ] **Step 9: Verify**

```
cd frontend && npm run typecheck && npm run build
```

## Phase 3.1 commit checkpoint

```bash
git status --short
git add frontend/src/components/SpellScrollTooltip.tsx \
        frontend/src/pages/SearchPage.tsx \
        frontend/src/pages/TokensPage.tsx \
        frontend/src/components/BossRosterEditor.tsx \
        frontend/src/pages/ParsesPage.tsx \
        frontend/src/pages/CharacterSpellsTab.tsx \
        frontend/src/pages/RecipesPage.tsx \
        frontend/src/components/AATree.tsx \
        frontend/src/pages/CharacterPage.tsx \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/pages/ClaimPage.tsx \
        frontend/src/pages/ParsePage.tsx \
        frontend/src/pages/GuildPage.tsx

git commit -m "chore(frontend): P2 polish — name magic timers, drop _ prefix convention,
inline single-use consts (15 items)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.2: P2 Tailwind spacing + radius (8 items — P2-16 through P2-23)

These are the off-scale arbitrary-value normalisations. Each is small but the cumulative diff is large. Batch by file rather than by category.

- [ ] **Step 1: Sub-batch by file**

For each file that has multiple off-scale arbitrary-value classes, do all of them in one Edit pass:
- `pages/AdminPage.tsx` — `py-[0.45rem]`, `gap-[0.35rem]`, `px-[0.55rem]` etc.
- `pages/GuildPage.tsx`
- `pages/CharacterPage.tsx`
- `pages/CharacterAAsTab.tsx`
- `pages/CharacterSpellsTab.tsx`
- `components/NotificationBell.tsx`, `components/UserWidget.tsx`
- ... and so on

For each off-scale value, replace with the nearest 4px-aligned Tailwind utility:
- `py-[0.45rem]` → `py-2` (8px)
- `py-[0.35rem]` → `py-1.5` (6px)
- `gap-[0.35rem]` → `gap-1.5`
- `gap-[0.6rem]` → `gap-2.5`
- `mb-[0.2rem]` → `mb-1` (4px — close enough)
- `mt-[7px]` → `mt-2` (8px)
- `rounded-[6px]` → `rounded-sm2` (using the token from Task 2a.15)
- `rounded-[5px]` → `rounded-sm`
- `rounded-[3px]` / `rounded-[2px]` on progress bars → `rounded-full`
- `rounded-[10px]` → context-dependent: badge → `rounded-full`, container → `rounded-lg`
- `text-[0.78rem]` → leave as-is OR add `--font-size-xs: 0.78rem` token

**Don't sweat 1px differences.** Visual sub-pixel differences are imperceptible. The goal is to reduce the count of arbitrary-value classes.

- [ ] **Step 2: Spot-check after each file**

After each file is done: load that file's pages in the browser, eyeball that nothing looks wildly off.

- [ ] **Step 3: Final verify**

```
cd frontend && npm run typecheck && npm run build
```

## Phase 3.2 commit checkpoint

```bash
git status --short
git add frontend/src/   # broad add — only files touched should appear
git commit -m "chore(frontend): P2 polish — normalise off-scale Tailwind arbitrary values

Replaces 100+ arbitrary-value spacing/radius classes (py-[0.45rem],
gap-[0.6rem], rounded-[6px], etc.) with named Tailwind scale steps or
the new --radius-sm2 token. Sub-pixel differences accepted as
imperceptible. Bundle size unchanged; readability improved.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.3: P2 remaining misc (28 items — P2-24 through P2-51)

The long tail.

- [ ] **Step 1: Inline-style → utility leftovers (P2-24, P2-25, P2-26, P2-27, P2-30)**

- `App.tsx:87` `navLinkStyle` — move static `fontFamily: 'var(--font-heading)'` to className.
- `TokensPage.tsx:312` `modalTitle` — move `fontFamily` to className.
- `UserWidget` + `NotificationBell` dropdowns — move `top: calc(100% + 6px)` to className `top-[calc(100%+6px)]`.
- `TokensPage` `tableHeaderRow` / `tableRow` CSSProperties — convert grid layout to Tailwind utilities (`grid grid-cols-[...]`).
- `TokensPage` `modalOverlay` — replace with `fixed inset-0 bg-black/70 flex items-center justify-center z-modal`.

- [ ] **Step 2: Tooltip / popover polish (P2-28)**

GuildPage spell-tier + adorn `<NameListPopover>` extraction is OPTIONAL — after Phase 2b's GuildSpellCheckTab + GuildAdornCheckTab splits, the tooltips live in their respective tabs and the duplication is less acute. DEFER unless they're identical post-split.

(P2-29 IngredientTooltip is task #197 in the global task list. SKIP here — separate engagement.)

- [ ] **Step 3: Hooks discipline (P2-31, P2-32, P2-33, P2-34)**

- `pages/ParsesPage.tsx:238` `setFilter = useCallback((v) => setSize(v), [])` — delete, pass `setSize` directly.
- `pages/RecipesPage.tsx:334-335` `handleSearch`/`handlePage` useCallbacks — these wrap an already-memoised function with no memo-protected children. Delete the wrappers, call `doSearch` directly.
- `pages/RankingsPage.tsx:65-87` — drop the 4 useMemo calls on trivial `.find()` operations on small arrays.
- `pages/RecipesPage.tsx:240-243` — wrap initial URL search params in `useState(() => ...)` lazy initialiser for consistency with ItemSearchPage.

- [ ] **Step 4: Debounce migration (P2-35)**

`pages/SearchPage.tsx` + `components/SpellScrollTooltip.tsx` — replace the inline `useRef<setTimeout>` patterns with `useDebounce` from Task 2a.13.

- [ ] **Step 5: Three sequential effects in ParsePage (P2-36, P2-37)**

Already addressed by Phase 1's useFetch migration (Task 1.12 noted these). DEFERRED — done.

- [ ] **Step 6: `font-mono` documentation (P2-38, P2-49)**

Add a comment to `index.css` near the `--font-body` line:
```css
  /* font-mono is permitted for technical content (regex inputs, hex codes,
     CLI examples, ACT trigger patterns). Game-client tooltip recreations
     (ItemTooltip, SpellScrollTooltip, AATree) intentionally use Times New
     Roman via inline style to mirror the EQ2 client; do not migrate those. */
```

If a custom `--font-mono: 'JetBrains Mono', Consolas, monospace` token is desired, add it to `@theme` here.

- [ ] **Step 7: HDR_KEY_CLS merge (P2-39)**

Already covered in Task 3.1 Step 7.

- [ ] **Step 8: handle<T> reiteration (P2-40)**

Already covered in Task 2c.12. DEFERRED — done.

- [ ] **Step 9: Asset audit (P2-41, P2-42, P2-43)**

`grep -rn "logo.png" frontend/src/` — if not referenced, delete `frontend/public/logo.png`.

Audit `frontend/public/` more broadly — for each file, grep for references. Delete unreferenced.

- [ ] **Step 10: Naming nits (P2-44, P2-45, P2-46, P2-47)**

`_CAT_COLOUR`, `_SHOPPING_KEY`, `_xmlEsc` — covered by P2-7 (Task 3.1 Step 3). DEFERRED — done.

Component naming + boolean naming + file naming — all already conformant. NO ACTION needed.

- [ ] **Step 11: AdminPage `CHUNK = 64` hoist (P2-48)**

`pages/AdminPage.tsx:740`. Hoist to module-level:
```tsx
// URL-length safety cap for the batch-purge endpoint.
const PARSE_BATCH_CHUNK_SIZE = 64
```

- [ ] **Step 12: `activeProfile as number` guard (P2-50)**

`pages/CharacterAAsTab.tsx:235,271`. Add:
```tsx
function isProfileIndex(p: ActiveProfile): p is number {
  return typeof p === 'number'
}
```

Use the guard instead of the cast.

- [ ] **Step 13: Inline `* 1000` date arithmetic (P2-51)**

`pages/AdminPage.tsx:86` + `pages/GuildPage.tsx:1185` — replace with `fmtLocalDate(unixSeconds)` / `fmtRelative(unixSeconds)` (the formatters already do `* 1000` internally).

- [ ] **Step 14: Verify**

```
cd frontend && npm run typecheck && npm run build
```

## Phase 3.3 commit checkpoint

```bash
git status --short
git add frontend/src/   # broad add — only files touched
git commit -m "chore(frontend): P2 polish — remaining misc cleanup

- Inline-style fonts/anchors moved to className utilities
- Over-memoised useCallback/useMemo wrappers removed
- SearchPage + SpellScrollTooltip adopt useDebounce
- font-mono usage documented in index.css
- AdminPage CHUNK and activeProfile guard hoisted/added
- Inline * 1000 date arithmetic replaced with formatters
- Unused public/logo.png + other orphaned assets deleted

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Final gate

After all five phase commits are on the branch:

```bash
cd frontend && npm run typecheck && npm run build && npm run lint
cd .. && git log --oneline origin/main..HEAD
```

Expected: typecheck clean, build clean (no chunk-size warning, since Task 1.13 added manualChunks), lint clean. The branch should show 5 cleanup commits on top of `feature/editable-raid-roster`'s tip.

Push when authorised: `git push origin HEAD:main`.

---

## Self-review

**Spec coverage:**
- P0 items 1–17: all mapped to Tasks 1.1–1.16 (with P0-2 + P0-3 folded into Task 1.5 since they live in the same UserRow component).
- P1 items 1–53: mapped across Phases 2a, 2b, 2c. Specifically:
  - P1-1, P1-2, P1-3, P1-4, P1-5: Tasks 2a.4, 2a.5, 2a.1.
  - P1-6: Tasks 2a.12 + 2c.6.
  - P1-7: Tasks 2a.11 + adopted in 2b GuildPage split.
  - P1-8: Tasks 2a.8 + 2c.2.
  - P1-9: Tasks 2a.7 + 2c.3.
  - P1-10: Tasks 2a.6 + 2c.8.
  - P1-11: covered by the new `<Badge variant="success">` in 2a.7 + Button work in 2c.13.
  - P1-12: Task 2a.3.
  - P1-13: Task 2c.7.
  - P1-14: Task 2a.2.
  - P1-15: covered by Task 1.7 + 1.12.
  - P1-16: covered by Tasks 2a primitives + 2b splits.
  - P1-17, P1-18, P1-19, P1-52: covered by Tasks 2a.9 (Textarea) + 2c.13 (inputCls).
  - P1-20–25: Tasks 2b.1–2b.8.
  - P1-26 through P1-33: Task 2a.14, 2a.15, 2a.17.
  - P1-34: Tasks 2a.10 + 2c.5.
  - P1-35–39: Task 2c.9.
  - P1-40: Task 2a.16.
  - P1-41: Task 2c.10.
  - P1-42: Task 2c.11.
  - P1-43, P1-44: covered by Task 2a.17 + 2c.1 (the `toErrorMessage` migration also standardises the async/await + try/catch pattern).
  - P1-45: Task 2a.17 Step 6.
  - P1-46: Task 2c.13 Step 1.
  - P1-47: Task 2c.13 Step 2.
  - P1-48: Task 2c.12.
  - P1-49: Task 2c.13 Step 3.
  - P1-50: Task 2c.13 Step 4.
- P2 items 1–51: covered across Tasks 3.1, 3.2, 3.3.

No gaps.

**Placeholder scan:** No `TBD` / `TODO` / "similar to Task N" / "implement later" — every step has either a code block or an exact command. Where the file-split tasks (Phase 2b) defer to "the implementer reads the live file" — that's deliberate, because the live file may have shifted since the audit and re-reading is the most reliable source.

**Type consistency:** Hook names (`useFetch`, `useLazyFetch`, `useSortable`, `useTooltipPosition`, `useItemTooltip`, `useDebounce`) consistent across the plan. Primitive names (`TabButton`, `Badge`, `SortTh`, `Textarea`, `DiscordButton`) consistent. Token names (`--color-warning`, `--success-rgb`, `--accent-rgb`, `--z-header` etc.) consistent.

**Decomposition:** Five sub-phases, each shippable independently. Phase 1 is the highest-value (bug fixes); Phases 2a/2b/2c are interrelated (2b uses 2a primitives, 2c migrates remaining callsites). Phase 3 is independent polish.

**Desktop preservation:** P0 fixes deliberately change visible behaviour where the bug was visible (admin actions surface errors, dropdown sits on top, timestamps correct). All other phase changes are no-op refactors. Spot-check after each phase confirms.
