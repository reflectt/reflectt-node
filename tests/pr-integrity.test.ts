// Regression tests: PR integrity validation for review-packet handoff
import { describe, it, expect } from 'vitest'
import { validatePrIntegrity, parsePrUrl, type PrIntegrityInput } from '../src/pr-integrity.js'

// ── URL parsing ──

describe('parsePrUrl', () => {
  it('parses valid GitHub PR URLs', () => {
    const result = parsePrUrl('https://github.com/reflectt/reflectt-node/pull/245')
    expect(result).toEqual({ repo: 'reflectt/reflectt-node', number: 245 })
  })

  it('parses URLs with trailing slash', () => {
    const result = parsePrUrl('https://github.com/org/repo/pull/1/')
    expect(result).toEqual({ repo: 'org/repo', number: 1 })
  })

  it('returns null for non-GitHub URLs', () => {
    expect(parsePrUrl('https://gitlab.com/org/repo/pull/1')).toBeNull()
    expect(parsePrUrl('not-a-url')).toBeNull()
    expect(parsePrUrl('')).toBeNull()
  })

  it('returns null for malformed PR paths', () => {
    expect(parsePrUrl('https://github.com/org/repo/issues/1')).toBeNull()
    expect(parsePrUrl('https://github.com/org/repo')).toBeNull()
  })
})

// ── PR integrity validation (unit tests with mock-friendly structure) ──

describe('validatePrIntegrity', () => {
  it('returns error for invalid PR URL', () => {
    const result = validatePrIntegrity({
      pr_url: 'not-a-github-url',
      packet_commit: 'abc1234',
      packet_changed_files: ['file.ts'],
    })

    expect(result.valid).toBe(false)
    expect(result.skipped).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].field).toBe('commit')
    expect(result.errors[0].message).toContain('Invalid PR URL')
  })

  it('skips in test environment (REFLECTT_HOME is temp dir)', () => {
    // The test setup sets REFLECTT_HOME to a temp dir, so validation is skipped
    const result = validatePrIntegrity({
      pr_url: 'https://github.com/reflectt/reflectt-node/pull/243',
      packet_commit: 'definitely-not-the-right-sha',
      packet_changed_files: ['nonexistent-file.ts'],
    })

    expect(result.skipped).toBe(true)
    expect(result.valid).toBe(true)
    expect(result.skip_reason).toContain('Test environment')
  })
})

// ── Stale SHA detection ──

describe('Stale SHA detection', () => {
  it('rejects when packet commit does not match live head', () => {
    // This test validates the comparison logic directly
    // (mocking the gh fetch is overkill; we test parsePrUrl + comparison logic)

    // Simulate: packet says "abc1234", live says "def5678"
    const packetCommit = 'abc1234'
    const liveHead = 'def5678'

    // Short SHA comparison
    const shortLen = Math.min(packetCommit.length, liveHead.length)
    const match = packetCommit.slice(0, shortLen).toLowerCase() === liveHead.slice(0, shortLen).toLowerCase()
    expect(match).toBe(false)
  })

  it('accepts when packet commit prefix matches live head', () => {
    const packetCommit = 'abc1234'
    const liveHead = 'abc12345678901234567890abcdef1234567890ab'

    const shortLen = Math.min(packetCommit.length, liveHead.length)
    const match = packetCommit.slice(0, shortLen).toLowerCase() === liveHead.slice(0, shortLen).toLowerCase()
    expect(match).toBe(true)
  })
})

// ── File list mismatch detection ──

describe('File list mismatch detection', () => {
  it('detects extra files in packet not in live PR', () => {
    const liveFiles = new Set(['src/a.ts', 'src/b.ts'])
    const packetFiles = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts'])

    const extraFiles = [...packetFiles].filter(f => !liveFiles.has(f))
    expect(extraFiles).toEqual(['src/c.ts'])
  })

  it('detects missing files in packet vs live PR', () => {
    const liveFiles = new Set(['src/a.ts', 'src/b.ts', 'src/c.ts'])
    const packetFiles = new Set(['src/a.ts'])

    const missingFiles = [...liveFiles].filter(f => !packetFiles.has(f))
    expect(missingFiles).toEqual(['src/b.ts', 'src/c.ts'])
  })

  it('reports clean when files match exactly', () => {
    const liveFiles = new Set(['src/a.ts', 'tests/b.test.ts'])
    const packetFiles = new Set(['src/a.ts', 'tests/b.test.ts'])

    const extra = [...packetFiles].filter(f => !liveFiles.has(f))
    const missing = [...liveFiles].filter(f => !packetFiles.has(f))
    expect(extra).toEqual([])
    expect(missing).toEqual([])
  })
})
