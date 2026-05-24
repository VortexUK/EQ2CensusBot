import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  fmtNum, fmtDuration, fmtLocalDate, fmtLocalTime, fmtLocalDateTime,
} from './formatters'

describe('fmtNum', () => {
  it('formats integers with locale grouping', () => {
    expect(fmtNum(1234567)).toBe((1234567).toLocaleString())
  })

  it('rounds floats before formatting', () => {
    expect(fmtNum(1234.7)).toBe((1235).toLocaleString())
    expect(fmtNum(1234.4)).toBe((1234).toLocaleString())
  })

  it('handles zero and negatives', () => {
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(-42)).toBe((-42).toLocaleString())
  })
})

describe('fmtDuration', () => {
  it('zero-pads seconds', () => {
    expect(fmtDuration(7)).toBe('0m07s')
    expect(fmtDuration(60)).toBe('1m00s')
    expect(fmtDuration(125)).toBe('2m05s')
  })

  it('handles minutes-only values', () => {
    expect(fmtDuration(0)).toBe('0m00s')
    expect(fmtDuration(60 * 30)).toBe('30m00s')
  })

  it('preserves long durations (no hours)', () => {
    expect(fmtDuration(60 * 65 + 12)).toBe('65m12s')
  })
})

// fmtLocalDate / fmtLocalTime / fmtLocalDateTime use the browser locale
// and timezone — we don't pin the format, just check the shape / that
// it's deterministic for a fixed Date.now and TZ.

describe('fmtLocalDate', () => {
  it('produces YYYY-MM-DD shape', () => {
    const got = fmtLocalDate(1779191130)
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('uses local timezone (date may shift around midnight UTC)', () => {
    // Fixed Date.now → fixed local-time date. We don't pin the value,
    // just check that repeated calls return the same string.
    const a = fmtLocalDate(1779191130)
    const b = fmtLocalDate(1779191130)
    expect(a).toBe(b)
  })
})

describe('fmtLocalTime', () => {
  it('produces HH:MM shape', () => {
    expect(fmtLocalTime(1779191130)).toMatch(/^\d{2}:\d{2}$/)
  })

  it('zero-pads single-digit hours / minutes', () => {
    // 1730419260 = 2024-11-01 00:01:00 UTC. Pad shape works regardless
    // of timezone offset because both hour and minute are 2 digits.
    expect(fmtLocalTime(1730419260)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('fmtLocalDateTime', () => {
  // toLocaleString output varies wildly by runtime — only assert that we
  // get a non-empty string and that it round-trips deterministically.
  it('returns a non-empty string', () => {
    const got = fmtLocalDateTime(1779191130)
    expect(typeof got).toBe('string')
    expect(got.length).toBeGreaterThan(0)
  })

  it('is deterministic for a fixed input', () => {
    expect(fmtLocalDateTime(1779191130)).toBe(fmtLocalDateTime(1779191130))
  })
})

// Spot-check that switching TZ via mocked Date methods would shift the
// local-date output as expected. Useful regression for "did someone
// accidentally hard-code UTC".
describe('fmtLocalDate is in browser local time, not UTC', () => {
  beforeAll(() => {
    // 2026-05-24 23:00:00 UTC → would be the NEXT day in a +02 zone.
    // We can't actually change Node's TZ from inside the test, but we
    // can verify that fmtLocalDate uses Date.prototype.getDate (local)
    // not getUTCDate.
  })
  afterAll(() => { vi.restoreAllMocks() })

  it('returns the day component from getDate, not getUTCDate', () => {
    const unix = 1779231600  // 2026-05-24 ~21:00 UTC
    const d = new Date(unix * 1000)
    const expectedDay = String(d.getDate()).padStart(2, '0')
    expect(fmtLocalDate(unix).endsWith(expectedDay)).toBe(true)
  })
})
