import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GuildMember {
  name: string
  level: number | null
  cls: string | null
  ts_class: string | null
  ts_level: number | null
  aa_level: number | null
  deity: string | null
  rank: string | null
  rank_id: number | null
}

interface GuildData {
  name: string
  world: string
  members: GuildMember[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const QUALITY_COLOURS: Record<string, string> = {
  Fabled:        '#ff99ff',
  Legendary:     '#ffc993',
  Treasured:     '#93d9ff',
  Mastercrafted: '#93d9ff',
  Uncommon:      '#beff93',
  Handcrafted:   '#beff93',
}

// Adventurer class → rough colour bucket (keep it subtle)
const CLASS_COLOURS: Record<string, string> = {
  // Fighters
  Guardian: '#93b4ff', Berserker: '#93b4ff',
  Paladin: '#93b4ff', Shadowknight: '#c493ff',
  Monk: '#93b4ff', Bruiser: '#93b4ff',
  // Scouts
  Ranger: '#beff93', Assassin: '#beff93',
  Troubador: '#beff93', Dirge: '#beff93',
  Swashbuckler: '#beff93', Brigand: '#beff93',
  // Mages
  Wizard: '#ff9393', Warlock: '#ff9393',
  Conjuror: '#ff9393', Necromancer: '#c493ff',
  Illusionist: '#c493ff', Coercer: '#c493ff',
  // Priests
  Templar: '#ffd993', Inquisitor: '#ffd993',
  Mystic: '#ffd993', Defiler: '#c493ff',
  Warden: '#beff93', Fury: '#beff93',
}

function classColour(cls: string | null): string {
  return cls ? (CLASS_COLOURS[cls] ?? 'var(--text)') : 'var(--text-muted)'
}

// ── Row ───────────────────────────────────────────────────────────────────────

function MemberRow({ m }: { m: GuildMember }) {
  const clsLabel = m.cls
    ? m.level != null ? `${m.cls} (${m.level})` : m.cls
    : '—'
  const tsLabel = m.ts_class
    ? m.ts_level != null
      ? `${m.ts_class.charAt(0).toUpperCase()}${m.ts_class.slice(1)} (${m.ts_level})`
      : m.ts_class
    : '—'

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Name */}
      <td style={{ padding: '0.45rem 0.6rem', whiteSpace: 'nowrap' }}>
        <Link
          to={`/character/${encodeURIComponent(m.name)}`}
          style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
        >
          {m.name}
        </Link>
      </td>
      {/* Rank */}
      <td style={{ padding: '0.45rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
        {m.rank ?? '—'}
      </td>
      {/* Class */}
      <td style={{ padding: '0.45rem 0.6rem', color: classColour(m.cls), fontSize: '0.88rem', whiteSpace: 'nowrap' }}>
        {clsLabel}
      </td>
      {/* AA */}
      <td style={{ padding: '0.45rem 0.6rem', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        {m.aa_level ?? '—'}
      </td>
      {/* Tradeskill */}
      <td style={{ padding: '0.45rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
        {tsLabel}
      </td>
      {/* Deity */}
      <td style={{ padding: '0.45rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
        {m.deity ?? '—'}
      </td>
    </tr>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GuildPage() {
  const { characterName } = useParams<{ characterName: string }>()
  const [guild, setGuild] = useState<GuildData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!characterName) return
    setLoading(true)
    setError(null)
    setGuild(null)
    fetch(`/api/guild/${encodeURIComponent(characterName)}`)
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.detail ?? `Error ${res.status}`)
        } else {
          setGuild(await res.json())
        }
      })
      .catch(() => setError('Network error — please try again.'))
      .finally(() => setLoading(false))
  }, [characterName])

  const filtered = useMemo(() => {
    if (!guild) return []
    const q = filter.trim().toLowerCase()
    if (!q) return guild.members
    return guild.members.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.cls ?? '').toLowerCase().includes(q) ||
      (m.rank ?? '').toLowerCase().includes(q)
    )
  }, [guild, filter])

  return (
    <main style={{ maxWidth: 900, margin: '3rem auto', padding: '0 1rem' }}>
      <Link
        to={characterName ? `/character/${encodeURIComponent(characterName)}` : '/'}
        style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}
      >
        ← {characterName ? `Back to ${characterName}` : 'Back'}
      </Link>

      {loading && (
        <div style={{ marginTop: '2rem', color: 'var(--text-muted)' }}>
          <p>Fetching guild roster… this may take a moment.</p>
        </div>
      )}

      {error && (
        <p style={{ marginTop: '2rem', color: '#f87171' }}>{error}</p>
      )}

      {guild && (
        <>
          {/* Header */}
          <div style={{ margin: '1rem 0 1.25rem' }}>
            <h1 style={{ margin: '0 0 0.2rem', fontSize: '1.6rem' }}>{guild.name}</h1>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {guild.world} · {guild.members.length} members with census data
            </span>
          </div>

          {/* Filter */}
          <div style={{ marginBottom: '0.75rem' }}>
            <input
              type="text"
              placeholder="Filter by name, class or rank…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ width: '100%', maxWidth: 320, boxSizing: 'border-box' }}
            />
            {filter && (
              <span style={{ marginLeft: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {filtered.length} / {guild.members.length}
              </span>
            )}
          </div>

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: '0.9rem',
            }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--surface-raised)' }}>
                  {['Name', 'Rank', 'Class (Level)', 'AA', 'Tradeskill (Level)', 'Deity'].map(h => (
                    <th key={h} style={{
                      padding: '0.5rem 0.6rem', textAlign: h === 'AA' ? 'right' : 'left',
                      fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No members match your filter.
                    </td>
                  </tr>
                ) : (
                  filtered.map(m => <MemberRow key={m.name} m={m} />)
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
