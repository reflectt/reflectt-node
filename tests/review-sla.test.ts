import { describe, expect, it } from 'vitest'

import { classifyReviewSla } from '../src/review-sla.js'

describe('classifyReviewSla', () => {
  it('treats needs_author with reviewer_decision (object shape) as author wait', () => {
    const result = classifyReviewSla({
      status: 'validating',
      metadata: {
        review_state: 'needs_author',
        reviewer_decision: { decision: 'changes_requested', reviewer: 'sage', decidedAt: Date.now() },
      },
    })

    expect(result).toEqual({
      owner: 'author',
      reviewerSlaActive: false,
      reason: 'author_turn',
    })
  })

  it('treats needs_author with reviewer_decision as author wait, not reviewer wait', () => {
    const result = classifyReviewSla({
      status: 'validating',
      metadata: {
        review_state: 'needs_author',
        reviewer_decision: 'changes_requested',
      },
    })

    expect(result).toEqual({
      owner: 'author',
      reviewerSlaActive: false,
      reason: 'author_turn',
    })
  })

  it('treats queued validating tasks without reviewer action as reviewer wait', () => {
    const result = classifyReviewSla({
      status: 'validating',
      metadata: {
        review_state: 'queued',
      },
    })

    expect(result).toEqual({
      owner: 'reviewer',
      reviewerSlaActive: true,
      reason: 'reviewer_turn',
    })
  })

  it('treats merged or approved review states as review complete', () => {
    expect(
      classifyReviewSla({
        status: 'validating',
        metadata: {
          review_state: 'approved',
        },
      }),
    ).toEqual({
      owner: 'none',
      reviewerSlaActive: false,
      reason: 'review_complete',
    })

    expect(
      classifyReviewSla({
        status: 'validating',
        metadata: {
          pr_merged: true,
        },
      }),
    ).toEqual({
      owner: 'none',
      reviewerSlaActive: false,
      reason: 'review_complete',
    })
  })

  it('does not activate reviewer SLA outside validating', () => {
    const result = classifyReviewSla({
      status: 'doing',
      metadata: {
        review_state: 'needs_author',
        reviewer_decision: 'changes_requested',
      },
    })

    expect(result).toEqual({
      owner: 'none',
      reviewerSlaActive: false,
      reason: 'not_in_review',
    })
  })
})
