import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ItemTooltip, TooltipState, getCachedItem, prefetchItem } from '../components/ItemTooltip'
import { AATree, AATreeData } from '../components/AATree'

// ── Types ────────────────────────────────────────────────────────────────────

interface AdornSlot {
  color: string
  adorn_name: string | null
  adorn_id: string | null
}

interface EquipmentSlot {
  slot: string
  name: string
  item_id: string | null
  icon_id: string | null
  tier: string | null
  adorn_slots: AdornSlot[]
}

interface CharacterStats {
  health_max: number | null
  health_regen: number | null
  power_max: number | null
  power_regen: number | null
  run_speed: number | null
  status_points: number | null
  str_eff: number | null
  sta_eff: number | null
  agi_eff: number | null
  wis_eff: number | null
  int_eff: number | null
  armor: number | null
  avoidance: number | null
  block_chance: number | null
  parry: number | null
  mit_physical: number | null
  mit_elemental: number | null
  mit_noxious: number | null
  mit_arcane: number | null
  potency: number | null
  crit_chance: number | null
  crit_bonus: number | null
  fervor: number | null
  dps: number | null
  double_attack: number | null
  ability_doublecast: number | null
  attack_speed: number | null
  strikethrough: number | null
  accuracy: number | null
  ability_mod: number | null
  weapon_damage_bonus: number | null
  flurry: number | null
  lethality: number | null
  toughness: number | null
  reuse_speed: number | null
  casting_speed: number | null
  recovery_speed: number | null
  primary_min: number | null
  primary_max: number | null
  primary_delay: number | null
  secondary_min: number | null
  secondary_max: number | null
  secondary_delay: number | null
  ranged_min: number | null
  ranged_max: number | null
  ranged_delay: number | null
}

interface Character {
  id: string
  name: string
  level: number | null
  cls: string | null
  race: string | null
  gender: string | null
  deity: string | null
  aa_count: number
  world: string
  ts_class: string | null
  ts_level: number | null
  stats: CharacterStats
  equipment: EquipmentSlot[]
}

// ── Spell types ──────────────────────────────────────────────────────────────

interface SpellEntry {
  name:          string
  tier:          string
  level:         number
  spell_type:    string
  icon_id:       number | null
  icon_backdrop: number | null
}

interface CharacterSpellsData {
  character_name: string
  spells:         SpellEntry[]
  tier_counts:    Record<string, number>
  tiers_present:  string[]
}

// ── AA types ─────────────────────────────────────────────────────────────────

interface CharAATree {
  tree_id:     number
  tree_type:   string
  tree_name:   string
  spent:       Record<string, number>   // node_id str → tier
  total_spent: number
}

interface CharAAProfile {
  name:  string
  trees: CharAATree[]
}

interface CharAAsResponse {
  character_name: string
  total_spent:    number
  trees:          CharAATree[]
  profiles:       CharAAProfile[]
}

interface AAConfig {
  xpac:               string
  aa_cap:             number
  unlocked_tree_types: string[]
}

// ── Paperdoll slot config ────────────────────────────────────────────────────

const LEFT_SLOTS: [string, string][] = [
  ['Charm',      'activate1'],
  ['Cloak',      'cloak'],
  ['Head',       'head'],
  ['Shoulders',  'shoulders'],
  ['Chest',      'chest'],
  ['Arms',       'forearms'],
  ['Hands',      'hands'],
  ['Legs',       'legs'],
  ['Feet',       'feet'],
  ['Primary',    'primary'],
  ['Secondary',  'secondary'],
]

const RIGHT_SLOTS: [string, string][] = [
  ['Charm',      'activate2'],
  ['Ear',        'ears'],
  ['Ear',        'ears2'],
  ['Neck',       'neck'],
  ['Ring',       'left_ring'],
  ['Ring',       'right_ring'],
  ['Wrist',      'left_wrist'],
  ['Wrist',      'right_wrist'],
  ['Waist',      'waist'],
  ['Ranged',     'ranged'],
]

const CONSUMABLE_SLOTS: [string, string][] = [
  ['Food',  'food'],
  ['Drink', 'drink'],
]

const DISPLAY_TO_BASE: Record<string, string> = {
  Primary: 'primary', Secondary: 'secondary', Ranged: 'ranged',
  Head: 'head', Chest: 'chest', Shoulders: 'shoulders',
  Forearms: 'forearms', Hands: 'hands', Legs: 'legs',
  Feet: 'feet', Waist: 'waist', Neck: 'neck', Cloak: 'cloak',
  Charm: 'activate', Finger: 'ring', Ear: 'ear', Wrist: 'wrist',
  Food: 'food', Drink: 'drink',
}
const MULTI_SUFFIXES: Record<string, string[]> = {
  activate: ['activate1', 'activate2'],
  ring:     ['left_ring', 'right_ring'],
  ear:      ['ears', 'ears2'],
  wrist:    ['left_wrist', 'right_wrist'],
}

function buildSlotMap(equipment: EquipmentSlot[]): Map<string, EquipmentSlot> {
  const map = new Map<string, EquipmentSlot>()
  const counters: Record<string, number> = {}
  for (const s of equipment) {
    const base = DISPLAY_TO_BASE[s.slot]
    if (!base) continue
    const suffixes = MULTI_SUFFIXES[base]
    let key: string
    if (suffixes) {
      counters[base] = (counters[base] ?? 0) + 1
      key = suffixes[counters[base] - 1] ?? base
    } else {
      key = base
    }
    map.set(key, s)
  }
  return map
}

// Adornment slot colours — matches EQ2 in-game colours
const ADORN_COLOUR: Record<string, string> = {
  White:     '#e8e8e8',
  Yellow:    '#e8c840',
  Red:       '#e05050',
  Green:     '#50c850',
  Blue:      '#5090e8',
  Purple:    '#b060e0',
  Orange:    '#e08830',
  Turquoise: '#30c8c0',
  Black:     '#a0a0a0',
}
function adornColour(color: string) {
  return ADORN_COLOUR[color] ?? '#888'
}

// Adorn name shortening --------------------------------------------------------
// "<Adjective> Adornment of <Name> (<Quality>)"  →  "Adj <Name> (X)"
const ADORN_QUALITY_TIER: Record<string, { letter: string; color: string }> = {
  Superior:      { letter: 'F', color: '#ff939d' },
  Fabled:        { letter: 'F', color: '#ff939d' },
  Legendary:     { letter: 'L', color: '#ffc993' },
  Treasured:     { letter: 'T', color: '#92d7fd' },
  Mastercrafted: { letter: 'T', color: '#92d7fd' },
  Uncommon:      { letter: 'U', color: '#a8d4a8' },
  Common:        { letter: 'C', color: 'var(--text)' },
  Greater:       { letter: 'L', color: '#ffc993' },
  Lesser:        { letter: 'T', color: '#92d7fd' },
}
const _ADORN_RE = /^(\w+)\s+Adornment\s+of\s+(.+?)\s*\((.+?)\)\s*$/i

interface ParsedAdorn { short: string; tierLetter: string; tierColor: string }

function parseAdornName(name: string): ParsedAdorn | null {
  const m = name.match(_ADORN_RE)
  if (!m) return null
  const tier = ADORN_QUALITY_TIER[m[3]]
  if (!tier) return null
  return { short: `${m[1].slice(0, 3)} ${m[2]}`, tierLetter: tier.letter, tierColor: tier.color }
}

type TierStyle = { color: string; textShadow?: string }

const _outline = '-1px 0px 0px #000, 0px 1px 0px #000, 1px 0px 0px #000, 0px -1px 0px #000'

const TIER_STYLE: Record<string, TierStyle> = {
  MYTHICAL: {
    color: '#d99fe9',
    textShadow: `${_outline}, 0px 0px 4px #C859E6, 0px 0px 4px #C859E6`,
  },
  FABLED: {
    color: '#ff939d',
    textShadow: `${_outline}, 0px 0px 4px #DF535F, 0px 0px 4px #DF535F`,
  },
  LEGENDARY: {
    color: '#ffc993',
    textShadow: `${_outline}, 0px 0px 4px #D56900, 0px 0px 4px #ffc993`,
  },
  MASTERCRAFTED: {
    color: '#92d7fd',
    textShadow: `${_outline}, 0px 0px 4px #D56900, 0px 0px 4px #92d7fd`,
  },
  TREASURED: {   // same as mastercrafted
    color: '#92d7fd',
    textShadow: `${_outline}, 0px 0px 4px #D56900, 0px 0px 4px #92d7fd`,
  },
  UNCOMMON: { color: '#a8d4a8' },
  COMMON:   { color: 'var(--text)' },
}

function tierStyle(tier: string | null): TierStyle {
  const key = (tier ?? '').toUpperCase()
  if (TIER_STYLE[key]) return TIER_STYLE[key]
  // Compound tier like "MASTERCRAFTED FABLED" — use the last recognised word
  const words = key.split(/\s+/)
  for (let i = words.length - 1; i >= 0; i--) {
    if (TIER_STYLE[words[i]]) return TIER_STYLE[words[i]]
  }
  return { color: 'var(--text)' }
}

// ── Stat ↔ item-stat matching ─────────────────────────────────────────────────
//
// Panel labels sometimes differ from the Census stat display_name.
// Each entry maps a lowercased panel label to alternative strings to try.
const STAT_ALIASES: Record<string, string[]> = {
  // Panel "Armor" (armor class) and "Physical Mit" both derive from the
  // "Mitigation" stat on armour pieces.
  'armor':              ['mitigation'],
  'physical mit':       ['mitigation'],
  // Elemental / Noxious / Arcane resistances are a single combined
  // "Resistances" stat on items.
  'elemental mit':      ['resistances', 'resistance'],
  'noxious mit':        ['resistances', 'resistance'],
  'arcane mit':         ['resistances', 'resistance'],
  'crit chance':        ['critical chance'],
  'crit bonus':         ['critical bonus'],
  'ability mod':        ['ability modifier'],
  'weapon damage':      ['weapon damage bonus'],
  'ability doublecast': ['ability double cast'],
  'attack speed':       ['haste'],
}

function statMatches(panelLabel: string, itemStatName: string): boolean {
  const label = panelLabel.toLowerCase()
  const stat  = itemStatName.toLowerCase()
  if (label === stat) return true
  if (stat.includes(label) || label.includes(stat)) return true
  return (STAT_ALIASES[label] ?? []).some(a => stat === a || stat.includes(a))
}

// ── Page ─────────────────────────────────────────────────────────────────────

// Module-level cache: survives re-renders and Vite HMR remounts.
// Keyed by lower-cased character name.
const _charCache = new Map<string, Character>()

// Spell data cache — keyed by lower-cased character name.
const _spellsCache = new Map<string, CharacterSpellsData>()

// AA data cache — keyed by lower-cased character name.
// Populated on first AA tab open; reused on every subsequent tab switch.
interface AACacheEntry {
  charAAs:  CharAAsResponse
  config:   AAConfig
  treeData: Map<number, AATreeData>
}
const _aaCache = new Map<string, AACacheEntry>()

type State =
  | { status: 'loading' }
  | { status: 'ok'; char: Character }
  | { status: 'not_found'; name: string }
  | { status: 'error'; message: string }

export default function CharacterPage() {
  const { name } = useParams<{ name: string }>()
  const [state, setState] = useState<State>(() => {
    // Initialise from cache so there's never a loading flash on back-navigation.
    const cached = name ? _charCache.get(name.toLowerCase()) : undefined
    return cached ? { status: 'ok', char: cached } : { status: 'loading' }
  })

  useEffect(() => {
    if (!name) return
    // Already have fresh data — don't hit Census again.
    if (_charCache.has(name.toLowerCase())) return
    fetch(`/api/character/${encodeURIComponent(name)}`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 404) { setState({ status: 'not_found', name }); return }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setState({ status: 'error', message: body.detail ?? `HTTP ${res.status}` })
          return
        }
        const char: Character = await res.json()
        _charCache.set(name.toLowerCase(), char)
        setState({ status: 'ok', char })
      })
      .catch(err => setState({ status: 'error', message: String(err) }))
  }, [name])

  return (
    <main style={{ maxWidth: 1280, margin: '2rem auto', padding: '0 1rem' }}>
      <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>← Back</Link>
      {state.status === 'loading' && <p style={{ marginTop: '2rem', color: 'var(--text-muted)' }}>Loading…</p>}
      {state.status === 'not_found' && <p style={{ marginTop: '2rem', color: 'var(--text-muted)' }}>Character <strong>{state.name}</strong> not found.</p>}
      {state.status === 'error' && <p style={{ marginTop: '2rem', color: '#f87171' }}>Error: {state.message}</p>}
      {state.status === 'ok' && <CharacterView char={state.char} />}
    </main>
  )
}

// ── Character view ────────────────────────────────────────────────────────────

type ActiveTab = 'equipment' | 'aas' | 'spells'

function CharacterView({ char }: { char: Character }) {
  const bySlot = buildSlotMap(char.equipment)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [hoveredStat, setHoveredStat] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('equipment')
  // Tracks when background prefetch completes so highlights re-evaluate.
  const [, setItemsReady] = useState(false)

  // Eagerly fetch stats for every equipped item + adorn so highlights work
  // without the user having to hover each item first.
  useEffect(() => {
    const ids: string[] = []
    for (const slot of char.equipment) {
      if (slot.item_id) ids.push(slot.item_id)
      for (const a of slot.adorn_slots) {
        if (a.adorn_id) ids.push(a.adorn_id)
      }
    }
    if (ids.length === 0) { setItemsReady(true); return }
    Promise.allSettled(ids.map(prefetchItem)).then(() => setItemsReady(true))
  }, [char])

  /** Returns whether this slot's item or adorns contribute to the hovered stat. */
  function getHighlight(item: EquipmentSlot | null): 'direct' | 'adorn' | null {
    if (!hoveredStat || !item) return null
    // Mitigation is a top-level property on ItemDetail, not in stats[].
    // Physical Mit and Armor both derive from it.
    const isMitStat = hoveredStat === 'Physical Mit' || hoveredStat === 'Armor'
    if (item.item_id) {
      const d = getCachedItem(item.item_id)
      if (d) {
        const hasStat = d.stats.some(s => statMatches(hoveredStat, s.display_name))
        const hasMit  = isMitStat && d.mitigation != null && d.mitigation > 0
        if (hasStat || hasMit) return 'direct'
      }
    }
    const adornHit = item.adorn_slots.some(a => {
      if (!a.adorn_id) return false
      const d = getCachedItem(a.adorn_id)
      if (!d) return false
      return d.stats.some(s => statMatches(hoveredStat, s.display_name))
    })
    return adornHit ? 'adorn' : null
  }

  const showTip = useCallback((itemId: string, e: React.MouseEvent) => {
    setTooltip({ itemId, x: e.clientX, y: e.clientY })
  }, [])
  const hideTip = useCallback(() => setTooltip(null), [])
  const moveTip = useCallback((e: React.MouseEvent) => {
    if (tooltip) setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
  }, [tooltip])

  return (
    <div style={{ marginTop: '1.5rem' }} onMouseMove={moveTip}>
      {/* Full-width general banner */}
      <GeneralBanner char={char} />

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: '1px solid var(--border)',
        marginTop: '1rem',
      }}>
        {(['equipment', 'aas', 'spells'] as ActiveTab[]).map(tab => {
          const label = tab === 'equipment' ? 'Equipment & Stats'
                      : tab === 'aas'       ? 'Alternate Advancements'
                      :                       'Spells'
          const active = tab === activeTab
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: active ? 'var(--surface)' : 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                color: active ? 'var(--text)' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: active ? 600 : 400,
                letterSpacing: '0.04em',
                padding: '7px 16px',
                marginBottom: '-1px',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Equipment & Stats tab */}
      {activeTab === 'equipment' && (
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginTop: '1rem' }}>
          {/* Left: detailed stats */}
          <div style={{ width: 260, flexShrink: 0 }}>
            <StatsPanel char={char}
              onStatHover={setHoveredStat}
              onStatLeave={() => setHoveredStat(null)} />
          </div>

          {/* Right: paperdoll */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={sectionHeading}>Equipment</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {LEFT_SLOTS.map(([label, key]) => {
                  const item = bySlot.get(key) ?? null
                  return <SlotRow key={key} label={label} item={item} iconSide="left" onShow={showTip} onHide={hideTip} highlight={getHighlight(item)} />
                })}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {RIGHT_SLOTS.map(([label, key]) => {
                  const item = bySlot.get(key) ?? null
                  return <SlotRow key={key} label={label} item={item} iconSide="right" onShow={showTip} onHide={hideTip} highlight={getHighlight(item)} />
                })}
              </div>
            </div>

            <h2 style={{ ...sectionHeading, marginTop: '1rem' }}>Consumables</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              {CONSUMABLE_SLOTS.map(([label, key]) => {
                const item = bySlot.get(key) ?? null
                return <SlotRow key={key} label={label} item={item} iconSide="left" onShow={showTip} onHide={hideTip} highlight={getHighlight(item)} />
              })}
            </div>
          </div>
        </div>
      )}

      {/* AAs tab */}
      {activeTab === 'aas' && <AAsTab charName={char.name} aaCount={char.aa_count} />}

      {/* Spells tab */}
      {activeTab === 'spells' && <SpellsTab charName={char.name} />}

      {tooltip && <ItemTooltip state={tooltip} />}
    </div>
  )
}

// ── General banner (full width, above equipment) ──────────────────────────────

// Each column holds a top row and an optional bottom row: [label, value]
type BannerCol = [[string, string], [string, string] | null]

function GeneralBanner({ char }: { char: Character }) {
  const s = char.stats

  const columns: BannerCol[] = [
    [
      ['Level',      `${char.level ?? '—'} ${char.cls ?? ''}`.trim()],
      char.ts_class ? ['Tradeskill', `${char.ts_level ?? '—'} ${char.ts_class}`] : null,
    ],
    [
      ['AAs',    char.aa_count.toLocaleString()],
      char.deity ? ['Deity', char.deity] : null,
    ],
    [
      ['Health', s.health_max  != null ? s.health_max.toLocaleString()  : '—'],
      ['Power',  s.power_max   != null ? s.power_max.toLocaleString()   : '—'],
    ],
    [
      ['Run Speed', s.run_speed     != null ? `${Math.round(s.run_speed)}%`       : '—'],
      ['Status',    s.status_points != null ? s.status_points.toLocaleString()    : '—'],
    ],
  ]

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 6, padding: '0.5rem 1rem',
      display: 'flex', alignItems: 'stretch',
    }}>
      {/* Identity: name + subtitle, separated by a divider */}
      <div style={{
        paddingRight: '1.25rem', marginRight: '1.25rem',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <div style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '1.6rem',
          fontWeight: 700,
          lineHeight: 1.2,
          letterSpacing: '0.04em',
          background: 'linear-gradient(135deg, #c8a96e 0%, #e8d5a3 40%, #c8a96e 70%, #a07840 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          display: 'inline-block',
        }}>{char.name}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.15rem' }}>
          {[char.world, char.race, char.gender].filter(Boolean).join(' · ')}
        </div>
      </div>

      {/* Stat columns, each divided */}
      {columns.map(([top, bottom], i) => (
        <div key={i} style={{
          flex: 1,
          paddingLeft: '1rem', paddingRight: i < columns.length - 1 ? '1rem' : 0,
          borderRight: i < columns.length - 1 ? '1px solid var(--border)' : undefined,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.2rem',
        }}>
          <BannerStat label={top[0]} value={top[1]} />
          {bottom && <BannerStat label={bottom[0]} value={bottom[1]} />}
        </div>
      ))}
    </div>
  )
}

function BannerStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: '0.9rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

// ── Stats panel (left of paperdoll, no General group) ─────────────────────────

function StatsPanel({ char, onStatHover, onStatLeave }: {
  char: Character
  onStatHover: (label: string) => void
  onStatLeave: () => void
}) {
  const s = char.stats
  // Convenience: create hover/leave props for a given label
  const h = (label: string) => ({ onHover: () => onStatHover(label), onLeave: onStatLeave })

  return (
    <div>
      <StatGroup title="Attributes">
        <StatRow label="Strength"     value={s.str_eff} fmt="int"  {...h('Strength')} />
        <StatRow label="Stamina"      value={s.sta_eff} fmt="int"  {...h('Stamina')} />
        <StatRow label="Agility"      value={s.agi_eff} fmt="int"  {...h('Agility')} />
        <StatRow label="Wisdom"       value={s.wis_eff} fmt="int"  {...h('Wisdom')} />
        <StatRow label="Intelligence" value={s.int_eff} fmt="int"  {...h('Intelligence')} />
      </StatGroup>

      <StatGroup title="Defense">
        <StatRow label="Armor"              value={s.armor}         fmt="int"  {...h('Armor')} />
        <StatRow label="Avoidance"          value={s.avoidance}     fmt="int"  {...h('Avoidance')} />
        <StatRow label="Block Chance"       value={s.block_chance}  fmt="pct1" {...h('Block Chance')} />
        <StatRow label="Parry"              value={s.parry}         fmt="int"  {...h('Parry')} />
        <StatRow label="Physical Mit"       value={s.mit_physical}  fmt="pct1" {...h('Physical Mit')} />
        <StatRow label="Elemental Mit"      value={s.mit_elemental} fmt="pct1" {...h('Elemental Mit')} />
        <StatRow label="Noxious Mit"        value={s.mit_noxious}   fmt="pct1" {...h('Noxious Mit')} />
        <StatRow label="Arcane Mit"         value={s.mit_arcane}    fmt="pct1" {...h('Arcane Mit')} />
      </StatGroup>

      <StatGroup title="Combat">
        <StatRow label="Potency"            value={s.potency}             fmt="dec1" {...h('Potency')} />
        <StatRow label="Crit Chance"        value={s.crit_chance}         fmt="pct1" {...h('Crit Chance')} />
        <StatRow label="Crit Bonus"         value={s.crit_bonus}          fmt="pct1" {...h('Crit Bonus')} />
        <StatRow label="Fervor"             value={s.fervor}              fmt="dec1" {...h('Fervor')} />
        <StatRow label="DPS"                value={s.dps}                 fmt="dec1" {...h('DPS')} />
        <StatRow label="Double Attack"      value={s.double_attack}       fmt="pct1" {...h('Double Attack')} />
        <StatRow label="Ability Doublecast" value={s.ability_doublecast}  fmt="pct1" {...h('Ability Doublecast')} />
        <StatRow label="Attack Speed"       value={s.attack_speed}        fmt="pct1" {...h('Attack Speed')} />
        <StatRow label="Ability Mod"        value={s.ability_mod}         fmt="int"  {...h('Ability Mod')} />
        <StatRow label="Weapon Damage"      value={s.weapon_damage_bonus} fmt="pct1" {...h('Weapon Damage')} />
        <StatRow label="Flurry"             value={s.flurry}              fmt="pct1" {...h('Flurry')} />
        <StatRow label="Strikethrough"      value={s.strikethrough}       fmt="pct1" {...h('Strikethrough')} />
        <StatRow label="Accuracy"           value={s.accuracy}            fmt="pct1" {...h('Accuracy')} />
        <StatRow label="Lethality"          value={s.lethality}           fmt="pct1" {...h('Lethality')} />
        <StatRow label="Toughness"          value={s.toughness}           fmt="dec1" {...h('Toughness')} />
      </StatGroup>

      <StatGroup title="Casting">
        <StatRow label="Reuse Speed"    value={s.reuse_speed}    fmt="pct1" {...h('Reuse Speed')} />
        <StatRow label="Casting Speed"  value={s.casting_speed}  fmt="pct1" {...h('Casting Speed')} />
        <StatRow label="Recovery Speed" value={s.recovery_speed} fmt="pct1" {...h('Recovery Speed')} />
      </StatGroup>

      <StatGroup title="Weapon">
        {s.primary_min != null && s.primary_max != null &&
          <StatRow label="Primary"   value={`${s.primary_min.toLocaleString()} – ${s.primary_max.toLocaleString()}  (${s.primary_delay?.toFixed(2)}s)`} />}
        {s.secondary_min != null && s.secondary_max != null &&
          <StatRow label="Secondary" value={`${s.secondary_min.toLocaleString()} – ${s.secondary_max.toLocaleString()}  (${s.secondary_delay?.toFixed(2)}s)`} />}
        {s.ranged_min != null && s.ranged_max != null &&
          <StatRow label="Ranged"    value={`${s.ranged_min.toLocaleString()} – ${s.ranged_max.toLocaleString()}  (${s.ranged_delay?.toFixed(2)}s)`} />}
      </StatGroup>
    </div>
  )
}

// ── Stat display helpers ──────────────────────────────────────────────────────

type Fmt = 'int' | 'pct' | 'pct1' | 'dec1'

function fmt(value: number, format?: Fmt): string {
  switch (format) {
    case 'int':  return value.toLocaleString()
    case 'pct':  return `${Math.round(value)}%`
    case 'pct1': return `${value.toFixed(1)}%`
    case 'dec1': return value.toFixed(1)
    default:     return String(value)
  }
}

function StatRow({ label, value, fmt: format, onHover, onLeave }: {
  label: string
  value: number | string | null | undefined
  fmt?: Fmt
  onHover?: () => void
  onLeave?: () => void
}) {
  if (value === null || value === undefined) return null
  const display = typeof value === 'number' ? fmt(value, format) : value
  return (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 0', borderBottom: '1px solid var(--border)', cursor: onHover ? 'default' : undefined }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', paddingRight: '0.5rem' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 500, textAlign: 'right' }}>{display}</span>
    </div>
  )
}

function StatGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontWeight: 600, marginBottom: '3px' }}>
        {title}
      </div>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px' }}>
        {children}
      </div>
    </div>
  )
}

// ── Paperdoll helpers ─────────────────────────────────────────────────────────

function SlotRow({ label, item, iconSide, onShow, onHide, highlight }: {
  label: string
  item: EquipmentSlot | null
  iconSide: 'left' | 'right'
  onShow: (itemId: string, e: React.MouseEvent) => void
  onHide: () => void
  highlight: 'direct' | 'adorn' | null
}) {
  const url = item?.icon_id ? `/icons/${item.icon_id}.png` : null
  const hasAdorns = (item?.adorn_slots.length ?? 0) > 0

  const iconEl = (
    <div style={{ ...iconBox, backgroundImage: `url('/slot-empty-blue.png')`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      {url && <img src={url} alt={item?.name ?? ''} style={{ width: 40, height: 40, display: 'block' }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
    </div>
  )
  const textEl = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>{label} – </span>
        {item
          ? <span style={{ ...tierStyle(item.tier), fontWeight: 500, fontSize: '0.88rem' }}>{item.name}</span>
          : <span style={{ color: 'var(--border)', fontSize: '0.82rem', fontStyle: 'italic' }}>Empty</span>}
      </div>
      {hasAdorns && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 3px', marginTop: 1 }}>
          {item!.adorn_slots.map((a, i) => {
            const parsed = a.adorn_name ? parseAdornName(a.adorn_name) : null
            return (
              <span
                key={i}
                data-adorn-id={a.adorn_id ?? undefined}
                style={{
                  fontSize: '0.62rem', lineHeight: 1, padding: '1px 4px',
                  borderRadius: 2,
                  border: `1px solid ${adornColour(a.color)}`,
                  color: a.adorn_name ? adornColour(a.color) : 'var(--text-muted)',
                  fontStyle: a.adorn_name ? 'normal' : 'italic',
                  opacity: a.adorn_name ? 1 : 0.6,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  maxWidth: 150,
                  cursor: a.adorn_id ? 'default' : undefined,
                }}
              >
                {parsed ? (
                  <>{parsed.short} <span style={{ color: parsed.tierColor }}>({parsed.tierLetter})</span></>
                ) : (
                  a.adorn_name ?? 'Empty'
                )}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
  const hlBg     = highlight === 'direct' ? 'rgba(34,255,34,0.13)'
                 : highlight === 'adorn'  ? 'rgba(34,255,34,0.05)'
                 : undefined
  const hlBorder = highlight === 'direct' ? 'rgba(34,255,34,0.50)'
                 : highlight === 'adorn'  ? 'rgba(34,255,34,0.22)'
                 : undefined

  return (
    <div
      style={{
        ...slotRow,
        flexDirection: iconSide === 'left' ? 'row' : 'row-reverse',
        height: 'auto', minHeight: 50, alignItems: 'center',
        background:   hlBg     ?? 'var(--surface)',
        borderColor:  hlBorder ?? 'var(--border)',
        transition: 'background 0.12s ease, border-color 0.12s ease',
      }}
      onMouseOver={item?.item_id ? e => {
        const adornEl = (e.target as HTMLElement).closest('[data-adorn-id]')
        if (adornEl) {
          const adornId = adornEl.getAttribute('data-adorn-id')
          if (adornId) { onShow(adornId, e); return }
        }
        onShow(item.item_id!, e)
      } : undefined}
      onMouseLeave={item?.item_id ? onHide : undefined}
    >
      {iconEl}{textEl}
    </div>
  )
}

// ── AA Tab ────────────────────────────────────────────────────────────────────

type AATabState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; charAAs: CharAAsResponse; config: AAConfig; treeData: Map<number, AATreeData> }

const _TREE_TYPE_LABEL: Record<string, string> = {
  class:              'Class',
  subclass:           'Subclass',
  shadows:            'Shadows',
  heroic:             'Heroic',
  tradeskill:         'Tradeskill',
  tradeskill_general: 'Tradeskill (General)',
  warder:             'Warder',
  prestige:           'Prestige',
  dragon:             'Dragon',
  reign_of_shadows:   'Reign of Shadows',
  far_seas:           'Far Seas',
}

// 'current' = live AAs; number = index into charAAs.profiles
type ActiveProfile = 'current' | number

function AAsTab({ charName, aaCount }: { charName: string; aaCount: number }) {
  const cacheKey = charName.toLowerCase()
  const cached   = _aaCache.get(cacheKey)

  const [state, setState] = useState<AATabState>(
    cached ? { status: 'ok', ...cached } : { status: 'loading' }
  )
  const [selectedTreeId, setSelectedTreeId]     = useState<number | null>(
    cached ? (cached.charAAs.trees[0]?.tree_id ?? null) : null
  )
  const [activeProfile, setActiveProfile] = useState<ActiveProfile>('current')

  useEffect(() => {
    // Already cached — nothing to fetch
    if (_aaCache.has(cacheKey)) return

    let cancelled = false

    async function load() {
      try {
        const [aasRes, configRes] = await Promise.all([
          fetch(`/api/character/${encodeURIComponent(charName)}/aas`),
          fetch('/api/aa/config'),
        ])
        if (!aasRes.ok)    throw new Error(`AAs: HTTP ${aasRes.status}`)
        if (!configRes.ok) throw new Error(`Config: HTTP ${configRes.status}`)

        const charAAs: CharAAsResponse = await aasRes.json()
        const config:  AAConfig        = await configRes.json()

        // Filter trees to only those unlocked in the current xpac
        const unlocked = new Set(config.unlocked_tree_types)
        const visibleTrees = charAAs.trees.filter(t =>
          unlocked.size === 0 || unlocked.has(t.tree_type)
        )

        // Fetch full node data for each visible tree in parallel
        const treeResponses = await Promise.all(
          visibleTrees.map(t =>
            fetch(`/api/aa/tree/${t.tree_id}`)
              .then(r => r.ok ? r.json() as Promise<AATreeData> : null)
              .catch(() => null)
          )
        )

        if (cancelled) return

        const treeData = new Map<number, AATreeData>()
        for (const td of treeResponses) {
          if (td) treeData.set(td.tree_id, td)
        }

        const entry: AACacheEntry = { charAAs: { ...charAAs, trees: visibleTrees }, config, treeData }
        _aaCache.set(cacheKey, entry)
        setState({ status: 'ok', ...entry })
        setSelectedTreeId(prev => prev ?? (visibleTrees[0]?.tree_id ?? null))
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: String(err) })
      }
    }

    load()
    return () => { cancelled = true }
  }, [charName, cacheKey])

  if (state.status === 'loading') {
    return <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)' }}>Loading AA data…</p>
  }
  if (state.status === 'error') {
    return <p style={{ marginTop: '1.5rem', color: '#f87171' }}>Error: {state.message}</p>
  }

  const { charAAs, config, treeData } = state

  // Determine which set of trees (current or a profile) to display.
  // Profile trees are filtered to the same unlocked types as the current view.
  const unlocked = new Set(config.unlocked_tree_types)
  const profileTrees: CharAATree[] | null =
    activeProfile === 'current' ? null :
    (charAAs.profiles[activeProfile as number]?.trees ?? null)

  // Active tree list: profile trees (filtered) or current trees (already filtered during load).
  const visibleTrees: CharAATree[] = profileTrees
    ? profileTrees.filter(t => unlocked.size === 0 || unlocked.has(t.tree_type))
    : charAAs.trees

  const activeCt = visibleTrees.find(t => t.tree_id === selectedTreeId) ?? visibleTrees[0]
  const activeTd = activeCt ? treeData.get(activeCt.tree_id) : undefined

  // Sum only the shown trees.
  const spentInView = visibleTrees.reduce((sum, t) => sum + t.total_spent, 0)

  const earnedPct = config.aa_cap > 0
    ? Math.min(100, Math.round((aaCount / config.aa_cap) * 100))
    : null
  const spentPct = aaCount > 0
    ? Math.min(100, Math.round((spentInView / aaCount) * 100))
    : null

  return (
    <div style={{ marginTop: '1rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

      {/* ── Left sidebar ── */}
      <div style={{ width: 240, flexShrink: 0 }}>

        {/* Profile selector */}
        {charAAs.profiles.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', fontWeight: 600, marginBottom: 4 }}>
              Profile
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(['current', ...charAAs.profiles.map((_, i) => i)] as ActiveProfile[]).map(pid => {
                const isActive = activeProfile === pid
                const label    = pid === 'current' ? 'Current' : charAAs.profiles[pid as number].name
                return (
                  <button
                    key={String(pid)}
                    onClick={() => setActiveProfile(pid)}
                    style={{
                      textAlign: 'left',
                      background: isActive ? 'var(--accent)' : 'var(--surface)',
                      border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 4,
                      color: isActive ? '#000' : 'var(--text)',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: isActive ? 600 : 400,
                      padding: '4px 8px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      transition: 'background 0.12s, border-color 0.12s',
                    }}
                    title={label}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Expansion */}
        {config.xpac && (
          <StatGroup title="Expansion">
            <div style={{ padding: '3px 0', fontSize: '0.83rem', color: 'var(--text)' }}>
              {config.xpac}
            </div>
            {config.aa_cap > 0 && (
              <div style={{ padding: '1px 0 3px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {config.aa_cap.toLocaleString()} AA cap
              </div>
            )}
          </StatGroup>
        )}

        {/* Progress */}
        <StatGroup title="Alternate Advancements">
          <AAProgressBar
            label="Earned"
            value={aaCount}
            max={config.aa_cap > 0 ? config.aa_cap : null}
            pct={earnedPct}
          />
          <AAProgressBar
            label="Spent"
            value={spentInView}
            max={aaCount}
            pct={spentPct}
          />
        </StatGroup>

        {/* Per-tree breakdown */}
        {visibleTrees.length > 0 && (
          <StatGroup title="By Tree">
            {visibleTrees.map(ct => (
              <StatRow
                key={ct.tree_id}
                label={ct.tree_name}
                value={ct.total_spent.toLocaleString()}
              />
            ))}
          </StatGroup>
        )}

      </div>

      {/* ── Right: sub-tabs + tree ── */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {visibleTrees.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>No AA data available.</p>
        )}

        {visibleTrees.length > 0 && (
          <>
            {/* Tree sub-tabs */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '2px',
              borderBottom: '1px solid var(--border)',
              marginBottom: '0.75rem',
            }}>
              {visibleTrees.map(ct => {
                const active    = ct.tree_id === (activeCt?.tree_id)
                const typeLabel = _TREE_TYPE_LABEL[ct.tree_type] ?? ct.tree_type
                return (
                  <button
                    key={ct.tree_id}
                    onClick={() => setSelectedTreeId(ct.tree_id)}
                    style={{
                      background: active ? 'var(--surface)' : 'transparent',
                      border: 'none',
                      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                      color: active ? 'var(--text)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '5px 12px',
                      marginBottom: '-1px',
                      fontSize: '0.8rem',
                      fontWeight: active ? 600 : 400,
                      transition: 'color 0.12s, border-color 0.12s',
                      whiteSpace: 'nowrap',
                    }}
                    title={`${typeLabel} · ${ct.total_spent} pts`}
                  >
                    {ct.tree_name}
                  </button>
                )
              })}
            </div>

            {/* Active tree */}
            {activeCt && (
              <div>
                {/* Type label */}
                <div style={{ marginBottom: '0.4rem', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)' }}>
                  {_TREE_TYPE_LABEL[activeCt.tree_type] ?? activeCt.tree_type}
                </div>

                {/* Tree at 60% of the right column */}
                <div style={{ width: '60%' }}>
                  {activeTd ? (
                    <AATree tree={activeTd} spent={activeCt.spent} />
                  ) : (
                    <div style={{
                      background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 4, padding: '1rem',
                      color: 'var(--text-muted)', fontSize: '0.82rem',
                    }}>
                      Tree data unavailable (tree #{activeCt.tree_id})
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}

// ── Spells tab ────────────────────────────────────────────────────────────────

const SPELL_TIER_ORDER = ['Apprentice', 'Journeyman', 'Adept', 'Expert', 'Master', 'Grandmaster']

const SPELL_TIER_ICON: Record<string, string> = {
  Apprentice:  'spell_app',
  Journeyman:  'spell_jour',
  Adept:       'spell_ad',
  Expert:      'spell_exp',
  Master:      'spell_m',
  Grandmaster: 'spell_gm',
}

const SPELL_TIER_COLOURS: Record<string, { text: string; bg: string }> = {
  Apprentice:  { text: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  Journeyman:  { text: '#f97316', bg: 'rgba(249,115,22,0.12)'  },
  Adept:       { text: '#eab308', bg: 'rgba(234,179,8,0.12)'   },
  Expert:      { text: '#84cc16', bg: 'rgba(132,204,22,0.12)'  },
  Master:      { text: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  Grandmaster: { text: '#10b981', bg: 'rgba(16,185,129,0.15)'  },
}

const _SPELL_TH: React.CSSProperties = {
  padding: '0.4rem 0.6rem',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  textAlign: 'left',
}
const _SPELL_TD: React.CSSProperties = {
  padding: '0.35rem 0.6rem',
  fontSize: '0.88rem',
  whiteSpace: 'nowrap',
}

function SpellProgressBar({ label, subtitle, value, total, pct, color }: {
  label:    string
  subtitle: string
  value:    number
  total:    number
  pct:      number
  color:    string
}) {
  const clamped = Math.min(100, pct)
  const done    = clamped >= 100
  return (
    <div style={{ padding: '5px 0 7px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: done ? color : 'var(--text)' }}>{label}</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{value}/{total}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden', marginBottom: 2 }}>
        <div style={{ height: '100%', width: `${clamped}%`, borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{subtitle}</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: done ? color : 'var(--text-muted)' }}>
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  )
}

type SpellsTabState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: CharacterSpellsData }

function SpellsTab({ charName }: { charName: string }) {
  const cacheKey = charName.toLowerCase()
  const cached   = _spellsCache.get(cacheKey)

  const [state, setState]         = useState<SpellsTabState>(
    cached ? { status: 'ok', data: cached } : { status: 'loading' }
  )
  const [search, setSearch]       = useState('')
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (_spellsCache.has(cacheKey)) return
    let cancelled = false
    fetch(`/api/character/${encodeURIComponent(charName)}/spells`)
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<CharacterSpellsData>
      })
      .then(data => {
        if (cancelled) return
        _spellsCache.set(cacheKey, data)
        setState({ status: 'ok', data })
      })
      .catch(err => { if (!cancelled) setState({ status: 'error', message: String(err) }) })
    return () => { cancelled = true }
  }, [charName, cacheKey])

  if (state.status === 'loading') {
    return <p style={{ marginTop: '1.5rem', color: 'var(--text-muted)' }}>Loading spell data…</p>
  }
  if (state.status === 'error') {
    return <p style={{ marginTop: '1.5rem', color: '#f87171' }}>Error: {state.message}</p>
  }

  const { data } = state
  const totalSpells    = data.spells.length
  const expertOrBetter = (data.tier_counts['Expert'] ?? 0) + (data.tier_counts['Master'] ?? 0) + (data.tier_counts['Grandmaster'] ?? 0)
  const masterOrBetter = (data.tier_counts['Master'] ?? 0) + (data.tier_counts['Grandmaster'] ?? 0)
  const raidReadyPct   = totalSpells > 0 ? expertOrBetter / totalSpells * 100 : 0
  const masteredPct    = totalSpells > 0 ? masterOrBetter / totalSpells * 100 : 0

  // Filter the list
  const q = search.trim().toLowerCase()
  const filtered = data.spells.filter(s => {
    if (tierFilter.size > 0 && !tierFilter.has(s.tier)) return false
    if (q) return s.name.toLowerCase().includes(q)
    return true
  })

  function toggleTier(tier: string) {
    setTierFilter(prev => {
      const next = new Set(prev)
      next.has(tier) ? next.delete(tier) : next.add(tier)
      return next
    })
  }

  return (
    <div style={{ marginTop: '1rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

      {/* ── Left sidebar ── */}
      <div style={{ width: 240, flexShrink: 0 }}>
        <StatGroup title="By Tier">
          {SPELL_TIER_ORDER.map(tier => {
            const count    = data.tier_counts[tier] ?? 0
            if (count === 0) return null
            const tc       = SPELL_TIER_COLOURS[tier]
            const isActive = tierFilter.has(tier)
            return (
              <div
                key={tier}
                onClick={() => toggleTier(tier)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  padding: '3px 0', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  opacity: tierFilter.size > 0 && !isActive ? 0.35 : 1,
                  transition: 'opacity 0.12s',
                }}
              >
                <span style={{ fontSize: '0.78rem', color: tc?.text ?? 'var(--text)', fontWeight: isActive ? 700 : 400 }}>
                  {tier}
                </span>
                <span style={{
                  fontSize: '0.85rem', fontWeight: 600,
                  color: tc?.text ?? 'var(--text)',
                  background: isActive ? (tc?.bg ?? 'transparent') : 'transparent',
                  borderRadius: 3, padding: '0 4px',
                }}>
                  {count}
                </span>
              </div>
            )
          })}
          {/* Total row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0 1px', marginTop: 2 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{totalSpells}</span>
          </div>
        </StatGroup>

        {/* Progress bars */}
        <StatGroup title="Readiness">
          <SpellProgressBar
            label="Raid Ready"
            subtitle="Expert or better"
            value={expertOrBetter}
            total={totalSpells}
            pct={raidReadyPct}
            color="#84cc16"
          />
          <SpellProgressBar
            label="Fully Mastered"
            subtitle="Master or better"
            value={masterOrBetter}
            total={totalSpells}
            pct={masteredPct}
            color="#22c55e"
          />
        </StatGroup>

        {tierFilter.size > 0 && (
          <button
            onClick={() => setTierFilter(new Set())}
            style={{
              width: '100%', padding: '4px 0', fontSize: '0.75rem',
              color: 'var(--text-muted)', background: 'none',
              border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
              marginTop: 4,
            }}
          >
            Clear tier filter
          </button>
        )}
      </div>

      {/* ── Right: spell list (2 columns) ── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          type="text"
          placeholder="Search spells…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: '0.75rem', width: 260, boxSizing: 'border-box' }}
        />

        {filtered.length === 0 ? (
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
            padding: '1.5rem', color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.88rem',
          }}>
            No spells match your filter.
          </div>
        ) : (() => {
          const mid = Math.ceil(filtered.length / 2)
          const cols = [filtered.slice(0, mid), filtered.slice(mid)]

          const renderTable = (rows: SpellEntry[]) => (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
              overflow: 'hidden', flex: 1, minWidth: 0,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--surface-raised, var(--surface))' }}>
                    <th style={{ ..._SPELL_TH, width: 36, textAlign: 'right' }}>Lvl</th>
                    <th style={_SPELL_TH}>Name</th>
                    <th style={{ ..._SPELL_TH, textAlign: 'right', paddingRight: '0.5rem' }}>Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ..._SPELL_TD, textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem', width: 36 }}>
                        {s.level}
                      </td>
                      <td style={{ ..._SPELL_TD, fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {(s.icon_id != null || s.icon_backdrop != null) && (
                            <div style={{ position: 'relative', width: 18, height: 18, flexShrink: 0 }}>
                              {s.icon_backdrop != null && s.icon_backdrop > 0 && (
                                <img
                                  src={`/spell-icons/${s.icon_backdrop}.png`}
                                  alt=""
                                  style={{ position: 'absolute', inset: 0, width: 18, height: 18 }}
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                              )}
                              {s.icon_id != null && s.icon_id > 0 && (
                                <img
                                  src={`/spell-icons/${s.icon_id}.png`}
                                  alt=""
                                  style={{ position: 'absolute', inset: 0, width: 18, height: 18 }}
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                                />
                              )}
                            </div>
                          )}
                          <span style={{ fontSize: '0.82rem' }}>{s.name}</span>
                        </div>
                      </td>
                      <td style={{ ..._SPELL_TD, textAlign: 'right', paddingRight: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                          {SPELL_TIER_ORDER.map(t => {
                            const base = SPELL_TIER_ICON[t]
                            const filename = t === s.tier ? `${base}-lit.png` : `${base}.png`
                            return (
                              <img
                                key={t}
                                src={`/spell-icons/${filename}`}
                                alt={t}
                                title={t}
                                style={{ width: 14, height: 14 }}
                              />
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )

          return (
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
              {cols.map((col, ci) => renderTable(col))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── AA progress bar ───────────────────────────────────────────────────────────

function AAProgressBar({ label, value, max, pct }: {
  label: string
  value: number
  max:   number | null
  pct:   number | null
}) {
  const filled  = pct !== null && pct >= 100
  const barColor = filled ? '#22cc22' : 'var(--accent)'
  return (
    <div style={{ padding: '4px 0 6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </span>
        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
          {value.toLocaleString()}{max !== null ? ` / ${max.toLocaleString()}` : ''}
        </span>
      </div>
      {pct !== null && (
        <>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, borderRadius: 3,
              background: barColor, transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'right', marginTop: 2 }}>
            {pct}%
          </div>
        </>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const sectionHeading: React.CSSProperties = {
  fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.07em',
  color: 'var(--text-muted)', marginBottom: '0.5rem',
}
const slotRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '0.5rem',
  background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 4, padding: '4px 6px', minWidth: 0, minHeight: 50,
}
const iconBox: React.CSSProperties = {
  width: 40, height: 40, flexShrink: 0, borderRadius: 3,
  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
}
