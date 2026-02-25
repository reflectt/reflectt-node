import { describe, it, expect } from 'vitest'
import { formatReviewDuration } from '../src/executionSweeper.js'

describe('formatReviewDuration', () => {
  it('formats minutes correctly', () => {
    expect(formatReviewDuration(5)).toBe('5m')
    expect(formatReviewDuration(30)).toBe('30m')
    expect(formatReviewDuration(59)).toBe('59m')
  })

  it('formats hours correctly', () => {
    expect(formatReviewDuration(60)).toBe('1h')
    expect(formatReviewDuration(90)).toBe('1h30m')
    expect(formatReviewDuration(120)).toBe('2h')
    expect(formatReviewDuration(150)).toBe('2h30m')
    expect(formatReviewDuration(480)).toBe('8h')
    expect(formatReviewDuration(534)).toBe('8h54m')
  })

  it('formats days correctly', () => {
    expect(formatReviewDuration(1440)).toBe('1d')
    expect(formatReviewDuration(1500)).toBe('1d1h')
    expect(formatReviewDuration(2880)).toBe('2d')
  })

  it('catches ms-as-minutes conversion bug (the 534,690m case)', () => {
    // The original bug: 32,081,400ms / 60 = 534,690 (wrong — should be / 60000 = 534.69m)
    // formatReviewDuration detects values > 10080 (1 week in minutes) and applies correction
    const result = formatReviewDuration(534_690)
    // Should NOT show "534690m" — should auto-correct to something sane
    expect(result).not.toContain('534690')
    // After correction: 534690 / 1000 = 534.69 → ~534m = ~8h54m
    expect(result).toBe('8h55m')
  })

  it('handles real large values correctly (multi-day review)', () => {
    // 3 days = 4320 minutes — this is plausible, should not be "corrected"
    expect(formatReviewDuration(4320)).toBe('3d')
    // 1 week = 10080 — still plausible
    expect(formatReviewDuration(10080)).toBe('7d')
  })

  it('handles zero and edge cases', () => {
    expect(formatReviewDuration(0)).toBe('0m')
    expect(formatReviewDuration(1)).toBe('1m')
  })
})
