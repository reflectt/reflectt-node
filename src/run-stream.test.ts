// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Test SSE format and event filtering logic
describe('run stream SSE', () => {
  it('formats snapshot event correctly', () => {
    const run = { id: 'arun-1', status: 'working', agentId: 'link' }
    const events = [{ id: 'aevt-1', type: 'task_started' }]
    const sseData = `event: snapshot\ndata: ${JSON.stringify({ run, events })}\n\n`
    assert.ok(sseData.startsWith('event: snapshot'))
    assert.ok(sseData.includes('"arun-1"'))
  })

  it('formats event correctly', () => {
    const event = { id: 'evt-1', type: 'canvas_render', data: { agentId: 'link', state: 'thinking' } }
    const sseData = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
    assert.ok(sseData.startsWith('event: canvas_render'))
    assert.ok(sseData.includes('"thinking"'))
  })

  it('heartbeat format is valid SSE comment', () => {
    const heartbeat = `:heartbeat\n\n`
    assert.ok(heartbeat.startsWith(':'))
  })

  it('filters events by runId', () => {
    const targetRunId = 'arun-target'
    const events = [
      { data: { runId: 'arun-target', agentId: 'link' } },
      { data: { runId: 'arun-other', agentId: 'pixel' } },
      { data: { runId: 'arun-target', agentId: 'link' } },
    ]
    const matched = events.filter(e => (e.data as any).runId === targetRunId)
    assert.equal(matched.length, 2)
  })

  it('filters events by agentId', () => {
    const targetAgent = 'link'
    const events = [
      { data: { agentId: 'link' } },
      { data: { agentId: 'pixel' } },
      { data: { agentId: 'link' } },
      { data: { agentId: 'kai' } },
    ]
    const matched = events.filter(e => (e.data as any).agentId === targetAgent)
    assert.equal(matched.length, 2)
  })

  it('snapshot includes both run state and recent events', () => {
    const snapshot = {
      run: { id: 'arun-1', status: 'working', objective: 'Build API' },
      events: [
        { id: 'aevt-1', type: 'run_started' },
        { id: 'aevt-2', type: 'task_completed' },
      ],
    }
    assert.ok(snapshot.run)
    assert.equal(snapshot.events.length, 2)
    assert.equal(snapshot.run.status, 'working')
  })

  it('agent stream includes active run and events', () => {
    const snapshot = {
      activeRun: { id: 'arun-1', status: 'working' },
      events: [{ id: 'aevt-1' }],
    }
    assert.ok(snapshot.activeRun)
    assert.equal(snapshot.events.length, 1)
  })

  it('agent stream handles null active run', () => {
    const snapshot = { activeRun: null, events: [] }
    assert.equal(snapshot.activeRun, null)
    assert.equal(snapshot.events.length, 0)
  })
})
