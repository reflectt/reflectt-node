// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Card Store — reply-card backfill v0
 *
 * Server-side mirror of the asker's `roomCard.publish()` fan-out from the
 * web side (apps/web/src/app/presence/use-room-card.ts). Subscribes to the
 * same `room:${hostId}` Realtime channel as room-presence-store and
 * room-transcript-store, listens for the `card.fanout` broadcast event
 * (the asker tab emits it whenever a fresh `canvas_message` SSE lands on
 * the asker's screen), and ring-buffers the recent payloads.
 *
 * Why: live `card.fanout` is asker→peers Realtime broadcast — anyone who
 * joins the room AFTER a reply landed never sees the card. Snapshots
 * already have a backfill path (room-artifact-store + GET /room/artifacts);
 * reply cards did not. Late joiners walked into a blank canvas with avatars
 * and no idea what the meeting was just about. This store is the smallest
 * cut that closes that gap, mirroring the artifact pattern exactly.
 *
 * Per kai's locks (msg-1777285834854):
 *   - bounded last-N
 *   - fetch on mount
 *   - broadcast/re-fetch on new event
 *   - same `serverTs` identity used for live dedupe
 *   - reply cards only (NOT transcript)
 *   - bounded ephemeral, NOT permanent history
 *   - same peer/asker ownership rules — wire shape includes
 *     senderParticipantId so the client can drop self-broadcasts on
 *     backfill the same way it does on live receive
 *   - if backfill can't be tied to the same reply identity, don't show it
 *     — payload MUST carry serverTs and id; otherwise rejected at the
 *     buffer edge
 *
 * What this is NOT:
 *   - Durable history (the eviction window is short by intent)
 *   - A second source of truth — the channel is truth; this is a cache
 *   - A retry/resend layer — best-effort like the live broadcast
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

const BROADCAST_EVENT = 'card.fanout'
// Rolling window: how far back we keep reply cards for backfill. Cards are
// sparse (one per agent reply, not per-spoken-segment) so this is wider
// than the transcript ring — but still bounded, ephemeral by feel. 10min
// covers "what was happening when I joined" without becoming a meeting
// log.
const RING_BUFFER_WINDOW_MS = 10 * 60_000
// Cap entries held to defend against pathological broadcast storms. Cards
// at natural cadence are 1-3/min; 50 covers ~15-50 minutes of activity,
// well above the time window.
const MAX_BUFFERED_CARDS = 50

// Mirror of PeerCanvasCardPayload in apps/web/src/app/presence/use-room-card.ts.
// Wire format from the channel.
export interface RoomCardPayload {
  id: string
  type: string
  agentId: string
  agentColor: string
  query?: string
  ttl?: number
  data: Record<string, unknown>
  arrivedAt: number
  serverTs: number
}

// What the node stores and returns. Same envelope shape as the live
// broadcast so the client can apply the SAME drop-self / dedupe logic on
// backfill that it already applies on live receive.
export interface RoomCardEntry {
  senderParticipantId: string
  senderUserId: string
  card: RoomCardPayload
  receivedAt: number   // node clock — query ordering uses this
}

interface StoreState {
  entries: RoomCardEntry[]   // sorted by receivedAt asc
  channel: RealtimeChannel | null
  client: SupabaseClient | null
  hostId: string | null
  initialized: boolean
  receivedCount: number      // diagnostics
}

const state: StoreState = {
  entries: [],
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

function pruneOldEntries(now: number): void {
  const cutoff = now - RING_BUFFER_WINDOW_MS
  let drop = 0
  while (drop < state.entries.length && state.entries[drop]!.receivedAt < cutoff) {
    drop++
  }
  if (drop > 0) state.entries.splice(0, drop)
  if (state.entries.length > MAX_BUFFERED_CARDS) {
    state.entries.splice(0, state.entries.length - MAX_BUFFERED_CARDS)
  }
}

function isValidCardPayload(raw: unknown): raw is RoomCardPayload {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    typeof r.type === 'string' &&
    typeof r.agentId === 'string' &&
    typeof r.agentColor === 'string' &&
    typeof r.serverTs === 'number' &&
    typeof r.arrivedAt === 'number' &&
    !!r.data && typeof r.data === 'object'
  )
}

function isValidEnvelope(raw: unknown): raw is { senderParticipantId: string; senderUserId: string; card: RoomCardPayload } {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  if (typeof r.senderParticipantId !== 'string' || r.senderParticipantId.length === 0) return false
  if (typeof r.senderUserId !== 'string' || r.senderUserId.length === 0) return false
  if (!isValidCardPayload(r.card)) return false
  return true
}

/**
 * Initialize the store. Idempotent. Returns false if Supabase env or
 * REFLECTT_HOST_ID is missing — the rest of the node still boots.
 *
 * Opens a SECOND channel object on the same `room:${hostId}` name as
 * presence/transcript stores. Supabase shares the underlying WebSocket
 * across channel objects, so this is the same transport — separate
 * channel objects for clean responsibility split.
 */
export function initRoomCardStore(): boolean {
  if (state.initialized) return true

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN
  const hostId = resolveHostId()

  if (!url || !key) {
    console.warn('[room-card] Supabase env missing — store stays empty')
    return false
  }
  if (!hostId) {
    console.warn('[room-card] REFLECTT_HOST_ID unresolvable — store stays empty')
    return false
  }

  state.hostId = hostId
  state.client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const channel = state.client.channel(`room:${hostId}`)

  channel.on('broadcast', { event: BROADCAST_EVENT }, (msg: { payload?: unknown }) => {
    const payload = msg.payload
    if (!isValidEnvelope(payload)) return

    const now = Date.now()
    const entry: RoomCardEntry = {
      senderParticipantId: payload.senderParticipantId,
      senderUserId: payload.senderUserId,
      card: payload.card,
      receivedAt: now,
    }

    // Dedup HARD by serverTs — kai's lock: one reply = one meeting event.
    // If a duplicate arrives (e.g. broadcast retransmit), replace the
    // existing entry rather than stack so eviction stays clean.
    const existingIdx = state.entries.findIndex((e) => e.card.serverTs === entry.card.serverTs)
    if (existingIdx >= 0) {
      state.entries[existingIdx] = entry
    } else {
      state.entries.push(entry)
    }
    state.receivedCount++
    pruneOldEntries(now)
  })

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      console.log(`[room-card] subscribed to room:${hostId} (${BROADCAST_EVENT})`)
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[room-card] channel ${status} for room:${hostId}`)
    }
  })

  state.channel = channel
  state.initialized = true
  return true
}

/** Tear down. Used in tests and on graceful shutdown. */
export async function shutdownRoomCardStore(): Promise<void> {
  if (state.channel && state.client) {
    try { await state.channel.unsubscribe() } catch { /* non-fatal */ }
    try { await state.client.removeChannel(state.channel) } catch { /* non-fatal */ }
  }
  state.channel = null
  state.client = null
  state.hostId = null
  state.initialized = false
  state.entries = []
  state.receivedCount = 0
}

/**
 * Read recent reply cards. `sinceMs` is a wall-clock ms cutoff (e.g.
 * `Date.now() - 60_000` for last minute); when omitted, returns the full
 * ring (last `RING_BUFFER_WINDOW_MS`). Sorted by receivedAt asc so callers
 * get them in arrival order; the client sorts by arrivedAt for display.
 *
 * Optional `limit` caps the result set from the END (newest entries) so a
 * caller can pull "last N" without scanning the whole window.
 */
export function getRecentCards(opts?: { sinceMs?: number; limit?: number }): RoomCardEntry[] {
  pruneOldEntries(Date.now())
  let result = state.entries
  if (typeof opts?.sinceMs === 'number') {
    const cutoff = opts.sinceMs
    result = result.filter((e) => e.receivedAt >= cutoff)
  } else {
    result = [...result]
  }
  if (typeof opts?.limit === 'number' && opts.limit > 0 && result.length > opts.limit) {
    result = result.slice(-opts.limit)
  }
  return result
}

/** Diagnostics for /room/cards?debug=1 and tests. */
export function getRoomCardStatus(): {
  initialized: boolean
  hostId: string | null
  bufferedCount: number
  totalReceived: number
  windowMs: number
  maxEntries: number
} {
  pruneOldEntries(Date.now())
  return {
    initialized: state.initialized,
    hostId: state.hostId,
    bufferedCount: state.entries.length,
    totalReceived: state.receivedCount,
    windowMs: RING_BUFFER_WINDOW_MS,
    maxEntries: MAX_BUFFERED_CARDS,
  }
}

/** Test-only: inject an entry directly without going through the channel. */
export function _testInjectCardEntry(entry: RoomCardEntry): void {
  const existingIdx = state.entries.findIndex((e) => e.card.serverTs === entry.card.serverTs)
  if (existingIdx >= 0) {
    state.entries[existingIdx] = entry
  } else {
    state.entries.push(entry)
  }
  state.receivedCount++
  pruneOldEntries(Date.now())
}

/** Test-only: reset state without going through shutdown. */
export function _testResetCardStore(): void {
  state.entries = []
  state.receivedCount = 0
  state.initialized = false
  state.channel = null
  state.client = null
  state.hostId = null
}
