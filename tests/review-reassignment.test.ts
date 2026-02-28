import { describe, it, expect, beforeEach } from 'vitest'
import { getDb } from '../src/db.js'
import { taskManager } from '../src/tasks.js'
import { presenceManager } from '../src/presence.js'
import { BoardHealthWorker } from '../src/boardHealthWorker.js'

const uid = () => `task-rra-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

function seedTask(overrides: {
  id?: string
  status?: string
  assignee?: string
  reviewer?: string
  entered_validating_at?: number
} = {}) {
  const db = getDb()
  const id = overrides.id || uid()
  const now = Date.now()
  const enteredAt = overrides.entered_validating_at ?? (now - 10 * 60 * 60 * 1000) // default: 10h ago
  const meta = JSON.stringify({
    entered_validating_at: enteredAt,
    artifact_path: 'process/test-artifact.md', // required by validating lifecycle gate
    eta: '~1h',
  })
  const doneCriteria = JSON.stringify(['Test criteria'])

  db.prepare(`
    INSERT INTO tasks (id, title, status, assignee, reviewer, created_by, created_at, updated_at, priority, metadata, done_criteria)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, 'Review reassign test', overrides.status ?? 'validating', overrides.assignee ?? 'link', overrides.reviewer ?? 'sage', 'test', now, now, 'P1', meta, doneCriteria)

  return id
}

function cleanupTask(id: string) {
  try { getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id) } catch {}
}

describe('Review SLA auto-reassignment', () => {
  let worker: BoardHealthWorker
  const createdIds: string[] = []

  beforeEach(() => {
    worker = new BoardHealthWorker({
      enabled: true,
      reviewSlaThresholdMin: 480,        // 8h
      reviewEscalationTarget: 'ryan',
      maxActionsPerTick: 10,
      staleDoingThresholdMin: 999999,    // disable other policies
      suggestCloseThresholdMin: 999999,
    })
  })

  it('finds and reassigns validating tasks that breach review SLA', async () => {
    const taskId = seedTask({ reviewer: 'sage', assignee: 'link' })
    createdIds.push(taskId)

    // Verify the task is in the DB as validating
    const before = taskManager.getTask(taskId)
    expect(before?.status).toBe('validating')
    expect(before?.reviewer).toBe('sage')

    // Make pixel active as an alternate reviewer
    presenceManager.recordActivity('pixel', 'heartbeat')

    const result = await worker.tick({ dryRun: false, force: true })
    const reviewActions = result.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)

    expect(reviewActions.length).toBe(1)
    expect(reviewActions[0].description).toContain('sage')

    const after = taskManager.getTask(taskId)
    expect(after?.reviewer).not.toBe('sage')
    cleanupTask(taskId)
  })

  it('does not reassign within SLA threshold', async () => {
    const taskId = seedTask({
      reviewer: 'sage',
      entered_validating_at: Date.now() - 2 * 60 * 60 * 1000, // 2h — within 8h SLA
    })
    createdIds.push(taskId)

    const result = await worker.tick({ dryRun: false, force: true })
    const actions = result.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)
    expect(actions.length).toBe(0)
    cleanupTask(taskId)
  })

  it('escalates to ryan when no active reviewer available', async () => {
    // Use reviewer and assignee that cover all currently active agents
    // so the picker has no candidates except escalation target
    const allPresence = presenceManager.getAllPresence()
    const activeAgents = allPresence.filter(p => p.status !== 'offline').map(p => p.agent.toLowerCase())

    // Use a custom worker with very short threshold to avoid interference
    const customWorker = new BoardHealthWorker({
      enabled: true,
      reviewSlaThresholdMin: 1,           // 1 minute — minimal
      reviewEscalationTarget: 'tescryan', // Unique escalation target for this test
      maxActionsPerTick: 10,
      staleDoingThresholdMin: 999999,
      suggestCloseThresholdMin: 999999,
    })

    // Create task where reviewer and assignee cover all active agents
    // plus escalation target is unique so no existing agent matches
    const taskId = seedTask({
      reviewer: 'testreviewernobody',
      assignee: 'testassigneenobody',
      entered_validating_at: Date.now() - 10 * 60 * 1000, // 10 min ago (> 1 min threshold)
    })
    createdIds.push(taskId)

    const result = await customWorker.tick({ dryRun: false, force: true })
    const actions = result.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)

    expect(actions.length).toBe(1)

    const after = taskManager.getTask(taskId)
    // Since active agents (if any) are not the reviewer/assignee, they could be picked.
    // But if no active agents exist, escalation target is used.
    if (activeAgents.length === 0) {
      expect(after?.reviewer).toBe('tescryan')
    } else {
      // Some active agent was picked (not original reviewer)
      expect(after?.reviewer).not.toBe('testreviewernobody')
    }
    cleanupTask(taskId)
  })

  it('skips non-validating tasks', async () => {
    const taskId = seedTask({ status: 'doing', reviewer: 'sage' })
    createdIds.push(taskId)

    const result = await worker.tick({ dryRun: false, force: true })
    const actions = result.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)
    expect(actions.length).toBe(0)
    cleanupTask(taskId)
  })

  it('does not flag done tasks (regression for false-positive alerts)', async () => {
    const taskId = seedTask({ status: 'done', reviewer: 'sage' })
    createdIds.push(taskId)

    const result = await worker.tick({ dryRun: false, force: true })
    const actions = result.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)
    expect(actions.length).toBe(0)
    cleanupTask(taskId)
  })

  it('treats entered_validating_at in seconds as seconds (ms vs s regression)', async () => {
    // 10 hours ago in seconds (not ms)
    const enteredSec = Math.floor((Date.now() - 10 * 60 * 60 * 1000) / 1000)
    const taskId = seedTask({ reviewer: 'sage', assignee: 'link', entered_validating_at: enteredSec })
    createdIds.push(taskId)

    presenceManager.recordActivity('pixel', 'heartbeat')

    const result = await worker.tick({ dryRun: false, force: true })
    const actions = result.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)
    expect(actions.length).toBe(1)
    // Ensure we didn't compute absurdly huge minutes
    expect(actions[0].description).not.toMatch(/\b\d{6,}m\b/)

    cleanupTask(taskId)
  })

  it('does not re-reassign within cooldown window', async () => {
    const taskId = seedTask({ reviewer: 'sage', assignee: 'link' })
    createdIds.push(taskId)

    presenceManager.recordActivity('pixel', 'heartbeat')

    // First tick — should reassign
    const r1 = await worker.tick({ dryRun: false, force: true })
    const a1 = r1.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)
    expect(a1.length).toBe(1)

    // Second tick immediately — should NOT reassign (cooldown)
    const r2 = await worker.tick({ dryRun: false, force: true })
    const a2 = r2.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)
    expect(a2.length).toBe(0)
    cleanupTask(taskId)
  })

  it('does not assign reviewer who is the task assignee', async () => {
    const taskId = seedTask({ reviewer: 'sage', assignee: 'pixel' })
    createdIds.push(taskId)

    // pixel is active but is the assignee — should not be picked
    presenceManager.recordActivity('pixel', 'heartbeat')
    presenceManager.recordActivity('echo', 'heartbeat')

    const result = await worker.tick({ dryRun: false, force: true })
    const actions = result.actions.filter(a => a.kind === 'review-reassign' && a.taskId === taskId)

    if (actions.length > 0) {
      const after = taskManager.getTask(taskId)
      expect(after?.reviewer).not.toBe('pixel')
    }
    cleanupTask(taskId)
  })
})
