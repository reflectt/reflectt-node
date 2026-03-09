import type { Task } from './types.js'

export type ReviewSlaOwner = 'reviewer' | 'author' | 'none'

export interface ReviewSlaClassification {
  owner: ReviewSlaOwner
  reviewerSlaActive: boolean
  reason:
    | 'review_complete'
    | 'author_turn'
    | 'reviewer_turn'
    | 'not_in_review'
}

function getMetadataString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function hasReviewerDecision(metadata: Record<string, unknown> | undefined): boolean {
  const reviewerDecision = metadata?.reviewer_decision
  return typeof reviewerDecision === 'string' && reviewerDecision.trim().length > 0
}

export function classifyReviewSla(task: Pick<Task, 'status' | 'metadata'>): ReviewSlaClassification {
  const metadata = task.metadata as Record<string, unknown> | undefined
  const reviewState = getMetadataString(metadata, 'review_state')

  if (task.status !== 'validating') {
    return {
      owner: 'none',
      reviewerSlaActive: false,
      reason: 'not_in_review',
    }
  }

  if (
    metadata?.reviewer_approved === true
    || reviewState === 'approved'
    || getMetadataString(metadata, 'pr_status') === 'merged'
    || getMetadataString(metadata, 'pr_state') === 'merged'
    || metadata?.pr_merged === true
  ) {
    return {
      owner: 'none',
      reviewerSlaActive: false,
      reason: 'review_complete',
    }
  }

  if (reviewState === 'needs_author' || hasReviewerDecision(metadata)) {
    return {
      owner: 'author',
      reviewerSlaActive: false,
      reason: 'author_turn',
    }
  }

  return {
    owner: 'reviewer',
    reviewerSlaActive: true,
    reason: 'reviewer_turn',
  }
}
