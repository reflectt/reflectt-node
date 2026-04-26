// Browser-STT v0 routing regression: when room_transcript_segment fires on
// the EventBus, the bridge must call chatManager.sendMessage with `to:
// <defaultAgent>` and an @-mention in the body so the OpenClaw plugin's
// handleInbound dispatch gate routes the segment to the agent. Mirrors the
// #1304 fix shape for room-event-bridge.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setTestRoles } from '../src/assignment.js'

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
  initRoomTranscriptBridge,
  shutdownRoomTranscriptBridge,
  getRoomTranscriptBridgeStatus,
} from '../src/room-transcript-bridge.js'

const SAMPLE_SEGMENT = {
  id: 'seg-abc-123',
  participantId: 'session-abc-123',
  userId: 'user-xyz',
  text: 'hello team',
  isFinal: true,
  startedAt: Date.now() - 1500,
  finalizedAt: Date.now(),
}

function emitSegment(segment = SAMPLE_SEGMENT, hostId = 'host-1') {
  eventBus.emit({
    id: `room-transcript-${segment.id}-${Date.now()}`,
    type: 'room_transcript_segment',
    timestamp: Date.now(),
    data: { segment, hostId },
  })
}

describe('room-transcript-bridge', () => {
  beforeEach(() => {
    sendMessageMock.mockClear()
    shutdownRoomTranscriptBridge()
    // mj2z6nzjz contract: bridge resolves the founding agent via
    // getAgentRoles()[0]?.name and routes there. Pin the test roster so
    // the @-mention assertions are deterministic.
    setTestRoles([
      { name: 'genesis', role: 'founding', affinityTags: [], wipCap: 1 },
    ])
  })

  afterEach(() => {
    shutdownRoomTranscriptBridge()
    setTestRoles(null)
  })

  it('initRoomTranscriptBridge() returns true on first call, false on re-init', () => {
    expect(initRoomTranscriptBridge()).toBe(true)
    expect(initRoomTranscriptBridge()).toBe(false)
    expect(getRoomTranscriptBridgeStatus().initialized).toBe(true)
  })

  it('forwards a final segment with `to: <defaultAgent>` + @-mention so plugin routes it', () => {
    initRoomTranscriptBridge()
    emitSegment()

    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    const call = sendMessageMock.mock.calls[0][0]
    expect(call.from).toBe('room')
    expect(call.to).toBe('genesis')
    expect(call.channel).toBe('general')
    expect(call.content).toContain('@genesis')
    expect(call.content).toContain('hello team')
    expect(call.metadata.source).toBe('room-event')
    expect(call.metadata.category).toBe('room-transcript')
    expect(call.metadata.eventType).toBe('room_transcript_segment')
    expect(call.metadata.segmentId).toBe('seg-abc-123')
    expect(call.metadata.participantId).toBe('session-abc-123')
    expect(call.metadata.userId).toBe('user-xyz')
    expect(call.metadata.hostId).toBe('host-1')
    expect(call.metadata.dedup_key).toBe('room-transcript-seg-abc-123')
  })

  it('drops non-final segments and malformed events', () => {
    initRoomTranscriptBridge()
    eventBus.emit({
      id: 'bad-1', type: 'room_transcript_segment', timestamp: Date.now(),
      data: { segment: { ...SAMPLE_SEGMENT, isFinal: false }, hostId: 'host-1' },
    })
    eventBus.emit({
      id: 'bad-2', type: 'room_transcript_segment', timestamp: Date.now(),
      data: { segment: { ...SAMPLE_SEGMENT, id: '' }, hostId: 'host-1' },
    })
    eventBus.emit({
      id: 'bad-3', type: 'room_transcript_segment', timestamp: Date.now(),
      data: { segment: { ...SAMPLE_SEGMENT, text: '' }, hostId: 'host-1' },
    })
    eventBus.emit({
      id: 'bad-4', type: 'room_transcript_segment', timestamp: Date.now(),
      data: undefined,
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('ignores unrelated event types', () => {
    initRoomTranscriptBridge()
    eventBus.emit({
      id: 'unrelated', type: 'message_posted', timestamp: Date.now(),
      data: { from: 'noise', content: 'noise', channel: 'general' },
    })
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('uses segment id as dedup_key so retries collapse downstream', () => {
    initRoomTranscriptBridge()
    emitSegment()
    emitSegment() // same segment id — bridge still calls sendMessage twice
    expect(sendMessageMock).toHaveBeenCalledTimes(2)
    expect(sendMessageMock.mock.calls[0][0].metadata.dedup_key).toBe(
      sendMessageMock.mock.calls[1][0].metadata.dedup_key
    )
    expect(getRoomTranscriptBridgeStatus().segmentCount).toBe(2)
  })

  it('shutdown unsubscribes — no further calls after teardown', () => {
    initRoomTranscriptBridge()
    emitSegment()
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
    shutdownRoomTranscriptBridge()
    expect(getRoomTranscriptBridgeStatus().initialized).toBe(false)
    emitSegment()
    expect(sendMessageMock).toHaveBeenCalledTimes(1)
  })

  it('drops the segment if no default agent is configured', () => {
    initRoomTranscriptBridge()
    setTestRoles([])
    emitSegment()
    expect(sendMessageMock).not.toHaveBeenCalled()
    expect(getRoomTranscriptBridgeStatus().segmentCount).toBe(0)
  })
})
