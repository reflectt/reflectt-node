import { describe, it, expect, beforeEach } from 'vitest'

// We test the exported functions directly — they use SQLite via getDb()
// which vitest sets up with an in-memory DB via the test helper.

describe('intensity', () => {
  let mod: typeof import('../src/intensity.js')

  beforeEach(async () => {
    // Fresh import each time to reset module state
    mod = await import('../src/intensity.js')
  })

  it('defaults to normal preset', () => {
    const state = mod.getIntensity()
    expect(state.preset).toBe('normal')
    expect(state.limits.wipLimit).toBe(2)
    expect(state.limits.maxPullsPerHour).toBe(10)
    expect(state.limits.batchIntervalMs).toBe(0)
  })

  it('validates presets', () => {
    expect(mod.isValidPreset('low')).toBe(true)
    expect(mod.isValidPreset('normal')).toBe(true)
    expect(mod.isValidPreset('high')).toBe(true)
    expect(mod.isValidPreset('turbo')).toBe(false)
    expect(mod.isValidPreset('')).toBe(false)
    expect(mod.isValidPreset(42)).toBe(false)
  })

  it('sets and persists intensity', () => {
    const state = mod.setIntensity('low', 'test-user')
    expect(state.preset).toBe('low')
    expect(state.limits.wipLimit).toBe(1)
    expect(state.limits.maxPullsPerHour).toBe(2)
    expect(state.limits.batchIntervalMs).toBe(10 * 60_000)
    expect(state.updatedBy).toBe('test-user')
    expect(state.updatedAt).toBeGreaterThan(0)

    // Read back
    const read = mod.getIntensity()
    expect(read.preset).toBe('low')
  })

  it('switches between presets', () => {
    mod.setIntensity('high', 'admin')
    expect(mod.getIntensity().limits.wipLimit).toBe(3)
    expect(mod.getIntensity().limits.maxPullsPerHour).toBe(30)

    mod.setIntensity('normal', 'admin')
    expect(mod.getIntensity().limits.wipLimit).toBe(2)
  })

  it('records pulls and enforces rate limit', () => {
    mod.setIntensity('low', 'test') // 2 pulls/hr

    const pull1 = mod.recordPull('agent-a')
    expect(pull1.allowed).toBe(true)
    expect(pull1.remaining).toBe(1)

    const pull2 = mod.recordPull('agent-a')
    expect(pull2.allowed).toBe(true)
    expect(pull2.remaining).toBe(0)

    const pull3 = mod.recordPull('agent-a')
    expect(pull3.allowed).toBe(false)
    expect(pull3.resetsInMs).toBeGreaterThan(0)
  })

  it('tracks pulls per agent independently', () => {
    mod.setIntensity('low', 'test') // 2 pulls/hr

    mod.recordPull('agent-a')
    mod.recordPull('agent-a')

    // agent-b should still have budget
    const pull = mod.recordPull('agent-b')
    expect(pull.allowed).toBe(true)
  })

  it('checkPullBudget reports remaining without consuming', () => {
    mod.setIntensity('low', 'test') // 2 pulls/hr

    const before = mod.checkPullBudget('agent-c')
    expect(before.remaining).toBe(2)
    expect(before.limit).toBe(2)

    // Should still be 2 — checkPullBudget doesn't consume
    const after = mod.checkPullBudget('agent-c')
    expect(after.remaining).toBe(2)
  })

  it('preset limits are correct for each level', () => {
    const low = mod.getPresetLimits('low')
    expect(low).toEqual({ wipLimit: 1, maxPullsPerHour: 2, batchIntervalMs: 600000 })

    const normal = mod.getPresetLimits('normal')
    expect(normal).toEqual({ wipLimit: 2, maxPullsPerHour: 10, batchIntervalMs: 0 })

    const high = mod.getPresetLimits('high')
    expect(high).toEqual({ wipLimit: 3, maxPullsPerHour: 30, batchIntervalMs: 0 })
  })
})
