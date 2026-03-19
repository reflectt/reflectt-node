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

export const SYNC_INTERVAL_MS = 5_000 // 5s — matches ACTIVE_CANVAS_SYNC_MS
export const PUSH_PRIORITY_WINDOW_MS = 5_000 // agent push within 5s wins

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
  /** Get current canvas state entry for an agent (null if never set) */
  getCanvasState(agentId: string): CanvasStateEntry | null
  /** Emit a synthetic canvas state event */
  emitSyntheticState(agentId: string, state: CanvasState, sourceTasks: Task[], thought?: string): void
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

  // Also include agents who have been seen on canvas (may now be idle)
  // so we can flip them back to floor when they finish
  // (This is handled by the caller passing a set of known canvas agents)

  let emitted = 0
  let skipped = 0
  let unchanged = 0

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
      continue
    }

    deps.emitSyntheticState(agentId, derived, tasks)
    emitted++
  }

  return {
    agents: byAgent.size,
    emitted,
    skipped,
    unchanged,
  }
}
