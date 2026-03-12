// SPDX-License-Identifier: Apache-2.0
// Tests for runtime cost-policy enforcement

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock db before imports
const mockDb = {
  prepare: vi.fn(() => ({
    get: vi.fn(() => ({ total: 0 })),
    run: vi.fn(),
    all: vi.fn(() => []),
  })),
  exec: vi.fn(),
}
vi.mock('../src/db.js', () => ({ getDb: () => mockDb }))

// Mock agent-config
const mockCheckCostCap = vi.fn((): {
  allowed: boolean
  dailyRemaining: number | null
  monthlyRemaining: number | null
  action: 'allow' | 'warn' | 'downgrade' | 'deny'
  model: string | null
  fallbackModel: string | null
} => ({
  allowed: true,
  dailyRemaining: null,
  monthlyRemaining: null,
  action: 'allow',
  model: null,
  fallbackModel: null,
}))
vi.mock('../src/agent-config.js', () => ({
  checkCostCap: (...args: any[]) => mockCheckCostCap(...args),
}))

vi.mock('../src/events.js', () => ({
  eventBus: { emit: vi.fn() },
}))

import {
  enforcePolicy,
  getDailySpend,
  getMonthlySpend,
  getAgentSpend,
  recordUsage,
  purgeUsageLog,
} from '../src/cost-enforcement.js'

describe('cost-enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: return 0 spend
    mockDb.prepare.mockReturnValue({
      get: vi.fn(() => ({ total: 0 })),
      run: vi.fn(),
      all: vi.fn(() => []),
    })
  })

  describe('getAgentSpend', () => {
    it('returns 0 when no usage records exist', () => {
      expect(getAgentSpend('link')).toBe(0)
    })

    it('returns total from db', () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({ total: 12.50 })),
        run: vi.fn(),
        all: vi.fn(() => []),
      })
      expect(getAgentSpend('link')).toBe(12.50)
    })

    it('returns 0 on db error', () => {
      mockDb.prepare.mockImplementation(() => { throw new Error('db error') })
      expect(getAgentSpend('link')).toBe(0)
    })
  })

  describe('getDailySpend', () => {
    it('queries with start of day timestamp', () => {
      getDailySpend('pixel')
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SUM(cost)')
      )
    })
  })

  describe('getMonthlySpend', () => {
    it('queries with start of month timestamp', () => {
      getMonthlySpend('pixel')
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('SUM(cost)')
      )
    })
  })

  describe('recordUsage', () => {
    it('inserts a usage record into the db', () => {
      const runFn = vi.fn()
      mockDb.prepare.mockReturnValue({
        get: vi.fn(),
        run: runFn,
        all: vi.fn(() => []),
      })
      recordUsage({
        agentId: 'link',
        model: 'claude-opus-4',
        inputTokens: 1000,
        outputTokens: 500,
        cost: 0.05,
        timestamp: Date.now(),
      })
      expect(runFn).toHaveBeenCalledWith(
        'link', 'claude-opus-4', 1000, 500, 0.05, expect.any(Number)
      )
    })
  })

  describe('enforcePolicy', () => {
    it('returns allow when no caps configured', () => {
      mockCheckCostCap.mockReturnValue({
        allowed: true,
        dailyRemaining: null,
        monthlyRemaining: null,
        action: 'allow',
        model: null,
        fallbackModel: null,
      })
      const result = enforcePolicy('link')
      expect(result.allowed).toBe(true)
      expect(result.action).toBe('allow')
      expect(result.reason).toBeNull()
    })

    it('returns warn at 80% threshold', () => {
      mockCheckCostCap.mockReturnValue({
        allowed: true,
        dailyRemaining: 1.5,
        monthlyRemaining: null,
        action: 'warn',
        model: 'claude-opus-4',
        fallbackModel: 'claude-sonnet-4',
      })
      const result = enforcePolicy('link')
      expect(result.allowed).toBe(true)
      expect(result.action).toBe('warn')
      expect(result.reason).toContain('80%')
      expect(result.effectiveModel).toBe('claude-opus-4')
    })

    it('returns downgrade at 90% with fallback model', () => {
      mockCheckCostCap.mockReturnValue({
        allowed: true,
        dailyRemaining: 0.5,
        monthlyRemaining: null,
        action: 'downgrade',
        model: 'claude-opus-4',
        fallbackModel: 'claude-sonnet-4',
      })
      const result = enforcePolicy('link')
      expect(result.allowed).toBe(true)
      expect(result.action).toBe('downgrade')
      expect(result.effectiveModel).toBe('claude-sonnet-4')
      expect(result.reason).toContain('fallback')
    })

    it('returns deny at 100% — hard stop', () => {
      mockCheckCostCap.mockReturnValue({
        allowed: false,
        dailyRemaining: 0,
        monthlyRemaining: -5,
        action: 'deny',
        model: 'claude-opus-4',
        fallbackModel: 'claude-sonnet-4',
      })
      const result = enforcePolicy('link')
      expect(result.allowed).toBe(false)
      expect(result.action).toBe('deny')
      expect(result.effectiveModel).toBeNull()
      expect(result.reason).toContain('exceeded')
    })

    it('includes daily and monthly spend in result', () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn(() => ({ total: 7.25 })),
        run: vi.fn(),
        all: vi.fn(() => []),
      })
      mockCheckCostCap.mockReturnValue({
        allowed: true,
        dailyRemaining: 2.75,
        monthlyRemaining: 42.75,
        action: 'allow',
        model: 'claude-opus-4',
        fallbackModel: null,
      })
      const result = enforcePolicy('link')
      expect(result.dailySpend).toBe(7.25)
      expect(result.monthlySpend).toBe(7.25)
      expect(result.dailyRemaining).toBe(2.75)
      expect(result.monthlyRemaining).toBe(42.75)
    })
  })

  describe('purgeUsageLog', () => {
    it('deletes old records', () => {
      const runFn = vi.fn(() => ({ changes: 42 }))
      mockDb.prepare.mockReturnValue({
        get: vi.fn(),
        run: runFn,
        all: vi.fn(() => []),
      })
      const deleted = purgeUsageLog(30)
      expect(deleted).toBe(42)
    })

    it('returns 0 on db error', () => {
      mockDb.prepare.mockImplementation(() => { throw new Error('db error') })
      expect(purgeUsageLog(30)).toBe(0)
    })
  })
})
