/**
 * Shared types for the raid-zone pages.
 *
 * Both ``RaidZonesPage.tsx`` (the index/grid) and ``RaidZonePage.tsx``
 * (per-zone detail) consume the ``GET /api/zones`` shape and previously
 * defined identical ``EncounterMob`` / ``Encounter`` / ``Zone`` interfaces
 * inline — flagged by the user after the 2026-05-29 frontend cleanliness
 * audit missed it.
 *
 * Per the audit's file-split convention (see ``CLAUDE.md`` →
 * "File-split conventions"), shared types for a page family live in a
 * sibling ``types.ts``.  This is the home for them.
 */

export interface EncounterMob {
  id: number
  mob_name: string
  position: number
}

export interface Encounter {
  id: number
  encounter_name: string
  position: number
  stage: string | null
  wiki_url: string | null
  mobs: EncounterMob[]
}

export interface Zone {
  name: string
  expansion_short: string
  expansion_name: string
  expansion_year: number | null
  types: string[]
  aliases: string[]
  wiki_url: string | null
  is_contested: boolean
  is_instance: boolean
  is_openworld: boolean
  bosses: Encounter[]
}

export interface ZoneListResponse {
  expansion: string | null
  type: string | null
  zones: Zone[]
}
