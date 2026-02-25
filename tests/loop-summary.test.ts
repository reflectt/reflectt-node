// Tests for GET /loop/summary — top signals from the reflection loop
import { describe, it, expect, beforeAll } from 'vitest'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'
import { getDb } from '../src/db.js'

let app: FastifyInstance

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-loop-${Date.now()}`
  app = await createServer()
  await app.ready()

  // Seed test data
  const db = getDb()
  const now = Date.now()

  // Create tasks that insights link to
  db.prepare(`
    INSERT OR REPLACE INTO tasks (id, title, status, created_by, created_at, updated_at, priority, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('task-loop-test-active', 'Fix API crash', 'doing', 'link', now, now, 'P1', '{}')

  db.prepare(`
    INSERT OR REPLACE INTO tasks (id, title, status, created_by, created_at, updated_at, priority, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('task-loop-test-done', 'Fix old bug', 'done', 'link', now - 86400000, now, 'P2', '{}')

  // Create insights with varying scores
  db.prepare(`
    INSERT OR REPLACE INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      cooldown_until, cooldown_reason, severity_max, task_id, metadata,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'ins-high-score', 'runtime::crash::api', 'runtime', 'crash', 'api',
    'API crashes under load', 'promoted', 8.5, 'P0', '["ref-1","ref-2"]', 2,
    '["error-log-1","error-log-2"]', '["link","echo"]', 'ready', 0,
    null, null, 'critical', 'task-loop-test-active', '{}',
    now - 3600000, now
  )

  db.prepare(`
    INSERT OR REPLACE INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      cooldown_until, cooldown_reason, severity_max, task_id, metadata,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'ins-low-score', 'process::docs::onboarding', 'process', 'docs', 'onboarding',
    'Onboarding docs outdated', 'candidate', 3.0, 'P3', '["ref-3"]', 1,
    '[]', '["echo"]', 'pending', 0,
    null, null, 'low', null, '{}',
    now - 7200000, now - 3600000
  )

  db.prepare(`
    INSERT OR REPLACE INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      cooldown_until, cooldown_reason, severity_max, task_id, metadata,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'ins-addressed', 'deploy::config::env', 'deploy', 'config', 'env',
    'Env vars missing in staging', 'task_created', 6.0, 'P1', '["ref-4","ref-5"]', 2,
    '["deploy-log"]', '["link","kai"]', 'ready', 0,
    null, null, 'high', 'task-loop-test-done', '{}',
    now - 86400000, now - 43200000
  )
})

describe('GET /loop/summary', () => {
  it('returns insights ranked by score', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.entries).toBeDefined()
    expect(body.entries.length).toBeGreaterThan(0)
    expect(body.filters).toBeDefined()

    // Should be ordered by score descending
    for (let i = 1; i < body.entries.length; i++) {
      expect(body.entries[i - 1].score).toBeGreaterThanOrEqual(body.entries[i].score)
    }
  })

  it('each entry shows linked task and evidence status', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary' })
    const body = JSON.parse(res.body)
    const highScore = body.entries.find((e: any) => e.insight_id === 'ins-high-score')
    expect(highScore).toBeDefined()
    expect(highScore.linked_task).toBeDefined()
    expect(highScore.linked_task.id).toBe('task-loop-test-active')
    expect(highScore.linked_task.status).toBe('doing')
    expect(highScore.evidence_count).toBe(2)
    expect(highScore.addressed).toBe(false)
  })

  it('respects limit filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary?limit=1' })
    const body = JSON.parse(res.body)
    expect(body.entries.length).toBe(1)
    expect(body.filters.limit).toBe(1)
  })

  it('respects min_score filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary?min_score=5' })
    const body = JSON.parse(res.body)
    expect(body.entries.length).toBeGreaterThan(0)
    for (const entry of body.entries) {
      expect(entry.score).toBeGreaterThanOrEqual(5)
    }
    // Low-score insight should not appear
    const low = body.entries.find((e: any) => e.insight_id === 'ins-low-score')
    expect(low).toBeUndefined()
  })

  it('respects exclude_addressed filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary?exclude_addressed=1' })
    const body = JSON.parse(res.body)
    // The addressed insight (linked to done task) should be excluded
    const addressed = body.entries.find((e: any) => e.insight_id === 'ins-addressed')
    expect(addressed).toBeUndefined()
    // Non-addressed should still appear
    const highScore = body.entries.find((e: any) => e.insight_id === 'ins-high-score')
    expect(highScore).toBeDefined()
  })

  it('shows null linked_task when no task linked', async () => {
    const res = await app.inject({ method: 'GET', url: '/loop/summary' })
    const body = JSON.parse(res.body)
    const noTask = body.entries.find((e: any) => e.insight_id === 'ins-low-score')
    expect(noTask).toBeDefined()
    expect(noTask.linked_task).toBeNull()
    expect(noTask.addressed).toBe(false)
  })
})
