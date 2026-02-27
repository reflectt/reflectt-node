import { describe, it, expect, beforeEach } from 'vitest'
import { suggestReviewer, loadAgentRoles, getAgentRoles, setTestRoles } from '../src/assignment.js'
import { TEST_AGENT_ROLES } from './fixtures/test-roles.js'

// Ensure roles are loaded with test-specific names
beforeEach(() => {
  setTestRoles(TEST_AGENT_ROLES)
  loadAgentRoles()
})

function makeTasks(overrides: Array<{ id?: string; status: string; assignee?: string; reviewer?: string; metadata?: Record<string, unknown> }>) {
  return overrides.map((t, i) => ({
    id: t.id || `task-${i}`,
    title: `Test task ${i}`,
    status: t.status,
    assignee: t.assignee,
    reviewer: t.reviewer,
    metadata: t.metadata || {},
  }))
}

describe('suggestReviewer', () => {
  it('suggests a reviewer for a backend task', () => {
    const result = suggestReviewer(
      { title: 'Fix API endpoint validation', assignee: 'link' },
      [],
    )
    expect(result.suggested).toBeTruthy()
    expect(result.suggested).not.toBe('link') // never assign reviewer = assignee
    expect(result.scores.length).toBeGreaterThan(0)
  })

  it('excludes the assignee from reviewer candidates', () => {
    const result = suggestReviewer(
      { title: 'Build new dashboard panel', assignee: 'pixel' },
      [],
    )
    expect(result.scores.every(s => s.agent !== 'pixel')).toBe(true)
  })

  it('prefers ops/reviewer-role agents for generic tasks', () => {
    const result = suggestReviewer(
      { title: 'Generic task with no domain keywords', assignee: 'link' },
      [],
    )
    // sage is role=ops (0.3 bonus), should score well for generic tasks
    const sageScore = result.scores.find(s => s.agent === 'sage')
    expect(sageScore).toBeTruthy()
    expect(sageScore!.score).toBeGreaterThanOrEqual(0.3) // ops role bonus
  })

  it('penalizes agents with high validating load', () => {
    const tasks = makeTasks([
      { status: 'validating', reviewer: 'harmony' },
      { status: 'validating', reviewer: 'harmony' },
      { status: 'validating', reviewer: 'harmony' },
    ])
    
    const result = suggestReviewer(
      { title: 'Review this feature', assignee: 'link' },
      tasks,
    )
    
    const harmonyScore = result.scores.find(s => s.agent === 'harmony')
    expect(harmonyScore).toBeTruthy()
    // 3 validating tasks * 0.3 penalty = 0.9 penalty
    // harmony score should be low
    expect(harmonyScore!.score).toBeLessThan(0.5)
  })

  it('load-balances across reviewers', () => {
    const tasks = makeTasks([
      { status: 'validating', reviewer: 'harmony' },
      { status: 'validating', reviewer: 'harmony' },
    ])
    
    const result = suggestReviewer(
      { title: 'New test task', assignee: 'link' },
      tasks,
    )
    
    // With harmony loaded, a different agent should be suggested
    // (or harmony with lower score)
    const harmonyScore = result.scores.find(s => s.agent === 'harmony')?.score || 0
    const sageScore = result.scores.find(s => s.agent === 'sage')?.score || 0
    
    // Sage (ops role = 0.3 bonus) with 0 load should beat loaded harmony
    expect(sageScore).toBeGreaterThanOrEqual(harmonyScore)
  })

  it('factors SLA risk for high-priority review tasks', () => {
    const tasks = makeTasks([
      { status: 'validating', reviewer: 'harmony', metadata: { priority: 'P0' } },
      { status: 'doing', reviewer: 'harmony', metadata: { priority: 'P1' } },
    ])
    
    const result = suggestReviewer(
      { title: 'Another task needing review', assignee: 'link' },
      tasks,
    )
    
    const harmonyScore = result.scores.find(s => s.agent === 'harmony')
    expect(harmonyScore).toBeTruthy()
    // SLA penalty: 2 high-priority * 0.2 = 0.4, plus normal load penalty
    expect(harmonyScore!.score).toBeLessThan(0)
  })

  it('considers domain affinity for reviewer selection', () => {
    const result = suggestReviewer(
      { title: 'Fix CI pipeline deployment script', assignee: 'link' },
      [],
    )
    
    // sage has affinity for ci, deploy, pipeline
    const sageScore = result.scores.find(s => s.agent === 'sage')
    expect(sageScore).toBeTruthy()
    expect(sageScore!.score).toBeGreaterThan(0.3)
  })

  it('returns all candidates with scores', () => {
    const roles = getAgentRoles()
    const result = suggestReviewer(
      { title: 'Some task', assignee: 'link' },
      [],
    )
    // Should have all eligible agents minus the assignee.
    // Pixel is excluded by default unless the task explicitly opts into design/user-facing.
    const expected = roles.filter(r => r.name !== 'link' && r.name !== 'pixel').length
    expect(result.scores.length).toBe(expected)
    // Scores should be sorted descending
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1]!.score).toBeGreaterThanOrEqual(result.scores[i]!.score)
    }
  })

  it('handles empty task list gracefully', () => {
    const result = suggestReviewer(
      { title: 'First task ever', assignee: 'kai' },
      [],
    )
    expect(result.suggested).toBeTruthy()
    expect(result.scores.length).toBeGreaterThan(0)
  })
})
