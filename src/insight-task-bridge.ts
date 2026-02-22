// SPDX-License-Identifier: Apache-2.0
// Insight→Task Bridge: listens for insight:promoted events and creates tasks.
//
// Severity-aware routing:
//   - high/critical → auto-create task immediately
//   - medium/low → set insight to pending_triage (manual review required)
//
// Design decisions (locked by kai + sage):
//   - Soft guardrail: prefer non-author assignee; if author is best, require non-author reviewer
//   - Required linkage: task.metadata.insight_id + insight.task_id
//   - Idempotency: one task per insight (check insight.task_id before creating)

import { eventBus, type Event } from './events.js'
import { getInsight, updateInsightStatus, type Insight } from './insights.js'
import { taskManager } from './tasks.js'
import { getDb } from './db.js'

// ── Types ──

export interface BridgeConfig {
  enabled: boolean
  autoCreateSeverities: string[]
  defaultReviewer: string
  defaultEtaDays: number
  assignableAgents: string[]
}

export interface BridgeStats {
  tasksAutoCreated: number
  insightsTriaged: number
  duplicatesSkipped: number
  errors: number
  lastEventAt: number | null
}

// ── State ──

const LISTENER_ID = 'insight-task-bridge'

let stats: BridgeStats = {
  tasksAutoCreated: 0,
  insightsTriaged: 0,
  duplicatesSkipped: 0,
  errors: 0,
  lastEventAt: null,
}

let config: BridgeConfig = {
  enabled: true,
  autoCreateSeverities: ['high', 'critical'],
  defaultReviewer: 'sage',
  defaultEtaDays: 3,
  assignableAgents: [],
}

// ── Bridge Logic ──

async function handlePromotedInsight(event: Event): Promise<void> {
  const data = event.data as { kind?: string; insightId?: string }
  if (data.kind !== 'insight:promoted' || !data.insightId) return
  if (!config.enabled) return

  stats.lastEventAt = Date.now()

  const insight = getInsight(data.insightId)
  if (!insight) {
    stats.errors++
    console.error(`[InsightTaskBridge] Insight ${data.insightId} not found`)
    return
  }

  // Idempotency: skip if insight already has a linked task
  if (insight.task_id) {
    stats.duplicatesSkipped++
    return
  }

  const severity = insight.severity_max || 'medium'
  const isAutoCreate = config.autoCreateSeverities.includes(severity)

  if (isAutoCreate) {
    await autoCreateTask(insight)
  } else {
    updateInsightStatus(insight.id, 'pending_triage')
    stats.insightsTriaged++
    console.log(`[InsightTaskBridge] Insight ${insight.id} → pending_triage (severity: ${severity})`)
  }
}

async function autoCreateTask(insight: Insight): Promise<void> {
  const title = `[Insight] ${insight.title}`
  const description = buildTaskDescription(insight)
  const assignee = pickAssignee(insight.authors)
  const reviewer = pickReviewer(insight.authors, assignee)

  try {
    const task = await taskManager.createTask({
      title,
      description,
      status: 'todo',
      priority: (insight.priority as 'P0' | 'P1' | 'P2' | 'P3') || 'P2',
      assignee,
      reviewer,
      createdBy: 'insight-bridge',
      done_criteria: [
        'Root cause addressed or mitigated',
        `Evidence from insight ${insight.id} validated`,
        'Follow-up reflection submitted confirming fix',
      ],
      metadata: {
        insight_id: insight.id,
        promotion_reason: insight.promotion_readiness,
        severity: insight.severity_max,
        source: 'insight-task-bridge',
        reflection_count: insight.reflection_ids.length,
        authors: insight.authors,
      },
    })

    updateInsightStatus(insight.id, 'task_created', task.id)
    stats.tasksAutoCreated++
    console.log(`[InsightTaskBridge] Auto-created task ${task.id} from insight ${insight.id} (severity: ${insight.severity_max}, assignee: ${assignee})`)
  } catch (err) {
    stats.errors++
    console.error(`[InsightTaskBridge] Failed to create task for insight ${insight.id}:`, err)
  }
}

function pickAssignee(authors: string[]): string {
  const candidates = config.assignableAgents.length > 0
    ? config.assignableAgents
    : ['link', 'sage', 'kai', 'pixel', 'echo', 'scout']

  const nonAuthor = candidates.find(a => !authors.includes(a))
  return nonAuthor || authors[0] || candidates[0] || 'unassigned'
}

function pickReviewer(authors: string[], assignee: string): string {
  if (authors.includes(assignee)) {
    const candidates = ['link', 'sage', 'kai', 'pixel', 'echo', 'scout']
      .filter(a => !authors.includes(a) && a !== assignee)
    return candidates[0] || config.defaultReviewer
  }
  return config.defaultReviewer
}

function buildTaskDescription(insight: Insight): string {
  return [
    `Auto-created from promoted insight **${insight.id}**.`,
    '',
    `**Cluster:** ${insight.cluster_key}`,
    `**Severity:** ${insight.severity_max || 'unknown'}`,
    `**Score:** ${insight.score}/10`,
    `**Reflections:** ${insight.reflection_ids.length} (${insight.independent_count} independent)`,
    `**Authors:** ${insight.authors.join(', ')}`,
    '',
    `**Evidence:**`,
    ...insight.evidence_refs.map(e => `- ${e}`),
    '',
    'Investigate root cause, validate evidence, implement fix.',
    'Submit a follow-up reflection when done.',
  ].join('\n')
}

// ── Triage Decision Audit ──

export interface TriageDecision {
  id: string
  insight_id: string
  action: 'approve' | 'dismiss'
  reviewer: string
  rationale: string
  outcome_task_id: string | null
  previous_status: string
  new_status: string
  timestamp: number
}

export function ensureTriageAuditTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS triage_audit (
      id TEXT PRIMARY KEY,
      insight_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      outcome_task_id TEXT,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_triage_audit_insight ON triage_audit(insight_id);
    CREATE INDEX IF NOT EXISTS idx_triage_audit_ts ON triage_audit(timestamp);
  `)
}

export function recordTriageDecision(decision: Omit<TriageDecision, 'id'>): TriageDecision {
  ensureTriageAuditTable()
  const db = getDb()
  const id = `triage-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  db.prepare(`
    INSERT INTO triage_audit (id, insight_id, action, reviewer, rationale, outcome_task_id, previous_status, new_status, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, decision.insight_id, decision.action, decision.reviewer, decision.rationale, decision.outcome_task_id, decision.previous_status, decision.new_status, decision.timestamp)
  return { id, ...decision }
}

export function getTriageAudit(insightId?: string, limit = 50): TriageDecision[] {
  ensureTriageAuditTable()
  const db = getDb()
  if (insightId) {
    return db.prepare('SELECT * FROM triage_audit WHERE insight_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(insightId, limit) as TriageDecision[]
  }
  return db.prepare('SELECT * FROM triage_audit ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as TriageDecision[]
}

// ── Lifecycle ──

export function startInsightTaskBridge(): void {
  if (!config.enabled) {
    console.log('[InsightTaskBridge] Disabled')
    return
  }
  eventBus.on(LISTENER_ID, handlePromotedInsight)
  console.log('[InsightTaskBridge] Listening for insight:promoted events')
}

export function stopInsightTaskBridge(): void {
  eventBus.off(LISTENER_ID)
}

export function getInsightTaskBridgeStats(): BridgeStats {
  return { ...stats }
}

export function _resetBridgeStats(): void {
  stats = { tasksAutoCreated: 0, insightsTriaged: 0, duplicatesSkipped: 0, errors: 0, lastEventAt: null }
}

export { handlePromotedInsight as _handlePromotedInsight }
