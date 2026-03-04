// SPDX-License-Identifier: Apache-2.0
// Tests for session compliance detector
// Task: task-1772609696194-1i9s775yl
// Spec: docs/compliance-spec-state-reads.md

import { describe, it, expect, beforeEach } from 'vitest'
import { processRequest, extractAgent } from '../src/compliance-detector.js'

// Reset module-level session state between tests by advancing time
// (sessions are bucketed by 30-min windows; using different base times isolates tests)

const BASE = 1_700_000_000_000 // arbitrary fixed timestamp
const AGENT_HEADERS = {}
const NO_BODY = null

// Helper: simulate a GET request (state read)
function read(path: string, agent: string, now: number) {
  return processRequest('GET', path, 200, { agent }, NO_BODY, AGENT_HEADERS, now)
}

// Helper: simulate a POST/PATCH (triggering action)
function act(method: string, path: string, agent: string, now: number, body: unknown = null) {
  return processRequest(method, path, 200, {}, body, AGENT_HEADERS, now)
}

// Isolate session buckets by using different base times per describe block
function iso(offset: number) {
  // Each test gets a unique 30-min bucket by using large offsets
  return BASE + offset * 60 * 60 * 1000
}

describe('extractAgent', () => {
  it('extracts from URL param for heartbeat', () => {
    expect(extractAgent('GET', '/heartbeat/kai', {}, null, {})).toBe('kai')
  })

  it('extracts from URL param for inbox', () => {
    expect(extractAgent('GET', '/inbox/link', {}, null, {})).toBe('link')
  })

  it('extracts from query param', () => {
    expect(extractAgent('GET', '/tasks/next', { agent: 'rhythm' }, null, {})).toBe('rhythm')
  })

  it('extracts from body.from', () => {
    expect(extractAgent('POST', '/tasks', {}, { from: 'pixel' }, {})).toBe('pixel')
  })

  it('extracts from body.assignee', () => {
    expect(extractAgent('PATCH', '/tasks/task-001', {}, { assignee: 'echo' }, {})).toBe('echo')
  })

  it('returns null when no agent found', () => {
    expect(extractAgent('GET', '/tasks', {}, null, {})).toBeNull()
  })

  it('lowercases agent name', () => {
    expect(extractAgent('GET', '/heartbeat/KAI', {}, null, {})).toBe('kai')
  })
})

describe('state reads suppress violations', () => {
  it('no violation when heartbeat precedes POST /tasks', () => {
    const t = iso(100)
    read('/heartbeat/kai', 'kai', t)
    const violation = act('POST', '/tasks', 'kai', t + 60_000, { from: 'kai' })
    expect(violation).toBeNull()
  })

  it('no violation when GET /tasks/next precedes PATCH', () => {
    const t = iso(101)
    read('/tasks/next?agent=link', 'link', t)
    const violation = act('PATCH', '/tasks/task-001', 'link', t + 60_000, { assignee: 'link' })
    expect(violation).toBeNull()
  })

  it('no violation when GET /tasks precedes POST /reflections', () => {
    const t = iso(102)
    read('/tasks?assignee=pixel', 'pixel', t)
    const violation = act('POST', '/reflections', 'pixel', t + 30_000, { agent: 'pixel' })
    expect(violation).toBeNull()
  })
})

describe('no_state_read_before_action violations', () => {
  it('flags POST /tasks with no prior state read as high severity', () => {
    const t = iso(200)
    const violation = act('POST', '/tasks', 'sage', t, { from: 'sage' })
    expect(violation).not.toBeNull()
    expect(violation!.violation_type).toBe('no_state_read_before_action')
    expect(violation!.severity).toBe('high')
    expect(violation!.agent).toBe('sage')
    expect(violation!.triggering_call).toBe('POST /tasks')
  })

  it('flags PATCH /tasks/:id with no prior state read', () => {
    const t = iso(201)
    const violation = act('PATCH', '/tasks/task-abc', 'harmony', t, { assignee: 'harmony' })
    expect(violation).not.toBeNull()
    expect(violation!.violation_type).toBe('no_state_read_before_action')
    expect(violation!.severity).toBe('high')
  })

  it('flags POST /tasks/:id/review with no prior state read', () => {
    const t = iso(202)
    const violation = act('POST', '/tasks/task-abc/review', 'scout', t, { agent: 'scout' })
    expect(violation).not.toBeNull()
    expect(violation!.violation_type).toBe('no_state_read_before_action')
  })

  it('flags POST /reflections with no prior state read', () => {
    const t = iso(203)
    const violation = act('POST', '/reflections', 'echo', t, { agent: 'echo' })
    expect(violation).not.toBeNull()
    expect(violation!.violation_type).toBe('no_state_read_before_action')
  })
})

describe('stale_state_read violations', () => {
  const NORMAL_WINDOW = 10 * 60 * 1000
  const LONG_WINDOW = 30 * 60 * 1000

  it('flags POST /tasks when normal window (10 min) has expired', () => {
    const t = iso(300)
    // State read, then act 11 minutes later
    read('/tasks', 'kai', t)
    const violation = act('POST', '/tasks', 'kai', t + NORMAL_WINDOW + 60_000, { from: 'kai' })
    expect(violation).not.toBeNull()
    expect(violation!.violation_type).toBe('stale_state_read')
    expect(violation!.severity).toBe('medium')
    expect(violation!.last_state_read_at).toBe(t)
  })

  it('no violation when acting within normal window (9 min)', () => {
    const t = iso(301)
    read('/tasks', 'link', t)
    const violation = act('POST', '/tasks', 'link', t + 9 * 60_000, { from: 'link' })
    expect(violation).toBeNull()
  })

  it('no violation when acting within long window after heartbeat (4 min)', () => {
    const t = iso(302)
    read('/heartbeat/pixel', 'pixel', t)
    // Heartbeat window is 5 min
    const violation = act('POST', '/tasks', 'pixel', t + 4 * 60_000, { from: 'pixel' })
    expect(violation).toBeNull()
  })

  it('flags POST /tasks after heartbeat window expires (6 min)', () => {
    const t = iso(303)
    read('/heartbeat/harmony', 'harmony', t)
    // Heartbeat window is 5 min
    const violation = act('POST', '/tasks', 'harmony', t + 6 * 60_000, { from: 'harmony' })
    expect(violation).not.toBeNull()
    expect(violation!.violation_type).toBe('stale_state_read')
  })
})

describe('non-triggering actions are ignored', () => {
  it('GET /tasks does not produce a violation', () => {
    const t = iso(400)
    const violation = processRequest('GET', '/tasks', 200, { agent: 'kai' }, null, {}, t)
    expect(violation).toBeNull()
  })

  it('POST /tasks/:id/comments does not trigger (Phase 2)', () => {
    const t = iso(401)
    const violation = act('POST', '/tasks/task-001/comments', 'kai', t, { agent: 'kai' })
    expect(violation).toBeNull()
  })

  it('failed requests (4xx) are ignored', () => {
    const t = iso(402)
    const violation = processRequest('POST', '/tasks', 400, { agent: 'kai' }, { from: 'kai' }, {}, t)
    expect(violation).toBeNull()
  })

  it('system agent is ignored', () => {
    const t = iso(403)
    const violation = act('POST', '/tasks', 'system', t, { from: 'system' })
    expect(violation).toBeNull()
  })
})

describe('state read resets the window', () => {
  it('second state read extends window and clears violation risk', () => {
    const t = iso(500)
    const NORMAL = 10 * 60 * 1000

    // Initial read
    read('/tasks', 'scout', t)
    // Wait 9 min (still valid) — no violation
    expect(act('POST', '/tasks', 'scout', t + 9 * 60_000, { from: 'scout' })).toBeNull()

    // Second read at 9 min mark
    read('/tasks/next', 'scout', t + 9 * 60_000)

    // Now wait 9 more min from second read — should still be valid
    expect(act('PATCH', '/tasks/task-x', 'scout', t + 18 * 60_000, { assignee: 'scout' })).toBeNull()
  })
})

describe('violation record format', () => {
  it('violation has required fields', () => {
    const t = iso(600)
    const violation = act('POST', '/tasks', 'kai', t, { from: 'kai' })
    expect(violation).not.toBeNull()
    expect(violation!.id).toMatch(/^cv-/)
    expect(violation!.agent).toBe('kai')
    expect(violation!.session_id).toContain('kai')
    expect(typeof violation!.detected_at).toBe('number')
    expect(violation!.window_used_ms).toBeGreaterThan(0)
  })
})
