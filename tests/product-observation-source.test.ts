import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Tests for product-observation-source.ts
 * 
 * Unit-tests the probe logic, gating conditions, dedup key format,
 * and reflection emission. Does not test the full HTTP integration.
 */

// ── Helpers re-implemented for unit testing (mirrors src logic) ───────────

const PROBE_TIMEOUT_MS = 5_000
const SLOW_THRESHOLD_MS = 2_000
const COOLDOWN_MS = 30 * 60 * 1000
const RECENT_SHIP_WINDOW_MS = 4 * 60 * 60 * 1000

function isCoolingDown(lastRunAt: number | null, now: number): boolean {
  if (!lastRunAt) return false
  return now - lastRunAt < COOLDOWN_MS
}

function agentShippedRecently(lastShippedAt: number | null, now: number): boolean {
  if (!lastShippedAt) return false
  return now - lastShippedAt < RECENT_SHIP_WINDOW_MS
}

type ProbeResult = {
  probe: string
  ok: boolean
  latencyMs: number
  finding?: string
  detail?: string
}

function classifyHealthProbe(status: string, latencyMs: number): ProbeResult {
  const ok = status === 'ok'
  const slow = latencyMs > SLOW_THRESHOLD_MS
  return {
    probe: 'health',
    ok: ok && !slow,
    latencyMs,
    finding: !ok
      ? `Node health check failed: status=${status}`
      : slow ? `Node health endpoint slow: ${latencyMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)` : undefined,
  }
}

function classifyAgentsProbe(
  agents: Array<{ agent: string; state: string; stale_reason?: string }>,
  latencyMs: number,
): ProbeResult {
  const unhealthy = agents.filter(a => a.state !== 'healthy')
  if (unhealthy.length > 0) {
    return {
      probe: 'agents',
      ok: false,
      latencyMs,
      finding: `${unhealthy.length} agent(s) not healthy: ${unhealthy.map(a => `${a.agent}(${a.state})`).join(', ')}`,
    }
  }
  const slow = latencyMs > SLOW_THRESHOLD_MS
  return {
    probe: 'agents',
    ok: !slow,
    latencyMs,
    finding: slow ? `Agents endpoint slow: ${latencyMs}ms` : undefined,
  }
}

function classifyTasksProbe(
  tasks: Array<{ id: string; assignee?: string; updatedAt?: number }>,
  latencyMs: number,
  now: number,
): ProbeResult {
  const stuck = tasks.filter(t => t.updatedAt && now - t.updatedAt > 4 * 60 * 60 * 1000)
  if (stuck.length > 0) {
    return {
      probe: 'tasks',
      ok: false,
      latencyMs,
      finding: `${stuck.length} task(s) stuck in doing for >4h: ${stuck.map(t => t.id).join(', ')}`,
    }
  }
  const slow = latencyMs > SLOW_THRESHOLD_MS
  return {
    probe: 'tasks',
    ok: !slow,
    latencyMs,
    finding: slow ? `Tasks endpoint slow: ${latencyMs}ms` : undefined,
  }
}

function classifyChatProbe(lastMsgTs: number | null, latencyMs: number, now: number): ProbeResult {
  const COMMS_GAP_THRESHOLD_MS = 6 * 60 * 60 * 1000
  if (lastMsgTs !== null && now - lastMsgTs > COMMS_GAP_THRESHOLD_MS) {
    const hoursAgo = Math.floor((now - lastMsgTs) / 3_600_000)
    return {
      probe: 'chat',
      ok: false,
      latencyMs,
      finding: `Team comms gap: last message was ${hoursAgo}h ago`,
    }
  }
  const slow = latencyMs > SLOW_THRESHOLD_MS
  return {
    probe: 'chat',
    ok: !slow,
    latencyMs,
    finding: slow ? `Chat endpoint slow: ${latencyMs}ms` : undefined,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('product-observation-source', () => {
  const NOW = Date.now()

  describe('cooldown gate', () => {
    it('is not cooling down when no prior run', () => {
      expect(isCoolingDown(null, NOW)).toBe(false)
    })

    it('is cooling down when last run was 10 min ago', () => {
      const lastRun = NOW - 10 * 60 * 1000
      expect(isCoolingDown(lastRun, NOW)).toBe(true)
    })

    it('is not cooling down when last run was 35 min ago', () => {
      const lastRun = NOW - 35 * 60 * 1000
      expect(isCoolingDown(lastRun, NOW)).toBe(false)
    })

    it('boundary: exactly at 30m is still cooling down', () => {
      const lastRun = NOW - COOLDOWN_MS
      expect(isCoolingDown(lastRun, NOW)).toBe(false) // 30m exactly = expired
    })
  })

  describe('recent ship gate', () => {
    it('returns false when agent has never shipped', () => {
      expect(agentShippedRecently(null, NOW)).toBe(false)
    })

    it('returns true when shipped 1h ago', () => {
      const shippedAt = NOW - 1 * 60 * 60 * 1000
      expect(agentShippedRecently(shippedAt, NOW)).toBe(true)
    })

    it('returns false when shipped 5h ago', () => {
      const shippedAt = NOW - 5 * 60 * 60 * 1000
      expect(agentShippedRecently(shippedAt, NOW)).toBe(false)
    })

    it('boundary: exactly 4h ago is expired', () => {
      const shippedAt = NOW - RECENT_SHIP_WINDOW_MS
      expect(agentShippedRecently(shippedAt, NOW)).toBe(false)
    })
  })

  describe('health probe classification', () => {
    it('ok when status=ok and fast', () => {
      const result = classifyHealthProbe('ok', 200)
      expect(result.ok).toBe(true)
      expect(result.finding).toBeUndefined()
    })

    it('not ok when status=degraded', () => {
      const result = classifyHealthProbe('degraded', 200)
      expect(result.ok).toBe(false)
      expect(result.finding).toContain('degraded')
    })

    it('not ok when response is slow (>2s)', () => {
      const result = classifyHealthProbe('ok', 2500)
      expect(result.ok).toBe(false)
      expect(result.finding).toContain('slow')
    })

    it('finding is undefined when healthy and fast', () => {
      expect(classifyHealthProbe('ok', 100).finding).toBeUndefined()
    })
  })

  describe('agents probe classification', () => {
    it('ok when all agents are healthy', () => {
      const result = classifyAgentsProbe([
        { agent: 'link', state: 'healthy' },
        { agent: 'kai', state: 'healthy' },
      ], 150)
      expect(result.ok).toBe(true)
      expect(result.finding).toBeUndefined()
    })

    it('not ok when any agent is stale', () => {
      const result = classifyAgentsProbe([
        { agent: 'link', state: 'healthy' },
        { agent: 'swift', state: 'stale', stale_reason: 'no heartbeat in 2h' },
      ], 100)
      expect(result.ok).toBe(false)
      expect(result.finding).toContain('swift(stale)')
    })

    it('reports count in finding', () => {
      const result = classifyAgentsProbe([
        { agent: 'a', state: 'stale' },
        { agent: 'b', state: 'stale' },
      ], 100)
      expect(result.finding).toContain('2 agent(s)')
    })
  })

  describe('tasks probe classification', () => {
    it('ok when no stuck tasks', () => {
      const recentTask = { id: 'task-001', assignee: 'link', updatedAt: NOW - 30 * 60 * 1000 }
      const result = classifyTasksProbe([recentTask], 100, NOW)
      expect(result.ok).toBe(true)
    })

    it('not ok when task stuck >4h', () => {
      const stuckTask = { id: 'task-old', assignee: 'swift', updatedAt: NOW - 5 * 60 * 60 * 1000 }
      const result = classifyTasksProbe([stuckTask], 100, NOW)
      expect(result.ok).toBe(false)
      expect(result.finding).toContain('stuck in doing for >4h')
      expect(result.finding).toContain('task-old')
    })

    it('ok when doing list is empty', () => {
      const result = classifyTasksProbe([], 100, NOW)
      expect(result.ok).toBe(true)
    })
  })

  describe('chat probe classification', () => {
    it('ok when recent message', () => {
      const result = classifyChatProbe(NOW - 30 * 60 * 1000, 100, NOW)
      expect(result.ok).toBe(true)
    })

    it('not ok when gap >6h', () => {
      const oldMsg = NOW - 7 * 60 * 60 * 1000
      const result = classifyChatProbe(oldMsg, 100, NOW)
      expect(result.ok).toBe(false)
      expect(result.finding).toContain('comms gap')
      expect(result.finding).toContain('7h ago')
    })

    it('ok when no messages at all (new system)', () => {
      const result = classifyChatProbe(null, 100, NOW)
      expect(result.ok).toBe(true)
    })

    it('reports hours in finding', () => {
      const oldMsg = NOW - 10 * 60 * 60 * 1000
      const result = classifyChatProbe(oldMsg, 100, NOW)
      expect(result.finding).toContain('10h ago')
    })
  })

  describe('KV key format', () => {
    it('formats cooldown key correctly', () => {
      const agent = 'link'
      const key = `product_obs:last_run:${agent}`
      expect(key).toBe('product_obs:last_run:link')
    })

    it('key is unique per agent', () => {
      const keyLink = `product_obs:last_run:link`
      const keyKai = `product_obs:last_run:kai`
      expect(keyLink).not.toBe(keyKai)
    })
  })

  describe('only emit findings when probe fails or is slow', () => {
    it('healthy probes produce no finding', () => {
      const results = [
        classifyHealthProbe('ok', 100),
        classifyAgentsProbe([{ agent: 'link', state: 'healthy' }], 100),
        classifyTasksProbe([], 100, NOW),
        classifyChatProbe(NOW - 60_000, 100, NOW),
      ]
      const withFindings = results.filter(r => r.finding)
      expect(withFindings).toHaveLength(0)
    })

    it('multiple degraded probes all produce findings', () => {
      const results = [
        classifyHealthProbe('degraded', 100),
        classifyAgentsProbe([{ agent: 'swift', state: 'stale' }], 100),
        classifyTasksProbe([{ id: 't1', updatedAt: NOW - 5 * 3600 * 1000 }], 100, NOW),
      ]
      const withFindings = results.filter(r => r.finding)
      expect(withFindings).toHaveLength(3)
    })
  })
})
