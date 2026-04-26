// Slice 3B regression: when room_participant_joined fires on the EventBus,
// the bridge must call chatManager.sendMessage with the right shape so the
// founding agent receives "another message to the LLM" via the existing
// SSE message_posted channel. Greet-once means same participant id should
// only produce one user-visible chat message even on event re-emit.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock chatManager BEFORE importing the bridge so the bridge picks up
// the mock instead of the real chatManager. vi.mock is hoisted above
// imports, so we must use vi.hoisted to keep the mock fn accessible.
const { sendMessageMock } = vi.hoisted(() => ({
  sendMessageMock: vi.fn(async (msg: any) => ({
    ...msg,
    id: 'mock-msg-id',
    timestamp: Date.now(),
    reactions: {},
  })),
}))

vi.mock('../src/chat.js', () => ({
  chatManager: {
    sendMessage: sendMessageMock,
  },
}))

import { eventBus } from '../src/events.js'
import {
  initRoomEventBridge,
  shutdownRoomEventBridge,
  getRoomEventBridgeStatus,
} from '../src/room-event-bridge.js'

const SAMPLE_PARTICIPANT = {
  kind: 'human' as const,
  id: 'session-abc-123',
  userId: 'user-xyz',
  hostId: 'host-1',
  displayName: 'Ryan',
  identityColor: '#ff8800',
  device: 'big-screen' as const,
  joinedAt: Date.now(),
  lastBeaconAt: Date.now(),
}

function emitJoin(participant = SAMPLE_PARTICIPANT, hostId = 'host-1') {
  eventBus.emit({
    id: `room-join-${participant.id}-${Date.now()}`,
    type: 'room_participant_joined',
    timestamp: Date.now(),
    data: { participant, hostId },
  })
}

describe('room-event-bridge', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    shutdownRoomEventBridge()
  })

  afterEach(() => {
    shutdownRoomEventBridge()
  })

  it('initRoomEventBridge() returns true on first call, false on re-init', () => {
    expect(initRoomEventBridge()).toBe(true)
    expect(initRoomEventBridge()).toBe(false)
    expect(getRoomEventBridgeStatus().initialized).toBe(true)
  })

  it('forwards a join into chatManager.sendMessage with the right shape', () => {
    initRoomEventBridge()
    emitJoin()

    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    const call = sendMessageMock.mock.calls[0][0]
    expect(call.from).toBe('room')
    expect(call.channel).toBe('general')
    expect(call.content).toContain('Ryan')
    expect(call.content).toContain('big-screen')
    expect(call.metadata.source).toBe('room-event')
    expect(call.metadata.participantId).toBe('session-abc-123')
    expect(call.metadata.dedup_key).toBe('room-join-session-abc-123')
    expect(call.metadata.hostId).toBe('host-1')
  })

  it('ignores non-human payloads and malformed events', () => {
    initRoomEventBridge()
    eventBus.emit({
      id: 'bad-1', type: 'room_participant_joined', timestamp: Date.now(),
      data: { participant: { kind: 'agent', id: 'a-1', displayName: 'bot' }, hostId: 'host-1' },
    })
    eventBus.emit({
      id: 'bad-2', type: 'room_participant_joined', timestamp: Date.now(),
      data: { participant: { kind: 'human', id: '', displayName: 'Anon' }, hostId: 'host-1' },
    })
    eventBus.emit({
      id: 'bad-3', type: 'room_participant_joined', timestamp: Date.now(),
      data: undefined,
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('ignores unrelated event types', () => {
    initRoomEventBridge()
    eventBus.emit({
      id: 'unrelated', type: 'message_posted', timestamp: Date.now(),
      data: { from: 'noise', content: 'noise', channel: 'general' },
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('uses participant id as dedup_key so reconnects with the same id collapse downstream', () => {
    initRoomEventBridge()
    emitJoin()
    emitJoin() // same participant id — bridge still calls sendMessage twice
    expect(sendMessageMock).toHaveBeenCalledTimes(2)
    // Both calls share the dedup_key — chatManager's suppression ledger
    // is what enforces greet-once at the user-visible layer.
    expect(sendMessageMock.mock.calls[0][0].metadata.dedup_key).toBe(
      sendMessageMock.mock.calls[1][0].metadata.dedup_key
    )
    expect(getRoomEventBridgeStatus().joinCount).toBe(2)
  })

  it('shutdown unsubscribes — no further calls after teardown', () => {
    initRoomEventBridge()
    emitJoin()
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    shutdownRoomEventBridge()
    expect(getRoomEventBridgeStatus().initialized).toBe(false)
    emitJoin()
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })
})
