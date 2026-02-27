import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import { setTestRoles } from '../src/assignment.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
const createdIds: string[] = []

beforeAll(async () => {
  setTestRoles([
    {
      name: 'main',
      role: 'generalist',
      description: 'OpenClaw agent identity used for multiple roles',
      aliases: ['finance-agent', 'legal-agent'],
      affinityTags: ['general'],
      wipCap: 3,
    },
    {
      name: 'link',
      role: 'builder',
      description: 'reviewer',
      affinityTags: ['backend'],
      wipCap: 3,
    },
  ])

  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  // Best-effort cleanup: delete tasks created in this suite.
  try {
    for (const id of createdIds) {
      await app.inject({ method: 'DELETE', url: `/tasks/${id}` })
    }
  } catch {
    // ignore
  }

  await app.close()
  setTestRoles(null)
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

describe('agent identity aliases', () => {
  it('allows /tasks/next to pull tasks assigned to an alias', async () => {
    const created = await req('POST', '/tasks', {
      title: 'ALIAS-SUITE: alias pull task',
      createdBy: 'test',
      assignee: 'finance-agent',
      reviewer: 'link',
      eta: '~1h',
      priority: 'P1',
      done_criteria: ['ok'],
      metadata: { reflection_exempt: true, reflection_exempt_reason: 'test' },
    })
    expect(created.status).toBe(200)

    const id = created.body?.task?.id
    expect(typeof id).toBe('string')
    createdIds.push(id)

    const next = await req('GET', '/tasks/next?agent=main')
    expect(next.status).toBe(200)
    expect(next.body?.task?.id).toBe(id)
  })

  it('allows /tasks/active and /heartbeat to reflect alias-assigned doing tasks', async () => {
    const created = await req('POST', '/tasks', {
      title: 'ALIAS-SUITE: alias doing task',
      createdBy: 'test',
      assignee: 'legal-agent',
      reviewer: 'link',
      eta: '~1h',
      priority: 'P1',
      done_criteria: ['ok'],
      metadata: { reflection_exempt: true, reflection_exempt_reason: 'test' },
    })

    const id = created.body?.task?.id as string
    createdIds.push(id)

    // Move to doing (keep assignee as alias)
    const patched = await req('PATCH', `/tasks/${id}`, {
      status: 'doing',
      metadata: { transition: { type: 'claim', reason: 'test' }, eta: '~1h' },
    })
    expect(patched.status).toBe(200)

    const active = await req('GET', '/tasks/active?agent=main')
    expect(active.status).toBe(200)
    expect(active.body?.task?.id).toBe(id)

    const hb = await req('GET', '/heartbeat/main')
    expect(hb.status).toBe(200)
    expect(hb.body?.active?.id).toBe(id)
  })
})
