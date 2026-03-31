// SPDX-License-Identifier: Apache-2.0
/**
 * Integration tests for POST /routing/simulate endpoint.
 * Covers: 12-case regression suite from ROUTING-POLICY-SIMULATOR-CONTRACT.md,
 * validation errors, batch limits.
 *
 * Hits the live server at http://127.0.0.1:4445.
 * Tests skip if the endpoint is not yet available (pre-deploy gate).
 *
 * task-1773448760141-c7bc2e1np
 */
import { describe, it, expect, beforeAll } from 'vitest'

const BASE = process.env.TEST_HOST || 'http://127.0.0.1:4445'
let endpointAvailable = false

const basePolicy = {
  aliasOwners: {
    'billing@reflectt.ai': 'echo',
    'sales@reflectt.ai': 'spark',
    'support@reflectt.ai': 'kai',
  },
  sharedInboxes: {
    'team@reflectt.ai': { owner: 'coo', assignees: ['echo', 'kai'] },
    '+15551230001': { owner: 'coo', assignees: ['kai', 'echo'] },
  },
  numberOwners: {
    '+15551239999': 'kotlin',
    '+15550001111': 'kai',
  },
  defaultOwner: 'coo',
  fallbackAssignee: 'rhythm',
  availableAgents: ['echo', 'spark', 'kai', 'coo', 'rhythm', 'kotlin'],
}

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/routing/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy: basePolicy, scenarios: [{ id: 'probe', channel: 'email', recipient: 'x@y.com' }] }),
      signal: AbortSignal.timeout(2000),
    })
    endpointAvailable = res.status !== 404
  } catch {
    endpointAvailable = false
  }
})

async function sim(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/routing/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as Record<string, unknown>
  return { status: res.status, body: data }
}

describe('POST /routing/simulate', () => {
  it('rejects missing policy', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ scenarios: [{ id: 's1', channel: 'email', recipient: 'x@y.com' }] })
    expect(r.status).toBe(400)
  })

  it('rejects empty scenarios array', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ policy: basePolicy, scenarios: [] })
    expect(r.status).toBe(400)
  })

  it('rejects >100 scenarios', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const scenarios = Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, channel: 'email', recipient: `x${i}@y.com` }))
    const r = await sim({ policy: basePolicy, scenarios })
    expect(r.status).toBe(400)
  })

  // ── 12-case regression suite ─────────────────────────────────────────────

  it('R01: alias email → ALIAS_OWNER_MATCH, direct owner, no fallback', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ policy: basePolicy, scenarios: [{ id: 'r01', channel: 'email', recipient: 'billing@reflectt.ai' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('ALIAS_OWNER_MATCH')
    expect(res.owner).toBe('echo')
    expect(res.fallback).toBe(false)
    expect(res.escalate).toBe(false)
  })

  it('R02: shared inbox email → SHARED_INBOX_ASSIGNMENT, first available assignee', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ policy: basePolicy, scenarios: [{ id: 'r02', channel: 'email', recipient: 'team@reflectt.ai' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('SHARED_INBOX_ASSIGNMENT')
    expect(res.owner).toBe('coo')
    expect(res.assignee).toBe('echo')
  })

  it('R03: number ownership SMS → NUMBER_OWNER_MATCH', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ policy: basePolicy, scenarios: [{ id: 'r03', channel: 'sms', recipient: '+15551239999' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('NUMBER_OWNER_MATCH')
    expect(res.owner).toBe('kotlin')
  })

  it('R04: shared number inbox SMS → SHARED_INBOX_ASSIGNMENT', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ policy: basePolicy, scenarios: [{ id: 'r04', channel: 'sms', recipient: '+15551230001' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('SHARED_INBOX_ASSIGNMENT')
  })

  it('R05: unknown recipient → UNKNOWN_RECIPIENT_FALLBACK', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ policy: basePolicy, scenarios: [{ id: 'r05', channel: 'email', recipient: 'nobody@reflectt.ai' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('UNKNOWN_RECIPIENT_FALLBACK')
    expect(res.fallback).toBe(true)
  })

  it('R06: unavailable alias owner → OWNER_UNAVAILABLE_FALLBACK', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const policy = { ...basePolicy, availableAgents: ['rhythm', 'coo'] }
    const r = await sim({ policy, scenarios: [{ id: 'r06', channel: 'email', recipient: 'billing@reflectt.ai' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('OWNER_UNAVAILABLE_FALLBACK')
    expect(res.fallback).toBe(true)
  })

  it('R07: alias-shared inbox conflict → CONFLICT_ALIAS_SHARED_INBOX + escalate', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const policy = {
      ...basePolicy,
      aliasOwners: { 'team@reflectt.ai': 'spark' },
      sharedInboxes: { 'team@reflectt.ai': { owner: 'coo', assignees: ['echo'] } },
    }
    const r = await sim({ policy, scenarios: [{ id: 'r07', channel: 'email', recipient: 'team@reflectt.ai' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('CONFLICT_ALIAS_SHARED_INBOX')
    expect(res.escalate).toBe(true)
  })

  it('R08: number-shared inbox conflict → CONFLICT_NUMBER_SHARED_INBOX + escalate', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const policy = { ...basePolicy, numberOwners: { '+15551230001': 'kotlin' } }
    const r = await sim({ policy, scenarios: [{ id: 'r08', channel: 'sms', recipient: '+15551230001' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('CONFLICT_NUMBER_SHARED_INBOX')
    expect(res.escalate).toBe(true)
  })

  it('R09: number owner unavailable → OWNER_UNAVAILABLE_FALLBACK', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const policy = { ...basePolicy, availableAgents: ['coo', 'echo', 'rhythm'] }
    const r = await sim({ policy, scenarios: [{ id: 'r09', channel: 'sms', recipient: '+15550001111' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('OWNER_UNAVAILABLE_FALLBACK')
    expect(res.fallback).toBe(true)
  })

  it('R10: batch — 3 mixed scenarios in one request', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({
      policy: basePolicy,
      scenarios: [
        { id: 'r10a', channel: 'email', recipient: 'billing@reflectt.ai' },
        { id: 'r10b', channel: 'sms', recipient: '+15551239999' },
        { id: 'r10c', channel: 'email', recipient: 'unknown@x.com' },
      ],
    })
    expect(r.status).toBe(200)
    expect(r.body.count).toBe(3)
    const results = r.body.results as any[]
    expect(results[0].scenarioId).toBe('r10a')
    expect(results[1].scenarioId).toBe('r10b')
    expect(results[2].reasonCode).toBe('UNKNOWN_RECIPIENT_FALLBACK')
  })

  it('R11: no availableAgents → always routes to alias owner', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const policy = { ...basePolicy, availableAgents: undefined }
    const r = await sim({ policy, scenarios: [{ id: 'r11', channel: 'email', recipient: 'billing@reflectt.ai' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res.reasonCode).toBe('ALIAS_OWNER_MATCH')
    expect(res.owner).toBe('echo')
  })

  it('R12: result shape — all required fields present', async (ctx) => {
    if (!endpointAvailable) return ctx.skip()
    const r = await sim({ policy: basePolicy, scenarios: [{ id: 'r12', channel: 'email', recipient: 'billing@reflectt.ai' }] })
    expect(r.status).toBe(200)
    const res = (r.body.results as any[])[0]
    expect(res).toHaveProperty('scenarioId')
    expect(res).toHaveProperty('owner')
    expect(res).toHaveProperty('assignee')
    expect(res).toHaveProperty('fallback')
    expect(res).toHaveProperty('escalate')
    expect(res).toHaveProperty('reasonCode')
    expect(res).toHaveProperty('rationale')
  })
})
