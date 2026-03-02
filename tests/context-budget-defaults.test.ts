// SPDX-License-Identifier: Apache-2.0
// Tests for context-budget default changes:
//   - agent_persistent budget increased from 2k → 4k (prevents token suppression for typical workspaces)
//   - autosummary defaults to ON (heuristic-only, no LLM cost; opt-out via REFLECTT_CONTEXT_AUTOSUMMARY=false)
//   - proactive context sync added (cloud.ts timer — not testable here, covered by integration)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getContextBudgets, isAutoSummaryEnabled } from '../src/context-budget.js'

describe('context-budget defaults', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {
      REFLECTT_CONTEXT_AUTOSUMMARY: process.env.REFLECTT_CONTEXT_AUTOSUMMARY,
      REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS: process.env.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS,
      REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS: process.env.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS,
      REFLECTT_CONTEXT_BUDGET_TOTAL_TOKENS: process.env.REFLECTT_CONTEXT_BUDGET_TOTAL_TOKENS,
    }
    // Clear all overrides so we test the actual defaults
    for (const key of Object.keys(savedEnv)) delete process.env[key]
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  })

  describe('isAutoSummaryEnabled', () => {
    it('defaults to true when env var is unset', () => {
      expect(isAutoSummaryEnabled()).toBe(true)
    })

    it('returns false when explicitly disabled with "false"', () => {
      process.env.REFLECTT_CONTEXT_AUTOSUMMARY = 'false'
      expect(isAutoSummaryEnabled()).toBe(false)
    })

    it('returns false when explicitly disabled with "0"', () => {
      process.env.REFLECTT_CONTEXT_AUTOSUMMARY = '0'
      expect(isAutoSummaryEnabled()).toBe(false)
    })

    it('returns false when explicitly disabled with "no"', () => {
      process.env.REFLECTT_CONTEXT_AUTOSUMMARY = 'no'
      expect(isAutoSummaryEnabled()).toBe(false)
    })

    it('returns true when set to "true"', () => {
      process.env.REFLECTT_CONTEXT_AUTOSUMMARY = 'true'
      expect(isAutoSummaryEnabled()).toBe(true)
    })

    it('returns true when set to "1"', () => {
      process.env.REFLECTT_CONTEXT_AUTOSUMMARY = '1'
      expect(isAutoSummaryEnabled()).toBe(true)
    })
  })

  describe('getContextBudgets defaults', () => {
    it('agent_persistent default is 4000 tokens', () => {
      const budgets = getContextBudgets()
      expect(budgets.layers.agent_persistent).toBe(4_000)
    })

    it('session_local default is 6000 tokens', () => {
      const budgets = getContextBudgets()
      expect(budgets.layers.session_local).toBe(6_000)
    })

    it('team_shared default is 2000 tokens', () => {
      const budgets = getContextBudgets()
      expect(budgets.layers.team_shared).toBe(2_000)
    })

    it('total default is 12000 tokens', () => {
      const budgets = getContextBudgets()
      expect(budgets.totalTokens).toBe(12_000)
    })

    it('env override still works for agent_persistent', () => {
      process.env.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS = '8000'
      const budgets = getContextBudgets()
      expect(budgets.layers.agent_persistent).toBe(8_000)
    })
  })
})
