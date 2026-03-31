// SPDX-License-Identifier: Apache-2.0
/**
 * Stale PR-link reconciler.
 *
 * Problem: validating tasks hold a `review_packet.pr_url` pointing at an open PR.
 * When the PR merges, the task still shows the open-PR URL. The duplicate-closure
 * gate requires `canonical_pr` + `canonical_commit` — but agents have to set these
 * manually, causing friction and "duplicate closure" gate failures.
 *
 * Solution: a background sweep that:
 *   1. Finds validating tasks with a PR URL in metadata
 *   2. Calls `gh pr view --json state,mergeCommit` for each
 *   3. For merged PRs: stamps `metadata.canonical_pr` + `metadata.canonical_commit`
 *      so the gate can auto-pass on next review attempt
 *
 * Safety:
 *   - Read-only GitHub call (gh CLI, no write)
 *   - Only patches metadata (never changes task status)
 *   - Best-effort: failures are logged, never thrown
 *   - Idempotent: re-running is safe (already-stamped tasks are skipped)
 *   - Rate-limited: one gh CLI call per task, max 50 tasks/sweep
 *
 * task-1773493504539-chjbrrww3
 */

import { execSync } from 'child_process'
import { parsePrUrl } from './pr-integrity.js'
import type { Task } from './types.js'

export interface ReconcileResult {
  taskId: string
  prUrl: string
  action: 'stamped' | 'already_canonical' | 'not_merged' | 'error' | 'skipped'
  mergeCommit?: string
  error?: string
}

export interface ReconcileSweepResult {
  swept: number
  stamped: number
  skipped: number
  errors: number
  results: ReconcileResult[]
  durationMs: number
}

/** Extract PR URL from task metadata (qa_bundle.review_packet or review_handoff). */
export function extractPrUrl(task: Task): string | null {
  const meta = task.metadata as Record<string, unknown> | null | undefined
  if (!meta) return null

  const qaBundle = meta.qa_bundle as Record<string, unknown> | undefined
  const reviewPacket = qaBundle?.review_packet as Record<string, unknown> | undefined
  if (typeof reviewPacket?.pr_url === 'string' && reviewPacket.pr_url.includes('github.com')) {
    return reviewPacket.pr_url.trim()
  }

  const reviewHandoff = meta.review_handoff as Record<string, unknown> | undefined
  if (typeof reviewHandoff?.pr_url === 'string' && reviewHandoff.pr_url.includes('github.com')) {
    return reviewHandoff.pr_url.trim()
  }

  return null
}

/** Check if task already has canonical refs stamped. */
export function hasCanonicalRefs(task: Task): boolean {
  const meta = task.metadata as Record<string, unknown> | null | undefined
  if (!meta) return false
  return typeof meta.canonical_commit === 'string' && meta.canonical_commit.length >= 7
}

interface PrMergeState {
  merged: boolean
  mergeCommit: string | null
  headSha: string | null
}

/** Fetch merge state for a PR using gh CLI. Returns null if gh unavailable or network error. */
export function fetchPrMergeState(prUrl: string): PrMergeState | null {
  const parsed = parsePrUrl(prUrl)
  if (!parsed) return null

  try {
    const json = execSync(
      `gh pr view ${parsed.number} --repo ${parsed.repo} --json state,mergeCommit,headRefOid`,
      { timeout: 15_000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim()
    const data = JSON.parse(json) as {
      state?: string
      mergeCommit?: { oid?: string } | null
      headRefOid?: string
    }
    const merged = data.state === 'MERGED'
    const mergeCommit = data.mergeCommit?.oid?.trim() || null
    const headSha = data.headRefOid?.trim() || null
    return { merged, mergeCommit, headSha }
  } catch {
    return null
  }
}

export interface ReconcilerDeps {
  getValidatingTasks: () => Task[]
  patchTaskMetadata: (taskId: string, patch: Record<string, unknown>) => void
}

/**
 * Run one reconcile sweep.
 * Finds validating tasks with PR URLs, checks merge state, stamps canonical refs.
 */
export function runPrLinkReconcileSweep(deps: ReconcilerDeps, maxTasks = 50): ReconcileSweepResult {
  const start = Date.now()
  const tasks = deps.getValidatingTasks().slice(0, maxTasks)
  const results: ReconcileResult[] = []

  for (const task of tasks) {
    const prUrl = extractPrUrl(task)
    if (!prUrl) {
      results.push({ taskId: task.id, prUrl: '', action: 'skipped' })
      continue
    }

    // Already canonical — skip
    if (hasCanonicalRefs(task)) {
      results.push({ taskId: task.id, prUrl, action: 'already_canonical' })
      continue
    }

    // Fetch merge state
    const state = fetchPrMergeState(prUrl)
    if (!state) {
      results.push({ taskId: task.id, prUrl, action: 'error', error: 'gh CLI unavailable or fetch failed' })
      continue
    }

    if (!state.merged) {
      results.push({ taskId: task.id, prUrl, action: 'not_merged' })
      continue
    }

    // Stamp canonical refs — use mergeCommit if available, fall back to headSha
    const commit = state.mergeCommit ?? state.headSha
    if (!commit) {
      results.push({ taskId: task.id, prUrl, action: 'error', error: 'merged but no commit SHA returned' })
      continue
    }

    try {
      deps.patchTaskMetadata(task.id, {
        canonical_pr: prUrl,
        canonical_commit: commit,
        canonical_stamped_at: Date.now(),
        canonical_source: 'pr-link-reconciler',
      })
      results.push({ taskId: task.id, prUrl, action: 'stamped', mergeCommit: commit })
    } catch (err: unknown) {
      results.push({ taskId: task.id, prUrl, action: 'error', error: String(err) })
    }
  }

  const stamped = results.filter(r => r.action === 'stamped').length
  const skipped = results.filter(r => r.action === 'skipped' || r.action === 'already_canonical' || r.action === 'not_merged').length
  const errors = results.filter(r => r.action === 'error').length

  return {
    swept: tasks.length,
    stamped,
    skipped,
    errors,
    results,
    durationMs: Date.now() - start,
  }
}
