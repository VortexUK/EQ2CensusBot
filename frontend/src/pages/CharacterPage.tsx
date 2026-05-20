import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'

interface EquipmentSlot {
  slot: string
  name: string
  item_id: string | null
  icon_id: string | null
  tier: string | null
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
  equipment: EquipmentSlot[]
}

// [label, internal_key] — order matches eq2wire paperdoll
const LEFT_SLOTS: [string, string][] = [
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
  ['Ranged',     'ranged'],
  ['Charm',      'activate1'],
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
  ['Food',       'food'],
  ['Drink',      'drink'],
]

// Census displayname → internal key(s) — multi-slot types resolved by encounter order
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

const TIER_COLOUR: Record<string, string> = {
  FABLED:    'var(--tier-fabled)',
  LEGENDARY: 'var(--tier-legendary)',
  TREASURED: 'var(--tier-treasured)',
  UNCOMMON:  'var(--tier-uncommon)',
  COMMON:    'var(--tier-common)',
}
function tierColour(tier: string | null) {
  return TIER_COLOUR[(tier ?? '').toUpperCase()] ?? 'var(--text)'
}

function iconUrl(iconId: string | null): string | null {
  return iconId
    ? `https://census.daybreakgames.com/files/eq2/images/icons/icon_${iconId}.png`
    : null
}

type State =
  | { status: 'loading' }
  | { status: 'ok'; char: Character }
  | { status: 'not_found'; name: string }
  | { status: 'error'; message: string }

export default function CharacterPage() {
  const { name } = useParams<{ name: string }>()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!name) return
    setState({ status: 'loading' })
    fetch(`/api/character/${encodeURIComponent(name)}`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 404) { setState({ status: 'not_found', name }); return }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setState({ status: 'error', message: body.detail ?? `HTTP ${res.status}` })
          return
        }
        setState({ status: 'ok', char: await res.json() })
      })
      .catch(err => setState({ status: 'error', message: String(err) }))
  }, [name])

  return (
    <main style={{ maxWidth: 960, margin: '2rem auto', padding: '0 1rem' }}>
      <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>← Back</Link>
      {state.status === 'loading' && <p style={{ marginTop: '2rem', color: 'var(--text-muted)' }}>Loading…</p>}
      {state.status === 'not_found' && <p style={{ marginTop: '2rem', color: 'var(--text-muted)' }}>Character <strong>{state.name}</strong> not found.</p>}
      {state.status === 'error' && <p style={{ marginTop: '2rem', color: '#f87171' }}>Error: {state.message}</p>}
      {state.status === 'ok' && <CharacterView char={state.char} />}
    </main>
  )
}

function CharacterView({ char }: { char: Character }) {
  const bySlot = buildSlotMap(char.equipment)

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h1 style={{ marginBottom: '0.15rem' }}>{char.name}</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        {[char.world, char.race, char.gender].filter(Boolean).join(' · ')}
      </p>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.75rem' }}>
        <Chip label="Level"    value={char.level ?? '—'} />
        <Chip label="Class"    value={char.cls ?? '—'} />
        <Chip label="AAs"      value={char.aa_count} />
        {char.deity    && <Chip label="Deity"    value={char.deity} />}
        {char.ts_class && <Chip label="Crafting" value={`${char.ts_class} ${char.ts_level ?? ''}`} />}
      </div>

      {/* Paperdoll */}
      <h2 style={sectionHeading}>Equipment</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        {/* Left column — icon on the LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {LEFT_SLOTS.map(([label, key]) => (
            <SlotRow key={key} label={label} item={bySlot.get(key) ?? null} iconSide="left" />
          ))}
        </div>
        {/* Right column — icon on the RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {RIGHT_SLOTS.map(([label, key]) => (
            <SlotRow key={key} label={label} item={bySlot.get(key) ?? null} iconSide="right" />
          ))}
        </div>
      </div>
    </div>
  )
}

function SlotRow({
  label,
  item,
  iconSide,
}: {
  label: string
  item: EquipmentSlot | null
  iconSide: 'left' | 'right'
}) {
  const url = iconUrl(item?.icon_id ?? null)

  const iconEl = (
    <div style={iconBox}>
      {url ? (
        <img
          src={url}
          alt={item?.name ?? ''}
          style={{ width: 40, height: 40 }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : null}
    </div>
  )

  const textEl = (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', lineHeight: 1 }}>
        {label}
      </span>
      {item ? (
        <span style={{ color: tierColour(item.tier), fontWeight: 500, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
          {item.name}
        </span>
      ) : (
        <span style={{ color: 'var(--border)', fontSize: '0.82rem', fontStyle: 'italic', lineHeight: 1.3 }}>
          Empty
        </span>
      )}
    </div>
  )

  return (
    <div style={{ ...slotRow, flexDirection: iconSide === 'left' ? 'row' : 'row-reverse' }}>
      {iconEl}
      {textEl}
    </div>
  )
}

function Chip({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.3rem 0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{label}</span>
      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{value}</span>
    </div>
  )
}

const sectionHeading: React.CSSProperties = {
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'var(--text-muted)',
  marginBottom: '0.5rem',
}

const slotRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 4,
  padding: '3px 6px',
  minWidth: 0,
  height: 50,
}

const iconBox: React.CSSProperties = {
  width: 40,
  height: 40,
  flexShrink: 0,
  background: 'var(--surface-raised)',
  borderRadius: 3,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
}
