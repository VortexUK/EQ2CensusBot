import { Link } from 'react-router-dom'

interface CrumbItem {
  label: string
  to?: string
}

/**
 * Horizontal breadcrumb trail.
 * Pass an array of items; the last item is the current page (no link).
 * Example: <Breadcrumb items={[{ label: 'Characters', to: '/characters' }, { label: name }]} />
 */
export default function Breadcrumb({ items }: { items: CrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{
      display: 'flex', alignItems: 'center', gap: '0.35rem',
      marginBottom: '0.75rem', fontSize: '0.88rem', color: 'var(--text-muted)',
      flexWrap: 'wrap',
    }}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            {i > 0 && (
              <span style={{ opacity: 0.45, userSelect: 'none' }}>›</span>
            )}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                style={{ color: 'var(--text-muted)', textDecoration: 'none' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                {item.label}
              </Link>
            ) : (
              <span style={{ color: isLast ? 'var(--text)' : 'var(--text-muted)' }}>
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
