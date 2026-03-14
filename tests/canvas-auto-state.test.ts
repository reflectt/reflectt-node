/**
 * Tests for canvas auto-state sweep.
 * task-1773496304069-qjhnlptpt
 *
 * Verifies: state derivation, push-priority window, unchanged-skip,
 * P0 urgent escalation, and sweep result counts.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveCanvasState,
  runCanvasAutoStateSweep,
  SYNC_INTERVAL_MS,
  PUSH_PRIORITY_WINDOW_MS,
  type CanvasStateEntry,
  type SweepDeps,
} from '../src/canvas-auto-state.js'
import type { Task } from '../src/types.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTask(status: Task['status'], priority: Task['priority'] = 'P2', assignee = 'link'): Task {
  return {
    id: `task-test-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test task',
    description: '',
    status,
    assignee,
    priority,
    done_criteria: [],
    blocked_by: [],
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: null,
  } as unknown as Task
}

function makeDeps(
  tasks: Task[],
  stateMap: Map<string, CanvasStateEntry>,
): SweepDeps & { emitted: Array<{ agentId: string; state: string }> } {
  const emitted: Array<{ agentId: string; state: string }> = []
  return {
    emitted,
    listTasks: () => tasks,
    getCanvasState: (agentId) => stateMap.get(agentId) ?? null,
    emitSyntheticState: (agentId, state) => emitted.push({ agentId, state }),
  }
}

// ── deriveCanvasState ──────────────────────────────────────────────────────

describe('deriveCanvasState', () => {
  it('returns working for doing tasks', () => {
    expect(deriveCanvasState([makeTask('doing')])).toBe('working')
  })

  it('returns urgent for P0 doing tasks', () => {
    expect(deriveCanvasState([makeTask('doing', 'P0')])).toBe('urgent')
  })

  it('returns needs-attention for blocked-only tasks', () => {
    expect(deriveCanvasState([makeTask('blocked')])).toBe('needs-attention')
  })

  it('prefers doing over blocked when both present', () => {
    expect(deriveCanvasState([makeTask('doing'), makeTask('blocked')])).toBe('working')
  })

  it('prefers urgent when P0 doing is mixed in', () => {
    expect(deriveCanvasState([makeTask('doing', 'P2'), makeTask('doing', 'P0')])).toBe('urgent')
  })

  it('returns floor for no active tasks', () => {
    expect(deriveCanvasState([])).toBe('floor')
  })

  it('returns floor for done/todo-only tasks', () => {
    expect(deriveCanvasState([makeTask('done'), makeTask('todo')])).toBe('floor')
  })
})

// ── runCanvasAutoStateSweep ────────────────────────────────────────────────

describe('runCanvasAutoStateSweep', () => {
  it('emits synthetic state for agent with doing task and no prior canvas entry', () => {
    const tasks = [makeTask('doing', 'P2', 'link')]
    const deps = makeDeps(tasks, new Map())
    const result = runCanvasAutoStateSweep(deps)
    expect(deps.emitted).toHaveLength(1)
    expect(deps.emitted[0]).toEqual({ agentId: 'link', state: 'working' })
    expect(result.emitted).toBe(1)
    expect(result.agents).toBe(1)
  })

  it('skips agent who pushed canvas state within PUSH_PRIORITY_WINDOW_MS', () => {
    const tasks = [makeTask('doing', 'P2', 'kai')]
    const stateMap = new Map([
      ['kai', { state: 'thinking' as const, updatedAt: Date.now() - 1000 }], // 1s ago — within window
    ])
    const deps = makeDeps(tasks, stateMap)
    const result = runCanvasAutoStateSweep(deps)
    expect(deps.emitted).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })

  it('emits for agent whose last push exceeded PUSH_PRIORITY_WINDOW_MS', () => {
    const tasks = [makeTask('doing', 'P2', 'sage')]
    const stateMap = new Map([
      ['sage', { state: 'floor' as const, updatedAt: Date.now() - PUSH_PRIORITY_WINDOW_MS - 1000 }],
    ])
    const deps = makeDeps(tasks, stateMap)
    const result = runCanvasAutoStateSweep(deps)
    expect(deps.emitted).toHaveLength(1)
    expect(deps.emitted[0].state).toBe('working')
    expect(result.emitted).toBe(1)
  })

  it('skips emission when derived state matches current state', () => {
    const tasks = [makeTask('doing', 'P2', 'pixel')]
    const stateMap = new Map([
      ['pixel', { state: 'working' as const, updatedAt: Date.now() - PUSH_PRIORITY_WINDOW_MS - 500 }],
    ])
    const deps = makeDeps(tasks, stateMap)
    const result = runCanvasAutoStateSweep(deps)
    expect(deps.emitted).toHaveLength(0)
    expect(result.unchanged).toBe(1)
    expect(result.emitted).toBe(0)
  })

  it('emits urgent for P0 doing task', () => {
    const tasks = [makeTask('doing', 'P0', 'scout')]
    const deps = makeDeps(tasks, new Map())
    runCanvasAutoStateSweep(deps)
    expect(deps.emitted[0].state).toBe('urgent')
  })

  it('emits needs-attention for blocked-only agent', () => {
    const tasks = [makeTask('blocked', 'P1', 'echo')]
    const deps = makeDeps(tasks, new Map())
    runCanvasAutoStateSweep(deps)
    expect(deps.emitted[0].state).toBe('needs-attention')
  })

  it('handles multiple agents independently', () => {
    const tasks = [
      makeTask('doing', 'P2', 'link'),
      makeTask('blocked', 'P1', 'kai'),
      makeTask('doing', 'P0', 'sage'),
    ]
    const deps = makeDeps(tasks, new Map())
    const result = runCanvasAutoStateSweep(deps)
    expect(result.agents).toBe(3)
    expect(result.emitted).toBe(3)
    const byAgent = Object.fromEntries(deps.emitted.map(e => [e.agentId, e.state]))
    expect(byAgent['link']).toBe('working')
    expect(byAgent['kai']).toBe('needs-attention')
    expect(byAgent['sage']).toBe('urgent')
  })

  it('returns zero counts when no active tasks', () => {
    const deps = makeDeps([], new Map())
    const result = runCanvasAutoStateSweep(deps)
    expect(result.agents).toBe(0)
    expect(result.emitted).toBe(0)
    expect(deps.emitted).toHaveLength(0)
  })

  it('ignores tasks with no assignee', () => {
    const task = { ...makeTask('doing'), assignee: null } as unknown as Task
    const deps = makeDeps([task], new Map())
    const result = runCanvasAutoStateSweep(deps)
    expect(result.agents).toBe(0)
    expect(deps.emitted).toHaveLength(0)
  })
})

describe('constants', () => {
  it('SYNC_INTERVAL_MS is 5 seconds', () => {
    expect(SYNC_INTERVAL_MS).toBe(5_000)
  })

  it('PUSH_PRIORITY_WINDOW_MS is 5 seconds', () => {
    expect(PUSH_PRIORITY_WINDOW_MS).toBe(5_000)
  })
})
