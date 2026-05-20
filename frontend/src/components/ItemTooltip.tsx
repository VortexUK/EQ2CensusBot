import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// ── API types (mirrors web/routes/item.py) ────────────────────────────────────

interface ItemStat {
  display_name: string
  value: number
  stat_group: string
}

interface EffectLine {
  indentation: number
  text: string
}

interface ItemEffect {
  name: string
  trigger: string
  lines: EffectLine[]
}

export interface ItemDetail {
  id: string
  name: string
  quality: string
  icon_id: string | null
  slot_type: string
  armor_type: string
  mitigation: number | null
  item_level: number | null
  required_level: number | null
  classes: string[]
  stats: ItemStat[]
  effects: ItemEffect[]
  adornment_slots: string[]
  flags: string[]
  extra_info: [string, string][]
}

export interface TooltipState {
  itemId: string
  x: number
  y: number
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const _outline = '-1px 0 0 #000, 0 1px 0 #000, 1px 0 0 #000, 0 -1px 0 #000'
type TierStyle = { color: string; textShadow?: string }

const TIER_STYLE: Record<string, TierStyle> = {
  MYTHICAL:      { color: '#d99fe9', textShadow: `${_outline}, 0 0 4px #C859E6, 0 0 4px #C859E6` },
  FABLED:        { color: '#ff939d', textShadow: `${_outline}, 0 0 4px #DF535F, 0 0 4px #DF535F` },
  LEGENDARY:     { color: '#ffc993', textShadow: `${_outline}, 0 0 4px #D56900, 0 0 4px #ffc993` },
  MASTERCRAFTED: { color: '#92d7fd', textShadow: `${_outline}, 0 0 4px #D56900, 0 0 4px #92d7fd` },
  TREASURED:     { color: '#92d7fd', textShadow: `${_outline}, 0 0 4px #D56900, 0 0 4px #92d7fd` },
  UNCOMMON:      { color: '#a8d4a8' },
  COMMON:        { color: '#e0e0e0' },
}
function getTierStyle(quality: string): TierStyle {
  return TIER_STYLE[quality.toUpperCase()] ?? { color: '#e0e0e0' }
}

const ADORN_COLOUR: Record<string, string> = {
  White: '#e8e8e8', Yellow: '#e8c840', Red: '#e05050',
  Green: '#50c850', Blue: '#5090e8', Purple: '#b060e0',
  Orange: '#e08830', Turquoise: '#30c8c0', Black: '#a0a0a0',
}

// ── Module-level item cache ───────────────────────────────────────────────────

const _cache = new Map<string, ItemDetail>()

// ── Main export ───────────────────────────────────────────────────────────────

export function ItemTooltip({ state }: { state: TooltipState }) {
  const [item, setItem] = useState<ItemDetail | null>(_cache.get(state.itemId) ?? null)
  const [loading, setLoading] = useState(!_cache.has(state.itemId))

  useEffect(() => {
    if (_cache.has(state.itemId)) {
      setItem(_cache.get(state.itemId)!)
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/item/${state.itemId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((data: ItemDetail) => {
        _cache.set(state.itemId, data)
        setItem(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [state.itemId])

  // Clamp to viewport — show right of cursor, flip left if near edge
  const TIP_W = 340
  const MARGIN = 12
  const x = state.x + 16 + TIP_W > window.innerWidth
    ? state.x - TIP_W - 8
    : state.x + 16
  const y = Math.max(MARGIN, Math.min(state.y - 8, window.innerHeight - MARGIN - 40))

  const borderColor = item ? (getTierStyle(item.quality).color ?? '#555') : '#555'

  return createPortal(
    <div style={{
      position: 'fixed', left: x, top: y, width: TIP_W, zIndex: 9999,
      background: '#0d0d1a',
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      padding: '10px 12px',
      boxShadow: `0 6px 28px rgba(0,0,0,0.85), 0 0 10px ${borderColor}33`,
      fontSize: '0.82rem', lineHeight: 1.45,
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      {loading && <span style={{ color: '#777' }}>Loading…</span>}
      {!loading && !item && <span style={{ color: '#f87171' }}>Item not found</span>}
      {item && <TooltipContent item={item} />}
    </div>,
    document.body,
  )
}

// ── Tooltip content ───────────────────────────────────────────────────────────

function TooltipContent({ item }: { item: ItemDetail }) {
  const ts = getTierStyle(item.quality)
  const primary   = item.stats.filter(s => s.stat_group === 'primary')
  const secondary = item.stats.filter(s => s.stat_group === 'secondary')

  return (
    <div>
      {/* Name */}
      <div style={{ ...ts, fontWeight: 700, fontSize: '0.95rem', marginBottom: 3 }}>
        {item.name}
      </div>

      {/* Slot · Armor type */}
      {(item.slot_type || item.armor_type) && (
        <div style={{ color: '#999', fontSize: '0.76rem', marginBottom: 5 }}>
          {[item.slot_type, item.armor_type].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* Mitigation */}
      {item.mitigation != null && (
        <div style={{ color: '#ccc', marginBottom: 4 }}>
          Mitigation: <strong>{item.mitigation.toLocaleString()}</strong>
        </div>
      )}

      {/* Extra info rows (charges, weight, etc.) */}
      {item.extra_info.map(([label, val]) => (
        <div key={label} style={{ color: '#bbb', fontSize: '0.77rem' }}>
          {label}: <span style={{ color: '#ddd' }}>{val}</span>
        </div>
      ))}

      {/* Primary stats */}
      {primary.length > 0 && (
        <Section>
          {primary.map(s => (
            <StatLine key={s.display_name} stat={s} />
          ))}
        </Section>
      )}

      {/* Secondary stats */}
      {secondary.length > 0 && (
        <Section>
          {secondary.map(s => (
            <StatLine key={s.display_name} stat={s} />
          ))}
        </Section>
      )}

      {/* Effects */}
      {item.effects.length > 0 && (
        <Section>
          {item.effects.map((eff, i) => (
            <div key={i} style={{ marginBottom: i < item.effects.length - 1 ? 6 : 0 }}>
              {eff.trigger && (
                <div style={{ color: '#7bc', fontStyle: 'italic', fontSize: '0.77rem', marginBottom: 2 }}>
                  {eff.trigger}
                </div>
              )}
              {eff.lines.map((ln, j) => (
                <div key={j} style={{
                  color: '#ccc', fontSize: '0.77rem',
                  paddingLeft: `${Math.max(0, ln.indentation - 1) * 10}px`,
                }}>
                  {ln.text}
                </div>
              ))}
            </div>
          ))}
        </Section>
      )}

      {/* Adornment slots */}
      {item.adornment_slots.length > 0 && (
        <Section>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 4px' }}>
            {item.adornment_slots.map((color, i) => (
              <span key={i} style={{
                fontSize: '0.7rem', padding: '1px 6px', borderRadius: 3,
                border: `1px solid ${ADORN_COLOUR[color] ?? '#777'}`,
                color: ADORN_COLOUR[color] ?? '#777',
              }}>
                {color}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Flags */}
      {item.flags.length > 0 && (
        <Section>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
            {item.flags.map(f => (
              <span key={f} style={{ color: '#f0c060', fontSize: '0.72rem', fontWeight: 700 }}>{f}</span>
            ))}
          </div>
        </Section>
      )}

      {/* Required level / classes */}
      {(item.required_level != null || item.classes.length > 0) && (
        <Section>
          {item.required_level != null && (
            <div style={{ color: '#aaa', fontSize: '0.76rem' }}>
              Required Level: <span style={{ color: '#ddd' }}>{item.required_level}</span>
            </div>
          )}
          {item.classes.length > 0 && item.classes.length <= 24 && (
            <div style={{ color: '#aaa', fontSize: '0.76rem', marginTop: 2 }}>
              Classes: <span style={{ color: '#ddd' }}>{item.classes.join(', ')}</span>
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

// ── Small layout helpers ──────────────────────────────────────────────────────

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid #2a2a3a', marginTop: 6, paddingTop: 6 }}>
      {children}
    </div>
  )
}

function StatLine({ stat }: { stat: ItemStat }) {
  const v = stat.value
  const formatted = Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1)
  return (
    <div style={{ color: '#dde' }}>
      <span style={{ color: '#8cf', fontWeight: 600 }}>+{formatted}</span>
      {' '}
      <span style={{ color: '#bbc' }}>{stat.display_name}</span>
    </div>
  )
}
