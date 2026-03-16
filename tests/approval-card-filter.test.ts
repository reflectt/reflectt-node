import { describe, it, expect } from 'vitest'

/**
 * Tests for the approval card agent-reviewer filter.
 * Verifies that agent-to-agent reviews don't produce canvas approval cards.
 */

const KNOWN_AGENT_IDS = new Set([
  'link', 'kai', 'pixel', 'sage', 'scout', 'echo',
  'rhythm', 'spark', 'swift', 'kotlin', 'harmony',
])

function shouldShowApprovalCard(reviewer: string | undefined): boolean {
  const reviewerId = (reviewer ?? '').toLowerCase().trim()
  return !KNOWN_AGENT_IDS.has(reviewerId)
}

describe('approval card agent filter', () => {
  it('shows card for human reviewers', () => {
    expect(shouldShowApprovalCard('ryan')).toBe(true)
    expect(shouldShowApprovalCard('Ryan Campbell')).toBe(true)
    expect(shouldShowApprovalCard('admin')).toBe(true)
    expect(shouldShowApprovalCard(undefined)).toBe(true)
    expect(shouldShowApprovalCard('')).toBe(true)
  })

  it('hides card for known agent reviewers', () => {
    expect(shouldShowApprovalCard('kai')).toBe(false)
    expect(shouldShowApprovalCard('pixel')).toBe(false)
    expect(shouldShowApprovalCard('link')).toBe(false)
    expect(shouldShowApprovalCard('sage')).toBe(false)
    expect(shouldShowApprovalCard('kotlin')).toBe(false)
    expect(shouldShowApprovalCard('swift')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(shouldShowApprovalCard('Kai')).toBe(false)
    expect(shouldShowApprovalCard('PIXEL')).toBe(false)
    expect(shouldShowApprovalCard('Link')).toBe(false)
  })

  it('trims whitespace', () => {
    expect(shouldShowApprovalCard(' kai ')).toBe(false)
    expect(shouldShowApprovalCard('  pixel  ')).toBe(false)
  })
})
