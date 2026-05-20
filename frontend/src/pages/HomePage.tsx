import { avatarUrl, useAuth } from '../hooks/useAuth'

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
  window.location.reload()
}

function HomePage() {
  const auth = useAuth()

  return (
    <main style={{ fontFamily: 'sans-serif', textAlign: 'center', marginTop: '4rem' }}>
      <h1>EQ2 TLE Companion</h1>

      {auth.status === 'loading' && <p>Loading...</p>}

      {auth.status === 'unauthenticated' && (
        <a href="/api/auth/login" style={btnStyle('#5865F2')}>
          Sign in with Discord
        </a>
      )}

      {auth.status === 'authenticated' && (
        <div>
          <img
            src={avatarUrl(auth.user)}
            alt="avatar"
            style={{ width: 64, height: 64, borderRadius: '50%', marginBottom: '0.5rem' }}
          />
          <p>Welcome, <strong>{auth.user.global_name ?? auth.user.username}</strong></p>
          <button onClick={logout} style={btnStyle('#555')}>
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
    padding: '0.6rem 1.4rem',
    background: bg,
    color: '#fff',
    borderRadius: 6,
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
  }
}

export default HomePage
