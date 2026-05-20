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

interface MemberSpellTiers {
  name: string
  rank: string | null
  tiers: Record<string, number>
  total: number
}

interface GuildSpellCheck {
  guild_name: string
  world: string
  tiers: string[]
  members: MemberSpellTiers[]
}

interface AdornColorStats {
  filled: number
  total: number
}

interface MemberAdornStats {
  name: string
  rank: string | null
  adorns: Record<string, AdornColorStats>
}

interface GuildAdornCheck {
  guild_name: string
  world: string
  colors: string[]
  members: MemberAdornStats[]
}

type Tab = 'roster' | 'spells' | 'adorns'

// ── Style helpers ─────────────────────────────────────────────────────────────

const CLASS_COLOURS: Record<string, string> = {
  Guardian: '#93b4ff', Berserker: '#93b4ff',
  Paladin: '#93b4ff', Shadowknight: '#c493ff',
  Monk: '#93b4ff', Bruiser: '#93b4ff',
  Ranger: '#beff93', Assassin: '#beff93',
  Troubador: '#beff93', Dirge: '#beff93',
  Swashbuckler: '#beff93', Brigand: '#beff93',
  Wizard: '#ff9393', Warlock: '#ff9393',
  Conjuror: '#ff9393', Necromancer: '#c493ff',
  Illusionist: '#c493ff', Coercer: '#c493ff',
  Templar: '#ffd993', Inquisitor: '#ffd993',
  Mystic: '#ffd993', Defiler: '#c493ff',
  Warden: '#beff93', Fury: '#beff93',
}

// Tier → colour: below Expert = red tones, Expert+ = green tones
const TIER_COLOURS: Record<string, { text: string; bg: string }> = {
  Apprentice:   { text: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
  Journeyman:   { text: '#f97316', bg: 'rgba(249,115,22,0.12)'  },
  Adept:        { text: '#eab308', bg: 'rgba(234,179,8,0.12)'   },
  Expert:       { text: '#84cc16', bg: 'rgba(132,204,22,0.12)'  },
  Master:       { text: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  Grandmaster:  { text: '#10b981', bg: 'rgba(16,185,129,0.15)'  },
}

// Adorn fill rate → colour
function adornCellStyle(filled: number, total: number): React.CSSProperties {
  if (total === 0) return { color: 'var(--text-muted)' }
  const pct = filled / total
  if (pct === 1)   return { color: '#22c55e' }
  if (pct >= 0.75) return { color: '#84cc16' }
  if (pct >= 0.5)  return { color: '#eab308' }
  if (pct >= 0.25) return { color: '#f97316' }
  return { color: '#ef4444' }
}

// ── Shared table styles ───────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  textAlign: 'left',
}

const TD: React.CSSProperties = {
  padding: '0.42rem 0.6rem',
  fontSize: '0.88rem',
  whiteSpace: 'nowrap',
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '0.4rem 1rem',
        borderRadius: 6,
        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
        background: active ? 'rgba(var(--accent-rgb,99,210,130),0.12)' : 'var(--surface)',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        cursor: 'pointer',
        fontSize: '0.88rem',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  )
}

// ── Roster table ──────────────────────────────────────────────────────────────

function RosterTable({ members, filter }: { members: GuildMember[]; filter: string }) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return members
    return members.filter(m =>
      m.name.toLowerCase().includes(q) ||
      (m.cls ?? '').toLowerCase().includes(q) ||
      (m.rank ?? '').toLowerCase().includes(q),
    )
  }, [members, filter])

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--surface-raised)' }}>
          {['Name', 'Rank', 'Class (Level)', 'AA', 'Tradeskill (Level)', 'Deity'].map(h => (
            <th key={h} style={{ ...TH, textAlign: h === 'AA' ? 'right' : 'left' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filtered.length === 0 ? (
          <tr><td colSpan={6} style={{ ...TD, textAlign: 'center', color: 'var(--text-muted)' }}>No members match your filter.</td></tr>
        ) : filtered.map(m => {
          const clsLabel = m.cls
            ? m.level != null ? `${m.cls} (${m.level})` : m.cls
            : '—'
          const tsLabel = m.ts_class
            ? m.ts_level != null
              ? `${m.ts_class.charAt(0).toUpperCase()}${m.ts_class.slice(1)} (${m.ts_level})`
              : m.ts_class
            : '—'
          return (
            <tr key={m.name} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={TD}>
                <Link to={`/character/${encodeURIComponent(m.name)}`}
                  style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                  {m.name}
                </Link>
              </td>
              <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{m.rank ?? '—'}</td>
              <td style={{ ...TD, color: m.cls ? (CLASS_COLOURS[m.cls] ?? 'var(--text)') : 'var(--text-muted)' }}>{clsLabel}</td>
              <td style={{ ...TD, textAlign: 'right', color: 'var(--text-muted)' }}>{m.aa_level ?? '—'}</td>
              <td style={{ ...TD, color: 'var(--text-muted)' }}>{tsLabel}</td>
              <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.82rem' }}>{m.deity ?? '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Spell check table ─────────────────────────────────────────────────────────

function SpellCheckTable({ data, filter }: { data: GuildSpellCheck; filter: string }) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return data.members
    return data.members.filter(m =>
      m.name.toLowerCase().includes(q) || (m.rank ?? '').toLowerCase().includes(q),
    )
  }, [data.members, filter])

  // Abbreviated tier headers
  const tierShort: Record<string, string> = {
    Apprentice: 'App', Journeyman: 'Journ', Adept: 'Adept',
    Expert: 'Expert', Master: 'Master', Grandmaster: 'GM',
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--surface-raised)' }}>
          <th style={TH}>Name</th>
          <th style={TH}>Rank</th>
          {data.tiers.map(t => {
            const tc = TIER_COLOURS[t]
            return (
              <th key={t} style={{ ...TH, textAlign: 'right', color: tc?.text ?? 'var(--text-muted)' }}>
                {tierShort[t] ?? t}
              </th>
            )
          })}
          <th style={{ ...TH, textAlign: 'right', color: 'var(--text-muted)' }}>Total</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map(m => (
          <tr key={m.name} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={TD}>
              <Link to={`/character/${encodeURIComponent(m.name)}`}
                style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                {m.name}
              </Link>
            </td>
            <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{m.rank ?? '—'}</td>
            {data.tiers.map(t => {
              const count = m.tiers[t] ?? 0
              const tc = TIER_COLOURS[t]
              return (
                <td key={t} style={{
                  ...TD, textAlign: 'right',
                  color: count > 0 ? (tc?.text ?? 'var(--text)') : 'var(--text-muted)',
                  background: count > 0 ? (tc?.bg ?? 'transparent') : 'transparent',
                  fontWeight: count > 0 ? 500 : 400,
                }}>
                  {count > 0 ? count : '—'}
                </td>
              )
            })}
            <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
              {m.total}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Adorn check table ─────────────────────────────────────────────────────────

function AdornCheckTable({ data, filter }: { data: GuildAdornCheck; filter: string }) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return data.members
    return data.members.filter(m =>
      m.name.toLowerCase().includes(q) || (m.rank ?? '').toLowerCase().includes(q),
    )
  }, [data.members, filter])

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--surface-raised)' }}>
          <th style={TH}>Name</th>
          <th style={TH}>Rank</th>
          {data.colors.map(c => (
            <th key={c} style={{ ...TH, textAlign: 'right' }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {filtered.map(m => (
          <tr key={m.name} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={TD}>
              <Link to={`/character/${encodeURIComponent(m.name)}`}
                style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                {m.name}
              </Link>
            </td>
            <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{m.rank ?? '—'}</td>
            {data.colors.map(c => {
              const stats = m.adorns[c]
              if (!stats) return (
                <td key={c} style={{ ...TD, textAlign: 'right', color: 'var(--text-muted)' }}>—</td>
              )
              return (
                <td key={c} style={{ ...TD, textAlign: 'right', fontWeight: 500, ...adornCellStyle(stats.filled, stats.total) }}>
                  {stats.filled}/{stats.total}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GuildPage() {
  const { characterName } = useParams<{ characterName: string }>()

  const [tab, setTab] = useState<Tab>('roster')
  const [filter, setFilter] = useState('')

  // Roster state
  const [roster, setRoster] = useState<GuildData | null>(null)
  const [rosterError, setRosterError] = useState<string | null>(null)
  const [rosterLoading, setRosterLoading] = useState(true)

  // Spell check state
  const [spells, setSpells] = useState<GuildSpellCheck | null>(null)
  const [spellsError, setSpellsError] = useState<string | null>(null)
  const [spellsLoading, setSpellsLoading] = useState(false)

  // Adorn check state
  const [adorns, setAdorns] = useState<GuildAdornCheck | null>(null)
  const [adornsError, setAdornsError] = useState<string | null>(null)
  const [adornsLoading, setAdornsLoading] = useState(false)

  // Load roster on mount
  useEffect(() => {
    if (!characterName) return
    setRosterLoading(true)
    setRosterError(null)
    fetch(`/api/guild/${encodeURIComponent(characterName)}`)
      .then(async res => {
        if (!res.ok) { setRosterError((await res.json().catch(() => ({}))).detail ?? `Error ${res.status}`); return }
        setRoster(await res.json())
      })
      .catch(() => setRosterError('Network error — please try again.'))
      .finally(() => setRosterLoading(false))
  }, [characterName])

  // Load spell check when tab first selected
  function loadSpells() {
    if (spells || spellsLoading || !characterName) return
    setSpellsLoading(true)
    setSpellsError(null)
    fetch(`/api/guild/${encodeURIComponent(characterName)}/spell-check`)
      .then(async res => {
        if (!res.ok) { setSpellsError((await res.json().catch(() => ({}))).detail ?? `Error ${res.status}`); return }
        setSpells(await res.json())
      })
      .catch(() => setSpellsError('Network error — please try again.'))
      .finally(() => setSpellsLoading(false))
  }

  // Load adorn check when tab first selected
  function loadAdorns() {
    if (adorns || adornsLoading || !characterName) return
    setAdornsLoading(true)
    setAdornsError(null)
    fetch(`/api/guild/${encodeURIComponent(characterName)}/adorn-check`)
      .then(async res => {
        if (!res.ok) { setAdornsError((await res.json().catch(() => ({}))).detail ?? `Error ${res.status}`); return }
        setAdorns(await res.json())
      })
      .catch(() => setAdornsError('Network error — please try again.'))
      .finally(() => setAdornsLoading(false))
  }

  function switchTab(t: Tab) {
    setTab(t)
    setFilter('')
    if (t === 'spells') loadSpells()
    if (t === 'adorns') loadAdorns()
  }

  const guildName = roster?.name ?? spells?.guild_name ?? adorns?.guild_name ?? '…'
  const guildWorld = roster?.world ?? _world()
  const memberCount = roster?.members.length

  function _world() { return '' }

  const isLoading = tab === 'roster' ? rosterLoading
    : tab === 'spells' ? spellsLoading
    : adornsLoading

  const error = tab === 'roster' ? rosterError
    : tab === 'spells' ? spellsError
    : adornsError

  return (
    <main style={{ maxWidth: 1000, margin: '3rem auto', padding: '0 1rem' }}>
      <Link
        to={characterName ? `/character/${encodeURIComponent(characterName)}` : '/'}
        style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}
      >
        ← {characterName ? `Back to ${characterName}` : 'Back'}
      </Link>

      {/* Header */}
      {(roster || spells || adorns) && (
        <div style={{ margin: '1rem 0 1rem' }}>
          <h1 style={{ margin: '0 0 0.2rem', fontSize: '1.6rem' }}>{guildName}</h1>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {guildWorld}{memberCount != null ? ` · ${memberCount} members with census data` : ''}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
        <TabBtn label="Roster"       active={tab === 'roster'} onClick={() => switchTab('roster')} />
        <TabBtn label="Spell Check"  active={tab === 'spells'} onClick={() => switchTab('spells')} />
        <TabBtn label="Adorn Check"  active={tab === 'adorns'} onClick={() => switchTab('adorns')} />
      </div>

      {/* Filter */}
      {!isLoading && !error && (
        <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <input
            type="text"
            placeholder="Filter by name, class or rank…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            style={{ maxWidth: 300, boxSizing: 'border-box' }}
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          <p>
            {tab === 'spells'
              ? 'Loading spell data for all members… this takes a minute for large guilds.'
              : 'Fetching guild data…'}
          </p>
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <p style={{ color: '#f87171' }}>{error}</p>
      )}

      {/* Tables */}
      {!isLoading && !error && (
        <div style={{
          overflowX: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}>
          {tab === 'roster' && roster && (
            <RosterTable members={roster.members} filter={filter} />
          )}
          {tab === 'spells' && spells && (
            <SpellCheckTable data={spells} filter={filter} />
          )}
          {tab === 'adorns' && adorns && (
            <AdornCheckTable data={adorns} filter={filter} />
          )}
        </div>
      )}
    </main>
  )
}
