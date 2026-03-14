/**
 * Tests for review-autoclose bridge.
 * task-1773490646984-eujrozhai
 */
import { describe, it, expect } from 'vitest'
import { parseReviewSignal, evaluateAutoClose } from '../src/review-autoclose.js'

describe('parseReviewSignal', () => {
  it('detects approved', () => {
    const r = parseReviewSignal('[review] approved: looks good')
    expect(r.detected).toBe(true)
    expect(r.decision).toBe('approve')
    expect(r.comment).toBe('looks good')
  })

  it('detects rejected', () => {
    const r = parseReviewSignal('[review] rejected: needs rework')
    expect(r.detected).toBe(true)
    expect(r.decision).toBe('reject')
    expect(r.comment).toBe('needs rework')
  })

  it('is case-insensitive', () => {
    expect(parseReviewSignal('[REVIEW] Approved: ok').decision).toBe('approve')
    expect(parseReviewSignal('[Review] Rejected: no').decision).toBe('reject')
  })

  it('accepts approved with no trailing comment', () => {
    const r = parseReviewSignal('[review] approved')
    expect(r.detected).toBe(true)
    expect(r.decision).toBe('approve')
    expect(r.comment).toBeTruthy()
  })

  it('ignores non-structured comments', () => {
    expect(parseReviewSignal('approved')).toMatchObject({ detected: false })
    expect(parseReviewSignal('LGTM ✅')).toMatchObject({ detected: false })
    expect(parseReviewSignal('task approved')).toMatchObject({ detected: false })
    expect(parseReviewSignal('[review]')).toMatchObject({ detected: false })
  })

  it('ignores partial matches in longer text', () => {
    // Must start with [review]
    expect(parseReviewSignal('some text [review] approved: ok')).toMatchObject({ detected: false })
  })
})

describe('evaluateAutoClose', () => {
  const base = {
    taskId: 'task-123',
    taskStatus: 'validating' as const,
    taskReviewer: 'pixel',
    taskAssignee: 'link',
    commentAuthor: 'pixel',
    commentContent: '[review] approved: all criteria met',
  }

  it('fires approve when all checks pass', () => {
    const r = evaluateAutoClose(base)
    expect(r.fired).toBe(true)
    expect(r.decision).toBe('approve')
  })

  it('fires reject correctly', () => {
    const r = evaluateAutoClose({ ...base, commentContent: '[review] rejected: needs fixes' })
    expect(r.fired).toBe(true)
    expect(r.decision).toBe('reject')
  })

  it('does not fire when task is not validating', () => {
    expect(evaluateAutoClose({ ...base, taskStatus: 'doing' }).fired).toBe(false)
    expect(evaluateAutoClose({ ...base, taskStatus: 'done' }).fired).toBe(false)
    expect(evaluateAutoClose({ ...base, taskStatus: 'todo' }).fired).toBe(false)
  })

  it('does not fire when author is not the reviewer', () => {
    const r = evaluateAutoClose({ ...base, commentAuthor: 'kai' })
    expect(r.fired).toBe(false)
    expect(r.reason).toContain('not the assigned reviewer')
  })

  it('does not fire when reviewer is null', () => {
    const r = evaluateAutoClose({ ...base, taskReviewer: null })
    expect(r.fired).toBe(false)
    expect(r.reason).toContain('no assigned reviewer')
  })

  it('does not fire on unstructured comment', () => {
    const r = evaluateAutoClose({ ...base, commentContent: 'Looks great! LGTM' })
    expect(r.fired).toBe(false)
    expect(r.reason).toContain('no structured [review] signal')
  })

  it('reviewer match is case-insensitive', () => {
    const r = evaluateAutoClose({ ...base, commentAuthor: 'PIXEL' })
    expect(r.fired).toBe(true)
  })

  it('returns dryRun flag when set', () => {
    const r = evaluateAutoClose({ ...base, dryRun: true })
    expect(r.fired).toBe(true)
    expect(r.dryRun).toBe(true)
  })
})
