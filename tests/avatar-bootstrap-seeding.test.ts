import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('identity-claim task queuing', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'reflectt-identity-claim-'))
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
    vi.unmock('../src/tasks.js')
    vi.unmock('../src/db.js')
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  async function importAssignmentWithMocks() {
    const createdTasks: any[] = []
    const existingTasks: any[] = []

    process.env.REFLECTT_HOME = tempDir
    process.env.NODE_ENV = 'development'
    delete process.env.VITEST

    vi.doMock('../src/tasks.js', () => ({
      taskManager: {
        createTask: vi.fn((task: any) => {
          createdTasks.push(task)
          return { ...task, id: `task-${Date.now()}` }
        }),
        listTasks: vi.fn(() => existingTasks),
      },
    }))

    vi.doMock('../src/db.js', () => ({
      getDb: vi.fn(() => ({
        prepare: vi.fn(() => ({
          get: vi.fn(() => undefined), // no existing agent_config
        })),
      })),
    }))

    const assignment = await import('../src/assignment.js')
    return { assignment, createdTasks, existingTasks }
  }

  it('queues identity-claim tasks for agents without claimed identity', async () => {
    const { assignment, createdTasks } = await importAssignmentWithMocks()

    await assignment.queueIdentityClaimTasks([
      { name: 'kai', role: 'builder', affinityTags: ['backend'], wipCap: 2 },
      { name: 'link', role: 'ops', affinityTags: ['infra'], wipCap: 2 },
    ])

    expect(createdTasks).toHaveLength(2)
    expect(createdTasks[0].title).toBe('Claim your Reflectt identity')
    expect(createdTasks[0].assignee).toBe('kai')
    expect(createdTasks[1].assignee).toBe('link')
    expect(createdTasks[0].metadata.source).toBe('identity-bootstrap')
  })

  it('skips bootstrap agent "main"', async () => {
    const { assignment, createdTasks } = await importAssignmentWithMocks()

    await assignment.queueIdentityClaimTasks([
      { name: 'main', role: 'bootstrap', affinityTags: [], wipCap: 1 },
      { name: 'kai', role: 'builder', affinityTags: ['backend'], wipCap: 2 },
    ])

    expect(createdTasks).toHaveLength(1)
    expect(createdTasks[0].assignee).toBe('kai')
  })

  it('skips agents that already have a claimed identity', async () => {
    process.env.REFLECTT_HOME = tempDir
    process.env.NODE_ENV = 'development'
    delete process.env.VITEST

    const createdTasks: any[] = []

    vi.doMock('../src/tasks.js', () => ({
      taskManager: {
        createTask: vi.fn((task: any) => { createdTasks.push(task); return task }),
        listTasks: vi.fn(() => []),
      },
    }))

    vi.doMock('../src/db.js', () => ({
      getDb: vi.fn(() => ({
        prepare: vi.fn(() => ({
          get: vi.fn((agentId: string) => {
            if (agentId === 'kai') {
              return { settings: JSON.stringify({ avatar: { source: 'agent-claimed', content: '<svg/>' } }) }
            }
            return undefined
          }),
        })),
      })),
    }))

    const assignment = await import('../src/assignment.js')

    await assignment.queueIdentityClaimTasks([
      { name: 'kai', role: 'builder', affinityTags: ['backend'], wipCap: 2 },
      { name: 'link', role: 'ops', affinityTags: ['infra'], wipCap: 2 },
    ])

    expect(createdTasks).toHaveLength(1)
    expect(createdTasks[0].assignee).toBe('link')
  })
})
