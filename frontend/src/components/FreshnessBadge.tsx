import { useCensusStream } from '../hooks/useCensusStream'

/**
 * Unobtrusive inline badge shown when a page is serving stale cached data.
 * Indicates whether Census is actively refreshing or unavailable.
 */
export function FreshnessBadge({ stale }: { stale: boolean | undefined }) {
  const { health } = useCensusStream()
  if (!stale) return null
  const down = health === 'down'
  return (
    <span className="text-[0.72rem] text-text-muted italic">
      {down ? 'Census unavailable — showing stored data' : 'Updating from Census…'}
    </span>
  )
}
