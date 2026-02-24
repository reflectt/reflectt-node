/**
 * Comms policy enforcement tests
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
  // Best-effort cleanup of TEST: tasks
  try {
    const res = await app.inject({ method: 'GET', url: '/tasks?limit=500' })
    const tasks = JSON.parse(res.body)?.tasks || []
    for (const task of tasks) {
      if (typeof task.title === 'string' && task.title.startsWith('TEST:')) {
        await app.inject({ method: 'DELETE', url: `/tasks/${task.id}` })
      }
    }
  } catch {
    // ignore
  }
  await app.close()
})

async function req(method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    payload: body,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  })
  return { status: res.statusCode, body: JSON.parse(res.body) }
}

describe('comms_policy: silent_until_restart_or_promote_due', () => {
  it('stores uncategorized comments but suppresses them from default feeds', async () => {
    const unique = `COMMS_${Date.now()}`

    const { status: createStatus, body: createBody } = await req('POST', '/tasks', {
      title: `TEST: comms policy task ${unique}`,
      createdBy: 'test-runner',
      assignee: 'agent-a',
      reviewer: 'agent-b',
      done_criteria: ['comms policy'],
      eta: '~15m',
      metadata: {
        comms_policy: { rule: 'silent_until_restart_or_promote_due' },
      },
    })
    expect(createStatus).toBe(200)
    const taskId = createBody.task.id

    const suppressedContent = `progress update ${unique}`
    const { status: cStatus, body: cBody } = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'agent-a',
      content: suppressedContent,
    })
    expect(cStatus).toBe(200)
    expect(cBody.success).toBe(true)
    expect(cBody.comment).toBeDefined()
    expect(cBody.comment.suppressed).toBe(true)
    expect(String(cBody.comment.suppressedReason || '')).toContain('missing_category')

    // Default comments feed excludes suppressed comments
    const { status: gStatus, body: gBody } = await req('GET', `/tasks/${taskId}/comments`)
    expect(gStatus).toBe(200)
    expect(gBody.includeSuppressed).toBe(false)
    expect(gBody.comments.length).toBe(0)

    // includeSuppressed=true shows suppressed comments
    const { status: g2Status, body: g2Body } = await req('GET', `/tasks/${taskId}/comments?includeSuppressed=true`)
    expect(g2Status).toBe(200)
    expect(g2Body.includeSuppressed).toBe(true)
    expect(g2Body.comments.length).toBe(1)
    expect(g2Body.comments[0].content).toBe(suppressedContent)
    expect(g2Body.comments[0].suppressed).toBe(true)

    // Suppressed comments should not relay to task-comments channel
    const { body: chatBody } = await req('GET', '/chat/messages?channel=task-comments&limit=50')
    const relayMsgs = chatBody.messages || []
    const found = relayMsgs.find((m: any) => typeof m.content === 'string' && m.content.includes(unique))
    expect(found).toBeUndefined()

    // Whitelisted category should be visible by default
    const allowedContent = `restart now ${unique}`
    const { status: aStatus, body: aBody } = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'agent-a',
      content: allowedContent,
      category: 'restart',
    })
    expect(aStatus).toBe(200)
    expect(aBody.comment.suppressed).toBe(false)
    expect(aBody.comment.category).toBe('restart')

    const { body: g3Body } = await req('GET', `/tasks/${taskId}/comments`)
    expect(g3Body.comments.length).toBe(1)
    expect(g3Body.comments[0].content).toBe(allowedContent)

    const { body: g4Body } = await req('GET', `/tasks/${taskId}/comments?includeSuppressed=1`)
    expect(g4Body.comments.length).toBe(2)

    // Allowed comment should relay to task-comments channel
    const { body: chatBody2 } = await req('GET', '/chat/messages?channel=task-comments&limit=50')
    const relayMsgs2 = chatBody2.messages || []
    const found2 = relayMsgs2.find((m: any) => typeof m.content === 'string' && m.content.includes(allowedContent))
    expect(found2).toBeDefined()

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('does not suppress comments for tasks without comms_policy', async () => {
    const unique = `NOPOLICY_${Date.now()}`
    const { body: createBody } = await req('POST', '/tasks', {
      title: `TEST: no comms policy ${unique}`,
      createdBy: 'test-runner',
      assignee: 'agent-a',
      reviewer: 'agent-b',
      done_criteria: ['no policy'],
      eta: '~15m',
    })
    const taskId = createBody.task.id

    const content = `regular update ${unique}`
    const { body: cBody } = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'agent-a',
      content,
    })
    expect(cBody.success).toBe(true)
    expect(cBody.comment.suppressed).toBe(false)

    const { body: gBody } = await req('GET', `/tasks/${taskId}/comments`)
    expect(gBody.comments.length).toBe(1)
    expect(gBody.comments[0].content).toBe(content)

    await req('DELETE', `/tasks/${taskId}`)
  })
})
