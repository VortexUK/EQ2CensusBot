import { useState } from 'react'
import { Button } from '../ui'
import { inputCls } from './primitives'

// ── XML paste-import ──────────────────────────────────────────────────────────

interface ActImportPanelProps {
  base: string
  onCancel: () => void
  onImported: () => Promise<void>
}

interface ImportResult {
  triggers_added: number
  triggers_skipped_existing: number
  spell_timers_added: number
}

/**
 * Paste-import form. Accepts ACT's shareable short form
 * (`<Trigger R="..." SD="..." ST="3" CR="F" C="..." T="T" TN="..." Ta="F" />`)
 * — what you get from right-click → Copy as Shareable XML — and also the
 * verbose form ACT exports to `spell_timers.xml`. Multiple `<Trigger>` /
 * `<Spell>` siblings in one paste are fine.
 */
export function ActImportPanel({ base, onCancel, onImported }: ActImportPanelProps) {
  const [xml, setXml] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function submit() {
    if (!xml.trim()) {
      setError('Paste a trigger XML snippet first.')
      return
    }
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const r = await fetch(`${base}/triggers/import-xml`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml }),
      })
      if (!r.ok) {
        // Try to surface the server's error detail (e.g. "Invalid XML: ...").
        let detail = `${r.status} ${r.statusText}`
        try {
          const body = await r.json()
          if (body?.detail) detail = body.detail
        } catch {
          // non-JSON response, keep status line
        }
        throw new Error(detail)
      }
      const data = (await r.json()) as ImportResult
      setResult(data)
      // Auto-close on a clean import; keep open on a "0 added, all duped"
      // case so the user sees the result.
      if (data.triggers_added > 0 || data.spell_timers_added > 0) {
        await onImported()
      }
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="px-4 py-3 bg-bg/40 border border-border rounded-md mb-2">
      <h4 className="font-heading text-gold text-[1rem] mb-1">Import trigger from XML</h4>
      <p className="text-text-muted text-[0.78rem] leading-relaxed mb-2">
        Paste the snippet from ACT's right-click → <em>Copy as Shareable XML</em>.
        You can paste one trigger, several at once, or a trigger plus its
        matching <code className="font-mono">&lt;Spell&gt;</code> timer.
      </p>

      <textarea
        value={xml}
        onChange={e => setXml(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={'<Trigger R="..." SD="..." ST="3" CR="F" C="..." T="T" TN="..." Ta="F" />'}
        className={inputCls + ' font-mono text-[0.82rem] resize-y'}
      />

      {error && <p className="text-danger text-sm mt-2">{error}</p>}
      {result && !error && (
        <p className="text-success text-sm mt-2">
          Imported {result.triggers_added} trigger{result.triggers_added === 1 ? '' : 's'}
          {result.spell_timers_added > 0 && (
            <> + {result.spell_timers_added} spell timer{result.spell_timers_added === 1 ? '' : 's'}</>
          )}
          {result.triggers_skipped_existing > 0 && (
            <span className="text-text-muted"> · {result.triggers_skipped_existing} duplicate{result.triggers_skipped_existing === 1 ? '' : 's'} skipped</span>
          )}
        </p>
      )}

      <div className="flex items-center gap-2 justify-end mt-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={importing}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={submit} disabled={importing || !xml.trim()}>
          {importing ? 'Importing…' : 'Import'}
        </Button>
      </div>
    </div>
  )
}
