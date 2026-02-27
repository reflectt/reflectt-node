import { describe, it, expect, beforeEach } from 'vitest'
import { loadAgentRoles, suggestAssignee, suggestReviewer } from '../src/assignment.js'

describe('Pixel routing guardrail', () => {
  beforeEach(() => {
    loadAgentRoles()
  })

  it('excludes Pixel by default when no explicit design opt-in exists', () => {
    const task = {
      title: 'Fix websocket pairing handshake failure',
      tags: ['onboarding'],
      metadata: {
        cluster_key: 'reflect::onboarding::ws-pairing',
      },
    }

    const result = suggestAssignee(task, [])
    expect(result.scores.some(s => s.agent.toLowerCase() === 'pixel')).toBe(false)
  })

  it('allows Pixel when metadata.lane=design (explicit opt-in)', () => {
    const task = {
      title: 'Dashboard spacing + type hierarchy polish',
      metadata: {
        lane: 'design',
        surface: 'reflectt-node',
      },
    }

    const result = suggestAssignee(task, [])
    expect(result.scores.some(s => s.agent.toLowerCase() === 'pixel')).toBe(true)
  })

  it('allows Pixel for copy/brand/marketing tags (opt-in)', () => {
    const task = {
      title: 'Marketing hero copy tweak + CTA clarity',
      tags: ['marketing', 'copy'],
    }

    const result = suggestReviewer({ title: task.title, assignee: 'link', tags: task.tags }, [])
    expect(result.scores.some(s => s.agent.toLowerCase() === 'pixel')).toBe(true)
  })

  it('excludes Pixel for onboarding plumbing families unless lane=design', () => {
    const task = {
      title: '[Insight] onboarding pairing flow',
      tags: ['ui', 'dashboard'],
      metadata: {
        cluster_key: 'reflect::onboarding::ws-pairing',
      },
    }

    const result = suggestReviewer({ title: task.title, assignee: 'link', tags: task.tags, metadata: task.metadata }, [])
    expect(result.scores.some(s => s.agent.toLowerCase() === 'pixel')).toBe(false)

    const result2 = suggestReviewer({ title: task.title, assignee: 'link', tags: task.tags, metadata: { ...task.metadata, lane: 'design' } }, [])
    expect(result2.scores.some(s => s.agent.toLowerCase() === 'pixel')).toBe(true)
  })
})
