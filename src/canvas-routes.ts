// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Canvas Routes — extracted from server.ts
 *
 * Fastify plugin that registers /canvas/* read endpoints.
 * Dependencies injected via plugin options.
 *
 * task-1773681272865
 */

import type { FastifyInstance } from 'fastify'
import type { PresenceStatus } from './presence.js'
import type Database from 'better-sqlite3'

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
  canvasStateMap: Map<string, CanvasStateEntry>
  canvasSlots: {
    getActive: () => unknown[]
    getAll: () => unknown[]
    getStats: () => unknown
  }
  agentIdentityColors: Record<string, string>
  getDb: () => Database.Database
  getRecentRejections: () => unknown[]
}

// ── Constants ──

export const CANVAS_STATES = [
  'floor', 'listening', 'thinking', 'rendering', 'ambient', 'decision', 'urgent', 'handoff', 'presenting',
]
export const SENSOR_VALUES = [
  'voice_active', 'screen_share', 'camera', 'typing', 'idle', 'scroll', 'hover', 'focus',
]

// ── Helpers ──

export function formatRecency(updatedAt: number): string {
  const diff = Date.now() - updatedAt
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ── Plugin ──

export async function canvasReadRoutes(app: FastifyInstance, deps: CanvasRouteDeps) {

  // GET /canvas/presence — all agents as AgentPresence[] (for presence surface)
  app.get('/canvas/presence', async () => {
    const agents: Array<{
      name: string
      identityColor: string
      state: PresenceStatus
      activeTask?: { title: string; id: string }
      recency: string
      attention?: { type: string; taskId: string; label?: string }
    }> = []

    for (const [agentId, entry] of deps.canvasStateMap) {
      const presenceState: PresenceStatus =
        (entry.payload as any)?.presenceState ||
        (entry.state === 'decision' || entry.state === 'urgent' ? 'blocked' :
         entry.state === 'thinking' || entry.state === 'rendering' ? 'working' : 'idle')

      agents.push({
        name: agentId,
        identityColor: deps.agentIdentityColors[agentId] || '#9ca3af',
        state: presenceState,
        activeTask: (entry.payload as any)?.activeTask,
        recency: formatRecency(entry.updatedAt),
        attention: (entry.payload as any)?.attention,
      })
    }

    return { agents, count: agents.length }
  })

  // GET /canvas/state — current state for all agents (or one)
  app.get('/canvas/state', async (request) => {
    const query = request.query as { agentId?: string }

    function getLastMessage(agentId: string): { content: string; timestamp: number } | null {
      try {
        const db = deps.getDb()
        const row = db.prepare(
          `SELECT content, timestamp FROM chat_messages WHERE "from" = ? AND "to" IS NULL ORDER BY timestamp DESC LIMIT 1`
        ).get(agentId) as { content: string; timestamp: number } | undefined
        return row ?? null
      } catch {
        return null
      }
    }

    if (query.agentId) {
      const entry = deps.canvasStateMap.get(query.agentId)
      const base = entry ?? { state: 'floor', sensors: null, payload: {}, updatedAt: null }
      return { ...base, lastMessage: getLastMessage(query.agentId) }
    }
    const all: Record<string, unknown> = {}
    for (const [id, entry] of deps.canvasStateMap) {
      all[id] = { ...entry, lastMessage: getLastMessage(id) }
    }
    return { agents: all, count: deps.canvasStateMap.size }
  })

  // GET /canvas/states — valid state + sensor values (discovery)
  app.get('/canvas/states', async () => ({
    states: CANVAS_STATES,
    sensors: SENSOR_VALUES,
    schema: {
      state: 'floor | listening | thinking | rendering | ambient | decision | urgent | handoff',
      sensors: 'null | mic | camera | mic+camera (non-dismissable trust indicator)',
      agentId: 'required — which agent is driving the canvas',
      payload: 'optional — text, media, decision, agents, summary',
    },
  }))

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
