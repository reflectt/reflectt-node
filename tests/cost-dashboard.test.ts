// Tests for the cost dashboard endpoint and aggregation helpers
// Covers: getDailySpendByModel, getAvgCostByLane, GET /costs

import { describe, it, expect, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'
import Database from 'better-sqlite3'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'

// ── Isolated DB setup ──

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflectt-cost-test-'))
  process.env.REFLECTT_HOME = tempDir
  // Clear module cache so getDb() picks up new REFLECTT_HOME
  vi.resetModules()
})

// ── Helper: seed usage + task data ──

async function seedData() {
  const { getDb } = await import('../src/db.js')
  const { ensureUsageTables, recordUsage } = await import('../src/usage-tracking.js')

  const db = getDb()
  ensureUsageTables()

  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  // Create two tasks with known lanes
  db.prepare(`
    INSERT INTO tasks (id, title, status, created_by, created_at, updated_at, metadata)
    VALUES (?, ?, 'done', 'test', ?, ?, ?)
  `).run('task-cheap', 'Cheap Task', now - 2 * dayMs, now, JSON.stringify({ qa_bundle: { lane: 'growth' } }))

  db.prepare(`
    INSERT INTO tasks (id, title, status, created_by, created_at, updated_at, metadata)
    VALUES (?, ?, 'done', 'test', ?, ?, ?)
  `).run('task-expensive', 'Expensive Task', now - 1 * dayMs, now, JSON.stringify({ qa_bundle: { lane: 'infra' } }))

  // Seed usage events
  recordUsage({
    agent: 'attribution', task_id: 'task-cheap', model: 'claude-sonnet-4-6',
    provider: 'anthropic', input_tokens: 1000, output_tokens: 500,
    category: 'task_work', timestamp: now - 2 * dayMs,
    api_source: 'anthropic_direct',
  })

  recordUsage({
    agent: 'attribution', task_id: 'task-expensive', model: 'claude-opus-4',
    provider: 'anthropic', input_tokens: 10000, output_tokens: 5000,
    category: 'task_work', timestamp: now - 1 * dayMs,
    api_source: 'anthropic_direct',
  })

  recordUsage({
    agent: 'scout', task_id: 'task-expensive', model: 'claude-opus-4',
    provider: 'anthropic', input_tokens: 8000, output_tokens: 3000,
    category: 'task_work', timestamp: now - 1 * dayMs,
  })

  return db
}

describe('getDailySpendByModel', () => {
  it('returns rows grouped by date and model', async () => {
    await seedData()
    const { getDailySpendByModel } = await import('../src/usage-tracking.js')
    const rows = getDailySpendByModel({ days: 7 })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toHaveProperty('date')
      expect(row).toHaveProperty('model')
      expect(row).toHaveProperty('total_cost_usd')
      expect(row).toHaveProperty('event_count')
      expect(row.total_cost_usd).toBeGreaterThan(0)
    }
  })

  it('returns empty array for future window with no events', async () => {
    await seedData()
    const { getDailySpendByModel } = await import('../src/usage-tracking.js')
    // days=0 means since=now, no events in future
    const rows = getDailySpendByModel({ days: 0 })
    expect(rows).toEqual([])
  })

  it('groups sonnet and opus as separate models', async () => {
    await seedData()
    const { getDailySpendByModel } = await import('../src/usage-tracking.js')
    const rows = getDailySpendByModel({ days: 7 })
    const models = rows.map(r => r.model)
    expect(models).toContain('claude-sonnet-4-6')
    expect(models).toContain('claude-opus-4')
  })
})

describe('getAvgCostByLane', () => {
  it('returns lanes with avg cost for done tasks', async () => {
    await seedData()
    const { getAvgCostByLane } = await import('../src/usage-tracking.js')
    const rows = getAvgCostByLane({ days: 30 })
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toHaveProperty('lane')
      expect(row).toHaveProperty('avg_cost_usd')
      expect(row).toHaveProperty('total_cost_usd')
      expect(row).toHaveProperty('task_count')
      expect(row.avg_cost_usd).toBeGreaterThan(0)
    }
  })

  it('includes both seeded lanes', async () => {
    await seedData()
    const { getAvgCostByLane } = await import('../src/usage-tracking.js')
    const rows = getAvgCostByLane({ days: 30 })
    const lanes = rows.map(r => r.lane)
    expect(lanes).toContain('growth')
    expect(lanes).toContain('infra')
  })

  it('infra lane is more expensive than growth lane', async () => {
    await seedData()
    const { getAvgCostByLane } = await import('../src/usage-tracking.js')
    const rows = getAvgCostByLane({ days: 30 })
    const infra = rows.find(r => r.lane === 'infra')
    const growth = rows.find(r => r.lane === 'growth')
    expect(infra).toBeDefined()
    expect(growth).toBeDefined()
    expect(infra!.avg_cost_usd).toBeGreaterThan(growth!.avg_cost_usd)
  })
})

describe('api_source field', () => {
  it('recordUsage stores and retrieves api_source', async () => {
    const db = await seedData()
    const row = db.prepare(
      `SELECT api_source FROM model_usage WHERE task_id = 'task-cheap' LIMIT 1`
    ).get() as { api_source: string } | undefined
    expect(row?.api_source).toBe('anthropic_direct')
  })

  it('api_source is nullable', async () => {
    const db = await seedData()
    const row = db.prepare(
      `SELECT api_source FROM model_usage WHERE task_id = 'task-expensive' AND agent = 'scout' LIMIT 1`
    ).get() as { api_source: string | null } | undefined
    expect(row?.api_source).toBeNull()
  })
})
