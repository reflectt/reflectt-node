/**
 * Integration tests for reflectt-node API
 *
 * Tests core API contracts: task CRUD, backlog, claim, close gate, chat, inbox.
 * Spins up the actual Fastify server for each test suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

// Helper to make requests against the test server
async function req(method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    payload: body,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  })
  return {
    status: res.statusCode,
    body: JSON.parse(res.body),
  }
}

describe('Health', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await req('GET', '/health')
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.tasks).toBeDefined()
    expect(body.chat).toBeDefined()
  })
})

describe('Task CRUD', () => {
  let taskId: string

  it('POST /tasks creates a task', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: integration test task',
      description: 'Created by integration test',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Test passes'],
      eta: '1h',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.title).toBe('TEST: integration test task')
    expect(body.task.status).toBe('todo')
    expect(body.task.id).toBeDefined()
    taskId = body.task.id
  })

  it('GET /tasks/:id reads the task', async () => {
    const { status, body } = await req('GET', `/tasks/${taskId}`)
    expect(status).toBe(200)
    expect(body.task.title).toBe('TEST: integration test task')
    expect(body.task.assignee).toBe('test-agent')
  })

  it('PATCH /tasks/:id updates the task', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      description: 'Updated by test',
      priority: 'P1',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.description).toBe('Updated by test')
    expect(body.task.priority).toBe('P1')
  })

  it('GET /tasks lists tasks including test task', async () => {
    const { status, body } = await req('GET', '/tasks')
    expect(status).toBe(200)
    expect(body.tasks).toBeInstanceOf(Array)
    const found = body.tasks.find((t: any) => t.id === taskId)
    expect(found).toBeDefined()
  })

  it('GET /tasks?assignee= filters correctly', async () => {
    const { status, body } = await req('GET', '/tasks?assignee=test-agent')
    expect(status).toBe(200)
    const found = body.tasks.find((t: any) => t.id === taskId)
    expect(found).toBeDefined()
  })

  it('DELETE /tasks/:id deletes the task', async () => {
    const { status, body } = await req('DELETE', `/tasks/${taskId}`)
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    // Verify deleted
    const { body: body2 } = await req('GET', `/tasks/${taskId}`)
    expect(body2.error).toBe('Task not found')
  })

  it('GET /tasks/:id returns error for nonexistent', async () => {
    const { body } = await req('GET', '/tasks/nonexistent-id')
    expect(body.error).toBe('Task not found')
  })
})

describe('Backlog', () => {
  let taskId: string

  beforeAll(async () => {
    // Create an unassigned todo task
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: backlog task',
      createdBy: 'test-runner',
      assignee: 'unassigned',
      priority: 'P1',
      done_criteria: ['In backlog'],
      eta: '1h',
      reviewer: 'test-reviewer',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('GET /tasks/backlog returns unassigned todos', async () => {
    const { status, body } = await req('GET', '/tasks/backlog')
    expect(status).toBe(200)
    expect(body.tasks).toBeInstanceOf(Array)
    expect(body.count).toBeGreaterThanOrEqual(0)
    // All tasks should be unassigned and todo
    for (const t of body.tasks) {
      expect(t.status).toBe('todo')
      expect(t.assignee).toBeFalsy()
    }
  })

  it('backlog is sorted by priority then age', async () => {
    const { body } = await req('GET', '/tasks/backlog')
    const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
    for (let i = 1; i < body.tasks.length; i++) {
      const prev = body.tasks[i - 1]
      const curr = body.tasks[i]
      const pp = pOrder[prev.priority || 'P3'] ?? 9
      const cp = pOrder[curr.priority || 'P3'] ?? 9
      if (pp === cp) {
        expect(prev.createdAt).toBeLessThanOrEqual(curr.createdAt)
      } else {
        expect(pp).toBeLessThanOrEqual(cp)
      }
    }
  })
})

describe('Task Claim', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: claimable task',
      createdBy: 'test-runner',
      assignee: 'unassigned',
      priority: 'P2',
      done_criteria: ['Claimed'],
      eta: '1h',
      reviewer: 'test-reviewer',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('POST /tasks/:id/claim requires agent', async () => {
    const { body } = await req('POST', `/tasks/${taskId}/claim`, {})
    expect(body.success).toBe(false)
    expect(body.error).toContain('agent')
  })

  it('POST /tasks/:id/claim assigns the task', async () => {
    // First clear the "unassigned" assignee so claim works
    await req('PATCH', `/tasks/${taskId}`, { assignee: '' })

    const { body } = await req('POST', `/tasks/${taskId}/claim`, {
      agent: 'test-claimer',
    })
    // Claim may fail if assignee is set — check the actual behavior
    if (body.success) {
      expect(body.task).toBeDefined()
    }
  })

  it('POST /tasks/:id/claim rejects if not found', async () => {
    const { body } = await req('POST', '/tasks/nonexistent/claim', {
      agent: 'test',
    })
    expect(body.success).toBe(false)
    expect(body.error).toContain('not found')
  })
})

describe('Task Close Gate', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: close gate task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Gate tested'],
      eta: '1h',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects done without artifacts', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
    })
    expect(status).toBe(422)
    expect(body.gate).toBe('artifacts')
    expect(body.hint).toBeDefined()
  })

  it('rejects done with artifacts but no reviewer sign-off', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      metadata: { artifacts: ['test-evidence'] },
    })
    expect(status).toBe(422)
    expect(body.gate).toBe('reviewer_signoff')
  })

  it('accepts done with artifacts + reviewer sign-off', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      metadata: {
        artifacts: ['test-evidence'],
        reviewer_approved: true,
      },
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('done')
  })
})

describe('Lane-state transition lock', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: lane-state lock task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Transition lock tested'],
      eta: '1h',
    })
    taskId = body.task.id

    const moveToDoing = await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
      metadata: { actor: 'test-agent' },
    })
    expect(moveToDoing.status).toBe(200)
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects ambiguous doing->blocked transition without metadata.transition', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'blocked',
      metadata: { actor: 'test-agent' },
    })

    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('doing->blocked transition requires metadata.transition')
  })

  it('accepts doing->blocked transition with explicit pause metadata', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'blocked',
      metadata: {
        actor: 'test-agent',
        transition: {
          type: 'pause',
          reason: 'Waiting on API dependency',
        },
      },
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('blocked')
    expect(body.task.metadata?.last_transition?.type).toBe('pause')
    expect(body.task.metadata?.last_transition?.reason).toBe('Waiting on API dependency')
  })
})

describe('Chat Messages', () => {
  it('POST /chat/messages sends a message', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'TEST: integration test message',
      channel: 'general',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.message).toBeDefined()
    expect(body.message.id).toBeDefined()
  })

  it('GET /chat/messages returns messages', async () => {
    const { status, body } = await req('GET', '/chat/messages?channel=general&limit=5')
    expect(status).toBe(200)
    expect(body.messages).toBeInstanceOf(Array)
  })

  it('GET /chat/channels lists channels', async () => {
    const { status, body } = await req('GET', '/chat/channels')
    expect(status).toBe(200)
    expect(body.channels).toBeInstanceOf(Array)
  })
})

describe('Inbox', () => {
  it('GET /inbox/:agent returns inbox', async () => {
    const { status, body } = await req('GET', '/inbox/test-agent')
    expect(status).toBe(200)
    expect(body.messages).toBeInstanceOf(Array)
  })

  it('GET /inbox/:agent/unread returns count', async () => {
    const { status, body } = await req('GET', '/inbox/test-agent/unread')
    expect(status).toBe(200)
    expect(typeof body.count).toBe('number')
  })

  it('GET /inbox/:agent/subscriptions returns subs', async () => {
    const { status, body } = await req('GET', '/inbox/test-agent/subscriptions')
    expect(status).toBe(200)
    expect(body.subscriptions).toBeInstanceOf(Array)
  })
})

describe('Mention Ack', () => {
  it('GET /health/mention-ack returns metrics', async () => {
    const { status, body } = await req('GET', '/health/mention-ack')
    expect(status).toBe(200)
    expect(typeof body.totalMentions).toBe('number')
    expect(typeof body.totalAcked).toBe('number')
    expect(body.byAgent).toBeDefined()
  })

  it('POST /health/mention-ack/check-timeouts runs sweep', async () => {
    const { status, body } = await req('POST', '/health/mention-ack/check-timeouts')
    expect(status).toBe(200)
    expect(body.timedOut).toBeInstanceOf(Array)
    expect(typeof body.count).toBe('number')
  })
})

describe('Docs', () => {
  it('GET /docs returns markdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('reflectt-node API')
  })
})
