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
