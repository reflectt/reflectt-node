// Tests for lane-template successor hook (E2E)
// Covers: A1 (successor created), A2 (idempotency), A3 (require_artifact guard), A4 (missing template)
//
// Task: task-1773516624288-l8eoxo92h
// Spec: process/LANE-TEMPLATE-SUCCESSOR-SPEC.md

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { maybeCreateSuccessor } from '../src/lane-template-successor.js'
import type { Task } from '../src/types.js'

// ── Mock DB for idempotency checks ────────────────────────────────────────

vi.mock('../src/db.js', () => {
  const store = new Map<string, unknown[]>()
  const db = {
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => {
        // Idempotency query: look for tasks with matching idempotency_key
        if (sql.includes('idempotency_key')) {
          const key = args[args.length - 1] as string
          const rows = (store.get('tasks') ?? []) as Array<{ id: string; idempotency_key: string }>
          return rows.filter(r => r.idempotency_key === key)
        }
        return []
      },
      run: (..._args: unknown[]) => ({ changes: 1 }),
      get: (..._args: unknown[]) => null,
    }),
  }
  return {
    getDb: () => db,
    importJsonlIfNeeded: () => {},
    safeJsonStringify: (v: unknown) => JSON.stringify(v),
    safeJsonParse: (v: string) => JSON.parse(v),
    __store: store,
  }
})

// ── Mock insights (empty pool by default) ─────────────────────────────────

vi.mock('../src/insights.js', () => ({
  listInsights: vi.fn().mockReturnValue({ insights: [], total: 0 }),
}))

// ── Mock lane-config ───────────────────────────────────────────────────────

vi.mock('../src/lane-config.js', () => ({
  getAgentLane: (agent: string) => {
    if (agent === 'rhythm') return 'ops'
    return null
  },
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: 'ops: test task',
    status: 'done',
    priority: 'P2',
    assignee: 'rhythm',
    createdBy: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    done_criteria: [],
    metadata: { lane: 'ops', artifacts: ['process/TASK-test.md'] },
    ...overrides,
  }
}

function makeDeps(createdIds: string[]) {
  // Track created idempotency keys in-memory for the checkIdempotency dep
  const createdKeys = new Set<string>()

  const createTask = vi.fn(async (data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = `task-succ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    createdIds.push(id)
    const key = (data.metadata as any)?.idempotency_key
    if (key) createdKeys.add(key)
    return { ...data, id, createdAt: Date.now(), updatedAt: Date.now() } as Task
  })
  const addTaskComment = vi.fn(async () => ({}))
  const checkIdempotency = async (key: string) => createdKeys.has(key)

  return { createTask, addTaskComment, checkIdempotency }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('lane-template successor hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('A1: completing an ops-lane task creates exactly one successor task', async () => {
    const createdIds: string[] = []
    const deps = makeDeps(createdIds)
    const task = makeTask()

    const result = await maybeCreateSuccessor(task, deps)

    expect(result.created).toBe(true)
    expect(result.taskId).toBeDefined()
    expect(deps.createTask).toHaveBeenCalledOnce()
    expect(deps.addTaskComment).toHaveBeenCalledOnce()

    // Verify successor metadata
    const [successorData] = deps.createTask.mock.calls[0]
    const meta = successorData.metadata as Record<string, unknown>
    expect(meta.auto_generated).toBe(true)
    expect(meta.parent_task_id).toBe(task.id)
    expect(typeof meta.idempotency_key).toBe('string')
    expect(meta.idempotency_key).toContain('successor:ops:')
  })

  it('A2: completing the same task again does NOT create a second successor (idempotency)', async () => {
    const createdIds: string[] = []
    const deps = makeDeps(createdIds)
    const task = makeTask({ id: 'task-idempotency-test' })

    // First call — should create
    const first = await maybeCreateSuccessor(task, deps)
    expect(first.created).toBe(true)

    // Second call — same task, should be blocked by idempotency
    const second = await maybeCreateSuccessor(task, deps)
    expect(second.created).toBe(false)
    expect(second.reason).toMatch(/idempotency/)
    expect(deps.createTask).toHaveBeenCalledOnce() // not twice
  })

  it('A3: a task without artifacts when require_artifact=true does NOT trigger successor creation', async () => {
    const createdIds: string[] = []
    const deps = makeDeps(createdIds)
    // ops template has require_artifact: true — task has no artifacts
    const task = makeTask({ metadata: { lane: 'ops' } }) // no artifacts field

    const result = await maybeCreateSuccessor(task, deps)

    expect(result.created).toBe(false)
    expect(result.reason).toMatch(/require_artifact/)
    expect(deps.createTask).not.toHaveBeenCalled()
  })

  it('A4: missing lane template file → no successor created, no error thrown', async () => {
    const createdIds: string[] = []
    const deps = makeDeps(createdIds)
    // lane 'nonexistent-lane' has no template file
    const task = makeTask({ metadata: { lane: 'nonexistent-lane', artifacts: ['x'] } })

    const result = await maybeCreateSuccessor(task, deps)

    expect(result.created).toBe(false)
    expect(result.reason).toMatch(/no template/)
    expect(deps.createTask).not.toHaveBeenCalled()
  })

  it('uses insight pool candidate when available', async () => {
    const { listInsights } = await import('../src/insights.js') as any
    listInsights.mockReturnValueOnce({
      insights: [{ id: 'ins-1', title: 'improve ops alerting', summary: 'Fix alert lag' }],
      total: 1,
    })

    const createdIds: string[] = []
    const deps = makeDeps(createdIds)
    const task = makeTask()

    const result = await maybeCreateSuccessor(task, deps)

    expect(result.created).toBe(true)
    const [successorData] = deps.createTask.mock.calls[0]
    expect(successorData.title).toBe('improve ops alerting')
    expect((successorData.metadata as any).source).toBe('insight_pool')
  })

  it('falls back to default_task when insight pool is empty', async () => {
    const createdIds: string[] = []
    const deps = makeDeps(createdIds)
    const task = makeTask()

    const result = await maybeCreateSuccessor(task, deps)

    expect(result.created).toBe(true)
    const [successorData] = deps.createTask.mock.calls[0]
    expect(successorData.title).toContain('ops') // default title contains 'ops'
    expect((successorData.metadata as any).source).toBe('default_task')
  })

  it('returns gracefully when no lane is determinable', async () => {
    const deps = makeDeps([])
    const task = makeTask({ assignee: 'unknown-agent', metadata: {} })

    const result = await maybeCreateSuccessor(task, deps)

    expect(result.created).toBe(false)
    expect(result.reason).toMatch(/no lane/)
  })
})
