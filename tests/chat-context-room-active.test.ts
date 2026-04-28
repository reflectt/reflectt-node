// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * /chat/context/:agent — room-active signal injection.
 *
 * The reflectt-channel OpenClaw plugin pulls compact_text from this endpoint
 * and drops it into the agent's per-turn prompt (see public/docs.md:356,
 * "Compact deduplicated chat for agent context injection. Always slim.").
 *
 * Behavior under test: when listRoomParticipants() reports any human on this
 * host, the endpoint surfaces a single-line ROOM STATUS marker inside
 * compact_text AND a structured `room_status.in_session: true` field.
 * Empty room → both omit / report false. Locked shape (kai/link
 * msg-1777356030100, msg-1777356036716): tiny semantic signal, no
 * participant roster blob.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'

const listRoomParticipantsMock = vi.fn<[], Array<{ id: string }>>()

vi.mock('../src/room-presence-store.js', () => ({
  listRoomParticipants: () => listRoomParticipantsMock(),
  getRoomPresenceStatus: () => ({
    initialized: false,
    hostId: null,
    count: listRoomParticipantsMock().length,
  }),
  initRoomPresenceStore: () => false,
  shutdownRoomPresenceStore: async () => {},
}))

const { createServer } = await import('../src/server.js')

describe('/chat/context/:agent — room-active signal', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-room-active-${Date.now()}-${Math.random().toString(36).slice(2)}`
    listRoomParticipantsMock.mockReset()
    listRoomParticipantsMock.mockReturnValue([])
    app = await createServer()
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
    listRoomParticipantsMock.mockReset()
  })

  it('injects ROOM STATUS into compact_text and sets room_status.in_session=true when a human is present', async () => {
    listRoomParticipantsMock.mockReturnValue([{ id: 'human-session-abc' }])

    const res = await app.inject({
      method: 'GET',
      url: '/chat/context/compass?compact=1&max_chars=2000',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // Structured field for any future caller (cloud sync, debug UI, etc.).
    expect(body.room_status).toEqual({ in_session: true })

    // The line that lands in compass's per-turn prompt.
    expect(body.compact_text).toContain('ROOM STATUS:')
    expect(body.compact_text).toContain('active room with a human')
    expect(body.compact_text).toContain('speak as a meeting participant')

    // Tiny on purpose — the signal must be one line, not a roster dump.
    const roomStatusLines = body.compact_text
      .split('\n')
      .filter((l: string) => l.startsWith('ROOM STATUS:'))
    expect(roomStatusLines).toHaveLength(1)
  })

  it('omits ROOM STATUS from compact_text and reports in_session=false when the room is empty', async () => {
    listRoomParticipantsMock.mockReturnValue([])

    const res = await app.inject({
      method: 'GET',
      url: '/chat/context/compass?compact=1&max_chars=2000',
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    expect(body.room_status).toEqual({ in_session: false })
    expect(body.compact_text).not.toContain('ROOM STATUS:')
    expect(body.compact_text).not.toContain('active room with a human')
  })

  it('still emits room_status (without compact_text) for non-strict callers', async () => {
    listRoomParticipantsMock.mockReturnValue([{ id: 'human-x' }])

    const res = await app.inject({ method: 'GET', url: '/chat/context/compass' })
    const body = JSON.parse(res.body)

    expect(body.room_status).toEqual({ in_session: true })
    expect(body.compact_text).toBeUndefined()
  })
})
