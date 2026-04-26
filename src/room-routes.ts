// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Room Routes — slice 2 of room-model-v0.1.1
 *
 * Fastify plugin registering room-state read endpoints. Currently exposes
 * `GET /room/participants` — the cached human participant set from the
 * Supabase Realtime channel slice 1 publishes to.
 *
 * Auth uses the same heartbeat-token model as `/hosts/heartbeat`: if
 * REFLECTT_HOST_HEARTBEAT_TOKEN is set, requests must present it via
 * `Authorization: Bearer`, `x-heartbeat-token` header, or `?token=` query.
 * If unset, the route is open (matches existing host-cred behavior).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { listRoomParticipants, getRoomPresenceStatus } from './room-presence-store.js'

function verifyAuth(request: FastifyRequest): { ok: boolean; error?: string } {
  const expectedToken = process.env.REFLECTT_HOST_HEARTBEAT_TOKEN
  if (!expectedToken) return { ok: true }

  const headers = request.headers as Record<string, string | string[] | undefined>
  const authHeader = (headers.authorization || headers.Authorization) as string | undefined
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const provided = authHeader.slice('Bearer '.length).trim()
    if (provided === expectedToken) return { ok: true }
  }
  const headerToken = headers['x-heartbeat-token']
  if (typeof headerToken === 'string' && headerToken === expectedToken) return { ok: true }

  const query = request.query as Record<string, unknown>
  if (typeof query?.token === 'string' && query.token === expectedToken) return { ok: true }

  return { ok: false, error: 'Unauthorized: REFLECTT_HOST_HEARTBEAT_TOKEN required' }
}

export async function roomRoutes(app: FastifyInstance) {
  app.get('/room/participants', async (request, reply) => {
    const auth = verifyAuth(request)
    if (!auth.ok) {
      reply.status(401)
      return { error: auth.error }
    }
    const participants = listRoomParticipants()
    const status = getRoomPresenceStatus()
    return {
      participants,
      count: participants.length,
      hostId: status.hostId,
      initialized: status.initialized,
    }
  })
}
