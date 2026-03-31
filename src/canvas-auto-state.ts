// SPDX-License-Identifier: Apache-2.0
/**
 * Canvas auto-state sweep.
 *
 * Problem: canvasStateMap is only populated when agents explicitly call
 * POST /canvas/state. Agents working on doing/blocked tasks that don't push
 * state result in a blank canvas (floor state), defeating the live-presence goal.
 *
 * Solution: periodic sweep every SYNC_INTERVAL_MS that:
 *   1. Reads current task board for all agents
 *   2. For agents without a recent canvas push (> PUSH_PRIORITY_WINDOW_MS ago),
 *      derives state from task status and emits a synthetic canvas_render event
 *   3. Never overrides states pushed within PUSH_PRIORITY_WINDOW_MS (agent push wins)
 *
 * Derived state mapping:
 *   doing task  → working
 *   blocked task (only)   → needs-attention
 *   no active tasks       → idle
 *
 * Safety:
 *   - Read-only task query (no mutations)
 *   - Synthetic events are tagged { _auto: true } — distinguishable from agent pushes
 *   - Agent push within PUSH_PRIORITY_WINDOW_MS silences auto-derive for that agent
 *   - sweep() is idempotent — safe to call repeatedly
 *
 * task-1773496304069-qjhnlptpt
 */

import type { Task } from './types.js'

export const SYNC_INTERVAL_MS = 2_000 // 2s — faster updates for more responsive /live
export const PUSH_PRIORITY_WINDOW_MS = 2_000 // agent push within 2s wins

export type CanvasState =
  | 'floor'
  | 'ambient'
  | 'listening'
  | 'thinking'
  | 'rendering'
  | 'decision'
  | 'urgent'
  | 'handoff'

// Maps task status to derived canvas state
export function deriveCanvasState(tasks: Task[]): CanvasState {
  const hasUrgentP0Doing = tasks.some(t => t.status === 'doing' && t.priority === 'P0')
  if (hasUrgentP0Doing) return 'urgent'

  const hasDoing = tasks.some(t => t.status === 'doing')
  if (hasDoing) return 'working' as CanvasState // 'working' is a valid presence state

  const hasBlocked = tasks.some(t => t.status === 'blocked')
  if (hasBlocked) return 'needs-attention' as CanvasState

  return 'floor'
}

export interface CanvasStateEntry {
  state: CanvasState
  updatedAt: number
}

export interface SweepDeps {
  /** Get all tasks, optionally filtered by assignee */
  listTasks(opts: { assignee?: string; status?: Task['status'] | Task['status'][] }): Task[]
  /** Get all known agent IDs (for seeding canvas with all agents) */
  listAllAgents?(): string[]
  /** Get current canvas state entry for an agent (null if never set) */
  getCanvasState(agentId: string): CanvasStateEntry | null
  /** Emit a synthetic canvas state event */
  emitSyntheticState(agentId: string, state: CanvasState, sourceTasks: Task[], thought?: string): void
  /** Emit a canvas_push event for task progress (for /live visitors) */
  emitTaskProgress?(agentId: string, task: Task): void
  /** Emit a canvas_push ambient thought for active agents (more frequent) */
  emitAmbientThought?(agentId: string, task: Task): void
}

export interface SweepResult {
  agents: number
  emitted: number
  skipped: number // skipped: agent pushed recently
  unchanged: number // unchanged: derived state same as current
}

/**
 * Run one auto-state sweep pass.
 * Call this on an interval (SYNC_INTERVAL_MS) from server startup.
 */
export function runCanvasAutoStateSweep(deps: SweepDeps): SweepResult {
  const now = Date.now()

  // Get all agents with active (doing/blocked) tasks
  const activeTasks = deps.listTasks({ status: ['doing', 'blocked'] as Task['status'][] })

  // Group tasks by assignee
  const byAgent = new Map<string, Task[]>()
  for (const task of activeTasks) {
    if (!task.assignee) continue
    const list = byAgent.get(task.assignee) ?? []
    list.push(task)
    byAgent.set(task.assignee, list)
  }

  // Also include ALL known agents (even without tasks) so they're visible on canvas
  // This ensures all team members show up, not just those with active tasks
  const allAgents = deps.listAllAgents ? deps.listAllAgents() : null
  if (allAgents) {
    for (const agentId of allAgents) {
      if (!byAgent.has(agentId)) {
        byAgent.set(agentId, [])
      }
    }
  }

  let emitted = 0
  let skipped = 0
  let unchanged = 0

  // Track current task per agent for change detection
  const currentTasksByAgent = new Map<string, string>()
  // Track last ambient thought emit time per agent
  const lastAmbientByAgent = new Map<string, number>()
  const AMBIENT_THOT_INTERVAL_MS = 8_000 // Emit ambient thought every 8s per active agent

  for (const [agentId, tasks] of byAgent) {
    const current = deps.getCanvasState(agentId)

    // Push-priority: if agent pushed within PUSH_PRIORITY_WINDOW_MS, skip
    if (current && (now - current.updatedAt) <= PUSH_PRIORITY_WINDOW_MS) {
      skipped++
      continue
    }

    const derived = deriveCanvasState(tasks)

    // Skip if state unchanged (avoid redundant events)
    if (current && current.state === derived) {
      unchanged++
    } else {
      deps.emitSyntheticState(agentId, derived, tasks)
      emitted++
    }

    // Emit task progress via canvas_push for /live visitors
    // Track current task and emit when it changes
    if (deps.emitTaskProgress && tasks.length > 0) {
      const primaryTask = tasks[0] // First task is most recent/important
      const prevTaskId = currentTasksByAgent.get(agentId)
      const currentTaskId = primaryTask.id
      
      // Emit if task changed or this is first time we see this agent
      if (prevTaskId !== currentTaskId) {
        currentTasksByAgent.set(agentId, currentTaskId)
        deps.emitTaskProgress(agentId, primaryTask)
      }
    }

    // Emit ambient thought periodically for active agents - makes /live feel more alive
    // Visitors see agents "thinking" throughout their work, not just at task boundaries
    if (deps.emitAmbientThought && tasks.length > 0) {
      const lastAmbient = lastAmbientByAgent.get(agentId) ?? 0
      if (now - lastAmbient >= AMBIENT_THOT_INTERVAL_MS) {
        const primaryTask = tasks[0]
        lastAmbientByAgent.set(agentId, now)
        deps.emitAmbientThought(agentId, primaryTask)
      }
    }
  }

  return {
    agents: byAgent.size,
    emitted,
    skipped,
    unchanged,
  }
}
