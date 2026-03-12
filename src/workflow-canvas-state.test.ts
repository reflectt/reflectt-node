// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkflow, type WorkflowTemplate } from './workflow-templates.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('workflow canvas state emission', () => {
  it('emits thinking then rendering for each successful step, then ambient', async () => {
    const calls: Array<{ state: string; agentId: string; text?: string }> = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      calls.push({ state: body.state, agentId: body.agentId, text: body.payload?.text })
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as typeof fetch

    const template: WorkflowTemplate = {
      id: 'test',
      name: 'test',
      description: 'test',
      steps: [
        { name: 'one', description: 'Step one', action: () => ({ success: true }) },
        { name: 'two', description: 'Step two', action: () => ({ success: true }) },
      ],
    }

    const result = await runWorkflow(template, 'rhythm', 'default')
    assert.equal(result.success, true)
    assert.deepEqual(calls.map(c => c.state), ['thinking', 'rendering', 'thinking', 'rendering', 'ambient'])
    assert.equal(calls[0]?.agentId, 'rhythm')
    assert.equal(calls[0]?.text, 'Step one')
    assert.equal(calls[1]?.text, 'Completed: Step one')
  })

  it('emits urgent when a step fails', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'))
      calls.push(body.state)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }) as typeof fetch

    const template: WorkflowTemplate = {
      id: 'test-fail',
      name: 'test-fail',
      description: 'test',
      steps: [
        { name: 'one', description: 'Step one', action: () => ({ success: false, error: 'nope' }) },
      ],
    }

    const result = await runWorkflow(template, 'rhythm', 'default')
    assert.equal(result.success, false)
    assert.deepEqual(calls, ['thinking', 'urgent'])
  })
})
