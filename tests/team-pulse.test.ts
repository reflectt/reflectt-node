// Team pulse tests: proactive status broadcast (trust-gap mitigation)
import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeTeamPulse,
  formatPulseMessage,
  configureTeamPulse,
  getTeamPulseConfig,
  _resetTeamPulse,
} from '../src/team-pulse.js'

beforeEach(() => {
  _resetTeamPulse()
  configureTeamPulse({
    agents: ['link', 'sage', 'kai'],
    intervalMin: 120,
    channel: 'ops',
  })
})

describe('computeTeamPulse', () => {
  it('returns a snapshot with all required fields', () => {
    const pulse = computeTeamPulse()

    expect(pulse.timestamp).toBeGreaterThan(0)
    expect(pulse.agents).toBeInstanceOf(Array)
    expect(pulse.agents.length).toBe(3) // link, sage, kai
    expect(pulse).toHaveProperty('totalDoing')
    expect(pulse).toHaveProperty('totalTodo')
    expect(pulse).toHaveProperty('totalRecentShips')
    expect(pulse).toHaveProperty('teamStatus')
    expect(pulse).toHaveProperty('queueDepth')
    expect(['healthy', 'slow', 'stalled']).toContain(pulse.teamStatus)
  })

  it('includes per-agent status', () => {
    const pulse = computeTeamPulse()

    for (const agent of pulse.agents) {
      expect(agent).toHaveProperty('agent')
      expect(agent).toHaveProperty('doingCount')
      expect(agent).toHaveProperty('todoCount')
      expect(agent).toHaveProperty('recentShips')
      expect(agent).toHaveProperty('status')
      expect(['active', 'idle', 'blocked']).toContain(agent.status)
    }
  })
})

describe('formatPulseMessage', () => {
  it('formats a pulse snapshot into readable message', () => {
    const pulse = computeTeamPulse()
    const message = formatPulseMessage(pulse)

    expect(typeof message).toBe('string')
    expect(message).toContain('Team Pulse')
    expect(message.length).toBeGreaterThan(20)
  })

  it('includes status emoji based on team health', () => {
    const pulse = computeTeamPulse()
    const message = formatPulseMessage(pulse)

    // Should contain one of the status emojis
    expect(message.match(/[🟢🟡🔴]/)).toBeTruthy()
  })

  it('shows stalled warning when no work', () => {
    configureTeamPulse({ agents: [] }) // no agents = no work
    const pulse = computeTeamPulse()
    pulse.teamStatus = 'stalled'
    const message = formatPulseMessage(pulse)
    expect(message).toContain('No active or queued work')
  })
})

describe('configureTeamPulse', () => {
  it('updates config', () => {
    configureTeamPulse({ intervalMin: 60, channel: 'general' })
    const cfg = getTeamPulseConfig()
    expect(cfg.intervalMin).toBe(60)
    expect(cfg.channel).toBe('general')
  })

  it('preserves unset fields', () => {
    const before = getTeamPulseConfig()
    configureTeamPulse({ intervalMin: 30 })
    const after = getTeamPulseConfig()
    expect(after.intervalMin).toBe(30)
    expect(after.channel).toBe(before.channel)
    expect(after.agents).toEqual(before.agents)
  })
})
