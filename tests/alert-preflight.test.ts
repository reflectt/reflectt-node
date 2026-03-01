// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock dependencies before importing the module
vi.mock('../src/config.js', () => ({
  DATA_DIR: '/tmp/test-data',
  REFLECTT_HOME: '/tmp/test-home',
  LEGACY_DATA_DIR: '/tmp/test-legacy',
  INBOX_DIR: '/tmp/test-inbox',
  serverConfig: { port: 4445, host: '0.0.0.0', corsEnabled: true },
  openclawConfig: { gatewayUrl: '', gatewayToken: '', agentId: '' },
  isDev: true,
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    appendFileSync: vi.fn(),
  }
})

// Mock taskManager
const mockGetTask = vi.fn()
const mockGetTaskComments = vi.fn()

vi.mock('../src/tasks.js', () => ({
  taskManager: {
    getTask: (...args: unknown[]) => mockGetTask(...args),
    getTaskComments: (...args: unknown[]) => mockGetTaskComments(...args),
    listTasks: () => [],
    getStats: () => ({ total: 0, byStatus: {} }),
  },
}))

import {
  preflightCheck,
  getPreflightMetrics,
  resetPreflightMetrics,
  getPreflightMode,
  type PreflightInput,
} from '../src/alert-preflight.js'

describe('alert-preflight', () => {
  beforeEach(() => {
    resetPreflightMetrics()
    mockGetTask.mockReset()
    mockGetTaskComments.mockReset()
    mockGetTaskComments.mockReturnValue([])
    // Default: return a task in 'doing' status
    mockGetTask.mockReturnValue({
      id: 'task-123',
      status: 'doing',
      assignee: 'link',
      reviewer: 'kai',
      updatedAt: Date.now() - 600_000, // 10 min ago
    })
  })

  describe('preflightCheck', () => {
    it('allows alert when state matches (true positive)', () => {
      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'sla_warning',
        expectedStatus: 'doing',
        expectedAssignee: 'link',
      }
      const result = preflightCheck(input)
      // In canary mode (default), always proceeds
      expect(result.proceed).toBe(true)
      expect(result.idempotentKey).toBeTruthy()
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('flags alert when task status drifted (false positive)', () => {
      mockGetTask.mockReturnValue({
        id: 'task-123',
        status: 'done', // Task already done
        assignee: 'link',
        reviewer: 'kai',
        updatedAt: Date.now() - 600_000,
      })

      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'stale',
        expectedStatus: 'doing',
      }
      const result = preflightCheck(input)
      // In canary mode, proceeds but with reason
      expect(result.proceed).toBe(true) // canary: still sends
      expect(result.reason).toContain('status drift')
      expect(result.mode).toBe('canary')
    })

    it('suppresses when task status is done', () => {
      mockGetTask.mockReturnValue({
        id: 'task-123',
        status: 'done',
        assignee: 'link',
        reviewer: 'kai',
        updatedAt: Date.now() - 600_000,
      })

      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'sla_warning',
        // No expected status — so status drift check doesn't fire
        // But "task already done" check does
      }
      const result = preflightCheck(input)
      expect(result.reason).toContain('task already done')
    })

    it('flags when assignee drifted', () => {
      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'idle',
        expectedAssignee: 'pixel', // Different from actual 'link'
      }
      const result = preflightCheck(input)
      expect(result.reason).toContain('assignee drift')
    })

    it('flags when reviewer drifted', () => {
      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'sla_warning',
        expectedReviewer: 'sage', // Different from actual 'kai'
      }
      const result = preflightCheck(input)
      expect(result.reason).toContain('reviewer drift')
    })

    it('flags stale alert when recent activity exists', () => {
      mockGetTask.mockReturnValue({
        id: 'task-123',
        status: 'doing',
        assignee: 'link',
        reviewer: 'kai',
        updatedAt: Date.now() - 60_000, // Updated 1 min ago (within 5 min window)
      })

      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'stale',
        expectedStatus: 'doing',
      }
      const result = preflightCheck(input)
      expect(result.reason).toContain('recent update')
    })

    it('flags idle alert when recent comment exists', () => {
      mockGetTaskComments.mockReturnValue([
        { id: 'c1', content: 'working on it', timestamp: Date.now() - 120_000 }, // 2 min ago
      ])

      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'idle',
        expectedStatus: 'doing',
      }
      const result = preflightCheck(input)
      expect(result.reason).toContain('recent activity')
    })

    it('deduplicates identical alerts via idempotent key', () => {
      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'sla_warning',
        expectedStatus: 'doing',
      }

      // First call: passes
      const result1 = preflightCheck(input)
      expect(result1.proceed).toBe(true)

      // Second call with same state: dedup'd
      const result2 = preflightCheck(input)
      expect(result2.reason).toContain('duplicate alert')
    })

    it('allows alert through when task not found (system alert)', () => {
      mockGetTask.mockReturnValue(undefined)

      const input: PreflightInput = {
        taskId: 'task-nonexistent',
        alertType: 'system_error',
      }
      const result = preflightCheck(input)
      expect(result.proceed).toBe(true)
    })

    it('allows alert when no taskId provided', () => {
      const input: PreflightInput = {
        taskId: '',
        alertType: 'system_broadcast',
      }
      const result = preflightCheck(input)
      expect(result.proceed).toBe(true)
    })
  })

  describe('enforce mode', () => {
    beforeEach(() => {
      process.env.ALERT_PREFLIGHT_MODE = 'enforce'
    })

    afterEach(() => {
      delete process.env.ALERT_PREFLIGHT_MODE
    })

    it('actually suppresses false positives', () => {
      mockGetTask.mockReturnValue({
        id: 'task-123',
        status: 'done',
        assignee: 'link',
        reviewer: 'kai',
        updatedAt: Date.now() - 600_000,
      })

      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'stale',
        expectedStatus: 'doing',
      }
      const result = preflightCheck(input)
      expect(result.proceed).toBe(false) // enforce: actually suppresses
      expect(result.reason).toContain('status drift')
    })
  })

  describe('off mode', () => {
    beforeEach(() => {
      process.env.ALERT_PREFLIGHT_MODE = 'off'
    })

    afterEach(() => {
      delete process.env.ALERT_PREFLIGHT_MODE
    })

    it('bypasses all checks', () => {
      const input: PreflightInput = {
        taskId: 'task-123',
        alertType: 'sla_warning',
        expectedStatus: 'validating',
      }
      const result = preflightCheck(input)
      expect(result.proceed).toBe(true)
      expect(result.reason).toBe('preflight disabled')
    })
  })

  describe('metrics', () => {
    it('tracks totalChecked', () => {
      preflightCheck({ taskId: 'task-1', alertType: 'test' })
      preflightCheck({ taskId: 'task-2', alertType: 'test' })
      const metrics = getPreflightMetrics()
      expect(metrics.totalChecked).toBe(2)
    })

    it('tracks canaryFlagged in canary mode', () => {
      mockGetTask.mockReturnValue({
        id: 'task-123',
        status: 'done',
        assignee: 'link',
        updatedAt: Date.now() - 600_000,
      })

      preflightCheck({
        taskId: 'task-123',
        alertType: 'stale',
        expectedStatus: 'doing',
      })
      const metrics = getPreflightMetrics()
      expect(metrics.canaryFlagged).toBeGreaterThan(0)
    })

    it('reports latencyP95', () => {
      for (let i = 0; i < 20; i++) {
        preflightCheck({ taskId: `task-${i}`, alertType: `type-${i}` })
      }
      const metrics = getPreflightMetrics()
      expect(metrics.latencyP95).toBeGreaterThanOrEqual(0)
      expect(metrics.latencyP95).toBeLessThan(500) // Must be under 500ms
    })

    it('resets properly', () => {
      preflightCheck({ taskId: 'task-1', alertType: 'test' })
      resetPreflightMetrics()
      const metrics = getPreflightMetrics()
      expect(metrics.totalChecked).toBe(0)
      expect(metrics.suppressed).toBe(0)
      expect(metrics.canaryFlagged).toBe(0)
    })
  })

  describe('getPreflightMode', () => {
    afterEach(() => {
      delete process.env.ALERT_PREFLIGHT_MODE
    })

    it('defaults to canary', () => {
      delete process.env.ALERT_PREFLIGHT_MODE
      expect(getPreflightMode()).toBe('canary')
    })

    it('respects enforce', () => {
      process.env.ALERT_PREFLIGHT_MODE = 'enforce'
      expect(getPreflightMode()).toBe('enforce')
    })

    it('respects off', () => {
      process.env.ALERT_PREFLIGHT_MODE = 'off'
      expect(getPreflightMode()).toBe('off')
    })

    it('falls back to canary for invalid', () => {
      process.env.ALERT_PREFLIGHT_MODE = 'garbage'
      expect(getPreflightMode()).toBe('canary')
    })
  })
})
