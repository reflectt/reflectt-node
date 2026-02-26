// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

describe('Execution Sweeper endpoints', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    // Import and build the app
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  describe('GET /execution-health', () => {
    it('returns sweeper status and current violations', async () => {
      const res = await app.inject({ method: 'GET', url: '/execution-health' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body).toHaveProperty('sweeper')
      expect(body.sweeper).toHaveProperty('running')
      expect(body.sweeper).toHaveProperty('lastSweepAt')
      expect(body).toHaveProperty('current')
      expect(body.current).toHaveProperty('validatingCount')
      expect(body.current).toHaveProperty('violations')
      expect(body.current).toHaveProperty('tasksScanned')
      expect(typeof body.current.validatingCount).toBe('number')
      expect(Array.isArray(body.current.violations)).toBe(true)
    })
  })

  describe('GET /drift-report', () => {
    it('returns comprehensive drift report', async () => {
      const res = await app.inject({ method: 'GET', url: '/drift-report' })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)

      // Core report structure
      expect(body).toHaveProperty('timestamp')
      expect(body).toHaveProperty('validating')
      expect(body).toHaveProperty('orphanPRs')
      expect(body).toHaveProperty('summary')
      expect(Array.isArray(body.validating)).toBe(true)
      expect(Array.isArray(body.orphanPRs)).toBe(true)

      // Summary fields
      expect(body.summary).toHaveProperty('totalValidating')
      expect(body.summary).toHaveProperty('staleValidating')
      expect(body.summary).toHaveProperty('orphanPRCount')
      expect(body.summary).toHaveProperty('prDriftCount')
      expect(body.summary).toHaveProperty('cleanCount')

      // Sweeper status included
      expect(body).toHaveProperty('sweeper')
      expect(body.sweeper).toHaveProperty('running')

      // Dry run log included
      expect(body).toHaveProperty('dryRunLog')
      expect(Array.isArray(body.dryRunLog)).toBe(true)
    })

    it('validating entries have expected fields', async () => {
      const res = await app.inject({ method: 'GET', url: '/drift-report' })
      const body = JSON.parse(res.body)

      for (const entry of body.validating) {
        expect(entry).toHaveProperty('taskId')
        expect(entry).toHaveProperty('title')
        expect(entry).toHaveProperty('status', 'validating')
        expect(entry).toHaveProperty('age_minutes')
        expect(entry).toHaveProperty('issue')
        expect(entry).toHaveProperty('detail')
        expect(['stale_validating', 'orphan_pr', 'pr_merged_not_closed', 'no_pr_linked', 'clean']).toContain(entry.issue)
      }
    })
  })

  describe('POST /pr-event', () => {
    it('rejects missing taskId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pr-event',
        payload: { prState: 'merged' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('rejects missing prState', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pr-event',
        payload: { taskId: 'test-123' },
      })
      expect(res.statusCode).toBe(400)
    })

    it('handles non-existent task gracefully', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/pr-event',
        payload: { taskId: 'nonexistent-task', prState: 'merged' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.success).toBe(true)
    })
  })
})

// ── Orphan PR accuracy tests ───────────────────────────────────────────────

describe('Orphan PR detection accuracy', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  it('merged PR on done task does NOT trigger orphan alert', async () => {
    // Create a task with a PR, move to done with reviewer_approved
    const createRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'Orphan test — merged PR',
        description: 'Testing that merged PRs on done tasks are not flagged',
        status: 'todo',
        assignee: 'link',
        reviewer: 'sage',
        priority: 'P1',
        createdBy: 'test',
        eta: '1h',
        done_criteria: ['PR merged and deployed'],
        metadata: {
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/208',
          pr_merged: true,
          reviewer_approved: true,
        },
      },
    })
    expect(createRes.statusCode).toBe(200)
    const task = JSON.parse(createRes.body).task

    // Move to done
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'doing',
      },
    })
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: {
          artifact_path: 'test.md',
          review_handoff: { task_id: task.id, artifact_path: 'test.md', test_proof: 'pass', doc_only: true },
          qa_bundle: { lane: 'test', summary: 'test', changed_files: [], artifact_links: [], checks: [], screenshot_proof: [], review_packet: { task_id: task.id, artifact_path: 'test.md' } },
        },
      },
    })
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        actor: 'sage',
        metadata: { reviewer_approved: true, reviewer_decision: { decision: 'approved', reviewer: 'sage', decidedAt: Date.now() } },
      },
    })
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: { status: 'done', metadata: { artifacts: ['test.md'] } },
    })

    // Run sweep and check
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    const result = await sweepValidatingQueue()
    const orphanForThisTask = result.violations.filter(
      v => v.taskId === task.id && v.type === 'orphan_pr',
    )
    expect(orphanForThisTask).toHaveLength(0)
  })

  it('orphan alert includes @assignee and @reviewer mentions', async () => {
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    const result = await sweepValidatingQueue()

    // Check all orphan_pr violations have mentions
    for (const v of result.violations.filter(v => v.type === 'orphan_pr')) {
      expect(v.message).toMatch(/@\w+/) // at least one @mention
      expect(v.assignee || v.reviewer).toBeTruthy() // has assignee or reviewer
    }
  })

  it('drift report does not list merged PRs as orphans', async () => {
    const driftRes = await app.inject({ method: 'GET', url: '/drift-report' })
    expect(driftRes.statusCode).toBe(200)
    const report = JSON.parse(driftRes.body)

    // No orphan entry should have a PR that is actually merged (per metadata)
    for (const entry of report.orphanPRs) {
      expect(entry.prMerged).not.toBe(true)
    }
  })

  it('checkLivePrState returns valid state for real PR', async () => {
    const { checkLivePrState, _clearPrStateCache } = await import('../src/executionSweeper.js')
    _clearPrStateCache()

    // PR #208 is a real merged PR in our repo
    const result = checkLivePrState('https://github.com/reflectt/reflectt-node/pull/208')
    // Should be 'merged' if gh CLI works, or 'unknown' if not
    expect(['open', 'merged', 'closed', 'unknown']).toContain(result.state)
  })
})

// ── Escalation persistence + cooldown tests ────────────────────────────────

describe('Sweeper escalation persistence and cooldown', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  /** Helper: build a valid qa_bundle + review_handoff for validating transition */
  function validatingMetadata(taskId: string, artifactPath: string, extra: Record<string, unknown> = {}) {
    return {
      artifact_path: artifactPath,
      review_handoff: {
        task_id: taskId,
        artifact_path: artifactPath,
        test_proof: 'pass',
        known_caveats: 'test only',
        doc_only: true,
      },
      qa_bundle: {
        lane: 'test',
        summary: 'Test task for sweeper',
        changed_files: [artifactPath],
        artifact_links: [artifactPath],
        checks: ['lint:pass'],
        screenshot_proof: ['n/a'],
        review_packet: {
          task_id: taskId,
          artifact_path: artifactPath,
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit: 'abc1234',
          changed_files: [artifactPath],
          caveats: 'Test only',
        },
      },
      ...extra,
    }
  }

  it('persists escalation state in task metadata', async () => {
    // Create a task stuck in validating > 2h
    // Use unique agent to avoid WIP cap / reflection gate interference from real agent state
    const testAgent = `sweeper-persist-${Date.now()}`
    const pastTime = Date.now() - (3 * 60 * 60 * 1000) // 3 hours ago
    const createRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'Escalation persist test',
        description: 'Testing metadata persistence',
        status: 'todo',
        assignee: testAgent,
        reviewer: 'sage',
        priority: 'P2',
        createdBy: 'test',
        eta: '1h',
        done_criteria: ['Done'],
      },
    })
    expect(createRes.statusCode).toBe(200)
    const task = JSON.parse(createRes.body).task

    // Move to doing then validating
    const doingRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: { status: 'doing', metadata: { eta: '1h', wip_override: 'test isolation' } },
    })
    expect(doingRes.statusCode).toBe(200)

    const valRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: validatingMetadata(task.id, 'process/test-persist.md'),
      },
    })
    expect(valRes.statusCode).toBe(200)

    // Backdate timestamps using patchTaskMetadata (server auto-sets them to now on transition)
    const { taskManager } = await import('../src/tasks.js')
    taskManager.patchTaskMetadata(task.id, {
      entered_validating_at: pastTime,
      review_last_activity_at: pastTime,
    })

    // Run sweep — task has been in validating 3h > 2h SLA
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    await sweepValidatingQueue()

    // Check that escalation metadata was persisted to the task
    const taskRes = await app.inject({ method: 'GET', url: `/tasks/${task.id}` })
    const updatedTask = JSON.parse(taskRes.body).task
    const meta = updatedTask.metadata || {}
    expect(meta.sweeper_escalation_level).toBeDefined()
    expect(meta.sweeper_escalated_at).toBeGreaterThan(0)
    expect(meta.sweeper_escalation_count).toBeGreaterThanOrEqual(1)

    // Clean up: move to done
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'done',
        actor: 'sage',
        metadata: { reviewer_approved: true, artifacts: ['process/test-persist.md'] },
      },
    })
  })

  it('does not re-escalate within cooldown window', async () => {
    // Create a task with sweeper metadata already set (simulating restart scenario)
    const testAgent = `sweeper-cooldown-${Date.now()}`
    const recentEscalation = Date.now() - (30 * 60 * 1000) // 30m ago (within 4h cooldown)
    const oldActivity = Date.now() - (3 * 60 * 60 * 1000) // 3h ago
    const createRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'Cooldown test task',
        description: 'Should not re-escalate',
        status: 'todo',
        assignee: testAgent,
        reviewer: 'sage',
        priority: 'P2',
        createdBy: 'test',
        eta: '1h',
        done_criteria: ['Done'],
      },
    })
    const task = JSON.parse(createRes.body).task

    const doingRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: { status: 'doing', metadata: { eta: '1h', wip_override: 'test isolation' } },
    })
    expect(doingRes.statusCode).toBe(200)

    const valRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: validatingMetadata(task.id, 'process/test-cooldown.md'),
      },
    })
    expect(valRes.statusCode).toBe(200)

    // Backdate timestamps + inject prior escalation state (simulating restart recovery)
    const { taskManager } = await import('../src/tasks.js')
    taskManager.patchTaskMetadata(task.id, {
      entered_validating_at: oldActivity,
      review_last_activity_at: oldActivity,
      sweeper_escalation_level: 'warning',
      sweeper_escalated_at: recentEscalation,
      sweeper_escalation_count: 1,
    })

    // Run sweep — should NOT generate a violation for this task (within cooldown)
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    const result = await sweepValidatingQueue()
    const violations = result.violations.filter(v => v.taskId === task.id)
    expect(violations).toHaveLength(0)

    // Clean up
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'done',
        actor: 'sage',
        metadata: { reviewer_approved: true, artifacts: ['process/test-cooldown.md'] },
      },
    })
  })

  it('silences after max escalation count reached', async () => {
    const testAgent = `sweeper-silence-${Date.now()}`
    const oldActivity = Date.now() - (9 * 60 * 60 * 1000) // 9h ago (well past critical)
    const oldEscalation = Date.now() - (5 * 60 * 60 * 1000) // 5h ago (past cooldown)
    const createRes = await app.inject({
      method: 'POST',
      url: '/tasks',
      payload: {
        title: 'Silenced task test',
        description: 'Already escalated max times',
        status: 'todo',
        assignee: testAgent,
        reviewer: 'sage',
        priority: 'P2',
        createdBy: 'test',
        eta: '1h',
        done_criteria: ['Done'],
      },
    })
    const task = JSON.parse(createRes.body).task

    const doingRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: { status: 'doing', metadata: { eta: '1h', wip_override: 'test isolation' } },
    })
    if (doingRes.statusCode !== 200) console.error('SILENCED DOING FAILED:', doingRes.body)
    expect(doingRes.statusCode).toBe(200)

    const valRes = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'validating',
        metadata: validatingMetadata(task.id, 'process/test-silenced.md'),
      },
    })
    if (valRes.statusCode !== 200) console.error('SILENCED VAL FAILED:', valRes.body)
    expect(valRes.statusCode).toBe(200)

    // Backdate timestamps + inject max escalation count (simulating task already silenced)
    const { taskManager } = await import('../src/tasks.js')
    taskManager.patchTaskMetadata(task.id, {
      entered_validating_at: oldActivity,
      review_last_activity_at: oldActivity,
      sweeper_escalation_level: 'critical',
      sweeper_escalated_at: oldEscalation,
      sweeper_escalation_count: 3, // Already at max
    })

    // Run sweep — should NOT generate violations (count >= 3)
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    const result = await sweepValidatingQueue()
    const violations = result.violations.filter(v => v.taskId === task.id)
    expect(violations).toHaveLength(0)

    // Clean up
    await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      payload: {
        status: 'done',
        actor: 'sage',
        metadata: { reviewer_approved: true, artifacts: ['process/test-silenced.md'] },
      },
    })
  })
})
