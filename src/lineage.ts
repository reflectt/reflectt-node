// SPDX-License-Identifier: Apache-2.0
// Reflection → Insight → Task lineage timeline
//
// Traces the full chain from reflection through insight clustering to task
// creation. Surfaces linked IDs, event timestamps, and missing-link anomalies
// for debugging and audit.

import { getDb, safeJsonParse } from './db.js'

// ── Types ──

export interface LineageEntry {
  /** Unique lineage chain ID (derived from insight or reflection) */
  chain_id: string
  /** Reflection that started the chain */
  reflection: {
    id: string
    author: string
    pain: string
    severity: string | null
    confidence: number
    created_at: number
  } | null
  /** Insight the reflection was clustered into */
  insight: {
    id: string
    cluster_key: string
    status: string
    score: number
    priority: string
    promotion_readiness: string
    reflection_count: number
    independent_count: number
    severity_max: string | null
    created_at: number
    updated_at: number
  } | null
  /** Task created from the insight (if any) */
  task: {
    id: string
    title: string
    status: string
    priority: string
    assignee: string | null
    reviewer: string | null
    created_at: number
  } | null
  /** Promotion audit record (if promoted) */
  promotion: {
    id: string
    promoted_by: string
    created_at: number
  } | null
  /** Missing-link anomalies detected in this chain */
  anomalies: LineageAnomaly[]
  /** Timestamps of key events in the chain */
  timeline: TimelineEvent[]
}

export interface LineageAnomaly {
  type: 'missing_insight' | 'missing_task' | 'orphaned_insight' | 'stale_promotion' | 'missing_reflection'
  message: string
  severity: 'warning' | 'error'
}

export interface TimelineEvent {
  event: string
  timestamp: number
  actor?: string
  detail?: string
}

export interface LineageListOpts {
  status?: string
  team_id?: string
  role_type?: string
  author?: string
  has_anomaly?: boolean
  limit?: number
  offset?: number
}

// ── Core ──

/**
 * Build lineage entries by walking insight → reflections → tasks.
 * Each insight forms a chain; orphaned reflections (no insight) get their own chain.
 */
export function listLineage(opts: LineageListOpts = {}): { entries: LineageEntry[]; total: number } {
  const db = getDb()
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0

  // Start from insights (they are the central node in the chain)
  const insightWhere: string[] = []
  const insightParams: unknown[] = []

  if (opts.status) {
    insightWhere.push('i.status = ?')
    insightParams.push(opts.status)
  }

  const insightWhereClause = insightWhere.length > 0 ? `WHERE ${insightWhere.join(' AND ')}` : ''

  // Count total insights
  const totalRow = db.prepare(
    `SELECT COUNT(*) as c FROM insights i ${insightWhereClause}`
  ).get(...insightParams) as { c: number }

  // Get insight rows
  const insightRows = db.prepare(
    `SELECT * FROM insights i ${insightWhereClause} ORDER BY i.updated_at DESC LIMIT ? OFFSET ?`
  ).all(...insightParams, limit, offset) as any[]

  const entries: LineageEntry[] = []

  for (const row of insightRows) {
    const entry = buildLineageFromInsight(row, opts)
    if (entry) {
      // Filter by anomaly if requested
      if (opts.has_anomaly === true && entry.anomalies.length === 0) continue
      if (opts.has_anomaly === false && entry.anomalies.length > 0) continue
      entries.push(entry)
    }
  }

  return { entries, total: totalRow.c }
}

/**
 * Get lineage for a specific chain (by insight ID, reflection ID, or task ID).
 */
export function getLineage(id: string): LineageEntry | null {
  const db = getDb()

  // Try as insight ID
  if (id.startsWith('ins-')) {
    const row = db.prepare('SELECT * FROM insights WHERE id = ?').get(id) as any
    if (row) return buildLineageFromInsight(row, {})
  }

  // Try as reflection ID — find its insight
  if (id.startsWith('ref-')) {
    const insightRow = db.prepare(
      `SELECT * FROM insights WHERE reflection_ids LIKE ?`
    ).get(`%${id}%`) as any
    if (insightRow) return buildLineageFromInsight(insightRow, {})

    // Orphaned reflection (no insight)
    const refRow = db.prepare('SELECT * FROM reflections WHERE id = ?').get(id) as any
    if (refRow) return buildOrphanedReflectionLineage(refRow)
    return null
  }

  // Try as task ID — find linked insight
  if (id.startsWith('task-')) {
    const insightRow = db.prepare(
      `SELECT * FROM insights WHERE task_id = ?`
    ).get(id) as any
    if (insightRow) return buildLineageFromInsight(insightRow, {})

    // Check promotion audits
    const auditRow = db.prepare(
      `SELECT insight_id FROM promotion_audits WHERE task_id = ?`
    ).get(id) as any
    if (auditRow) {
      const insRow = db.prepare('SELECT * FROM insights WHERE id = ?').get(auditRow.insight_id) as any
      if (insRow) return buildLineageFromInsight(insRow, {})
    }
    return null
  }

  // Generic search
  const insightRow = db.prepare('SELECT * FROM insights WHERE id = ?').get(id) as any
  if (insightRow) return buildLineageFromInsight(insightRow, {})

  return null
}

// ── Builders ──

function buildLineageFromInsight(insightRow: any, opts: LineageListOpts): LineageEntry | null {
  const db = getDb()
  const anomalies: LineageAnomaly[] = []
  const timeline: TimelineEvent[] = []

  // Parse insight
  const reflectionIds = safeJsonParse<string[]>(insightRow.reflection_ids) ?? []
  const authors = safeJsonParse<string[]>(insightRow.authors) ?? []

  const insight = {
    id: insightRow.id,
    cluster_key: insightRow.cluster_key,
    status: insightRow.status,
    score: insightRow.score,
    priority: insightRow.priority,
    promotion_readiness: insightRow.promotion_readiness,
    reflection_count: reflectionIds.length,
    independent_count: insightRow.independent_count,
    severity_max: insightRow.severity_max,
    created_at: insightRow.created_at,
    updated_at: insightRow.updated_at,
  }

  timeline.push({
    event: 'insight_created',
    timestamp: insightRow.created_at,
    detail: `Cluster: ${insightRow.cluster_key}`,
  })

  // Load first reflection (representative)
  let firstReflection: LineageEntry['reflection'] = null
  if (reflectionIds.length > 0) {
    // Filter by author/role_type/team_id if specified
    const refRow = db.prepare('SELECT * FROM reflections WHERE id = ?').get(reflectionIds[0]) as any
    if (refRow) {
      // Apply filters
      if (opts.author && refRow.author !== opts.author) {
        // Check if ANY reflection in this chain matches the author filter
        const anyMatch = reflectionIds.some((rid: string) => {
          const r = db.prepare('SELECT author FROM reflections WHERE id = ?').get(rid) as any
          return r && r.author === opts.author
        })
        if (!anyMatch) return null
      }
      if (opts.role_type && refRow.role_type !== opts.role_type) {
        const anyMatch = reflectionIds.some((rid: string) => {
          const r = db.prepare('SELECT role_type FROM reflections WHERE id = ?').get(rid) as any
          return r && r.role_type === opts.role_type
        })
        if (!anyMatch) return null
      }
      if (opts.team_id && refRow.team_id !== opts.team_id) {
        const anyMatch = reflectionIds.some((rid: string) => {
          const r = db.prepare('SELECT team_id FROM reflections WHERE id = ?').get(rid) as any
          return r && r.team_id === opts.team_id
        })
        if (!anyMatch) return null
      }

      firstReflection = {
        id: refRow.id,
        author: refRow.author,
        pain: refRow.pain,
        severity: refRow.severity ?? null,
        confidence: refRow.confidence,
        created_at: refRow.created_at,
      }

      timeline.push({
        event: 'reflection_created',
        timestamp: refRow.created_at,
        actor: refRow.author,
        detail: refRow.pain.slice(0, 80),
      })
    } else {
      anomalies.push({
        type: 'missing_reflection',
        message: `Reflection ${reflectionIds[0]} referenced by insight but not found in DB`,
        severity: 'error',
      })
    }
  } else {
    anomalies.push({
      type: 'orphaned_insight',
      message: `Insight ${insightRow.id} has no linked reflections`,
      severity: 'warning',
    })
  }

  // Check for linked task
  let task: LineageEntry['task'] = null
  const taskId = insightRow.task_id
  if (taskId) {
    const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any
    if (taskRow) {
      task = {
        id: taskRow.id,
        title: taskRow.title,
        status: taskRow.status,
        priority: taskRow.priority,
        assignee: taskRow.assignee ?? null,
        reviewer: taskRow.reviewer ?? null,
        created_at: taskRow.created_at,
      }
      timeline.push({
        event: 'task_created',
        timestamp: taskRow.created_at,
        actor: taskRow.created_by ?? 'system',
        detail: taskRow.title,
      })
    } else {
      anomalies.push({
        type: 'missing_task',
        message: `Task ${taskId} linked to insight but not found in DB`,
        severity: 'error',
      })
    }
  } else if (insightRow.status === 'task_created' || insightRow.status === 'promoted') {
    // Promoted/task_created insight without a task_id is suspicious
    if (insightRow.status === 'task_created') {
      anomalies.push({
        type: 'missing_task',
        message: `Insight ${insightRow.id} is status=task_created but has no task_id`,
        severity: 'error',
      })
    }
  }

  // Check for promotion audit
  let promotion: LineageEntry['promotion'] = null
  try {
    const auditRow = db.prepare(
      'SELECT * FROM promotion_audits WHERE insight_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(insightRow.id) as any
    if (auditRow) {
      promotion = {
        id: auditRow.id,
        promoted_by: auditRow.promoted_by,
        created_at: auditRow.created_at,
      }
      timeline.push({
        event: 'insight_promoted',
        timestamp: auditRow.created_at,
        actor: auditRow.promoted_by,
      })
    }
  } catch {
    // promotion_audits table may not exist
  }

  // Stale promotion check: promoted > 48h ago with no task
  if (insightRow.status === 'promoted' && !taskId) {
    const hoursSincePromotion = (Date.now() - insightRow.updated_at) / (1000 * 60 * 60)
    if (hoursSincePromotion > 48) {
      anomalies.push({
        type: 'stale_promotion',
        message: `Insight promoted ${Math.floor(hoursSincePromotion)}h ago but no task created`,
        severity: 'warning',
      })
    }
  }

  // Sort timeline by timestamp
  timeline.sort((a, b) => a.timestamp - b.timestamp)

  return {
    chain_id: insightRow.id,
    reflection: firstReflection,
    insight,
    task,
    promotion,
    anomalies,
    timeline,
  }
}

function buildOrphanedReflectionLineage(refRow: any): LineageEntry {
  return {
    chain_id: refRow.id,
    reflection: {
      id: refRow.id,
      author: refRow.author,
      pain: refRow.pain,
      severity: refRow.severity ?? null,
      confidence: refRow.confidence,
      created_at: refRow.created_at,
    },
    insight: null,
    task: null,
    promotion: null,
    anomalies: [{
      type: 'missing_insight',
      message: `Reflection ${refRow.id} was not clustered into any insight`,
      severity: 'warning',
    }],
    timeline: [{
      event: 'reflection_created',
      timestamp: refRow.created_at,
      actor: refRow.author,
      detail: refRow.pain.slice(0, 80),
    }],
  }
}

// ── Stats ──

export function lineageStats(): {
  total_chains: number
  with_task: number
  with_anomalies: number
  anomaly_breakdown: Record<string, number>
} {
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM insights').get() as { c: number }).c
  const withTask = (db.prepare('SELECT COUNT(*) as c FROM insights WHERE task_id IS NOT NULL').get() as { c: number }).c

  // Count anomalies by scanning (could be cached in production)
  let withAnomalies = 0
  const anomalyBreakdown: Record<string, number> = {}

  const rows = db.prepare('SELECT * FROM insights ORDER BY updated_at DESC LIMIT 500').all() as any[]
  for (const row of rows) {
    const entry = buildLineageFromInsight(row, {})
    if (entry && entry.anomalies.length > 0) {
      withAnomalies++
      for (const a of entry.anomalies) {
        anomalyBreakdown[a.type] = (anomalyBreakdown[a.type] || 0) + 1
      }
    }
  }

  return { total_chains: total, with_task: withTask, with_anomalies: withAnomalies, anomaly_breakdown: anomalyBreakdown }
}
