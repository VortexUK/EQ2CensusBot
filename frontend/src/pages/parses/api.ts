/**
 * Per-fight delete API for the parses page.
 *
 * Three call sites: per-encounter delete (single non-mirror row),
 * whole-fight delete (mirror group, officers/admins), per-upload delete
 * (one raider's upload inside a mirror group's expansion).
 *
 * All three go through the same `/api/parses/...` endpoints. Auth +
 * permission checks happen server-side; the buttons that call these
 * helpers are gated client-side by ParseEncounterSummary.permissions /
 * ParseUploadSummary.permissions for UX, not enforcement.
 */

export async function deleteOne(id: number): Promise<number> {
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
export async function deleteBatch(ids: number[]): Promise<number> {
  const url = new URL('/api/parses/batch', window.location.origin)
  url.searchParams.set('ids', ids.join(','))
  const r = await fetch(url.toString(), { method: 'DELETE', credentials: 'include' })
  if (!r.ok) throw new Error(`Delete failed: ${r.status}`)
  const j = await r.json()
  return j.deleted ?? 0
}

export async function deleteByFilter(params: {
  guild: string
}): Promise<number> {
  const url = new URL('/api/parses', window.location.origin)
  url.searchParams.set('guild', params.guild)
  const r = await fetch(url.toString(), { method: 'DELETE', credentials: 'include' })
  if (!r.ok) throw new Error(`Bulk delete failed: ${r.status}`)
  const j = await r.json()
  return j.deleted ?? 0
}
