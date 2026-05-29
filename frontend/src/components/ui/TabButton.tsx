/**
 * TabButton — the active-underline tab button used by CharacterPage,
 * CharacterAAsTab (2x), GuildPage, ParsePage. Active state gets a 2px gold
 * border-bottom and brighter text.
 *
 * Use inside a `<div className="flex border-b border-border">` wrapper.
 */
import type { ReactNode } from 'react'

interface TabButtonProps {
  active: boolean
  onClick: () => void
  children: ReactNode
  /** Optional title for tooltip on hover (e.g. extra context about the tab) */
  title?: string
  /** Extra classes — e.g. `whitespace-nowrap` for tabs with long labels */
  className?: string
}

export function TabButton({ active, onClick, children, title, className = '' }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={[
        'appearance-none border-none cursor-pointer text-[0.82rem] tracking-[0.04em] px-4 py-[7px] mb-[-1px]',
        'transition-[color,border-color] duration-150',
        active ? 'bg-surface text-text font-semibold' : 'bg-transparent text-text-muted font-normal',
        active ? 'border-b-2 border-gold' : 'border-b-2 border-transparent',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}
