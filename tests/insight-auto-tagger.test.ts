import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  inferFamilyFromTitle,
  getAutoTagRules,
  setAutoTagRules,
  resetAutoTagRules,
  DEFAULT_AUTO_TAG_RULES,
  type AutoTagRule,
} from '../src/insight-auto-tagger'

describe('insight-auto-tagger', () => {
  afterEach(() => {
    resetAutoTagRules()
  })

  describe('inferFamilyFromTitle', () => {
    describe('process family', () => {
      const processCases = [
        'uncategorized: Coordination theater burns tokens and Ryan\'s patience',
        'uncategorized: Review loop broke: metadata.review_handoff.comment_id became phantom',
        'uncategorized: I repeatedly let chat-level approval drift away from system-level approval',
        'uncategorized: I kept accepting and status-updating tasks that were either misrouted',
        'uncategorized: We lost a lot of time today because our review loop looked healthy from the outside',
        'uncategorized: Multiple product bugs were hiding behind process noise',
        'uncategorized: Missed rhythm sitting idle for 12 days',
        'uncategorized: 12+ day stall on task-first comms enforcement',
        'uncategorized: Created a duplicate task that was already shipped',
        'uncategorized: Task sat in doing after the problem was already solved',
        'uncategorized: We are spending ~$1,180 on model costs with $0 in revenue',
        'uncategorized: Agents don\'t read chat, don\'t coordinate',
      ]
      for (const title of processCases) {
        it(`classifies as process: "${title.slice(15, 60)}"`, () => {
          expect(inferFamilyFromTitle(title)).toBe('process')
        })
      }
    })

    describe('restart-continuity family', () => {
      it('classifies cold start', () => {
        expect(inferFamilyFromTitle('uncategorized: Cloudflare Workers loses all reflectt-node state on cold start')).toBe('restart-continuity')
      })

      it('classifies loses state', () => {
        expect(inferFamilyFromTitle('uncategorized: Container loses all state between requests')).toBe('restart-continuity')
      })
    })

    describe('runtime-error family', () => {
      it('classifies async/sync confusion', () => {
        expect(inferFamilyFromTitle('uncategorized: AudioContext.resume() is async but we were treating it as sync')).toBe('runtime-error')
      })

      it('classifies crash', () => {
        expect(inferFamilyFromTitle('some insight: App crash on startup')).toBe('runtime-error')
      })

      it('classifies thrown error', () => {
        expect(inferFamilyFromTitle('uncategorized: Middleware throws on missing auth header')).toBe('runtime-error')
      })
    })

    describe('ui family', () => {
      it('classifies text wall', () => {
        expect(inferFamilyFromTitle('uncategorized: The /preview page was a text wall — no visual proof')).toBe('ui')
      })

      it('classifies render issue', () => {
        expect(inferFamilyFromTitle('uncategorized: Dashboard render broken on mobile')).toBe('ui')
      })

      it('classifies layout', () => {
        expect(inferFamilyFromTitle('fix: layout broken on small screens')).toBe('ui')
      })
    })

    describe('deployment family', () => {
      it('classifies PR stalling', () => {
        expect(inferFamilyFromTitle('uncategorized: Distribution PRs stalling — filed 3 PRs from audit but only 1 merged')).toBe('deployment')
      })

      it('classifies CI issue', () => {
        expect(inferFamilyFromTitle('uncategorized: CI pipeline failing on main')).toBe('deployment')
      })
    })

    describe('config family', () => {
      it('classifies agent identity mismatch', () => {
        expect(inferFamilyFromTitle('uncategorized: Agent identity mismatch between reflectt-node task assignees and OpenClaw')).toBe('config')
      })

      it('classifies env var issue', () => {
        expect(inferFamilyFromTitle('uncategorized: Missing env variable causes silent failure')).toBe('config')
      })
    })

    describe('performance family', () => {
      it('classifies timeout', () => {
        expect(inferFamilyFromTitle('uncategorized: API timeout on large datasets')).toBe('performance')
      })

      it('classifies slow response', () => {
        expect(inferFamilyFromTitle('uncategorized: Dashboard slow to load')).toBe('performance')
      })
    })

    describe('testing family', () => {
      it('classifies flaky test', () => {
        expect(inferFamilyFromTitle('uncategorized: Flaky test causing CI failures')).toBe('testing')
      })
    })

    describe('no match', () => {
      it('returns null for truly uncategorizable content', () => {
        expect(inferFamilyFromTitle('uncategorized: Some very vague insight with no clear pattern')).toBeNull()
      })

      it('returns null for empty string', () => {
        expect(inferFamilyFromTitle('')).toBeNull()
      })
    })

    describe('first-match-wins ordering', () => {
      it('restart-continuity beats runtime-error for state-loss on restart', () => {
        // "loses state" + "restart" should hit restart-continuity before runtime-error
        const result = inferFamilyFromTitle('Server loses all state on cold start')
        expect(result).toBe('restart-continuity')
      })
    })
  })

  describe('rule management', () => {
    it('getAutoTagRules returns a copy of current rules', () => {
      const rules = getAutoTagRules()
      expect(Array.isArray(rules)).toBe(true)
      expect(rules.length).toBeGreaterThan(0)
    })

    it('setAutoTagRules replaces rules at runtime', () => {
      const customRules: AutoTagRule[] = [
        { family: 'custom-family', patterns: ['uniquepattern123'] },
      ]
      setAutoTagRules(customRules)
      const active = getAutoTagRules()
      expect(active).toHaveLength(1)
      expect(active[0].family).toBe('custom-family')
    })

    it('custom rules are applied by inferFamilyFromTitle', () => {
      setAutoTagRules([{ family: 'custom-family', patterns: ['uniquepattern123'] }])
      expect(inferFamilyFromTitle('uniquepattern123 issue here')).toBe('custom-family')
    })

    it('resetAutoTagRules restores defaults', () => {
      setAutoTagRules([])
      resetAutoTagRules()
      const active = getAutoTagRules()
      expect(active.length).toBe(DEFAULT_AUTO_TAG_RULES.length)
    })

    it('setAutoTagRules does not affect inferFamilyFromTitle with explicit rules arg', () => {
      setAutoTagRules([{ family: 'custom-family', patterns: ['uniquepattern123'] }])
      // Pass DEFAULT_AUTO_TAG_RULES explicitly
      const result = inferFamilyFromTitle('coordination theater', DEFAULT_AUTO_TAG_RULES)
      expect(result).toBe('process')
    })

    it('handles malformed regex patterns gracefully', () => {
      setAutoTagRules([
        { family: 'test', patterns: ['[invalid-regex', 'valid pattern'] },
      ])
      // Should not throw, should fall through to valid pattern check
      expect(() => inferFamilyFromTitle('valid pattern in title')).not.toThrow()
      expect(inferFamilyFromTitle('valid pattern in title')).toBe('test')
    })
  })

  describe('DEFAULT_AUTO_TAG_RULES coverage', () => {
    it('includes process family', () => {
      const families = DEFAULT_AUTO_TAG_RULES.map(r => r.family)
      expect(families).toContain('process')
    })

    it('includes restart-continuity family', () => {
      const families = DEFAULT_AUTO_TAG_RULES.map(r => r.family)
      expect(families).toContain('restart-continuity')
    })

    it('all rules have at least one pattern', () => {
      for (const rule of DEFAULT_AUTO_TAG_RULES) {
        expect(rule.patterns.length).toBeGreaterThan(0)
      }
    })

    it('covers all families from sage triage 2026-03-15', () => {
      const families = new Set(DEFAULT_AUTO_TAG_RULES.map(r => r.family))
      const triageFamilies = ['process', 'deployment', 'ui', 'runtime-error', 'restart-continuity', 'config', 'testing', 'performance']
      for (const f of triageFamilies) {
        expect(families.has(f)).toBe(true)
      }
    })
  })

  describe('bulk reclassification power test — sage triage candidates', () => {
    // These are the actual uncategorized insight titles from sage's 2026-03-15 triage
    // At least 10 of the 19 original uncategorized candidates must be reclassified
    const triageCandidates = [
      { title: 'uncategorized: AudioContext.resume() is async but we were treating it as sync — source.start()', expected: 'runtime-error' },
      { title: 'uncategorized: We let tracked model spend outrun any visible economic control surface', expected: 'process' },
      { title: 'uncategorized: I noticed #general digest noise and named the problem in chat, but I did not route it', expected: 'process' },
      { title: 'uncategorized: We are spending ~$1,180 on model costs with $0 in revenue — and we have no consolidated', expected: 'process' },
      { title: 'uncategorized: I repeatedly let chat-level approval drift away from system-level approval', expected: 'process' },
      { title: 'uncategorized: I kept accepting and status-updating tasks that were either misrouted for my lane', expected: 'process' },
      { title: 'uncategorized: We lost a lot of time today because our review loop looked healthy from the outside', expected: 'process' },
      { title: 'uncategorized: Review loop broke: metadata.review_handoff.comment_id became phantom/unresolvable', expected: 'process' },
      { title: 'uncategorized: The /preview page was a text wall — no visual proof of the product working', expected: 'ui' },
      { title: 'uncategorized: Coordination theater burns tokens and Ryan\'s patience. Agents don\'t read chat', expected: 'process' },
      { title: 'uncategorized: Multiple product bugs were hiding behind process noise — empty placeholder tasks', expected: 'process' },
      { title: 'uncategorized: 12+ day stall on task-first comms enforcement (task-1771219268698). Momentum died', expected: 'process' },
      { title: 'uncategorized: Distribution PRs stalling — filed 3 PRs from audit but only 1 merged', expected: 'deployment' },
      { title: 'uncategorized: Missed rhythm sitting idle for 12 days — only caught it when they self-reported', expected: 'process' },
      { title: 'uncategorized: Cloudflare Workers loses all reflectt-node state on cold start', expected: 'restart-continuity' },
      { title: 'uncategorized: Agent identity mismatch between reflectt-node task assignees and OpenClaw agent', expected: 'config' },
      { title: 'uncategorized: Created a duplicate task (GitHub review gate, swu3rvio2) that was already shipped', expected: 'process' },
      { title: 'uncategorized: Task sat in doing after the problem was already solved — GHCR was public and docs', expected: 'process' },
      { title: 'uncategorized: Just got spun up as iOS engineer — no code shipped yet, team frustrated with coordination', expected: 'process' },
    ]

    it('reclassifies at least 10 of the 19 sage triage candidates', () => {
      const reclassified = triageCandidates.filter(c => inferFamilyFromTitle(c.title) !== null)
      expect(reclassified.length).toBeGreaterThanOrEqual(10)
    })

    it('correctly classifies each matched candidate', () => {
      let correctCount = 0
      for (const candidate of triageCandidates) {
        const result = inferFamilyFromTitle(candidate.title)
        if (result !== null) {
          expect(result).toBe(candidate.expected)
          correctCount++
        }
      }
      expect(correctCount).toBeGreaterThanOrEqual(10)
    })
  })

  // ── Regression: batch-2 deployment misclassifications (PR #1044) ─────────
  // These titles were incorrectly tagged as 'deployment' before the fix.
  // Generic "build" / "release" language without infra/CI context → process.
  describe('regression: deployment family does not over-classify', () => {
    it('does not tag "product decisions deferred to founder" as deployment', () => {
      const result = inferFamilyFromTitle('uncategorized: product decisions deferred to founder instead of the team moving forward')
      expect(result).not.toBe('deployment')
    })

    it('does not tag "team velocity stalls" as deployment', () => {
      const result = inferFamilyFromTitle('uncategorized: team velocity stalls when no human is present to push')
      expect(result).not.toBe('deployment')
      expect(result).toBe('process')
    })

    it('does not tag "qa_bundle gate insight" as deployment', () => {
      // This was tagged as 'ui' before — should be 'process' (QA workflow friction)
      const result = inferFamilyFromTitle('uncategorized: qa_bundle gate rejects tasks that are clearly shipped — process overhead')
      expect(result).not.toBe('deployment')
    })

    it('still tags real CI/infra build failures as deployment', () => {
      // Note: 'fails' hits runtime-error first; use deploy* or pipeline-specific phrases
      expect(inferFamilyFromTitle('uncategorized: Fly deployment blocked after infra change')).toBe('deployment')
      expect(inferFamilyFromTitle('uncategorized: Build pipeline blocked in CI — deploy cannot proceed')).toBe('deployment')
      expect(inferFamilyFromTitle('uncategorized: Docker build pipeline broken, CI refuses deploy')).toBe('deployment')
    })

    it('still tags PR stall insights as deployment', () => {
      expect(inferFamilyFromTitle('uncategorized: Distribution PRs stalling — filed 3 PRs from audit but only 1 merged')).toBe('deployment')
    })
  })

  // ── Regression: process family captures velocity/decision patterns ────────
  describe('regression: process family gains velocity/decision patterns', () => {
    it('tags "team velocity stalls" as process', () => {
      expect(inferFamilyFromTitle('uncategorized: team velocity stalls when no human is present to push')).toBe('process')
    })

    it('tags "decision deferred to human" as process', () => {
      expect(inferFamilyFromTitle('uncategorized: key decision deferred to human — team blocked for 2 days')).toBe('process')
    })

    it('tags "human sign-off required" as process', () => {
      expect(inferFamilyFromTitle('uncategorized: every API key change requires human sign-off, slows shipping')).toBe('process')
    })
  })
})
