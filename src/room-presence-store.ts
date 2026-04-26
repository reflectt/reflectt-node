// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Presence Store — slice 2 of room-model-v0.1.1
 *
 * Server-side mirror of the Supabase Realtime presence channel that
 * cloud's `useRoomPresence` hook publishes to (slice 1). Node subscribes
 * to the same `room:${hostId}` channel as a third party so that agents
 * can see who's in the room via `GET /room/participants` and the
 * `room_list_participants` MCP tool.
 *
 * Per ROOM_MODEL_V0.md anchor rule: the room creates truth (via the
 * channel), agents access truth via APIs/MCP. This file is the API/MCP
 * side of that contract — it does NOT invent state, it observes the
 * channel cloud already publishes to.
 *
 * What this is NOT:
 *   - durable history (participants[] is ephemeral; if the channel drops,
 *     the cache empties — that's the contract, not a bug)
 *   - a second source of truth (the channel is truth; this is a cache)
 *   - heartbeat extension (slice 2 explicitly defers HostHeartbeatV1 changes
 *     until media/transcript lanes need server-side derivation)
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { eventBus } from './events.js'

// Mirrors HumanParticipant in apps/web/src/app/presence/use-room-presence.ts.
// Fields are wire-format from the channel — re-stamping (e.g. lastBeaconAt)
// happens on read, not here.
export type Device = 'big-screen' | 'desktop' | 'tablet' | 'phone'

// Real device state — set when the browser actually opens the device, not
// intent. 'denied' means the OS/browser refused; 'off' means the user toggled
// it off (or never enabled it). Optional so older cloud builds that never
// publish lanes still validate against this type.
export type CaptureLaneState = 'on' | 'off' | 'denied'
export interface CaptureLanes {
  mic?: CaptureLaneState
  camera?: CaptureLaneState
}

export interface HumanParticipant {
  kind: 'human'
  id: string
  userId: string
  hostId: string
  displayName: string
  identityColor: string
  device: Device
  joinedAt: number
  lastBeaconAt: number
  captureLanes?: CaptureLanes
}

interface StoreState {
  participants: Map<string, HumanParticipant> // keyed by ephemeral session id
  channel: RealtimeChannel | null
  client: SupabaseClient | null
  hostId: string | null
  initialized: boolean
}

const state: StoreState = {
  participants: new Map(),
  channel: null,
  client: null,
  hostId: null,
  initialized: false,
}

function resolveHostId(): string | null {
  const hostId = process.env.REFLECTT_HOST_ID || process.env.HOSTNAME
  if (!hostId || hostId === 'unknown') return null
  return hostId
}

/**
 * Initialize the store: create the Supabase client, subscribe to
 * `room:${hostId}` channel, and start listening for presence sync events.
 * Idempotent. Safe to call multiple times — only the first call wires up.
 *
 * If Supabase env is missing or hostId is unresolvable, the store stays
 * empty (returns false) — the rest of the node still boots.
 */
export function initRoomPresenceStore(): boolean {
  if (state.initialized) return true

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  // Managed hosts ship the service-role JWT under SUPABASE_ACCESS_TOKEN
  // (CLI convention), self-hosted setups under SUPABASE_SERVICE_ROLE_KEY.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ACCESS_TOKEN
  const hostId = resolveHostId()

  if (!url || !key) {
    console.warn('[room-presence] Supabase env missing — store stays empty')
    return false
  }
  if (!hostId) {
    console.warn('[room-presence] REFLECTT_HOST_ID unresolvable — store stays empty')
    return false
  }

  state.hostId = hostId
  state.client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const channel = state.client.channel(`room:${hostId}`, {
    // Listening as a service-role client — node never publishes its own
    // presence track. The presence key is required by Supabase even for
    // listen-only subscribers; we use a stable node sentinel that won't
    // collide with browser session ids (which are random uuids).
    config: { presence: { key: `node:${hostId}` } },
  })

  const recompute = () => {
    const presenceState = channel.presenceState() as Record<string, HumanParticipant[]>
    const seenIds = new Set<string>()
    const newJoins: HumanParticipant[] = []
    for (const entries of Object.values(presenceState)) {
      for (const entry of entries) {
        // Defensive: filter out our own listen-only sentinel and any non-human
        // payloads. Slice 1 only publishes humans; future slices that publish
        // other kinds on the same channel must continue to use { kind } shape.
        if (!entry || (entry as any).kind !== 'human' || !entry.id) continue
        seenIds.add(entry.id)
        const isNewJoin = !state.participants.has(entry.id)
        const stamped: HumanParticipant = { ...entry, lastBeaconAt: Date.now() }
        state.participants.set(entry.id, stamped)
        if (isNewJoin) newJoins.push(stamped)
      }
    }
    // Prune anyone who left
    for (const id of [...state.participants.keys()]) {
      if (!seenIds.has(id)) state.participants.delete(id)
    }
    // Emit one event per new join — agents subscribe to room_participant_joined
    // for "should I greet this person?" decisions.
    for (const p of newJoins) {
      eventBus.emit({
        id: `room-join-${p.id}-${Date.now()}`,
        type: 'room_participant_joined',
        timestamp: Date.now(),
        data: { participant: p, hostId },
      })
    }
  }

  channel
    .on('presence', { event: 'sync' }, recompute)
    .on('presence', { event: 'join' }, recompute)
    .on('presence', { event: 'leave' }, recompute)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[room-presence] subscribed to room:${hostId}`)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[room-presence] channel ${status} for room:${hostId}`)
      }
    })

  state.channel = channel
  state.initialized = true
  return true
}

/**
 * Tear down the channel subscription. Used in tests and on graceful
 * shutdown. Clears the cache.
 */
export async function shutdownRoomPresenceStore(): Promise<void> {
  if (state.channel && state.client) {
    try { await state.channel.unsubscribe() } catch { /* non-fatal */ }
    try { await state.client.removeChannel(state.channel) } catch { /* non-fatal */ }
  }
  state.channel = null
  state.client = null
  state.hostId = null
  state.initialized = false
  state.participants.clear()
}

/** Read the current participant set, sorted by joinedAt (stable order). */
export function listRoomParticipants(): HumanParticipant[] {
  return [...state.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt)
}

/** Diagnostics for /room/participants?debug=1 and tests. */
export function getRoomPresenceStatus(): { initialized: boolean; hostId: string | null; count: number } {
  return {
    initialized: state.initialized,
    hostId: state.hostId,
    count: state.participants.size,
  }
}
