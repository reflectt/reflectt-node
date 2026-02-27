import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadAgentRoles, suggestAssignee, suggestReviewer, setTestRoles } from '../src/assignment.js'
import { TEST_AGENT_ROLES as testRoles } from './fixtures/test-roles.js'

function getDesigners(): string[] {
  const { roles } = loadAgentRoles()
  return roles
    .filter(r => r.role === 'designer')
    .map(r => r.name.toLowerCase())
}

describe('Designer routing guardrail', () => {
  beforeEach(() => {
    setTestRoles(testRoles)
    loadAgentRoles()
  })

  afterEach(() => {
    setTestRoles(null)
  })

  it('excludes designers by default when no explicit design opt-in exists', () => {
    const designers = getDesigners()
    expect(designers.length).toBeGreaterThan(0)

    const task = {
      title: 'Fix websocket pairing handshake failure',
      tags: ['onboarding'],
      metadata: {
        cluster_key: 'reflect::onboarding::ws-pairing',
      },
    }

    const result = suggestAssignee(task, [])
    expect(result.scores.some(s => designers.includes(s.agent.toLowerCase()))).toBe(false)
  })

  it('allows designers when metadata.lane=design (explicit opt-in)', () => {
    const designers = getDesigners()

    const task = {
      title: 'Dashboard spacing + type hierarchy polish',
      metadata: {
        lane: 'design',
        surface: 'reflectt-node',
      },
    }

    const result = suggestAssignee(task, [])
    expect(result.scores.some(s => designers.includes(s.agent.toLowerCase()))).toBe(true)
  })

  it('allows designers for copy/brand/marketing tags (opt-in)', () => {
    const designers = getDesigners()

    const task = {
      title: 'Marketing hero copy tweak + CTA clarity',
      tags: ['marketing', 'copy'],
    }

    const result = suggestReviewer({ title: task.title, assignee: 'link', tags: task.tags }, [])
    expect(result.scores.some(s => designers.includes(s.agent.toLowerCase()))).toBe(true)
  })

  it('excludes designers for onboarding plumbing families unless lane=design', () => {
    const designers = getDesigners()

    const task = {
      title: '[Insight] onboarding pairing flow',
      tags: ['ui', 'dashboard'],
      metadata: {
        cluster_key: 'reflect::onboarding::ws-pairing',
      },
    }

    const result = suggestReviewer({ title: task.title, assignee: 'link', tags: task.tags, metadata: task.metadata }, [])
    expect(result.scores.some(s => designers.includes(s.agent.toLowerCase()))).toBe(false)

    const result2 = suggestReviewer({
      title: task.title,
      assignee: 'link',
      tags: task.tags,
      metadata: { ...task.metadata, lane: 'design' },
    }, [])
    expect(result2.scores.some(s => designers.includes(s.agent.toLowerCase()))).toBe(true)
  })
})
