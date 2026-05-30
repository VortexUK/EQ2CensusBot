/**
 * ParsesPage render-state tests — guild ordering, category hierarchy,
 * default open/closed state, sizeLabel replacement.
 *
 * Mocks /api/parses via global fetch so we don't need the backend running.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import ParsesPage from './ParsesPage'

interface MockFight {
  id: number
  act_encid?: string
  title: string
  zone: string | null
  started_at: number
  ended_at?: number
  duration_s?: number
  total_damage?: number
  encdps?: number
  kills?: number
  deaths?: number
  success_level?: number
  combatant_count?: number
  player_count: number
  category: 'raid' | 'dungeon' | 'other'
  uploaded_by?: string
  uploader_discord_id?: string | null
  uploader_display_name?: string | null
  guild_name: string | null
  permissions?: { can_delete: boolean }
  uploads?: unknown[]
}

const _DEFAULTS = {
  act_encid: 'x',
  ended_at: 0,
  duration_s: 60,
  total_damage: 1000,
  encdps: 100,
  kills: 1,
  deaths: 0,
  success_level: 1,
  combatant_count: 5,
  uploaded_by: 'tester',
  uploader_discord_id: null,
  uploader_display_name: null,
  permissions: { can_delete: false },
  uploads: [],
}

function fight(overrides: Partial<MockFight> & Pick<MockFight, 'id' | 'title' | 'category' | 'guild_name' | 'started_at' | 'zone' | 'player_count'>): MockFight {
  return { ..._DEFAULTS, ...overrides } as MockFight
}

function mockFetch(results: MockFight[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results, total: results.length }),
    })) as unknown as typeof fetch,
  )
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ParsesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})


describe('ParsesPage grouping', () => {
  it('renders guilds in fight-count-desc order', async () => {
    mockFetch([
      fight({ id: 1, title: 'A', category: 'raid', guild_name: 'Guild Two', started_at: 100, zone: 'Z', player_count: 12 }),
      fight({ id: 2, title: 'B', category: 'raid', guild_name: 'Guild One', started_at: 110, zone: 'Z', player_count: 12 }),
      fight({ id: 3, title: 'C', category: 'raid', guild_name: 'Guild One', started_at: 120, zone: 'Z', player_count: 12 }),
    ])
    renderPage()
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map(h => h.textContent)).toEqual(['Guild One', 'Guild Two'])
  })

  it('renders (no guild) section last', async () => {
    mockFetch([
      fight({ id: 1, title: 'A', category: 'raid', guild_name: null, started_at: 100, zone: 'Z', player_count: 12 }),
      fight({ id: 2, title: 'B', category: 'raid', guild_name: null, started_at: 110, zone: 'Z', player_count: 12 }),
      fight({ id: 3, title: 'C', category: 'raid', guild_name: null, started_at: 120, zone: 'Z', player_count: 12 }),
      fight({ id: 4, title: 'D', category: 'raid', guild_name: 'Exordium', started_at: 130, zone: 'Z', player_count: 12 }),
    ])
    renderPage()
    const headings = await screen.findAllByRole('heading', { level: 2 })
    expect(headings.map(h => h.textContent)).toEqual(['Exordium', 'No Guild'])
  })

  it('opens Raid + Dungeon by default; collapses Other', async () => {
    mockFetch([
      fight({ id: 1, title: 'RaidFight', category: 'raid', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 12 }),
      fight({ id: 2, title: 'DungeonFight', category: 'dungeon', guild_name: 'Guild', started_at: 110, zone: 'Z', player_count: 5 }),
      fight({ id: 3, title: 'OtherFight', category: 'other', guild_name: 'Guild', started_at: 120, zone: 'Z', player_count: 1 }),
    ])
    renderPage()
    // Raid + Dungeon fight titles visible immediately.
    expect(await screen.findByText('RaidFight')).toBeInTheDocument()
    expect(screen.getByText('DungeonFight')).toBeInTheDocument()
    // Other fight title hidden behind the collapsed Other subsection.
    expect(screen.queryByText('OtherFight')).not.toBeInTheDocument()
  })

  it('clicking Other reveals its fights', async () => {
    mockFetch([
      fight({ id: 1, title: 'OtherFight', category: 'other', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 1 }),
    ])
    renderPage()
    const otherToggle = await screen.findByRole('button', { name: /^Other ·/ })
    await userEvent.click(otherToggle)
    expect(await screen.findByText('OtherFight')).toBeInTheDocument()
  })

  it('renders empty category subsections as nothing', async () => {
    mockFetch([
      fight({ id: 1, title: 'RaidFight', category: 'raid', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 12 }),
    ])
    renderPage()
    // Dungeon + Other should not render at all because the guild has no
    // fights in those buckets. Only the Raid section header is present.
    const dungeonHeaders = screen.queryAllByRole('button', { name: /^Dungeon ·/ })
    expect(dungeonHeaders).toEqual([])
    const otherHeaders = screen.queryAllByRole('button', { name: /^Other ·/ })
    expect(otherHeaders).toEqual([])
  })

  it('per-row badge shows {Np}, not the old sizeLabel', async () => {
    mockFetch([
      fight({ id: 1, title: 'RaidFight', category: 'raid', guild_name: 'Guild', started_at: 100, zone: 'Z', player_count: 24 }),
      fight({ id: 2, title: 'GroupFight', category: 'dungeon', guild_name: 'Guild', started_at: 110, zone: 'Z', player_count: 6 }),
      fight({ id: 3, title: 'SoloFight', category: 'other', guild_name: 'Guild', started_at: 120, zone: 'Z', player_count: 1 }),
    ])
    renderPage()
    // Other is collapsed by default — expand to reach SoloFight first.
    const otherToggle = await screen.findByRole('button', { name: /^Other ·/ })
    await userEvent.click(otherToggle)

    expect(screen.getByText('24p')).toBeInTheDocument()
    expect(screen.getByText('6p')).toBeInTheDocument()
    expect(screen.getByText('1p')).toBeInTheDocument()
    // Old sizeLabel strings rendered inline next to the player count as
    // e.g. "24 (Raid (24))" / "6 (Group)" / "1 (Individual)" — those exact
    // parenthesised forms must NOT appear in any row. The filter pills at
    // the top still say "Raid (24)" / "Group" without surrounding parens,
    // so we test the unique parenthesised form to avoid false positives.
    expect(screen.queryByText(/\(Raid \(24\)\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\(Group\)/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\(Individual\)/)).not.toBeInTheDocument()
    // Uploader column should also surface the canonical uploader's
    // character name (the test fixtures use `uploaded_by: 'tester'`).
    const uploaderHits = screen.queryAllByText('tester')
    expect(uploaderHits.length).toBeGreaterThan(0)
  })

  it('groups fights by zone-day under each category', async () => {
    const may30 = new Date('2026-05-30T20:00:00Z').getTime() / 1000
    const may23 = new Date('2026-05-23T20:00:00Z').getTime() / 1000
    mockFetch([
      fight({ id: 1, title: 'A', category: 'raid', guild_name: 'Guild', started_at: may30, zone: 'Castle Mistmoore', player_count: 24 }),
      fight({ id: 2, title: 'B', category: 'raid', guild_name: 'Guild', started_at: may30 + 100, zone: 'Castle Mistmoore', player_count: 24 }),
      fight({ id: 3, title: 'C', category: 'raid', guild_name: 'Guild', started_at: may23, zone: 'Castle Mistmoore', player_count: 24 }),
    ])
    renderPage()
    // Two zone-day headings should be present under Raid; both default-open.
    // Heading text format is "YYYY-MM-DD · ZoneName"; the date string depends
    // on the host's local timezone, so just match on the zone name.
    const headings = await screen.findAllByText(/Castle Mistmoore/)
    expect(headings.length).toBeGreaterThanOrEqual(2)
    // All three fight titles visible (zone-day defaults to open).
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('zone-day section is collapsible', async () => {
    mockFetch([
      fight({ id: 1, title: 'RaidFight', category: 'raid', guild_name: 'Guild', started_at: 100, zone: 'Castle Mistmoore', player_count: 12 }),
    ])
    renderPage()
    expect(await screen.findByText('RaidFight')).toBeInTheDocument()
    // The zone-day heading is a button — find it by its aria-label which
    // contains the bucket key plus the fight count.
    const zoneDayToggle = screen.getByRole('button', { name: /Castle Mistmoore/ })
    await userEvent.click(zoneDayToggle)
    expect(screen.queryByText('RaidFight')).not.toBeInTheDocument()
    await userEvent.click(zoneDayToggle)
    expect(screen.getByText('RaidFight')).toBeInTheDocument()
  })
})
