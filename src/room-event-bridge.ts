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
import { getAgentRoles } from './assignment.js'

interface BridgeState {
  initialized: boolean
  joinCount: number
  artifactCount: number
}

const state: BridgeState = {
  initialized: false,
  joinCount: 0,
  artifactCount: 0,
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

interface RoomArtifactSharedPayload {
  artifact: {
    id: string
    kind: string | null
    name: string
    mimeType: string
    sizeBytes: number
    createdAt: number
    sharedBy: string | null
    sharedByDisplayName: string | null
    dimensions: { width: number; height: number } | null
    url: string
    thumbnailUrl: string
  }
  by: string
  hostId: string
}

// Resolve the founding/default agent for this host. Same pattern used
// throughout server.ts (getAgentRoles()[0]?.name) — first entry in
// TEAM-ROLES.yaml. Room-originated events route here so the OpenClaw
// dispatch path (which gates on body @mention) actually wakes someone.
function resolveDefaultAgent(): string | null {
  return getAgentRoles()[0]?.name ?? null
}

// Why @-mention in the body even though we also set `to:` —
// the live OpenClaw plugin's handleInbound (reflectt-channel index.ts)
// gates dispatch on body @-mentions and ignores the message `to:` field.
// Without an @-mention the plugin drops the message and the agent never
// sees it. `to:` still matters for node-side inbox priority (DM path),
// so we set both.

function formatJoin(p: RoomJoinPayload['participant'], defaultAgent: string): string {
  return `@${defaultAgent} 🚪 **${p.displayName}** joined the room (${p.device})`
}

// Per-kind dispatch — v0 only handles `kind='snapshot'`. Future kinds
// (recordings, agent outputs) add their own one-liner here without
// changing the event name. Body stays utilitarian (kai lock
// msg-1777191217389: "thin factual notification, not narration") — the
// actionable context (url, thumbnailUrl, dimensions, sharedByDisplayName)
// rides in metadata for the agent to pull on demand.
function formatArtifactShared(p: RoomArtifactSharedPayload, defaultAgent: string): string | null {
  const who = p.artifact.sharedByDisplayName ?? 'Someone'
  switch (p.artifact.kind) {
    case 'snapshot': return `@${defaultAgent} 📸 **${who}** shared a snapshot`
    default: return null
  }
}

/**
 * Register the EventBus listener. Idempotent. Returns false if already
 * initialized so callers can detect double-init in tests.
 */
export function initRoomEventBridge(): boolean {
  if (state.initialized) return false

  eventBus.on(LISTENER_ID, (event) => {
    if (event.type === 'room_participant_joined') {
      const payload = event.data as RoomJoinPayload | undefined
      const p = payload?.participant
      if (!p || p.kind !== 'human' || !p.id || !p.displayName) return

      const defaultAgent = resolveDefaultAgent()
      if (!defaultAgent) {
        console.warn(`[room-event-bridge] no default agent (TEAM-ROLES empty) — dropping join for ${p.id}`)
        return
      }

      state.joinCount++
      void chatManager.sendMessage({
        from: 'room',
        to: defaultAgent,
        content: formatJoin(p, defaultAgent),
        channel: 'general',
        metadata: {
          source: 'room-event',
          category: 'room-join',
          eventType: 'room_participant_joined',
          participantId: p.id,
          userId: p.userId,
          hostId: payload?.hostId ?? p.hostId,
          device: p.device,
          displayName: p.displayName,
          // dedup_key: chatManager's ledger swallows repeats with the
          // same key. Using participant.id (ephemeral session id) means
          // greet-once per session; new session → fresh greet.
          dedup_key: `room-join-${p.id}`,
        },
      }).catch((err) => {
        console.error(`[room-event-bridge] sendMessage failed for ${p.id}:`, err)
      })
      return
    }

    if (event.type === 'room_artifact_shared') {
      const payload = event.data as RoomArtifactSharedPayload | undefined
      if (!payload?.artifact?.id || !payload.artifact.kind) return

      const defaultAgent = resolveDefaultAgent()
      if (!defaultAgent) {
        console.warn(`[room-event-bridge] no default agent (TEAM-ROLES empty) — dropping artifact ${payload.artifact.id}`)
        return
      }

      const line = formatArtifactShared(payload, defaultAgent)
      // Unknown kind in v0 → silent. Future kinds add a formatter case
      // when they ship their own slice. We do NOT post a generic
      // "an artifact was shared" line — that would lie about what
      // the room can render.
      if (!line) return

      state.artifactCount++
      void chatManager.sendMessage({
        from: 'room',
        to: defaultAgent,
        content: line,
        channel: 'general',
        metadata: {
          source: 'room-event',
          category: 'room-artifact',
          eventType: 'room_artifact_shared',
          artifactId: payload.artifact.id,
          kind: payload.artifact.kind,
          sharedBy: payload.by,
          sharedByDisplayName: payload.artifact.sharedByDisplayName,
          hostId: payload.hostId,
          url: payload.artifact.url,
          thumbnailUrl: payload.artifact.thumbnailUrl,
          dimensions: payload.artifact.dimensions,
          mimeType: payload.artifact.mimeType,
          sizeBytes: payload.artifact.sizeBytes,
          // Artifacts have stable unique ids — strict per-id dedup so
          // a duplicate emit (rare but possible on retry) doesn't
          // double-post. Unlike `room-join-${id}` (per-session) this
          // is per-artifact-ever.
          dedup_key: `room-artifact-${payload.artifact.id}`,
        },
      }).catch((err) => {
        console.error(`[room-event-bridge] sendMessage failed for artifact ${payload.artifact.id}:`, err)
      })
    }
  })

  state.initialized = true
  console.log('[room-event-bridge] subscribed to room_participant_joined + room_artifact_shared → #general')
  return true
}

/** Tear down the listener. Used in tests and on graceful shutdown. */
export function shutdownRoomEventBridge(): void {
  if (!state.initialized) return
  eventBus.off(LISTENER_ID)
  state.initialized = false
  state.joinCount = 0
  state.artifactCount = 0
}

/** Diagnostics: counts of room events this bridge has translated into chat. */
export function getRoomEventBridgeStatus(): { initialized: boolean; joinCount: number; artifactCount: number } {
  return { initialized: state.initialized, joinCount: state.joinCount, artifactCount: state.artifactCount }
}
