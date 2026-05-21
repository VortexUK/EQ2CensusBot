import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Routes, Route, Outlet, NavLink } from 'react-router-dom'
import HomePage from './pages/HomePage'
import CharacterPage from './pages/CharacterPage'
import ClaimPage from './pages/ClaimPage'
import AdminPage from './pages/AdminPage'
import GuildPage from './pages/GuildPage'
import UserWidget from './components/UserWidget'
import { useAuth } from './hooks/useAuth'
import { Link } from 'react-router-dom'
import { useClaim } from './hooks/useClaim'
import logo from './L&L.png'

function LoginGate() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1.5rem',
      padding: '2rem',
      textAlign: 'center',
    }}>
      <h1 style={{
        fontFamily: "'Cinzel', serif",
        fontSize: '2.6rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        background: 'linear-gradient(135deg, #c8a96e 0%, #e8d5a3 40%, #c8a96e 70%, #a07840 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        display: 'inline-block',
      }}>
        Lore <span style={{ fontWeight: 300, opacity: 0.8 }}>&</span> Legend
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: 340 }}>
        Sign in with Discord to access the guild companion.
      </p>
      <a
        href="/api/auth/login"
        style={{
          display: 'inline-block',
          padding: '0.6rem 1.6rem',
          background: '#5865F2',
          color: '#fff',
          borderRadius: 8,
          border: 'none',
          fontSize: '1rem',
          fontWeight: 600,
          textDecoration: 'none',
          letterSpacing: '0.02em',
        }}
      >
        Sign in with Discord
      </a>
    </main>
  )
}

const navLinkStyle = ({ isActive }: { isActive: boolean }): CSSProperties => ({
  fontFamily: "'Cinzel', serif",
  fontSize: '0.85rem',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textDecoration: 'none',
  color: isActive ? '#e8d5a3' : '#9a7d4a',
  borderBottom: isActive ? '1px solid #c8a96e' : '1px solid transparent',
  paddingBottom: '2px',
  transition: 'color 0.15s, border-color 0.15s',
})

// ---------------------------------------------------------------------------
// Nav link data: cached in localStorage for 24 h, refreshed on primary change
// ---------------------------------------------------------------------------

const _NAV_KEY = 'eq2_nav'
const _NAV_TTL = 86_400_000  // 24 hours in ms

interface NavCache { primary: string; guild: string | null; ts: number }

function _readNavCache(): NavCache | null {
  try {
    const raw = localStorage.getItem(_NAV_KEY)
    if (!raw) return null
    const c: NavCache = JSON.parse(raw)
    if (Date.now() - c.ts > _NAV_TTL) return null   // stale — treat as miss
    return c
  } catch { return null }
}

function _writeNavCache(primary: string, guild: string | null) {
  try {
    localStorage.setItem(_NAV_KEY, JSON.stringify({ primary, guild, ts: Date.now() }))
  } catch { /* storage full or disabled — silently ignore */ }
}

function NavLinks() {
  // Initialise synchronously from localStorage so links render instantly with no flash
  const [navData, setNavData] = useState<{ primary: string; guild: string | null } | null>(
    () => {
      const c = _readNavCache()
      return c ? { primary: c.primary, guild: c.guild } : null
    }
  )

  // useClaim() keeps the cache fresh: updates on primary-character change or after 24 h
  const claims = useClaim()
  useEffect(() => {
    if (claims.status !== 'ready') return
    const primary = claims.data.approved.find(c => c.is_primary === 1)
    if (!primary) return
    const cached = _readNavCache()
    // Write through if: no cache, different primary, or guild name changed
    if (!cached || cached.primary !== primary.character_name || cached.guild !== primary.guild_name) {
      _writeNavCache(primary.character_name, primary.guild_name)
      setNavData({ primary: primary.character_name, guild: primary.guild_name })
    }
  }, [claims])

  if (!navData) return null

  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
      <NavLink to={`/character/${navData.primary}`} style={navLinkStyle} className="nav-ribbon-link">
        Character
      </NavLink>
      {navData.guild && (
        <NavLink to={`/guild/${encodeURIComponent(navData.guild)}`} style={navLinkStyle} className="nav-ribbon-link">
          Guild
        </NavLink>
      )}
    </nav>
  )
}

function Layout() {
  const auth = useAuth()

  if (auth.status === 'loading') return null

  if (auth.status === 'unauthenticated') return <LoginGate />

  return (
    <>
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.4rem 1.25rem',
        background: 'rgba(15,17,23,0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border)',
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', lineHeight: 0 }}>
          <img src={logo} alt="Lore & Legend" style={{ height: 40, width: 'auto' }} />
        </Link>
        <NavLinks />
        <UserWidget />
      </div>
      {/* Push content below fixed header (~52px) */}
      <div style={{ paddingTop: '3.5rem' }}>
        <Outlet />
      </div>
    </>
  )
}

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/character/:name" element={<CharacterPage />} />
        <Route path="/guild/:guildName" element={<GuildPage />} />
        <Route path="/claim" element={<ClaimPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  )
}

export default App
