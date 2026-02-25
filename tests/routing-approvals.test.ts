import { describe, it, expect } from 'vitest'
import {
  getRoutingApprovalQueue,
  isRoutingApproval,
  getRoutingSuggestion,
  buildApprovalPatch,
  buildRejectionPatch,
  buildRoutingSuggestionPatch,
} from '../src/routing-approvals.js'
import type { Task } from '../src/tasks.js'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test task',
    description: '',
    status: 'todo',
    assignee: 'link',
    done_criteria: [],
    createdBy: 'system',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    priority: 'P2',
    ...overrides,
  } as Task
}

describe('getRoutingApprovalQueue', () => {
  it('returns empty for tasks without routing_approval', () => {
    const tasks = [
      makeTask({ metadata: {} }),
      makeTask({ metadata: { some_flag: true } }),
      makeTask({}), // no metadata
    ]
    expect(getRoutingApprovalQueue(tasks)).toHaveLength(0)
  })

  it('returns only tasks with routing_approval=true', () => {
    const approvalTask = makeTask({
      metadata: {
        routing_approval: true,
        routing_suggestion: { suggestedAssignee: 'echo', confidence: 85, reason: 'Best match' },
      },
    })
    const normalTask = makeTask({ metadata: {} })
    const rejectedTask = makeTask({ metadata: { routing_approval: false, routing_rejected: true } })

    const queue = getRoutingApprovalQueue([approvalTask, normalTask, rejectedTask])
    expect(queue).toHaveLength(1)
    expect(queue[0].id).toBe(approvalTask.id)
  })

  it('does not include tasks where routing_approval is false', () => {
    const task = makeTask({ metadata: { routing_approval: false } })
    expect(getRoutingApprovalQueue([task])).toHaveLength(0)
  })
})

describe('isRoutingApproval', () => {
  it('returns true for routing_approval=true', () => {
    expect(isRoutingApproval(makeTask({ metadata: { routing_approval: true } }))).toBe(true)
  })

  it('returns false for no metadata', () => {
    expect(isRoutingApproval(makeTask({}))).toBe(false)
  })

  it('returns false for routing_approval=false', () => {
    expect(isRoutingApproval(makeTask({ metadata: { routing_approval: false } }))).toBe(false)
  })
})

describe('getRoutingSuggestion', () => {
  it('extracts routing suggestion from metadata', () => {
    const task = makeTask({
      metadata: {
        routing_suggestion: {
          suggestedAssignee: 'pixel',
          confidence: 92,
          reason: 'Design task → pixel',
        },
      },
    })
    const suggestion = getRoutingSuggestion(task)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.suggestedAssignee).toBe('pixel')
    expect(suggestion!.confidence).toBe(92)
    expect(suggestion!.reason).toBe('Design task → pixel')
  })

  it('returns null when no suggestion', () => {
    expect(getRoutingSuggestion(makeTask({}))).toBeNull()
    expect(getRoutingSuggestion(makeTask({ metadata: {} }))).toBeNull()
  })

  it('returns null for suggestion without suggestedAssignee', () => {
    const task = makeTask({
      metadata: { routing_suggestion: { confidence: 50, reason: 'test' } },
    })
    expect(getRoutingSuggestion(task)).toBeNull()
  })
})

describe('buildApprovalPatch', () => {
  it('clears routing_approval and stamps approval metadata', () => {
    const patch = buildApprovalPatch('ryan', 'echo', 'Looks good')
    expect(patch.routing_approval).toBe(false)
    expect(patch.routing_decision).toBeDefined()

    const decision = patch.routing_decision as Record<string, unknown>
    expect(decision.approvedBy).toBe('ryan')
    expect(decision.decision).toBe('approved')
    expect(decision.assignee).toBe('echo')
    expect(decision.note).toBe('Looks good')
    expect(decision.approvedAt).toBeDefined()
  })

  it('omits note when not provided', () => {
    const patch = buildApprovalPatch('ryan', 'echo')
    const decision = patch.routing_decision as Record<string, unknown>
    expect(decision.note).toBeUndefined()
  })
})

describe('buildRejectionPatch', () => {
  it('clears routing_approval, sets routing_rejected, stamps rejection', () => {
    const patch = buildRejectionPatch('ryan', 'Wrong assignee')
    expect(patch.routing_approval).toBe(false)
    expect(patch.routing_rejected).toBe(true)

    const decision = patch.routing_decision as Record<string, unknown>
    expect(decision.rejectedBy).toBe('ryan')
    expect(decision.decision).toBe('rejected')
    expect(decision.note).toBe('Wrong assignee')
    expect(decision.rejectedAt).toBeDefined()
  })
})

describe('buildRoutingSuggestionPatch', () => {
  it('sets routing_approval=true and routing_suggestion', () => {
    const patch = buildRoutingSuggestionPatch({
      suggestedAssignee: 'kai',
      confidence: 78,
      reason: 'Architecture task',
      alternatives: [{ agent: 'link', score: 65, reason: 'Also capable' }],
    })
    expect(patch.routing_approval).toBe(true)
    expect(patch.routing_rejected).toBe(false)

    const suggestion = patch.routing_suggestion as Record<string, unknown>
    expect(suggestion.suggestedAssignee).toBe('kai')
    expect(suggestion.confidence).toBe(78)
    expect(suggestion.reason).toBe('Architecture task')
    expect((suggestion.alternatives as unknown[]).length).toBe(1)
  })
})
