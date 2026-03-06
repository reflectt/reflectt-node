// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { formatTasksNextEmptyResponse } from '../src/tasks-next-diagnostics.js'

describe('tasks-next diagnostics formatting', () => {
  it('adds a validating-only hint', () => {
    const res = formatTasksNextEmptyResponse({
      agent: 'sage',
      ready_doing_assigned: 0,
      ready_todo_unassigned: 0,
      ready_todo_assigned: 0,
      ready_validating_assigned: 2,
    })

    expect(res.code).toBe('NO_AVAILABLE_TASKS')
    expect(res.message).toContain('No available tasks')
    expect(res.message).toContain('ready(')
    expect(res.hint || '').toContain('only validating')
    expect(res.hint || '').toContain('@sage')
  })

  it('adds an explanation when nothing is available for the agent', () => {
    const res = formatTasksNextEmptyResponse({
      agent: 'sage',
      ready_doing_assigned: 0,
      ready_todo_unassigned: 0,
      ready_todo_assigned: 0,
      ready_validating_assigned: 0,
    })

    expect(res.hint || '').toContain('/tasks/next only returns')
  })

  it('adds a hint for agentless pulls when queue is empty', () => {
    const res = formatTasksNextEmptyResponse({
      agent: undefined,
      ready_doing_assigned: 0,
      ready_todo_unassigned: 0,
      ready_todo_assigned: 0,
      ready_validating_assigned: 0,
    })

    expect(res.hint || '').toContain('unassigned todo')
  })
})
