/**
 * CategorySection — one collapsible subsection per content category
 * (Raid / Dungeon / Other) within a GuildSection.
 *
 * Renders nothing when there are no fights — guild headers stay clean.
 */
import { useState } from 'react'

import Caret from '../../components/Caret'
import { SectionLabel } from '../../components/ui/SectionLabel'

import { ZoneDaySection } from './ZoneDaySection'
import type { ParseEncounterSummary, ZoneDayBucket } from './types'

// One subsection per category under a guild. Renders nothing when there are
// no fights — guild headers stay clean.
export interface CategorySectionProps {
  label: 'Raid' | 'Dungeon' | 'Other'
  buckets: ZoneDayBucket[]
  defaultOpen: boolean
  guild: string
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

export function CategorySection({ label, buckets, defaultOpen, guild, onDeleted }: CategorySectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  if (buckets.length === 0) return null
  const totalFights = buckets.reduce((acc, b) => acc + b.fights.length, 0)
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`${label} · ${totalFights} fight${totalFights === 1 ? '' : 's'}`}
        className="appearance-none border-0 bg-transparent p-0 flex items-baseline gap-2 cursor-pointer text-left"
      >
        <Caret open={open} />
        <SectionLabel variant="gold" className="mb-0">{label}</SectionLabel>
        <span className="text-text-muted text-[0.72rem] tabular-nums">
          · {totalFights}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 pl-4">
          {buckets.map(b => (
            <ZoneDaySection
              key={b.key}
              bucket={b}
              guild={guild}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}
