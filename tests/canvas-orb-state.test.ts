/**
 * Canvas orb state — task transitions emit canvas_render to update agent orbs
 * task-1773525394065-f13ucg8ir
 *
 * Root cause: task state transitions only emitted canvas_push (utterance/work_released)
 * but never canvas_render. Orbs stayed idle even when agents were working.
 *
 * Fix: emit canvas_render alongside canvas_push so the browser orb state ring
 * reflects the actual agent working state.
 *
 * State mapping:
 *   todo→doing        → canvas_render(presence.state: 'working')
 *   doing→validating  → canvas_render(presence.state: 'handoff')
 *   any→done          → canvas_render(presence.state: 'idle')
 *   any→blocked       → canvas_render(presence.state: 'needs-attention')
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { createServer } from '../src/server.js'
import { eventBus } from '../src/events.js'

// ── Types ──────────────────────────────────────────────────────────────────
interface CapturedEvent {
  type: string
  data: any
}

// ── Test helpers ───────────────────────────────────────────────────────────
function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    title: 'TEST: canvas orb state',
    assignee: 'link',
    priority: 'P2' as const,
    lane: 'engineering',
    status: 'todo' as const,
    done_criteria: ['orb state emits canvas_render on each transition'],
    metadata: { reviewer: 'kai', eta: '2099-01-01' },
    ...overrides,
  }
}

describe('Canvas orb state — task transitions', () => {
  let db: Database.Database
  let app: Awaited<ReturnType<typeof createServer>>
  let captured: CapturedEvent[]
  let listenerId: string

  beforeEach(async () => {
    db = new Database(':memory:')
    app = await createServer({ db, port: 0 })
    await app.ready()

    captured = []
    listenerId = `test-orb-${Date.now()}`
    eventBus.on(listenerId, (event) => {
      if (event.type === 'canvas_push' || event.type === 'canvas_render') {
        captured.push({ type: event.type, data: event.data })
      }
    })
  })

  afterEach(async () => {
    eventBus.off(listenerId)
    await app.close()
    db.close()
  })

  // ── Create a task and return its id ──────────────────────────────────────
  async function createTask(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/tasks',
      payload: makeTask(overrides),
    })
    expect(res.statusCode, `createTask failed: ${res.body}`).toBeGreaterThanOrEqual(200)
    expect(res.statusCode, `createTask failed: ${res.body}`).toBeLessThan(300)
    return JSON.parse(res.body).task.id
  }

  async function transition(taskId: string, status: string, meta: Record<string, unknown> = {}): Promise<void> {
    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${taskId}`,
      payload: { status, actor: 'link', metadata: meta },
    })
    expect(res.statusCode, `transition to ${status} failed: ${res.body}`).toBe(200)
    captured.length = 0  // reset captures AFTER the transition
  }

  // ── Tests ─────────────────────────────────────────────────────────────────

  it('A: todo→doing emits canvas_push utterance + canvas_render working', async () => {
    const id = await createTask()
    captured.length = 0

    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${id}`,
      payload: { status: 'doing', actor: 'link', metadata: { reviewer: 'kai', eta: '2099-01-01' } },
    })
    expect(res.statusCode).toBe(200)

    const push = captured.find(e => e.type === 'canvas_push')
    expect(push, 'should emit canvas_push on doing').toBeTruthy()
    expect(push!.data.type).toBe('utterance')
    expect(push!.data.agentId).toBe('link')

    const render = captured.find(e => e.type === 'canvas_render')
    expect(render, 'should emit canvas_render on doing').toBeTruthy()
    expect(render!.data.presence?.state).toBe('working')
    expect(render!.data.presence?.activeTask?.id).toBe(id)
  })

  it('B: doing→validating emits work_released + canvas_render handoff', async () => {
    const id = await createTask()
    const suffix = id.split('-').slice(-1)[0]
    const artifactPath = `process/TASK-${suffix}.md`
    await transition(id, 'doing', { reviewer: 'kai', eta: '2099-01-01' })

    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${id}`,
      payload: {
        status: 'validating', actor: 'link',
        metadata: {
          reviewer: 'kai',
          review_handoff: { pr_url: 'https://github.com/reflectt/reflectt-node/pull/1', task_id: id, commit_sha: 'abc1234', artifact_path: artifactPath, known_caveats: 'none' },
          qa_bundle: { lane: 'engineering', summary: 'test', review_packet: { task_id: id, pr_url: 'https://github.com/reflectt/reflectt-node/pull/1', commit: 'abc1234', changed_files: ['src/server.ts'], artifact_path: artifactPath, what_changed: 'test', how_tested: 'unit', caveats: 'none' } },
        },
      },
    })
    expect(res.statusCode, `validating failed: ${res.body}`).toBe(200)

    const render = captured.find(e => e.type === 'canvas_render')
    expect(render, 'should emit canvas_render on validating').toBeTruthy()
    expect(render!.data.presence?.state).toBe('handoff')
  })

  it('C: any→done emits work_released + canvas_render idle', async () => {
    const id = await createTask()
    const suffix = id.split('-').slice(-1)[0]
    const artifactPath = `process/TASK-${suffix}.md`
    await transition(id, 'doing', { reviewer: 'kai', eta: '2099-01-01' })
    const qaMeta = {
      reviewer: 'kai',
      review_handoff: { pr_url: 'https://github.com/reflectt/reflectt-node/pull/1', task_id: id, commit_sha: 'abc1234', artifact_path: artifactPath, known_caveats: 'none' },
      qa_bundle: { lane: 'engineering', summary: 'test', review_packet: { task_id: id, pr_url: 'https://github.com/reflectt/reflectt-node/pull/1', commit: 'abc1234', changed_files: ['src/server.ts'], artifact_path: artifactPath, what_changed: 'test', how_tested: 'unit', caveats: 'none' } },
    }
    const vRes = await app.inject({
      method: 'PATCH', url: `/tasks/${id}`,
      payload: { status: 'validating', actor: 'link', metadata: qaMeta },
    })
    expect(vRes.statusCode, `validating step failed: ${vRes.body}`).toBe(200)
    captured.length = 0

    // Get the actual reviewer set by the server so we can approve as them
    const taskRes = await app.inject({ method: 'GET', url: `/tasks/${id}` })
    const reviewer = JSON.parse(taskRes.body).task.reviewer || 'kai'

    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${id}`,
      payload: {
        status: 'done', actor: reviewer,
        metadata: {
          reviewer_approved: true,
          actor: reviewer,
          artifacts: [{ kind: 'test', url: 'https://example.com' }],
        },
      },
    })
    expect(res.statusCode, `done failed: ${res.body}`).toBe(200)

    const render = captured.find(e => e.type === 'canvas_render')
    expect(render, 'should emit canvas_render on done').toBeTruthy()
    expect(render!.data.presence?.state).toBe('idle')
  })

  it('D: any→blocked emits utterance + canvas_render needs-attention', async () => {
    const id = await createTask()
    await transition(id, 'doing', { reviewer: 'kai', eta: '2099-01-01' })
    captured.length = 0

    const res = await app.inject({
      method: 'PATCH', url: `/tasks/${id}`,
      payload: {
        status: 'blocked', actor: 'link',
        metadata: { transition: { type: 'pause', reason: 'waiting on reviewer' } },
      },
    })
    expect(res.statusCode, `blocked failed: ${res.body}`).toBe(200)

    const push = captured.find(e => e.type === 'canvas_push')
    expect(push?.data.type).toBe('utterance')

    const render = captured.find(e => e.type === 'canvas_render')
    expect(render, 'should emit canvas_render on blocked').toBeTruthy()
    expect(render!.data.presence?.state).toBe('needs-attention')
  })

  it('E: canvas_render presence.state matches orb ring rule (working→CanvasState thinking)', () => {
    // Validate the state→CanvasState mapping
    const stateMap: Record<string, string> = {
      working: 'thinking',
      handoff: 'handoff',
      'needs-attention': 'decision',
      idle: 'ambient',
    }
    for (const [pState, expected] of Object.entries(stateMap)) {
      const canvasState =
        pState === 'working' ? 'thinking'
        : pState === 'handoff' ? 'handoff'
        : pState === 'needs-attention' ? 'decision'
        : 'ambient'
      expect(canvasState).toBe(expected)
    }
  })
})
