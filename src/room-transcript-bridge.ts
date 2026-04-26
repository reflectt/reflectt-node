// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Transcript Bridge — Browser-STT v0 (room-model-v0.1.1)
 *
 * Push half of the transcript contract: turns `room_transcript_segment`
 * EventBus events (emitted by room-transcript-store) into chat messages
 * on the founding agent's #general channel — same shape as
 * room-event-bridge.ts (slice 3B) and the GitHub webhook bridge.
 *
 * Why: agents pull recent transcript via `room_recent_transcript` MCP
 * tool and `GET /room/transcript`. Pull alone only fires if the agent is
 * awake AND polling. Per kai's room-model rule:
 *   "APIs/MCP for pull, chat/session event delivery for responsiveness"
 * This file is the responsiveness half — once a finalized segment becomes
 * a chat message, it flows to every SSE subscriber including the running
 * founding agent's session.
 *
 * Locked rule (kai's mini-spec refinement #2): humans see interim+final
 * via the channel directly; agents only get FINALS. The store already
 * filters; this bridge inherits that filter for free.
 *
 * Once-per-segment semantics: dedup_key = segment.id (sender-side stable
 * id). Replays of the same segment id (shouldn't happen in v0, but
 * possible if a sender retries) are swallowed by the chatManager dedup
 * ledger.
 */
import { eventBus } from './events.js'
import { chatManager } from './chat.js'
import { listRoomParticipants } from './room-presence-store.js'
import type { RoomTranscriptSegment } from './room-transcript-store.js'

interface BridgeState {
  initialized: boolean
  segmentCount: number
}

const state: BridgeState = {
  initialized: false,
  segmentCount: 0,
}

const LISTENER_ID = 'room-transcript-bridge'

interface RoomTranscriptPayload {
  segment: RoomTranscriptSegment
  hostId: string
}

/**
 * Resolve a participantId to a human display name via the presence store.
 * If the speaker isn't currently in the presence map (race between
 * transcript broadcast and presence sync, or speaker just left), fall
 * back to a short suffix of the userId so the message still has identity.
 */
function resolveSpeakerName(participantId: string, userId: string): string {
  const participants = listRoomParticipants()
  const match = participants.find((p) => p.id === participantId)
  if (match) return match.displayName
  // Best-effort fallback. Short suffix is enough to disambiguate without
  // leaking the full uuid.
  return `human-${userId.slice(0, 6)}`
}

/**
 * Format a finalized segment into a single concise chat line. Kept terse
 * — agents already have AGENTS.md guidance on what to do with transcript
 * context. The line is the trigger; the rule is the response.
 */
function formatSegment(speakerName: string, text: string): string {
  return `🎙️ **${speakerName}**: ${text}`
}

/**
 * Register the EventBus listener. Idempotent. Returns false if already
 * initialized so callers can detect double-init in tests.
 */
export function initRoomTranscriptBridge(): boolean {
  if (state.initialized) return false

  eventBus.on(LISTENER_ID, (event) => {
    if (event.type !== 'room_transcript_segment') return
    const payload = event.data as RoomTranscriptPayload | undefined
    const seg = payload?.segment
    if (!seg || !seg.id || !seg.text || !seg.participantId || !seg.userId) return
    // Defense-in-depth: store already filters to finals, but if the
    // contract ever loosens we still want only finals reaching chat.
    if (!seg.isFinal) return

    state.segmentCount++
    const speakerName = resolveSpeakerName(seg.participantId, seg.userId)
    void chatManager.sendMessage({
      from: 'room',
      content: formatSegment(speakerName, seg.text),
      channel: 'general',
      metadata: {
        source: 'room-event',
        category: 'room-transcript',
        eventType: 'room_transcript_segment',
        participantId: seg.participantId,
        userId: seg.userId,
        hostId: payload?.hostId,
        segmentId: seg.id,
        startedAt: seg.startedAt,
        finalizedAt: seg.finalizedAt,
        // dedup_key: chatManager's ledger swallows repeats. Sender-side
        // segment id is stable; same final segment replayed (shouldn't
        // happen in v0) gets swallowed.
        dedup_key: `room-transcript-${seg.id}`,
      },
    }).catch((err) => {
      console.error(`[room-transcript-bridge] sendMessage failed for ${seg.id}:`, err)
    })
  })

  state.initialized = true
  console.log('[room-transcript-bridge] subscribed to room_transcript_segment → #general')
  return true
}

/** Tear down the listener. Used in tests and on graceful shutdown. */
export function shutdownRoomTranscriptBridge(): void {
  if (!state.initialized) return
  eventBus.off(LISTENER_ID)
  state.initialized = false
  state.segmentCount = 0
}

/** Diagnostics: how many segments have been bridged this process lifetime. */
export function getRoomTranscriptBridgeStatus(): { initialized: boolean; segmentCount: number } {
  return { initialized: state.initialized, segmentCount: state.segmentCount }
}
