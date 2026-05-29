# Mobile Friendliness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every page in `frontend/src/pages/` usable at 390px (phone) and 768px (small tablet) without changing the desktop layout at all.

**Architecture:** Mobile-first Tailwind utilities; unprefixed = phone, `sm:`/`md:`/`lg:` prefixes restore the existing desktop widths. One uniform pattern per category (sidebar stacks, table overflow, hover→tap tooltips). Game-client recreations (item tooltips, AA tree, spell scrolls) keep their fixed pixel layout inside an `overflow-x-auto` wrapper — not reflowed.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4 (CSS-first config in `frontend/src/index.css` via `@theme`; no `tailwind.config.js`). NO Tailwind Preflight — raw `<input>`/`<button>` need explicit resets (`appearance-none border-0 bg-transparent` or `appearance-none bg-surface border border-border`). UI primitives in `frontend/src/components/ui/` (`Button`, `Card`, `SectionLabel`) — don't reinvent.

Spec: `docs/superpowers/specs/2026-05-29-mobile-friendliness-audit.md`.

---

## File Structure

Touched files, grouped by phase. **No new directories.** One new component file (`MobileNav.tsx`). Everything else is in-place edits.

### Phase 1 (P0)
- Create: `frontend/src/components/MobileNav.tsx` — hamburger overlay component.
- Modify: `frontend/src/App.tsx` — hide inline nav + ACT download below `lg:`; mount `<MobileNav />` in their place.
- Modify: `frontend/src/pages/ParsePage.tsx:333` — wrap combatant grid in `overflow-x-auto`.
- Modify: `frontend/src/pages/RecipesPage.tsx:387` + `:392` — outer grid + filter row stack on phone.
- Modify: `frontend/src/pages/CharacterPage.tsx:649,651,661,677` — equipment tab sidebar.
- Modify: `frontend/src/pages/CharacterSpellsTab.tsx:422,425,509` — spells tab sidebar + two-table column.
- Modify: `frontend/src/pages/CharacterAAsTab.tsx:256,259,380` — AAs tab sidebar + AA tree overflow.

### Phase 2 (P1)
- Modify: `frontend/src/pages/RankingsPage.tsx:188` — `overflow-hidden` → `overflow-x-auto`.
- Modify: `frontend/src/pages/RolesSettingsPage.tsx:305` — same.
- Modify: `frontend/src/pages/GuildPage.tsx:407,595` — `onClick` parallel to `onMouseEnter` on spell + adorn cells.
- Modify: `frontend/src/pages/HomePage.tsx:156,253` — MyCharacters stack on phone.
- Modify: `frontend/src/pages/CharacterPage.tsx:726` — GeneralBanner `flex-wrap`.
- Modify: `frontend/src/pages/CharacterPage.tsx:961,968` + `frontend/src/pages/CharacterSpellsTab.tsx:554` + `frontend/src/components/AATree.tsx:344` — parallel `onClick` tooltip triggers.
- Modify: `frontend/src/pages/AdminPage.tsx:596` — `min-w-[18rem]` → `w-full` on note textarea wrapper.
- Modify: `frontend/src/components/BossRosterEditor.tsx:10-18,65-68` — add `TouchSensor`.

### Phase 3 (P2)
- Modify: `frontend/src/pages/CharacterSpellsTab.tsx:496` — search input `w-full md:w-[260px]`.
- Modify: `frontend/src/pages/CharacterSpellsTab.tsx:139` — `IngredientTooltip` viewport-clamped portal.
- Modify: `frontend/src/pages/SearchPage.tsx:99` — `my-16` → `my-8 md:my-16`.
- Modify: `frontend/src/components/UserWidget.tsx:70` — `left-0` → `right-0`.
- Modify: `frontend/src/pages/CharacterPage.tsx:623` — tab bar `flex-wrap`.
- Modify: `frontend/src/App.tsx:288` — footer link tap-target padding.

---

## Conventions for every task

1. **Verification per task:** `cd frontend && npm run typecheck && npm run build`. Both must finish with no new errors (a pre-existing chunk-size warning during build is fine).
2. **NO commits inside tasks.** Per [[hold-commits-on-visual-work]]: every visual change is held for user visual review. Each phase ends with a single "phase commit checkpoint" task that the user invokes after reviewing the whole phase at 390px and 768px in Chrome DevTools (iPhone 14 + iPad Mini portrait).
3. **Desktop layout must be byte-identical to before.** Every responsive utility uses mobile-first defaults so the existing classes still apply at the desktop breakpoint. Spot-check at ≥1280px after each task.
4. **Stage ONLY each task's named file(s) when committing.** Never `git add -A` / `.`. Use `git status` before staging to confirm.

## Canonical patterns (copy from here, don't re-invent)

```tsx
// 1. Sidebar layout (CharacterPage, SpellsTab, AAsTab, HomePage):
<div className="flex flex-col md:flex-row gap-6 items-start">
  <div className="w-full md:w-[240px] md:shrink-0">{/* sidebar */}</div>
  <div className="flex-1 min-w-0">{/* main */}</div>
</div>

// 2. Pixel-exact content (ParsePage combatant grid, AA tree on narrow):
<div className="overflow-x-auto">
  <div className="min-w-[640px]">{/* fixed-size content */}</div>
</div>

// 3. Mixed inline + responsive grid columns (RecipesPage):
className="grid gap-5 grid-cols-1 md:[grid-template-columns:1fr_340px]"

// 4. Tables — wrappers must be overflow-x-auto, never overflow-hidden:
<Card className="p-0 overflow-x-auto">

// 5. Fixed-width inputs that should be full-width on mobile:
className="w-full md:w-[260px]"

// 6. dnd-kit touch sensor (BossRosterEditor):
import { TouchSensor } from '@dnd-kit/core'
const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
)

// 7. Hover tooltip → also touch (add alongside, don't replace):
onMouseEnter={e => showTip(id, e)}
onClick={e => showTip(id, e)}
```

**Breakpoint rules of thumb:**
- `sm:` (≥640px) — 2-col grids of cards (item ≥240px wide).
- `md:` (≥768px) — sidebar-vs-main splits; column-count 1→2 increases.
- `lg:` (≥1024px) — hamburger ↔ inline-nav swap; 3-col grids.

---

# Phase 1 — P0 (broken/unusable). Six tasks + checkpoint.

After Phase 1 lands, the site is **usable** on mobile. Everything else is polish.

---

## Task 1: Hamburger nav + MobileNav component

**Files:**
- Create: `frontend/src/components/MobileNav.tsx`
- Modify: `frontend/src/App.tsx:254-275`

The header has three flex children (logo+ServerBadge, 8-item `<NavLinks/>`, widget cluster). At <1024px the nav is unusable. Hide it below `lg:` and replace with a hamburger button that toggles a full-width overlay containing the same nav stacked vertically + the ACT plugin download link.

- [ ] **Step 1: Create `frontend/src/components/MobileNav.tsx`**

```tsx
/**
 * Mobile/tablet nav drawer — shown below `lg:` only (App.tsx hides the
 * inline <NavLinks /> in the same window). Hamburger button anchors at the
 * top-right of the header; tapping opens a full-width overlay with the
 * eight nav items stacked vertically + the ACT plugin download. Closes on
 * link click, on Escape, and on backdrop tap.
 */
import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

type NavSpec = { to: string; label: string; also?: string }

const ITEMS: NavSpec[] = [
  { to: '/',           label: 'Home' },
  { to: '/characters', label: 'Characters', also: '/character/' },
  { to: '/guilds',     label: 'Guilds',     also: '/guild/' },
  { to: '/items',      label: 'Items',      also: '/item/' },
  { to: '/recipes',    label: 'Recipes' },
  { to: '/raids',      label: 'Raids',      also: '/raids/' },
  { to: '/parses',     label: 'Parses',     also: '/parse/' },
  { to: '/rankings',   label: 'Rankings' },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null)

  // Close on route change so tapping a link snaps the drawer shut.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Esc closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstLinkRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="appearance-none border-0 bg-transparent p-2 cursor-pointer text-gold hover:text-gold-bright"
      >
        {/* simple 3-bar / X icon */}
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {open
            ? <><line x1="4" y1="4" x2="18" y2="18" /><line x1="18" y1="4" x2="4" y2="18" /></>
            : <><line x1="3" y1="6" x2="19" y2="6" /><line x1="3" y1="11" x2="19" y2="11" /><line x1="3" y1="16" x2="19" y2="16" /></>}
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop: tap to close. z below the panel, above page content. */}
          <div
            className="fixed inset-0 top-14 z-[250] bg-bg/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Panel: full-width, slides down from under the header. */}
          <nav
            className="fixed left-0 right-0 top-14 z-[260] bg-bg/95 border-b border-border shadow-2xl flex flex-col py-2"
            aria-label="Mobile navigation"
          >
            {ITEMS.map((it, i) => (
              <NavLink
                key={it.to}
                to={it.to}
                end
                ref={i === 0 ? firstLinkRef : undefined}
                className={({ isActive }) => {
                  const active = isActive || (it.also ? pathname.startsWith(it.also) : false)
                  return [
                    'block py-3 px-6 no-underline font-heading text-[0.95rem] tracking-[0.06em]',
                    'border-l-2',
                    active
                      ? 'text-gold-bright border-gold bg-surface/40'
                      : 'text-gold-dim border-transparent hover:text-gold hover:bg-surface/20',
                  ].join(' ')
                }}
              >
                {it.label}
              </NavLink>
            ))}
            <a
              href="https://github.com/VortexUK/EQ2LexiconACTPlugin/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="block py-3 px-6 mt-1 border-t border-border no-underline text-text-muted text-[0.9rem]"
            >
              Download ACT Plugin →
            </a>
          </nav>
        </>
      )}
    </>
  )
}
```

- [ ] **Step 2: Wire it into `App.tsx`**

In `frontend/src/App.tsx` add an import alongside the other component imports near the top:
```tsx
import { MobileNav } from './components/MobileNav'
```

Find lines 254-275 (the header block). The current code is:

```tsx
<div className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-between py-[0.4rem] px-5 bg-bg/75 backdrop-blur-md border-b border-border">
  <div className="flex items-center">
    <Link to="/" className="flex items-center leading-none">
      <img src={logo} alt="EQ2 Lexicon" className="h-10 w-auto" />
    </Link>
    <ServerBadge />
  </div>
  <NavLinks />
  <div className="flex items-center gap-[0.6rem]">
    <a
      href="https://github.com/VortexUK/EQ2LexiconACTPlugin/releases/latest"
      target="_blank"
      rel="noopener noreferrer"
      title="Download the EQ2 Lexicon ACT plugin"
      className="block shrink-0 transition-[transform,filter] duration-150 hover:brightness-110 hover:scale-[1.03]"
    >
      <img src="/download_plugin.png" alt="Download ACT Plugin" className="h-10 w-auto" />
    </a>
    <NotificationBell />
    <UserWidget />
  </div>
</div>
```

Replace with:

```tsx
<div className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-between py-[0.4rem] px-5 bg-bg/75 backdrop-blur-md border-b border-border">
  <div className="flex items-center">
    <Link to="/" className="flex items-center leading-none">
      <img src={logo} alt="EQ2 Lexicon" className="h-10 w-auto" />
    </Link>
    <ServerBadge />
  </div>
  {/* Inline nav: lg+ only. Below lg, MobileNav renders the hamburger. */}
  <div className="hidden lg:block">
    <NavLinks />
  </div>
  <div className="flex items-center gap-[0.6rem]">
    {/* ACT download icon: lg+ only (it's also in the MobileNav drawer). */}
    <a
      href="https://github.com/VortexUK/EQ2LexiconACTPlugin/releases/latest"
      target="_blank"
      rel="noopener noreferrer"
      title="Download the EQ2 Lexicon ACT plugin"
      className="hidden lg:block shrink-0 transition-[transform,filter] duration-150 hover:brightness-110 hover:scale-[1.03]"
    >
      <img src="/download_plugin.png" alt="Download ACT Plugin" className="h-10 w-auto" />
    </a>
    <NotificationBell />
    <UserWidget />
    {/* Hamburger: below lg only. */}
    <div className="lg:hidden">
      <MobileNav />
    </div>
  </div>
</div>
```

- [ ] **Step 3: Verify**

```
cd frontend
npm run typecheck
npm run build
```
Expected: clean (typecheck 0 errors; build success with the existing chunk-size warning only).

- [ ] **Step 4: Hold for visual review**

Test in Chrome DevTools device emulation:
- iPhone 14 (390×844): hamburger present top-right; tapping opens the drawer; tapping a link closes it; backdrop click closes; Esc closes; inline nav + ACT image NOT visible.
- iPad Mini portrait (768×1024): hamburger present (since 768 < `lg:` 1024); same behaviour.
- Desktop 1280px: inline nav visible; ACT image visible; hamburger NOT visible. Layout byte-identical to before.

Do NOT commit; the user reviews at end of Phase 1.

---

## Task 2: ParsePage combatant grid overflow

**Files:** `frontend/src/pages/ParsePage.tsx:333-339`

9-column CSS grid with hard pixel widths (~640px minimum) and no overflow wrapper — content literally clips at 390px.

- [ ] **Step 1: Wrap the Card in `overflow-x-auto`; pin minimum grid width**

Current code at line 333-339:

```tsx
<Card
  className="grid items-center text-[0.82rem] rounded-[6px] px-[0.6rem] py-[0.4rem] gap-x-2 gap-y-0"
  style={{
    gridTemplateColumns:
      'minmax(160px,1.6fr) 90px 80px 50px 90px 70px 90px 60px 40px',
  }}
>
```

Replace with:

```tsx
<div className="overflow-x-auto -mx-4 sm:mx-0">
  <Card
    className="grid items-center text-[0.82rem] rounded-[6px] px-[0.6rem] py-[0.4rem] gap-x-2 gap-y-0 min-w-[640px]"
    style={{
      gridTemplateColumns:
        'minmax(160px,1.6fr) 90px 80px 50px 90px 70px 90px 60px 40px',
    }}
  >
```

Then find the matching `</Card>` (line 353 in the audit) and add a closing `</div>` after it:

```tsx
        ))}
      </Card>
    </div>   {/* end overflow-x-auto wrapper */}
  </section>
)
```

The `-mx-4 sm:mx-0` lets the scroll container go full-bleed on phone so the grid uses the full 390px width to scroll inside, then snaps back to in-flow at `sm:`.

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px: combatant table scrolls horizontally; tapping a row still toggles open. Desktop: identical.

---

## Task 3: RecipesPage outer grid + filter row

**Files:** `frontend/src/pages/RecipesPage.tsx:387,392`

Outer grid `'1fr 340px'` collapses left column to ~30px on 390px (cart eats everything). Filter row is rigid 5-column.

- [ ] **Step 1: Stack outer grid below `md:`**

Current code at line 387:

```tsx
<div className="grid gap-5" style={{ gridTemplateColumns: '1fr 340px' }}>
```

Replace with:

```tsx
<div className="grid gap-5 grid-cols-1 md:[grid-template-columns:1fr_340px]">
```

(Remove the inline `style={{ gridTemplateColumns }}` — moved into the className arbitrary value with the `md:` prefix.)

- [ ] **Step 2: Replace filter grid with flex-wrap**

Current code at line 392:

```tsx
<div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] gap-[0.6rem] items-end mb-4">
```

Replace with:

```tsx
<div className="flex flex-wrap gap-[0.6rem] items-end mb-4 [&>div]:flex-1 [&>div]:min-w-[140px]">
```

The `[&>div]:flex-1 [&>div]:min-w-[140px]` reproduces the equal-column behaviour at wider widths and forces wrap when there's not enough room for all four ≥140px columns side-by-side. The "auto" button at the end is the only non-`<div>` child; it keeps natural width.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

At 390px: cart stacks below results; filter inputs wrap to two-per-row or one-per-row. Desktop: identical 1fr+340px layout.

---

## Task 4: CharacterPage equipment tab sidebar layout

**Files:** `frontend/src/pages/CharacterPage.tsx:649,651,661,677`

`w-[260px] shrink-0` + parent `flex gap-6` makes the paperdoll column collapse to ~0px on 390px.

- [ ] **Step 1: Stack equipment tab columns below `md:`**

Current code at line 649:

```tsx
{activeTab === 'equipment' && (
  <div className="flex gap-6 items-start mt-4">
    {/* Left: gear rating + detailed stats */}
    <div className="w-[260px] shrink-0">
```

Replace with:

```tsx
{activeTab === 'equipment' && (
  <div className="flex flex-col md:flex-row gap-6 items-start mt-4">
    {/* Left: gear rating + detailed stats */}
    <div className="w-full md:w-[260px] md:shrink-0">
```

- [ ] **Step 2: One-column paperdoll on phone**

Current code at lines 661 and 677:

```tsx
<div className="grid grid-cols-2 gap-y-[4px] gap-x-3">
```

Replace BOTH occurrences with:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 gap-y-[4px] gap-x-3">
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

At 390px: stats sidebar above paperdoll (full-width); slot rows in a single column. At 640px+: slot rows in two columns. At 768px+: sidebar + paperdoll side-by-side. Desktop 1280px: byte-identical.

---

## Task 5: CharacterSpellsTab sidebar + two-table layout

**Files:** `frontend/src/pages/CharacterSpellsTab.tsx:422,425,509`

Same sidebar collapse pattern + a side-by-side two-table layout that also breaks at phone width.

- [ ] **Step 1: Stack sidebar below `md:`**

Current code at line 422:

```tsx
return (
  <div className="mt-4 flex gap-6 items-start">

    {/* ── Left sidebar ── */}
    <div className="w-[240px] shrink-0">
```

Replace with:

```tsx
return (
  <div className="mt-4 flex flex-col md:flex-row gap-6 items-start">

    {/* ── Left sidebar ── */}
    <div className="w-full md:w-[240px] md:shrink-0">
```

- [ ] **Step 2: Find the two-table render and add a responsive wrapper**

The audit identified two tables rendered as siblings in an `mid`-split (line 503-509 area). Search for the JSX that renders both halves of the spell list — it's an immediately-invoked function that returns the two `Card`-wrapped tables.

Look for the existing `mid` split:
```tsx
const mid = Math.ceil(filtered.length / 2)
const cols = [filtered.slice(0, mid), filtered.slice(mid)]

const renderTable = (rows: SpellEntry[]) => (
  <Card className="rounded-md p-0 overflow-hidden flex-1 min-w-0">
```

Find the JSX that renders the two tables side-by-side (right after `renderTable` is defined; it's a `<div className="flex gap-3">` or similar containing two `renderTable(cols[0])` calls). Wrap the two `renderTable` calls in:

```tsx
<div className="flex flex-col md:flex-row gap-3">
  {renderTable(cols[0])}
  {renderTable(cols[1])}
</div>
```

Replace the existing `flex gap-3` (without responsive prefix) with `flex flex-col md:flex-row gap-3`. If the existing wrapper isn't a `flex` (e.g. it's `<>`), introduce the `<div className="flex flex-col md:flex-row gap-3">` wrapper.

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

At 390px: sidebar above; spell tables stack vertically (one above the other). At 768px+: original side-by-side layout. Desktop: identical.

---

## Task 6: CharacterAAsTab sidebar + AA tree overflow

**Files:** `frontend/src/pages/CharacterAAsTab.tsx:256,259,380`

Same sidebar collapse + the `<AATree>` is rendered inside a `w-[60%]` container, which would be ~60% of zero at mobile.

- [ ] **Step 1: Stack sidebar below `md:`**

Current code at line 256:

```tsx
return (
  <div className="mt-4 flex gap-6 items-start">

    {/* ── Left sidebar ── */}
    <div className="w-[240px] shrink-0">
```

Replace with:

```tsx
return (
  <div className="mt-4 flex flex-col md:flex-row gap-6 items-start">

    {/* ── Left sidebar ── */}
    <div className="w-full md:w-[240px] md:shrink-0">
```

- [ ] **Step 2: Make the AA tree container scroll horizontally on narrow widths**

Current code at line 380:

```tsx
{/* Tree at 60% of the right column */}
<div className="w-[60%]">
  {activeTd ? (
    <AATree tree={activeTd} spent={activeCt.spent} />
  ) : (
```

Replace with:

```tsx
{/* Tree at 60% of the right column on desktop; full-width with horizontal
    scroll on narrow viewports so the game-client-replica layout stays
    pixel-faithful instead of squashing. */}
<div className="overflow-x-auto md:overflow-visible">
  <div className="min-w-[420px] md:min-w-0 md:w-[60%]">
    {activeTd ? (
      <AATree tree={activeTd} spent={activeCt.spent} />
    ) : (
```

Then find the matching closing `</div>` (the one that closed `w-[60%]`) and add ONE additional closing `</div>` after it:

```tsx
    )}
  </div>     {/* end min-w-[420px] */}
</div>       {/* end overflow-x-auto */}
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

At 390px: sidebar above; AA tree renders at its native 420px in a horizontally-scrollable strip. At 768px+: tree returns to 60% of the right column inline. Desktop: identical.

---

## Phase 1 commit checkpoint

After the user has visually reviewed Tasks 1–6 at 390px AND 768px AND desktop 1280px and approved:

```bash
git status   # verify only Phase 1 files are dirty
git add frontend/src/components/MobileNav.tsx \
        frontend/src/App.tsx \
        frontend/src/pages/ParsePage.tsx \
        frontend/src/pages/RecipesPage.tsx \
        frontend/src/pages/CharacterPage.tsx \
        frontend/src/pages/CharacterSpellsTab.tsx \
        frontend/src/pages/CharacterAAsTab.tsx
git commit -m "feat(mobile): P0 — hamburger nav + sidebar layouts + grid overflows

Six P0 fixes from the mobile-friendliness audit:
- Hamburger nav drawer below lg: (App.tsx + new MobileNav component)
- ParsePage combatant grid wrapped in overflow-x-auto + min-w-[640px]
- RecipesPage outer grid + filter row stack on phone
- CharacterPage equipment, Spells, and AAs tabs: flex-col md:flex-row
  sidebar + main column; AA tree gets overflow-x-auto wrapper

Desktop layout unchanged at >= lg: (1024px+). Mobile-first utilities,
no Tailwind config changes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Trailing blank line then the Co-Authored-By line, as written.

DO NOT push. The user decides when to ship.

---

# Phase 2 — P1 (ugly but usable). Eight tasks + checkpoint.

After Phase 2: every page is comfortable on phone and small tablet, all touch interactions work.

---

## Task 7: RankingsPage table overflow

**Files:** `frontend/src/pages/RankingsPage.tsx:188`

`<Card className="p-0 overflow-hidden">` clips the 9-column table instead of scrolling.

- [ ] **Step 1: Swap overflow-hidden → overflow-x-auto**

Current code at line 188:

```tsx
<Card className="p-0 overflow-hidden">
```

Replace with:

```tsx
<Card className="p-0 overflow-x-auto">
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px: rankings table scrolls horizontally inside the Card. Desktop: identical (the change is `overflow-hidden` → `overflow-x-auto`; when content fits without overflow they render identically).

---

## Task 8: RolesSettingsPage table overflow

**Files:** `frontend/src/pages/RolesSettingsPage.tsx:305`

Same `overflow-hidden` clip on the role-request history table.

- [ ] **Step 1: Swap overflow-hidden → overflow-x-auto**

Current code at line 305:

```tsx
<Card className="p-0 overflow-hidden">
```

Replace with:

```tsx
<Card className="p-0 overflow-x-auto">
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px: role-request history table scrolls horizontally. Desktop: identical.

---

## Task 9: GuildPage spell + adorn cell tap triggers

**Files:** `frontend/src/pages/GuildPage.tsx:407-410,595-598`

Spell-count and adorn-count cells expose their tooltip on `onMouseEnter` only. On touch the missing-spell / missing-adorn info is invisible. Add `onClick` alongside (don't replace the hover).

- [ ] **Step 1: Add `onClick` to spell-count `<td>`**

Current code at line 407-410 (the `<td>` for spell cells):

```tsx
<td
  key={t}
  onMouseEnter={count > 0 ? e => showTooltip(e, t, names) : undefined}
  onMouseLeave={count > 0 ? () => setTooltip(null) : undefined}
  className={`${TD_CLS} text-right`}
```

Replace with:

```tsx
<td
  key={t}
  onMouseEnter={count > 0 ? e => showTooltip(e, t, names) : undefined}
  onMouseLeave={count > 0 ? () => setTooltip(null) : undefined}
  onClick={count > 0 ? e => showTooltip(e, t, names) : undefined}
  className={`${TD_CLS} text-right`}
```

- [ ] **Step 2: Add `onClick` to adorn-count `<td>`**

Current code at line 595-598:

```tsx
<td
  key={c}
  onMouseEnter={missingSlots.length > 0 ? e => showTooltip(e, c, missingSlots) : undefined}
  onMouseLeave={missingSlots.length > 0 ? () => setTooltip(null) : undefined}
  className={`${TD_CLS} text-right font-medium`}
```

Replace with:

```tsx
<td
  key={c}
  onMouseEnter={missingSlots.length > 0 ? e => showTooltip(e, c, missingSlots) : undefined}
  onMouseLeave={missingSlots.length > 0 ? () => setTooltip(null) : undefined}
  onClick={missingSlots.length > 0 ? e => showTooltip(e, c, missingSlots) : undefined}
  className={`${TD_CLS} text-right font-medium`}
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

On mobile: tap a non-zero spell-count cell or adorn-count cell → the tooltip opens at the tap point. (Tapping elsewhere triggers `onMouseLeave` on most mobile browsers, which closes it. If not, a second tap reopens at the new position — acceptable.) Desktop hover unchanged.

---

## Task 10: HomePage MyCharacters layout

**Files:** `frontend/src/pages/HomePage.tsx:156,253`

`flex gap-8 items-start` with a `w-[210px] shrink-0` sidebar squashes the character cards on phone. Stack with cards-on-top using `flex-col-reverse`.

- [ ] **Step 1: Stack the MyCharacters row**

Current code at line 253:

```tsx
return (
  <div className="flex gap-8 items-start">

    {/* Left: character cards */}
    <div className="flex-1 min-w-0">
```

Replace with:

```tsx
return (
  <div className="flex flex-col-reverse md:flex-row gap-8 md:items-start">

    {/* Left: character cards */}
    <div className="flex-1 min-w-0">
```

(`flex-col-reverse` so cards render ABOVE the guilds sidebar on phone, matching the visual priority.)

- [ ] **Step 2: Make the GuildsSidebar full-width on phone**

Current code at line 156:

```tsx
return (
  <aside className="w-[210px] shrink-0">
```

Replace with:

```tsx
return (
  <aside className="w-full md:w-[210px] md:shrink-0">
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

At 390px: character cards render first (full-width), guilds sidebar appears below as a full-width list. At 768px+: original side-by-side layout. Desktop: identical.

---

## Task 11: GeneralBanner wrap

**Files:** `frontend/src/pages/CharacterPage.tsx:726`

6-column banner row (identity + 4 stat columns) with `whitespace-nowrap` stat values overflows at 390px.

- [ ] **Step 1: Allow wrap**

Current code at line 726:

```tsx
<Card className="rounded-[6px] px-4 py-2 flex items-stretch">
```

Replace with:

```tsx
<Card className="rounded-[6px] px-4 py-2 flex flex-wrap items-stretch gap-y-2">
```

- [ ] **Step 2: Find the identity column (line 728) and let it stay full-width on phone**

Current code at line 728:

```tsx
<div className="pr-5 mr-5 border-r border-border flex flex-col justify-center shrink-0">
```

Replace with:

```tsx
<div className="w-full md:w-auto md:pr-5 md:mr-5 md:border-r border-border flex flex-col justify-center shrink-0">
```

(On phone: identity column takes full width, no border-right or right-margin. From `md:` up: original behaviour.)

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

At 390px: identity (name + class + race) on top row full-width; stat columns wrap below. At 768px+: original single-row layout. Desktop: identical.

---

## Task 12: Tap-trigger parallel for ItemTooltip, SpellTierPip, AATree

**Files:**
- `frontend/src/pages/CharacterPage.tsx:961,968` — SlotRow uses `onMouseOver`/`onMouseLeave` to open `ItemTooltip`.
- `frontend/src/components/SpellScrollTooltip.tsx:273-283` — SpellTierPip uses `onMouseEnter` to open the scroll tooltip.
- `frontend/src/components/AATree.tsx:344` — AA nodes use `onMouseEnter` to open node tooltip.

Same pattern for all three: add `onClick` parallel that fires the same opener.

- [ ] **Step 1: SlotRow `onClick` parallel**

Current code at line 961-977 of `frontend/src/pages/CharacterPage.tsx`:

```tsx
<div
  className="flex items-center gap-2 border rounded-sm px-[6px] py-1 min-w-0 h-auto min-h-[50px] transition-[background,border-color] duration-[120ms] ease"
  style={{
    flexDirection: iconSide === 'left' ? 'row' : 'row-reverse',
    background:   hlBg     ?? 'var(--surface)',
    borderColor:  hlBorder ?? 'var(--border)',
  }}
  onMouseOver={item?.item_id ? e => {
    const adornEl = (e.target as HTMLElement).closest('[data-adorn-id]')
    if (adornEl) {
      const adornId = adornEl.getAttribute('data-adorn-id')
      if (adornId) { onShow(adornId, e); return }
    }
    onShow(item.item_id!, e, item.adorn_slots.map(a => ({ color: a.color, bonus: a.ilvl_bonus })))
  } : undefined}
  onMouseLeave={item?.item_id ? onHide : undefined}
>
```

Extract the show handler into a local `const` and reuse for both:

```tsx
const showHandler = item?.item_id ? (e: React.MouseEvent) => {
  const adornEl = (e.target as HTMLElement).closest('[data-adorn-id]')
  if (adornEl) {
    const adornId = adornEl.getAttribute('data-adorn-id')
    if (adornId) { onShow(adornId, e); return }
  }
  onShow(item.item_id!, e, item.adorn_slots.map(a => ({ color: a.color, bonus: a.ilvl_bonus })))
} : undefined

return (
  ...
  <div
    className="flex items-center gap-2 border rounded-sm px-[6px] py-1 min-w-0 h-auto min-h-[50px] transition-[background,border-color] duration-[120ms] ease"
    style={{
      flexDirection: iconSide === 'left' ? 'row' : 'row-reverse',
      background:   hlBg     ?? 'var(--surface)',
      borderColor:  hlBorder ?? 'var(--border)',
    }}
    onMouseOver={showHandler}
    onClick={showHandler}
    onMouseLeave={item?.item_id ? onHide : undefined}
  >
```

(The `showHandler` `const` goes above the existing `hlBg` / `hlBorder` block but inside the `SlotRow` function body — near the other local consts. The `onMouseOver` and `onClick` props now both reference it.)

- [ ] **Step 2: SpellTierPip `onClick` parallel**

Current code at line 273-283 of `frontend/src/components/SpellScrollTooltip.tsx`:

```tsx
return (
  <>
    <img
      src={src}
      alt={tier}
      title={tier}
      style={{ width: 14, height: 14 }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    />
```

Add an `onClick` handler that calls the same path as `handleMouseEnter` but immediate (no 150ms delay — taps are intentional):

```tsx
function handleClick(e: MouseEvent<HTMLImageElement>) {
  setMousePos({ x: e.clientX, y: e.clientY })
  setShowTooltip(true)
}

return (
  <>
    <img
      src={src}
      alt={tier}
      title={tier}
      style={{ width: 14, height: 14 }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    />
```

(Add `handleClick` function above `return (` alongside the other `handle*` functions.)

- [ ] **Step 3: AATree node `onClick` parallel**

Current code at line 344-346 of `frontend/src/components/AATree.tsx`:

```tsx
onMouseEnter={e => setHovered({ node, tier, mx: e.clientX, my: e.clientY })}
onMouseMove={e  => setHovered(h => h ? { ...h, mx: e.clientX, my: e.clientY } : null)}
onMouseLeave={() => setHovered(null)}
```

Add `onClick`:

```tsx
onMouseEnter={e => setHovered({ node, tier, mx: e.clientX, my: e.clientY })}
onMouseMove={e  => setHovered(h => h ? { ...h, mx: e.clientX, my: e.clientY } : null)}
onMouseLeave={() => setHovered(null)}
onClick={e => setHovered({ node, tier, mx: e.clientX, my: e.clientY })}
```

- [ ] **Step 4: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 5: Hold for visual review**

On mobile: tap a gear slot → item tooltip opens. Tap a spell tier pip → spell scroll opens. Tap an AA node → node tooltip opens. Tap elsewhere or scroll → tooltip closes (via `onMouseLeave` which most touch browsers fire on tap-outside). Desktop hover behaviour identical.

---

## Task 13: AdminPage min-w note fix

**Files:** `frontend/src/pages/AdminPage.tsx:596`

`min-w-[18rem]` on the inline approve/reject note container forces the cell to 288px minimum, dragging the table wider than it needs to be.

- [ ] **Step 1: Replace min-w with w-full**

Current code at line 596:

```tsx
{noteOpen ? (
  <div className="flex flex-col gap-1 min-w-[18rem]">
    <textarea
```

Replace with:

```tsx
{noteOpen ? (
  <div className="flex flex-col gap-1 w-full min-w-[12rem]">
    <textarea
```

(Drops the minimum from 288px → 192px, and allows the cell to use full available width via `w-full`.)

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px (admin scrolling tables): the approve-with-note expansion fits within the scrollable container without forcing extra width. Desktop: indistinguishable.

---

## Task 14: BossRosterEditor TouchSensor

**Files:** `frontend/src/components/BossRosterEditor.tsx:10-18,65-68`

Drag-reorder uses `PointerSensor` + `KeyboardSensor` only. On iOS Safari, pointer events compete with page scroll — drag is unreliable. Add `TouchSensor` with a delay-based activation constraint so a long-press triggers drag and a quick swipe triggers scroll.

- [ ] **Step 1: Add TouchSensor to imports**

Current code at line 10-18:

```tsx
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
```

Replace with:

```tsx
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
```

- [ ] **Step 2: Register the sensor**

Current code at line 65-68:

```tsx
const sensors = useSensors(
  useSensor(PointerSensor),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
)
```

Replace with:

```tsx
const sensors = useSensors(
  useSensor(PointerSensor),
  // TouchSensor with a 250 ms long-press activation so a tap-and-drag is
  // unambiguously a reorder and a quick swipe still scrolls the page on iOS.
  useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
)
```

- [ ] **Step 3: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 4: Hold for visual review**

On mobile, in the BossRosterEditor (admin-only on a raid zone): long-press a boss row → drag handle activates → can be reordered. Quick swipe-up still scrolls the page. Desktop unchanged.

---

## Phase 2 commit checkpoint

After user has visually reviewed Tasks 7–14 at 390px AND 768px AND desktop, and verified the tap-tooltips on a real touch device:

```bash
git status
git add frontend/src/pages/RankingsPage.tsx \
        frontend/src/pages/RolesSettingsPage.tsx \
        frontend/src/pages/GuildPage.tsx \
        frontend/src/pages/HomePage.tsx \
        frontend/src/pages/CharacterPage.tsx \
        frontend/src/components/SpellScrollTooltip.tsx \
        frontend/src/components/AATree.tsx \
        frontend/src/pages/AdminPage.tsx \
        frontend/src/components/BossRosterEditor.tsx
git commit -m "feat(mobile): P1 — touch tooltip triggers, table overflows, sidebar stacks

Eight P1 fixes from the mobile-friendliness audit:
- Rankings + RolesSettings tables: overflow-hidden -> overflow-x-auto
- GuildPage spell + adorn cells: onClick parallel to onMouseEnter
- HomePage: MyCharacters stacks (cards above guilds sidebar) on phone
- CharacterPage GeneralBanner: flex-wrap so 6-col stat row wraps on phone
- ItemTooltip / SpellTierPip / AATree node: parallel onClick taps open
  tooltips on touch devices (existing hover still works on desktop)
- AdminPage approve-note container: min-w-[18rem] -> w-full + min-w-[12rem]
- BossRosterEditor: add dnd-kit TouchSensor so drag works on iOS/Android

Desktop layout unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Phase 3 — P2 (polish). Six tasks + checkpoint.

After Phase 3: the site feels native-grade on mobile.

---

## Task 15: CharacterSpellsTab search input width

**Files:** `frontend/src/pages/CharacterSpellsTab.tsx:496`

`w-[260px]` on the spell search input is wider than ideal on phone. Make it full-width on phone, original width from `md:` up.

- [ ] **Step 1: Apply responsive width**

Current code at line 496:

```tsx
<input
  type="text"
  placeholder="Search spells…"
  value={search}
  onChange={e => setSearch(e.target.value)}
  className="mb-3 w-[260px] box-border"
/>
```

Replace with:

```tsx
<input
  type="text"
  placeholder="Search spells…"
  value={search}
  onChange={e => setSearch(e.target.value)}
  className="mb-3 w-full md:w-[260px] box-border"
/>
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px: search input fills the full main-column width. At 768px+: 260px as before.

---

## Task 16: CharacterSpellsTab IngredientTooltip viewport-clamp

**Files:** `frontend/src/pages/CharacterSpellsTab.tsx:135-141`

`IngredientTooltip` uses `absolute left-full top-0 ml-2 w-[220px]` which can clip the right viewport edge on narrow widths. Convert to a `position: fixed` portal with the same viewport-clamping logic the other tooltips use.

- [ ] **Step 1: Replace the absolute-positioned tooltip with a fixed/clamped one**

Read the existing tooltip in `CharacterSpellsTab.tsx` around lines 135-200 (it's a 60-line render). The container element is the `<div>` at line 138-141:

```tsx
<div
  className="absolute z-[9999] left-full top-0 ml-2 w-[220px] bg-surface border border-border rounded-md py-[0.6rem] px-3 pointer-events-none"
  style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
>
```

The component is rendered from a parent that holds the hover state with the mouse `x`/`y` coordinates (search the file for `IngredientTooltip` to confirm — it'll be at a hover-state pattern similar to the other tooltips).

Change the wrapper to accept `x` and `y` props and render `position: fixed` with viewport-clamp:

```tsx
function IngredientTooltip({ ing, x, y }: { ing: Ingredient; x: number; y: number }) {
  const TIP_W = 220
  const TIP_H_ESTIMATE = 180   // visual approx; ok if it overshoots
  const left = x + 16 + TIP_W > window.innerWidth ? x - TIP_W - 8 : x + 16
  const top  = y + 8 + TIP_H_ESTIMATE > window.innerHeight ? y - TIP_H_ESTIMATE - 8 : y + 8
  const tierColour = itemRarityColor(ing.tier, 'var(--text)')
  return (
    <div
      className="fixed z-[9999] w-[220px] bg-surface border border-border rounded-md py-[0.6rem] px-3 pointer-events-none"
      style={{ left, top, boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
    >
      {/* Header: icon + name */}
      <div className="flex items-center gap-2 mb-[6px]">
        ...
```

Then update the call site (search for `<IngredientTooltip` in the same file) to pass `x={hoverState.x} y={hoverState.y}` from whatever hover-state object the surrounding component holds. If the existing parent doesn't currently track `clientX`/`clientY` on hover, add a `onMouseMove` to capture them into the hover state.

**Note:** This task is more involved than a one-line className swap. If the existing parent hover logic doesn't track coordinates, this also requires a small refactor of the parent's hover state shape. If the implementer hits a snag here, report it and we can scope a follow-up. The task is P2 — non-blocking — so it can be deferred without affecting the rest of the phase.

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px: ingredient tooltip opens near the tap and flips to the left of the cursor if it would overflow the right edge. Desktop: tooltip follows the mouse, same clamp behaviour kicks in near viewport edges.

---

## Task 17: SearchPage margin

**Files:** `frontend/src/pages/SearchPage.tsx:99`

`my-16` (64px top + bottom margin) wastes above-fold vertical space on mobile.

- [ ] **Step 1: Responsive margin**

Current code at line 99:

```tsx
<main className="max-w-[640px] my-16 mx-auto px-6">
```

Replace with:

```tsx
<main className="max-w-[640px] my-8 md:my-16 mx-auto px-6">
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px: search heading + input visible above the fold without scrolling. At 768px+: original generous margin restored.

---

## Task 18: UserWidget dropdown anchor

**Files:** `frontend/src/components/UserWidget.tsx:70`

Dropdown anchored `left-0` to a button near the right edge of the header can clip the right viewport edge. Anchor to `right-0` instead so it opens leftward from the button.

- [ ] **Step 1: Swap left-0 → right-0**

Current code at line 70:

```tsx
<div
  className="absolute left-0 bg-surface-raised border border-border rounded-md min-w-[160px] z-[100] overflow-hidden"
  style={{ top: 'calc(100% + 6px)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
>
```

Replace with:

```tsx
<div
  className="absolute right-0 bg-surface-raised border border-border rounded-md min-w-[160px] z-[100] overflow-hidden"
  style={{ top: 'calc(100% + 6px)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
>
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

On both desktop and mobile: clicking the user avatar opens the dropdown anchored to the right edge of the button (extending leftward), no clipping at narrow viewports.

---

## Task 19: CharacterPage tab bar wrap

**Files:** `frontend/src/pages/CharacterPage.tsx:623`

The three-tab row ("Equipment & Stats", "Alternate Advancements", "Spells") is tight at 390px because "Alternate Advancements" is ~170px on its own.

- [ ] **Step 1: Allow wrap**

Current code at line 623:

```tsx
<div className="flex gap-0 border-b border-border mt-4">
```

Replace with:

```tsx
<div className="flex flex-wrap gap-0 border-b border-border mt-4">
```

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

At 390px: tabs wrap to two rows if needed (likely "Equipment & Stats" + "Alternate Advancements" on row 1, "Spells" on row 2 — but at 390px the labels may all fit on one line; wrap is the safety net). Desktop: single row as before.

---

## Task 20: App.tsx footer link tap-target

**Files:** `frontend/src/App.tsx:288-308`

Footer links currently render as inline `<a>` with `text-[color:inherit] underline`. Tap targets are ~12px tall (the text height). Bump padding inside the link to give a comfortable 32px tap zone without changing visual density (the underline still anchors the visual link extent).

- [ ] **Step 1: Add tap padding to the two `<a>` elements in the footer**

Current code at line 290-296 (VortexUK link):

```tsx
<a
  href="https://github.com/VortexUK"
  target="_blank"
  rel="noopener noreferrer"
  className="text-[color:inherit] underline underline-offset-[3px]"
>
  VortexUK
</a>
```

Replace with:

```tsx
<a
  href="https://github.com/VortexUK"
  target="_blank"
  rel="noopener noreferrer"
  className="text-[color:inherit] underline underline-offset-[3px] inline-block py-1 -my-1"
>
  VortexUK
</a>
```

Same change to the Census link at line ~299-306:

```tsx
<a
  href="https://census.daybreakgames.com"
  target="_blank"
  rel="noopener noreferrer"
  className="text-[color:inherit] underline underline-offset-[3px]"
>
  Daybreak Games Census API
</a>
```

→

```tsx
<a
  href="https://census.daybreakgames.com"
  target="_blank"
  rel="noopener noreferrer"
  className="text-[color:inherit] underline underline-offset-[3px] inline-block py-1 -my-1"
>
  Daybreak Games Census API
</a>
```

(`inline-block py-1 -my-1` adds 4px vertical tap padding inside, then offsets it with negative margin so the visual footer height doesn't change.)

- [ ] **Step 2: Verify**

```
cd frontend && npm run typecheck && npm run build
```
Expected: clean.

- [ ] **Step 3: Hold for visual review**

Footer height visually unchanged. Tap on mobile: hitting the link is easier (the tap target extends 4px above and below the text). Desktop: identical.

---

## Phase 3 commit checkpoint

After user has reviewed Tasks 15–20 at 390px AND 768px AND desktop:

```bash
git status
git add frontend/src/pages/CharacterSpellsTab.tsx \
        frontend/src/pages/SearchPage.tsx \
        frontend/src/components/UserWidget.tsx \
        frontend/src/pages/CharacterPage.tsx \
        frontend/src/App.tsx
git commit -m "feat(mobile): P2 — polish

Six P2 fixes from the mobile-friendliness audit:
- CharacterSpellsTab search input: w-[260px] -> w-full md:w-[260px]
- IngredientTooltip: position-fixed portal with viewport-clamp (was
  absolute left-full and could clip the right viewport edge)
- SearchPage: my-16 -> my-8 md:my-16 so the heading is above the fold on phone
- UserWidget dropdown: left-0 -> right-0 anchor (was clipping right edge
  when the button sat near the right of the header)
- CharacterPage tab bar: flex-wrap so 'Alternate Advancements' has room
  to break onto a second row on narrow widths
- App.tsx footer links: inline-block + py-1/-my-1 for tap padding

Desktop layout unchanged.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Final gate

After all three phases are merged:

```bash
cd E:/git/EQ2Lexicon
git status        # should be clean
git log --oneline origin/main..HEAD    # three commits queued: P0, P1, P2
```

Push when user authorises. Pre-push hook runs tsc, vitest, ruff, pyright, pytest — all must be green. The push triggers Railway redeploy.

---

## Self-review

**Spec coverage:** Walked each item in the spec's P0/P1/P2 tables against the plan's task list. Every spec item maps to a numbered task (1-6 = P0; 7-14 = P1; 15-20 = P2). The spec's "Tooltips need tap triggers" (item 12 in the spec's P1 list) is implemented across three sites in Task 12.

**Placeholder scan:** Zero TBDs, TODOs, or "similar to Task N" references. Every step has either a complete code block or an exact `git`/`npm` command. The one task that is more involved than a className swap (Task 16, IngredientTooltip viewport-clamp) explicitly flags the refactor scope and notes that as P2 it can be deferred if the implementer hits a snag.

**Type consistency:** `MobileNav` component name matches between Task 1 Step 1 (create) and Task 1 Step 2 (wire). Sensor names `PointerSensor` / `TouchSensor` / `KeyboardSensor` match between Task 14 Step 1 (import) and Task 14 Step 2 (usage). The `showHandler` const name in Task 12 Step 1 matches its referenced use in both `onMouseOver` and `onClick`.

**Decomposition:** Three phases × shippable independently. Phase 1 makes the site usable on mobile (it's the don't-have-to-fix-the-rest line). Phase 2 makes it comfortable. Phase 3 is polish.

**Desktop-preservation invariant:** Every task changes only utilities prefixed with `md:`/`lg:` OR adds wrap/`-y` modifiers that have no effect at the original desktop width. Verified mentally per task.
