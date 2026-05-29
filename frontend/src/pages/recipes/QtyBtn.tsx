import type { ReactNode } from 'react'

export function QtyBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: '1px solid var(--border)',
        borderRadius: 4,
        color: 'var(--text)',
        fontSize: '0.8rem',
        width: 20,
        height: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        lineHeight: 1,
        padding: 0,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}
