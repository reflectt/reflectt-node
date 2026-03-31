// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Test the cost cap logic in isolation
function checkCostCap(
  config: { costCapDaily: number | null; costCapMonthly: number | null; model: string | null; fallbackModel: string | null } | null,
  dailySpend: number,
  monthlySpend: number,
): { allowed: boolean; action: 'allow' | 'warn' | 'downgrade' | 'deny' } {
  if (!config) return { allowed: true, action: 'allow' }

  let action: 'allow' | 'warn' | 'downgrade' | 'deny' = 'allow'

  if (config.costCapDaily !== null) {
    const remaining = config.costCapDaily - dailySpend
    if (remaining <= 0) action = 'deny'
    else if (remaining < config.costCapDaily * 0.1) action = 'downgrade'
    else if (remaining < config.costCapDaily * 0.2) action = 'warn'
  }

  if (config.costCapMonthly !== null) {
    const remaining = config.costCapMonthly - monthlySpend
    if (remaining <= 0) action = 'deny'
    else if (remaining < config.costCapMonthly * 0.1 && action !== 'deny') action = 'downgrade'
    else if (remaining < config.costCapMonthly * 0.2 && action === 'allow') action = 'warn'
  }

  return { allowed: action !== 'deny', action }
}

describe('agent config cost enforcement', () => {
  it('allows when no config exists', () => {
    const r = checkCostCap(null, 5, 50)
    assert.equal(r.allowed, true)
    assert.equal(r.action, 'allow')
  })

  it('allows when no caps are set', () => {
    const r = checkCostCap({ costCapDaily: null, costCapMonthly: null, model: null, fallbackModel: null }, 5, 50)
    assert.equal(r.allowed, true)
    assert.equal(r.action, 'allow')
  })

  it('allows when well under daily cap', () => {
    const r = checkCostCap({ costCapDaily: 10, costCapMonthly: null, model: 'opus', fallbackModel: 'sonnet' }, 3, 0)
    assert.equal(r.allowed, true)
    assert.equal(r.action, 'allow')
  })

  it('warns at 80% daily spend', () => {
    const r = checkCostCap({ costCapDaily: 10, costCapMonthly: null, model: 'opus', fallbackModel: 'sonnet' }, 8.5, 0)
    assert.equal(r.allowed, true)
    assert.equal(r.action, 'warn')
  })

  it('downgrades at 90% daily spend', () => {
    const r = checkCostCap({ costCapDaily: 10, costCapMonthly: null, model: 'opus', fallbackModel: 'sonnet' }, 9.5, 0)
    assert.equal(r.allowed, true)
    assert.equal(r.action, 'downgrade')
  })

  it('denies at 100% daily spend', () => {
    const r = checkCostCap({ costCapDaily: 10, costCapMonthly: null, model: 'opus', fallbackModel: 'sonnet' }, 10, 0)
    assert.equal(r.allowed, false)
    assert.equal(r.action, 'deny')
  })

  it('denies when over daily cap', () => {
    const r = checkCostCap({ costCapDaily: 10, costCapMonthly: null, model: 'opus', fallbackModel: 'sonnet' }, 12, 0)
    assert.equal(r.allowed, false)
    assert.equal(r.action, 'deny')
  })

  it('monthly cap denies overriding daily allow', () => {
    const r = checkCostCap({ costCapDaily: 10, costCapMonthly: 100, model: null, fallbackModel: null }, 3, 100)
    assert.equal(r.allowed, false)
    assert.equal(r.action, 'deny')
  })

  it('monthly warn when daily is fine', () => {
    const r = checkCostCap({ costCapDaily: null, costCapMonthly: 100, model: null, fallbackModel: null }, 0, 85)
    assert.equal(r.allowed, true)
    assert.equal(r.action, 'warn')
  })

  it('monthly downgrade at 90%', () => {
    const r = checkCostCap({ costCapDaily: null, costCapMonthly: 100, model: null, fallbackModel: null }, 0, 95)
    assert.equal(r.allowed, true)
    assert.equal(r.action, 'downgrade')
  })

  it('both caps — tighter one wins', () => {
    // Daily is at 95% (downgrade), monthly is fine
    const r = checkCostCap({ costCapDaily: 10, costCapMonthly: 1000, model: 'opus', fallbackModel: 'sonnet' }, 9.5, 50)
    assert.equal(r.action, 'downgrade')
  })

  it('zero cap always denies', () => {
    const r = checkCostCap({ costCapDaily: 0, costCapMonthly: null, model: null, fallbackModel: null }, 0, 0)
    assert.equal(r.allowed, false)
    assert.equal(r.action, 'deny')
  })
})
