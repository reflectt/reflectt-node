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
    const result = sweepValidatingQueue()
    const orphanForThisTask = result.violations.filter(
      v => v.taskId === task.id && v.type === 'orphan_pr',
    )
    expect(orphanForThisTask).toHaveLength(0)
  })

  it('orphan alert includes @assignee and @reviewer mentions', async () => {
    const { sweepValidatingQueue } = await import('../src/executionSweeper.js')
    const result = sweepValidatingQueue()

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
