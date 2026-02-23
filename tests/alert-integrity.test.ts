import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { AlertIntegrityGuard } from '../src/alert-integrity.js'
import { taskManager } from '../src/tasks.js'
import { createServer } from '../src/server.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  try { await app.close() } catch { /* ignore */ }
})

// Helper: create a task for testing
async function createTestTask(overrides: Record<string, unknown> = {}) {
  const status = overrides.status as string || 'doing'
  const metadata: Record<string, unknown> = {
    eta: '~1h',
    reflection_exempt: true,
    reflection_exempt_reason: 'test task',
    ...(status === 'validating' || status === 'done' ? { artifact_path: 'process/test-artifact.md' } : {}),
    ...(overrides.metadata as Record<string, unknown> || {}),
  }
  return taskManager.createTask({
    title: overrides.title as string || `Test task for alert integrity ${Date.now()}`,
    status,
    assignee: overrides.assignee as string || 'link',
    reviewer: overrides.reviewer as string || 'sage',
    priority: 'P1',
    createdBy: 'test',
    done_criteria: ['test done criteria met'],
    metadata,
  })
}

describe('AlertIntegrityGuard', () => {
  let guard: AlertIntegrityGuard

  beforeEach(() => {
    guard = new AlertIntegrityGuard({ canaryMode: false })
  })

  describe('preflight — basic flow', () => {
    it('allows alert when task exists and state matches', async () => {
      const task = await createTestTask()
      const result = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Test alert',
        from: 'system',
      })
      expect(result.allowed).toBe(true)
      expect(result.reasonCode).toBe('allowed')
      expect(result.liveState).toBeDefined()
      expect(result.liveState!.status).toBe('doing')
    })

    it('suppresses alert when task not found', () => {
      const result = guard.preflight({
        taskId: 'task-nonexistent-123',
        alertType: 'watchdog',
        content: 'Test alert',
        from: 'system',
      })
      expect(result.allowed).toBe(false)
      expect(result.reasonCode).toBe('task_not_found')
    })

    it('suppresses alert when task is done', async () => {
      const task = await createTestTask({ status: 'done' })
      const result = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Stale alert for done task',
        from: 'system',
      })
      expect(result.allowed).toBe(false)
      expect(result.reasonCode).toBe('task_done')
    })

    it('allows escalation even for done tasks', async () => {
      const task = await createTestTask({ status: 'done' })
      const result = guard.preflight({
        taskId: task.id,
        alertType: 'escalation',
        content: 'Critical escalation',
        from: 'system',
      })
      expect(result.allowed).toBe(true)
    })
  })

  describe('state reconciliation', () => {
    it('suppresses when expected status does not match live', async () => {
      const task = await createTestTask({ status: 'validating' })
      const result = guard.preflight({
        taskId: task.id,
        alertType: 'idle_nudge',
        content: 'Why is this still doing?',
        from: 'system',
        expectedState: { status: 'doing' },
      })
      expect(result.allowed).toBe(false)
      expect(result.reasonCode).toBe('status_changed')
      expect(result.reason).toContain('expected "doing"')
      expect(result.reason).toContain('live is "validating"')
    })

    it('suppresses when assignee changed', async () => {
      const task = await createTestTask({ assignee: 'sage' })
      const result = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Alert for old assignee',
        from: 'system',
        expectedState: { assignee: 'link' },
      })
      expect(result.allowed).toBe(false)
      expect(result.reasonCode).toBe('assignee_changed')
    })

    it('allows when expected state matches live', async () => {
      const task = await createTestTask({ status: 'doing', assignee: 'link' })
      const result = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Valid alert',
        from: 'system',
        expectedState: { status: 'doing', assignee: 'link' },
      })
      expect(result.allowed).toBe(true)
    })
  })

  describe('idempotent dedup', () => {
    it('suppresses duplicate alert with same task+type+state', async () => {
      const task = await createTestTask()

      const result1 = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Same alert',
        from: 'system',
      })
      expect(result1.allowed).toBe(true)

      const result2 = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Same alert again',
        from: 'system',
      })
      expect(result2.allowed).toBe(false)
      expect(result2.reasonCode).toBe('duplicate')
    })

    it('allows same task+type if state hash changed', async () => {
      const task = await createTestTask()

      const result1 = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'First alert',
        from: 'system',
      })
      expect(result1.allowed).toBe(true)

      // Change task state
      await taskManager.updateTask(task.id, { status: 'validating', metadata: { artifact_path: 'process/test.md', review_handoff: { task_id: task.id, repo: 'test/test', pr_url: 'https://github.com/test/test/pull/1', commit_sha: 'abc123', artifact_path: 'process/test.md', test_proof: 'pass', known_caveats: 'none' } } })

      const result2 = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Alert after state change',
        from: 'system',
      })
      expect(result2.allowed).toBe(true)
    })
  })

  describe('recent activity suppression', () => {
    it('suppresses when task has very recent comment', async () => {
      const task = await createTestTask()
      // Add a comment
      await taskManager.addTaskComment(task.id, 'link', 'Just working on this')

      const result = guard.preflight({
        taskId: task.id,
        alertType: 'idle_nudge',
        content: 'Are you idle?',
        from: 'system',
      })
      expect(result.allowed).toBe(false)
      expect(result.reasonCode).toBe('recent_activity')
    })
  })

  describe('canary mode', () => {
    it('logs but allows in canary mode', async () => {
      const canaryGuard = new AlertIntegrityGuard({ canaryMode: true })
      const task = await createTestTask({ status: 'done' })

      const result = canaryGuard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Would be suppressed',
        from: 'system',
      })
      expect(result.allowed).toBe(true)
      expect(result.reasonCode).toBe('canary_allowed')
      expect(result.reason).toContain('canary_would_suppress')
    })
  })

  describe('stats and audit', () => {
    it('tracks stats accurately', async () => {
      const task = await createTestTask()
      guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Alert 1',
        from: 'system',
      })

      const stats = guard.getStats()
      expect(stats.totalChecked).toBe(1)
      expect(stats.totalAllowed).toBe(1)
    })

    it('returns audit log entries', async () => {
      const task = await createTestTask()
      guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Audited alert',
        from: 'system',
      })

      const log = guard.getAuditLog()
      expect(log.length).toBeGreaterThanOrEqual(1)
      expect(log[0].taskId).toBe(task.id)
      expect(log[0].alertType).toBe('watchdog')
    })

    it('preflight latency is tracked', async () => {
      const task = await createTestTask()
      const result = guard.preflight({
        taskId: task.id,
        alertType: 'watchdog',
        content: 'Latency test',
        from: 'system',
      })
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(result.latencyMs).toBeLessThan(500) // Should be well under p95 threshold
    })

    it('rollback signals report correctly', () => {
      const signals = guard.getRollbackSignals()
      expect(signals.rollbackTriggered).toBe(false)
      expect(signals.p95LatencyMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('config', () => {
    it('updates config', () => {
      guard.updateConfig({ dedupWindowMs: 30000 })
      const config = guard.getConfig()
      expect(config.dedupWindowMs).toBe(30000)
    })

    it('activates enforcement', () => {
      const canaryGuard = new AlertIntegrityGuard({ canaryMode: true })
      expect(canaryGuard.getConfig().canaryMode).toBe(true)
      canaryGuard.activateEnforcement()
      expect(canaryGuard.getConfig().canaryMode).toBe(false)
    })
  })
})
