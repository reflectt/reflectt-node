// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Idle-nudge gate: in-active-room suppression.
 *
 * Reflectt agents on a managed host post into a single #general chat that
 * the canvas surface reads. Before this gate, the system idle-nudge
 * subsystem fired during live human exchanges, dropping "@agent idle nudge"
 * lines into the room and making agents read like status bots.
 *
 * Behavior under test: when the room-presence-store reports any human
 * participant on this host, every per-agent decision in runIdleNudgeTick
 * short-circuits to `decision: 'none', reason: 'in-active-room'` — before
 * any other gate runs. Empty room → original flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listRoomParticipantsMock = vi.fn<[], Array<{ id: string }>>()

vi.mock('../src/room-presence-store.js', () => ({
  listRoomParticipants: () => listRoomParticipantsMock(),
}))

// Import after mock so the health module picks up the stub.
const { healthMonitor } = await import('../src/health.js')
const { presenceManager } = await import('../src/presence.js')

describe('idle-nudge in-active-room gate', () => {
  beforeEach(() => {
    listRoomParticipantsMock.mockReset()
  })

  afterEach(() => {
    listRoomParticipantsMock.mockReset()
  })

  it('marks every per-agent decision as in-active-room when humans are present', async () => {
    presenceManager.updatePresence('test-agent-room-gate', 'working')
    listRoomParticipantsMock.mockReturnValue([
      { id: 'human-session-abc' },
    ])

    const result = await healthMonitor.runIdleNudgeTick(Date.now(), { dryRun: true })

    // Every decision (one per known presence agent) must be the new gate —
    // no nudges should be fired and no other reason should appear, since
    // this gate runs before every other suppression check.
    expect(result.nudged).toEqual([])
    const seeded = result.decisions.find(d => d.agent === 'test-agent-room-gate')
    expect(seeded?.decision).toBe('none')
    expect(seeded?.reason).toBe('in-active-room')
    expect(seeded?.renderedMessage).toBeNull()
    // No agent escapes the gate — every decision in this tick is in-active-room.
    for (const d of result.decisions) {
      expect(d.reason).toBe('in-active-room')
    }
  })

  it('falls through to existing gates when the room is empty', async () => {
    presenceManager.updatePresence('test-agent-room-gate', 'working')
    listRoomParticipantsMock.mockReturnValue([])

    const result = await healthMonitor.runIdleNudgeTick(Date.now(), { dryRun: true })

    // With no humans in the room, no decision should carry the new reason —
    // the existing 15 suppression gates own the outcome.
    for (const d of result.decisions) {
      expect(d.reason).not.toBe('in-active-room')
    }
  })
})
