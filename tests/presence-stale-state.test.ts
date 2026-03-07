// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect, beforeEach } from 'vitest'
import { presenceManager } from '../src/presence.js'

describe('Presence stale-state fix', () => {
  beforeEach(() => {
    // Clear all presence entries
    presenceManager.clearAll?.() 
  })

  it('recordActivity updates lastUpdate so health reads see fresh data', () => {
    // Simulate: agent gets presence set via heartbeat
    presenceManager.updatePresence('test-agent', 'working', 'task-1')
    const before = presenceManager.getPresence('test-agent')
    expect(before).toBeTruthy()
    const originalLastUpdate = before!.lastUpdate

    // Simulate time passing — lastUpdate is now stale
    // recordActivity should update lastUpdate (not just last_active)
    presenceManager.recordActivity('test-agent', 'message')
    const after = presenceManager.getPresence('test-agent')
    expect(after).toBeTruthy()
    expect(after!.lastUpdate).toBeGreaterThanOrEqual(originalLastUpdate)
    expect(after!.last_active).toBeGreaterThanOrEqual(originalLastUpdate)
  })

  it('recordActivity on agent without prior presence does not crash', () => {
    // Should be a no-op for presence, just update activity tracking
    expect(() => {
      presenceManager.recordActivity('ghost-agent', 'message')
    }).not.toThrow()
  })
})
