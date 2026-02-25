// Working contract enforcement tests
// Verifies: auto-requeue, reflection gate, warning lifecycle, API endpoints
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import {
  tickWorkingContract,
  checkClaimGate,
  _clearWarnings,
} from '../src/working-contract.js'
import { getDb } from '../src/db.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

beforeEach(() => {
  _clearWarnings()
})

describe('Working contract enforcement', () => {
  it('tick returns structured result', async () => {
    const result = await tickWorkingContract()
    expect(result).toHaveProperty('warnings')
    expect(result).toHaveProperty('requeued')
    expect(result).toHaveProperty('actions')
    expect(result.actions).toBeInstanceOf(Array)
  })

  it('checkClaimGate allows agents with no reflection tracking', () => {
    const result = checkClaimGate('fresh-agent-' + Date.now())
    expect(result.allowed).toBe(true)
  })

  it('checkClaimGate blocks agents with overdue reflections', () => {
    const agent = `overdue-agent-${Date.now()}`
    const db = getDb()

    // Insert tracking row: 3 tasks done, last reflection 10 hours ago
    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000
    db.prepare(`
      INSERT OR REPLACE INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
      VALUES (?, ?, 3, ?)
    `).run(agent, tenHoursAgo, Date.now())

    const result = checkClaimGate(agent)
    expect(result.allowed).toBe(false)
    expect(result.gate).toBe('reflection_overdue')
    expect(result.reflectionsDue).toBe(3)
  })

  it('checkClaimGate allows agents who recently reflected', () => {
    const agent = `recent-reflect-${Date.now()}`
    const db = getDb()

    // 1 task done, reflected 30 min ago
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000
    db.prepare(`
      INSERT OR REPLACE INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
      VALUES (?, ?, 1, ?)
    `).run(agent, thirtyMinAgo, Date.now())

    const result = checkClaimGate(agent)
    expect(result.allowed).toBe(true)
  })

  it('checkClaimGate allows agents with many tasks but recent reflection', () => {
    const agent = `productive-${Date.now()}`
    const db = getDb()

    // 5 tasks done but reflected 1 hour ago
    const oneHourAgo = Date.now() - 1 * 60 * 60 * 1000
    db.prepare(`
      INSERT OR REPLACE INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
      VALUES (?, ?, 5, ?)
    `).run(agent, oneHourAgo, Date.now())

    const result = checkClaimGate(agent)
    expect(result.allowed).toBe(true)
  })

  it('checkClaimGate reconciles stale tracking when a newer reflection exists', async () => {
    const agent = `stale-reflect-${Date.now()}`
    const db = getDb()

    // Stale tracking: looks overdue
    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000
    db.prepare(`
      INSERT OR REPLACE INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
      VALUES (?, ?, 3, ?)
    `).run(agent, tenHoursAgo, Date.now())

    // Create a reflection via direct DB insert path (createReflection) WITHOUT calling onReflectionSubmitted
    // This simulates reflections ingested via non-HTTP sync paths.
    const { createReflection } = await import('../src/reflections.js')
    const reflection = createReflection({
      pain: 'stale tracking test',
      impact: 'gate should not block',
      evidence: ['test'],
      went_well: 'n/a',
      suspected_why: 'n/a',
      proposed_fix: 'reconcile using reflections table',
      confidence: 7,
      role_type: 'agent',
      author: agent,
    })

    const result = checkClaimGate(agent)
    expect(result.allowed).toBe(true)

    const row = db.prepare('SELECT * FROM reflection_tracking WHERE agent = ?').get(agent) as any
    expect(row).toBeDefined()
    expect(row.tasks_done_since_reflection).toBe(0)
    expect(row.last_reflection_at).toBe(reflection.created_at)
  })
})

describe('Working contract API endpoints', () => {
  it('POST /health/working-contract/tick returns enforcement result', async () => {
    const res = await app.inject({ method: 'POST', url: '/health/working-contract/tick' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body).toHaveProperty('warnings')
    expect(body).toHaveProperty('requeued')
    expect(body).toHaveProperty('actions')
  })

  it('GET /health/working-contract/gate/:agent returns gate check', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/working-contract/gate/test-agent-123' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('allowed')
    expect(body.allowed).toBe(true)
  })

  it('gate endpoint returns block for overdue agent', async () => {
    const agent = `api-gate-${Date.now()}`
    const db = getDb()
    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000
    db.prepare(`
      INSERT OR REPLACE INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
      VALUES (?, ?, 4, ?)
    `).run(agent, tenHoursAgo, Date.now())

    const res = await app.inject({ method: 'GET', url: `/health/working-contract/gate/${agent}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.allowed).toBe(false)
    expect(body.gate).toBe('reflection_overdue')
  })
})

describe('Reflection tracking debug endpoint', () => {
  it('GET /reflections/tracking/:agent returns tracking state for unknown agent', async () => {
    const agent = `unknown-agent-${Date.now()}`
    const res = await app.inject({ method: 'GET', url: `/reflections/tracking/${agent}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.agent).toBe(agent)
    expect(body.tracking).toBeNull()
    expect(body.latest_reflection).toBeNull()
    expect(body.stale).toBe(false)
    expect(body.gate_would_block).toBe(false)
  })

  it('GET /reflections/tracking/:agent detects stale tracking', async () => {
    const agent = `stale-debug-${Date.now()}`
    const db = getDb()

    // Stale tracking row: overdue
    const tenHoursAgo = Date.now() - 10 * 60 * 60 * 1000
    db.prepare(`
      INSERT OR REPLACE INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
      VALUES (?, ?, 3, ?)
    `).run(agent, tenHoursAgo, Date.now())

    // Insert a recent reflection
    const { createReflection } = await import('../src/reflections.js')
    createReflection({
      pain: 'debug endpoint stale test',
      impact: 'verifies stale detection',
      evidence: ['test'],
      went_well: 'n/a',
      suspected_why: 'n/a',
      proposed_fix: 'check endpoint',
      confidence: 7,
      role_type: 'agent',
      author: agent,
    })

    const res = await app.inject({ method: 'GET', url: `/reflections/tracking/${agent}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.agent).toBe(agent)
    expect(body.stale).toBe(true)
    expect(body.gate_would_block).toBe(true)
    expect(body.reconciliation_available).toBe(true)
    expect(body.latest_reflection).toBeDefined()
    expect(body.latest_reflection.author).toBe(agent)
  })

  it('GET /reflections/tracking/:agent shows healthy state', async () => {
    const agent = `healthy-debug-${Date.now()}`
    const db = getDb()

    // Recent tracking: no overdue
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000
    db.prepare(`
      INSERT OR REPLACE INTO reflection_tracking (agent, last_reflection_at, tasks_done_since_reflection, updated_at)
      VALUES (?, ?, 1, ?)
    `).run(agent, thirtyMinAgo, Date.now())

    const res = await app.inject({ method: 'GET', url: `/reflections/tracking/${agent}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.agent).toBe(agent)
    expect(body.stale).toBe(false)
    expect(body.gate_would_block).toBe(false)
    expect(body.reconciliation_available).toBe(false)
  })
})
