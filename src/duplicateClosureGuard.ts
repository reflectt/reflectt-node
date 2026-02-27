// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Duplicate-closure canonical reference enforcement.
 *
 * Why: Auto-close writers (sweeper/automerge/server) can close tasks without
 * going through interactive precheck flows. If a task is closed as a
 * "duplicate" without canonical refs, reviewers get churny N/A proof packets.
 */

export type DuplicateClosureMeta = Record<string, unknown>

export function isDuplicateClosure(meta: DuplicateClosureMeta | null | undefined): boolean {
  if (!meta) return false

  const autoCloseReason = (meta as any).auto_close_reason
  const hasDupeReason = typeof autoCloseReason === 'string' && autoCloseReason.toLowerCase().includes('duplicate')

  const hasDupeOf = Boolean((meta as any).duplicate_of)
  const lane = (meta as any).qa_bundle?.lane
  const hasDupeLane = typeof lane === 'string' && lane === 'duplicate-closure'

  return hasDupeReason || hasDupeOf || hasDupeLane
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim()
  }
  return null
}

function isHttpUrl(s: string | null): boolean {
  return typeof s === 'string' && (s.startsWith('http://') || s.startsWith('https://'))
}

/**
 * Throws if a task is being closed as a duplicate without canonical refs.
 *
 * Required fields:
 * - metadata.duplicate_of (canonical task id)
 * - metadata.canonical_pr (or metadata.review_handoff.pr_url or metadata.pr_url)
 * - metadata.canonical_commit (or metadata.review_handoff.commit_sha)
 */
export function assertDuplicateClosureHasCanonicalRefs(meta: DuplicateClosureMeta | null | undefined): void {
  if (!isDuplicateClosure(meta)) return
  const m = (meta || {}) as any

  const dupeOf = firstString(m.duplicate_of)
  if (!dupeOf) {
    throw new Error('Duplicate closure requires metadata.duplicate_of (canonical task id)')
  }

  const canonicalPr = firstString(m.canonical_pr, m.canonicalPr, m.review_handoff?.pr_url, m.pr_url)
  if (!isHttpUrl(canonicalPr)) {
    throw new Error('Duplicate closure requires a canonical PR URL (metadata.canonical_pr or review_handoff.pr_url)')
  }

  const canonicalCommit = firstString(m.canonical_commit, m.canonicalCommit, m.review_handoff?.commit_sha)
  if (!canonicalCommit || canonicalCommit.length < 7) {
    throw new Error('Duplicate closure requires metadata.canonical_commit (or review_handoff.commit_sha)')
  }
}
