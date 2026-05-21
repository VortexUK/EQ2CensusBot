import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useClaim } from '../hooks/useClaim'

// ── My Characters section ─────────────────────────────────────────────────────

function MyCharacters() {
  const claimState = useClaim()

  if (claimState.status === 'loading' || claimState.status === 'unauthenticated') return null
  if (claimState.status === 'error') return null

  const { approved, pending } = claimState.data
  const primary = approved.find(c => c.is_primary === 1) ?? approved[0] ?? null
  const alts = approved.filter(c => c !== primary)

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: '0.75rem',
        marginBottom: '0.75rem',
      }}>
        <h2 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '1rem',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(200,169,110,0.85)',
        }}>
          My Characters
        </h2>
        <Link to="/claim" style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          manage
        </Link>
      </div>

      {approved.length === 0 && !pending && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>No character claimed.</span>
          <Link to="/claim" style={linkBtn}>Claim character</Link>
        </div>
      )}

      {/* Primary */}
      {primary && (
        <div style={{ marginBottom: '0.5rem', lineHeight: 1.3 }}>
          <Link
            to={`/character/${encodeURIComponent(primary.character_name)}`}
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: '1.15rem',
              fontWeight: 700,
              color: '#ffc993',
              textShadow: '0 0 8px #D56900, 0 0 20px rgba(213,105,0,0.35)',
              textDecoration: 'none',
              letterSpacing: '0.04em',
            }}
          >
            {primary.character_name}
          </Link>
          {primary.guild_name ? (
            <Link
              to={`/guild/${encodeURIComponent(primary.guild_name)}`}
              style={{
                marginLeft: '0.6rem',
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
                textDecoration: 'none',
                fontFamily: "'Cinzel', serif",
                letterSpacing: '0.03em',
              }}
            >
              &lt;{primary.guild_name}&gt;
            </Link>
          ) : (
            <span style={{ marginLeft: '0.6rem', fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: "'Cinzel', serif" }}>
              &lt;&gt;
            </span>
          )}
        </div>
      )}

      {/* Alts */}
      {alts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', paddingLeft: '0.05rem' }}>
          {alts.map(c => (
            <div key={c.id} style={{ lineHeight: 1.3 }}>
              <Link
                to={`/character/${encodeURIComponent(c.character_name)}`}
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  color: '#93d9ff',
                  textShadow: '0 0 6px #D56900, 0 0 16px rgba(213,105,0,0.25)',
                  textDecoration: 'none',
                  letterSpacing: '0.03em',
                }}
              >
                {c.character_name}
              </Link>
              {c.guild_name ? (
                <Link
                  to={`/guild/${encodeURIComponent(c.guild_name)}`}
                  style={{
                    marginLeft: '0.5rem',
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    textDecoration: 'none',
                    fontFamily: "'Cinzel', serif",
                    letterSpacing: '0.03em',
                  }}
                >
                  &lt;{c.guild_name}&gt;
                </Link>
              ) : (
                <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: "'Cinzel', serif" }}>
                  &lt;&gt;
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pending */}
      {pending && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            ⏳ {pending.character_name}
          </span>
          <Link to="/claim" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>· pending</Link>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function HomePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [charSearch, setCharSearch] = useState('')
  const [guildSearch, setGuildSearch] = useState('')

  function handleCharSearch(e: React.FormEvent) {
    e.preventDefault()
    const name = charSearch.trim()
    if (name) navigate(`/character/${encodeURIComponent(name)}`)
  }

  function handleGuildSearch(e: React.FormEvent) {
    e.preventDefault()
    const name = guildSearch.trim()
    if (name) navigate(`/guild/${encodeURIComponent(name)}`)
  }

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '1.5rem 1.5rem 4rem' }}>

      {/* Title — centered over both columns */}
      <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
        <h1 style={{
          fontFamily: "'Cinzel', serif",
          fontSize: '2.6rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          lineHeight: 1.1,
          marginBottom: '0.5rem',
          background: 'linear-gradient(135deg, #c8a96e 0%, #e8d5a3 40%, #c8a96e 70%, #a07840 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          display: 'inline-block',
        }}>
          Lore <span style={{ fontWeight: 300, opacity: 0.8 }}>&</span> Legend
        </h1>
        <p style={{
          color: 'var(--text-muted)',
          fontSize: '0.95rem',
          lineHeight: 1.6,
          marginTop: '0.25rem',
        }}>
          Guild companion for <em>Woushi</em> — track characters, spells,
          gear and guild rosters across the realm of Norrath.
        </p>
      </div>

      {/* Two-column body */}
      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Left — My Characters */}
        <div style={{ flex: '1 1 200px', minWidth: 180 }}>
          {auth.status === 'authenticated' && <MyCharacters />}
        </div>

        {/* Right — Search */}
        <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <form onSubmit={handleCharSearch} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Character name…"
              value={charSearch}
              onChange={e => setCharSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" style={btnStyle('var(--accent)')}>Look up</button>
          </form>
          <form onSubmit={handleGuildSearch} style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              placeholder="Guild name…"
              value={guildSearch}
              onChange={e => setGuildSearch(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" style={btnStyle('var(--surface-raised)')}>Guild roster</button>
          </form>
        </div>

      </div>
    </main>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

function btnStyle(bg: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '0.5rem 1.2rem',
    background: bg,
    color: 'var(--text)',
    borderRadius: 6,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontSize: '0.95rem',
    whiteSpace: 'nowrap',
  }
}

const linkBtn: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.35rem 0.9rem',
  background: 'var(--surface)',
  color: 'var(--text)',
  borderRadius: 6,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontSize: '0.85rem',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

export default HomePage
