// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for approval card expiry — startup sweep + approval_requested decision path.
 * task-1773603042171-oqcsfar7m
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getDb } from '../src/db.js'
import { sweepExpiredApprovalCards, appendAgentEvent, listApprovalQueue } from '../src/agent-runs.js'

beforeAll(() => {
  // Ensure DB is initialized
  getDb()
})

afterAll(() => {
  // Clean up test events
  const db = getDb()
  db.prepare("DELETE FROM agent_events WHERE agent_id LIKE 'test-expiry-%'").run()
})

describe('sweepExpiredApprovalCards', () => {
  it('sweeps undecided approval_requested events older than TTL', () => {
    const db = getDb()
    const agentId = 'test-expiry-agent'
    const runId = `test-expiry-run-${Date.now()}`
    const staleTs = Date.now() - 25 * 60 * 60 * 1000 // 25h ago — beyond 24h TTL

    // Insert stale approval_requested event
    db.prepare(`
      INSERT INTO agent_events (id, agent_id, run_id, event_type, payload, created_at)
      VALUES (?, ?, ?, 'approval_requested', '{}', ?)
    `).run(`stale-evt-${Date.now()}`, agentId, runId, staleTs)

    const pruned = sweepExpiredApprovalCards(24 * 60 * 60 * 1000)

    // At least our stale event was pruned
    expect(pruned).toBeGreaterThanOrEqual(1)

    // Verify the stale event no longer appears in approval queue
    const queue = listApprovalQueue({ agentId })
    expect(queue.every(i => i.runId !== runId)).toBe(true)
  })

  it('does not sweep recently created approval_requested events', () => {
    const agentId = `test-expiry-fresh-${Date.now()}`
    const freshRun = `test-expiry-run-fresh-${Date.now()}`
    const now = Date.now()

    // Insert fresh approval_requested event (1h old — well within 24h TTL)
    appendAgentEvent({
      agentId,
      runId: freshRun,
      eventType: 'approval_requested',
      payload: { title: 'Fresh approval', urgency: 'normal', action_required: 'approve' },
    })

    const pruned = sweepExpiredApprovalCards(24 * 60 * 60 * 1000)
    // Fresh event should not be in the pruned count
    // We can't assert exact count but can verify the event still exists in queue
    const queue = listApprovalQueue({ agentId })
    expect(queue.some(i => i.runId === freshRun)).toBe(true)
  })

  it('does not sweep already-decided approval_requested events', () => {
    const agentId = `test-expiry-decided-${Date.now()}`
    const runId = `test-expiry-run-decided-${Date.now()}`
    const db = getDb()
    const staleTs = Date.now() - 25 * 60 * 60 * 1000

    // Insert stale approval_requested and a matching approval_rejected
    const requestId = `decided-req-${Date.now()}`
    db.prepare(`
      INSERT INTO agent_events (id, agent_id, run_id, event_type, payload, created_at)
      VALUES (?, ?, ?, 'approval_requested', '{}', ?)
    `).run(requestId, agentId, runId, staleTs)
    db.prepare(`
      INSERT INTO agent_events (id, agent_id, run_id, event_type, payload, created_at)
      VALUES (?, ?, ?, 'approval_rejected', '{}', ?)
    `).run(`decided-rej-${Date.now()}`, agentId, runId, staleTs + 1000)

    // Should not prune already-decided events
    const before = db.prepare(
      "SELECT COUNT(*) as n FROM agent_events WHERE event_type = 'approval_rejected' AND agent_id = ?"
    ).get(agentId) as { n: number }

    sweepExpiredApprovalCards(24 * 60 * 60 * 1000)

    // No additional rejection event should have been added for this run
    const after = db.prepare(
      "SELECT COUNT(*) as n FROM agent_events WHERE event_type = 'approval_rejected' AND agent_id = ?"
    ).get(agentId) as { n: number }
    expect(after.n).toBe(before.n) // no new rejection for already-decided item
  })
})
