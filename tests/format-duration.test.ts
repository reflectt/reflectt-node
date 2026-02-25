/**
 * Regression tests for ms→minutes conversion.
 *
 * Guards against the "534,690m" bug where dividing by 60 instead
 * of 60_000 inflated displayed durations by 1000×.
 */
import { describe, it, expect } from 'vitest'
import { msToMinutes, formatDuration } from '../src/format-duration.js'

describe('msToMinutes', () => {
  it('converts 0 ms to 0 minutes', () => {
    expect(msToMinutes(0)).toBe(0)
  })

  it('converts 60_000 ms to 1 minute', () => {
    expect(msToMinutes(60_000)).toBe(1)
  })

  it('converts 1 hour to 60 minutes', () => {
    expect(msToMinutes(3_600_000)).toBe(60)
  })

  it('converts 2 hours to 120 minutes', () => {
    expect(msToMinutes(7_200_000)).toBe(120)
  })

  it('rounds to nearest minute', () => {
    expect(msToMinutes(90_000)).toBe(2)   // 1.5min → 2
    expect(msToMinutes(29_999)).toBe(0)   // 0.5min → 0 (rounds to 0)
    expect(msToMinutes(30_001)).toBe(1)   // 0.5min → 1
  })

  // The exact scenario from the bug report:
  // 8.9 hours of real time should be ~534 minutes, NOT 534,690
  it('regression: 8.9 hours = ~534 minutes, not 534,690', () => {
    const eightPointNineHours = 32_081_400 // 8.9h in ms
    const result = msToMinutes(eightPointNineHours)
    expect(result).toBe(535) // 32_081_400 / 60_000 = 534.69 → rounds to 535
    expect(result).toBeLessThan(1000) // must be sane — not the buggy 534,690
  })

  it('regression: large ms values stay reasonable', () => {
    const oneDay = 24 * 60 * 60 * 1000
    expect(msToMinutes(oneDay)).toBe(1440)
    expect(msToMinutes(7 * oneDay)).toBe(10_080)
    // Even a week should be ~10K minutes, not millions
    expect(msToMinutes(7 * oneDay)).toBeLessThan(100_000)
  })
})

describe('formatDuration', () => {
  it('formats < 1h as minutes', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(59 * 60_000)).toBe('59m')
  })

  it('formats hours + minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m')
    expect(formatDuration(3_660_000)).toBe('1h 1m')
    expect(formatDuration(7_200_000)).toBe('2h 0m')
  })

  it('formats days + hours', () => {
    expect(formatDuration(24 * 3_600_000)).toBe('1d 0h')
    expect(formatDuration(25 * 3_600_000)).toBe('1d 1h')
    expect(formatDuration(48 * 3_600_000)).toBe('2d 0h')
  })

  // The 534,690 scenario: 8.9 hours should display as "8h 55m", not "534690m"
  it('regression: 8.9 hours displays correctly', () => {
    const result = formatDuration(32_081_400)
    expect(result).toBe('8h 54m') // 32_081_400ms = 534.69min = 8h 54m
    expect(result).not.toMatch(/^\d{4,}m$/) // must NOT be a huge minute-only number
  })

  it('handles negative input gracefully', () => {
    expect(formatDuration(-1000)).toBe('0m')
  })
})
