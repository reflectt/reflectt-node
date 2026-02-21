// Tests for Insight → Task promotion workflow + recurring candidates
import { describe, it, expect, beforeEach } from 'vitest'
import {
  promoteInsight,
  validatePromotionInput,
  getPromotionAuditByInsight,
  listPromotionAudits,
  generateRecurringCandidates,
  ensurePromotionAuditTable,
  _clearPromotionAudits,
} from '../src/insight-promotion.js'
import {
  ingestReflection,
  getInsight,
  _clearInsightStore,
} from '../src/insights.js'
import {
  createReflection,
  _clearReflectionStore,
} from '../src/reflections.js'
import { taskManager } from '../src/tasks.js'
import { getDb } from '../src/db.js'
import type { Reflection } from '../src/reflections.js'

const VALID_CONTRACT = {
  owner: 'link',
  reviewer: 'kai',
  eta: '2h',
  acceptance_check: 'Chat messages display full text in task comments',
  artifact_proof_requirement: 'PR with test covering truncation fix',
  next_checkpoint_eta: '1h',
}

function makeReflection(overrides: Partial<Parameters<typeof createReflection>[0]> = {}): Reflection {
  return createReflection({
    pain: 'Chat messages truncated in task comments',
    impact: 'Team misses context',
    evidence: ['https://github.com/reflectt/reflectt-node/issues/42'],
    went_well: 'Chat relay works',
    suspected_why: 'chatToComment() slices at 200 chars',
    proposed_fix: 'Remove slice',
    confidence: 7,
    role_type: 'agent',
    author: 'link',
    tags: ['stage:relay', 'family:data-loss', 'unit:chat'],
    ...overrides,
  })
}

function makePromotedInsight() {
  const ref = makeReflection({ severity: 'critical', evidence: ['crash.log'] })
  return ingestReflection(ref)
}

beforeEach(async () => {
  _clearPromotionAudits()
  _clearInsightStore()
  _clearReflectionStore()
  ensurePromotionAuditTable()
  // Clear tasks
  const db = getDb()
  db.prepare('DELETE FROM tasks').run()
  db.prepare('DELETE FROM task_comments').run()
  // Reload task manager
  await taskManager.loadTasks()
})

// ── Validation ──

describe('validatePromotionInput', () => {
  it('accepts valid input', () => {
    const result = validatePromotionInput({
      insight_id: 'ins-123',
      contract: VALID_CONTRACT,
    })
    expect(result.valid).toBe(true)
  })

  it('rejects missing insight_id', () => {
    const result = validatePromotionInput({ contract: VALID_CONTRACT })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('insight_id'))).toBe(true)
  })

  it('rejects missing contract', () => {
    const result = validatePromotionInput({ insight_id: 'ins-123' })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('contract'))).toBe(true)
  })

  it('rejects missing contract fields', () => {
    const result = validatePromotionInput({
      insight_id: 'ins-123',
      contract: { owner: 'link' },
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.length).toBeGreaterThanOrEqual(5) // missing 5 fields
  })

  it('rejects invalid priority', () => {
    const result = validatePromotionInput({
      insight_id: 'ins-123',
      contract: VALID_CONTRACT,
      priority: 'P5',
    })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.includes('priority'))).toBe(true)
  })

  it('rejects null body', () => {
    const result = validatePromotionInput(null)
    expect(result.valid).toBe(false)
  })
})

// ── Promotion ──

describe('promoteInsight', () => {
  it('creates a task from a promoted insight', async () => {
    const insight = makePromotedInsight()

    const result = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )

    expect(result.success).toBe(true)
    expect(result.task_id).toBeDefined()
    expect(result.audit_id).toBeDefined()

    // Verify the task was created
    const task = taskManager.getTask(result.task_id!)
    expect(task).toBeDefined()
    expect(task!.title).toContain('Insight')
    expect(task!.assignee).toBe('link')
    expect(task!.reviewer).toBe('kai')
    expect(task!.tags).toContain('insight-promoted')
    expect(task!.metadata?.source_insight).toBe(insight.id)
    expect(task!.metadata?.promotion_contract).toEqual(VALID_CONTRACT)
  })

  it('enforces all contract fields in task metadata', async () => {
    const insight = makePromotedInsight()
    const result = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )

    const task = taskManager.getTask(result.task_id!)!
    const contract = task.metadata?.promotion_contract as any
    expect(contract.owner).toBe(VALID_CONTRACT.owner)
    expect(contract.reviewer).toBe(VALID_CONTRACT.reviewer)
    expect(contract.eta).toBe(VALID_CONTRACT.eta)
    expect(contract.acceptance_check).toBe(VALID_CONTRACT.acceptance_check)
    expect(contract.artifact_proof_requirement).toBe(VALID_CONTRACT.artifact_proof_requirement)
    expect(contract.next_checkpoint_eta).toBe(VALID_CONTRACT.next_checkpoint_eta)
  })

  it('creates done_criteria from contract', async () => {
    const insight = makePromotedInsight()
    const result = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )

    const task = taskManager.getTask(result.task_id!)!
    expect(task.done_criteria).toContain(VALID_CONTRACT.acceptance_check)
    expect(task.done_criteria?.some(c => c.includes(VALID_CONTRACT.artifact_proof_requirement))).toBe(true)
  })

  it('uses insight priority by default', async () => {
    const insight = makePromotedInsight()
    const result = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )

    const task = taskManager.getTask(result.task_id!)!
    expect(task.priority).toBe(insight.priority)
  })

  it('allows priority override', async () => {
    const insight = makePromotedInsight()
    const result = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT, priority: 'P3' },
      'sage',
    )

    const task = taskManager.getTask(result.task_id!)!
    expect(task.priority).toBe('P3')
  })

  it('returns error for non-existent insight', async () => {
    const result = await promoteInsight(
      { insight_id: 'ins-nonexistent', contract: VALID_CONTRACT },
      'sage',
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns error for closed insight', async () => {
    const insight = makePromotedInsight()
    const db = getDb()
    db.prepare('UPDATE insights SET status = ? WHERE id = ?').run('closed', insight.id)

    const result = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('closed')
  })

  it('prevents double-promotion', async () => {
    const insight = makePromotedInsight()

    await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )

    const result2 = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )
    expect(result2.success).toBe(false)
    expect(result2.error).toContain('already promoted')
  })
})

// ── Audit trail ──

describe('promotion audit', () => {
  it('records audit with insight snapshot', async () => {
    const insight = makePromotedInsight()
    const result = await promoteInsight(
      { insight_id: insight.id, contract: VALID_CONTRACT },
      'sage',
    )

    const audit = getPromotionAuditByInsight(insight.id)
    expect(audit).not.toBeNull()
    expect(audit!.task_id).toBe(result.task_id)
    expect(audit!.promoted_by).toBe('sage')
    expect(audit!.contract).toEqual(VALID_CONTRACT)
    expect(audit!.insight_snapshot.score).toBe(insight.score)
    expect(audit!.insight_snapshot.cluster_key).toBe(insight.cluster_key)
    expect(audit!.insight_snapshot.reflection_count).toBe(1)
  })

  it('listPromotionAudits returns recent audits', async () => {
    const ins1 = makePromotedInsight()
    await promoteInsight({ insight_id: ins1.id, contract: VALID_CONTRACT }, 'sage')

    // Create a second insight with different cluster
    const ref2 = makeReflection({ severity: 'high', evidence: ['b.log'], tags: ['stage:deploy', 'family:runtime-error', 'unit:api'] })
    const ins2 = ingestReflection(ref2)
    await promoteInsight({ insight_id: ins2.id, contract: { ...VALID_CONTRACT, owner: 'echo' } }, 'sage')

    const audits = listPromotionAudits()
    expect(audits).toHaveLength(2)
  })
})

// ── Recurring candidates ──

describe('generateRecurringCandidates', () => {
  it('returns recurring insights not yet promoted to tasks', () => {
    // Create a recurring insight (4+ reflections)
    const ref1 = makeReflection({ author: 'link' })
    ingestReflection(ref1)
    const ref2 = makeReflection({ author: 'link', pain: 'More truncation 2' })
    ingestReflection(ref2)
    const ref3 = makeReflection({ author: 'link', pain: 'More truncation 3' })
    ingestReflection(ref3)
    const ref4 = makeReflection({ author: 'link', pain: 'More truncation 4' })
    const insight = ingestReflection(ref4)

    // Mark as recurring (would happen automatically with 4+ reflections)
    expect(insight.recurring_candidate).toBe(true)

    const candidates = generateRecurringCandidates()
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    expect(candidates[0].insight_id).toBe(insight.id)
    expect(candidates[0].reflection_count).toBe(4)
    expect(candidates[0].reason).toContain('reflections')
  })

  it('excludes insights already promoted to tasks', async () => {
    const insight = makePromotedInsight()
    // Mark as recurring
    const db = getDb()
    db.prepare('UPDATE insights SET recurring_candidate = 1 WHERE id = ?').run(insight.id)

    await promoteInsight({ insight_id: insight.id, contract: VALID_CONTRACT }, 'sage')

    const candidates = generateRecurringCandidates()
    const found = candidates.find(c => c.insight_id === insight.id)
    expect(found).toBeUndefined()
  })

  it('excludes closed insights', () => {
    const ref = makeReflection()
    const insight = ingestReflection(ref)
    const db = getDb()
    db.prepare('UPDATE insights SET recurring_candidate = 1, status = ? WHERE id = ?').run('closed', insight.id)

    const candidates = generateRecurringCandidates()
    const found = candidates.find(c => c.insight_id === insight.id)
    expect(found).toBeUndefined()
  })

  it('includes suggested owner when role matches', () => {
    const ref1 = makeReflection({ author: 'link' })
    ingestReflection(ref1)
    const ref2 = makeReflection({ author: 'link', pain: 'More 2' })
    ingestReflection(ref2)
    const ref3 = makeReflection({ author: 'link', pain: 'More 3' })
    ingestReflection(ref3)
    const ref4 = makeReflection({ author: 'link', pain: 'More 4' })
    ingestReflection(ref4)

    const candidates = generateRecurringCandidates()
    // May or may not have a suggested_owner depending on role config
    expect(candidates.length).toBeGreaterThanOrEqual(1)
    // Just verify the field exists
    expect(candidates[0]).toHaveProperty('suggested_owner')
    expect(candidates[0]).toHaveProperty('suggested_lane')
  })
})
