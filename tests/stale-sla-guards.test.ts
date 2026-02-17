// Tests for stale SLA alert guards: timestamp validation + task existence checks
import { describe, it, expect } from 'vitest'
import { validateTaskTimestamp, verifyTaskExists } from '../src/health.js'

const NOW = 1771362882812 // ~Feb 2026

describe('validateTaskTimestamp', () => {
  it('returns valid timestamp within bounds', () => {
    const oneHourAgo = NOW - 60 * 60 * 1000
    expect(validateTaskTimestamp(oneHourAgo, NOW)).toBe(oneHourAgo)
  })

  it('returns valid timestamp for recent activity', () => {
    const fiveMinAgo = NOW - 5 * 60 * 1000
    expect(validateTaskTimestamp(fiveMinAgo, NOW)).toBe(fiveMinAgo)
  })

  it('rejects 0', () => {
    expect(validateTaskTimestamp(0, NOW)).toBeNull()
  })

  it('rejects negative', () => {
    expect(validateTaskTimestamp(-1000, NOW)).toBeNull()
  })

  it('rejects NaN', () => {
    expect(validateTaskTimestamp(NaN, NOW)).toBeNull()
  })

  it('rejects undefined/null', () => {
    expect(validateTaskTimestamp(undefined, NOW)).toBeNull()
    expect(validateTaskTimestamp(null, NOW)).toBeNull()
  })

  it('rejects future timestamps (>1h ahead)', () => {
    const twoHoursAhead = NOW + 2 * 60 * 60 * 1000
    expect(validateTaskTimestamp(twoHoursAhead, NOW)).toBeNull()
  })

  it('allows near-future timestamps (<1h ahead)', () => {
    const thirtyMinAhead = NOW + 30 * 60 * 1000
    expect(validateTaskTimestamp(thirtyMinAhead, NOW)).toBe(thirtyMinAhead)
  })

  it('rejects impossibly old timestamps (>1 year)', () => {
    const twoYearsAgo = NOW - 2 * 365 * 24 * 60 * 60 * 1000
    expect(validateTaskTimestamp(twoYearsAgo, NOW)).toBeNull()
  })

  it('allows timestamps up to ~1 year old', () => {
    const elevenMonthsAgo = NOW - 330 * 24 * 60 * 60 * 1000
    expect(validateTaskTimestamp(elevenMonthsAgo, NOW)).toBe(elevenMonthsAgo)
  })

  it('rejects empty string', () => {
    expect(validateTaskTimestamp('', NOW)).toBeNull()
  })

  it('handles string numbers', () => {
    const oneHourAgo = NOW - 60 * 60 * 1000
    expect(validateTaskTimestamp(String(oneHourAgo), NOW)).toBe(oneHourAgo)
  })
})

describe('verifyTaskExists', () => {
  it('returns null for nonexistent task ID', () => {
    expect(verifyTaskExists('nonexistent-task-id-12345')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(verifyTaskExists('')).toBeNull()
  })
})
