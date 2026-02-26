/**
 * Tests for GET /bootstrap/heartbeat/:agent — dynamic heartbeat config generation.
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

const AGENT = 'bootstrap-test-agent'

describe('GET /bootstrap/heartbeat/:agent', () => {
  it('returns markdown content for a valid agent', async () => {
    const res = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    expect(res.status).toBe(200)
    expect(res.body.agent).toBe(AGENT)
    expect(res.body.content).toContain(`# HEARTBEAT.md — ${AGENT}`)
    expect(res.body.content).toContain('## Priority Order')
    expect(res.body.content).toContain('## Comms Protocol')
    expect(res.body.content).toContain('## Rules')
    expect(res.body.content).toContain('HEARTBEAT_OK')
  })

  it('includes version stamp', async () => {
    const res = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    expect(res.body.version).toBeDefined()
    expect(typeof res.body.version).toBe('string')
    expect(res.body.content).toContain(`reflectt-node v${res.body.version}`)
  })

  it('includes content_hash for change detection', async () => {
    const res = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    expect(res.body.content_hash).toBeDefined()
    expect(typeof res.body.content_hash).toBe('string')
    expect(res.body.content_hash.length).toBe(16)
  })

  it('returns stable content_hash for same agent', async () => {
    const res1 = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    const res2 = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    expect(res1.body.content_hash).toBe(res2.body.content_hash)
  })

  it('returns different content for different agents', async () => {
    const res1 = await req('GET', `/bootstrap/heartbeat/alice`)
    const res2 = await req('GET', `/bootstrap/heartbeat/bob`)
    expect(res1.body.content).toContain('# HEARTBEAT.md — alice')
    expect(res2.body.content).toContain('# HEARTBEAT.md — bob')
    expect(res1.body.content_hash).not.toBe(res2.body.content_hash)
  })

  it('references correct API endpoints for the agent', async () => {
    const res = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    const content = res.body.content as string
    expect(content).toContain(`/tasks/active?agent=${AGENT}`)
    expect(content).toContain(`/tasks/next?agent=${AGENT}`)
    expect(content).toContain(`/inbox/${AGENT}`)
    expect(content).toContain('compact=true')
  })

  it('includes re-fetch instruction', async () => {
    const res = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    expect(res.body.content).toContain(`GET /bootstrap/heartbeat/${AGENT}`)
  })

  it('includes generated_at timestamp', async () => {
    const before = Date.now()
    const res = await req('GET', `/bootstrap/heartbeat/${AGENT}`)
    const after = Date.now()
    expect(res.body.generated_at).toBeGreaterThanOrEqual(before)
    expect(res.body.generated_at).toBeLessThanOrEqual(after)
  })

  it('detects active lane from doing tasks', async () => {
    const laneAgent = 'bootstrap-lane-' + Date.now()
    // Create a doing task with wip_override to bypass WIP cap.
    // Avoid is_test metadata so listTasks() doesn't filter it out.
    const created = await req('POST', '/tasks', {
      title: 'Bootstrap lane detection task',
      status: 'doing',
      assignee: laneAgent,
      priority: 'P2',
      done_criteria: ['verify lane detection'],
      eta: '1h',
      createdBy: laneAgent,
      metadata: {
        wip_override: true,
        lane: 'frontend',
        eta: '1h',
      },
    })
    // Verify creation succeeded
    expect(created.body.task).toBeDefined()

    const res = await req('GET', `/bootstrap/heartbeat/${laneAgent}`)
    expect(res.body.lane).toBe('frontend')
  })

  it('defaults lane to general when no doing tasks', async () => {
    const res = await req('GET', `/bootstrap/heartbeat/no-tasks-agent`)
    expect(res.body.lane).toBe('general')
  })
})
