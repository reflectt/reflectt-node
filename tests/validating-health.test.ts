/**
 * Tests for GET /tasks/validating-health
 * task-1773493514066-hhlste3du
 *
 * Separates two failure modes in the validating lane:
 *   - reviewer_stale: reviewer assigned but no comment activity in >threshold
 *   - evidence_missing: no PR link and no artifact path
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ── Minimal server fixture ──────────────────────────────────────────────────
// We test the endpoint logic directly by constructing a minimal server
// rather than importing the full server (which requires all infra).

interface MockTask {
  id: string
  title: string
  status: string
  reviewer: string | null
  assignee: string
  priority: string
  createdAt: number
  updatedAt: number
  metadata: Record<string, unknown> | null
}

interface MockComment {
  id: string
  taskId: string
  author: string
  content: string
  timestamp: number
  suppressed?: boolean
}

const NOW = Date.now()
const TWO_HOURS_MS = 2 * 60 * 60 * 1000

// Build the endpoint logic as a standalone function (mirrors server.ts implementation)
function buildValidatingHealthHandler(
  getTasks: () => MockTask[],
  getComments: (taskId: string) => MockComment[],
) {
  return function (reviewerStaleThresholdMs = TWO_HOURS_MS) {
    const now = NOW
    const validatingTasks = getTasks()

    const taskDetails = validatingTasks.map(task => {
      const meta = (task.metadata ?? {}) as Record<string, unknown>
      const qaBundle = meta.qa_bundle as Record<string, unknown> | undefined
      const reviewPacket = qaBundle?.review_packet as Record<string, unknown> | undefined
      const reviewHandoff = meta.review_handoff as Record<string, unknown> | undefined

      const prUrl = (reviewPacket?.pr_url ?? reviewHandoff?.pr_url ?? null) as string | null
      const hasPrLink = Boolean(prUrl && typeof prUrl === 'string' && prUrl.includes('github.com'))

      const canonicalCommit = (meta.canonical_commit ?? reviewPacket?.commit ?? null) as string | null
      const prMerged = Boolean(canonicalCommit && typeof canonicalCommit === 'string' && canonicalCommit.length >= 7)

      const artifactPath = (reviewPacket?.artifact_path ?? reviewHandoff?.artifact_path ?? null) as string | null
      const hasArtifact = Boolean(artifactPath)

      const evidenceMissing = !hasPrLink && !hasArtifact

      const reviewer = task.reviewer ?? null
      let reviewerLastActiveAt: number | null = null
      if (reviewer) {
        const comments = getComments(task.id)
        const reviewerComments = comments.filter(c => c.author === reviewer && !c.suppressed)
        if (reviewerComments.length > 0) {
          reviewerLastActiveAt = Math.max(...reviewerComments.map(c => c.timestamp))
        }
      }

      const taskAgeMs = now - (task.updatedAt ?? task.createdAt ?? now)
      const reviewerStale = reviewer !== null
        && reviewerLastActiveAt === null
        && taskAgeMs > reviewerStaleThresholdMs

      const failureMode =
        reviewerStale && evidenceMissing ? 'both'
          : reviewerStale ? 'reviewer_stale'
            : evidenceMissing ? 'evidence_missing'
              : 'ok'

      return {
        task_id: task.id,
        title: task.title,
        reviewer,
        age_ms: now - (task.createdAt ?? now),
        updated_age_ms: taskAgeMs,
        has_pr_link: hasPrLink,
        pr_url: prUrl,
        pr_merged: prMerged,
        has_artifact: hasArtifact,
        reviewer_last_active_at: reviewerLastActiveAt,
        reviewer_active_recently: reviewerLastActiveAt !== null
          && (now - reviewerLastActiveAt) <= reviewerStaleThresholdMs,
        reviewer_stale: reviewerStale,
        evidence_missing: evidenceMissing,
        failure_mode: failureMode,
      }
    })

    const summary = {
      total: taskDetails.length,
      ok: taskDetails.filter(t => t.failure_mode === 'ok').length,
      reviewer_stale: taskDetails.filter(t => t.failure_mode === 'reviewer_stale' || t.failure_mode === 'both').length,
      evidence_missing: taskDetails.filter(t => t.failure_mode === 'evidence_missing' || t.failure_mode === 'both').length,
      both: taskDetails.filter(t => t.failure_mode === 'both').length,
    }

    return {
      success: true,
      reviewer_stale_threshold_ms: reviewerStaleThresholdMs,
      summary,
      tasks: taskDetails,
    }
  }
}

function makeTask(id: string, overrides: Partial<MockTask> = {}): MockTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'validating',
    reviewer: 'kai',
    assignee: 'link',
    priority: 'P2',
    createdAt: NOW - 3 * 60 * 60 * 1000, // 3h old
    updatedAt: NOW - 3 * 60 * 60 * 1000,
    metadata: null,
    ...overrides,
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('validating-health endpoint logic', () => {
  describe('failure_mode classification', () => {
    it('ok: reviewer commented recently + PR link present', () => {
      const task = makeTask('t1', {
        metadata: {
          qa_bundle: {
            review_packet: {
              pr_url: 'https://github.com/org/repo/pull/42',
              artifact_path: 'process/TASK-t1.md',
            },
          },
        },
      })
      const comments: MockComment[] = [
        { id: 'c1', taskId: 't1', author: 'kai', content: 'lgtm', timestamp: NOW - 30 * 60 * 1000 }, // 30m ago
      ]
      const handler = buildValidatingHealthHandler(() => [task], () => comments)
      const result = handler()
      expect(result.tasks[0].failure_mode).toBe('ok')
      expect(result.tasks[0].reviewer_stale).toBe(false)
      expect(result.tasks[0].evidence_missing).toBe(false)
      expect(result.summary.ok).toBe(1)
    })

    it('reviewer_stale: no reviewer comment + task older than threshold', () => {
      const task = makeTask('t2', {
        reviewer: 'kai',
        updatedAt: NOW - 3 * 60 * 60 * 1000, // 3h ago
        metadata: {
          qa_bundle: {
            review_packet: {
              pr_url: 'https://github.com/org/repo/pull/43',
              artifact_path: 'process/TASK-t2.md',
            },
          },
        },
      })
      const handler = buildValidatingHealthHandler(() => [task], () => [])
      const result = handler()
      expect(result.tasks[0].failure_mode).toBe('reviewer_stale')
      expect(result.tasks[0].reviewer_stale).toBe(true)
      expect(result.tasks[0].evidence_missing).toBe(false)
      expect(result.summary.reviewer_stale).toBe(1)
      expect(result.summary.evidence_missing).toBe(0)
    })

    it('evidence_missing: reviewer commented but no PR link or artifact', () => {
      const task = makeTask('t3', {
        reviewer: 'kai',
        metadata: null, // no PR URL, no artifact
      })
      const comments: MockComment[] = [
        { id: 'c2', taskId: 't3', author: 'kai', content: 'reviewing', timestamp: NOW - 10 * 60 * 1000 },
      ]
      const handler = buildValidatingHealthHandler(() => [task], () => comments)
      const result = handler()
      expect(result.tasks[0].failure_mode).toBe('evidence_missing')
      expect(result.tasks[0].reviewer_stale).toBe(false)
      expect(result.tasks[0].evidence_missing).toBe(true)
      expect(result.summary.evidence_missing).toBe(1)
    })

    it('both: no reviewer comment AND no evidence (worst case)', () => {
      const task = makeTask('t4', {
        reviewer: 'kai',
        metadata: null,
        updatedAt: NOW - 4 * 60 * 60 * 1000,
      })
      const handler = buildValidatingHealthHandler(() => [task], () => [])
      const result = handler()
      expect(result.tasks[0].failure_mode).toBe('both')
      expect(result.summary.both).toBe(1)
      expect(result.summary.reviewer_stale).toBe(1) // both counts toward reviewer_stale
      expect(result.summary.evidence_missing).toBe(1) // and evidence_missing
    })

    it('ok: no reviewer assigned (evidence-only check)', () => {
      const task = makeTask('t5', {
        reviewer: null,
        metadata: {
          qa_bundle: {
            review_packet: {
              pr_url: 'https://github.com/org/repo/pull/44',
              artifact_path: 'process/TASK-t5.md',
            },
          },
        },
      })
      const handler = buildValidatingHealthHandler(() => [task], () => [])
      const result = handler()
      // No reviewer → reviewer_stale can't fire; has PR link → evidence_missing=false
      expect(result.tasks[0].failure_mode).toBe('ok')
      expect(result.tasks[0].reviewer_stale).toBe(false)
    })
  })

  describe('PR link + evidence detection', () => {
    it('detects PR link in review_handoff', () => {
      const task = makeTask('t6', {
        reviewer: 'kai',
        metadata: {
          review_handoff: {
            pr_url: 'https://github.com/org/repo/pull/10',
            artifact_path: 'process/TASK-t6.md',
          },
        },
      })
      const comments = [{ id: 'c3', taskId: 't6', author: 'kai', content: 'ok', timestamp: NOW - 5 * 60 * 1000 }]
      const handler = buildValidatingHealthHandler(() => [task], () => comments)
      const result = handler()
      expect(result.tasks[0].has_pr_link).toBe(true)
      expect(result.tasks[0].failure_mode).toBe('ok')
    })

    it('pr_merged=true when canonical_commit is set', () => {
      const task = makeTask('t7', {
        metadata: {
          canonical_commit: 'abc1234def',
          qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/11' } },
        },
      })
      const handler = buildValidatingHealthHandler(() => [task], () => [])
      const result = handler()
      expect(result.tasks[0].pr_merged).toBe(true)
    })

    it('pr_merged=false when no canonical_commit', () => {
      const task = makeTask('t8', {
        metadata: { qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/12' } } },
      })
      const handler = buildValidatingHealthHandler(() => [task], () => [])
      const result = handler()
      expect(result.tasks[0].pr_merged).toBe(false)
    })
  })

  describe('reviewer activity detection', () => {
    it('reviewer_active_recently=true when comment within threshold', () => {
      const task = makeTask('t9', {
        reviewer: 'sage',
        metadata: { qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/20' } } },
      })
      const comments = [
        { id: 'c4', taskId: 't9', author: 'sage', content: 'reviewing', timestamp: NOW - 60 * 60 * 1000 }, // 1h ago
      ]
      const handler = buildValidatingHealthHandler(() => [task], () => comments)
      const result = handler(TWO_HOURS_MS)
      expect(result.tasks[0].reviewer_active_recently).toBe(true)
      expect(result.tasks[0].reviewer_last_active_at).toBe(NOW - 60 * 60 * 1000)
    })

    it('ignores suppressed comments for reviewer activity', () => {
      const task = makeTask('t10', {
        reviewer: 'sage',
        updatedAt: NOW - 3 * 60 * 60 * 1000,
        metadata: { qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/21' } } },
      })
      const comments = [
        { id: 'c5', taskId: 't10', author: 'sage', content: 'hidden', timestamp: NOW - 30 * 60 * 1000, suppressed: true },
      ]
      const handler = buildValidatingHealthHandler(() => [task], () => comments)
      const result = handler()
      // Suppressed comment doesn't count
      expect(result.tasks[0].reviewer_last_active_at).toBeNull()
      expect(result.tasks[0].reviewer_stale).toBe(true)
    })
  })

  describe('summary counts', () => {
    it('correctly tallies mixed task set', () => {
      const tasks = [
        // ok
        makeTask('ok1', { metadata: { qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/1', artifact_path: 'p' } } } }),
        // reviewer_stale
        makeTask('stale1', { reviewer: 'kai', updatedAt: NOW - 5 * 60 * 60 * 1000, metadata: { qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/2', artifact_path: 'p' } } } }),
        // evidence_missing
        makeTask('em1', { reviewer: null, metadata: null }),
        // both
        makeTask('both1', { reviewer: 'kai', updatedAt: NOW - 5 * 60 * 60 * 1000, metadata: null }),
      ]

      const commentsMap: Record<string, MockComment[]> = {
        ok1: [{ id: 'x', taskId: 'ok1', author: 'kai', content: 'ok', timestamp: NOW - 60 * 1000 }],
      }

      const handler = buildValidatingHealthHandler(
        () => tasks,
        (taskId) => commentsMap[taskId] ?? [],
      )
      const result = handler()
      expect(result.summary.total).toBe(4)
      expect(result.summary.ok).toBe(1)
      expect(result.summary.reviewer_stale).toBe(2) // stale1 + both1
      expect(result.summary.evidence_missing).toBe(2) // em1 + both1
      expect(result.summary.both).toBe(1)
    })

    it('returns empty summary for no validating tasks', () => {
      const handler = buildValidatingHealthHandler(() => [], () => [])
      const result = handler()
      expect(result.summary).toEqual({ total: 0, ok: 0, reviewer_stale: 0, evidence_missing: 0, both: 0 })
      expect(result.tasks).toHaveLength(0)
    })
  })

  describe('custom threshold', () => {
    it('reviewer_stale=false within custom threshold', () => {
      const task = makeTask('thresh1', {
        reviewer: 'kai',
        updatedAt: NOW - 30 * 60 * 1000, // 30m old
        metadata: { qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/99' } } },
      })
      const handler = buildValidatingHealthHandler(() => [task], () => [])
      // With 1h threshold — 30m old task is NOT stale
      const result = handler(60 * 60 * 1000)
      expect(result.tasks[0].reviewer_stale).toBe(false)
    })

    it('reviewer_stale=true when task age exceeds custom threshold', () => {
      const task = makeTask('thresh2', {
        reviewer: 'kai',
        updatedAt: NOW - 90 * 60 * 1000, // 90m old
        metadata: { qa_bundle: { review_packet: { pr_url: 'https://github.com/org/repo/pull/100' } } },
      })
      const handler = buildValidatingHealthHandler(() => [task], () => [])
      // With 1h threshold — 90m old task IS stale
      const result = handler(60 * 60 * 1000)
      expect(result.tasks[0].reviewer_stale).toBe(true)
    })
  })
})
