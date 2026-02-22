// Tests for reflection-origin invariant enforcement on task creation
import { describe, it, expect, beforeAll } from 'vitest'

const BASE = 'http://127.0.0.1:4445'
let serverUp = false

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })
    serverUp = res.ok
  } catch {
    serverUp = false
  }
})

function taskBody(overrides: Record<string, any> = {}) {
  return {
    title: `Enforce reflection-origin invariant on task creation pipeline ${Date.now()}`,
    createdBy: 'link',
    assignee: 'link',
    reviewer: 'sage',
    done_criteria: ['Task creation rejects without reflection source', 'Exempt tasks require reason'],
    eta: '~30m',
    priority: 'P2',
    ...overrides,
  }
}

describe('Reflection-origin gate', () => {
  it('rejects task without source_reflection or source_insight', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody({ metadata: {} })),
    })
    const data = await res.json() as any
    expect(data.success).toBe(false)
    expect(data.code).toBe('DEFINITION_OF_READY')
    expect(data.problems?.some((p: string) => p.includes('Reflection-origin required'))).toBe(true)
  })

  it('accepts task with source_reflection', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody({
        metadata: { source_reflection: 'ref-test-123' },
      })),
    })
    const data = await res.json() as any
    expect(data.success).toBe(true)
  })

  it('accepts task with source_insight', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody({
        title: `Accept task with source insight in metadata for pipeline validation ${Date.now()}`,
        metadata: { source_insight: 'ins-test-456' },
      })),
    })
    const data = await res.json() as any
    expect(data.success).toBe(true)
  })

  it('accepts task with source=reflection_pipeline', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody({
        title: `Accept task from reflection pipeline source with full metadata ${Date.now()}`,
        metadata: { source: 'reflection_pipeline' },
      })),
    })
    const data = await res.json() as any
    expect(data.success).toBe(true)
  })

  it('accepts exempt task with reason', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody({
        title: `System maintenance task exempt from reflection origin requirement ${Date.now()}`,
        metadata: {
          reflection_exempt: true,
          reflection_exempt_reason: 'Recurring system maintenance task',
        },
      })),
    })
    const data = await res.json() as any
    expect(data.success).toBe(true)
  })

  it('rejects exempt task without reason', async (ctx) => {
    if (!serverUp) return ctx.skip()
    const res = await fetch(`${BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskBody({
        metadata: { reflection_exempt: true },
      })),
    })
    const data = await res.json() as any
    expect(data.success).toBe(false)
    expect(data.problems?.some((p: string) => p.includes('reflection_exempt_reason'))).toBe(true)
  })
})
