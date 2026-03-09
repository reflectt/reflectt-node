// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

export function getReviewState(meta: Record<string, unknown>): string {
  return typeof meta.review_state === 'string' ? meta.review_state : ''
}

export function hasReviewerDecision(meta: Record<string, unknown>): boolean {
  return meta.reviewer_decision != null
}

/**
 * Canonical reviewer-SLA precedence rule:
 * once a reviewer decision exists, reviewer-facing SLA paging stops.
 * Tasks in needs_author are also waiting on the assignee/author, not the reviewer.
 */
export function isWaitingOnAuthor(meta: Record<string, unknown>): boolean {
  return getReviewState(meta) === 'needs_author' || hasReviewerDecision(meta)
}
