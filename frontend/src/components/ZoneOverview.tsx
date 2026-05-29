import { useEffect, useState } from 'react'
import { useFetch } from '../hooks/useFetch'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { fmtRelative } from '../formatters'
import { useAuth, isContributor } from '../hooks/useAuth'
import { SupporterBadge, useSupporters } from './SupporterBadge'
import { Button, Card, SectionLabel } from './ui'
import { Textarea } from './ui/Textarea'
import { toErrorMessage } from '../lib/errors'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ZoneOverviewResponse {
  zone_name: string
  markdown: string
  last_edited_at: number | null
  last_edited_by: string | null
  last_edited_by_name?: string | null
  source: string
}

interface RevisionEntry {
  id: number
  edited_at: number
  edited_by: string
  edited_by_name?: string | null
  before_md: string | null
  after_md: string
  edit_note: string | null
}

interface RevisionListResponse {
  zone_name: string
  revisions: RevisionEntry[]
}

interface Props {
  zoneName: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtEditor(name: string | null | undefined, raw: string): string {
  if (raw === 'eq2i_scrape') return 'EQ2i Wiki Scrape'
  if (raw === 'unknown') return 'Unknown'
  return name && name.trim() ? name : raw
}

// JSX wrapper around fmtEditor that also renders the 👑 SupporterBadge
// when the editor's Discord ID is in the supporter set. Synthetic editor
// IDs (eq2i_scrape, unknown) are skipped — they're not real Discord
// identities so the badge would be meaningless.
function EditorName({ name, raw }: { name: string | null | undefined; raw: string }) {
  const supporters = useSupporters()
  const isSynthetic = raw === 'eq2i_scrape' || raw === 'unknown'
  const isSupporter = !isSynthetic && supporters.has(raw)
  return (
    <>
      {fmtEditor(name, raw)}
      {isSupporter && <SupporterBadge />}
    </>
  )
}

// ── Markdown styling ──────────────────────────────────────────────────────────
//
// Same overrides as EncounterStrategy — Tailwind Preflight isn't imported, so
// heading/list/table tags need explicit styling. Kept inline here so the
// overview's typography matches the encounter strategy view without an extra
// shared component (that's a future refactor if/when a third surface needs it).

const MARKDOWN_COMPONENTS: Components = {
  h1: props => <h1 className="font-heading text-gold-bright text-[1.25rem] mt-4 mb-2" {...props} />,
  h2: props => <h2 className="font-heading text-gold-bright text-[1.1rem] mt-3 mb-2" {...props} />,
  h3: props => <h3 className="font-heading text-gold text-[1rem] mt-3 mb-1" {...props} />,
  p:  props => <p className="mb-2 leading-relaxed" {...props} />,
  ul: props => <ul className="list-disc pl-5 mb-2 space-y-1" {...props} />,
  ol: props => <ol className="list-decimal pl-5 mb-2 space-y-1" {...props} />,
  li: props => <li className="leading-relaxed" {...props} />,
  a:  props => (
    <a
      className="text-gold underline decoration-dotted underline-offset-2 hover:text-gold-bright"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  code: ({ className, children, ...rest }) => {
    const isInline = !className
    return isInline ? (
      <code className="bg-surface-raised/70 border border-border rounded-sm px-1 text-[0.85em]" {...rest}>
        {children}
      </code>
    ) : (
      <code className={className} {...rest}>{children}</code>
    )
  },
  pre: props => (
    <pre className="bg-bg/60 border border-border rounded-md p-3 overflow-x-auto text-[0.85em] mb-2" {...props} />
  ),
  blockquote: props => (
    <blockquote className="border-l-2 border-gold-dim pl-3 text-text-muted italic mb-2" {...props} />
  ),
  hr: () => <hr className="border-border my-3" />,
  table: props => <table className="w-full border-collapse mb-2 text-sm" {...props} />,
  th: props => <th className="text-left border border-border px-2 py-1 bg-surface-raised/50" {...props} />,
  td: props => <td className="border border-border px-2 py-1" {...props} />,
  strong: props => <strong className="text-text font-semibold" {...props} />,
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ZoneOverview({ zoneName }: Props) {
  const auth = useAuth()
  // Edit affordance is shown for admins AND DB-granted contributors. Officers
  // also pass the backend gate but aren't surfaced here (dynamic check; would
  // need a Census round-trip on every page load — see useAuth's static_roles
  // doc-comment for the trade-off).
  const canEdit = isContributor(auth)

  const {
    data: fetchedData,
    loading,
    error: fetchError,
    statusCode,
  } = useFetch<ZoneOverviewResponse>(`/api/zones/${encodeURIComponent(zoneName)}/overview`)

  // 404 = "no overview yet" — expected state, not a real error.
  // Suppress the error so non-editors see nothing and editors see the placeholder.
  const data = statusCode === 404 ? null : fetchedData
  const error = statusCode === 404 ? null : fetchError

  // Local override after a successful save so the UI updates instantly.
  const [savedData, setSavedData] = useState<ZoneOverviewResponse | null | undefined>(undefined)
  const effectiveData = savedData !== undefined ? savedData : data

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // History disclosure state. Lazy-loaded — we don't fetch revisions until the
  // user actually opens the disclosure, since most viewers never will.
  const [revisions, setRevisions] = useState<RevisionEntry[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  // Reset editing state when the zone changes (url change → new fetch).
  useEffect(() => {
    setEditing(false)
    setDraft('')
    setSavedData(undefined)
    setRevisions(null)
    setHistoryOpen(false)
    setHistoryError(null)
    setSaveError(null)
  }, [zoneName])

  async function toggleHistory() {
    // Close-on-second-click. Cached after first fetch unless invalidated (a
    // successful save below clears `revisions` so the next open re-fetches).
    if (historyOpen) {
      setHistoryOpen(false)
      return
    }
    setHistoryOpen(true)
    if (revisions !== null) return  // already loaded

    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const r = await fetch(
        `/api/zones/${encodeURIComponent(zoneName)}/overview/revisions`,
        { credentials: 'include' }
      )
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const j = (await r.json()) as RevisionListResponse
      setRevisions(j.revisions)
    } catch (err) {
      setHistoryError(toErrorMessage(err))
    } finally {
      setHistoryLoading(false)
    }
  }

  function startEdit() {
    setDraft(effectiveData?.markdown ?? '')
    setPreview(false)
    setEditing(true)
    setSaveError(null)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft('')
    setSaveError(null)
  }

  async function save() {
    if (!draft.trim()) {
      setSaveError('Overview body is empty.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const r = await fetch(`/api/zones/${encodeURIComponent(zoneName)}/overview`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: draft }),
      })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const fresh = (await r.json()) as ZoneOverviewResponse
      setSavedData(fresh)
      setEditing(false)
      setDraft('')
      // The save just appended a new revision row server-side; drop the cache
      // so the next history-open fetches fresh.
      setRevisions(null)
    } catch (err) {
      setSaveError(toErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  // Hide the whole card when there's nothing to show and the viewer can't
  // create one — keeps the zone page free of empty scaffolding for ordinary
  // users while still surfacing the editor entry point for admins.
  if (!loading && !effectiveData && !canEdit && !editing) return null

  return (
    <Card className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
        <SectionLabel>Zone overview</SectionLabel>
        {canEdit && !editing && (
          <Button size="sm" variant="secondary" onClick={startEdit}>
            {effectiveData ? 'Edit' : 'Write overview'}
          </Button>
        )}
      </header>

      {loading && <p className="text-text-muted text-sm">Loading…</p>}

      {!loading && !editing && effectiveData && (
        <>
          <div className="text-text text-[0.95rem]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {effectiveData.markdown}
            </ReactMarkdown>
          </div>
          <div className="flex items-baseline justify-between flex-wrap gap-2 mt-2 text-[0.72rem]">
            {effectiveData.last_edited_at ? (
              <p className="text-text-muted">
                Edited {fmtRelative(effectiveData.last_edited_at)}
                {effectiveData.last_edited_by ? (
                  <>
                    {' · '}
                    <EditorName name={effectiveData.last_edited_by_name} raw={effectiveData.last_edited_by} />
                  </>
                ) : ''}
              </p>
            ) : <span />}
            <button
              type="button"
              onClick={toggleHistory}
              className="text-gold-dim hover:text-gold underline decoration-dotted underline-offset-2"
              aria-expanded={historyOpen}
            >
              {historyOpen ? 'Hide history' : 'Show history'}
            </button>
          </div>
          {historyOpen && (
            <RevisionsPanel
              revisions={revisions}
              loading={historyLoading}
              error={historyError}
            />
          )}
        </>
      )}

      {!loading && !editing && !effectiveData && canEdit && (
        <p className="text-text-muted text-sm leading-relaxed">
          No zone-level overview written yet. Click <em>Write overview</em> to add
          tactics that apply across the whole raid (raid composition, cure
          assignments, pull order, etc).
        </p>
      )}

      {editing && (
        <Editor
          draft={draft}
          onDraft={setDraft}
          preview={preview}
          onPreview={setPreview}
          saving={saving}
          error={saveError}
          onSave={save}
          onCancel={cancelEdit}
        />
      )}

      {!editing && error && (
        <p className="text-danger text-sm">Couldn't load overview: {error}</p>
      )}
    </Card>
  )
}

// ── Editor subcomponent ───────────────────────────────────────────────────────
// Same shape as EncounterStrategy's editor. Inline-duplicated rather than
// shared because the two markdown surfaces are likely to diverge (the zone
// overview probably won't grow revision history or per-section editing).

interface EditorProps {
  draft: string
  onDraft: (s: string) => void
  preview: boolean
  onPreview: (b: boolean) => void
  saving: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
}

function Editor({ draft, onDraft, preview, onPreview, saving, error, onSave, onCancel }: EditorProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-[0.78rem]">
        <button
          type="button"
          onClick={() => onPreview(false)}
          className={
            'px-2 py-1 rounded-sm border ' +
            (!preview ? 'bg-surface-raised border-gold/40 text-gold-bright' : 'border-border text-text-muted hover:text-text')
          }
        >
          Write
        </button>
        <button
          type="button"
          onClick={() => onPreview(true)}
          className={
            'px-2 py-1 rounded-sm border ' +
            (preview ? 'bg-surface-raised border-gold/40 text-gold-bright' : 'border-border text-text-muted hover:text-text')
          }
        >
          Preview
        </button>
        <span className="ml-auto text-text-muted text-[0.72rem]">Markdown · GFM tables supported</span>
      </div>

      {!preview ? (
        <Textarea
          mono
          value={draft}
          onChange={e => onDraft(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={'Composition, pull order, cure assignments, key items, etc.'}
        />
      ) : (
        <div className="border border-border rounded-md p-3 min-h-[12rem] text-text text-[0.95rem]">
          {draft.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
              {draft}
            </ReactMarkdown>
          ) : (
            <p className="text-text-muted italic">Nothing to preview yet.</p>
          )}
        </div>
      )}

      {error && <p className="text-danger text-sm">{error}</p>}

      <div className="flex items-center gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={onSave} disabled={saving || !draft.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

// ── Revisions panel ───────────────────────────────────────────────────────────

interface RevisionsPanelProps {
  revisions: RevisionEntry[] | null
  loading: boolean
  error: string | null
}

function RevisionsPanel({ revisions, loading, error }: RevisionsPanelProps) {
  if (loading) return <p className="text-text-muted text-sm mt-2">Loading history…</p>
  if (error) return <p className="text-danger text-sm mt-2">Couldn't load history: {error}</p>
  if (revisions === null) return null
  if (revisions.length === 0) {
    return <p className="text-text-muted text-sm mt-2">No history yet for this overview.</p>
  }
  return (
    <ol className="mt-3 border border-border rounded-md divide-y divide-border/60 overflow-hidden">
      {revisions.map((rev, i) => (
        <RevisionRow key={rev.id} revision={rev} isCurrent={i === 0} />
      ))}
    </ol>
  )
}

interface RevisionRowProps {
  revision: RevisionEntry
  /** True for index 0 — newest revision == what's currently rendered above. */
  isCurrent: boolean
}

function RevisionRow({ revision, isCurrent }: RevisionRowProps) {
  // Per-row open state — multiple revisions can be expanded at once so a user
  // can compare two manually without losing context.
  const [open, setOpen] = useState(false)
  const absoluteTime = new Date(revision.edited_at * 1000).toLocaleString()
  return (
    <li className="bg-surface-raised/30">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-baseline gap-3 px-3 py-2 text-left hover:bg-surface-raised/60"
        aria-expanded={open}
      >
        <span className="text-[0.72rem] text-gold-dim w-4 shrink-0">
          {open ? '▾' : '▸'}
        </span>
        <span className="flex-1 min-w-0 text-[0.85rem] text-text" title={absoluteTime}>
          {fmtRelative(revision.edited_at)}
          {isCurrent && <span className="ml-2 text-success text-[0.7rem] uppercase tracking-[0.08em]">current</span>}
          {revision.edit_note && (
            <span className="text-text-muted"> · {revision.edit_note}</span>
          )}
        </span>
        <span className="text-text-muted text-[0.72rem] shrink-0">
          <EditorName name={revision.edited_by_name} raw={revision.edited_by} />
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-border/60 bg-bg/40 text-text text-[0.92rem]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
            {revision.after_md}
          </ReactMarkdown>
        </div>
      )}
    </li>
  )
}
