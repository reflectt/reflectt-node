// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Transcript Store — Browser-STT v0 (room-model-v0.1.1)
 *
 * Server-side mirror of the Supabase Realtime broadcast cloud's
 * `useRoomTranscript` hook publishes to. Subscribes to the same
 * `room:${hostId}` channel slice 2's room-presence-store rides on, but
 * listens for the `transcript.segment` broadcast event rather than
 * presence diffs.
 *
 * What this is:
 *   - Ring buffer of FINAL transcript segments only (kai's locked rule:
 *     humans see interim+final via the channel, agents only see finals)
 *   - Truth-cache, not a source of truth — the channel is truth; if it
 *     drops, the buffer empties and that's the contract
 *   - Slice scope: 60-second rolling window per host (one host per node,
 *     so per-process)
 *
 * What this is NOT:
 *   - Durable transcript history (that's slice 5 with LiveKit egress)
 *   - A retry/resend layer (browser-STT v0 is best-effort; lost segments
 *     are lost)
 *   - A second source of truth — the channel is truth
 *
 * THIS IS A BRIDGE. Server-side STT (Deepgram/AssemblyAI via LiveKit
 * egress) replaces this in slice 5. Until then, browser-STT v0 buys us a
 * real, mic-derived transcript with zero new infra.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { eventBus } from './events.js'

const BROADCAST_EVENT = 'transcript.segment'
// Rolling window: how far back we keep finalized segments for the
// `room_recent_transcript` MCP tool and `GET /room/transcript` endpoint.
// 60s matches the spec — enough for "what did I just miss?" recall, short
// enough that the buffer stays tiny and ephemeral by feel.
const RING_BUFFER_WINDOW_MS = 60_000
// Cap segments held to defend against pathological broadcast storms. At a
// natural ~1 segment/sec per active speaker, 200 covers ~3 minutes of 1-2
// concurrent speakers — comfortably above the 60s window.
const MAX_BUFFERED_SEGMENTS = 200

// Mirror of RoomTranscriptSegment in apps/web/src/app/presence/use-room-transcript.ts.
// Wire-format from the channel; `receivedAt` is restamped on node arrival
// so query ordering is consistent with our local clock.
export interface RoomTranscriptSegment {
  participantId: string
  userId: string
  id: string
  text: string
  isFinal: boolean
  startedAt: number
  finalizedAt?: number
  receivedAt: number
}

interface StoreState {
  segments: RoomTranscriptSegment[] // sorted by receivedAt asc; finals only
  channel: RealtimeChannel | null
  client: SupabaseClient | null
  hostId: string | null
  initialized: boolean
  receivedCount: number             // diagnostics: total finals seen this process lifetime
}

const state: StoreState = {
  segments: [],
  channel: null,
  client: null,
  hostId: null,
  initialized: false,
  receivedCount: 0,
}

function resolveHostId(): string | null {
  const hostId = process.env.REFLECTT_HOST_ID || process.env.HOSTNAME
  if (!hostId || hostId === 'unknown') return null
  return hostId
}

function pruneOldSegments(now: number): void {
  const cutoff = now - RING_BUFFER_WINDOW_MS
  // Trim from the front (sorted asc by receivedAt). Two-pass is fine at
  // this size; we don't need a deque.
  let drop = 0
  while (drop < state.segments.length && state.segments[drop]!.receivedAt < cutoff) {
    drop++
  }
  if (drop > 0) state.segments.splice(0, drop)
  // Cap defense against broadcast storms — keep newest.
  if (state.segments.length > MAX_BUFFERED_SEGMENTS) {
    state.segments.splice(0, state.segments.length - MAX_BUFFERED_SEGMENTS)
  }
}

function isValidSegment(raw: unknown): raw is RoomTranscriptSegment {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  return (
    typeof r.participantId === 'string' &&
    typeof r.userId === 'string' &&
    typeof r.id === 'string' &&
    typeof r.text === 'string' &&
    typeof r.isFinal === 'boolean' &&
    typeof r.startedAt === 'number'
  )
}

/**
 * Initialize the store. Idempotent. Returns false if Supabase env or
 * REFLECTT_HOST_ID is missing — the rest of the node still boots.
 *
 * Opens a SECOND channel object on the same `room:${hostId}` name as
 * room-presence-store. Supabase shares the underlying WebSocket across
 * channel objects, so this is the same transport — separate channel
 * objects are just for clean responsibility split (presence vs transcript
 * broadcast). Same shape we use on the cloud side.
 */
export function initRoomTranscriptStore(): boolean {
  if (state.initialized) return true

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN
  const hostId = resolveHostId()

  if (!url || !key) {
    console.warn('[room-transcript] Supabase env missing — store stays empty')
    return false
  }
  if (!hostId) {
    console.warn('[room-transcript] REFLECTT_HOST_ID unresolvable — store stays empty')
    return false
  }

  state.hostId = hostId
  state.client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const channel = state.client.channel(`room:${hostId}`)

  channel.on('broadcast', { event: BROADCAST_EVENT }, (msg: { payload?: unknown }) => {
    const payload = msg.payload
    if (!isValidSegment(payload)) return
    // Locked rule (kai #2): humans see interim+final via the channel
    // directly; agents only get finals. Drop interims at the buffer edge.
    if (!payload.isFinal) return

    const now = Date.now()
    const seg: RoomTranscriptSegment = {
      participantId: payload.participantId,
      userId: payload.userId,
      id: payload.id,
      text: payload.text,
      isFinal: true,
      startedAt: payload.startedAt,
      ...(typeof payload.finalizedAt === 'number' ? { finalizedAt: payload.finalizedAt } : {}),
      receivedAt: now,
    }

    state.segments.push(seg)
    state.receivedCount++
    pruneOldSegments(now)

    // Push half: emit on the eventBus so room-transcript-bridge can turn
    // this into a chat message for the founding agent. Same pattern as
    // room-presence-store → room-event-bridge.
    eventBus.emit({
      id: `room-transcript-${seg.id}`,
      type: 'room_transcript_segment',
      timestamp: now,
      data: { segment: seg, hostId },
    })
  })

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[room-transcript] subscribed to room:${hostId} (${BROADCAST_EVENT})`)
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[room-transcript] channel ${status} for room:${hostId}`)
    }
  })

  state.channel = channel
  state.initialized = true
  return true
}

/** Tear down. Used in tests and on graceful shutdown. */
export async function shutdownRoomTranscriptStore(): Promise<void> {
  if (state.channel && state.client) {
    try { await state.channel.unsubscribe() } catch { /* non-fatal */ }
    try { await state.client.removeChannel(state.channel) } catch { /* non-fatal */ }
  }
  state.channel = null
  state.client = null
  state.hostId = null
  state.initialized = false
  state.segments = []
  state.receivedCount = 0
}

/**
 * Read recent finalized segments. `sinceMs` is a wall-clock ms cutoff
 * (e.g. `Date.now() - 30_000` for last 30s); when omitted, returns the
 * full ring (last `RING_BUFFER_WINDOW_MS`). Sorted by receivedAt asc so
 * callers get them in arrival order.
 */
export function getRecentTranscript(sinceMs?: number): RoomTranscriptSegment[] {
  pruneOldSegments(Date.now())
  if (typeof sinceMs !== 'number') return [...state.segments]
  return state.segments.filter((s) => s.receivedAt >= sinceMs)
}

/** Diagnostics for /room/transcript?debug=1 and tests. */
export function getRoomTranscriptStatus(): {
  initialized: boolean
  hostId: string | null
  bufferedCount: number
  totalReceived: number
  windowMs: number
} {
  pruneOldSegments(Date.now())
  return {
    initialized: state.initialized,
    hostId: state.hostId,
    bufferedCount: state.segments.length,
    totalReceived: state.receivedCount,
    windowMs: RING_BUFFER_WINDOW_MS,
  }
}
