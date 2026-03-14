/**
 * Reflection reminder 4-tier escalation — SIGNAL-ROUTING Change 2
 * task-1773525631162-cjxch4mrz
 *
 * Tier table:
 *   < 14h          → none
 *   14h–24h        → digest (batchNag, no @mention)
 *   24h–48h        → mention (once per 24h per agent, #ops)
 *   48h+           → escalate (once per 48h per agent, @kai in #ops)
 *   justCompleted  → immediate (batchNag to config channel)
 *
 * Dedup guards:
 *   mention: fires at most once per 24h per agent (set in getReflectionTier)
 *   escalate: fires at most once per 48h per agent (set in getReflectionTier)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock routeMessage before importing reflection-automation ────────────────
const posted: Array<{ channel: string; content: string; severity: string }> = []
vi.mock('../src/messageRouter.js', () => ({
  routeMessage: vi.fn(async (msg: any) => {
    posted.push({ channel: msg.forceChannel ?? 'general', content: msg.content, severity: msg.severity ?? '' })
    return { sent: true }
  }),
}))

// ── Import after mocks are set up ──────────────────────────────────────────
import {
  getReflectionTier,
  dispatchReflectionTier,
  _resetTierDedupForTest,
  _nagBatch,
} from '../src/reflection-automation.js'

const hours = (h: number) => h * 60 * 60 * 1000

function makeConfig() {
  return {
    enabled: true,
    postTaskDelayMin: 5,
    idleReflectionHours: 8,
    cooldownMin: 60,
    agents: [],
    channel: 'general',
    roleCadenceHours: {},
    excludeAgents: [],
    nudgeNeverReflected: true,
  }
}

beforeEach(() => {
  posted.length = 0
  _nagBatch.clear()
  _resetTierDedupForTest()
})

// ── Tier selection tests (pure, no side effects) ───────────────────────────

describe('SIGNAL-ROUTING Change 2: getReflectionTier()', () => {
  it('A: < 14h overdue → none', () => {
    const now = Date.now()
    expect(getReflectionTier('link', now - hours(10), false, now)).toBe('none')
  })

  it('B: 14h–24h overdue → digest', () => {
    const now = Date.now()
    expect(getReflectionTier('link', now - hours(18), false, now)).toBe('digest')
  })

  it('C: 24h–48h overdue → mention', () => {
    const now = Date.now()
    expect(getReflectionTier('link', now - hours(30), false, now)).toBe('mention')
  })

  it('D: 48h+ overdue → escalate', () => {
    const now = Date.now()
    expect(getReflectionTier('link', now - hours(60), false, now)).toBe('escalate')
  })

  it('E: justCompletedTask=true → immediate (regardless of overdue hours)', () => {
    const now = Date.now()
    expect(getReflectionTier('link', now - hours(5), true, now)).toBe('immediate')
  })

  it('F: mention dedup — second call within 24h suppressed', () => {
    const now = Date.now()
    const lastReflection = now - hours(30)
    const first = getReflectionTier('agentF', lastReflection, false, now)
    expect(first).toBe('mention')
    // Immediate second call — same nowMs, same agent → dedup fires
    const second = getReflectionTier('agentF', lastReflection, false, now + 1)
    expect(second).toBe('none')
  })

  it('G: escalate dedup — second call within 48h suppressed', () => {
    const now = Date.now()
    const lastReflection = now - hours(72)
    const first = getReflectionTier('agentG', lastReflection, false, now)
    expect(first).toBe('escalate')
    const second = getReflectionTier('agentG', lastReflection, false, now + 1)
    expect(second).toBe('none')
  })

  it('G2: escalate dedup resets after 48h', () => {
    const now = Date.now()
    const lastReflection = now - hours(72)
    getReflectionTier('agentG2', lastReflection, false, now) // fires, records now
    // 49h later — dedup should have expired
    const later = now + hours(49)
    const third = getReflectionTier('agentG2', lastReflection - hours(49), false, later)
    expect(third).toBe('escalate')
  })
})

// ── Dispatch tests ─────────────────────────────────────────────────────────

describe('SIGNAL-ROUTING Change 2: dispatchReflectionTier()', () => {
  it('H: digest → queued in _nagBatch, nothing posted directly', async () => {
    await dispatchReflectionTier('link', 'digest', 18, Date.now() - hours(18), makeConfig())
    expect(posted.length).toBe(0)
    const msgs = Array.from(_nagBatch.values()).flat() as string[]
    expect(msgs.some(m => m.includes('@link'))).toBe(true)
  })

  it('I: mention → posts to #ops with @mention', async () => {
    await dispatchReflectionTier('link4', 'mention', 30, Date.now() - hours(30), makeConfig())
    expect(posted.length).toBe(1)
    expect(posted[0].channel).toBe('ops')
    expect(posted[0].content).toContain('@link4')
    expect(posted[0].content).toContain('30h')
  })

  it('J: escalate → posts to #ops with @kai + ISO date', async () => {
    const lastReflectionAt = Date.now() - hours(72)
    await dispatchReflectionTier('link5', 'escalate', 72, lastReflectionAt, makeConfig())
    expect(posted.length).toBe(1)
    expect(posted[0].channel).toBe('ops')
    expect(posted[0].content).toContain('@kai')
    expect(posted[0].content).toContain('@link5')
    expect(posted[0].content).toContain('72h')
    expect(posted[0].content).toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(posted[0].severity).toBe('critical')
  })

  it('K: none → nothing dispatched', async () => {
    await dispatchReflectionTier('link', 'none', 5, Date.now() - hours(5), makeConfig())
    expect(posted.length).toBe(0)
    expect(Array.from(_nagBatch.values()).flat().length).toBe(0)
  })

  it('L: immediate → queued in _nagBatch to config channel', async () => {
    const config = { ...makeConfig(), channel: 'team-chat' }
    await dispatchReflectionTier('link', 'immediate', 0, Date.now(), config)
    expect(posted.length).toBe(0)
    const msgs = _nagBatch.get('team-chat') ?? []
    expect(msgs.some((m: string) => m.includes('@link'))).toBe(true)
  })
})
