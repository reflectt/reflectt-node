// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { getDb } from '../src/db.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

function insertInsight(overrides: Record<string, unknown> = {}) {
  const db = getDb()
  const id = String(overrides.id ?? `ins-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const now = Date.now()

  db.prepare(`
    INSERT INTO insights (
      id, cluster_key, workflow_stage, failure_family, impacted_unit,
      title, status, score, priority, reflection_ids, independent_count,
      evidence_refs, authors, promotion_readiness, recurring_candidate,
      task_id, metadata, created_at, updated_at, cooldown_until, cooldown_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.cluster_key ?? 'testing::unit::local-admin',
    overrides.workflow_stage ?? 'testing',
    overrides.failure_family ?? 'unit',
    overrides.impacted_unit ?? 'local-admin',
    overrides.title ?? 'Local admin endpoint test insight',
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
    overrides.cooldown_until ?? null,
    overrides.cooldown_reason ?? null,
  )

  return id
}

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

beforeEach(() => {
  // Defense-in-depth: only wipe in test mode (setup.ts sets REFLECTT_HOME to temp dir)
  if (!process.env.REFLECTT_TEST_MODE) throw new Error('Refusing unscoped DELETE outside test mode')
  const db = getDb()
  try {
    db.prepare('DELETE FROM insights').run()
  } catch {
    // ok
  }
})

describe('Localhost-only insight hygiene endpoints', () => {
  it('POST /insights/:id/cooldown works on loopback and sets cooldown fields', async () => {
    const id = insertInsight()

    const res = await app.inject({
      method: 'POST',
      url: `/insights/${id}/cooldown`,
      remoteAddress: '127.0.0.1',
      payload: {
        actor: 'sage',
        reason: 'stale candidate',
        notes: 'already fixed upstream',
        cooldown_ms: 60_000,
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.insight.status).toBe('cooldown')
    expect(typeof body.insight.cooldown_until).toBe('number')
    expect(body.insight.cooldown_until).toBeGreaterThan(Date.now() - 5_000)
    expect(body.insight.cooldown_reason).toContain('stale candidate')
  })

  it('POST /insights/:id/close works on loopback', async () => {
    const id = insertInsight()

    const res = await app.inject({
      method: 'POST',
      url: `/insights/${id}/close`,
      remoteAddress: '127.0.0.1',
      payload: {
        actor: 'sage',
        reason: 'duplicate/noisy',
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.insight.status).toBe('closed')
  })

  it('rejects non-loopback callers (403)', async () => {
    const id = insertInsight()

    const res = await app.inject({
      method: 'POST',
      url: `/insights/${id}/close`,
      remoteAddress: '10.0.0.2',
      payload: {
        actor: 'sage',
        reason: 'should fail',
      },
    })

    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(String(body.error)).toMatch(/localhost-only/i)
  })
})
