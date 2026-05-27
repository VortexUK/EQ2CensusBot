import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ItemTooltip, TooltipState } from '../components/ItemTooltip'
import { FilterDropdown, groupedFromHeaders } from '../components/FilterDropdown'
import { Button, Card } from '../components/ui'
import { itemRarityColor } from '../rarityColors'

// ── Stat options (canonical display names from STAT_MAP) ──────────────────────

const STAT_OPTIONS_PRIMARY = [
  'Stamina',
  'Primary Attributes',
  'Combat Skills',
  'Resistances',
]

const STAT_OPTIONS_SECONDARY = [
  'Ability Mod',
  'Potency',
  'Crit Bonus',
  'Crit Chance',
  'Casting Speed',
  'Max Health',
  'Max Power',
  'Haste',
  'DPS',
  'Multi Attack',
  'Strikethrough',
  'Accuracy',
  'Flurry',
  'Block',
  'Parry',
  'Deflection',
  'Dodge',
  'Spell Aversion',
  'Critical Avoidance',
  'Overcap Bonus',
  'Weapon Skill',
  'AE Auto Attack',
  'Spell Dmg Bonus',
  'Attack Speed',
]

// ── Static filter options ─────────────────────────────────────────────────────
// These are stable EQ2 values — no DB scan needed. The /api/items/filters
// endpoint only provides server_max_level (an env var); everything else
// renders immediately from these constants.

const TIER_OPTIONS = [
  'Celestial', 'Ethereal', 'Mythical', 'Fabled',
  'Legendary', 'Treasured', 'Uncommon',
  'Mastercrafted', 'Handcrafted', 'Common',
]

const SLOT_OPTIONS = [
  'Accolade',
  'Ammo',
  'Charm',
  'Chest',
  'Cloak',
  'Drink',
  'Ear',
  'Feet',
  'Finger',
  'Food',
  'Forearms',
  'Hands',
  'Head',
  'Legs',
  'Neck',
  'Primary',
  'Ranged',
  'Secondary',
  'Shoulders',
  'Waist',
  'Wrist',
]

const ITEM_TYPE_OPTIONS = [
  'Adornment',
  'Ammo',
  'Armor',
  'Container',
  'Expendable',
  'Food',
  'House Item',
  'Material',
  'Pattern',
  'Shield',
  'Weapon',
]

// ── Quality colour map ─────────────────────────────────────────────────────────
// Keys match the raw DB tier_display values (ALL-CAPS).

/** Title-case each word of an ALL-CAPS DB tier string: "FABLED" → "Fabled". */
function displayTier(tier: string | null): string {
  if (!tier) return '—'
  return tier
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

// ── Class hierarchy for dropdown ──────────────────────────────────────────────

const CLASS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All Classes',    value: '' },
  // Fighter
  { label: '── Fighter ──', value: '__hdr' },
  { label: '  All Fighters',  value: 'guardian,berserker,monk,bruiser,shadowknight,paladin' },
  { label: '    Guardian',     value: 'guardian' },
  { label: '    Berserker',    value: 'berserker' },
  { label: '    Monk',         value: 'monk' },
  { label: '    Bruiser',      value: 'bruiser' },
  { label: '    Shadowknight', value: 'shadowknight' },
  { label: '    Paladin',      value: 'paladin' },
  // Priest
  { label: '── Priest ──',  value: '__hdr' },
  { label: '  All Priests',   value: 'templar,inquisitor,warden,fury,mystic,defiler,channeler' },
  { label: '    Templar',      value: 'templar' },
  { label: '    Inquisitor',   value: 'inquisitor' },
  { label: '    Warden',       value: 'warden' },
  { label: '    Fury',         value: 'fury' },
  { label: '    Mystic',       value: 'mystic' },
  { label: '    Defiler',      value: 'defiler' },
  { label: '    Channeler',    value: 'channeler' },
  // Mage
  { label: '── Mage ──',    value: '__hdr' },
  { label: '  All Mages',     value: 'wizard,warlock,illusionist,coercer,conjuror,necromancer' },
  { label: '    Wizard',       value: 'wizard' },
  { label: '    Warlock',      value: 'warlock' },
  { label: '    Illusionist',  value: 'illusionist' },
  { label: '    Coercer',      value: 'coercer' },
  { label: '    Conjuror',     value: 'conjuror' },
  { label: '    Necromancer',  value: 'necromancer' },
  // Scout
  { label: '── Scout ──',   value: '__hdr' },
  { label: '  All Scouts',    value: 'swashbuckler,brigand,troubador,dirge,ranger,assassin,beastlord' },
  { label: '    Swashbuckler', value: 'swashbuckler' },
  { label: '    Brigand',      value: 'brigand' },
  { label: '    Troubador',    value: 'troubador' },
  { label: '    Dirge',        value: 'dirge' },
  { label: '    Ranger',       value: 'ranger' },
  { label: '    Assassin',     value: 'assassin' },
  { label: '    Beastlord',    value: 'beastlord' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatFilter {
  id:       number
  stat:     string
  op:       'gte' | 'lte'
  value:    string
}

interface ItemSearchResult {
  id:               number
  name:             string
  tier:             string | null
  slot:             string | null
  item_type:        string | null
  level:            number | null
  class_label:      string | null
  icon_id:          number | null
  stats:            string[]
  stat_values:      Record<string, number>
}

interface ItemSearchResponse {
  results:  ItemSearchResult[]
  total:    number
  page:     number
  per_page: number
}

interface FilterOptions {
  server_max_level?: number | null
}

// ── Shared control style ──────────────────────────────────────────────────────

const CTRL_CLS = 'py-[0.42rem] px-[0.6rem] rounded-[6px] border border-border bg-surface-raised text-text text-[0.88rem] leading-[1.4] [color-scheme:dark]'

// ── Table header / cell styles ────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding:       '0.5rem 0.7rem',
  fontSize:      '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color:         'var(--text-muted)',
  fontWeight:    600,
  whiteSpace:    'nowrap',
  textAlign:     'left',
  borderBottom:  '2px solid var(--border)',
  background:    'var(--surface-raised)',
}

const TD: React.CSSProperties = {
  padding:      '0.42rem 0.7rem',
  fontSize:     '0.85rem',
  whiteSpace:   'nowrap',
  borderBottom: '1px solid var(--border)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _statFilterId = 0
function nextId() { return ++_statFilterId }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ItemSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Filter state — initialised from URL so Back navigation restores everything ─

  // Parse stat filters from URL: each `sf` param is "StatName:op:value" or "StatName"
  const [statFilters, setStatFilters] = useState<StatFilter[]>(() =>
    searchParams.getAll('sf').map(sf => {
      const parts = sf.split(':')
      return parts.length === 3
        ? { id: nextId(), stat: parts[0], op: parts[1] as 'gte' | 'lte', value: parts[2] }
        : { id: nextId(), stat: sf, op: 'gte' as const, value: '' }
    }),
  )

  const [name,     setName]     = useState(() => searchParams.get('q')    ?? '')
  const [tier,     setTier]     = useState(() => searchParams.get('tier') ?? '')
  const [slot,     setSlot]     = useState(() => searchParams.get('slot') ?? '')
  const [itemType, setItemType] = useState(() => searchParams.get('type') ?? '')
  const [classVal, setClassVal] = useState(() => searchParams.get('cls')  ?? '')
  const [minLevel, setMinLevel] = useState(() => searchParams.get('minLv') ?? '')
  const [maxLevel, setMaxLevel] = useState(() => searchParams.get('maxLv') ?? '')
  const [sortBy,   setSortBy]   = useState<string>(() => searchParams.get('sort') ?? 'name')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>(() =>
    (searchParams.get('dir') as 'asc' | 'desc' | null) ?? 'asc',
  )
  const [page, setPage] = useState(() => {
    const p = Number(searchParams.get('page'))
    return p > 0 ? p : 1
  })

  // Results state
  const [results,  setResults]  = useState<ItemSearchResponse | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  // Tooltip state
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const showTip = useCallback((itemId: string, e: React.MouseEvent) => {
    setTooltip({ itemId, x: e.clientX, y: e.clientY })
  }, [])
  const hideTip  = useCallback(() => setTooltip(null), [])
  const moveTip  = useCallback((e: React.MouseEvent) => {
    setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
  }, [])

  // ── Keep URL in sync with filter state ─────────────────────────────────────
  // Uses replace:true so filter tweaks don't pollute the browser history stack.

  useEffect(() => {
    const p = new URLSearchParams()
    if (name.trim())     p.set('q',     name.trim())
    if (tier)            p.set('tier',  tier)
    if (slot)            p.set('slot',  slot)
    if (itemType)        p.set('type',  itemType)
    if (classVal)        p.set('cls',   classVal)
    if (minLevel.trim()) p.set('minLv', minLevel.trim())
    if (maxLevel.trim()) p.set('maxLv', maxLevel.trim())
    if (sortBy !== 'name') p.set('sort', sortBy)
    if (sortDir !== 'asc') p.set('dir',  sortDir)
    if (page > 1)          p.set('page', String(page))
    for (const f of statFilters) {
      if (!f.stat) continue
      const v = f.value.trim()
      p.append('sf', v ? `${f.stat}:${f.op}:${v}` : f.stat)
    }
    setSearchParams(p, { replace: true })
  }, [name, tier, slot, itemType, classVal, minLevel, maxLevel, sortBy, sortDir, page, statFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── On mount: fetch server_max_level for level defaults (only if not in URL) ─

  useEffect(() => {
    fetch('/api/items/filters', { credentials: 'include' })
      .then(r => r.json())
      .then((opts: FilterOptions) => {
        if (opts.server_max_level) {
          // Don't override values the user already has in the URL
          if (!searchParams.has('maxLv')) setMaxLevel(String(opts.server_max_level))
          if (!searchParams.has('minLv')) setMinLevel(String(opts.server_max_level - 9))
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-run search on mount if the URL already has search params ───────────
  // runSearch reads current state, which is already initialised from URL above.

  const didAutoSearch = useRef(false)

  // ── Stat filter management ──────────────────────────────────────────────────

  function addStatFilter() {
    const newFilter = { id: nextId(), stat: STAT_OPTIONS_SECONDARY[0], op: 'gte' as const, value: '' }
    // First stat filter added → start sorting by it descending
    if (statFilters.length === 0) {
      setSortBy(newFilter.stat)
      setSortDir('desc')
    }
    setStatFilters(prev => [...prev, newFilter])
  }

  function removeStatFilter(id: number) {
    const removed  = statFilters.find(f => f.id === id)
    const remaining = statFilters.filter(f => f.id !== id)
    if (removed && sortBy === removed.stat) {
      // Switch sort to the next available stat filter, or fall back to name
      if (remaining.length > 0) {
        setSortBy(remaining[0].stat)
        setSortDir('desc')
      } else {
        setSortBy('name')
        setSortDir('asc')
      }
    } else if (remaining.length === 0) {
      // All filters removed — reset to name sort regardless
      setSortBy('name')
      setSortDir('asc')
    }
    setStatFilters(prev => prev.filter(f => f.id !== id))
  }

  function updateStatFilter(id: number, field: 'stat' | 'op' | 'value', val: string) {
    // If renaming the stat we're currently sorting by, keep sort in sync
    if (field === 'stat' && sortBy === statFilters.find(f => f.id === id)?.stat) {
      setSortBy(val)
    }
    setStatFilters(prev => prev.map(f => f.id === id ? { ...f, [field]: val } : f))
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  async function runSearch(p = 1) {
    const params = new URLSearchParams()
    if (name.trim())     params.set('name',      name.trim())
    if (tier)            params.set('tier',       tier)
    if (slot)            params.set('slot',       slot)
    if (itemType)        params.set('item_type',  itemType)
    if (minLevel.trim()) params.set('min_level',  minLevel.trim())
    if (maxLevel.trim()) params.set('max_level',  maxLevel.trim())
    params.set('sort_by',  sortBy)
    params.set('sort_dir', sortDir)
    params.set('page',     String(p))

    // Class — if multi-class shortcut, use the first class as a presence check
    // The backend filters by any single class name present in classes_json
    if (classVal && !classVal.includes(',')) {
      params.set('class_name', classVal)
    } else if (classVal && classVal.includes(',')) {
      // For archetype shortcuts we send the first class name to match "All Fighters" etc.
      // The DB stores classes_json with all individual class keys, so matching one is enough
      // for "usable by at least one class in the archetype" — acceptable UX for v1
      params.set('class_name', classVal.split(',')[0].trim())
    }

    // Stat filters — encode as "StatName", "StatName:gte:50", or "StatName:lte:50"
    for (const f of statFilters) {
      if (!f.stat) continue
      const v = f.value.trim()
      params.append('stat_filter', v ? `${f.stat}:${f.op}:${v}` : f.stat)
    }

    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const res = await fetch(`/api/items/search?${params}`, { credentials: 'include' })
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))).detail ?? `Error ${res.status}`
        setError(detail)
        return
      }
      setResults(await res.json())
      setPage(p)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Auto-search on mount when URL already has params (e.g. returning via Back)
  useEffect(() => {
    if (didAutoSearch.current) return
    didAutoSearch.current = true
    const hasParams = ['q', 'tier', 'slot', 'type', 'cls', 'minLv', 'maxLv'].some(k => searchParams.has(k))
      || searchParams.has('sf')
    if (hasParams) runSearch(page)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    runSearch(1)
  }

  const hasAnyFilter = !!(
    name.trim() || tier || slot || itemType || classVal ||
    minLevel.trim() || maxLevel.trim() || statFilters.length
  )

  const totalPages = results ? Math.ceil(results.total / results.per_page) : 0

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="max-w-[1100px] mx-auto pt-8 px-6 pb-16">
      <h1
        className="font-heading text-[1.9rem] font-bold tracking-[0.06em] mt-4 mx-0 mb-1 inline-block"
        style={{
          background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold-bright) 40%, var(--gold) 70%, var(--gold-dim) 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}
      >
        Item Search
      </h1>
      <p className="text-text-muted text-[0.88rem] mb-6">
        Search the local item database by name, quality, slot, class, level and stats.
      </p>

      {/* ── Filter form ───────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>
        <Card className="py-4 px-[1.1rem] mb-5">

          {/* Row 1: name + tier + type + slot + class */}
          <div className="flex flex-wrap gap-3 items-end mb-3">

            <Field label="Name">
              <input
                type="text"
                placeholder="Search name…"
                value={name}
                onChange={e => setName(e.target.value)}
                className={`${CTRL_CLS} w-[180px]`}
              />
            </Field>

            <Field label="Quality">
              <FilterDropdown
                standalone
                value={tier}
                placeholder="Any"
                options={[{ value: '', label: 'Any' }, ...TIER_OPTIONS.map(t => ({ value: t, label: t }))]}
                onChange={setTier}
              />
            </Field>

            <Field label="Item Type">
              <FilterDropdown
                standalone
                value={itemType}
                placeholder="Any"
                options={[{ value: '', label: 'Any' }, ...ITEM_TYPE_OPTIONS.map(t => ({ value: t, label: t }))]}
                onChange={setItemType}
              />
            </Field>

            <Field label="Slot">
              <FilterDropdown
                standalone
                value={slot}
                placeholder="Any"
                options={[{ value: '', label: 'Any' }, ...SLOT_OPTIONS.map(s => ({ value: s, label: s }))]}
                onChange={setSlot}
              />
            </Field>

            <Field label="Class">
              <FilterDropdown
                standalone
                value={classVal}
                placeholder="All Classes"
                options={groupedFromHeaders(CLASS_OPTIONS)}
                onChange={setClassVal}
              />
            </Field>

          </div>

          {/* Row 2: levels + search */}
          <div className="flex flex-wrap gap-3 items-end mb-3">

            <Field label="Min Level">
              <input
                type="number" min={0} max={135} placeholder="e.g. 70"
                value={minLevel} onChange={e => setMinLevel(e.target.value)}
                className={`${CTRL_CLS} w-[90px]`}
              />
            </Field>

            <Field label="Max Level">
              <input
                type="number" min={0} max={135} placeholder="e.g. 70"
                value={maxLevel} onChange={e => setMaxLevel(e.target.value)}
                className={`${CTRL_CLS} w-[90px]`}
              />
            </Field>

            <Field label=" " transparent>
              <Button
                type="submit"
                variant="primary"
                disabled={loading || !hasAnyFilter}
              >
                {loading ? 'Searching…' : 'Search'}
              </Button>
            </Field>

          </div>

          {/* Row 3: stat filters */}
          {statFilters.length > 0 && (
            <div className="mb-2">
              <div className="text-[0.68rem] uppercase tracking-[0.07em] text-text-muted mb-[0.4rem]">
                Has Stats
              </div>
              <div className="flex flex-col gap-[0.4rem]">
                {statFilters.map(f => (
                  <div key={f.id} className="flex gap-2 items-center">
                    {/* Stat name */}
                    <FilterDropdown
                      standalone
                      value={f.stat}
                      options={[
                        ...STAT_OPTIONS_PRIMARY.map(s => ({ value: s, label: s, group: 'Primary' })),
                        ...STAT_OPTIONS_SECONDARY.map(s => ({ value: s, label: s, group: 'Secondary' })),
                      ]}
                      onChange={v => updateStatFilter(f.id, 'stat', v)}
                    />
                    {/* Operator */}
                    <FilterDropdown
                      standalone
                      value={f.op}
                      options={[
                        { value: 'gte', label: '≥' },
                        { value: 'lte', label: '≤' },
                      ]}
                      onChange={v => updateStatFilter(f.id, 'op', v)}
                    />
                    {/* Value */}
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="any"
                      value={f.value}
                      onChange={e => updateStatFilter(f.id, 'value', e.target.value)}
                      className={`${CTRL_CLS} w-[90px]`}
                    />
                    {/* Remove */}
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => removeStatFilter(f.id)}
                      className="border-none text-base leading-none"
                      title="Remove"
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addStatFilter}
            className="border border-dashed border-border"
            style={{ marginTop: statFilters.length ? '0.3rem' : 0 }}
          >
            + Add stat filter
          </Button>

        </Card>
      </form>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && <p className="text-danger mb-4">{error}</p>}

      {/* ── Prompt ─────────────────────────────────────────────────────────── */}
      {!searched && !loading && (
        <p className="text-text-muted text-[0.9rem]">
          Set at least one filter to search.
        </p>
      )}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {searched && !loading && !error && results && (
        <div onMouseMove={moveTip}>
          <ResultsHeader
            total={results.total} page={page} totalPages={totalPages}
            onPrev={() => runSearch(page - 1)} onNext={() => runSearch(page + 1)}
          />

          {results.total > 0 && <ItemTable
            items={results.results}
            sortBy={sortBy}
            sortDir={sortDir}
            statFilters={statFilters}
            onSortByStat={(stat) => {
              if (sortBy === stat) {
                setSortDir(d => d === 'asc' ? 'desc' : 'asc')
              } else {
                setSortBy(stat)
                setSortDir('desc')
              }
            }}
            onShowTip={showTip}
            onHideTip={hideTip}
          />}

          {totalPages > 1 && (
            <div className="flex justify-end gap-[0.4rem] mt-3">
              <Button variant="secondary" size="sm" onClick={() => runSearch(page - 1)} disabled={page <= 1}>← Prev</Button>
              <Button variant="secondary" size="sm" onClick={() => runSearch(page + 1)} disabled={page >= totalPages}>Next →</Button>
            </div>
          )}
        </div>
      )}

      {tooltip && <ItemTooltip state={tooltip} />}
    </main>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({
  label, children, transparent,
}: { label: string; children: React.ReactNode; transparent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[0.68rem] uppercase tracking-[0.07em] select-none"
        style={{ color: transparent ? 'transparent' : 'var(--text-muted)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function ResultsHeader({
  total, page, totalPages, onPrev, onNext,
}: { total: number; page: number; totalPages: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex justify-between items-center mb-[0.6rem] flex-wrap gap-2">
      <span className="text-[0.83rem] text-text-muted">
        {total === 0
          ? 'No items found.'
          : `${total.toLocaleString()} item${total === 1 ? '' : 's'} found`}
        {totalPages > 1 && ` · page ${page} of ${totalPages}`}
      </span>
      {totalPages > 1 && (
        <div className="flex gap-[0.4rem]">
          <Button variant="secondary" size="sm" onClick={onPrev} disabled={page <= 1}>← Prev</Button>
          <Button variant="secondary" size="sm" onClick={onNext} disabled={page >= totalPages}>Next →</Button>
        </div>
      )}
    </div>
  )
}

function StatPills({ stats, highlight }: { stats: string[]; highlight: string[] }) {
  if (!stats.length) return <span className="text-text-muted">—</span>
  const highlightSet = new Set(highlight)
  return (
    <div className="flex flex-wrap gap-[0.2rem]">
      {stats.map(s => (
        <span
          key={s}
          className="inline-block px-[0.35rem] py-[0.1rem] rounded-[3px] text-[0.72rem] border"
          style={{
            background:   highlightSet.has(s)
              ? 'rgba(var(--accent-rgb,99,210,130),0.18)'
              : 'var(--surface-raised)',
            color: highlightSet.has(s)
              ? 'var(--accent)'
              : 'var(--text-muted)',
            borderColor: highlightSet.has(s)
              ? 'rgba(var(--accent-rgb,99,210,130),0.35)'
              : 'var(--border)',
          }}
        >
          {s}
        </span>
      ))}
    </div>
  )
}

function ItemTable({
  items, sortBy, sortDir, statFilters, onSortByStat, onShowTip, onHideTip,
}: {
  items: ItemSearchResult[]
  sortBy: string
  sortDir: 'asc' | 'desc'
  statFilters: StatFilter[]
  onSortByStat: (stat: string) => void
  onShowTip: (itemId: string, e: React.MouseEvent) => void
  onHideTip: () => void
}) {
  // Show one column per active stat filter, capped at 3
  const statCols = statFilters.filter(f => f.stat).slice(0, 3)

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th style={TH}>Name</th>
            <th style={TH}>Quality</th>
            <th style={TH}>Slot</th>
            <th style={{ ...TH, textAlign: 'right' }}>Level</th>
            {statCols.map(f => {
              const active = sortBy === f.stat
              return (
                <th
                  key={f.id}
                  style={{
                    ...TH,
                    textAlign: 'right',
                    cursor: 'pointer',
                    userSelect: 'none',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => onSortByStat(f.stat)}
                  title={`Sort by ${f.stat}`}
                >
                  {f.stat}&thinsp;{active ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
                </th>
              )
            })}
            <th style={TH}>Classes</th>
            <th style={TH}>Stats</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr
              key={item.id}
              className="transition-[background] duration-100 cursor-default"
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--surface-raised)'
                onShowTip(String(item.id), e)
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = ''
                onHideTip()
              }}
            >
              <td style={TD}>
                <div className="flex items-center gap-[0.45rem]">
                  {item.icon_id ? (
                    <img
                      src={`/icons/${item.icon_id}.png`}
                      alt=""
                      width={28}
                      height={28}
                      className="rounded-[3px] border border-border shrink-0 block"
                      onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                    />
                  ) : (
                    <div className="w-7 h-7 shrink-0" />
                  )}
                  <Link
                    to={`/item/${item.id}`}
                    className="no-underline font-medium"
                    style={{ color: itemRarityColor(item.tier, 'var(--accent)') }}
                  >
                    {item.name}
                  </Link>
                </div>
              </td>
              <td style={{ ...TD, color: itemRarityColor(item.tier, 'var(--text-muted)'), fontSize: '0.8rem', fontWeight: 500 }}>
                {displayTier(item.tier)}
              </td>
              <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {item.slot ?? (item.item_type ?? '—')}
              </td>
              <td style={{ ...TD, textAlign: 'right' }}>
                {item.level ?? '—'}
              </td>
              {statCols.map(f => {
                const val = item.stat_values[f.stat]
                const active = sortBy === f.stat
                return (
                  <td
                    key={f.id}
                    style={{
                      ...TD,
                      textAlign: 'right',
                      fontWeight: active ? 600 : undefined,
                      color: active ? 'var(--accent)' : undefined,
                    }}
                  >
                    {val != null
                      ? val
                      : <span className="text-text-muted font-normal">—</span>}
                  </td>
                )
              })}
              <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: 160, whiteSpace: 'normal', lineHeight: '1.45' }}>
                {item.class_label
                  ? item.class_label.split(' / ').map((part, i) => (
                      <span key={i} className="block">{part}</span>
                    ))
                  : '—'}
              </td>
              <td style={{ ...TD, fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: 260 }}>
                <StatPills stats={item.stats} highlight={statFilters.map(f => f.stat)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
