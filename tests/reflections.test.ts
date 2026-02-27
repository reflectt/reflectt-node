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
  role_type: 'agent' as const,
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
    expect(result.errors).toBeUndefined()
    expect(result.data.pain).toBe(VALID_INPUT.pain)
    expect(result.data.evidence).toEqual(VALID_INPUT.evidence)
  })

  it('accepts valid input with optional fields', () => {
    const result = validateReflection({
      ...VALID_INPUT,
      severity: 'high',
      task_id: 'task-123',
      tags: ['relay', 'chat'],
      team_id: 'team-abc',
      metadata: { sprint: 12 },
    })
    expect(result.valid).toBe(true)
    expect(result.data.severity).toBe('high')
    expect(result.data.task_id).toBe('task-123')
    expect(result.data.tags).toEqual(['relay', 'chat'])
    expect(result.data.team_id).toBe('team-abc')
    expect(result.data.metadata).toEqual({ sprint: 12 })
  })

  it('rejects null body', () => {
    const result = validateReflection(null)
    expect(result.valid).toBe(false)
    expect(result.errors).toBeDefined()
  })

  it('rejects missing pain', () => {
    const { pain: _, ...noPain } = VALID_INPUT
    const result = validateReflection(noPain)
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'pain')).toBe(true)
  })

  it('rejects empty impact', () => {
    const result = validateReflection({ ...VALID_INPUT, impact: '' })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'impact')).toBe(true)
  })

  it('rejects empty evidence array', () => {
    const result = validateReflection({ ...VALID_INPUT, evidence: [] })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'evidence')).toBe(true)
  })

  it('rejects non-array evidence', () => {
    const result = validateReflection({ ...VALID_INPUT, evidence: 'just-a-string' })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'evidence')).toBe(true)
  })

  it('rejects evidence with empty strings', () => {
    const result = validateReflection({ ...VALID_INPUT, evidence: ['valid', ''] })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'evidence')).toBe(true)
  })

  it('rejects confidence below 0', () => {
    const result = validateReflection({ ...VALID_INPUT, confidence: -1 })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'confidence')).toBe(true)
  })

  it('rejects confidence above 10', () => {
    const result = validateReflection({ ...VALID_INPUT, confidence: 11 })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'confidence')).toBe(true)
  })

  it('rejects NaN confidence', () => {
    const result = validateReflection({ ...VALID_INPUT, confidence: NaN })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'confidence')).toBe(true)
  })

  it('rejects invalid role_type', () => {
    const result = validateReflection({ ...VALID_INPUT, role_type: 'robot' })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'role_type')).toBe(true)
  })

  it('rejects invalid severity', () => {
    const result = validateReflection({ ...VALID_INPUT, severity: 'extreme' })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'severity')).toBe(true)
  })

  it('rejects empty author', () => {
    const result = validateReflection({ ...VALID_INPUT, author: '' })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'author')).toBe(true)
  })

  it('rejects non-array tags', () => {
    const result = validateReflection({ ...VALID_INPUT, tags: 'not-array' })
    expect(result.valid).toBe(false)
    expect(result.errors!.some(e => e.field === 'tags')).toBe(true)
  })

  it('collects multiple errors', () => {
    const result = validateReflection({ pain: '', evidence: 'not-array', confidence: -5, role_type: 'invalid' })
    expect(result.valid).toBe(false)
    expect(result.errors!.length).toBeGreaterThanOrEqual(4)
  })

  it('trims whitespace from string fields', () => {
    const result = validateReflection({
      ...VALID_INPUT,
      pain: '  leading/trailing  ',
      author: '  link  ',
    })
    expect(result.valid).toBe(true)
    expect(result.data.pain).toBe('leading/trailing')
    expect(result.data.author).toBe('link')
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

describe('createReflection + getReflection', () => {
  it('creates a reflection with generated id and timestamps', () => {
    const ref = createReflection(VALID_INPUT)
    expect(ref.id).toMatch(/^ref-/)
    expect(ref.created_at).toBeGreaterThan(0)
    expect(ref.updated_at).toBe(ref.created_at)
    expect(ref.pain).toBe(VALID_INPUT.pain)
    expect(ref.evidence).toEqual(VALID_INPUT.evidence)
    expect(ref.confidence).toBe(8)
    expect(ref.role_type).toBe('agent')
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

  it('stores and retrieves metadata', () => {
    const meta = { sprint: 12, tags: ['relay', 'chat'] }
    const ref = createReflection({ ...VALID_INPUT, metadata: meta })
    const fetched = getReflection(ref.id)
    expect(fetched!.metadata).toEqual(meta)
  })

  it('stores and retrieves tags', () => {
    const ref = createReflection({ ...VALID_INPUT, tags: ['relay', 'chat'] })
    const fetched = getReflection(ref.id)
    expect(fetched!.tags).toEqual(['relay', 'chat'])
  })

  it('handles confidence boundary values (0 and 10)', () => {
    const ref0 = createReflection({ ...VALID_INPUT, pain: 'Confidence zero test', confidence: 0 })
    const ref10 = createReflection({ ...VALID_INPUT, pain: 'Confidence ten test', confidence: 10 })
    expect(ref0.confidence).toBe(0)
    expect(ref10.confidence).toBe(10)
  })
})

// ── List + Count ──

describe('listReflections + countReflections', () => {
  it('lists reflections ordered by created_at DESC', () => {
    createReflection({ ...VALID_INPUT, pain: 'First' })
    createReflection({ ...VALID_INPUT, pain: 'Second' })
    const list = listReflections()
    expect(list).toHaveLength(2)
    expect(list[0].pain).toBe('Second') // most recent first
  })

  it('countReflections returns total', () => {
    createReflection(VALID_INPUT)
    createReflection({ ...VALID_INPUT, author: 'echo' })
    expect(countReflections()).toBe(2)
  })

  it('filters by author', () => {
    createReflection(VALID_INPUT)
    createReflection({ ...VALID_INPUT, author: 'echo' })
    const list = listReflections({ author: 'link' })
    expect(list).toHaveLength(1)
    expect(list[0].author).toBe('link')
    expect(countReflections({ author: 'link' })).toBe(1)
  })

  it('filters by role_type', () => {
    createReflection({ ...VALID_INPUT, pain: 'Agent role test pain' }) // agent
    createReflection({ ...VALID_INPUT, pain: 'Human role test pain', role_type: 'human' })
    const list = listReflections({ role_type: 'human' })
    expect(list).toHaveLength(1)
    expect(list[0].role_type).toBe('human')
  })

  it('filters by severity', () => {
    createReflection({ ...VALID_INPUT, severity: 'critical' })
    createReflection({ ...VALID_INPUT, severity: 'low' })
    createReflection(VALID_INPUT) // no severity
    const list = listReflections({ severity: 'critical' })
    expect(list).toHaveLength(1)
    expect(list[0].severity).toBe('critical')
  })

  it('filters by task_id', () => {
    createReflection({ ...VALID_INPUT, task_id: 'task-abc' })
    createReflection(VALID_INPUT)
    const list = listReflections({ task_id: 'task-abc' })
    expect(list).toHaveLength(1)
    expect(list[0].task_id).toBe('task-abc')
  })

  it('filters by team_id', () => {
    createReflection({ ...VALID_INPUT, team_id: 'team-1' })
    createReflection(VALID_INPUT)
    const list = listReflections({ team_id: 'team-1' })
    expect(list).toHaveLength(1)
    expect(list[0].team_id).toBe('team-1')
  })

  it('respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      createReflection({ ...VALID_INPUT, pain: `Pain ${i}` })
    }
    const page1 = listReflections({ limit: 2, offset: 0 })
    expect(page1).toHaveLength(2)
    const page2 = listReflections({ limit: 2, offset: 2 })
    expect(page2).toHaveLength(2)
    const page3 = listReflections({ limit: 2, offset: 4 })
    expect(page3).toHaveLength(1)
    expect(countReflections()).toBe(5)
  })
})

// ── Stats ──

describe('reflectionStats', () => {
  it('computes aggregate stats', () => {
    createReflection(VALID_INPUT) // agent, author: link, no severity
    createReflection({ ...VALID_INPUT, role_type: 'human', severity: 'high', author: 'echo' })
    createReflection({ ...VALID_INPUT, role_type: 'human', severity: 'high', author: 'ryan' })

    const stats = reflectionStats()
    expect(stats.total).toBe(3)
    expect(stats.by_role_type.agent).toBe(1)
    expect(stats.by_role_type.human).toBe(2)
    expect(stats.by_severity.high).toBe(2)
    expect(stats.by_author.link).toBe(1)
    expect(stats.by_author.echo).toBe(1)
    expect(stats.by_author.ryan).toBe(1)
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
