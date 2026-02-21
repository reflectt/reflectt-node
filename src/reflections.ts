// SPDX-License-Identifier: Apache-2.0
// Reflection entity: structured team learnings with evidence + task linkage

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'
import { eventBus } from './events.js'

// ── Constants ──

export const ROLE_TYPES = ['human', 'agent', 'team'] as const
export type RoleType = (typeof ROLE_TYPES)[number]

export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number]

// ── Types ──

export interface ReflectionInput {
  pain: string
  impact: string
  evidence: string[]          // at least one evidence link/path
  went_well: string
  suspected_why: string
  proposed_fix: string
  confidence: number          // 0–10
  role_type: RoleType
  author: string
  severity?: SeverityLevel
  task_id?: string
  tags?: string[]
  team_id?: string
  metadata?: Record<string, unknown>
}

export interface Reflection extends ReflectionInput {
  id: string
  created_at: number
  updated_at: number
}

// ── Validation ──

export interface ValidationResult {
  valid: boolean
  data: ReflectionInput
  errors?: Array<{ field: string; message: string }>
}

export function validateReflection(body: unknown): ValidationResult {
  const errors: Array<{ field: string; message: string }> = []

  if (!body || typeof body !== 'object') {
    return { valid: false, data: {} as ReflectionInput, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] }
  }

  const b = body as Record<string, unknown>

  // Required string fields
  const requiredStrings = ['pain', 'impact', 'went_well', 'suspected_why', 'proposed_fix', 'author'] as const
  for (const field of requiredStrings) {
    if (typeof b[field] !== 'string' || (b[field] as string).trim().length === 0) {
      errors.push({ field, message: `${field} is required and must be a non-empty string` })
    }
  }

  // Evidence: must be a non-empty array of strings
  if (!Array.isArray(b.evidence) || b.evidence.length === 0) {
    errors.push({ field: 'evidence', message: 'evidence is required and must be a non-empty array of strings' })
  } else {
    const allStrings = b.evidence.every((e: unknown) => typeof e === 'string' && (e as string).trim().length > 0)
    if (!allStrings) {
      errors.push({ field: 'evidence', message: 'each evidence entry must be a non-empty string' })
    }
  }

  // Confidence: number 0–10
  if (typeof b.confidence !== 'number' || b.confidence < 0 || b.confidence > 10 || !Number.isFinite(b.confidence)) {
    errors.push({ field: 'confidence', message: 'confidence is required and must be a number between 0 and 10' })
  }

  // Role type
  if (!ROLE_TYPES.includes(b.role_type as RoleType)) {
    errors.push({ field: 'role_type', message: `role_type is required and must be one of: ${ROLE_TYPES.join(', ')}` })
  }

  // Optional: severity
  if (b.severity !== undefined && b.severity !== null && !SEVERITY_LEVELS.includes(b.severity as SeverityLevel)) {
    errors.push({ field: 'severity', message: `severity must be one of: ${SEVERITY_LEVELS.join(', ')}` })
  }

  // Optional: task_id
  if (b.task_id !== undefined && b.task_id !== null && typeof b.task_id !== 'string') {
    errors.push({ field: 'task_id', message: 'task_id must be a string if provided' })
  }

  // Optional: tags
  if (b.tags !== undefined && b.tags !== null) {
    if (!Array.isArray(b.tags) || !b.tags.every((t: unknown) => typeof t === 'string')) {
      errors.push({ field: 'tags', message: 'tags must be an array of strings if provided' })
    }
  }

  // Optional: team_id
  if (b.team_id !== undefined && b.team_id !== null && typeof b.team_id !== 'string') {
    errors.push({ field: 'team_id', message: 'team_id must be a string if provided' })
  }

  // Optional: metadata
  if (b.metadata !== undefined && b.metadata !== null && (typeof b.metadata !== 'object' || Array.isArray(b.metadata))) {
    errors.push({ field: 'metadata', message: 'metadata must be a plain object if provided' })
  }

  if (errors.length > 0) {
    return { valid: false, data: {} as ReflectionInput, errors }
  }

  const data: ReflectionInput = {
    pain: (b.pain as string).trim(),
    impact: (b.impact as string).trim(),
    evidence: (b.evidence as string[]).map(e => e.trim()),
    went_well: (b.went_well as string).trim(),
    suspected_why: (b.suspected_why as string).trim(),
    proposed_fix: (b.proposed_fix as string).trim(),
    confidence: b.confidence as number,
    role_type: b.role_type as RoleType,
    author: (b.author as string).trim(),
  }

  if (b.severity) data.severity = b.severity as SeverityLevel
  if (b.task_id) data.task_id = (b.task_id as string).trim()
  if (b.tags && Array.isArray(b.tags)) data.tags = b.tags as string[]
  if (b.team_id) data.team_id = (b.team_id as string).trim()
  if (b.metadata && typeof b.metadata === 'object') data.metadata = b.metadata as Record<string, unknown>

  return { valid: true, data }
}

// ── Helpers ──

function generateId(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// ── SQLite row mapping ──

interface ReflectionRow {
  id: string
  pain: string
  impact: string
  evidence: string       // JSON array
  went_well: string
  suspected_why: string
  proposed_fix: string
  confidence: number
  role_type: string
  severity: string | null
  author: string
  task_id: string | null
  tags: string | null
  team_id: string | null
  metadata: string | null
  created_at: number
  updated_at: number
}

function rowToReflection(row: ReflectionRow): Reflection {
  return {
    id: row.id,
    pain: row.pain,
    impact: row.impact,
    evidence: safeJsonParse<string[]>(row.evidence) ?? [],
    went_well: row.went_well,
    suspected_why: row.suspected_why,
    proposed_fix: row.proposed_fix,
    confidence: row.confidence,
    role_type: row.role_type as RoleType,
    severity: (row.severity as SeverityLevel) ?? undefined,
    author: row.author,
    task_id: row.task_id ?? undefined,
    tags: safeJsonParse<string[]>(row.tags),
    team_id: row.team_id ?? undefined,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ── CRUD (standalone functions matching server.ts import) ──

export function createReflection(input: ReflectionInput): Reflection {
  const db = getDb()
  const now = Date.now()
  const id = generateId()

  const reflection: Reflection = { ...input, id, created_at: now, updated_at: now }

  db.prepare(`
    INSERT INTO reflections (
      id, pain, impact, evidence, went_well, suspected_why,
      proposed_fix, confidence, role_type, severity, author,
      task_id, tags, team_id, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    reflection.pain,
    reflection.impact,
    safeJsonStringify(reflection.evidence),
    reflection.went_well,
    reflection.suspected_why,
    reflection.proposed_fix,
    reflection.confidence,
    reflection.role_type,
    reflection.severity ?? null,
    reflection.author,
    reflection.task_id ?? null,
    safeJsonStringify(reflection.tags) ?? null,
    reflection.team_id ?? null,
    safeJsonStringify(reflection.metadata) ?? null,
    now,
    now,
  )

  // Link to task via comment if task_id provided
  if (reflection.task_id) {
    _linkToTask(reflection)
  }

  eventBus.emit('reflection:created', { reflectionId: id, author: reflection.author })

  return reflection
}

export function getReflection(id: string): Reflection | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM reflections WHERE id = ?').get(id) as ReflectionRow | undefined
  return row ? rowToReflection(row) : null
}

export interface ReflectionListOpts {
  author?: string
  role_type?: string
  severity?: string
  task_id?: string
  team_id?: string
  since?: number
  before?: number
  limit?: number
  offset?: number
}

export function listReflections(opts: ReflectionListOpts = {}): Reflection[] {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (opts.author) { where.push('author = ?'); params.push(opts.author) }
  if (opts.role_type) { where.push('role_type = ?'); params.push(opts.role_type) }
  if (opts.severity) { where.push('severity = ?'); params.push(opts.severity) }
  if (opts.task_id) { where.push('task_id = ?'); params.push(opts.task_id) }
  if (opts.team_id) { where.push('team_id = ?'); params.push(opts.team_id) }
  if (opts.since) { where.push('created_at >= ?'); params.push(opts.since) }
  if (opts.before) { where.push('created_at <= ?'); params.push(opts.before) }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0

  const rows = db.prepare(
    `SELECT * FROM reflections ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as ReflectionRow[]

  return rows.map(rowToReflection)
}

export function countReflections(opts: Omit<ReflectionListOpts, 'limit' | 'offset'> = {}): number {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (opts.author) { where.push('author = ?'); params.push(opts.author) }
  if (opts.role_type) { where.push('role_type = ?'); params.push(opts.role_type) }
  if (opts.severity) { where.push('severity = ?'); params.push(opts.severity) }
  if (opts.task_id) { where.push('task_id = ?'); params.push(opts.task_id) }
  if (opts.team_id) { where.push('team_id = ?'); params.push(opts.team_id) }
  if (opts.since) { where.push('created_at >= ?'); params.push(opts.since) }
  if (opts.before) { where.push('created_at <= ?'); params.push(opts.before) }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const result = db.prepare(`SELECT COUNT(*) as c FROM reflections ${whereClause}`).get(...params) as { c: number }
  return result.c
}

export function reflectionStats(): { total: number; by_role_type: Record<string, number>; by_severity: Record<string, number>; by_author: Record<string, number> } {
  const db = getDb()

  const total = (db.prepare('SELECT COUNT(*) as c FROM reflections').get() as { c: number }).c
  const byRole = db.prepare('SELECT role_type, COUNT(*) as c FROM reflections GROUP BY role_type').all() as Array<{ role_type: string; c: number }>
  const bySeverity = db.prepare("SELECT COALESCE(severity, 'unset') as severity, COUNT(*) as c FROM reflections GROUP BY severity").all() as Array<{ severity: string; c: number }>
  const byAuthor = db.prepare('SELECT author, COUNT(*) as c FROM reflections GROUP BY author ORDER BY c DESC LIMIT 20').all() as Array<{ author: string; c: number }>

  return {
    total,
    by_role_type: Object.fromEntries(byRole.map(r => [r.role_type, r.c])),
    by_severity: Object.fromEntries(bySeverity.map(r => [r.severity, r.c])),
    by_author: Object.fromEntries(byAuthor.map(r => [r.author, r.c])),
  }
}

// ── Task linkage ──

function _linkToTask(reflection: Reflection): void {
  try {
    const db = getDb()
    const commentId = `tcomment-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const content = `📝 Reflection linked: ${reflection.id}\n` +
      `**Pain:** ${reflection.pain}\n` +
      `**Impact:** ${reflection.impact}\n` +
      `**Proposed fix:** ${reflection.proposed_fix}\n` +
      `**Confidence:** ${reflection.confidence}/10\n` +
      `**Evidence:** ${reflection.evidence.join(', ')}`

    db.prepare(`
      INSERT OR IGNORE INTO task_comments (id, task_id, author, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(commentId, reflection.task_id, reflection.author, content, reflection.created_at)

    db.prepare(`
      UPDATE tasks SET comment_count = comment_count + 1, updated_at = ?
      WHERE id = ?
    `).run(reflection.created_at, reflection.task_id)
  } catch {
    // Non-fatal: task may not exist
  }
}

// ── Test helpers ──

export function _clearReflectionStore(): void {
  try {
    const db = getDb()
    db.prepare('DELETE FROM reflections').run()
  } catch {
    // Table may not exist
  }
}
