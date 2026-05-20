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
  equipment: EquipmentSlot[]
}

const TIER_COLOUR: Record<string, string> = {
  FABLED:    'var(--tier-fabled)',
  LEGENDARY: 'var(--tier-legendary)',
  TREASURED: 'var(--tier-treasured)',
  UNCOMMON:  'var(--tier-uncommon)',
  COMMON:    'var(--tier-common)',
}

function tierColour(tier: string | null): string {
  return TIER_COLOUR[(tier ?? '').toUpperCase()] ?? 'var(--text-muted)'
}

type State =
  | { status: 'loading' }
  | { status: 'ok'; char: Character }
  | { status: 'not_found'; name: string }
  | { status: 'error'; message: string }

function CharacterPage() {
  const { name } = useParams<{ name: string }>()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!name) return
    setState({ status: 'loading' })
    fetch(`/api/character/${encodeURIComponent(name)}`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 404) {
          setState({ status: 'not_found', name })
          return
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setState({ status: 'error', message: body.detail ?? `HTTP ${res.status}` })
          return
        }
        const char: Character = await res.json()
        setState({ status: 'ok', char })
      })
      .catch(err => setState({ status: 'error', message: String(err) }))
  }, [name])

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        ← Back
      </Link>

      {state.status === 'loading' && (
        <p style={{ marginTop: '2rem', color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {state.status === 'not_found' && (
        <p style={{ marginTop: '2rem', color: 'var(--text-muted)' }}>
          Character <strong>{state.name}</strong> not found.
        </p>
      )}

      {state.status === 'error' && (
        <p style={{ marginTop: '2rem', color: '#f87171' }}>Error: {state.message}</p>
      )}

      {state.status === 'ok' && <CharacterView char={state.char} />}
    </main>
  )
}

function CharacterView({ char }: { char: Character }) {
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>{char.name}</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        {[char.world, char.race, char.gender].filter(Boolean).join(' · ')}
      </p>

      <div style={cardStyle}>
        <Stat label="Level"  value={char.level ?? '—'} />
        <Stat label="Class"  value={char.cls ?? '—'} />
        <Stat label="AAs"    value={char.aa_count} />
        {char.deity && <Stat label="Deity" value={char.deity} />}
      </div>

      {char.equipment.length > 0 && (
        <>
          <h2 style={{ margin: '1.5rem 0 0.75rem', fontSize: '1rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Equipment
          </h2>
          <div style={cardStyle}>
            {char.equipment.map(slot => (
              <div key={slot.slot} style={{ display: 'flex', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ minWidth: 100, color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'capitalize' }}>
                  {slot.slot}
                </span>
                <span style={{ color: tierColour(slot.tier), fontWeight: 500 }}>
                  {slot.name}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {char.equipment.length === 0 && (
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>No equipment data available.</p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.75rem' }}>
      <span style={{ minWidth: 80, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '0.25rem 1rem',
}

export default CharacterPage
