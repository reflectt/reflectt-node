import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { getDb } from '../src/db.js'
import type { FastifyInstance } from 'fastify'
import { getRecentInsightMutationAudits, _clearInsightMutationAuditLog } from '../src/insight-mutation.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

beforeEach(() => {
  process.env.REFLECTT_ENABLE_INSIGHT_MUTATION_API = 'true'
  delete process.env.REFLECTT_INSIGHT_MUTATION_TOKEN

  const db = getDb()
  db.prepare('DELETE FROM insights').run()
  _clearInsightMutationAuditLog()
})

function insertInsight(overrides: Record<string, unknown> = {}) {
  const db = getDb()
  const id = (overrides.id as string) ?? `ins-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()

  const cluster_key = (overrides.cluster_key as string) ?? 'a::b::c'
  const [workflow_stage, failure_family, impacted_unit] = cluster_key.split('::')

  db.prepare(`
    INSERT INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      task_id, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    cluster_key,
    workflow_stage,
    failure_family,
    impacted_unit,
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

describe('PATCH /insights/:id', () => {
  it('is disabled by default (403) unless explicitly enabled', async () => {
    process.env.REFLECTT_ENABLE_INSIGHT_MUTATION_API = 'false'
    const id = insertInsight()

    const res = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', status: 'closed' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('rejects missing actor/reason', async () => {
    const id = insertInsight()

    const res = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { reason: 'cleanup' },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
  })

  it('rejects immutable/unknown fields', async () => {
    const id = insertInsight()

    const res = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', score: 9 },
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toMatch(/Immutable\/unknown field/)
  })

  it('rejects non-local requests (localhost-only)', async () => {
    const id = insertInsight()

    const res = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      remoteAddress: '10.0.0.5',
      payload: { actor: 'kai', reason: 'cleanup', status: 'closed' },
    })

    expect(res.statusCode).toBe(403)
  })

  it('enforces optional admin token when configured', async () => {
    process.env.REFLECTT_INSIGHT_MUTATION_TOKEN = 'secret'
    const id = insertInsight()

    const missing = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', status: 'closed' },
    })
    expect(missing.statusCode).toBe(403)

    const ok = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      headers: { 'x-reflectt-admin-token': 'secret' },
      payload: { actor: 'kai', reason: 'cleanup', status: 'closed' },
    })
    expect(ok.statusCode).toBe(200)
  })

  it('updates status and records an audit entry (preserves NULL metadata unless explicitly set)', async () => {
    const id = insertInsight({ status: 'candidate', metadata: null })

    const res = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', status: 'closed' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.insight.status).toBe('closed')

    const row = getDb().prepare('SELECT metadata FROM insights WHERE id = ?').get(id) as { metadata: string | null }
    expect(row.metadata).toBe(null)

    const audits = getRecentInsightMutationAudits(10)
    expect(audits.length).toBeGreaterThan(0)
    expect(audits[audits.length - 1].insightId).toBe(id)
  })

  it('re-keys cluster_key and updates derived stage/family/unit', async () => {
    const id = insertInsight({ cluster_key: 'old::key::one' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', cluster_key: 'newstage::newfam::newunit' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.insight.cluster_key).toBe('newstage::newfam::newunit')
    expect(body.insight.workflow_stage).toBe('newstage')
    expect(body.insight.failure_family).toBe('newfam')
    expect(body.insight.impacted_unit).toBe('newunit')
  })

  it('rejects invalid status and invalid cluster_key format', async () => {
    const id = insertInsight()

    const badStatus = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', status: 'not-a-real-status' },
    })
    expect(badStatus.statusCode).toBe(400)

    const badKey = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', cluster_key: 'nope' },
    })
    expect(badKey.statusCode).toBe(400)
  })

  it('allows metadata.notes and rejects other metadata keys', async () => {
    const id = insertInsight()

    const ok = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', metadata: { notes: 'manual re-key' } },
    })
    expect(ok.statusCode).toBe(200)
    const okBody = JSON.parse(ok.body)
    expect(okBody.insight.metadata?.notes).toBe('manual re-key')

    const bad = await app.inject({
      method: 'PATCH',
      url: `/insights/${id}`,
      payload: { actor: 'kai', reason: 'cleanup', metadata: { surprise: 'nope' } },
    })
    expect(bad.statusCode).toBe(400)
  })
})
