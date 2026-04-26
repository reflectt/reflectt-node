// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Event Bridge — slice 3B of room-model-v0.1.1
 *
 * Push half of the room-model contract: turns `room_participant_joined`
 * EventBus events (emitted by slice 2's room-presence-store) into chat
 * messages on the founding agent's #general channel — same shape the
 * GitHub webhook bridge already uses.
 *
 * Why: slice 2 gave agents pull (`room_list_participants` MCP tool +
 * `GET /room/participants`). Slice 3A seeded the greet-on-join rule into
 * AGENTS.md. But a passive seed only fires if the agent is awake AND
 * polling. Per kai's room-model rule (msg-1777169506243):
 *   "APIs/MCP for pull, chat/session event delivery for responsiveness"
 * This file is the responsiveness half — once a join becomes a chat
 * message, it flows to every SSE subscriber including the running
 * founding agent's session ("another message to the LLM" — ryan
 * msg-1777169499379).
 *
 * Greet-once semantics: dedup_key = participant.id (ephemeral session
 * id). Same browser session reconnecting has the same id and the
 * chatManager dedup ledger swallows the repeat. Different session →
 * different id → fresh greet, which matches "you're back, hello again".
 */
import { eventBus } from './events.js'
import { chatManager } from './chat.js'

interface BridgeState {
  initialized: boolean
  joinCount: number
}

const state: BridgeState = {
  initialized: false,
  joinCount: 0,
}

const LISTENER_ID = 'room-event-bridge'

interface RoomJoinPayload {
  participant: {
    id: string
    userId: string
    hostId: string
    displayName: string
    identityColor: string
    device: 'big-screen' | 'desktop' | 'tablet' | 'phone'
    joinedAt: number
    lastBeaconAt: number
    kind: 'human'
  }
  hostId: string
}

/**
 * Format a join into a single concise chat line. Kept terse on purpose —
 * the seed rule in AGENTS.md tells the agent what to do; this is just the
 * trigger they need to see.
 */
function formatJoin(p: RoomJoinPayload['participant']): string {
  return `🚪 **${p.displayName}** joined the room (${p.device})`
}

/**
 * Register the EventBus listener. Idempotent. Returns false if already
 * initialized so callers can detect double-init in tests.
 */
export function initRoomEventBridge(): boolean {
  if (state.initialized) return false

  eventBus.on(LISTENER_ID, (event) => {
    if (event.type !== 'room_participant_joined') return
    const payload = event.data as RoomJoinPayload | undefined
    const p = payload?.participant
    if (!p || p.kind !== 'human' || !p.id || !p.displayName) return

    state.joinCount++
    void chatManager.sendMessage({
      from: 'room',
      content: formatJoin(p),
      channel: 'general',
      metadata: {
        source: 'room-event',
        category: 'room-join',
        eventType: 'room_participant_joined',
        participantId: p.id,
        userId: p.userId,
        hostId: payload?.hostId ?? p.hostId,
        device: p.device,
        // dedup_key: chatManager's ledger swallows repeats with the
        // same key. Using participant.id (ephemeral session id) means
        // greet-once per session; new session → fresh greet.
        dedup_key: `room-join-${p.id}`,
      },
    }).catch((err) => {
      console.error(`[room-event-bridge] sendMessage failed for ${p.id}:`, err)
    })
  })

  state.initialized = true
  console.log('[room-event-bridge] subscribed to room_participant_joined → #general')
  return true
}

/** Tear down the listener. Used in tests and on graceful shutdown. */
export function shutdownRoomEventBridge(): void {
  if (!state.initialized) return
  eventBus.off(LISTENER_ID)
  state.initialized = false
  state.joinCount = 0
}

/** Diagnostics: how many joins have been bridged this process lifetime. */
export function getRoomEventBridgeStatus(): { initialized: boolean; joinCount: number } {
  return { initialized: state.initialized, joinCount: state.joinCount }
}
