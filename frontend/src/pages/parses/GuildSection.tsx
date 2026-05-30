/**
 * GuildSection — one collapsible card per guild in the parses list.
 *
 * Renders three CategorySection children (Raid / Dungeon / Other), each
 * independently collapsible. Officers / admins who can delete every visible
 * row get a guild-level trash button.
 */
import { useState } from 'react'

import { Card } from '../../components/ui'
import Caret from '../../components/Caret'

import { CategorySection } from './CategorySection'
import { deleteByFilter } from './api'
import { NO_GUILD } from './types'
import type { GuildBucket, ParseEncounterSummary } from './types'

const headerBtnCls = 'flex items-center gap-2 w-full bg-transparent border-none text-inherit cursor-pointer py-2 px-3 text-left font-inherit'

export interface GuildSectionProps {
  bucket: GuildBucket
  defaultExpanded: boolean
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

// One section per guild. Renders three CategorySection children (Raid /
// Dungeon / Other), each independently collapsible. Empty categories
// render nothing.
export function GuildSection({ bucket, defaultExpanded, onDeleted }: GuildSectionProps) {
  const [open, setOpen] = useState(defaultExpanded)
  const totalUploads = (['raid', 'dungeon', 'other'] as const).reduce(
    (s, k) => s + bucket.fightsByCategory[k].reduce(
      (n, zd) => n + zd.fights.reduce((m, f) => m + f.uploads.length, 0),
      0,
    ),
    0,
  )
  // Officers / admins can wipe the whole guild only when they have delete
  // perms on every visible row for it (admins always do; officers only
  // within their own guild).
  const canDeleteGuild =
    bucket.guild !== NO_GUILD
    && (['raid', 'dungeon', 'other'] as const).every(k =>
      bucket.fightsByCategory[k].every(zd =>
        zd.fights.every(f => f.uploads.every(u => u.permissions.can_delete)),
      ),
    )

  async function handleDeleteGuild(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`Delete all ${totalUploads} encounter${totalUploads === 1 ? '' : 's'} for ${bucket.guild}? This cannot be undone.`)) return
    try {
      await deleteByFilter({ guild: bucket.guild })
      onDeleted(enc => (enc.guild_name || NO_GUILD) === bucket.guild)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <Card className="p-0">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          className={headerBtnCls}
        >
          <Caret open={open} />
          <h2 className="font-heading text-[0.98rem] text-gold m-0">
            {bucket.guild}
          </h2>
          <span className="text-text-muted text-[0.78rem] ml-auto">
            {bucket.totalFights} fight{bucket.totalFights === 1 ? '' : 's'}{totalUploads !== bucket.totalFights ? ` (${totalUploads} uploads)` : ''}
          </span>
        </button>
        {canDeleteGuild && (
          <TrashButton onClick={handleDeleteGuild} title={`Delete all parses for ${bucket.guild}`} />
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 px-2 pb-2.5">
          <CategorySection
            label="Raid"
            buckets={bucket.fightsByCategory.raid}
            defaultOpen
            guild={bucket.guild}
            onDeleted={onDeleted}
          />
          <CategorySection
            label="Dungeon"
            buckets={bucket.fightsByCategory.dungeon}
            defaultOpen
            guild={bucket.guild}
            onDeleted={onDeleted}
          />
          <CategorySection
            label="Other"
            buckets={bucket.fightsByCategory.other}
            defaultOpen={false}
            guild={bucket.guild}
            onDeleted={onDeleted}
          />
        </div>
      )}
    </Card>
  )
}

function TrashButton({ onClick, title, small = false }: {
  onClick: (e: React.MouseEvent) => void
  title: string
  small?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="bg-transparent border-none text-text-muted cursor-pointer leading-none opacity-55 transition-[opacity,color] duration-100"
      style={{
        padding: small ? '0 4px' : '0 8px',
        fontSize: small ? '0.95rem' : '1.05rem',
      }}
      onMouseEnter={ev => {
        ev.currentTarget.style.opacity = '1'
        ev.currentTarget.style.color = 'var(--danger, #e57373)'
      }}
      onMouseLeave={ev => {
        ev.currentTarget.style.opacity = '0.55'
        ev.currentTarget.style.color = 'var(--text-muted)'
      }}
    >
      ✕
    </button>
  )
}
