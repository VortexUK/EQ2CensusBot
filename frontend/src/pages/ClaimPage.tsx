import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { Claim, useClaim } from '../hooks/useClaim'
import { Button, Card } from '../components/ui'

// ── Styles ────────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  padding: '1.25rem 1.5rem',
  marginTop: '1rem',
}

// The Discord sign-in button keeps its bespoke brand styling.
function discordBtn(): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '0.4rem 1rem',
    background: 'var(--discord-brand)',
    color: '#fff',
    borderRadius: 6,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontSize: '0.88rem',
    whiteSpace: 'nowrap',
  }
}

// ── Claim form ────────────────────────────────────────────────────────────────

function ClaimForm({ onSubmitted, label = 'Request claim' }: {
  onSubmitted: () => void
  label?: string
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/claim', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_name: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.detail ?? `Error ${res.status}`)
      } else {
        setName('')
        onSubmitted()
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          placeholder="Character name…"
          value={name}
          onChange={e => setName(e.target.value)}
          disabled={busy}
          style={{ flex: 1 }}
        />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          {busy ? 'Checking…' : label}
        </Button>
      </div>
      {error && (
        <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.4rem' }}>{error}</p>
      )}
    </form>
  )
}

// ── Approved character row ────────────────────────────────────────────────────

function ApprovedRow({ claim, onUpdate }: { claim: Claim; onUpdate: () => void }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function handleSetPrimary() {
    setBusy(true)
    try {
      await fetch(`/api/claim/${claim.id}/set-primary`, { method: 'POST', credentials: 'include' })
      onUpdate()
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!window.confirm(`Remove ${claim.character_name} from your account?`)) return
    setBusy(true)
    try {
      await fetch(`/api/claim/${claim.id}`, { method: 'DELETE', credentials: 'include' })
      onUpdate()
    } finally {
      setBusy(false)
    }
  }

  const isPrimary = claim.is_primary === 1

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.55rem 0', borderBottom: '1px solid var(--border)',
    }}>
      {/* Primary / Alt badge */}
      <span style={{
        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
        padding: '0.15rem 0.45rem', borderRadius: 4,
        background: isPrimary ? 'rgba(99,210,130,0.18)' : 'var(--surface-raised)',
        color: isPrimary ? '#4ade80' : 'var(--text-muted)',
        border: `1px solid ${isPrimary ? 'rgba(99,210,130,0.35)' : 'var(--border)'}`,
        flexShrink: 0,
        textTransform: 'uppercase',
      }}>
        {isPrimary ? 'Primary' : 'Alt'}
      </span>

      {/* Character name */}
      <Button
        variant="ghost"
        onClick={() => navigate(`/character/${encodeURIComponent(claim.character_name)}`)}
        style={{ padding: 0, color: 'var(--accent)', fontWeight: 600, fontSize: '0.95rem' }}
      >
        {claim.character_name}
      </Button>

      {/* Actions */}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
        {!isPrimary && (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSetPrimary}
            disabled={busy}
            title="Set as primary character"
          >
            {busy ? '…' : 'Set Primary'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRemove}
          disabled={busy}
          title="Remove this character"
        >
          {busy ? '…' : 'Remove'}
        </Button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClaimPage() {
  const auth = useAuth()
  const claimState = useClaim()
  const [cancelBusy, setCancelBusy] = useState(false)
  const [showChangeForm, setShowChangeForm] = useState(false)

  async function handleCancelPending(claimId: number) {
    setCancelBusy(true)
    try {
      await fetch(`/api/claim/${claimId}`, { method: 'DELETE', credentials: 'include' })
      claimState.refetch()
    } finally {
      setCancelBusy(false)
    }
  }

  const isUnauth = auth.status === 'unauthenticated' || claimState.status === 'unauthenticated'
  const isLoading = auth.status === 'loading' || claimState.status === 'loading'

  return (
    <main style={{ maxWidth: 560, margin: '3rem auto', padding: '0 1rem' }}>
      <h1 style={{ margin: '0.75rem 0 0.5rem' }}>My Characters</h1>
      <Card style={{
        borderLeft: '3px solid rgba(200,169,110,0.5)',
        padding: '0.9rem 1.1rem',
        marginBottom: '1.5rem',
        fontSize: '0.88rem',
        color: 'var(--text-muted)',
        lineHeight: 1.65,
      }}>
        <p style={{ margin: '0 0 0.5rem', color: 'var(--text)', fontWeight: 600 }}>
          What is character claiming?
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          Linking your Discord account to your in-game characters unlocks
          personalised features — your character sheet, spell upgrade tracker,
          and gear overview are all tied to your claim.
        </p>
        <p style={{ margin: '0 0 0.5rem' }}>
          After submitting a claim, a <strong style={{ color: 'var(--text)' }}>guild officer or admin</strong> will
          verify that the character belongs to you and approve the request.
          You'll be notified once it's approved.
        </p>
        <p style={{ margin: 0 }}>
          You can have multiple characters linked — mark one as your{' '}
          <strong style={{ color: 'var(--text)' }}>primary</strong> to set it as
          your default on the home page.
        </p>
      </Card>

      {isUnauth && (
        <Card style={cardStyle}>
          <p style={{ marginBottom: '1rem' }}>You need to sign in with Discord first.</p>
          <a href="/api/auth/login" style={discordBtn()}>Sign in with Discord</a>
        </Card>
      )}

      {isLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      {claimState.status === 'error' && (
        <p style={{ color: 'var(--danger)' }}>Failed to load. Try refreshing.</p>
      )}

      {auth.status === 'authenticated' && claimState.status === 'ready' && (() => {
        const { pending } = claimState.data
        const approved = [...claimState.data.approved].sort((a, b) => b.is_primary - a.is_primary)
        const hasAny = approved.length > 0 || pending !== null

        return (
          <>
            {/* Approved characters */}
            {approved.length > 0 && (
              <Card style={cardStyle}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Approved Characters
                </div>
                {approved.map(c => (
                  <ApprovedRow key={c.id} claim={c} onUpdate={claimState.refetch} />
                ))}
              </Card>
            )}

            {/* Pending claim */}
            {pending && (
              <Card style={{ ...cardStyle, borderColor: 'rgba(234,179,8,0.4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>⏳</span>
                  <div>
                    <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                      Pending approval
                    </div>
                    <div style={{ color: 'var(--accent)', fontWeight: 600 }}>{pending.character_name}</div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => handleCancelPending(pending.id)}
                    disabled={cancelBusy}
                    style={{ marginLeft: 'auto' }}
                  >
                    {cancelBusy ? 'Cancelling…' : 'Cancel'}
                  </Button>
                </div>
              </Card>
            )}

            {/* Add another character */}
            <Card style={cardStyle}>
              {!hasAny ? (
                <>
                  <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>Claim your character</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: 0 }}>
                    Enter your character's name exactly as it appears in-game.
                  </p>
                  <ClaimForm onSubmitted={claimState.refetch} />
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => setShowChangeForm(v => !v)}
                    style={{ padding: 0, fontSize: '0.88rem' }}
                  >
                    {showChangeForm ? '▾ Hide' : '＋ Add another character'}
                  </Button>
                  {showChangeForm && (
                    <div style={{ marginTop: '0.5rem' }}>
                      {pending && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 0 }}>
                          This will replace your current pending claim.
                        </p>
                      )}
                      <ClaimForm
                        label="Request claim"
                        onSubmitted={() => { claimState.refetch(); setShowChangeForm(false) }}
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          </>
        )
      })()}

    </main>
  )
}
