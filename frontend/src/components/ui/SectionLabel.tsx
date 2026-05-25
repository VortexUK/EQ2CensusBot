import type { CSSProperties, ReactNode } from 'react'

type SectionLabelProps = {
  children: ReactNode
  /** Merged onto the base `.section-label` styling for one-off spacing tweaks. */
  style?: CSSProperties
  className?: string
}

/**
 * The uppercase gold "eyebrow" heading used above stat groups, tab panes,
 * and card sections. Was duplicated ~40× as an inline
 * `{ textTransform: 'uppercase', letterSpacing, color: var(--accent), ... }`.
 */
export function SectionLabel({ children, style, className }: SectionLabelProps) {
  const cls = ['section-label', className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
