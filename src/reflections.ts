// SPDX-License-Identifier: Apache-2.0
// Reflection entity: structured team learnings with evidence + task linkage

import { z } from 'zod'
import { getDb, safeJsonStringify, safeJsonParse } from './db.js'

// ── Schema ──

export const ROLE_TYPES = [
  'engineering', 'product', 'ops', 'comms', 'growth',
  'support', 'sales', 'finance', 'hr', 'other',
] as const
export type RoleType = typeof ROLE_TYPES[number]

export const SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const
export type Severity = typeof SEVERITY_LEVELS[number]

export const RoleTypeSchema = z.enum(ROLE_TYPES)
export const SeveritySchema = z.enum(SEVERITY_LEVELS)

export const ReflectionCreateSchema = z.object({
  /** What hurt — the observed problem */
  pain: z.string().min(1, 'pain is required'),
  /** Severity / business impact description */
  impact: z.string().min(1, 'impact is required'),
  /** Evidence links/paths (at least one required) */
  evidence: z.array(z.string().min(1)).min(1, 'at least one evidence link/path is required'),
  /** What went well despite the problem */
  went_well: z.string().min(1, 'went_well is required'),
  /** Root cause hypothesis */
  suspected_why: z.string().min(1, 'suspected_why is required'),
  /** Concrete next step to prevent recurrence */
  proposed_fix: z.string().min(1, 'proposed_fix is required'),
  /** Author confidence in the diagnosis (0–10) */
  confidence: z.number().min(0).max(10),
  /** Role type of the author */
  role_type: RoleTypeSchema,
  /** Optional severity classification */
  severity: SeveritySchema.optional(),
  /** Optional: link to a task */
  task_id: z.string().optional(),
  /** Author identifier */
  author: z.string().min(1, 'author is required'),
  /** Optional tags for categorization */
  tags: z.array(z.string()).optional(),
  /** Optional team id */
  team_id: z.string().optional(),
  /** Optional metadata */
  metadata: z.record(z.unknown()).optional(),
})

export type ReflectionCreate = z.infer<typeof ReflectionCreateSchema>

export interface Reflection extends ReflectionCreate {
  id: string
  created_at: number
  updated_at: number
}

// ── Validation (explicit, useful error messages) ──

export interface ValidationError {
  field: string
  message: string
}

export function validateReflection(input: unknown): { valid: true; data: ReflectionCreate } | { valid: false; errors: ValidationError[] } {
  const result = ReflectionCreateSchema.safeParse(input)
  if (result.success) {
    return { valid: true, data: result.data }
  }

  const errors: ValidationError[] = result.error.issues.map(issue => ({
    field: issue.path.join('.') || '_body',
    message: issue.message,
  }))
  return { valid: false, errors }
}

// ── Helpers ──

function generateId(): string {
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// ── CRUD ──

export function createReflection(input: ReflectionCreate): Reflection {
  const db = getDb()
  const now = Date.now()
  const id = generateId()

  const reflection: Reflection = {
    ...input,
    id,
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO reflections (
      id, pain, impact, evidence, went_well, suspected_why,
      proposed_fix, confidence, role_type, severity, task_id, author,
      tags, team_id, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reflection.id,
    reflection.pain,
    reflection.impact,
    safeJsonStringify(reflection.evidence),
    reflection.went_well,
    reflection.suspected_why,
    reflection.proposed_fix,
    reflection.confidence,
    reflection.role_type,
    reflection.severity ?? null,
    reflection.task_id ?? null,
    reflection.author,
    safeJsonStringify(reflection.tags) ?? null,
    reflection.team_id ?? null,
    reflection.metadata ? safeJsonStringify(reflection.metadata) : null,
    reflection.created_at,
    reflection.updated_at,
  )

  // If linked to a task, add a comment
  if (reflection.task_id) {
    linkReflectionToTask(reflection)
  }

  // Event emission deferred to insight clustering layer (task 2)

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

  if (opts.author) {
    where.push('author = ?')
    params.push(opts.author)
  }
  if (opts.role_type) {
    where.push('role_type = ?')
    params.push(opts.role_type)
  }
  if (opts.severity) {
    where.push('severity = ?')
    params.push(opts.severity)
  }
  if (opts.task_id) {
    where.push('task_id = ?')
    params.push(opts.task_id)
  }
  if (opts.team_id) {
    where.push('team_id = ?')
    params.push(opts.team_id)
  }
  if (opts.since) {
    where.push('created_at >= ?')
    params.push(opts.since)
  }
  if (opts.before) {
    where.push('created_at < ?')
    params.push(opts.before)
  }

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
  if (opts.before) { where.push('created_at < ?'); params.push(opts.before) }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
  const result = db.prepare(`SELECT COUNT(*) as c FROM reflections ${whereClause}`).get(...params) as { c: number }
  return result.c
}

export function reflectionStats(): {
  total: number
  byRole: Record<string, number>
  bySeverity: Record<string, number>
  avgConfidence: number
} {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM reflections').get() as { c: number }).c
  const roleRows = db.prepare('SELECT role_type, COUNT(*) as c FROM reflections GROUP BY role_type').all() as any[]
  const sevRows = db.prepare('SELECT severity, COUNT(*) as c FROM reflections WHERE severity IS NOT NULL GROUP BY severity').all() as any[]
  const avgRow = db.prepare('SELECT AVG(confidence) as avg FROM reflections').get() as { avg: number | null }

  const byRole: Record<string, number> = {}
  for (const r of roleRows) byRole[r.role_type] = r.c

  const bySeverity: Record<string, number> = {}
  for (const r of sevRows) bySeverity[r.severity] = r.c

  return { total, byRole, bySeverity, avgConfidence: avgRow.avg ?? 0 }
}

// ── Task linkage ──

function linkReflectionToTask(reflection: Reflection): void {
  try {
    const db = getDb()
    const commentId = `tcomment-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const evidenceList = reflection.evidence.join(', ')
    const content = `📝 Reflection linked: ${reflection.id}\n` +
      `**Pain:** ${reflection.pain}\n` +
      `**Impact:** ${reflection.impact}\n` +
      `**Proposed fix:** ${reflection.proposed_fix}\n` +
      `**Confidence:** ${reflection.confidence}/10\n` +
      `**Evidence:** ${evidenceList}` +
      (reflection.severity ? `\n**Severity:** ${reflection.severity}` : '')

    db.prepare(`
      INSERT OR IGNORE INTO task_comments (id, task_id, author, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(commentId, reflection.task_id, reflection.author, content, reflection.created_at)

    // Bump comment count
    db.prepare(`
      UPDATE tasks SET comment_count = comment_count + 1, updated_at = ?
      WHERE id = ?
    `).run(reflection.created_at, reflection.task_id)
  } catch {
    // Non-fatal: task may not exist
  }
}

// ── SQLite row mapping ──

interface ReflectionRow {
  id: string
  pain: string
  impact: string
  evidence: string
  went_well: string
  suspected_why: string
  proposed_fix: string
  confidence: number
  role_type: string
  severity: string | null
  task_id: string | null
  author: string
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
    evidence: safeJsonParse<string[]>(row.evidence) ?? [row.evidence],
    went_well: row.went_well,
    suspected_why: row.suspected_why,
    proposed_fix: row.proposed_fix,
    confidence: row.confidence,
    role_type: row.role_type as RoleType,
    severity: (row.severity as Severity) ?? undefined,
    task_id: row.task_id ?? undefined,
    author: row.author,
    tags: safeJsonParse<string[]>(row.tags),
    team_id: row.team_id ?? undefined,
    metadata: row.metadata ? safeJsonParse<Record<string, unknown>>(row.metadata) ?? undefined : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ── Test helpers ──

export function _clearReflectionStore(): void {
  try {
    const db = getDb()
    db.prepare('DELETE FROM reflections').run()
  } catch {
    // Table may not exist in test setup
  }
}
