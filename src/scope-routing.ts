// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Deterministic channel → scope mapping.
 *
 * Why: prevent agent state from forking unpredictably across channels by bucketing
 * session-local context + overflow memos under a stable scope id.
 */

export interface ScopeRoutingInput {
  /** Explicit override: if present, always used. */
  scope_id?: string | null

  /** Channel name (e.g. general, ops, task-comments, dm:ryan). */
  channel?: string | null

  /** Known task id for task-scoped contexts. */
  task_id?: string | null

  /** DM peer identifier (gateway-dependent). */
  peer?: string | null
}

export function deriveScopeId(input: ScopeRoutingInput): string {
  const override = String(input.scope_id || '').trim()
  if (override) return override

  const ch = String(input.channel || 'general').trim().toLowerCase()
  const taskId = String(input.task_id || '').trim()
  const peer = String(input.peer || '').trim()

  // 1) Team scope
  if (ch === 'general' || ch === 'ops') return 'team:default'

  // 2) Task scope
  if (ch === 'task-comments' || ch === 'task-notifications' || ch.startsWith('task-') || ch.includes('task')) {
    return taskId ? `task:${taskId}` : 'team:default'
  }

  // 3) User scope (DM)
  if (ch.startsWith('dm:')) {
    const suffix = ch.slice('dm:'.length).trim()
    if (suffix) return `user:${suffix}`
  }

  if (peer) return `user:${peer}`

  // Default
  return 'team:default'
}
