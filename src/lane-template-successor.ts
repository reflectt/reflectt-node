// SPDX-License-Identifier: Apache-2.0
// Lane Template Successor Hook
//
// When a task is marked done, maybeCreateSuccessor() fires as async fire-and-forget.
// It loads the lane template for the completed task's lane, checks idempotency,
// queries the insight pool for a candidate, and creates a successor task.
//
// Spec: process/LANE-TEMPLATE-SUCCESSOR-SPEC.md
// Task: task-1773516624288-l8eoxo92h

import { promises as fs } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import type { Task } from './types.js'
import type { LaneConfig } from './lane-config.js'
import { getAgentLane } from './lane-config.js'
import { listInsights } from './insights.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ── Types ──────────────────────────────────────────────────────────────────

interface LaneTemplate {
  lane: string
  description?: string
  done_criteria_template?: string[]
  successor_rule: {
    strategy: string
    insight_pool?: string
    default_task: {
      title: string
      priority: string
      assignee?: string
      tags?: string[]
      done_criteria?: string[]
    }
    idempotency_key_template: string
    max_successors_per_parent?: number
  }
  transition_hook: string
  transition_guard?: {
    require_artifact?: boolean
    require_reviewer_approval?: boolean
    skip_if_successor_exists?: boolean
  }
}

export interface SuccessorResult {
  created: boolean
  taskId?: string
  reason: string
}

// ── Template loader ─────────────────────────────────────────────────────────

async function loadLaneTemplate(lane: string): Promise<LaneTemplate | null> {
  try {
    const templatePath = join(__dirname, '..', 'defaults', 'lane-templates', `${lane}.json`)
    const raw = await fs.readFile(templatePath, 'utf8')
    return JSON.parse(raw) as LaneTemplate
  } catch {
    return null
  }
}

// ── Idempotency check ───────────────────────────────────────────────────────

function idempotencyKeyFor(lane: string, parentTaskId: string): string {
  return `successor:${lane}:${parentTaskId}`
}

async function successorAlreadyExists(
  taskManager: { listTasks?: () => Task[] },
  idempotencyKey: string,
): Promise<boolean> {
  // Import the db query directly to avoid circular dependency with taskManager
  const { getDb } = await import('./db.js')
  const db = getDb()
  // Look for any task with this idempotency_key in metadata
  const rows = db.prepare(
    `SELECT id FROM tasks WHERE json_extract(metadata, '$.idempotency_key') = ? LIMIT 1`
  ).all(idempotencyKey) as Array<{ id: string }>
  return rows.length > 0
}

// ── Insight pool query ──────────────────────────────────────────────────────

function pickInsightCandidate(lane: string): { title: string; description?: string } | null {
  try {
    const { insights } = listInsights({ status: 'candidate', limit: 1 })
    if (!insights || insights.length === 0) return null
    const insight = insights[0]
    return {
      title: insight.title ?? null,
      description: undefined,
    }
  } catch {
    return null
  }
}

// ── Main hook ───────────────────────────────────────────────────────────────

export async function maybeCreateSuccessor(
  completedTask: Task,
  // taskManager injected for testability; defaults to the singleton
  deps?: {
    createTask?: (data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Task>
    addTaskComment?: (taskId: string, author: string, content: string) => Promise<unknown>
    /** Override idempotency check for testing */
    checkIdempotency?: (key: string) => Promise<boolean>
  },
): Promise<SuccessorResult> {
  const taskId = completedTask.id
  const meta = (completedTask.metadata ?? {}) as Record<string, unknown>

  // Determine lane from task metadata or assignee
  const agentLaneConfig: LaneConfig | null = completedTask.assignee
    ? getAgentLane(completedTask.assignee)
    : null
  const lane: string | null =
    (typeof meta.lane === 'string' ? meta.lane : null) ??
    agentLaneConfig?.name ?? null

  if (!lane) {
    return { created: false, reason: 'no lane — skipping successor creation' }
  }

  // Load template
  const template = await loadLaneTemplate(lane)
  if (!template) {
    return { created: false, reason: `no template for lane "${lane}"` }
  }

  // Transition guard: require_artifact
  const guard = template.transition_guard ?? {}
  if (guard.require_artifact) {
    const artifacts = meta.artifacts
    const hasArtifact = Array.isArray(artifacts)
      ? artifacts.length > 0
      : typeof artifacts === 'string' && artifacts.length > 0
    if (!hasArtifact) {
      return { created: false, reason: 'require_artifact guard: no artifacts on completed task' }
    }
  }

  // Idempotency: skip if successor already exists
  const idempotencyKey = idempotencyKeyFor(lane, taskId)
  const checkFn = deps?.checkIdempotency ?? ((key) => successorAlreadyExists({}, key))
  const alreadyExists = await checkFn(idempotencyKey)
  if (alreadyExists) {
    return { created: false, reason: `idempotency: successor already exists (${idempotencyKey})` }
  }

  // Build successor task data
  // Try insight pool first, fall back to default_task
  const insightCandidate = pickInsightCandidate(lane)
  const defaultTask = template.successor_rule.default_task

  const successorTitle = insightCandidate?.title ?? defaultTask.title
  const successorData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> = {
    title: successorTitle,
    status: 'todo',
    priority: (defaultTask.priority ?? 'P3') as Task['priority'],
    assignee: defaultTask.assignee ?? completedTask.assignee ?? undefined,
    done_criteria: defaultTask.done_criteria ?? [],
    createdBy: 'lane-template-successor',
    metadata: {
      idempotency_key: idempotencyKey,
      parent_task_id: taskId,
      auto_generated: true,
      lane,
      tags: defaultTask.tags ?? [],
      ...(insightCandidate ? { source: 'insight_pool' } : { source: 'default_task' }),
    },
  }

  // Create the successor
  let createFn = deps?.createTask
  if (!createFn) {
    const { taskManager } = await import('./tasks.js')
    createFn = (data) => taskManager.createTask(data)
  }

  const successor = await createFn(successorData)

  // Post a comment on the parent task linking to the new successor
  let commentFn = deps?.addTaskComment
  if (!commentFn) {
    const { taskManager } = await import('./tasks.js')
    commentFn = (id, author, content) => taskManager.addTaskComment(id, author, content)
  }

  await commentFn(
    taskId,
    'lane-template-successor',
    `[auto] Successor task created: ${successor.id} — "${successor.title}" (lane: ${lane}, source: ${insightCandidate ? 'insight_pool' : 'default_task'})`,
  )

  return { created: true, taskId: successor.id, reason: `successor created from ${insightCandidate ? 'insight pool' : 'default task'}` }
}
