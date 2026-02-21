// Tests for Reflection entity + ingestion API
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createReflection,
  getReflection,
  listReflections,
  countReflections,
  reflectionStats,
  validateReflection,
  _clearReflectionStore,
  ROLE_TYPES,
  SEVERITY_LEVELS,
} from '../src/reflections.js'
import { getDb } from '../src/db.js'

const VALID_INPUT = {
  pain: 'Chat messages truncated at 200 chars in task comments',
  impact: 'Team misses critical context in async handoffs',
  evidence: ['https://github.com/reflectt/reflectt-node/issues/42', '/data/logs/chat-truncation.log'],
  went_well: 'Chat relay itself works — only comment rendering truncates',
  suspected_why: 'chatToComment() slices content to 200 chars for "compact" display',
  proposed_fix: 'Remove slice, add expandable UI for long comments',
  confidence: 8,
  role_type: 'engineering' as const,
  author: 'link',
}

beforeEach(() => {
  _clearReflectionStore()
})

// ── Validation ──

describe('validateReflection', () => {
  it('accepts valid input with all required fields', () => {
    const result = validateReflection(VALID_INPUT)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.pain).toBe(VALID_INPUT.pain)
      expect(result.data.evidence).toEqual(VALID_INPUT.evidence)
    }
  })

  it('accepts valid input with optional fields', () => {
    const result = validateReflection({
      ...VALID_INPUT,
      severity: 'high',
      task_id: 'task-123',
      metadata: { sprint: 12, category: 'relay' },
    })
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.severity).toBe('high')
      expect(result.data.task_id).toBe('task-123')
      expect(result.data.metadata).toEqual({ sprint: 12, category: 'relay' })
    }
  })

  it('rejects null body', () => {
    const result = validateReflection(null)
    expect(result.valid).toBe(false)
  })

  it('rejects missing pain', () => {
    const { pain: _, ...noPain } = VALID_INPUT
    const result = validateReflection(noPain)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('pain'))).toBe(true)
    }
  })

  it('rejects missing impact', () => {
    const result = validateReflection({ ...VALID_INPUT, impact: '' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('impact'))).toBe(true)
    }
  })

  it('rejects empty evidence array', () => {
    const result = validateReflection({ ...VALID_INPUT, evidence: [] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('evidence'))).toBe(true)
    }
  })

  it('rejects non-array evidence', () => {
    const result = validateReflection({ ...VALID_INPUT, evidence: 'just-a-string' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('evidence'))).toBe(true)
    }
  })

  it('rejects evidence with empty strings', () => {
    const result = validateReflection({ ...VALID_INPUT, evidence: ['valid', ''] })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('evidence'))).toBe(true)
    }
  })

  it('rejects confidence out of range (negative)', () => {
    const result = validateReflection({ ...VALID_INPUT, confidence: -1 })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('confidence'))).toBe(true)
    }
  })

  it('rejects confidence out of range (too high)', () => {
    const result = validateReflection({ ...VALID_INPUT, confidence: 11 })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('confidence'))).toBe(true)
    }
  })

  it('rejects invalid role_type', () => {
    const result = validateReflection({ ...VALID_INPUT, role_type: 'robot' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('role_type'))).toBe(true)
    }
  })

  it('rejects invalid severity', () => {
    const result = validateReflection({ ...VALID_INPUT, severity: 'extreme' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('severity'))).toBe(true)
    }
  })

  it('rejects missing author', () => {
    const result = validateReflection({ ...VALID_INPUT, author: '' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.some(e => e.field.includes('author'))).toBe(true)
    }
  })

  it('collects multiple errors', () => {
    const result = validateReflection({ pain: '', evidence: 'not-array', confidence: -5, role_type: 'invalid' })
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThanOrEqual(4)
    }
  })

  it('validates all ROLE_TYPES are accepted', () => {
    for (const rt of ROLE_TYPES) {
      const result = validateReflection({ ...VALID_INPUT, role_type: rt })
      expect(result.valid).toBe(true)
    }
  })

  it('validates all SEVERITY_LEVELS are accepted', () => {
    for (const sev of SEVERITY_LEVELS) {
      const result = validateReflection({ ...VALID_INPUT, severity: sev })
      expect(result.valid).toBe(true)
    }
  })
})

// ── CRUD ──

describe('Reflection CRUD', () => {
  it('creates a reflection with generated id and timestamp', () => {
    const ref = createReflection(VALID_INPUT)

    expect(ref.id).toMatch(/^ref-/)
    expect(ref.created_at).toBeGreaterThan(0)
    expect(ref.updated_at).toBeGreaterThan(0)
    expect(ref.pain).toBe(VALID_INPUT.pain)
    expect(ref.evidence).toEqual(VALID_INPUT.evidence)
    expect(ref.confidence).toBe(8)
    expect(ref.role_type).toBe('engineering')
  })

  it('retrieves a reflection by id', () => {
    const created = createReflection(VALID_INPUT)
    const fetched = getReflection(created.id)

    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(created.id)
    expect(fetched!.pain).toBe(created.pain)
    expect(fetched!.evidence).toEqual(created.evidence)
  })

  it('returns null for non-existent id', () => {
    expect(getReflection('ref-nonexistent')).toBeNull()
  })

  it('lists reflections ordered by created_at desc', () => {
    createReflection(VALID_INPUT)
    createReflection({ ...VALID_INPUT, pain: 'Different pain', author: 'echo' })

    const reflections = listReflections()
    expect(reflections).toHaveLength(2)
    expect(countReflections()).toBe(2)
    // Most recent first
    expect(reflections[0].author).toBe('echo')
  })

  it('filters by author', () => {
    createReflection(VALID_INPUT)
    createReflection({ ...VALID_INPUT, author: 'echo' })

    const reflections = listReflections({ author: 'link' })
    expect(reflections).toHaveLength(1)
    expect(reflections[0].author).toBe('link')
    expect(countReflections({ author: 'link' })).toBe(1)
  })

  it('filters by role_type', () => {
    createReflection(VALID_INPUT) // engineering
    createReflection({ ...VALID_INPUT, role_type: 'product' })

    const reflections = listReflections({ role_type: 'product' })
    expect(reflections).toHaveLength(1)
    expect(reflections[0].role_type).toBe('product')
  })

  it('filters by severity', () => {
    createReflection({ ...VALID_INPUT, severity: 'critical' })
    createReflection({ ...VALID_INPUT, severity: 'low' })
    createReflection(VALID_INPUT) // no severity

    const reflections = listReflections({ severity: 'critical' })
    expect(reflections).toHaveLength(1)
    expect(reflections[0].severity).toBe('critical')
  })

  it('filters by task_id', () => {
    createReflection({ ...VALID_INPUT, task_id: 'task-abc' })
    createReflection(VALID_INPUT)

    const reflections = listReflections({ task_id: 'task-abc' })
    expect(reflections).toHaveLength(1)
    expect(reflections[0].task_id).toBe('task-abc')
  })

  it('filters by since/before timestamps', () => {
    const ref1 = createReflection(VALID_INPUT)

    // since: everything from ref1's timestamp onward
    const sinceResults = listReflections({ since: ref1.created_at })
    expect(sinceResults).toHaveLength(1)
    expect(sinceResults[0].id).toBe(ref1.id)

    // before: nothing before ref1's timestamp
    const beforeResults = listReflections({ before: ref1.created_at })
    expect(beforeResults).toHaveLength(0)
  })

  it('respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      createReflection({ ...VALID_INPUT, pain: `Pain ${i}` })
    }

    const page1 = listReflections({ limit: 2, offset: 0 })
    expect(page1).toHaveLength(2)
    expect(countReflections()).toBe(5)

    const page2 = listReflections({ limit: 2, offset: 2 })
    expect(page2).toHaveLength(2)

    const page3 = listReflections({ limit: 2, offset: 4 })
    expect(page3).toHaveLength(1)
  })

  it('computes stats', () => {
    createReflection(VALID_INPUT) // engineering, no severity
    createReflection({ ...VALID_INPUT, role_type: 'product', severity: 'high' })
    createReflection({ ...VALID_INPUT, role_type: 'product', severity: 'high', author: 'ryan' })

    const stats = reflectionStats()
    expect(stats.total).toBe(3)
    expect(stats.byRole.engineering).toBe(1)
    expect(stats.byRole.product).toBe(2)
    expect(stats.bySeverity.high).toBe(2)
    expect(stats.avgConfidence).toBe(8)
  })

  it('stores and retrieves metadata', () => {
    const meta = { sprint: 12, tags: ['relay', 'chat'] }
    const ref = createReflection({ ...VALID_INPUT, metadata: meta })
    const fetched = getReflection(ref.id)
    expect(fetched!.metadata).toEqual(meta)
  })

  it('handles confidence boundary values', () => {
    const ref0 = createReflection({ ...VALID_INPUT, confidence: 0 })
    const ref10 = createReflection({ ...VALID_INPUT, confidence: 10 })
    expect(ref0.confidence).toBe(0)
    expect(ref10.confidence).toBe(10)
  })
})

// ── Task linkage ──

describe('Task comment linkage', () => {
  it('creates a task comment when task_id is provided', () => {
    const db = getDb()

    // Create a task first
    db.prepare(`
      INSERT INTO tasks (id, title, status, created_by, created_at, updated_at, comment_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('task-link-test', 'Test task', 'doing', 'system', Date.now(), Date.now(), 0)

    createReflection({ ...VALID_INPUT, task_id: 'task-link-test' })

    const comments = db.prepare('SELECT * FROM task_comments WHERE task_id = ?').all('task-link-test') as Array<{ content: string }>
    expect(comments).toHaveLength(1)
    expect(comments[0].content).toContain('Reflection linked')
    expect(comments[0].content).toContain(VALID_INPUT.pain)

    // Comment count bumped
    const task = db.prepare('SELECT comment_count FROM tasks WHERE id = ?').get('task-link-test') as { comment_count: number }
    expect(task.comment_count).toBe(1)
  })

  it('does not fail when task_id references non-existent task', () => {
    // Should not throw
    const ref = createReflection({ ...VALID_INPUT, task_id: 'task-nonexistent-999' })
    expect(ref.id).toMatch(/^ref-/)
  })
})
