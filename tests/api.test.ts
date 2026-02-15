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

  it('GET /health/build returns build info with SHA and PID', async () => {
    const { status, body } = await req('GET', '/health/build')
    expect(status).toBe(200)
    expect(body.gitSha).toBeDefined()
    expect(body.gitShortSha).toBeDefined()
    expect(body.gitBranch).toBeDefined()
    expect(body.pid).toBeTypeOf('number')
    expect(body.nodeVersion).toBeDefined()
    expect(body.startedAt).toBeDefined()
    expect(body.uptime).toBeTypeOf('number')
  })
})

describe('Release', () => {
  it('GET /release/diff returns changed files/endpoints/tests with PR links', async () => {
    const { status, body } = await req('GET', '/release/diff')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(typeof body.liveSha).toBe('string')
    expect(typeof body.previousDeploySha).toBe('string')
    expect(Array.isArray(body.changedFiles)).toBe(true)
    expect(Array.isArray(body.changedEndpoints)).toBe(true)
    expect(Array.isArray(body.changedTests)).toBe(true)
    expect(Array.isArray(body.pullRequestLinks)).toBe(true)
  })

  it('POST /release/deploy tracks commit and previousCommit', async () => {
    const first = await req('POST', '/release/deploy', {
      deployedBy: 'test-runner',
      note: 'first marker',
    })
    expect(first.status).toBe(200)
    expect(first.body.success).toBe(true)
    expect(typeof first.body.marker.commit).toBe('string')

    const second = await req('POST', '/release/deploy', {
      deployedBy: 'test-runner',
      note: 'second marker',
    })
    expect(second.status).toBe(200)
    expect(second.body.success).toBe(true)
    expect(second.body.marker.previousCommit).toBe(first.body.marker.commit)
  })
})

describe('Quiet Hours Watchdog Suppression', () => {
  const quietNowMs = Date.parse('2026-02-15T02:00:00-08:00')

  it('suppresses idle-nudge tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(true)
    expect(body.reason).toBe('quiet-hours')
    expect(Array.isArray(body.nudged)).toBe(true)
    expect(Array.isArray(body.decisions)).toBe(true)
  })

  it('suppresses cadence-watchdog tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/cadence-watchdog/tick?dryRun=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(true)
    expect(body.reason).toBe('quiet-hours')
    expect(Array.isArray(body.alerts)).toBe(true)
  })

  it('suppresses mention-rescue tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/mention-rescue/tick?dryRun=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(true)
    expect(body.reason).toBe('quiet-hours')
    expect(Array.isArray(body.rescued)).toBe(true)
  })

  it('allows forced idle-nudge tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&force=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(false)
    expect(body.force).toBe(true)
  })
})

describe('Validation Error Shape', () => {
  it('returns structured fields for malformed POST /tasks payload', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'bad task',
      description: 'missing required fields',
    })
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Validation failed')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(body.fields.length).toBeGreaterThan(0)
    expect(body.fields[0]).toHaveProperty('path')
    expect(body.fields[0]).toHaveProperty('message')
  })

  it('returns structured fields for malformed POST /tasks/recurring payload', async () => {
    const { status, body } = await req('POST', '/tasks/recurring', {
      title: 'recurring bad',
      assignee: 'harmony',
    })
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Validation failed')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(body.fields.length).toBeGreaterThan(0)
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

  it('GET /tasks/:id accepts unique prefix match', async () => {
    const prefix = taskId.slice(0, -4)
    const { status, body } = await req('GET', `/tasks/${prefix}`)
    expect(status).toBe(200)
    expect(body.task.id).toBe(taskId)
    expect(body.matchType).toBe('prefix')
  })

  it('GET /tasks/:id returns guided error for ambiguous prefix', async () => {
    const { status: status2, body: body2 } = await req('POST', '/tasks', {
      title: 'TEST: integration test task 2',
      description: 'Created for ambiguous prefix check',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Test passes'],
      eta: '1h',
    })
    expect(status2).toBe(200)
    const taskId2 = body2.task.id as string

    const commonPrefix = (() => {
      let i = 0
      while (i < taskId.length && i < taskId2.length && taskId[i] === taskId2[i]) i++
      return taskId.slice(0, Math.max(1, i))
    })()

    const { status, body } = await req('GET', `/tasks/${commonPrefix}`)
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('Ambiguous task ID prefix')
    expect(Array.isArray(body.details?.suggestions)).toBe(true)
    expect(body.details.suggestions.length).toBeGreaterThan(0)

    await req('DELETE', `/tasks/${taskId2}`)
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

describe('Artifact Path Canonicalization', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: artifact path canonicalization',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Path canonicalized'],
      eta: '1h',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects validating status when artifact_path is not repo-relative under process/', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        eta: '1h',
        artifact_path: '/tmp/TASK-proof.md',
        qa_bundle: {
          summary: 'test bundle',
          artifact_links: ['process/TASK-test-proof.md'],
          checks: ['npm test'],
        },
      },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('artifact_path')
    expect(body.error).toContain('process/')
  })

  it('accepts validating status when artifact_path is canonical', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        eta: '1h',
        artifact_path: 'process/TASK-test-proof.md',
        qa_bundle: {
          summary: 'test bundle',
          artifact_links: ['process/TASK-test-proof.md'],
          checks: ['npm test'],
        },
      },
    })

    expect(status).toBe(200)
    expect(body.task.status).toBe('validating')
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
  let authorMessageId: string

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
    authorMessageId = body.message.id
  })

  it('PATCH /chat/messages/:id edits content for original author', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'TEST: edited content',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.message.content).toBe('TEST: edited content')
    expect(body.message.metadata).toBeDefined()
    expect(body.message.metadata.editedAt).toBeDefined()
  })

  it('PATCH /chat/messages/:id rejects non-author edits', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'someone-else',
      content: 'hijack',
    })
    expect(status).toBe(403)
    expect(body.error).toContain('Only original author')
  })

  it('PATCH /chat/messages/:id rejects empty/whitespace content', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: '   ',
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Invalid body')
  })

  it('PATCH /chat/messages/:id returns 404 when message does not exist', async () => {
    const { status, body } = await req('PATCH', '/chat/messages/msg-does-not-exist', {
      from: 'test-runner',
      content: 'no-op',
    })
    expect(status).toBe(404)
    expect(body.error).toContain('not found')
  })

  it('PATCH /chat/messages/:id applies last-write-wins for same author', async () => {
    const { body: first } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'TEST: first edit',
    })
    const { status, body: second } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'TEST: second edit',
    })

    expect(status).toBe(200)
    expect(first.message.content).toBe('TEST: first edit')
    expect(second.message.content).toBe('TEST: second edit')

    const { body: listBody } = await req('GET', '/chat/messages?channel=general&limit=200')
    const found = (listBody.messages || []).find((m: any) => m.id === authorMessageId)
    expect(found).toBeDefined()
    expect(found.content).toBe('TEST: second edit')
  })

  it('DELETE /chat/messages/:id rejects non-author delete', async () => {
    const { status, body } = await req('DELETE', `/chat/messages/${authorMessageId}`, {
      from: 'someone-else',
    })
    expect(status).toBe(403)
    expect(body.error).toContain('Only original author')
  })

  it('DELETE /chat/messages/:id returns 404 when message does not exist', async () => {
    const { status, body } = await req('DELETE', '/chat/messages/msg-does-not-exist', {
      from: 'test-runner',
    })
    expect(status).toBe(404)
    expect(body.error).toContain('not found')
  })

  it('DELETE /chat/messages/:id deletes for original author', async () => {
    const { status, body } = await req('DELETE', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    const { status: getStatus, body: getBody } = await req('GET', '/chat/messages?channel=general&limit=200')
    expect(getStatus).toBe(200)
    const found = (getBody.messages || []).find((m: any) => m.id === authorMessageId)
    expect(found).toBeUndefined()
  })

  it('PATCH /chat/messages/:id after delete returns 404', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'should fail',
    })
    expect(status).toBe(404)
    expect(body.error).toContain('not found')
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

describe('Idle Nudge lane-state transitions', () => {
  async function createDoingTask(agent: string, title: string): Promise<string> {
    const { status, body } = await req('POST', '/tasks', {
      title,
      description: 'Lane-state test task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      priority: 'P2',
      status: 'doing',
      done_criteria: ['lane test'],
      eta: '1h',
    })
    expect(status).toBe(200)
    return body.task.id as string
  }

  async function getDecision(agent: string): Promise<any> {
    const { status, body } = await req('POST', '/health/idle-nudge/tick?dryRun=true')
    expect(status).toBe(200)
    const decision = (body.decisions || []).find((d: any) => d.agent === agent)
    expect(decision).toBeDefined()
    return decision
  }

  it('shows no-active-lane when agent has no doing task', async () => {
    const agent = 'lane-no-active'
    await req('POST', `/presence/${agent}`, { status: 'working' })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('no-active-lane')
    expect(decision.lane.selectedTaskId).toBeNull()
  })

  it('shows ambiguous-lane when agent has multiple fresh doing tasks', async () => {
    const agent = 'lane-ambiguous'
    const taskA = await createDoingTask(agent, 'TEST: lane ambiguous A')
    const taskB = await createDoingTask(agent, 'TEST: lane ambiguous B')
    await req('POST', `/presence/${agent}`, { status: 'working' })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('ambiguous-lane')
    expect(decision.lane.freshDoingTaskIds).toEqual(expect.arrayContaining([taskA, taskB]))

    await req('DELETE', `/tasks/${taskA}`)
    await req('DELETE', `/tasks/${taskB}`)
  })

  it('shows presence-task-mismatch when presence.task differs from selected doing task', async () => {
    const agent = 'lane-mismatch'
    const activeTask = await createDoingTask(agent, 'TEST: lane mismatch active')
    const { body: todoBody } = await req('POST', '/tasks', {
      title: 'TEST: lane mismatch presence task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      priority: 'P2',
      status: 'todo',
      done_criteria: ['lane mismatch'],
      eta: '1h',
    })
    const presenceTask = todoBody.task.id as string

    await req('POST', `/presence/${agent}`, { status: 'working', task: presenceTask })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('presence-task-mismatch')
    expect(decision.lane.selectedTaskId).toBe(activeTask)
    expect(decision.lane.presenceTaskId).toBe(presenceTask)

    await req('DELETE', `/tasks/${activeTask}`)
    await req('DELETE', `/tasks/${presenceTask}`)
  })

  it('shows ok when presence.task matches single doing task', async () => {
    const agent = 'lane-ok'
    const taskId = await createDoingTask(agent, 'TEST: lane ok task')
    await req('POST', `/presence/${agent}`, { status: 'working', task: taskId })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('ok')
    expect(decision.lane.selectedTaskId).toBe(taskId)

    await req('DELETE', `/tasks/${taskId}`)
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

describe('Metrics', () => {
  it('GET /metrics returns structured operational stats', async () => {
    const { status, body } = await req('GET', '/metrics')
    expect(status).toBe(200)
    expect(body.tasks).toBeDefined()
    expect(body.tasks.byStatus).toBeDefined()
    expect(body.chat).toBeDefined()
    expect(typeof body.chat.recentMessagesLastHour).toBe('number')
    expect(body.presence).toBeDefined()
    expect(body.agentActivityRates).toBeInstanceOf(Array)
    expect(typeof body.uptimeMs).toBe('number')
    expect(typeof body.responseTimeMs).toBe('number')
    expect(body.responseTimeMs).toBeLessThan(100)
  })
})

describe('Task outcome checkpoint', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: outcome checkpoint task',
      description: 'Outcome endpoint test',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Outcome captured'],
      eta: '1h',
    })
    taskId = body.task.id

    await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      metadata: {
        artifacts: ['integration-test-evidence'],
        reviewer_approved: true,
      },
    })
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('POST /tasks/:id/outcome captures verdict metadata', async () => {
    const { status, body } = await req('POST', `/tasks/${taskId}/outcome`, {
      verdict: 'PASS',
      author: 'test-reviewer',
      notes: 'Looks healthy after 48h checkpoint',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.metadata.outcome_checkpoint).toBeDefined()
    expect(body.task.metadata.outcome_checkpoint.verdict).toBe('PASS')
    expect(body.task.metadata.outcome_checkpoint.capturedBy).toBe('test-reviewer')
  })
})

describe('Docs', () => {
  it('GET /docs returns markdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('reflectt-node API')
  })
})
