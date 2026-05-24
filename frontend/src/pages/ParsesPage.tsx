import type { CSSProperties } from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParseEncounterSummary {
  id: number
  act_encid: string
  title: string
  zone: string | null
  started_at: number       // unix seconds, UTC
  ended_at: number
  duration_s: number
  total_damage: number
  encdps: number
  kills: number
  deaths: number
  combatant_count: number
  player_count: number
  guild_name?: string | null   // Phase 3 — currently absent
}

interface ParsesListResponse {
  results: ParseEncounterSummary[]
  total: number
}

type SizeFilter = '' | 'individual' | 'group' | 'raid12' | 'raid24'

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE_OPTIONS: { value: SizeFilter; label: string; range: string }[] = [
  { value: '',           label: 'All sizes',  range: '' },
  { value: 'raid24',     label: 'Raid (24)',  range: '13–24' },
  { value: 'raid12',     label: 'Raid (12)',  range: '7–12'  },
  { value: 'group',      label: 'Group',      range: '2–6'   },
  { value: 'individual', label: 'Individual', range: '1'     },
]

const NO_GUILD = 'No Guild'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m${String(s).padStart(2, '0')}s`
}

function fmtNum(n: number): string {
  return n.toLocaleString()
}

function fmtLocalDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  // YYYY-MM-DD in user's local timezone
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function fmtLocalTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function sizeLabel(playerCount: number): string {
  if (playerCount >= 13) return 'Raid (24)'
  if (playerCount >= 7)  return 'Raid (12)'
  if (playerCount >= 2)  return 'Group'
  return 'Individual'
}

// ── Grouped structure ─────────────────────────────────────────────────────────
// Guild → (LocalDate + Zone) → Encounter[]

interface ZoneBucket {
  key: string                  // "2026-05-24 — Great Divide"
  date: string                 // "2026-05-24"
  zone: string                 // "Great Divide"
  encounters: ParseEncounterSummary[]
}

interface GuildBucket {
  guild: string                // "Exordium" or "No Guild"
  zoneBuckets: ZoneBucket[]
}

function groupEncounters(encounters: ParseEncounterSummary[]): GuildBucket[] {
  const byGuild = new Map<string, Map<string, ParseEncounterSummary[]>>()

  for (const e of encounters) {
    const guild = e.guild_name || NO_GUILD
    const date = fmtLocalDate(e.started_at)
    const zone = e.zone || '(unknown zone)'
    const zoneKey = `${date} — ${zone}`

    let guildMap = byGuild.get(guild)
    if (!guildMap) {
      guildMap = new Map()
      byGuild.set(guild, guildMap)
    }
    let zoneEncs = guildMap.get(zoneKey)
    if (!zoneEncs) {
      zoneEncs = []
      guildMap.set(zoneKey, zoneEncs)
    }
    zoneEncs.push(e)
  }

  // Build result with zones sorted by their newest encounter (desc) within each guild.
  const result: GuildBucket[] = []
  for (const [guild, zoneMap] of byGuild) {
    const zoneBuckets: ZoneBucket[] = []
    for (const [key, encs] of zoneMap) {
      // Encounters already in started_at DESC order from the API; preserve.
      const [date, zone] = key.split(' — ')
      zoneBuckets.push({ key, date, zone, encounters: encs })
    }
    zoneBuckets.sort((a, b) => b.encounters[0].started_at - a.encounters[0].started_at)
    result.push({ guild, zoneBuckets })
  }
  // Sort guilds: "No Guild" last, others alphabetical.
  result.sort((a, b) => {
    if (a.guild === NO_GUILD) return 1
    if (b.guild === NO_GUILD) return -1
    return a.guild.localeCompare(b.guild)
  })
  return result
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ParsesPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [size, setSize] = useState<SizeFilter>(
    (searchParams.get('size') as SizeFilter) ?? '',
  )
  const [data, setData] = useState<ParsesListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // URL sync
  useEffect(() => {
    const p: Record<string, string> = {}
    if (size) p.size = size
    setSearchParams(p, { replace: true })
  }, [size, setSearchParams])

  // Fetch
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const url = new URL('/api/parses', window.location.origin)
    if (size) url.searchParams.set('size', size)
    url.searchParams.set('limit', '500')

    fetch(url.toString(), { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`)
        return r.json()
      })
      .then((json: ParsesListResponse) => {
        if (!cancelled) setData(json)
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [size])

  const grouped = useMemo(
    () => (data ? groupEncounters(data.results) : []),
    [data],
  )

  const setFilter = useCallback((v: SizeFilter) => setSize(v), [])

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '1rem' }}>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.7rem', color: 'var(--gold)', margin: 0 }}>
          Parses
        </h1>
        {data && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {data.total.toLocaleString()} encounter{data.total !== 1 ? 's' : ''}{size && ' (filtered)'}
          </span>
        )}
      </div>

      {/* Filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.2rem' }}>
        {SIZE_OPTIONS.map(opt => (
          <button
            key={opt.value || 'all'}
            onClick={() => setFilter(opt.value)}
            style={pillStyle(size === opt.value)}
          >
            {opt.label}
            {opt.range && (
              <span style={{ marginLeft: '0.35rem', opacity: 0.6, fontSize: '0.72rem' }}>{opt.range}</span>
            )}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && !error && data && data.results.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>
          No parses {size ? `match the ${size} filter` : 'yet'}.
        </p>
      )}

      {!loading && grouped.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {grouped.map(g => (
            <GuildSection
              key={g.guild}
              bucket={g}
              defaultExpanded={grouped.length === 1}
            />
          ))}
        </div>
      )}
    </main>
  )
}

// ── Guild / Zone / Encounter rendering ────────────────────────────────────────

function GuildSection({ bucket, defaultExpanded }: { bucket: GuildBucket; defaultExpanded: boolean }) {
  const [open, setOpen] = useState(defaultExpanded)
  const totalEncs = bucket.zoneBuckets.reduce((s, z) => s + z.encounters.length, 0)
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <button onClick={() => setOpen(v => !v)} style={headerBtnStyle}>
        <Caret open={open} />
        <span style={{ fontFamily: 'var(--font-heading)', fontSize: '0.98rem', color: 'var(--gold)' }}>
          {bucket.guild}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: 'auto' }}>
          {bucket.zoneBuckets.length} zone-{bucket.zoneBuckets.length === 1 ? 'day' : 'days'} · {totalEncs} encounter{totalEncs !== 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 0.5rem 0.6rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {bucket.zoneBuckets.map(z => (
            <ZoneSection
              key={z.key}
              bucket={z}
              defaultExpanded={bucket.zoneBuckets.length === 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ZoneSection({ bucket, defaultExpanded }: { bucket: ZoneBucket; defaultExpanded: boolean }) {
  const [open, setOpen] = useState(defaultExpanded)
  return (
    <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border)', borderRadius: 6 }}>
      <button onClick={() => setOpen(v => !v)} style={{ ...headerBtnStyle, padding: '0.4rem 0.6rem' }}>
        <Caret open={open} />
        <span style={{ fontSize: '0.88rem', color: 'var(--text)' }}>
          <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>{bucket.date}</span>
          {bucket.zone}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginLeft: 'auto' }}>
          {bucket.encounters.length} fight{bucket.encounters.length !== 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 0.4rem 0.4rem' }}>
          <EncounterTable encounters={bucket.encounters} />
        </div>
      )}
    </div>
  )
}

function EncounterTable({ encounters }: { encounters: ParseEncounterSummary[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 70px 110px 90px 90px', columnGap: '0.5rem', rowGap: '2px', alignItems: 'center', fontSize: '0.82rem' }}>
      <div style={hdrCellStyle}>Encounter</div>
      <div style={{ ...hdrCellStyle, textAlign: 'right' }}>Time</div>
      <div style={{ ...hdrCellStyle, textAlign: 'right' }}>Dur</div>
      <div style={{ ...hdrCellStyle, textAlign: 'right' }}>Damage</div>
      <div style={{ ...hdrCellStyle, textAlign: 'right' }}>DPS</div>
      <div style={{ ...hdrCellStyle, textAlign: 'right' }}>Players</div>
      {encounters.map(e => (
        <RowGroup key={e.id} encounter={e} />
      ))}
    </div>
  )
}

function RowGroup({ encounter: e }: { encounter: ParseEncounterSummary }) {
  return (
    <>
      <Link
        to={`/parse/${e.id}`}
        style={{ color: 'var(--text)', textDecoration: 'none', padding: '4px 0' }}
      >
        {e.title}
      </Link>
      <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtLocalTime(e.started_at)}</div>
      <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{fmtDuration(e.duration_s)}</div>
      <div style={{ textAlign: 'right' }}>{fmtNum(e.total_damage)}</div>
      <div style={{ textAlign: 'right', color: 'var(--gold)' }}>{fmtNum(Math.round(e.encdps))}</div>
      <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
        {e.player_count} <span style={{ opacity: 0.55, fontSize: '0.7rem' }}>({sizeLabel(e.player_count)})</span>
      </div>
    </>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const headerBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  width: '100%',
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
  font: 'inherit',
}

const hdrCellStyle: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '0.25rem 0',
  borderBottom: '1px solid var(--border)',
  marginBottom: '0.2rem',
}

function pillStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'var(--gold)' : 'var(--surface)',
    color: active ? '#0f1117' : 'var(--text)',
    border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
    borderRadius: 999,
    padding: '0.35rem 0.85rem',
    fontSize: '0.82rem',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
  }
}

function Caret({ open }: { open: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      width: '0.65rem',
      transform: `rotate(${open ? 90 : 0}deg)`,
      transition: 'transform 0.15s',
      fontSize: '0.7rem',
      color: 'var(--text-muted)',
    }}>
      ▶
    </span>
  )
}
