// Regression test: pipeline health should count insight merges (updated_at) not just creates
// NOTE: This test creates reflections against the LIVE server.
// Reflections don't have a DELETE endpoint, but auto-promoted tasks are cleaned up.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const BASE = 'http://127.0.0.1:4445'
let serverUp = false
const createdTaskIds: string[] = []

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })
    serverUp = res.ok
  } catch {
    serverUp = false
  }
})

afterAll(async () => {
  for (const id of createdTaskIds) {
    try {
      await fetch(`${BASE}/tasks/${id}`, { method: 'DELETE' })
    } catch { /* best-effort */ }
  }
})

describe('GET /health/reflection-pipeline', () => {
  it('returns separate created/updated/activity counters', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/health/reflection-pipeline`)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.status).toBeDefined()
    // New fields must exist
    expect(typeof data.recentInsightsCreated).toBe('number')
    expect(typeof data.recentInsightsUpdated).toBe('number')
    expect(typeof data.recentInsightActivity).toBe('number')
    // Activity = created + updated
    expect(data.recentInsightActivity).toBe(data.recentInsightsCreated + data.recentInsightsUpdated)
  })

  it('signals include insights_created and insights_updated', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/health/reflection-pipeline`)
    const data = await res.json() as any
    expect(data.signals).toBeDefined()
    expect(typeof data.signals.insights_created).toBe('boolean')
    expect(typeof data.signals.insights_updated).toBe('boolean')
    expect(typeof data.signals.insights_flowing).toBe('boolean')
  })

  it('reports healthy when reflections merge into existing insights', async (ctx) => {
    if (!serverUp) return ctx.skip()
    // Use unique nonce to avoid reflection dedup (content-hash based, 1h window)
    const nonce = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // Submit a reflection that will merge into an existing insight cluster
    const reflectionRes = await fetch(`${BASE}/reflections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author: 'link',
        role_type: 'agent',
        pain: `Pipeline health check reports broken when reflections merge into existing insight clusters instead of creating new ones [${nonce}]`,
        impact: 'False-positive SLA alerts fire, wasting review cycles on non-issues',
        evidence: [`health/reflection-pipeline showed broken with recentInsights=0 despite active ingestion [${nonce}]`],
        went_well: 'Ingestion path itself works correctly — clustering and merge logic are sound',
        suspected_why: 'Health check only counts created_at not updated_at on insights table',
        proposed_fix: 'Count both created and updated insights in health check window',
        confidence: 9,
        severity: 'medium',
        tags: ['stage:reflect', 'family:reliability', 'unit:pipeline-health'],
      }),
    })
    const reflData = await reflectionRes.json() as any
    expect(reflData.success).toBe(true)

    // Track any auto-promoted task for cleanup
    const promotedTaskId = reflData.insight?.promoted_task_id || reflData.task?.id
    if (promotedTaskId) createdTaskIds.push(promotedTaskId)

    // Now check pipeline health — should show activity (either created or updated)
    const healthRes = await fetch(`${BASE}/health/reflection-pipeline`)
    const health = await healthRes.json() as any

    // Pipeline should not be broken if we just submitted a reflection that was ingested
    expect(health.recentReflections).toBeGreaterThanOrEqual(1)
    expect(health.recentInsightActivity).toBeGreaterThanOrEqual(1)
    // The key assertion: status should NOT be 'broken' when insight activity exists
    if (health.recentInsightActivity > 0) {
      expect(health.status).not.toBe('broken')
    }
  })
})
