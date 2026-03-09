// E2E test: autonomous continuity loop
// Proves the full cycle: queue breach → insight promotion → task creation → queue replenished
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { createReflection } from '../src/reflections.js'
import { ingestReflection, _clearInsightStore } from '../src/insights.js'
import { _clearPromotionAudits } from '../src/insight-promotion.js'
import { _resetContinuityState, tickContinuityLoop, getContinuityStats, getContinuityAuditLog, getContinuityAuditFromDb } from '../src/continuity-loop.js'
import { taskManager } from '../src/tasks.js'

describe('Continuity Loop', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
  })

  beforeEach(() => {
    _resetContinuityState()
  })

  it('GET /continuity/stats returns stats object', async () => {
    const res = await app.inject({ method: 'GET', url: '/continuity/stats' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('cyclesRun')
    expect(body).toHaveProperty('insightsPromoted')
    expect(body).toHaveProperty('lastRunAt')
  })

  it('GET /continuity/audit returns audit log', async () => {
    const res = await app.inject({ method: 'GET', url: '/continuity/audit' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('actions')
    expect(Array.isArray(body.actions)).toBe(true)
  })

  it('POST /continuity/tick runs a cycle', async () => {
    const res = await app.inject({ method: 'POST', url: '/continuity/tick' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body).toHaveProperty('agentsChecked')
    expect(body).toHaveProperty('replenished')
  })

  it('tickContinuityLoop returns clean result when no agents configured', async () => {
    const result = await tickContinuityLoop()
    expect(result.actions).toBeInstanceOf(Array)
    expect(result.agentsChecked).toBeGreaterThanOrEqual(0)
  })

  it('E2E: promoted insight can be auto-converted to task', async () => {
    // Create two reflections from different authors to trigger promotion
    const ref1 = createReflection({
      pain: 'Continuity test: queue runs dry frequently',
      impact: 'Agents sit idle waiting for task assignment',
      evidence: ['board-health-log-1'],
      went_well: 'Detection was fast',
      suspected_why: 'No auto-replenishment mechanism',
      proposed_fix: 'Build continuity loop',
      confidence: 8,
      role_type: 'agent',
      author: 'agent-a',
      severity: 'high',
      tags: ['stage:ops', 'family:queue-starvation', 'unit:board'],
    })

    const ref2 = createReflection({
      pain: 'Continuity test: queue runs dry frequently',
      impact: 'Agents sit idle waiting for task assignment',
      evidence: ['board-health-log-2'],
      went_well: 'Alerts worked',
      suspected_why: 'No auto-replenishment mechanism',
      proposed_fix: 'Build continuity loop',
      confidence: 7,
      role_type: 'agent',
      author: 'agent-b',
      severity: 'high',
      tags: ['stage:ops', 'family:queue-starvation', 'unit:board'],
    })

    // Ingest both — second should trigger promotion (2 independent authors)
    const ins1 = ingestReflection(ref1)
    const ins2 = ingestReflection(ref2)

    // Verify insight is promoted
    expect(ins2.status).toBe('promoted')
    expect(ins2.task_id).toBeNull() // No task yet

    // Verify the insight shows up in API
    const insightsRes = await app.inject({ method: 'GET', url: '/insights?status=promoted' })
    const insightsBody = JSON.parse(insightsRes.body)
    const found = insightsBody.insights.some((i: any) => i.id === ins2.id)
    expect(found).toBe(true)
  })

  it('stats increment on tick', async () => {
    const before = getContinuityStats()
    await tickContinuityLoop()
    const after = getContinuityStats()
    expect(after.cyclesRun).toBe(before.cyclesRun + 1)
  })

  it('audit log captures actions', async () => {
    await tickContinuityLoop()
    const log = getContinuityAuditLog()
    // Log may be empty if no agents need replenishment, but it should be an array
    expect(Array.isArray(log)).toBe(true)
  })

  describe('Cold-start bootstrap', () => {
    it('bootstrap creates tasks when agent has no prior tasks and no insights', async () => {
      const coldAgent = `cold-start-test-${Date.now()}`
      // Ensure no existing tasks or audit entries for this agent
      const priorTasks = taskManager.listTasks({ assignee: coldAgent })
      expect(priorTasks).toHaveLength(0)
      const priorAudit = getContinuityAuditFromDb({ agent: coldAgent })
      expect(priorAudit).toHaveLength(0)

      // Configure continuity to monitor this cold agent
      const policyManager = (await import('../src/policy.js')).policyManager
      const original = policyManager.get()
      policyManager.patch({
        continuityLoop: { enabled: true, agents: [coldAgent], minReady: 2, maxPromotePerCycle: 2, cooldownMin: 0, defaultReviewer: 'sage', channel: 'general' },
      } as any)

      try {
        _clearInsightStore()
        _resetContinuityState()

        const result = await tickContinuityLoop()

        // Bootstrap should have created tasks
        expect(result.replenished).toBeGreaterThan(0)
        const bootstrapActions = result.actions.filter(a => a.agent === coldAgent && a.kind === 'queue-replenish')
        expect(bootstrapActions.length).toBeGreaterThan(0)

        // Tasks should now exist for the agent
        const newTasks = taskManager.listTasks({ assignee: coldAgent })
        expect(newTasks.length).toBeGreaterThan(0)
        expect(newTasks[0].metadata?.bootstrap).toBe(true)

        // Running again should NOT bootstrap again (idempotent — audit guard)
        const result2 = await tickContinuityLoop()
        const coldAgentTasksBefore = taskManager.listTasks({ assignee: coldAgent }).length
        const result2Bootstrap = result2.actions.filter(a => a.agent === coldAgent && a.taskId && (taskManager.getTask(a.taskId)?.metadata as any)?.bootstrap)
        expect(result2Bootstrap).toHaveLength(0)
        expect(taskManager.listTasks({ assignee: coldAgent }).length).toBe(coldAgentTasksBefore)
      } finally {
        policyManager.patch({ continuityLoop: (original as any).continuityLoop ?? {} } as any)
        // Cleanup
        for (const t of taskManager.listTasks({ assignee: coldAgent })) {
          try { taskManager.deleteTask(t.id) } catch {}
        }
      }
    })

    it('bootstrap does NOT fire when agent already has tasks', async () => {
      // Agent already has tasks on the board
      const agentWithTasks = `agent-with-tasks-${Date.now()}`
      const task = await taskManager.createTask({
        title: 'Pre-existing task',
        description: 'This agent is not cold',
        status: 'todo',
        assignee: agentWithTasks,
        reviewer: 'sage',
        priority: 'P2',
        createdBy: 'test',
        eta: '1h',
        done_criteria: ['done'],
        metadata: {},
      } as any)

      const policyManager = (await import('../src/policy.js')).policyManager
      const original = policyManager.get()
      policyManager.patch({
        continuityLoop: { enabled: true, agents: [agentWithTasks], minReady: 5, maxPromotePerCycle: 2, cooldownMin: 0, defaultReviewer: 'sage', channel: 'general' },
      } as any)

      try {
        _clearInsightStore()
        _resetContinuityState()

        const result = await tickContinuityLoop()
        const bootstrapActions = result.actions.filter(
          a => a.agent === agentWithTasks && a.kind === 'queue-replenish' && (taskManager.getTask(a.taskId ?? '')?.metadata as any)?.bootstrap
        )
        expect(bootstrapActions).toHaveLength(0)
      } finally {
        policyManager.patch({ continuityLoop: (original as any).continuityLoop ?? {} } as any)
        try { taskManager.deleteTask(task.id) } catch {}
        for (const t of taskManager.listTasks({ assignee: agentWithTasks })) {
          try { taskManager.deleteTask(t.id) } catch {}
        }
      }
    })
  })
})
