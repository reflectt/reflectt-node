/**
 * Tests for artifact grace period: validating tasks without artifacts
 * are auto-rejected back to todo after 24h.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import { hasRequiredArtifacts, sweepValidatingQueue } from '../src/executionSweeper.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const createdIds: string[] = []

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  for (const id of createdIds) {
    try { await app.inject({ method: 'DELETE', url: `/tasks/${id}` }) } catch {}
  }
  await app.close()
})

function makeTask(overrides: Record<string, unknown> = {}) {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    title: `TEST: artifact grace test ${nonce}`,
    assignee: `artifact-test-agent-${nonce}`,
    reviewer: 'ryan',
    priority: 'P2',
    done_criteria: ['Artifact check works'],
    createdBy: 'test-harness',
    eta: '~1h',
    metadata: { is_test: true, wip_override: true, skip_dedup: true, ...overrides },
  }
}

/**
 * Build metadata that satisfies the validating transition gate.
 * Uses doc_only=true to bypass code-artifact requirements (same pattern as execution-sweeper tests).
 * This lets us test the sweeper's artifact check independently of the gate.
 */
function validatingMeta(taskId: string, extra: Record<string, unknown> = {}) {
  const artifactPath = 'process/artifact-grace-test.md'
  return {
    is_test: true,
    wip_override: true,
    artifact_path: artifactPath,
    review_handoff: {
      task_id: taskId,
      artifact_path: artifactPath,
      test_proof: 'pass',
      known_caveats: 'test only',
      doc_only: true,
    },
    qa_bundle: {
      lane: 'test',
      summary: 'Artifact grace period test',
      changed_files: [artifactPath],
      artifact_links: [artifactPath],
      checks: ['lint:pass'],
      screenshot_proof: ['n/a'],
      review_packet: {
        task_id: taskId,
        artifact_path: artifactPath,
        pr_url: 'https://github.com/reflectt/reflectt-node/pull/0',
        commit: 'abc1234',
        changed_files: [artifactPath],
        caveats: 'Test only',
      },
    },
    ...extra,
  }
}

describe('hasRequiredArtifacts', () => {
  it('returns false for empty metadata', () => {
    expect(hasRequiredArtifacts({})).toBe(false)
  })

  it('returns true when pr_url is present', () => {
    expect(hasRequiredArtifacts({ pr_url: 'https://github.com/reflectt/reflectt-node/pull/42' })).toBe(true)
  })

  it('returns true when qa_bundle has valid pr_link', () => {
    expect(hasRequiredArtifacts({ qa_bundle: { pr_link: 'https://github.com/reflectt/reflectt-node/pull/42' } })).toBe(true)
  })

  it('returns false when qa_bundle only has review_packet (no evidence)', () => {
    expect(hasRequiredArtifacts({ qa_bundle: { review_packet: { task_id: 'task-1' }, summary: 'test' } })).toBe(false)
  })

  it('returns true when artifacts array has entries', () => {
    expect(hasRequiredArtifacts({ artifacts: ['https://github.com/reflectt/reflectt-node/pull/1'] })).toBe(true)
  })

  it('returns false when artifacts only contains duplicate refs', () => {
    expect(hasRequiredArtifacts({ artifacts: ['duplicate:task-123'] })).toBe(false)
  })

  it('returns true for doc-only tasks (exempt)', () => {
    expect(hasRequiredArtifacts({ review_handoff: { doc_only: true } })).toBe(true)
  })

  it('returns true for config-only tasks (exempt)', () => {
    expect(hasRequiredArtifacts({ review_handoff: { config_only: true } })).toBe(true)
  })

  it('returns true for reconciled tasks (exempt)', () => {
    expect(hasRequiredArtifacts({ reconciled: true })).toBe(true)
  })

  it('returns true when review_handoff has pr_url', () => {
    expect(hasRequiredArtifacts({
      review_handoff: { pr_url: 'https://github.com/reflectt/reflectt-node/pull/99' },
    })).toBe(true)
  })
})

describe('sweepValidatingQueue artifact rejection', () => {
  it('does NOT reject tasks within grace period', async () => {
    const task = makeTask()
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res.statusCode).toBe(200)
    const taskId = JSON.parse(res.body).task.id
    createdIds.push(taskId)

    // Move to doing → validating (doc_only passes gate)
    await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, payload: { status: 'doing' } })
    const valRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      payload: { status: 'validating', metadata: validatingMeta(taskId) },
    })
    expect(valRes.statusCode).toBe(200)

    // Now strip doc_only so artifact check applies, but keep within grace period
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      payload: {
        metadata: {
          review_handoff: {
            task_id: taskId, artifact_path: 'process/artifact-grace-test.md',
            test_proof: 'pass', known_caveats: 'test only', doc_only: false, config_only: false,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/0', commit_sha: 'abc1234',
          },
          entered_validating_at: Date.now(),
        },
      },
    })

    const result = sweepValidatingQueue()

    // Task should still be validating (within 24h grace)
    const check = await app.inject({ method: 'GET', url: `/tasks/${taskId}` })
    expect(JSON.parse(check.body).task.status).toBe('validating')
  })

  it('rejects tasks past grace period with no real artifacts', async () => {
    const task = makeTask()
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res.statusCode).toBe(200)
    const taskId = JSON.parse(res.body).task.id
    createdIds.push(taskId)

    // Move to doing → validating (doc_only passes gate)
    await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, payload: { status: 'doing' } })
    const valRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      payload: { status: 'validating', metadata: validatingMeta(taskId) },
    })
    expect(valRes.statusCode).toBe(200)

    // Strip doc_only + is_test, and backdate entry to 25h ago
    // is_test=false so sweeper's listTasks (includeTest=false by default) can see it
    // review_handoff needs pr_url to pass validating gate (but /pull/0 is not a "real" artifact)
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      payload: {
        metadata: {
          is_test: false,
          review_handoff: {
            task_id: taskId,
            artifact_path: 'process/artifact-grace-test.md',
            test_proof: 'pass',
            known_caveats: 'test only',
            doc_only: false,
            config_only: false,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/0',
            commit_sha: 'abc1234',
          },
          entered_validating_at: Date.now() - (25 * 60 * 60 * 1000),
        },
      },
    })
    expect(patchRes.statusCode).toBe(200)

    const result = sweepValidatingQueue()

    // Task should be auto-rejected back to todo
    const check = await app.inject({ method: 'GET', url: `/tasks/${taskId}` })
    const taskData = JSON.parse(check.body).task
    expect(taskData.status).toBe('todo')
    expect(taskData.metadata.artifact_rejected).toBe(true)
    expect(taskData.metadata.artifact_reject_reason).toContain('Missing required artifacts')
    expect(result.artifactRejectedCount).toBeGreaterThanOrEqual(1)
  })

  it('does NOT reject tasks past grace period if they have real artifacts', async () => {
    const task = makeTask()
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: task })
    expect(res.statusCode).toBe(200)
    const taskId = JSON.parse(res.body).task.id
    createdIds.push(taskId)

    // Move to doing → validating (doc_only passes gate)
    await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, payload: { status: 'doing' } })
    const valRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      payload: { status: 'validating', metadata: validatingMeta(taskId) },
    })
    expect(valRes.statusCode).toBe(200)

    // Strip doc_only but add real PR URL — should be protected by artifacts
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      payload: {
        metadata: {
          review_handoff: {
            task_id: taskId, artifact_path: 'process/artifact-grace-test.md',
            test_proof: 'pass', known_caveats: 'test only', doc_only: false, config_only: false,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999', commit_sha: 'abc1234',
          },
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          entered_validating_at: Date.now() - (25 * 60 * 60 * 1000),
        },
      },
    })

    sweepValidatingQueue()

    // Task should still be validating — has real PR artifact
    const check = await app.inject({ method: 'GET', url: `/tasks/${taskId}` })
    expect(JSON.parse(check.body).task.status).toBe('validating')
  })
})
