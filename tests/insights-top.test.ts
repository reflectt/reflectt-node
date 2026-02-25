// Tests for GET /insights/top — top pain clusters with task linkage
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { getDb } from '../src/db.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

function insertInsight(overrides: Record<string, unknown> = {}) {
  const db = getDb()
  const id = `ins-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  db.prepare(`
    INSERT INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      task_id, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.id ?? id,
    overrides.cluster_key ?? 'testing::unit::default',
    overrides.workflow_stage ?? 'testing',
    overrides.failure_family ?? 'unit',
    overrides.impacted_unit ?? 'default',
    overrides.title ?? 'Test insight',
    overrides.status ?? 'candidate',
    overrides.score ?? 5,
    overrides.priority ?? 'P2',
    overrides.reflection_ids ?? '[]',
    overrides.independent_count ?? 1,
    overrides.evidence_refs ?? '[]',
    overrides.authors ?? '["test"]',
    overrides.promotion_readiness ?? 'not_ready',
    overrides.recurring_candidate ?? 0,
    overrides.task_id ?? null,
    overrides.metadata ?? null,
    overrides.created_at ?? now,
    overrides.updated_at ?? now,
  )
  return id
}

describe('GET /insights/top', () => {
  const uniqueTag = Date.now().toString(36)

  it('returns clusters grouped by cluster_key with correct shape', async () => {
    const ck = `top-test::shape::${uniqueTag}`
    insertInsight({ cluster_key: ck, score: 8 })
    insertInsight({ cluster_key: ck, score: 6 })

    const res = await app.inject({ method: 'GET', url: '/insights/top' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(body).toHaveProperty('clusters')
    expect(body).toHaveProperty('window')
    expect(body).toHaveProperty('since')
    expect(body).toHaveProperty('limit')

    const cluster = body.clusters.find((c: any) => c.cluster_key === ck)
    expect(cluster).toBeDefined()
    expect(cluster.count).toBe(2)
    expect(cluster.avg_score).toBe(7)
    expect(cluster.linked_task_ids).toBeInstanceOf(Array)
    expect(typeof cluster.last_seen_at).toBe('number')
  })

  it('parses window parameter correctly (24h)', async () => {
    const ck = `top-test::window::${uniqueTag}`
    // Insert one insight now and one 48h ago
    insertInsight({ cluster_key: ck, score: 5 })
    const oldTs = Date.now() - 48 * 60 * 60 * 1000
    insertInsight({ cluster_key: ck, score: 5, created_at: oldTs, updated_at: oldTs })

    const res = await app.inject({ method: 'GET', url: '/insights/top?window=24h' })
    const body = JSON.parse(res.body)

    const cluster = body.clusters.find((c: any) => c.cluster_key === ck)
    // Only the recent one should be included
    expect(cluster?.count ?? 0).toBe(1)
  })

  it('parses window=30d', async () => {
    const ck = `top-test::30d::${uniqueTag}`
    insertInsight({ cluster_key: ck, score: 7 })

    const res = await app.inject({ method: 'GET', url: '/insights/top?window=30d' })
    const body = JSON.parse(res.body)
    expect(body.window).toBe('30d')
    const cluster = body.clusters.find((c: any) => c.cluster_key === ck)
    expect(cluster).toBeDefined()
  })

  it('respects limit parameter', async () => {
    // Insert insights for 3 different clusters
    for (let i = 0; i < 3; i++) {
      insertInsight({ cluster_key: `top-test::limit${i}::${uniqueTag}`, score: 5 + i })
    }

    const res = await app.inject({ method: 'GET', url: '/insights/top?limit=2' })
    const body = JSON.parse(res.body)
    expect(body.clusters.length).toBeLessThanOrEqual(2)
    expect(body.limit).toBe(2)
  })

  it('includes linked_task_ids and deduplicates', async () => {
    const ck = `top-test::tasks::${uniqueTag}`
    insertInsight({ cluster_key: ck, task_id: 'task-aaa', score: 6 })
    insertInsight({ cluster_key: ck, task_id: 'task-aaa', score: 7 }) // duplicate
    insertInsight({ cluster_key: ck, task_id: 'task-bbb', score: 8 })
    insertInsight({ cluster_key: ck, task_id: null, score: 4 }) // no task

    const res = await app.inject({ method: 'GET', url: '/insights/top' })
    const body = JSON.parse(res.body)
    const cluster = body.clusters.find((c: any) => c.cluster_key === ck)
    expect(cluster).toBeDefined()
    expect(cluster.count).toBe(4)
    expect(cluster.linked_task_ids).toContain('task-aaa')
    expect(cluster.linked_task_ids).toContain('task-bbb')
    expect(cluster.linked_task_ids.length).toBe(2) // deduplicated
  })

  it('orders by count desc then avg_score desc', async () => {
    const ckMany = `top-test::order-many::${uniqueTag}`
    const ckFew = `top-test::order-few::${uniqueTag}`
    insertInsight({ cluster_key: ckMany, score: 3 })
    insertInsight({ cluster_key: ckMany, score: 3 })
    insertInsight({ cluster_key: ckMany, score: 3 })
    insertInsight({ cluster_key: ckFew, score: 10 })

    const res = await app.inject({ method: 'GET', url: '/insights/top?limit=50' })
    const body = JSON.parse(res.body)
    const manyIdx = body.clusters.findIndex((c: any) => c.cluster_key === ckMany)
    const fewIdx = body.clusters.findIndex((c: any) => c.cluster_key === ckFew)
    // Many-count cluster should come before few-count
    expect(manyIdx).toBeLessThan(fewIdx)
  })

  it('defaults to window=7d and limit=10', async () => {
    const res = await app.inject({ method: 'GET', url: '/insights/top' })
    const body = JSON.parse(res.body)
    expect(body.window).toBe('7d')
    expect(body.limit).toBe(10)
  })
})
