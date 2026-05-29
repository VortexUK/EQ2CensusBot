import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSortable } from '../../hooks/useSortable'
import { SortTh } from '../../components/ui/SortTh'
import { useClasses } from '../../useClasses'
import { TH_CLS, TD_CLS, GuildMember } from './types'

// ── Roster sort ───────────────────────────────────────────────────────────────

type RosterSortKey = 'rank' | 'name' | 'level' | 'aa' | 'ilvl' | 'ts_level' | 'deity' | 'guild_status'

const ROSTER_COLS: { label: string; key: RosterSortKey; align?: 'right' }[] = [
  { label: 'Name',             key: 'name'         },
  { label: 'Rank',             key: 'rank'         },
  { label: 'Class (Level)',    key: 'level'        },
  { label: 'AA',               key: 'aa',          align: 'right' },
  { label: 'iLvl',             key: 'ilvl',        align: 'right' },
  { label: 'Tradeskill (Lvl)', key: 'ts_level'     },
  { label: 'Deity',            key: 'deity'        },
  { label: 'Guild Status',     key: 'guild_status', align: 'right' },
]

function rosterSortValue(m: GuildMember, key: RosterSortKey): string | number {
  switch (key) {
    case 'rank':         return m.rank_id ?? 9999
    case 'name':         return m.name.toLowerCase()
    case 'level':        return m.level ?? -1
    case 'aa':           return m.aa_level ?? -1
    case 'ilvl':         return m.ilvl ?? -1
    case 'ts_level':     return m.ts_level ?? -1
    case 'deity':        return (m.deity ?? '').toLowerCase()
    case 'guild_status': return m.guild_status ?? -1
  }
}

function fmtGuildStatus(pts: number | null): string {
  if (pts == null) return '—'
  return pts.toLocaleString()
}

// Numeric columns that should sort descending on first click ("highest first")
const NUMERIC_DESC_KEYS = new Set<RosterSortKey>(['level', 'aa', 'ilvl', 'ts_level', 'guild_status'])

// ── Props ─────────────────────────────────────────────────────────────────────

interface GuildRosterTabProps {
  members: GuildMember[]
  filter: string
  hiddenRanks: Set<string>
  myChars: Set<string>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GuildRosterTab({ members, filter, hiddenRanks, myChars }: GuildRosterTabProps) {
  const { colourFor } = useClasses()

  const filteredMembers = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return members.filter(m => {
      if (m.rank && hiddenRanks.has(m.rank)) return false
      if (!q) return true
      return m.name.toLowerCase().includes(q) ||
        (m.cls ?? '').toLowerCase().includes(q) ||
        (m.rank ?? '').toLowerCase().includes(q)
    })
  }, [members, filter, hiddenRanks])

  const { sorted, sortKey, sortDir, handleSort } = useSortable<GuildMember, RosterSortKey>(
    filteredMembers,
    rosterSortValue,
    'rank',
    'asc',
    (k) => NUMERIC_DESC_KEYS.has(k) ? 'desc' : 'asc',
  )

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b-2 border-border bg-surface-raised">
          {ROSTER_COLS.map(col => (
            <SortTh
              key={col.key}
              sortKey={col.key}
              active={sortKey}
              dir={sortDir}
              onSort={handleSort}
              className={[
                TH_CLS,
                col.align === 'right' ? 'text-right' : 'text-left',
              ].join(' ')}
            >
              {col.label}
            </SortTh>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr><td colSpan={8} className={`${TD_CLS} text-center text-text-muted`}>No members match your filter.</td></tr>
        ) : sorted.map(m => {
          const clsLabel = m.cls
            ? m.level != null ? `${m.cls} (${m.level})` : m.cls
            : '—'
          const tsLabel = m.ts_class
            ? m.ts_level != null
              ? `${m.ts_class.charAt(0).toUpperCase()}${m.ts_class.slice(1)} (${m.ts_level})`
              : m.ts_class
            : '—'
          return (
            <tr key={m.name} className="border-b border-border" style={{ background: myChars.has(m.name.toLowerCase()) ? 'rgba(var(--gold-rgb), 0.06)' : undefined }}>
              <td className={TD_CLS}>
                <Link to={`/character/${encodeURIComponent(m.name)}`}
                  className="text-gold no-underline font-medium">
                  {m.name}
                </Link>
                {myChars.has(m.name.toLowerCase()) && (
                  <span className="ml-[0.4rem] text-[0.65rem] text-gold align-middle">★</span>
                )}
              </td>
              <td className={`${TD_CLS} text-text-muted text-[0.85rem]`}>{m.rank ?? '—'}</td>
              <td className={TD_CLS} style={{ color: m.cls ? colourFor(m.cls, 'var(--text)') : 'var(--text-muted)' }}>{clsLabel}</td>
              <td className={`${TD_CLS} text-right text-text-muted`}>{m.aa_level ?? '—'}</td>
              <td className={`${TD_CLS} text-right tabular-nums text-gold`}>{m.ilvl != null ? Math.round(m.ilvl).toLocaleString() : '—'}</td>
              <td className={`${TD_CLS} text-text-muted`}>{tsLabel}</td>
              <td className={`${TD_CLS} text-text-muted text-[0.82rem]`}>{m.deity ?? '—'}</td>
              <td className={`${TD_CLS} text-right text-text-muted text-[0.82rem]`}>{fmtGuildStatus(m.guild_status)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
