// SPDX-License-Identifier: Apache-2.0
// End-to-end loop proof: trigger → run → decision/approval → completion
// Exercises the REAL Host API against a live server.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const BASE = process.env.TEST_HOST || 'http://127.0.0.1:4445'

async function api(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data }
}

describe('E2E Host Loop — trigger → run → decision → approval → completion', () => {
  let runId: string
  let reviewEventId: string

  it('Step 1: Create a run (trigger)', async () => {
    const { status, data } = await api('POST', '/agents/link/runs', {
      objective: 'E2E loop proof — automated test',
      teamId: 'default',
    })
    assert.equal(status, 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`)
    runId = data.id as string
    assert.ok(runId.startsWith('arun-'), `Run ID format: ${runId}`)
    assert.equal(data.status, 'idle')
    console.log(`  ✓ Run created: ${runId}`)
  })

  it('Step 2: Attach task + start work', async () => {
    // Emit task_attached event
    const { status } = await api('POST', '/agents/link/events', {
      eventType: 'task_attached',
      runId,
      payload: { taskId: 'test-task-e2e', title: 'E2E proof task' },
    })
    assert.equal(status, 201)

    // Update run to working
    const { status: s2, data } = await api('PATCH', `/agents/link/runs/${runId}`, { status: 'working' })
    assert.equal(s2, 200)
    assert.equal(data.status, 'working')
    console.log('  ✓ Run status: working')
  })

  it('Step 3: Request review (decision point)', async () => {
    const { status, data } = await api('POST', '/agents/link/events', {
      eventType: 'review_requested',
      runId,
      payload: {
        action_required: 'Approve E2E loop test',
        urgency: 'normal',
        owner: 'ryan',
        prUrl: 'https://github.com/reflectt/reflectt-node/pull/e2e-test',
      },
    })
    assert.equal(status, 201)
    reviewEventId = data.id as string
    assert.ok(reviewEventId.startsWith('aevt-'))

    // Set run to waiting_review
    const { status: s2 } = await api('PATCH', `/agents/link/runs/${runId}`, { status: 'waiting_review' })
    assert.equal(s2, 200)
    console.log(`  ✓ Review requested: ${reviewEventId}`)
  })

  it('Step 4: Approve (human decision)', async () => {
    const { status, data } = await api('POST', `/approvals/${reviewEventId}/decide`, {
      decision: 'approve',
      reviewer: 'ryan',
      comment: 'LGTM — E2E proof approved',
    })
    assert.equal(status, 200)
    console.log('  ✓ Approved by ryan')
  })

  it('Step 5: Complete run', async () => {
    // Emit completed event
    const { status } = await api('POST', '/agents/link/events', {
      eventType: 'completed',
      runId,
      payload: { summary: 'E2E loop proven — all steps passed' },
    })
    assert.equal(status, 201)

    // Mark run completed
    const { status: s2, data } = await api('PATCH', `/agents/link/runs/${runId}`, { status: 'completed' })
    assert.equal(s2, 200)
    assert.equal(data.status, 'completed')
    console.log('  ✓ Run completed')
  })

  it('Step 6: Verify full event chain', async () => {
    const { status, data } = await api('GET', `/agents/link/events?runId=${runId}`)
    assert.equal(status, 200)
    const events = data as unknown as Array<{ eventType: string }>
    const types = events.map(e => e.eventType)
    assert.ok(types.includes('task_attached'), `Missing task_attached in: ${types}`)
    assert.ok(types.includes('review_requested'), `Missing review_requested in: ${types}`)
    assert.ok(types.includes('review_approved'), `Missing review_approved in: ${types}`)
    assert.ok(types.includes('completed'), `Missing completed in: ${types}`)
    console.log(`  ✓ Full chain verified: ${types.join(' → ')}`)
  })
})
