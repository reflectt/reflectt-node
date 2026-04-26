// Slice 2 regression: store must boot quietly when Supabase env is missing.
// We don't want a node deployment without SUPABASE_URL/SERVICE_ROLE_KEY to
// crash on startup — empty cache is the correct degraded state.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initRoomPresenceStore,
  shutdownRoomPresenceStore,
  listRoomParticipants,
  getRoomPresenceStatus,
} from '../src/room-presence-store.js'

describe('room-presence-store', () => {
  const originalEnv = { ...process.env }

  beforeEach(async () => {
    await shutdownRoomPresenceStore()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns false from init when SUPABASE_URL is missing', () => {
    delete process.env.SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'irrelevant'
    process.env.REFLECTT_HOST_ID = 'test-host'
    expect(initRoomPresenceStore()).toBe(false)
    expect(listRoomParticipants()).toEqual([])
    expect(getRoomPresenceStatus()).toEqual({ initialized: false, hostId: null, count: 0 })
  })

  it('returns false from init when REFLECTT_HOST_ID is unresolvable', () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'irrelevant'
    delete process.env.REFLECTT_HOST_ID
    delete process.env.HOSTNAME
    expect(initRoomPresenceStore()).toBe(false)
    expect(listRoomParticipants()).toEqual([])
  })
})
