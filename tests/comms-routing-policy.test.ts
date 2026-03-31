// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { resolveCommsRoute, simulateRoutingScenarios, type CommsRoutingPolicy, type RoutingScenario } from '../src/comms-routing-policy.js'

const basePolicy: CommsRoutingPolicy = {
  aliasOwners: {
    'billing@reflectt.ai': 'echo',
    'sales@reflectt.ai': 'spark',
    'support@reflectt.ai': 'kai',
  },
  sharedInboxes: {
    'team@reflectt.ai': { owner: 'coo', assignees: ['echo', 'kai'] },
    '+15551230001': { owner: 'coo', assignees: ['kai', 'echo'] },
  },
  numberOwners: {
    '+15551239999': 'kotlin',
    '+15550001111': 'kai',
  },
  defaultOwner: 'coo',
  fallbackAssignee: 'rhythm',
  availableAgents: ['echo', 'spark', 'kai', 'coo', 'rhythm', 'kotlin'],
}

describe('comms routing policy simulator', () => {
  it('routes alias email to direct owner', () => {
    const result = resolveCommsRoute({ id: 's1', channel: 'email', recipient: 'billing@reflectt.ai' }, basePolicy)
    expect(result.reasonCode).toBe('ALIAS_OWNER_MATCH')
    expect(result.owner).toBe('echo')
    expect(result.assignee).toBe('echo')
    expect(result.fallback).toBe(false)
  })

  it('routes shared inbox email to first available assignee', () => {
    const result = resolveCommsRoute({ id: 's2', channel: 'email', recipient: 'team@reflectt.ai' }, basePolicy)
    expect(result.reasonCode).toBe('SHARED_INBOX_ASSIGNMENT')
    expect(result.owner).toBe('coo')
    expect(result.assignee).toBe('echo')
  })

  it('routes direct number ownership for sms', () => {
    const result = resolveCommsRoute({ id: 's3', channel: 'sms', recipient: '+15551239999' }, basePolicy)
    expect(result.reasonCode).toBe('NUMBER_OWNER_MATCH')
    expect(result.owner).toBe('kotlin')
    expect(result.assignee).toBe('kotlin')
    expect(result.fallback).toBe(false)
  })

  it('routes shared number inbox for sms', () => {
    const result = resolveCommsRoute({ id: 's4', channel: 'sms', recipient: '+15551230001' }, basePolicy)
    expect(result.reasonCode).toBe('SHARED_INBOX_ASSIGNMENT')
    expect(result.owner).toBe('coo')
    expect(result.assignee).toBe('kai')
  })

  it('flags alias/shared inbox owner conflict', () => {
    const policy: CommsRoutingPolicy = {
      ...basePolicy,
      aliasOwners: { ...basePolicy.aliasOwners, 'team@reflectt.ai': 'spark' },
    }
    const result = resolveCommsRoute({ id: 's5', channel: 'email', recipient: 'team@reflectt.ai' }, policy)
    expect(result.reasonCode).toBe('CONFLICT_ALIAS_SHARED_INBOX')
    expect(result.escalate).toBe(true)
    expect(result.fallback).toBe(true)
  })

  it('flags number/shared inbox owner conflict', () => {
    const policy: CommsRoutingPolicy = {
      ...basePolicy,
      numberOwners: { ...basePolicy.numberOwners, '+15551230001': 'spark' },
    }
    const result = resolveCommsRoute({ id: 's6', channel: 'sms', recipient: '+15551230001' }, policy)
    expect(result.reasonCode).toBe('CONFLICT_NUMBER_SHARED_INBOX')
    expect(result.escalate).toBe(true)
  })

  it('falls back when alias owner unavailable', () => {
    const policy: CommsRoutingPolicy = {
      ...basePolicy,
      availableAgents: ['coo', 'rhythm'],
    }
    const result = resolveCommsRoute({ id: 's7', channel: 'email', recipient: 'sales@reflectt.ai' }, policy)
    expect(result.reasonCode).toBe('OWNER_UNAVAILABLE_FALLBACK')
    expect(result.owner).toBe('spark')
    expect(result.assignee).toBe('rhythm')
  })

  it('falls back when shared inbox owner + assignees are unavailable', () => {
    const policy: CommsRoutingPolicy = {
      ...basePolicy,
      availableAgents: ['rhythm'],
    }
    const result = resolveCommsRoute({ id: 's8', channel: 'email', recipient: 'team@reflectt.ai' }, policy)
    expect(result.reasonCode).toBe('OWNER_UNAVAILABLE_FALLBACK')
    expect(result.assignee).toBe('rhythm')
  })

  it('falls back and escalates for unknown email recipient', () => {
    const result = resolveCommsRoute({ id: 's9', channel: 'email', recipient: 'unknown@reflectt.ai' }, basePolicy)
    expect(result.reasonCode).toBe('UNKNOWN_RECIPIENT_FALLBACK')
    expect(result.escalate).toBe(true)
    expect(result.assignee).toBe('rhythm')
  })

  it('falls back and escalates for unknown sms recipient', () => {
    const result = resolveCommsRoute({ id: 's10', channel: 'sms', recipient: '+19998887777' }, basePolicy)
    expect(result.reasonCode).toBe('UNKNOWN_RECIPIENT_FALLBACK')
    expect(result.escalate).toBe(true)
  })

  it('simulator accepts scenario payloads and returns rationale for each', () => {
    const scenarios: RoutingScenario[] = [
      { id: 's11-a', channel: 'email', recipient: 'support@reflectt.ai' },
      { id: 's11-b', channel: 'email', recipient: 'unknown@reflectt.ai' },
      { id: 's11-c', channel: 'sms', recipient: '+15550001111' },
    ]

    const results = simulateRoutingScenarios(scenarios, basePolicy)
    expect(results).toHaveLength(3)
    expect(results[0].reasonCode).toBe('ALIAS_OWNER_MATCH')
    expect(results[1].reasonCode).toBe('UNKNOWN_RECIPIENT_FALLBACK')
    expect(results[2].reasonCode).toBe('NUMBER_OWNER_MATCH')
    for (const r of results) {
      expect(r.rationale.length).toBeGreaterThan(10)
    }
  })

  it('keeps deterministic result for same scenario input', () => {
    const scenario: RoutingScenario = { id: 's12', channel: 'email', recipient: 'team@reflectt.ai' }
    const a = resolveCommsRoute(scenario, basePolicy)
    const b = resolveCommsRoute(scenario, basePolicy)
    expect(a).toEqual(b)
  })
})
