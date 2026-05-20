import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { avatarUrl, useAuth } from '../hooks/useAuth'

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.reload()
}

function HomePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const name = search.trim()
    if (name) navigate(`/character/${encodeURIComponent(name)}`)
  }

  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>EQ2 TLE Companion</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
        Character lookup for the Time-Locked Expansion server
      </p>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          type="text"
          placeholder="Character name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" style={btnStyle('var(--accent)')}>
          Look up
        </button>
      </form>

      {auth.status === 'loading' && (
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {auth.status === 'unauthenticated' && (
        <a href="/api/auth/login" style={btnStyle('#5865F2')}>
          Sign in with Discord
        </a>
      )}

      {auth.status === 'authenticated' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img
            src={avatarUrl(auth.user)}
            alt="avatar"
            style={{ width: 40, height: 40, borderRadius: '50%' }}
          />
          <span>{auth.user.global_name ?? auth.user.username}</span>
          <button onClick={logout} style={{ ...btnStyle('var(--surface-raised)'), marginLeft: 'auto' }}>
            Sign out
          </button>
        </div>
      )}
    </main>
  )
}

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

export default HomePage
