import type { CSSProperties, ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  /** Use the lighter `surface-raised` background (for nested / emphasised cards). */
  raised?: boolean
  /** Merged onto the base `.card` styling — use for layout (margin, width, custom padding). */
  style?: CSSProperties
  className?: string
  onClick?: () => void
}

/**
 * Surface panel: tokenised background, border, radius and padding. Replaces
 * the hand-rolled `background: var(--surface); border: 1px solid var(--border)`
 * blocks that were duplicated across every page.
 */
export function Card({ children, raised, style, className, onClick }: CardProps) {
  const cls = ['card', raised ? 'card--raised' : '', className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style} onClick={onClick}>
      {children}
    </div>
  )
}
