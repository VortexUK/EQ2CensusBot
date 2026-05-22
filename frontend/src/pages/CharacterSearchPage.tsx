import { useState } from 'react'
import { Link } from 'react-router-dom'

// ── Class hierarchy ───────────────────────────────────────────────────────────
// Each option's value is a comma-separated list of leaf class IDs.
// The backend receives them as individual class_id query params.

// Class ID → archetype colour
const CLASS_ID_COLOUR: Record<number, string> = {
  // Fighters
  3: '#f87171', 4: '#f87171', 6: '#f87171', 7: '#f87171', 9: '#f87171', 10: '#f87171',
  // Priests
  13: '#4ade80', 14: '#4ade80', 16: '#4ade80', 17: '#4ade80', 19: '#4ade80', 20: '#4ade80',
  // Mages
  23: '#93b4ff', 24: '#93b4ff', 26: '#93b4ff', 27: '#93b4ff',
  29: '#93b4ff', 30: '#93b4ff', 44: '#93b4ff',
  // Scouts
  33: '#fbbf24', 34: '#fbbf24', 36: '#fbbf24', 37: '#fbbf24',
  39: '#fbbf24', 40: '#fbbf24', 42: '#fbbf24',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CharSearchResult {
  name: string
  cls: string | null
  class_id: number | null
  level: number | null
  aa_level: number | null
  race: string | null
  guild_name: string | null
}

interface CharSearchResponse {
  results: CharSearchResult[]
  total: number
  page: number
  per_page: number
}

// ── Shared form-control style (dark theme, matches inputs) ───────────────────

const CTRL: React.CSSProperties = {
  padding: '0.42rem 0.6rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface-raised)',
  color: 'var(--text)',
  fontSize: '0.88rem',
  lineHeight: '1.4',
  appearance: 'auto',        // keep native arrow on selects
  colorScheme: 'dark',       // tells the browser to use its dark-mode option list
}

// ── Shared table styles (match rest of app) ───────────────────────────────────

const TH: React.CSSProperties = {
  padding: '0.5rem 0.7rem',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--text-muted)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  textAlign: 'left',
  borderBottom: '2px solid var(--border)',
  background: 'var(--surface-raised)',
}

const TD: React.CSSProperties = {
  padding: '0.42rem 0.7rem',
  fontSize: '0.88rem',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CharacterSearchPage() {
  const [classValue, setClassValue] = useState('')
  const [minLevel,   setMinLevel]   = useState('')
  const [maxLevel,   setMaxLevel]   = useState('')
  const [sortBy,     setSortBy]     = useState<'level' | 'aa' | 'name'>('level')
  const [sortDir,    setSortDir]    = useState<'desc' | 'asc'>('desc')
  const [page,       setPage]       = useState(1)

  const [results,  setResults]  = useState<CharSearchResponse | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  async function runSearch(p: number = 1) {
    // Build query params
    const params = new URLSearchParams()
    if (classValue) {
      for (const id of classValue.split(',')) {
        params.append('class_id', id.trim())
      }
    }
    if (minLevel.trim()) params.set('min_level', minLevel.trim())
    if (maxLevel.trim()) params.set('max_level', maxLevel.trim())
    params.set('sort_by', sortBy)
    params.set('sort_dir', sortDir)
    params.set('page', String(p))

    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const res = await fetch(`/api/characters/search?${params}`, { credentials: 'include' })
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))).detail ?? `Error ${res.status}`
        setError(detail)
        return
      }
      const data: CharSearchResponse = await res.json()
      setResults(data)
      setPage(p)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    runSearch(1)
  }

  const totalPages = results ? Math.ceil(results.total / results.per_page) : 0

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
      <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textDecoration: 'none' }}>
        ← Back
      </Link>

      <h1 style={{
        fontFamily: "'Cinzel', serif",
        fontSize: '1.9rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        margin: '1rem 0 0.25rem',
        background: 'linear-gradient(135deg, #c8a96e 0%, #e8d5a3 40%, #c8a96e 70%, #a07840 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        display: 'inline-block',
      }}>
        Character Search
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
        Filter all characters on the server by class, level and more.
      </p>

      {/* Filter form */}
      <form onSubmit={handleSubmit}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '1rem 1.1rem',
          marginBottom: '1.25rem',
        }}>

          {/* Class selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              Class
            </label>
            <select
              value={classValue}
              onChange={e => setClassValue(e.target.value)}
              style={{ ...CTRL, minWidth: 190 }}
            >
              <option value="">Any Class</option>

              <optgroup label="Fighter">
                <option value="3,4,6,7,9,10">All Fighters</option>
                <option value="3,4">{'  '}· Warrior</option>
                <option value="3">{'    '}Guardian</option>
                <option value="4">{'    '}Berserker</option>
                <option value="6,7">{'  '}· Brawler</option>
                <option value="6">{'    '}Monk</option>
                <option value="7">{'    '}Bruiser</option>
                <option value="9,10">{'  '}· Crusader</option>
                <option value="9">{'    '}Shadowknight</option>
                <option value="10">{'    '}Paladin</option>
              </optgroup>

              <optgroup label="Priest">
                <option value="13,14,16,17,19,20">All Priests</option>
                <option value="13,14">{'  '}· Cleric</option>
                <option value="13">{'    '}Templar</option>
                <option value="14">{'    '}Inquisitor</option>
                <option value="16,17">{'  '}· Druid</option>
                <option value="16">{'    '}Warden</option>
                <option value="17">{'    '}Fury</option>
                <option value="19,20">{'  '}· Shaman</option>
                <option value="19">{'    '}Mystic</option>
                <option value="20">{'    '}Defiler</option>
              </optgroup>

              <optgroup label="Mage">
                <option value="23,24,26,27,29,30,44">All Mages</option>
                <option value="23,24">{'  '}· Sorcerer</option>
                <option value="23">{'    '}Wizard</option>
                <option value="24">{'    '}Warlock</option>
                <option value="26,27">{'  '}· Enchanter</option>
                <option value="26">{'    '}Illusionist</option>
                <option value="27">{'    '}Coercer</option>
                <option value="29,30">{'  '}· Summoner</option>
                <option value="29">{'    '}Conjuror</option>
                <option value="30">{'    '}Necromancer</option>
                <option value="44">{'  '}· Shaper</option>
                <option value="44">{'    '}Channeler</option>
              </optgroup>

              <optgroup label="Scout">
                <option value="33,34,36,37,39,40,42">All Scouts</option>
                <option value="33,34">{'  '}· Rogue</option>
                <option value="33">{'    '}Swashbuckler</option>
                <option value="34">{'    '}Brigand</option>
                <option value="36,37">{'  '}· Bard</option>
                <option value="36">{'    '}Troubador</option>
                <option value="37">{'    '}Dirge</option>
                <option value="39,40">{'  '}· Predator</option>
                <option value="39">{'    '}Ranger</option>
                <option value="40">{'    '}Assassin</option>
                <option value="42">{'  '}· Animalist</option>
                <option value="42">{'    '}Beastlord</option>
              </optgroup>
            </select>
          </div>

          {/* Min Level */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              Min Level
            </label>
            <input
              type="number"
              min={1} max={135}
              placeholder="e.g. 60"
              value={minLevel}
              onChange={e => setMinLevel(e.target.value)}
              style={{ ...CTRL, width: 90 }}
            />
          </div>

          {/* Max Level */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              Max Level
            </label>
            <input
              type="number"
              min={1} max={135}
              placeholder="e.g. 95"
              value={maxLevel}
              onChange={e => setMaxLevel(e.target.value)}
              style={{ ...CTRL, width: 90 }}
            />
          </div>

          {/* Sort by */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              Sort by
            </label>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'level' | 'aa' | 'name')}
              style={CTRL}
            >
              <option value="level">Level</option>
              <option value="aa">AA</option>
              <option value="name">Name</option>
            </select>
          </div>

          {/* Sort direction */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>
              Order
            </label>
            <button
              type="button"
              onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
              style={{
                padding: '0.42rem 0.75rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: '0.88rem',
                whiteSpace: 'nowrap',
              }}
            >
              {sortDir === 'desc' ? '↓ Desc' : '↑ Asc'}
            </button>
          </div>

          {/* Search button */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.68rem', color: 'transparent', userSelect: 'none' }}>_</label>
            <button
              type="submit"
              disabled={loading || (!classValue && !minLevel.trim() && !maxLevel.trim())}
              style={{
                padding: '0.42rem 1.3rem',
                borderRadius: 6,
                border: '1px solid rgba(var(--accent-rgb,99,210,130),0.4)',
                background: 'rgba(var(--accent-rgb,99,210,130),0.12)',
                color: 'var(--accent)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 600,
                opacity: (loading || (!classValue && !minLevel.trim() && !maxLevel.trim())) ? 0.45 : 1,
              }}
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>

        </div>
      </form>

      {/* Error */}
      {error && (
        <p style={{ color: '#f87171', marginBottom: '1rem' }}>{error}</p>
      )}

      {/* No filters yet */}
      {!searched && !loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Select a class or enter a level range to search.
        </p>
      )}

      {/* Results */}
      {searched && !loading && !error && results && (
        <>
          {/* Count + pagination header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem',
          }}>
            <span style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>
              {results.total === 0
                ? 'No characters found.'
                : `${results.total} character${results.total === 1 ? '' : 's'} found`}
              {totalPages > 1 && ` · page ${page} of ${totalPages}`}
            </span>

            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  onClick={() => runSearch(page - 1)}
                  disabled={page <= 1}
                  style={paginBtn}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => runSearch(page + 1)}
                  disabled={page >= totalPages}
                  style={paginBtn}
                >
                  Next →
                </button>
              </div>
            )}
          </div>

          {results.total > 0 && (
            <div style={{
              overflowX: 'auto',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Name</th>
                    <th style={TH}>Class</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Level</th>
                    <th style={{ ...TH, textAlign: 'right' }}>AA</th>
                    <th style={TH}>Race</th>
                    <th style={TH}>Guild</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map(r => {
                    const clsColour = r.class_id != null
                      ? (CLASS_ID_COLOUR[r.class_id] ?? 'var(--text)')
                      : 'var(--text-muted)'
                    return (
                      <tr key={r.name} style={{ transition: 'background 0.1s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-raised)')}
                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                      >
                        <td style={TD}>
                          <Link
                            to={`/character/${encodeURIComponent(r.name)}`}
                            style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}
                          >
                            {r.name}
                          </Link>
                        </td>
                        <td style={{ ...TD, color: clsColour, fontWeight: 500 }}>
                          {r.cls ?? '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--text)' }}>
                          {r.level ?? '—'}
                        </td>
                        <td style={{ ...TD, textAlign: 'right', color: 'var(--text-muted)' }}>
                          {r.aa_level ?? '—'}
                        </td>
                        <td style={{ ...TD, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {r.race ?? '—'}
                        </td>
                        <td style={{ ...TD, fontSize: '0.82rem' }}>
                          {r.guild_name
                            ? <Link
                                to={`/guild/${encodeURIComponent(r.guild_name)}`}
                                style={{ color: 'rgba(200,169,110,0.8)', textDecoration: 'none' }}
                              >
                                {r.guild_name}
                              </Link>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination footer */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.4rem', marginTop: '0.75rem' }}>
              <button onClick={() => runSearch(page - 1)} disabled={page <= 1}    style={paginBtn}>← Prev</button>
              <button onClick={() => runSearch(page + 1)} disabled={page >= totalPages} style={paginBtn}>Next →</button>
            </div>
          )}
        </>
      )}
    </main>
  )
}

const paginBtn: React.CSSProperties = {
  padding: '0.3rem 0.8rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '0.82rem',
}
