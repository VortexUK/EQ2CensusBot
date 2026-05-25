import type { CSSProperties, ReactNode } from 'react'

type SectionLabelProps = {
  children: ReactNode
  /** Merged onto the base `.section-label` styling for one-off spacing tweaks. */
  style?: CSSProperties
  className?: string
}

/**
 * The uppercase gold "eyebrow" heading used above stat groups, tab panes,
 * and card sections. Styled with Tailwind utilities (the reference pattern
 * for the page migration): tracking-[0.08em] → letter-spacing, text-gold →
 * the brand-gold theme colour, mb-1 → 0.25rem.
 */
const SECTION_LABEL_CLASSES = 'text-[0.7rem] uppercase tracking-[0.08em] text-gold font-semibold mb-1'

export function SectionLabel({ children, style, className }: SectionLabelProps) {
  const cls = [SECTION_LABEL_CLASSES, className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
