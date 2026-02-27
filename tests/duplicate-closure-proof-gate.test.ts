import { describe, it, expect, beforeAll } from 'vitest'
import Fastify from 'fastify'

// Regression: prevent "duplicate w/ N/A proof" tasks from entering validating/done
// by requiring canonical reference + proof text.

describe('Duplicate closure proof gate', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const mod = await import('../src/server.js')
    app = await mod.createServer()
  })

  async function createTask(overrides: Record<string, unknown> = {}) {
    const now = Date.now()
    const payload = {
      title: `TEST: duplicate-proof-gate ${now}`,
      description: 'test',
      status: 'todo',
      assignee: 'kai',
      reviewer: 'sage',
      createdBy: 'test',
      priority: 'P3',
      eta: '~5m',
      done_criteria: ['Verify duplicate-closure proof gate behavior (canonical ref + non-N/A proof required).'],
      metadata: {
        reflection_exempt: true,
        reflection_exempt_reason: 'test harness',
      },
      ...overrides,
    }

    const res = await app.inject({ method: 'POST', url: '/tasks', payload })
    expect([200, 201]).toContain(res.statusCode)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    return body.task as { id: string }
  }

  it('rejects duplicate closure in validating when canonical ref/proof are N/A', async () => {
    const t = await createTask()

    // move to doing first (state machine: todo → doing → validating)
    const start = await app.inject({
      method: 'PATCH',
      url: `/tasks/${t.id}`,
      payload: { status: 'doing', actor: 'test' },
    })
    expect(start.statusCode).toBe(200)

    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${t.id}`,
      payload: {
        status: 'validating',
        actor: 'test',
        metadata: {
          artifact_path: 'process/TASK-dupe-proof-gate.md',
          auto_close_reason: 'duplicate of shipped work',
          review_handoff: {
            task_id: t.id,
            doc_only: true,
            artifact_path: 'N/A - duplicate closure',
            test_proof: 'N/A - duplicate',
            known_caveats: 'Duplicate task closed without separate PR',
          },
        },
      },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(body.gate).toBe('duplicate_proof')
  })

  it('allows duplicate closure when canonical reference + proof text are provided', async () => {
    const canonical = await createTask({ title: `TEST: canonical ${Date.now()}` })
    const dup = await createTask({ title: `TEST: dup ${Date.now()}` })

    const start = await app.inject({
      method: 'PATCH',
      url: `/tasks/${dup.id}`,
      payload: { status: 'doing', actor: 'test' },
    })
    expect(start.statusCode).toBe(200)

    const res = await app.inject({
      method: 'PATCH',
      url: `/tasks/${dup.id}`,
      payload: {
        status: 'validating',
        actor: 'test',
        metadata: {
          artifact_path: 'process/TASK-dup-proof-gate.md',
          auto_close_reason: 'duplicate',
          duplicate_of: canonical.id,
          duplicate_proof: `Duplicate of ${canonical.id} (see artifacts)`,
          artifacts: [canonical.id],
          review_handoff: {
            task_id: dup.id,
            doc_only: true,
            artifact_path: 'process/TASK-dup-proof-gate.md',
            test_proof: `Duplicate of ${canonical.id} (see artifacts)`,
            known_caveats: 'none',
          },
        },
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('validating')
  })
})
