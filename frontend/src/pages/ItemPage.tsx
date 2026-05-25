import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Card } from '../components/ui'
import { itemRarityColor } from '../rarityColors'

interface ItemStat   { display_name: string; value: number; stat_group: string }
interface EffectLine { indentation: number; text: string }
interface ItemEffect { name: string; trigger: string; lines: EffectLine[] }

interface ItemDetail {
  id: string
  name: string
  quality: string
  description: string
  icon_id: string | null
  slot_type: string
  armor_type: string
  mitigation: number | null
  item_level: number | null
  required_level: number | null
  container_slots: number | null
  classes_label: string
  stats: ItemStat[]
  effects: ItemEffect[]
  adornment_slots: string[]
  flags: string[]
  extra_info: [string, string][]
}


export default function ItemPage() {
  const { itemId } = useParams<{ itemId: string }>()
  const [item,    setItem]    = useState<ItemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!itemId) return
    setLoading(true)
    fetch(`/api/item/${itemId}`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setItem)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [itemId])

  if (loading) return <LoadingShell />
  if (error || !item) return (
    <main style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <Link to="/items" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textDecoration: 'none' }}>← Item Search</Link>
      <p style={{ color: 'var(--danger)', marginTop: '1rem' }}>{error ?? 'Item not found.'}</p>
    </main>
  )

  const colour = itemRarityColor(item.quality)
  const iconUrl = item.icon_id ? `/icons/${item.icon_id}.png` : null

  return (
    <main style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
      <Link to="/items" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textDecoration: 'none' }}>
        ← Item Search
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', margin: '1rem 0 1.5rem' }}>
        {iconUrl && (
          <img src={iconUrl} alt="" width={48} height={48}
            style={{ borderRadius: 4, border: '1px solid var(--border)', flexShrink: 0 }} />
        )}
        <div>
          <h1 style={{
            fontFamily: "var(--font-heading)", fontSize: '1.6rem', fontWeight: 700,
            margin: '0 0 0.2rem', color: colour,
            textShadow: colour !== 'var(--text)' ? `0 0 12px ${colour}55` : 'none',
          }}>
            {item.name}
          </h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: colour, fontSize: '0.85rem', fontWeight: 600 }}>
              {item.quality}
            </span>
            {item.slot_type && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>· {item.slot_type}</span>
            )}
            {item.required_level && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>· Level {item.required_level}</span>
            )}
            {item.classes_label && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>· {item.classes_label}</span>
            )}
          </div>
          {item.flags.length > 0 && (
            <div style={{ marginTop: '0.3rem', display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
              {item.flags.map(f => (
                <span key={f} style={{
                  fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
                  padding: '0.1rem 0.4rem', borderRadius: 3,
                  background: 'rgba(200,169,110,0.15)', color: 'var(--gold)',
                  border: '1px solid rgba(200,169,110,0.3)',
                }}>
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <Card style={{ padding: '1.1rem 1.25rem' }}>

        {/* Description */}
        {item.description && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic', marginBottom: '1rem' }}>
            {item.description}
          </p>
        )}

        {/* Mitigation */}
        {item.mitigation != null && (
          <InfoRow label="Mitigation" value={String(item.mitigation)} />
        )}

        {/* Extra info */}
        {item.extra_info.map(([label, value]) => (
          <InfoRow key={label} label={label} value={value} />
        ))}

        {/* Stats */}
        {item.stats.length > 0 && (
          <div style={{ margin: '1rem 0' }}>
            {item.stats.map(s => (
              <div key={s.display_name} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: '0.12rem 0', borderBottom: '1px solid var(--border)',
                fontSize: '0.88rem',
              }}>
                <span style={{ color: s.stat_group === 'primary' ? '#22ff22' : '#00e5ff' }}>
                  {s.display_name}
                </span>
                <span style={{ color: s.stat_group === 'primary' ? '#22ff22' : '#00e5ff', fontWeight: 600 }}>
                  {s.value > 0 ? '+' : ''}{s.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Effects */}
        {item.effects.map((eff, i) => (
          <div key={i} style={{ margin: '0.75rem 0', fontSize: '0.85rem' }}>
            {eff.name && (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.2rem', fontStyle: 'italic' }}>
                {eff.name}
              </div>
            )}
            {eff.trigger && (
              <div style={{ color: 'var(--text)', fontWeight: 600, marginBottom: '0.15rem' }}>
                {eff.trigger}
              </div>
            )}
            {eff.lines.map((ln, j) => (
              <div key={j} style={{
                paddingLeft: `${ln.indentation * 1.1}rem`,
                color: ln.indentation === 0 ? 'var(--text)' : 'var(--text-muted)',
                fontSize: '0.83rem', lineHeight: 1.5,
              }}>
                {ln.indentation > 0 ? '• ' : ''}{ln.text}
              </div>
            ))}
          </div>
        ))}

        {/* Adornment slots */}
        {item.adornment_slots.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            {item.adornment_slots.map(s => (
              <div key={s} style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {s}
              </div>
            ))}
          </div>
        )}

      </Card>

      <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        ID: {item.id}
      </div>
    </main>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '0.12rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.85rem',
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

function LoadingShell() {
  return (
    <main style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <Link to="/items" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textDecoration: 'none' }}>← Item Search</Link>
      <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>Loading…</p>
    </main>
  )
}
