import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatDuration, msToMinutes } from '../src/format-duration.js'

/**
 * Regression tests for review SLA alert duration formatting.
 *
 * Root cause (fixed): executionSweeper used a local `formatReviewDuration(ageMinutes)`
 * that had a broken "sanity check" dividing by 1000 when values were > 10080.
 * Meanwhile, `ageMinutes` was already correctly computed via `msToMinutes(ageSinceActivity)`.
 * The mismatch produced "500k–1M minutes" in alerts.
 *
 * Fix: removed `formatReviewDuration()` entirely; alert messages now call
 * `formatDuration(ageSinceActivity)` (ms input) from format-duration.ts.
 */

describe('review SLA duration formatting (regression)', () => {
  it('formatDuration handles the 534,690-minute bug scenario correctly', () => {
    // Original bug: 32,081,400 ms was somehow displayed as "534,690m"
    // because ms was divided by 60 instead of 60,000.
    // formatDuration takes ms and correctly outputs human-readable:
    const result = formatDuration(32_081_400) // ~8h 54m
    expect(result).toBe('8h 54m')
    expect(result).not.toContain('534690')
  })

  it('msToMinutes correctly converts ms to minutes', () => {
    expect(msToMinutes(60_000)).toBe(1)
    expect(msToMinutes(3_600_000)).toBe(60)
    expect(msToMinutes(32_081_400)).toBe(535) // 534.69 → rounded to 535
  })

  it('formatDuration shows sane output for typical SLA breach ages', () => {
    // 2h SLA breach (just over threshold)
    expect(formatDuration(2 * 60 * 60 * 1000 + 300_000)).toBe('2h 5m')
    // 4h breach
    expect(formatDuration(4 * 60 * 60 * 1000)).toBe('4h 0m')
    // 12h breach (auto-reassign threshold)
    expect(formatDuration(12 * 60 * 60 * 1000)).toBe('12h 0m')
    // 24h breach
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe('1d 0h')
    // 3d breach
    expect(formatDuration(3 * 24 * 60 * 60 * 1000)).toBe('3d 0h')
  })

  it('formatDuration handles zero and small values', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(30_000)).toBe('0m') // 30s rounds down
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(90_000)).toBe('1m') // 1.5m floors to 1m
  })

  it('formatDuration handles negative values gracefully', () => {
    expect(formatDuration(-1000)).toBe('0m')
  })

  it('sweeper alert message would show sane duration for realistic ages', () => {
    // Simulate what the sweeper does:
    // const ageSinceActivity = now - lastActivity (in ms)
    // message includes formatDuration(ageSinceActivity)
    const ageSinceActivity = 2.5 * 60 * 60 * 1000 // 2h 30m
    const ageMinutes = msToMinutes(ageSinceActivity)
    const formatted = formatDuration(ageSinceActivity)

    expect(ageMinutes).toBe(150) // 150 minutes
    expect(formatted).toBe('2h 30m')

    // Verify alert message renders correctly
    const message = `⚠️ SLA breach: "Test task" (task-123) in validating ${formatted}. @reviewer — review needed.`
    expect(message).toContain('2h 30m')
    expect(message).not.toMatch(/\d{4,}m/) // no absurd minute counts
  })
})
