import type { CSSProperties, ReactNode } from 'react'

type Variant = 'gold' | 'muted'

type SectionLabelProps = {
  children: ReactNode
  /** Merged onto the base `.section-label` styling for one-off spacing tweaks. */
  style?: CSSProperties
  className?: string
  /** 'gold' (default) — the brand eyebrow. 'muted' — secondary section
   *  headings used in dense forms / admin tables where gold competes too
   *  hard with surrounding gold accents. */
  variant?: Variant
}

const BASE = 'text-[0.7rem] uppercase tracking-[0.08em] font-semibold mb-1'
const VARIANT_CLASSES: Record<Variant, string> = {
  gold:  'text-gold',
  muted: 'text-text-muted',
}

/**
 * The uppercase gold "eyebrow" heading used above stat groups, tab panes,
 * and card sections. Styled with Tailwind utilities (the reference pattern
 * for the page migration): tracking-[0.08em] → letter-spacing, text-gold →
 * the brand-gold theme colour, mb-1 → 0.25rem.
 */
export function SectionLabel({ children, style, className, variant = 'gold' }: SectionLabelProps) {
  const cls = [BASE, VARIANT_CLASSES[variant], className].filter(Boolean).join(' ')
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}
