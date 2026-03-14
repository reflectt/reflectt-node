/**
 * Regression tests: insight lifecycle sync on task done
 * task-1773491932598-izynfta9z
 *
 * When a task with metadata.insight_id transitions to done, the linked
 * insight must auto-close so the candidate backlog reflects true unresolved work.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { getDb } from '../src/db.js'
import { _clearInsightMutationAuditLog, getRecentInsightMutationAudits } from '../src/insight-mutation.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

beforeEach(() => {
  if (!process.env.REFLECTT_TEST_MODE) throw new Error('Refusing unscoped DELETE outside test mode')
  const db = getDb()
  db.prepare('DELETE FROM insights').run()
  db.prepare("DELETE FROM tasks WHERE metadata LIKE '%insight_id%' OR metadata LIKE '%is_test%'").run()
  _clearInsightMutationAuditLog()
})

function insertInsight(id: string, status = 'candidate') {
  const db = getDb()
  const now = Date.now()
  db.prepare(`
    INSERT INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      task_id, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.5, 'P2', '[]', 1, '[]', '[]', 0.5, 0, NULL, NULL, ?, ?)
  `).run(id, 'workflow::review::closeout', 'workflow', 'review', 'closeout',
    'Test insight', status, now, now)
}

async function createTask(extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/tasks',
    payload: {
      title: 'test insight sync task',
      assignee: 'link',
      reviewer: 'sage',
      done_criteria: ['criterion one'],
      metadata: { is_test: true, ...extra },
    },
  })
  return JSON.parse(res.body).task
}

/**
 * Move a task to done via non-code lane (qa_bundle.non_code=true).
 * Avoids process file + PR integrity requirements in test environment.
 */
async function moveTaskToDone(taskId: string) {
  // todo → doing (wip_override: test env has real doing tasks that hit cap)
  await app.inject({
    method: 'PATCH',
    url: `/tasks/${taskId}`,
    payload: { status: 'doing', actor: 'link', metadata: { wip_override: 'test-harness bypass' } },
  })

  // doing → validating via non-code lane (no PR/process file required)
  // Use URL artifact_path to pass the retrievability check; doc_only skips commit_sha
  await app.inject({
    method: 'PATCH',
    url: `/tasks/${taskId}`,
    payload: {
      status: 'validating',
      actor: 'link',
      metadata: {
        review_handoff: {
          task_id: taskId,
          artifact_path: 'https://github.com/reflectt/reflectt-node/pull/987',
          known_caveats: 'test-harness',
          doc_only: true,
          reviewer: 'sage',
        },
        qa_bundle: {
          non_code: true,
          lane: 'ops',
          summary: 'insight lifecycle sync test',
          artifact_links: ['https://github.com/reflectt/reflectt-node/pull/987'],
          changed_files: ['src/tasks.ts'],
          screenshot_proof: ['https://github.com/reflectt/reflectt-node/pull/987'],
          reviewer: 'sage',
        },
      },
    },
  })

  // validating → done via review approval
  await app.inject({
    method: 'POST',
    url: `/tasks/${taskId}/review`,
    payload: { reviewer: 'sage', decision: 'approve', comment: 'test approval' },
  })
}

describe('insight lifecycle sync — task done auto-closes linked insight', () => {
  it('closes a candidate insight when its task is done', async () => {
    const insightId = `ins-test-${Date.now()}`
    insertInsight(insightId, 'candidate')

    const task = await createTask({ insight_id: insightId })
    await moveTaskToDone(task.id)

    // Give setImmediate + async a tick to settle
    await new Promise(r => setTimeout(r, 100))

    const db = getDb()
    const row = db.prepare('SELECT status FROM insights WHERE id = ?').get(insightId) as any
    expect(row?.status).toBe('closed')
  })

  it('records an audit entry for the auto-close', async () => {
    const insightId = `ins-test-audit-${Date.now()}`
    insertInsight(insightId, 'candidate')

    const task = await createTask({ insight_id: insightId })
    await moveTaskToDone(task.id)
    await new Promise(r => setTimeout(r, 100))

    const audits = getRecentInsightMutationAudits(10)
    const entry = audits.find(a => a.insightId === insightId)
    expect(entry).toBeDefined()
    expect(entry?.reason).toContain('auto lifecycle sync')
  })

  it('does NOT close insight when task transitions to non-done status', async () => {
    const insightId = `ins-test-nondone-${Date.now()}`
    insertInsight(insightId, 'candidate')

    const task = await createTask({ insight_id: insightId })
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: { status: 'doing', actor: 'link', metadata: { wip_override: 'test' } },
    })
    await new Promise(r => setTimeout(r, 100))

    const db = getDb()
    const row = db.prepare('SELECT status FROM insights WHERE id = ?').get(insightId) as any
    expect(row?.status).toBe('candidate') // unchanged
  })

  it('does NOT close insight when task has no insight_id in metadata', async () => {
    const insightId = `ins-test-noid-${Date.now()}`
    insertInsight(insightId, 'candidate')

    const task = await createTask() // no insight_id
    await moveTaskToDone(task.id)
    await new Promise(r => setTimeout(r, 100))

    const db = getDb()
    const row = db.prepare('SELECT status FROM insights WHERE id = ?').get(insightId) as any
    expect(row?.status).toBe('candidate') // unchanged — no link
  })

  it('handles missing insight_id gracefully (no throw)', async () => {
    const task = await createTask({ insight_id: 'ins-does-not-exist-xxxx' })
    await expect(moveTaskToDone(task.id)).resolves.not.toThrow()
  })
})
