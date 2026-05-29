import { useEffect, useState } from 'react'

/**
 * Tiny 👑 badge shown inline next to a supporter's name.
 *
 * Cosmetic only — no link, no extra meaning beyond "this person donated".
 * Sized at 0.9em so it tracks whatever the surrounding text size is
 * (heading vs body) without per-context tuning.
 */
export function SupporterBadge() {
  return (
    <span
      className="ml-1 text-[0.9em] align-baseline"
      title="Supporter — thanks for backing the site!"
      aria-label="Supporter"
    >
      👑
    </span>
  )
}

// ---------------------------------------------------------------------------
// useSupporters — lightweight session-level cache of supporter Discord IDs.
// ---------------------------------------------------------------------------
//
// The list is tiny (low double digits) and changes rarely (admin grants /
// revokes). One fetch per page load is more than enough; if it changes
// mid-session the next nav will pick it up. We share a single in-flight
// fetch across all hook callers via the module-level _state so a page that
// renders the badge in twenty list rows doesn't trigger twenty network
// requests.

interface SupporterState {
  ids: Set<string>
  ready: boolean
}

let _state: SupporterState = { ids: new Set(), ready: false }
let _inflight: Promise<Set<string>> | null = null
const _subscribers = new Set<(s: SupporterState) => void>()

function _notify() {
  for (const sub of _subscribers) sub(_state)
}

async function _load(): Promise<Set<string>> {
  if (_state.ready) return _state.ids
  if (_inflight) return _inflight
  _inflight = (async () => {
    try {
      const r = await fetch('/api/supporters')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body = (await r.json()) as { supporter_ids: string[] }
      _state = { ids: new Set(body.supporter_ids), ready: true }
    } catch {
      // Failure leaves the cache empty + flagged ready=false so the next
      // mount retries. Badges just won't render until it succeeds —
      // acceptable for a purely cosmetic feature.
      _state = { ids: new Set(), ready: false }
    } finally {
      _inflight = null
      _notify()
    }
    return _state.ids
  })()
  return _inflight
}

/**
 * Hook returning the (Set of) supporter Discord IDs known to this session.
 * Triggers a single shared fetch on first use; later callers reuse the
 * cached set.
 *
 * Use with: `const supporters = useSupporters(); supporters.has(discordId)`
 */
export function useSupporters(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(_state.ids)
  useEffect(() => {
    const sub = (s: SupporterState) => setIds(s.ids)
    _subscribers.add(sub)
    void _load()
    return () => {
      _subscribers.delete(sub)
    }
  }, [])
  return ids
}

/**
 * Convenience wrapper for the very common "render name + optional badge"
 * pattern. Pass the raw display name and the user's Discord ID; the
 * component renders the name followed by the badge if the ID is in the
 * supporter set.
 *
 * The display name itself is rendered as-is — caller controls formatting.
 */
export function NameWithBadge({
  name,
  discordId,
}: {
  name: string
  discordId: string | null | undefined
}) {
  const supporters = useSupporters()
  const isSupporter = !!discordId && supporters.has(discordId)
  return (
    <>
      {name}
      {isSupporter && <SupporterBadge />}
    </>
  )
}
