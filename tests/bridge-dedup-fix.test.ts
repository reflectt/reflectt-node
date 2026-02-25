import { describe, it, expect } from 'vitest'
import { isFeatureRequest } from '../src/insight-task-bridge.js'
import type { Insight } from '../src/insights.js'

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'ins-test',
    cluster_key: 'ops::signal-noise::sweeper',
    workflow_stage: 'ops',
    failure_family: 'signal-noise',
    impacted_unit: 'sweeper',
    title: 'Sweeper alert spam',
    status: 'promoted',
    score: 9,
    priority: 'P0',
    reflection_ids: ['ref-1'],
    independent_count: 2,
    evidence_refs: ['8+ alerts in 30min'],
    authors: ['link', 'sage'],
    promotion_readiness: 'promoted',
    recurring_candidate: false,
    cooldown_until: null,
    cooldown_reason: null,
    severity_max: 'critical',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

describe('Insight Bridge: Dedup + Feature Detection Fix', () => {
  describe('isFeatureRequest', () => {
    it('detects feature request by title', () => {
      expect(isFeatureRequest(makeInsight({ title: 'Feature request: add calendar export' }))).toBe(true)
      expect(isFeatureRequest(makeInsight({ title: 'Enhancement: support dark mode' }))).toBe(true)
      expect(isFeatureRequest(makeInsight({ title: 'Add support for webhooks' }))).toBe(true)
    })

    it('detects feature by cluster_key', () => {
      expect(isFeatureRequest(makeInsight({ cluster_key: 'feature::calendar::export' }))).toBe(true)
      expect(isFeatureRequest(makeInsight({ cluster_key: 'enhancement::ui::theme' }))).toBe(true)
    })

    it('detects feature by low/no severity without bug keywords', () => {
      expect(isFeatureRequest(makeInsight({
        title: 'Calendar view for team schedule',
        severity_max: 'low',
      }))).toBe(true)

      expect(isFeatureRequest(makeInsight({
        title: 'New notification preferences panel',
        severity_max: null,
      }))).toBe(true)
    })

    it('does NOT classify bugs as features', () => {
      expect(isFeatureRequest(makeInsight({
        title: 'Sweeper alert spam — critical bug',
        severity_max: 'critical',
      }))).toBe(false)

      expect(isFeatureRequest(makeInsight({
        title: 'Auth login broken after SSO update',
        severity_max: 'high',
      }))).toBe(false)

      expect(isFeatureRequest(makeInsight({
        title: 'Fix crash on empty task list',
        severity_max: 'low',
      }))).toBe(false)
    })

    it('does NOT classify error reports as features', () => {
      expect(isFeatureRequest(makeInsight({
        title: 'Error 500 on dashboard load',
        severity_max: 'high',
      }))).toBe(false)
    })

    it('does NOT classify regression as feature', () => {
      expect(isFeatureRequest(makeInsight({
        title: 'Regression in chat message delivery',
        severity_max: 'medium',
      }))).toBe(false)
    })
  })
})
