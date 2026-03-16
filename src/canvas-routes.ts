// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Canvas Routes (Phase 1) — extracted from server.ts
 *
 * Fastify plugin that registers a first batch of /canvas/* endpoints.
 * Each extracted route is replaced with this plugin in server.ts.
 * Remaining routes stay in server.ts for Phase 2+ extraction.
 *
 * Extraction strategy: start with simple, self-contained routes.
 * Complex routes with deep state coupling remain in server.ts.
 *
 * task-1773681272865
 */

import type { FastifyInstance } from 'fastify'
import { emitActivationEvent } from './activationEvents.js'

// ── Types ──

export type CanvasState = 'floor' | 'ambient' | 'thinking' | 'rendering' | 'decision' | 'handoff' | 'urgent' | 'presenting'

export interface CanvasStateEntry {
  state: CanvasState
  sensors: string | null
  payload: unknown
  updatedAt: number
}

/**
 * Dependencies injected from server.ts.
 * Each dep is a narrow interface — no coupling to the full module.
 */
export interface CanvasRouteDeps {
  canvasSlots: {
    getActive: () => unknown[]
    getAll: () => unknown[]
    getStats: () => unknown
  }
  getRecentRejections: () => unknown[]
}

// ── Constants (moved from server.ts) ──

export const CANVAS_STATES = [
  'floor', 'listening', 'thinking', 'rendering', 'ambient', 'decision', 'urgent', 'handoff', 'presenting',
]
export const SENSOR_VALUES = [
  'voice_active', 'screen_share', 'camera', 'typing', 'idle', 'scroll', 'hover', 'focus',
]

// ── Plugin ──

export async function canvasReadRoutes(app: FastifyInstance, deps: CanvasRouteDeps) {

  // GET /canvas/states — valid state + sensor values (discovery)
  app.get('/canvas/states', async (request) => {
    const query = request.query as Record<string, unknown>
    const userId = typeof query.userId === 'string' && query.userId.trim()
      ? query.userId.trim()
      : 'anonymous'
    emitActivationEvent('canvas_opened', userId).catch(() => {})
    return ({
    states: CANVAS_STATES,
    sensors: SENSOR_VALUES,
    schema: {
      state: 'floor | listening | thinking | rendering | ambient | decision | urgent | handoff',
      sensors: 'null | mic | camera | mic+camera (non-dismissable trust indicator)',
      agentId: 'required — which agent is driving the canvas',
      payload: 'optional — text, media, decision, agents, summary',
    },
  })
  })

  // GET /canvas/slots — current active slots
  app.get('/canvas/slots', async () => {
    return {
      slots: deps.canvasSlots.getActive(),
      stats: deps.canvasSlots.getStats(),
    }
  })

  // GET /canvas/slots/all — all slots including stale (debug)
  app.get('/canvas/slots/all', async () => {
    return { slots: deps.canvasSlots.getAll() }
  })

  // GET /canvas/rejections — recent render rejections (debug)
  app.get('/canvas/rejections', async () => {
    return { rejections: deps.getRecentRejections() }
  })
}
