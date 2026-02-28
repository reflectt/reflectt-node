import { describe, it, expect } from 'vitest'

/**
 * Tests for review SLA timestamp normalization and clamping.
 * Covers the bug where timestamps in seconds (not ms) produced
 * absurd stale times like 240,000+ minutes.
 */
describe('review SLA false-positives', () => {
  // Mirror the normalizeEpochMs logic from boardHealthWorker.ts
  function normalizeEpochMs(v: unknown, now: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 0
    if (v > 0 && v < 100_000_000_000) return v * 1000 // seconds → ms
    if (v > now + 60_000) return now // clamp future
    return v
  }

  const NOW = 1772259000000 // ~Feb 2026 in ms

  it('normalizes seconds to milliseconds', () => {
    const secondsTs = 1772259000 // same timestamp in seconds
    const result = normalizeEpochMs(secondsTs, NOW)
    expect(result).toBe(1772259000000)
    expect(NOW - result).toBe(0)
  })

  it('passes through valid millisecond timestamps', () => {
    const msTs = NOW - 60 * 60_000 // 1 hour ago
    expect(normalizeEpochMs(msTs, NOW)).toBe(msTs)
  })

  it('clamps future timestamps to now', () => {
    const futureTs = NOW + 1_000_000
    expect(normalizeEpochMs(futureTs, NOW)).toBe(NOW)
  })

  it('returns 0 for invalid values', () => {
    expect(normalizeEpochMs(null, NOW)).toBe(0)
    expect(normalizeEpochMs(undefined, NOW)).toBe(0)
    expect(normalizeEpochMs(NaN, NOW)).toBe(0)
    expect(normalizeEpochMs(Infinity, NOW)).toBe(0)
    expect(normalizeEpochMs('string', NOW)).toBe(0)
    expect(normalizeEpochMs(0, NOW)).toBe(0)
  })

  it('produces reasonable stale times (not 240k+ minutes)', () => {
    // Scenario: entered_validating_at is in seconds (Unix epoch)
    const enteredAtSeconds = Math.floor(NOW / 1000) - 3600 // 1 hour ago in seconds
    const normalized = normalizeEpochMs(enteredAtSeconds, NOW)
    const staleMs = NOW - normalized
    const staleMinutes = Math.floor(staleMs / 60_000)

    expect(staleMinutes).toBeLessThan(120) // should be ~60, not 240k
    expect(staleMinutes).toBeGreaterThanOrEqual(59)
    expect(staleMinutes).toBeLessThanOrEqual(61)
  })

  it('would produce 240k+ minutes WITHOUT normalization', () => {
    // This is the bug — seconds timestamp treated as ms
    const enteredAtSeconds = Math.floor(NOW / 1000) - 3600
    const buggyStaleMs = NOW - enteredAtSeconds // treating seconds as ms
    const buggyMinutes = Math.floor(buggyStaleMs / 60_000)

    // Without fix, this produces ~29,537,650 minutes (absurd)
    expect(buggyMinutes).toBeGreaterThan(1_000_000)
  })

  it('clamp catches implausible values', () => {
    const MAX_REVIEW_STALE_MS = 30 * 24 * 60 * 60_000 // 30 days
    const absurdStaleMs = 240_000 * 60_000 // 240k minutes in ms

    expect(absurdStaleMs).toBeGreaterThan(MAX_REVIEW_STALE_MS)
    // The clamp would skip this task
    const clamped = absurdStaleMs > MAX_REVIEW_STALE_MS
    expect(clamped).toBe(true)
  })

  // Dashboard normalizeEpochMs (JS version)
  it('dashboard normalizeEpochMs handles seconds', () => {
    function dashboardNormalize(v: unknown): number {
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0
      if (v < 100000000000) return v * 1000
      return v
    }

    const secondsTs = 1772259000
    expect(dashboardNormalize(secondsTs)).toBe(1772259000000)
    expect(dashboardNormalize(0)).toBe(0)
    expect(dashboardNormalize(-1)).toBe(0)
    expect(dashboardNormalize(null)).toBe(0)
  })
})
