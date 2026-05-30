import type { CSSProperties } from 'react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useFetch } from '../hooks/useFetch'
import { useSearchParams, Link } from 'react-router-dom'

import Caret from '../components/Caret'
import { Card, SectionLabel } from '../components/ui'
import { Badge } from '../components/ui/Badge'
import { FilterPill } from '../components/FilterPill'
import { UploaderTag } from '../components/UploaderTag'
import { fmtDuration, fmtLocalDate, fmtLocalTime, fmtNum } from '../formatters'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ParsePermissions {
  can_delete: boolean
}

interface ParseUploadSummary {
  id: number
  uploaded_by: string                       // EQ2 character name (logger_name)
  uploader_discord_id: string | null        // resolved from source_dsn ('plugin:<id>')
  uploader_display_name: string | null      // joined from users.discord_name
  started_at: number
  duration_s: number
  total_damage: number
  encdps: number
  success_level: number
  permissions: ParsePermissions
}

interface ParseEncounterSummary {
  id: number
  act_encid: string
  title: string
  zone: string | null
  started_at: number       // unix seconds, UTC
  ended_at: number
  duration_s: number
  total_damage: number
  encdps: number
  kills: number
  deaths: number
  success_level: number      // ACT enum: 0=unknown, 1=win, 2=loss, 3=mixed
  combatant_count: number
  player_count: number
  // Backend-computed Raid / Dungeon / Other bucket (see
  // web/routes/parses/list.py:_classify_zone). Drives the Guild → Category
  // hierarchy on this page.
  category: 'raid' | 'dungeon' | 'other'
  uploaded_by: string                       // canonical upload's character name
  uploader_discord_id: string | null        // canonical upload's Discord ID
  uploader_display_name: string | null      // canonical upload's Discord display name
  guild_name: string | null   // stamped at ingest from uploader's Census guild
  permissions: ParsePermissions
  // Server-side mirror grouping (B2.15e) — every raider's upload for this
  // fight, including the canonical (single-upload fights have length 1).
  uploads: ParseUploadSummary[]
}

interface ParsesListResponse {
  results: ParseEncounterSummary[]
  total: number
}

type SizeFilter = '' | 'individual' | 'group' | 'raid12' | 'raid24'

// ── Constants ─────────────────────────────────────────────────────────────────

const SIZE_OPTIONS: { value: SizeFilter; label: string; range: string }[] = [
  { value: '',           label: 'All sizes',  range: '' },
  { value: 'raid24',     label: 'Raid (24)',  range: '13–24' },
  { value: 'raid12',     label: 'Raid (12)',  range: '7–12'  },
  { value: 'group',      label: 'Group',      range: '2–6'   },
  { value: 'individual', label: 'Individual', range: '1'     },
]

const NO_GUILD = 'No Guild'
const PARSES_FETCH_LIMIT = 500

// Visible joiner (used in display) + internal joiner (used in Map keys).
const KEY_SEP = String.fromCharCode(31)   // ASCII Unit Separator — never appears in zone names / dates
const DISPLAY_SEP = ' · '                  // " · "

// ── Helpers ───────────────────────────────────────────────────────────────────

// EQ2 mob naming convention: trash is "a krait warrior" / "an ancient guard"
// (article + lowercase noun), bosses have a proper capitalised name
// ("Captain Krasniv", "The Shadowed One"). First-character capitalisation is
// the simplest reliable signal.
function isBoss(title: string): boolean {
  return /^[A-Z]/.test(title)
}

// ── Grouped structure ─────────────────────────────────────────────────────────
// Guild → Category (Raid / Dungeon / Other) → ParseEncounterSummary[]
//
// Mirror grouping (collapsing multiple raider uploads of the same fight)
// happens server-side. Each ParseEncounterSummary IS a fight, with the
// canonical upload's fields at the top level. The frontend buckets fights
// by guild then by the backend-computed category.

type Category = 'raid' | 'dungeon' | 'other'

interface ZoneDayBucket {
  key: string                          // "2026-05-24 · Castle Mistmoore"
  date: string                         // local YYYY-MM-DD
  zone: string                         // "Castle Mistmoore" or "(unknown zone)"
  fights: ParseEncounterSummary[]      // sorted started_at desc within the bucket
}

interface GuildBucket {
  guild: string                                // "Exordium" or NO_GUILD
  fightsByCategory: Record<Category, ZoneDayBucket[]>  // each category's zone-day buckets, newest bucket first
  totalFights: number
}

function groupEncounters(fights: ParseEncounterSummary[]): GuildBucket[] {
  // First pass: bucket by guild → category → (date · zone).
  // byGuild[guild][category] is a Map<zoneKey, fights[]> so we can
  // accumulate without intermediate object spreads.
  const byGuild = new Map<
    string,
    Record<Category, Map<string, ParseEncounterSummary[]>>
  >()

  for (const e of fights) {
    const guild = e.guild_name || NO_GUILD
    let cats = byGuild.get(guild)
    if (!cats) {
      cats = { raid: new Map(), dungeon: new Map(), other: new Map() }
      byGuild.set(guild, cats)
    }
    const date = fmtLocalDate(e.started_at)
    const zone = e.zone || '(unknown zone)'
    const zoneKey = [date, zone].join(KEY_SEP)
    let zoneFights = cats[e.category].get(zoneKey)
    if (!zoneFights) {
      zoneFights = []
      cats[e.category].set(zoneKey, zoneFights)
    }
    zoneFights.push(e)
  }

  // Second pass: materialise the ZoneDayBucket arrays, sort within and
  // between buckets.
  const result: GuildBucket[] = []
  for (const [guild, cats] of byGuild) {
    const byCategory: Record<Category, ZoneDayBucket[]> = {
      raid: [],
      dungeon: [],
      other: [],
    }
    let total = 0
    for (const k of ['raid', 'dungeon', 'other'] as const) {
      const buckets: ZoneDayBucket[] = []
      for (const [key, fightsInBucket] of cats[k]) {
        // Server returns fights newest-first overall; re-sort within the
        // bucket so the most recent fight shows on top.
        fightsInBucket.sort((a, b) => b.started_at - a.started_at)
        const [date, zone] = key.split(KEY_SEP)
        buckets.push({
          key: `${date}${DISPLAY_SEP}${zone}`,
          date,
          zone,
          fights: fightsInBucket,
        })
      }
      // Buckets sorted by their newest fight (desc) so the most recent
      // raid night appears first under each category.
      buckets.sort((a, b) => (b.fights[0]?.started_at ?? 0) - (a.fights[0]?.started_at ?? 0))
      byCategory[k] = buckets
      total += buckets.reduce((acc, b) => acc + b.fights.length, 0)
    }
    result.push({ guild, fightsByCategory: byCategory, totalFights: total })
  }

  // Sort guilds: NO_GUILD always last; everyone else by total fight count
  // desc (most-active guild first), with name ASC as tiebreaker.
  result.sort((a, b) => {
    if (a.guild === NO_GUILD) return 1
    if (b.guild === NO_GUILD) return -1
    if (b.totalFights !== a.totalFights) return b.totalFights - a.totalFights
    return a.guild.localeCompare(b.guild)
  })
  return result
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ParsesPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [size, setSize] = useState<SizeFilter>(
    (searchParams.get('size') as SizeFilter) ?? '',
  )
  const [bossesOnly, setBossesOnly] = useState<boolean>(
    searchParams.get('bosses') === '1',
  )

  const parsesUrl = useMemo(() => {
    const url = new URL('/api/parses', window.location.origin)
    if (size) url.searchParams.set('size', size)
    url.searchParams.set('limit', String(PARSES_FETCH_LIMIT))
    return url.toString()
  }, [size])

  const { data: fetchedData, loading, error } = useFetch<ParsesListResponse>(parsesUrl)

  // Local copy for optimistic deletions — seeded from fetchedData on each
  // successful fetch, then mutated locally so deletes don't trigger a full
  // reload (which would unmount GuildSection / CategorySection, losing open state).
  const [localData, setLocalData] = useState<ParsesListResponse | null>(null)
  useEffect(() => {
    if (fetchedData !== null) setLocalData(fetchedData)
  }, [fetchedData])
  const data = localData ?? fetchedData

  // URL sync
  useEffect(() => {
    const p: Record<string, string> = {}
    if (size) p.size = size
    if (bossesOnly) p.bosses = '1'
    setSearchParams(p, { replace: true })
  }, [size, bossesOnly, setSearchParams])

  // Optimistic local removal after a successful delete — avoids a full
  // refetch (which would briefly toggle `loading` and unmount every
  // GuildSection / CategorySection, losing their open/closed state).
  const removeEncounters = useCallback((pred: (e: ParseEncounterSummary) => boolean) => {
    setLocalData(prev => {
      if (!prev) return prev
      const kept = prev.results.filter(e => !pred(e))
      const removed = prev.results.length - kept.length
      return { results: kept, total: Math.max(0, prev.total - removed) }
    })
  }, [])

  const grouped = useMemo(() => {
    if (!data) return []
    const filtered = bossesOnly
      ? data.results.filter(e => isBoss(e.title))
      : data.results
    return groupEncounters(filtered)
  }, [data, bossesOnly])


  return (
    <main className="max-w-[1100px] mx-auto px-4 py-6">
      <div className="flex items-baseline gap-4 mb-4">
        <h1 className="font-heading text-[1.7rem] text-gold m-0">
          Parses
        </h1>
        {data && (
          <span className="text-[0.82rem] text-text-muted">
            {data.total.toLocaleString()} encounter{data.total !== 1 ? 's' : ''}{size && ' (filtered)'}
          </span>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-1.5 mb-[1.2rem]">
        {SIZE_OPTIONS.map(opt => (
          <FilterPill key={opt.value || 'all'} active={size === opt.value} onClick={() => setSize(opt.value)}>
            {opt.label}
            {opt.range && <span className="ml-[0.35rem] opacity-60 text-[0.72rem]">{opt.range}</span>}
          </FilterPill>
        ))}
        <span className="w-px bg-border mx-[0.2rem]" />
        <FilterPill
          active={bossesOnly}
          onClick={() => setBossesOnly(v => !v)}
          title="Hide trash mobs (titles starting with 'a' / 'an')"
        >
          Bosses only
        </FilterPill>
      </div>

      {loading && <p className="text-text-muted">Loading…</p>}
      {error && <p className="text-danger">{error}</p>}

      {!loading && !error && data && data.results.length === 0 && (
        <p className="text-text-muted">
          No parses {size ? `match the ${size} filter` : 'yet'}.
        </p>
      )}

      {!loading && grouped.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {grouped.map(g => (
            <GuildSection
              key={g.guild}
              bucket={g}
              defaultExpanded={grouped.length === 1}
              onDeleted={removeEncounters}
            />
          ))}
        </div>
      )}
    </main>
  )
}

// ── Delete helpers ────────────────────────────────────────────────────────────

async function deleteOne(id: number): Promise<number> {
  const r = await fetch(`/api/parses/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!r.ok) throw new Error(`Delete failed: ${r.status}`)
  const j = await r.json()
  return j.deleted ?? 0
}

// Delete an explicit set of encounter ids in one request (every upload of a
// multi-uploader fight). Server authorises each id independently.
async function deleteBatch(ids: number[]): Promise<number> {
  const url = new URL('/api/parses/batch', window.location.origin)
  url.searchParams.set('ids', ids.join(','))
  const r = await fetch(url.toString(), { method: 'DELETE', credentials: 'include' })
  if (!r.ok) throw new Error(`Delete failed: ${r.status}`)
  const j = await r.json()
  return j.deleted ?? 0
}

async function deleteByFilter(params: {
  guild: string
}): Promise<number> {
  const url = new URL('/api/parses', window.location.origin)
  url.searchParams.set('guild', params.guild)
  const r = await fetch(url.toString(), { method: 'DELETE', credentials: 'include' })
  if (!r.ok) throw new Error(`Bulk delete failed: ${r.status}`)
  const j = await r.json()
  return j.deleted ?? 0
}

// ── Guild / Category / Fight rendering ────────────────────────────────────────

interface GuildSectionProps {
  bucket: GuildBucket
  defaultExpanded: boolean
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

// One section per guild. Renders three CategorySection children (Raid /
// Dungeon / Other), each independently collapsible. Empty categories
// render nothing.
function GuildSection({ bucket, defaultExpanded, onDeleted }: GuildSectionProps) {
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

// One subsection per category under a guild. Renders nothing when there are
// no fights — guild headers stay clean.
interface CategorySectionProps {
  label: 'Raid' | 'Dungeon' | 'Other'
  buckets: ZoneDayBucket[]
  defaultOpen: boolean
  guild: string
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

function CategorySection({ label, buckets, defaultOpen, guild, onDeleted }: CategorySectionProps) {
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

interface ZoneDaySectionProps {
  bucket: ZoneDayBucket
  guild: string
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

function ZoneDaySection({ bucket, guild, onDeleted }: ZoneDaySectionProps) {
  // Default-open so a fresh load shows the most recent raid night's
  // fights without an extra click. Same component-local state pattern
  // as CategorySection — refreshing the page resets to default.
  const [open, setOpen] = useState(true)
  // Reference `guild` so the unused-var lint passes — kept on the props
  // so a future "delete this zone-day" button has the guild context it
  // would need without needing to drill through CategorySection again.
  void guild
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`${bucket.key} · ${bucket.fights.length} fight${bucket.fights.length === 1 ? '' : 's'}`}
        className="appearance-none border-0 bg-transparent p-0 flex items-baseline gap-2 cursor-pointer text-left"
      >
        <Caret open={open} />
        <span className="text-text text-[0.85rem]">{bucket.key}</span>
        <span className="text-text-muted text-[0.7rem] tabular-nums">
          · {bucket.fights.length}
        </span>
      </button>
      {open && (
        <div
          className="grid items-center gap-x-2 gap-y-0.5 text-[0.82rem] pl-4"
          style={{ gridTemplateColumns: '1fr 70px 70px 110px 90px 60px 130px 28px' }}
        >
          <div className={HDR_CELL_CLS}>Encounter</div>
          <div className={`${HDR_CELL_CLS} text-right`}>Time</div>
          <div className={`${HDR_CELL_CLS} text-right`}>Dur</div>
          <div className={`${HDR_CELL_CLS} text-right`}>Damage</div>
          <div className={`${HDR_CELL_CLS} text-right`}>DPS</div>
          <div className={`${HDR_CELL_CLS} text-right`}>Size</div>
          <div className={HDR_CELL_CLS}>Uploader</div>
          <div className={HDR_CELL_CLS} />
          {bucket.fights.map(f => (
            <FightRow
              key={f.id}
              fight={f}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FightRowProps {
  fight: ParseEncounterSummary
  onDeleted: (pred: (e: ParseEncounterSummary) => boolean) => void
}

// One row per fight inside a CategorySection's grid. For multi-uploader
// fights (uploads.length > 1) the title becomes a toggle that expands a
// nested per-uploader list; otherwise it's a direct link to the parse view.
function FightRow({ fight, onDeleted }: FightRowProps) {
  const e = fight  // top-level fields are the canonical upload's
  const isMirror = fight.uploads.length > 1
  const [expanded, setExpanded] = useState(false)

  // "Delete the whole encounter" is only offered when the caller can delete
  // every upload in the group — i.e. an admin or an officer of the fight's
  // guild. A plain uploader can only delete their own among several, so this
  // is false for them (they still get their per-upload trash in the expansion).
  const canDeleteAll = isMirror && fight.uploads.length > 0 && fight.uploads.every(u => u.permissions.can_delete)

  // ACT outcome: 1 = win (green), 2 = loss (red), 3 = mixed (gold), 0 = unknown.
  const titleColor =
    e.success_level === 1 ? 'var(--success, #4caf50)'
    : e.success_level === 2 ? 'var(--danger, #e57373)'
    : e.success_level === 3 ? 'var(--warning, #d8a657)'
    : 'var(--text)'
  // Boss rows get a subtle yellow tint so they stand out at a glance.
  // Applied per-cell because the grid cells are direct siblings — no row
  // wrapper to style.
  const rowBg = isBoss(e.title) ? 'rgba(255, 204, 102, 0.07)' : undefined
  const cellBase: CSSProperties = { padding: '4px 0', background: rowBg }

  async function handleDeletePrimary(ev: React.MouseEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    if (!confirm(`Delete encounter "${e.title}"? This cannot be undone.`)) return
    try {
      await deleteOne(e.id)
      onDeleted(other => other.id === e.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleDeleteFight(ev: React.MouseEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    const n = fight.uploads.length
    if (!confirm(`Delete this entire encounter — all ${n} uploads of "${e.title}"? This cannot be undone.`)) return
    try {
      await deleteBatch(fight.uploads.map(u => u.id))
      onDeleted(other => other.id === e.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handleDeleteUpload(upload: ParseUploadSummary, ev: React.MouseEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    if (!confirm(`Delete ${upload.uploaded_by}'s upload of "${e.title}"? This cannot be undone.`)) return
    try {
      await deleteOne(upload.id)
      onDeleted(other => other.id === upload.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  // For a non-mirror row, the title links straight to the parse and the
  // trash deletes that single encounter — same UX as before. For a mirror
  // group, the title click toggles expansion (no direct /parse navigation
  // since there are multiple options); the top-level trash deletes the whole
  // encounter (all uploads) and is shown only to those allowed to remove
  // every upload — admins and officers of the fight's guild.
  return (
    <>
      {isMirror ? (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 border-none text-left cursor-pointer py-1 no-underline"
          style={{
            ...cellBase, color: titleColor,
            background: rowBg ?? 'none', font: 'inherit',
          }}
        >
          <Caret open={expanded} />
          {e.title}
          <span className="text-[0.7rem] text-text-muted font-normal">
            {fight.uploads.length} uploads
          </span>
        </button>
      ) : (
        <Link
          to={`/parse/${e.id}`}
          className="no-underline"
          style={{ ...cellBase, color: titleColor }}
        >
          {e.title}
        </Link>
      )}
      <div className="text-right text-text-muted" style={cellBase}>{fmtLocalTime(e.started_at)}</div>
      <div className="text-right text-text-muted" style={cellBase}>{fmtDuration(e.duration_s)}</div>
      <div className="text-right" style={cellBase}>{fmtNum(e.total_damage)}</div>
      <div className="text-right text-gold" style={cellBase}>{fmtNum(Math.round(e.encdps))}</div>
      <div className="text-right" style={cellBase}>
        <Badge variant="muted">{e.player_count}p</Badge>
      </div>
      <div className="text-text-muted truncate" style={cellBase}>
        <UploaderTag
          characterName={e.uploaded_by}
          discordId={e.uploader_discord_id}
          displayName={e.uploader_display_name}
        />
        {isMirror && (
          <span className="ml-1 text-[0.7rem] text-text-muted">
            +{fight.uploads.length - 1}
          </span>
        )}
      </div>
      <div className="text-center" style={cellBase}>
        {!isMirror && e.permissions.can_delete && (
          <TrashButton onClick={handleDeletePrimary} title="Delete this encounter" small />
        )}
        {/* Mirror group: officers/admins (who can delete every upload) get a
            single button that removes the whole encounter at once. */}
        {canDeleteAll && (
          <TrashButton
            onClick={handleDeleteFight}
            title={`Delete entire encounter (all ${fight.uploads.length} uploads)`}
            small
          />
        )}
      </div>

      {isMirror && expanded && (
        <div
          className="col-[1/-1] flex flex-col gap-0.5 text-[0.78rem] pt-1 pb-2 pl-6"
          style={{ background: rowBg ?? undefined }}
        >
          <div className="text-text-muted text-[0.7rem] mb-0.5">
            Pick a raider's view:
          </div>
          {fight.uploads.map(u => (
            <div
              key={u.id}
              className="grid items-center gap-x-2"
              style={{ gridTemplateColumns: '1fr 70px 110px 90px 28px' }}
            >
              <Link
                to={`/parse/${u.id}`}
                className="text-text no-underline"
              >
                <span className="text-gold">
                  <UploaderTag
                    characterName={u.uploaded_by}
                    discordId={u.uploader_discord_id}
                    displayName={u.uploader_display_name}
                  />
                </span>
                {u.id === fight.id && (
                  <span className="ml-[0.4rem] text-[0.65rem] text-text-muted">(primary)</span>
                )}
              </Link>
              <span className="text-right text-text-muted">{fmtDuration(u.duration_s)}</span>
              <span className="text-right">{fmtNum(u.total_damage)}</span>
              <span className="text-right text-gold">{fmtNum(Math.round(u.encdps))}</span>
              <span className="text-center">
                {u.permissions.can_delete && (
                  <TrashButton onClick={ev => handleDeleteUpload(u, ev)} title={`Delete ${u.uploaded_by}'s upload`} small />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
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

// ── Style helpers ─────────────────────────────────────────────────────────────

const headerBtnCls = 'flex items-center gap-2 w-full bg-transparent border-none text-inherit cursor-pointer py-2 px-3 text-left font-inherit'

const HDR_CELL_CLS = 'text-text-muted text-[0.7rem] uppercase tracking-[0.06em] py-1 border-b border-border mb-1'
