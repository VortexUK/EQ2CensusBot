import React, { useEffect, useState } from 'react'
import { StatGroup } from './CharacterPage'

// ── Spell types ───────────────────────────────────────────────────────────────

export interface SpellEntry {
  name:          string
  tier:          string
  level:         number
  spell_type:    string
  icon_id:       number | null
  icon_backdrop: number | null
}

export interface CharacterSpellsData {
  character_name: string
  spells:         SpellEntry[]
  tier_counts:    Record<string, number>
  tiers_present:  string[]
}

// ── Spell data cache ──────────────────────────────────────────────────────────
// Module-level: survives re-renders and Vite HMR remounts.
// Keyed by lower-cased character name.
export const _spellsCache = new Map<string, CharacterSpellsData>()

// ── Constants ─────────────────────────────────────────────────────────────────

export const SPELL_TIER_ORDER = ['Apprentice', 'Journeyman', 'Adept', 'Expert', 'Master', 'Grandmaster']

export const SPELL_TIER_ICON: Record<string, string> = {
  Apprentice:  'spell_app',
  Journeyman:  'spell_jour',
  Adept:       'spell_ad',
  Expert:      'spell_exp',
  Master:      'spell_m',
  Grandmaster: 'spell_gm',
}

export const SPELL_TIER_COLOURS: Record<string, { text: string; bg: string }> = {
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

// ── Spell progress bar ────────────────────────────────────────────────────────

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

// ── Spells tab ────────────────────────────────────────────────────────────────

type SpellsTabState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; data: CharacterSpellsData }

export function SpellsTab({ charName }: { charName: string }) {
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
              {cols.map((col, _ci) => renderTable(col))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
