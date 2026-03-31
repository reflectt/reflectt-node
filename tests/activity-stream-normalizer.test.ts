// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { normalizeActivityEvent, normalizeActivityEventSlim } from '../src/activity-stream-normalizer.js'

describe('activity-stream-normalizer', () => {
  it('normalizes a canvas_message voice transcript', () => {
    const result = normalizeActivityEvent({
      id: 'cmsg-voice-123',
      type: 'canvas_message',
      timestamp: 1000,
      data: {
        type: 'voice_transcript',
        agentId: 'link',
        agentColor: '#60a5fa',
        transcript: 'Hello world',
      },
    })

    expect(result.id).toBe('cmsg-voice-123')
    expect(result.type).toBe('canvas_message')
    expect(result.agent).toBe('link')
    expect(result.title).toBe('Voice transcript')
    expect(result.detail).toBe('Hello world')
    expect(result.timestamp).toBe(1000)
    expect(result._raw).toBeDefined()
  })

  it('normalizes a canvas_render event', () => {
    const result = normalizeActivityEvent({
      id: 'render-1',
      type: 'canvas_render',
      timestamp: 2000,
      data: {
        state: 'thinking',
        agentId: 'kai',
        payload: { presenceState: 'working', activeTask: { id: 'task-123', title: 'Build feature' } },
        presence: { name: 'kai', state: 'working' },
      },
    })

    expect(result.agent).toBe('kai')
    expect(result.title).toBe('kai thinking')
    expect(result.taskId).toBe('task-123')
  })

  it('normalizes a canvas_message query', () => {
    const result = normalizeActivityEvent({
      id: 'cmsg-q-1',
      type: 'canvas_message',
      timestamp: 3000,
      data: {
        query: 'What tasks are in progress?',
        agentId: 'sage',
        isResponse: false,
      },
    })

    expect(result.agent).toBe('sage')
    expect(result.title).toBe('Canvas query')
    expect(result.detail).toBe('What tasks are in progress?')
  })

  it('normalizes a canvas_message response', () => {
    const result = normalizeActivityEvent({
      id: 'cmsg-r-1',
      type: 'canvas_message',
      timestamp: 4000,
      data: {
        agentId: 'link',
        isResponse: true,
        data: { text: 'Here are the results' },
      },
    })

    expect(result.title).toBe('Agent response')
    expect(result.detail).toBe('Here are the results')
  })

  it('normalizes a canvas_expression', () => {
    const result = normalizeActivityEvent({
      id: 'expr-1',
      type: 'canvas_expression',
      timestamp: 5000,
      data: {
        agentId: 'pixel',
        expression: 'shipped',
      },
    })

    expect(result.agent).toBe('pixel')
    expect(result.title).toBe('shipped')
  })

  it('normalizes a canvas_burst', () => {
    const result = normalizeActivityEvent({
      id: 'burst-1',
      type: 'canvas_burst',
      timestamp: 6000,
      data: {
        reason: 'High activity',
        agentId: 'echo',
      },
    })

    expect(result.agent).toBe('echo')
    expect(result.title).toBe('High activity')
  })

  it('returns null fields for missing data', () => {
    const result = normalizeActivityEvent({
      id: 'empty-1',
      type: 'canvas_render',
      timestamp: 7000,
      data: {},
    })

    expect(result.agent).toBeNull()
    expect(result.detail).toBeNull()
    expect(result.taskId).toBeNull()
    expect(result.prUrl).toBeNull()
  })

  it('slim version excludes _raw', () => {
    const result = normalizeActivityEventSlim({
      id: 'slim-1',
      type: 'canvas_message',
      timestamp: 8000,
      data: { agentId: 'link', type: 'info' },
    })

    expect(result).not.toHaveProperty('_raw')
    expect(result.agent).toBe('link')
    expect(result.title).toBe('Info')
  })

  it('has all required normalized fields', () => {
    const result = normalizeActivityEvent({
      id: 'shape-1',
      type: 'canvas_render',
      timestamp: 9000,
      data: { agentId: 'kai', state: 'ambient' },
    })

    // Verify all required fields exist
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('type')
    expect(result).toHaveProperty('agent')
    expect(result).toHaveProperty('title')
    expect(result).toHaveProperty('detail')
    expect(result).toHaveProperty('taskId')
    expect(result).toHaveProperty('prUrl')
    expect(result).toHaveProperty('timestamp')
  })
})
