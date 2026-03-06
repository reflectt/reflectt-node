// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

export type TasksNextEmptyDiagnostics = {
  agent?: string
  /** Counts are "ready" counts: blocked tasks are excluded */
  ready_doing_assigned: number
  ready_todo_unassigned: number
  ready_todo_assigned: number
  ready_validating_assigned: number
}

export function formatTasksNextEmptyResponse(
  diagnostics: TasksNextEmptyDiagnostics,
): { message: string; hint?: string; code: 'NO_AVAILABLE_TASKS'; diagnostics: TasksNextEmptyDiagnostics } {
  const a = diagnostics.agent
  const msgCounts = `ready(todo_unassigned=${diagnostics.ready_todo_unassigned}, todo_assigned_to_you=${diagnostics.ready_todo_assigned}, doing=${diagnostics.ready_doing_assigned}, validating=${diagnostics.ready_validating_assigned})`

  // Base message stays stable for clients; extra info is appended for humans.
  const message = `No available tasks (${msgCounts})`

  let hint: string | undefined

  if (a) {
    // Common confusion: agent is in validating-only state with an empty ready todo queue.
    if (
      diagnostics.ready_doing_assigned === 0 &&
      diagnostics.ready_todo_unassigned === 0 &&
      diagnostics.ready_todo_assigned === 0 &&
      diagnostics.ready_validating_assigned > 0
    ) {
      hint = `@${a} has only validating work right now. Either (1) wait for reviews, (2) unpause/adjust WIP if blocked elsewhere, or (3) mint an unassigned todo to keep the lane moving.`
    } else if (diagnostics.ready_todo_unassigned === 0 && diagnostics.ready_todo_assigned === 0) {
      hint = `No ready todo tasks are available for @${a}. /tasks/next only returns: your doing task, unassigned todo tasks, or todo tasks assigned to you.`
    }
  } else {
    if (diagnostics.ready_todo_unassigned === 0) {
      hint = 'No unassigned todo tasks exist. Create a todo with no assignee (assignee=null) to enable pull-based routing.'
    }
  }

  return {
    code: 'NO_AVAILABLE_TASKS',
    message,
    ...(hint ? { hint } : {}),
    diagnostics,
  }
}
