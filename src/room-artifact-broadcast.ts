// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Artifact Broadcast — Room Share Snapshot v0 slice 5A
 *
 * Owns a Supabase Realtime channel object on `room:${hostId}` for
 * BROADCASTING the `artifact.shared` event. Mirror of the channel used
 * by room-presence-store (presence diffs) and room-transcript-store
 * (transcript.segment broadcast). Per kai's v0.3 lock (msg-1777191987071):
 * same channel, separate event type — presence diffs stay presence-only,
 * artifact diffs stay artifact-only.
 *
 * Direction: cloud is the SUBSCRIBER for `artifact.shared` (5B builds
 * the cross-participant strip); node is the BROADCASTER, called from
 * `POST /room/artifacts` after the original PNG + thumbnail land.
 *
 * Why a separate file from room-transcript-store: that file owns its
 * channel for a different event (transcript.segment) AND maintains its
 * own ring buffer state. Conflating responsibilities would make the
 * shutdown path tangled. Supabase shares the underlying WebSocket
 * across channel objects so the wire-cost is the same.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

const BROADCAST_EVENT = 'artifact.shared'

interface State {
  channel: RealtimeChannel | null
  client: SupabaseClient | null
  hostId: string | null
  initialized: boolean
  sentCount: number
}

const state: State = {
  channel: null,
  client: null,
  hostId: null,
  initialized: false,
  sentCount: 0,
}

function resolveHostId(): string | null {
  const hostId = process.env.REFLECTT_HOST_ID || process.env.HOSTNAME
  if (!hostId || hostId === 'unknown') return null
  return hostId
}

/**
 * Initialize the broadcaster. Idempotent. Returns false if Supabase env
 * or REFLECTT_HOST_ID is missing — `broadcastArtifactShared` becomes a
 * no-op (the rest of the node still boots).
 */
export function initRoomArtifactBroadcast(): boolean {
  if (state.initialized) return true

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN
  const hostId = resolveHostId()

  if (!url || !key) {
    console.warn('[room-artifact-broadcast] Supabase env missing — broadcasts disabled')
    return false
  }
  if (!hostId) {
    console.warn('[room-artifact-broadcast] REFLECTT_HOST_ID unresolvable — broadcasts disabled')
    return false
  }

  state.hostId = hostId
  state.client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const channel = state.client.channel(`room:${hostId}`)
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[room-artifact-broadcast] subscribed to room:${hostId} (broadcaster for ${BROADCAST_EVENT})`)
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[room-artifact-broadcast] channel ${status} for room:${hostId}`)
    }
  })
  state.channel = channel
  state.initialized = true
  return true
}

export interface ArtifactSharedBroadcast {
  artifactId: string
  kind: string
  sharedBy: string
  sharedByDisplayName: string
  createdAt: number
  url: string
  thumbnailUrl: string
}

/**
 * Send an `artifact.shared` broadcast on the room channel. Best-effort:
 * if the broadcaster wasn't initialized (env missing) or send fails,
 * the chat-bridge push and HTTP listing path still work — the realtime
 * surface is the only one that misses the live update. This matches the
 * "transport is best-effort" posture of presence + transcript.
 */
export async function broadcastArtifactShared(payload: ArtifactSharedBroadcast): Promise<void> {
  if (!state.initialized || !state.channel) return
  try {
    await state.channel.send({ type: 'broadcast', event: BROADCAST_EVENT, payload })
    state.sentCount++
  } catch (err) {
    console.warn(`[room-artifact-broadcast] send failed for ${payload.artifactId}:`, err)
  }
}

/** Tear down. Used in tests and on graceful shutdown. */
export async function shutdownRoomArtifactBroadcast(): Promise<void> {
  if (state.channel && state.client) {
    try { await state.channel.unsubscribe() } catch { /* non-fatal */ }
    try { await state.client.removeChannel(state.channel) } catch { /* non-fatal */ }
  }
  state.channel = null
  state.client = null
  state.hostId = null
  state.initialized = false
  state.sentCount = 0
}

export function getRoomArtifactBroadcastStatus(): {
  initialized: boolean
  hostId: string | null
  sentCount: number
} {
  return {
    initialized: state.initialized,
    hostId: state.hostId,
    sentCount: state.sentCount,
  }
}
