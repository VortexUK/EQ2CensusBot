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
    <span
      className="rounded-sm px-2 py-[2px] text-[0.72rem] font-semibold whitespace-nowrap"
      style={style}
    >
      {label}
    </span>
  )
}

// ── Shared table classes ──────────────────────────────────────────────────────

const TABLE_CLS = 'w-full border-collapse text-[0.875rem]'
const TH_CLS = 'text-left px-3 py-[0.45rem] text-text-muted text-[0.72rem] font-semibold uppercase tracking-[0.05em] border-b border-border whitespace-nowrap'
const TD_CLS = 'px-3 py-2 border-b border-white/5 align-middle'
// Filter-pill base (border/background/colour applied conditionally inline).
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
      <td className={TD_CLS}>
        <div className="flex items-center gap-2">
          <img
            src={discordAvatar(user.discord_id, user.avatar)}
            alt=""
            width={28} height={28}
            className="rounded-full shrink-0"
          />
          <div className="min-w-0">
            <div className="font-semibold text-[0.88rem] leading-[1.2]">
              {displayName}
            </div>
            {user.discord_username && user.discord_username !== user.discord_name && (
              <div className="text-text-muted text-[0.72rem]">
                {user.discord_username}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Joined */}
      <td className={`${TD_CLS} text-text-muted whitespace-nowrap`}>
        <span title={fmt(user.first_seen)}>{relativeTime(user.first_seen)}</span>
      </td>

      {/* Status */}
      <td className={TD_CLS}>
        <Badge label={user.access_status} style={badgeStyle} />
      </td>

      {/* Claims */}
      <td className={`${TD_CLS} text-center ${user.claim_count ? 'text-text' : 'text-text-muted'}`}>
        {user.claim_count}
      </td>

      {/* Actions */}
      <td className={`${TD_CLS} whitespace-nowrap`}>
        {kickConfirm ? (
          <div className="flex items-center gap-[0.35rem] flex-wrap">
            <span className="text-[0.75rem] text-danger">Kick + delete all claims?</span>
            <Button variant="danger" size="sm" onClick={() => doAccess('kick')} disabled={busy}>
              {busy ? '…' : 'Confirm'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setKickConfirm(false)}>Cancel</Button>
          </div>
        ) : (
          <div className="flex gap-[0.35rem] flex-wrap">
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
      <div className="flex gap-[0.4rem] mb-3 flex-wrap">
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
            <span className="opacity-70 text-[0.7rem]">({counts[f]})</span>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto border border-border rounded-md">
        <table className={TABLE_CLS}>
          <thead>
            <tr className="bg-white/2">
              <th className={TH_CLS}>User</th>
              <th className={TH_CLS}>Joined</th>
              <th className={TH_CLS}>Status</th>
              <th className={`${TH_CLS} text-center`}>Claims</th>
              <th className={TH_CLS}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className={`${TD_CLS} text-text-muted text-center p-6`}>
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
      <td className={`${TD_CLS} text-gold font-semibold`}>
        {claim.character_name}
      </td>

      {/* User */}
      <td className={TD_CLS}>
        <div className="flex items-center gap-[0.4rem]">
          <img
            src={discordAvatar(claim.discord_id, claim.avatar)}
            alt=""
            width={22} height={22}
            className="rounded-full shrink-0"
          />
          <span className="text-[0.85rem]">{displayName}</span>
        </div>
      </td>

      {/* Status */}
      <td className={TD_CLS}>
        <Badge label={claim.status} style={badgeStyle} />
      </td>

      {/* Submitted */}
      <td className={`${TD_CLS} text-text-muted whitespace-nowrap`}>
        <span title={fmt(claim.requested_at)}>{relativeTime(claim.requested_at)}</span>
      </td>

      {/* Reviewed */}
      <td className={`${TD_CLS} text-text-muted whitespace-nowrap`}>
        {claim.reviewed_at ? (
          <span title={fmt(claim.reviewed_at)}>{relativeTime(claim.reviewed_at)}</span>
        ) : (
          <span className="opacity-40">—</span>
        )}
      </td>

      {/* Note */}
      <td className={`${TD_CLS} text-text-muted italic text-[0.8rem] max-w-[180px]`}>
        {claim.note
          ? <span title={claim.note} className="block overflow-hidden text-ellipsis whitespace-nowrap">"{claim.note}"</span>
          : <span className="opacity-40">—</span>
        }
      </td>

      {/* Actions */}
      <td className={`${TD_CLS} whitespace-nowrap`}>
        {claim.status === 'pending' ? (
          rejectOpen ? (
            <div className="flex flex-col gap-[0.3rem] min-w-[200px]">
              <textarea
                placeholder="Optional rejection reason…"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                className="text-[0.78rem] resize-y w-full box-border"
              />
              <div className="flex gap-[0.3rem]">
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
            <div className="flex gap-[0.35rem]">
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
      <div className="flex gap-[0.4rem] mb-3">
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
              <span className="opacity-70 text-[0.7rem]">({count})</span>
            </button>
          )
        })}
      </div>

      <div className="overflow-x-auto border border-border rounded-md">
        <table className={TABLE_CLS}>
          <thead>
            <tr className="bg-white/2">
              <th className={TH_CLS}>Character</th>
              <th className={TH_CLS}>Discord user</th>
              <th className={TH_CLS}>Status</th>
              <th className={TH_CLS}>Submitted</th>
              <th className={TH_CLS}>Reviewed</th>
              <th className={TH_CLS}>Note</th>
              <th className={TH_CLS}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className={`${TD_CLS} text-text-muted text-center p-6`}>
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
      <main className="max-w-[960px] mx-auto my-12 px-4">
        <p className="text-text-muted">Loading…</p>
      </main>
    )
  }

  if (auth.status === 'unauthenticated' || !auth.user.is_admin) {
    return (
      <main className="max-w-[960px] mx-auto my-12 px-4">
        <p className="mt-8 text-danger">Access denied.</p>
      </main>
    )
  }

  const SECTION_CLS = 'mb-10'
  const SECTION_TITLE_CLS = 'text-[0.8rem] uppercase tracking-[0.07em] text-text-muted mb-3 font-semibold'

  return (
    <main className="max-w-[1100px] mx-auto my-8 px-4">
      <Link to="/" className="text-text-muted text-[0.9rem]">← Back</Link>
      <h1 className="mt-[0.6rem] mb-[0.2rem] font-heading">Admin Panel</h1>
      <p className="text-text-muted text-[0.9rem] mb-7">
        Manage users and character claims.
      </p>

      {loading && <p className="text-text-muted">Loading…</p>}
      {error   && <p className="text-danger">{error}</p>}

      {!loading && !error && (
        <>
          {/* Users */}
          <div className={SECTION_CLS}>
            <p className={SECTION_TITLE_CLS}>
              Users ({users.length})
            </p>
            <UsersTable users={users} onAction={fetchAll} />
          </div>

          {/* Claims */}
          <div className={SECTION_CLS}>
            <p className={SECTION_TITLE_CLS}>
              Character claims ({claims.length})
            </p>
            <ClaimsTable claims={claims} onAction={fetchAll} />
          </div>
        </>
      )}
    </main>
  )
}
