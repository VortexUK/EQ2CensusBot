import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth, discordAvatarUrl } from '../hooks/useAuth'
import { Button } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserItem {
  discord_id:       string
  discord_name:     string | null
  discord_username: string | null
  avatar:           string | null
  first_seen:       number
  last_seen:        number
  access_status:    string
  claim_count:      number
}

interface ClaimDetail {
  id:               number
  discord_id:       string
  discord_name:     string | null
  discord_username: string | null
  avatar:           string | null
  character_name:   string
  status:           string
  requested_at:     number
  reviewed_at:      number | null
  reviewed_by:      string | null
  note:             string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const discordAvatar = discordAvatarUrl

function fmt(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

function relativeTime(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix
  if (diff < 60)    return 'just now'
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const ACCESS_BADGE: Record<string, React.CSSProperties> = {
  pending:  { background: 'rgba(234,179,8,0.18)',   color: '#fbbf24', border: '1px solid rgba(234,179,8,0.4)'  },
  approved: { background: 'rgba(34,197,94,0.13)',   color: 'var(--success)', border: '1px solid rgba(34,197,94,0.35)' },
  denied:   { background: 'rgba(239,68,68,0.13)',   color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.35)' },
}

const CLAIM_BADGE: Record<string, React.CSSProperties> = {
  pending:    { background: 'rgba(234,179,8,0.18)',    color: '#fbbf24', border: '1px solid rgba(234,179,8,0.4)'    },
  approved:   { background: 'rgba(34,197,94,0.13)',    color: 'var(--success)', border: '1px solid rgba(34,197,94,0.35)'   },
  rejected:   { background: 'rgba(239,68,68,0.13)',    color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.35)'   },
  withdrawn:  { background: 'rgba(100,116,139,0.13)',  color: '#94a3b8', border: '1px solid rgba(100,116,139,0.3)'  },
  superseded: { background: 'rgba(100,116,139,0.13)',  color: '#94a3b8', border: '1px solid rgba(100,116,139,0.3)'  },
}

function Badge({ label, style }: { label: string; style?: React.CSSProperties }) {
  return (
    <span style={{
      borderRadius: 4, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 600,
      whiteSpace: 'nowrap',
      ...style,
    }}>
      {label}
    </span>
  )
}

// ── Shared table styles ───────────────────────────────────────────────────────

const TABLE: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem',
}
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '0.45rem 0.75rem',
  color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
  verticalAlign: 'middle',
}
const BTN_BASE: React.CSSProperties = {
  padding: '0.22rem 0.65rem', borderRadius: 4, cursor: 'pointer',
  fontSize: '0.78rem', fontWeight: 600, border: 'none', whiteSpace: 'nowrap',
}

// ── Users table ───────────────────────────────────────────────────────────────

function UserRow({ user, onAction }: { user: UserItem; onAction: () => void }) {
  const [busy, setBusy] = useState(false)
  const [kickConfirm, setKickConfirm] = useState(false)

  async function doAccess(action: 'approve' | 'deny' | 'kick') {
    setBusy(true)
    try {
      const url = action === 'kick'
        ? `/api/admin/users/${user.discord_id}/kick`
        : `/api/admin/users/${user.discord_id}/${action}`
      await fetch(url, { method: 'POST', credentials: 'include' })
      onAction()
    } finally {
      setBusy(false)
      setKickConfirm(false)
    }
  }

  const displayName = user.discord_name ?? user.discord_username ?? 'Unknown'
  const badgeStyle  = ACCESS_BADGE[user.access_status] ?? ACCESS_BADGE.denied

  return (
    <tr>
      {/* User */}
      <td style={TD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <img
            src={discordAvatar(user.discord_id, user.avatar)}
            alt=""
            width={28} height={28}
            style={{ borderRadius: '50%', flexShrink: 0 }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.2 }}>
              {displayName}
            </div>
            {user.discord_username && user.discord_username !== user.discord_name && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                {user.discord_username}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Joined */}
      <td style={{ ...TD, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        <span title={fmt(user.first_seen)}>{relativeTime(user.first_seen)}</span>
      </td>

      {/* Status */}
      <td style={TD}>
        <Badge label={user.access_status} style={badgeStyle} />
      </td>

      {/* Claims */}
      <td style={{ ...TD, textAlign: 'center', color: user.claim_count ? 'var(--text)' : 'var(--text-muted)' }}>
        {user.claim_count}
      </td>

      {/* Actions */}
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        {kickConfirm ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>Kick + delete all claims?</span>
            <Button variant="danger" size="sm" onClick={() => doAccess('kick')} disabled={busy}>
              {busy ? '…' : 'Confirm'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setKickConfirm(false)}>Cancel</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {user.access_status !== 'approved' && (
              <Button variant="primary" size="sm" onClick={() => doAccess('approve')} disabled={busy}>
                Approve
              </Button>
            )}
            {user.access_status !== 'denied' && (
              <Button variant="danger" size="sm" onClick={() => doAccess('deny')} disabled={busy}>
                Deny
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={() => setKickConfirm(true)}
              disabled={busy}
              title="Revoke access and delete all claims"
            >
              Kick
            </Button>
          </div>
        )}
      </td>
    </tr>
  )
}

function UsersTable({ users, onAction }: { users: UserItem[]; onAction: () => void }) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all')

  const visible = filter === 'all' ? users : users.filter(u => u.access_status === filter)

  const counts = {
    all:      users.length,
    pending:  users.filter(u => u.access_status === 'pending').length,
    approved: users.filter(u => u.access_status === 'approved').length,
    denied:   users.filter(u => u.access_status === 'denied').length,
  }

  return (
    <div>
      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {(['all', 'pending', 'approved', 'denied'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...BTN_BASE,
              background: filter === f ? 'rgba(200,169,110,0.15)' : 'transparent',
              color: filter === f ? 'var(--gold)' : 'var(--text-muted)',
              border: filter === f ? '1px solid rgba(200,169,110,0.4)' : '1px solid var(--border)',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}{' '}
            <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({counts[f]})</span>
          </button>
        ))}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={TABLE}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
              <th style={TH}>User</th>
              <th style={TH}>Joined</th>
              <th style={TH}>Status</th>
              <th style={{ ...TH, textAlign: 'center' }}>Claims</th>
              <th style={TH}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...TD, color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
                  No users.
                </td>
              </tr>
            ) : (
              visible.map(u => (
                <UserRow key={u.discord_id} user={u} onAction={onAction} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Claims table ──────────────────────────────────────────────────────────────

function ClaimRow({ claim, onDelete }: { claim: ClaimDetail; onDelete: () => void }) {
  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function doAction(url: string, body?: object | null, method = 'POST') {
    setBusy(true)
    try {
      await fetch(url, {
        method,
        credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      onDelete()
    } finally {
      setBusy(false)
      setRejectOpen(false)
    }
  }

  const displayName = claim.discord_name ?? claim.discord_username ?? claim.discord_id
  const badgeStyle  = CLAIM_BADGE[claim.status] ?? CLAIM_BADGE.withdrawn

  return (
    <tr>
      {/* Character */}
      <td style={{ ...TD, color: 'var(--accent)', fontWeight: 600 }}>
        {claim.character_name}
      </td>

      {/* User */}
      <td style={TD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <img
            src={discordAvatar(claim.discord_id, claim.avatar)}
            alt=""
            width={22} height={22}
            style={{ borderRadius: '50%', flexShrink: 0 }}
          />
          <span style={{ fontSize: '0.85rem' }}>{displayName}</span>
        </div>
      </td>

      {/* Status */}
      <td style={TD}>
        <Badge label={claim.status} style={badgeStyle} />
      </td>

      {/* Submitted */}
      <td style={{ ...TD, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        <span title={fmt(claim.requested_at)}>{relativeTime(claim.requested_at)}</span>
      </td>

      {/* Reviewed */}
      <td style={{ ...TD, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {claim.reviewed_at ? (
          <span title={fmt(claim.reviewed_at)}>{relativeTime(claim.reviewed_at)}</span>
        ) : (
          <span style={{ opacity: 0.4 }}>—</span>
        )}
      </td>

      {/* Note */}
      <td style={{ ...TD, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.8rem', maxWidth: 180 }}>
        {claim.note
          ? <span title={claim.note} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{claim.note}"</span>
          : <span style={{ opacity: 0.4 }}>—</span>
        }
      </td>

      {/* Actions */}
      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
        {claim.status === 'pending' ? (
          rejectOpen ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 200 }}>
              <textarea
                placeholder="Optional rejection reason…"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                style={{ fontSize: '0.78rem', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => doAction(`/api/admin/claims/${claim.id}/reject`, { note: note || null })}
                  disabled={busy}
                >
                  {busy ? '…' : 'Confirm'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setRejectOpen(false); setNote('') }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <Button
                variant="primary"
                size="sm"
                onClick={() => doAction(`/api/admin/claims/${claim.id}/approve`)}
                disabled={busy}
              >
                Approve
              </Button>
              <Button variant="danger" size="sm" onClick={() => setRejectOpen(true)} disabled={busy}>
                Reject
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => doAction(`/api/admin/claims/${claim.id}`, null, 'DELETE')}
                disabled={busy}
                style={{ fontSize: '1rem', padding: '0 0.1rem' }}
                title="Delete permanently"
              >
                🗑
              </Button>
            </div>
          )
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => doAction(`/api/admin/claims/${claim.id}`, null, 'DELETE')}
            disabled={busy}
            style={{ fontSize: '1rem', padding: '0 0.1rem' }}
            title="Delete permanently"
          >
            🗑
          </Button>
        )}
      </td>
    </tr>
  )
}

function ClaimsTable({ claims, onAction }: { claims: ClaimDetail[]; onAction: () => void }) {
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')

  const visible = filter === 'pending' ? claims.filter(c => c.status === 'pending') : claims
  const pendingCount = claims.filter(c => c.status === 'pending').length

  return (
    <div>
      {/* Filter pills */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
        {(['pending', 'all'] as const).map(f => {
          const count = f === 'pending' ? pendingCount : claims.length
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...BTN_BASE,
                background: filter === f ? 'rgba(200,169,110,0.15)' : 'transparent',
                color: filter === f ? 'var(--gold)' : 'var(--text-muted)',
                border: filter === f ? '1px solid rgba(200,169,110,0.4)' : '1px solid var(--border)',
              }}
            >
              {f === 'pending' ? 'Pending' : 'All'}{' '}
              <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({count})</span>
            </button>
          )
        })}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={TABLE}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
              <th style={TH}>Character</th>
              <th style={TH}>Discord user</th>
              <th style={TH}>Status</th>
              <th style={TH}>Submitted</th>
              <th style={TH}>Reviewed</th>
              <th style={TH}>Note</th>
              <th style={TH}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ ...TD, color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>
                  {filter === 'pending' ? 'No pending claims.' : 'No claims yet.'}
                </td>
              </tr>
            ) : (
              visible.map(c => (
                <ClaimRow key={c.id} claim={c} onDelete={onAction} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const auth = useAuth()
  const [users,  setUsers]  = useState<UserItem[]>([])
  const [claims, setClaims] = useState<ClaimDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  async function fetchAll() {
    setLoading(true)
    setError(null)
    try {
      const [uRes, cRes] = await Promise.all([
        fetch('/api/admin/users',  { credentials: 'include' }),
        fetch('/api/admin/claims', { credentials: 'include' }),
      ])
      if (!uRes.ok || !cRes.ok) {
        const body = await (uRes.ok ? cRes : uRes).json().catch(() => ({}))
        setError(`Error: ${body.detail ?? 'Failed to load admin data'}`)
        return
      }
      const [u, c] = await Promise.all([uRes.json(), cRes.json()])
      setUsers(u)
      setClaims(c)
    } catch {
      setError('Network error — could not load admin data.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (auth.status === 'authenticated' && auth.user.is_admin) {
      fetchAll()
    }
  }, [auth.status])

  if (auth.status === 'loading') {
    return (
      <main style={{ maxWidth: 960, margin: '3rem auto', padding: '0 1rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </main>
    )
  }

  if (auth.status === 'unauthenticated' || !auth.user.is_admin) {
    return (
      <main style={{ maxWidth: 960, margin: '3rem auto', padding: '0 1rem' }}>
        <p style={{ marginTop: '2rem', color: 'var(--danger)' }}>Access denied.</p>
      </main>
    )
  }

  const section: React.CSSProperties = { marginBottom: '2.5rem' }
  const sectionTitle: React.CSSProperties = {
    fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.07em',
    color: 'var(--text-muted)', marginBottom: '0.75rem', fontWeight: 600,
  }

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>← Back</Link>
      <h1 style={{ margin: '0.6rem 0 0.2rem', fontFamily: "var(--font-heading)" }}>Admin Panel</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
        Manage users and character claims.
      </p>

      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      {error   && <p style={{ color: 'var(--danger)' }}>{error}</p>}

      {!loading && !error && (
        <>
          {/* Users */}
          <div style={section}>
            <p style={sectionTitle}>
              Users ({users.length})
            </p>
            <UsersTable users={users} onAction={fetchAll} />
          </div>

          {/* Claims */}
          <div style={section}>
            <p style={sectionTitle}>
              Character claims ({claims.length})
            </p>
            <ClaimsTable claims={claims} onAction={fetchAll} />
          </div>
        </>
      )}
    </main>
  )
}
