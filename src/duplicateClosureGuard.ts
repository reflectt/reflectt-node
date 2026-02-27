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
 * Throws if a task is being closed as a duplicate without canonical proof.
 *
 * Intended acceptance rule (2026-02-26):
 * - metadata.duplicate_of must be a canonical task id (must start with "task-")
 * - metadata.duplicate_proof (or duplicate_of.proof) must be present and not "N/A"
 * - AND at least one of:
 *   - metadata.canonical_pr (GitHub PR URL) OR
 *   - metadata.canonical_commit (>=7 hex)
 *
 * Fallbacks allowed:
 * - PR/commit may also come from metadata.review_handoff.{pr_url,commit_sha} or metadata.pr_url
 *
 * Note: we do NOT require both PR+commit.
 */
export function assertDuplicateClosureHasCanonicalRefs(meta: DuplicateClosureMeta | null | undefined): void {
  if (!isDuplicateClosure(meta)) return
  const m = (meta || {}) as any

  const dupeOfId = firstString(
    m.duplicate_of,
    m.duplicateOf,
    m.duplicate_of?.task_id,
    m.duplicateOf?.task_id,
  )

  if (!dupeOfId) {
    throw new Error('Duplicate closure requires metadata.duplicate_of (canonical task id)')
  }

  if (!/^task-/.test(dupeOfId)) {
    throw new Error('Duplicate closure requires metadata.duplicate_of to be a canonical task id (must start with "task-")')
  }

  const proof = firstString(
    m.duplicate_proof,
    m.duplicateProof,
    m.duplicate_of?.proof,
    m.duplicateOf?.proof,
    m.duplicate_of_proof,
  )

  if (!proof || /^n\/?a$/i.test(proof.trim())) {
    throw new Error('Duplicate closure requires metadata.duplicate_proof (non-empty, not "N/A")')
  }

  const canonicalPr = firstString(m.canonical_pr, m.canonicalPr, m.review_handoff?.pr_url, m.pr_url)
  const canonicalCommit = firstString(m.canonical_commit, m.canonicalCommit, m.review_handoff?.commit_sha)

  const hasPr = isHttpUrl(canonicalPr)
  const hasCommit = typeof canonicalCommit === 'string'
    && canonicalCommit.length >= 7
    && /^[0-9a-f]+$/i.test(canonicalCommit)

  if (!hasPr && !hasCommit) {
    throw new Error('Duplicate closure requires canonical_pr (PR URL) or canonical_commit (>=7 hex)')
  }
}
