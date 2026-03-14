/**
 * Tests for proactive approval card surfacing via canvas_push.
 *
 * Covers:
 * - validating transition emits canvas_push approval_requested event
 * - approval card has correct taskId/reviewer/prUrl fields
 * - hosts query returns hosts card with correct shape
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'
import { getDb } from '../src/db.js'
import { eventBus } from '../src/events.js'

let app: FastifyInstance
const createdIds: string[] = []

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  const db = getDb()
  for (const id of createdIds) {
    try { db.prepare('DELETE FROM tasks WHERE id = ?').run(id) } catch {}
    try { db.prepare('DELETE FROM task_comments WHERE task_id = ?').run(id) } catch {}
    try { db.prepare('DELETE FROM hosts WHERE id = ?').run(id) } catch {}
  }
  await app.close()
})

async function createDoingTask(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/tasks',
    payload: {
      title: `Approval card test ${Date.now()}`,
      assignee: 'link',
      reviewer: 'ryan',
      priority: 'P1',
      status: 'todo',
      done_criteria: ['test passes'],
      ...overrides,
    },
  })
  const body = JSON.parse(res.body)
  const taskId: string = body.task?.id ?? body.id
  // transition todo → doing
  await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, payload: { status: 'doing' } })
  createdIds.push(taskId)
  return taskId
}

describe('Approval card — canvas_push on validating transition', () => {
  it('emits canvas_push with type approval_requested when task enters validating', async () => {
    const taskId = await createDoingTask()

    const captured: unknown[] = []
    const listenerId = `test-approval-${Date.now()}`
    eventBus.on(listenerId, (event) => {
      if (event.type === 'canvas_push') captured.push(event)
    })

    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}`,
        payload: {
          status: 'validating',
          metadata: {
            review_handoff: {
              task_id: taskId,
              artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
              known_caveats: 'none',
              pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
              commit_sha: 'abc1234',
            },
            pr_integrity_override: true,
            pr_integrity_override_reason: 'test environment',
            qa_bundle: {
              lane: 'engineering',
              summary: 'Test approval card surfacing',
              review_packet: {
                task_id: taskId,
                pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
                commit: 'abc1234',
                changed_files: ['src/server.ts'],
                artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
                what_changed: 'test change',
                how_tested: 'vitest',
                caveats: 'none',
              },
            },
          },
        },
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
      expect(body.task.status).toBe('validating')
    } finally {
      eventBus.off(listenerId)
    }

    expect(captured.length).toBeGreaterThan(0)
    const approvalEvent = (captured as any[]).find(
      (e) => (e.data as any)?.type === 'approval_requested',
    )
    expect(approvalEvent).toBeDefined()
    const data = (approvalEvent as any).data
    expect(data.type).toBe('approval_requested')
    expect(data.agentId).toBe('link')
    expect(data.ttl).toBe(120000)
    expect(data.data.taskId).toBe(taskId)
    expect(data.data.reviewer).toBe('ryan')
    expect(data.data.priority).toBe('P1')
  })

  it('approval card includes prUrl when review_handoff has pr_url', async () => {
    const taskId = await createDoingTask()
    const prUrl = 'https://github.com/reflectt/reflectt-node/pull/999'

    const captured: unknown[] = []
    const listenerId = `test-approval-prurl-${Date.now()}`
    eventBus.on(listenerId, (event) => {
      if (event.type === 'canvas_push') captured.push(event)
    })

    try {
      await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}`,
        payload: {
          status: 'validating',
          metadata: {
            review_handoff: {
              task_id: taskId,
              artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
              known_caveats: 'none',
              pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
              commit_sha: 'abc1234',
            },
            pr_integrity_override: true,
            pr_integrity_override_reason: 'test environment',
            qa_bundle: {
              lane: 'engineering',
              summary: 'Test approval card',
              review_packet: {
                task_id: taskId,
                pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
                commit: 'abc1234',
                changed_files: ['src/server.ts'],
                artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
                what_changed: 'test',
                how_tested: 'vitest',
                caveats: 'none',
              },
            },
          },
        },
      })
    } finally {
      eventBus.off(listenerId)
    }

    const approvalEvent = (captured as any[]).find(
      (e) => (e.data as any)?.type === 'approval_requested',
    )
    expect(approvalEvent).toBeDefined()
    expect((approvalEvent as any).data.data.taskId).toBe(taskId)
    expect((approvalEvent as any).data.data.prUrl).toBe(prUrl)
    expect((approvalEvent as any).data.data.reviewer).toBe('ryan')
  })

  it('does not re-emit approval card when task is already validating', async () => {
    const db = getDb()
    const taskId = `task-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()
    // Insert already-validating task
    db.prepare(`INSERT INTO tasks (id, title, description, status, assignee, reviewer, priority, created_by, created_at, updated_at, done_criteria, metadata)
      VALUES (@id, @title, @description, @status, @assignee, @reviewer, @priority, @created_by, @created_at, @updated_at, @done_criteria, @metadata)`).run({
      id: taskId,
      title: `Already validating ${taskId}`,
      description: '',
      status: 'validating',
      assignee: 'link',
      reviewer: 'ryan',
      priority: 'P2',
      created_by: 'test',
      created_at: now,
      updated_at: now,
      done_criteria: JSON.stringify(['test passes']),
      metadata: JSON.stringify({
        is_test: true,
        entered_validating_at: now,
        review_state: 'queued',
        review_last_activity_at: now,
        review_handoff: {
              task_id: taskId,
              artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
              known_caveats: 'none',
              pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
              commit_sha: 'abc1234',
            },
            pr_integrity_override: true,
            pr_integrity_override_reason: 'test environment',
            qa_bundle: {
              lane: 'engineering',
              summary: 'Test approval card',
              review_packet: {
                task_id: taskId,
                pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
                commit: 'abc1234',
                changed_files: ['src/server.ts'],
                artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
                what_changed: 'test',
                how_tested: 'vitest',
                caveats: 'none',
              },
            },
      }),
    })
    createdIds.push(taskId)

    const captured: unknown[] = []
    const listenerId = `test-approval-nodup-${Date.now()}`
    eventBus.on(listenerId, (event) => {
      if (event.type === 'canvas_push' && (event.data as any)?.type === 'approval_requested') {
        captured.push(event)
      }
    })

    try {
      // Re-push to validating with delta note (required by re-review gate)
      await app.inject({
        method: 'PATCH',
        url: `/tasks/${taskId}`,
        payload: {
          status: 'validating',
          metadata: {
            review_delta_note: 'Updated based on feedback',
            review_handoff: {
              task_id: taskId,
              artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
              known_caveats: 'none',
              pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
              commit_sha: 'abc1234',
            },
            pr_integrity_override: true,
            pr_integrity_override_reason: 'test environment',
            qa_bundle: {
              lane: 'engineering',
              summary: 'Test approval card',
              review_packet: {
                task_id: taskId,
                pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
                commit: 'abc1234',
                changed_files: ['src/server.ts'],
                artifact_path: `process/TASK-${taskId.split('-').slice(-1)[0]}.md`,
                what_changed: 'test',
                how_tested: 'vitest',
                caveats: 'none',
              },
            },
          },
        },
      })
    } finally {
      eventBus.off(listenerId)
    }

    // Should NOT emit approval_requested since it was already validating
    expect(captured.length).toBe(0)
  })
})

describe('Hosts query card', () => {
  it('returns hosts card with correct shape for hosts query', async () => {
    // Register a test host directly in the db
    const db = getDb()
    const hostId = `host-test-${Date.now()}`
    const now = Date.now()
    db.prepare(`INSERT OR REPLACE INTO hosts (id, hostname, os, arch, ip, version, agents, metadata, status, last_seen_at, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      hostId, 'test-machine', 'linux', 'x64', '10.0.0.1', '1.0.0',
      JSON.stringify(['link', 'kai']), JSON.stringify({}), 'online', now, now,
    )
    createdIds.push(hostId)

    const res = await app.inject({
      method: 'POST',
      url: '/canvas/query',
      payload: { query: 'show me hosts' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.card.type).toBe('hosts')
    expect(Array.isArray(body.card.data.hosts)).toBe(true)

    const host = body.card.data.hosts.find((h: any) => h.id === hostId)
    expect(host).toBeDefined()
    expect(host.name).toBe('test-machine')
    expect(host.status).toBe('online')
    expect(host.version).toBe('1.0.0')
    expect(host.agentCount).toBe(2)
    expect(typeof host.lastSeen).toBe('number')
  })

  it('returns hosts card for "host status" query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/query',
      payload: { query: 'host status' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.card.type).toBe('hosts')
    expect(Array.isArray(body.card.data.hosts)).toBe(true)
  })

  it('returns hosts card for "server status" query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/canvas/query',
      payload: { query: 'server status' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.card.type).toBe('hosts')
  })
})

describe('Canvas push on task transitions', () => {
  it('emits canvas_push utterance when task moves todo→doing', async () => {
    const res = await app.inject({ method: 'POST', url: '/tasks', payload: { title: `Transition test ${Date.now()}`, assignee: 'kai', reviewer: 'coo', priority: 'P2', status: 'todo', done_criteria: ['done'] } })
    const taskId: string = JSON.parse(res.body).task?.id ?? JSON.parse(res.body).id
    createdIds.push(taskId)

    const captured: unknown[] = []
    const listenerId = `test-doing-${Date.now()}`
    eventBus.on(listenerId, (event) => { if (event.type === 'canvas_push') captured.push(event) })
    try {
      await app.inject({ method: 'PATCH', url: `/tasks/${taskId}`, payload: { status: 'doing' } })
    } finally {
      eventBus.off(listenerId)
    }

    const utterance = (captured as any[]).find(e => (e.data as any)?.type === 'utterance')
    expect(utterance).toBeDefined()
    expect((utterance as any).data.text).toContain('picking up')
  })

  it('emits canvas_push work_released when task moves doing→validating', async () => {
    const taskId = await createDoingTask()

    const captured: unknown[] = []
    const listenerId = `test-validating-push-${Date.now()}`
    eventBus.on(listenerId, (event) => { if (event.type === 'canvas_push') captured.push(event) })
    try {
      const shortId = taskId.split('-').slice(-1)[0]
      await app.inject({
        method: 'PATCH', url: `/tasks/${taskId}`,
        payload: {
          status: 'validating',
          metadata: {
            pr_integrity_override: true,
            pr_integrity_override_reason: 'test',
            review_handoff: { task_id: taskId, artifact_path: `process/TASK-${shortId}.md`, known_caveats: 'none', pr_url: 'https://github.com/reflectt/reflectt-node/pull/999', commit_sha: 'abc1234' },
            qa_bundle: { lane: 'engineering', summary: 'test', review_packet: { task_id: taskId, pr_url: 'https://github.com/reflectt/reflectt-node/pull/999', commit: 'abc1234', changed_files: ['src/server.ts'], artifact_path: `process/TASK-${shortId}.md`, what_changed: 'test', how_tested: 'vitest', caveats: 'none' } },
          },
        },
      })
    } finally {
      eventBus.off(listenerId)
    }

    const wr = (captured as any[]).find(e => (e.data as any)?.type === 'work_released')
    expect(wr).toBeDefined()
    expect((wr as any).data.summary).toContain('ready for review')
  })
})
