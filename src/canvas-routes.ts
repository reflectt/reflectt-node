// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Canvas Routes — extracted from server.ts
 *
 * Fastify plugin registering /canvas/* read-only + discovery endpoints.
 * Dependencies injected via plugin options.
 *
 * Phase 1: states, slots, slots/all, rejections
 * Phase 2: presence, state, flow-score, team/mood
 *
 * task-1773681272865, task-1773689755389
 */

import type { FastifyInstance } from 'fastify'
import type { PresenceStatus } from './presence.js'
import type Database from 'better-sqlite3'
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
  /** Expression log for flow-score velocity calculation */
  flowExpressionLog: Array<{ t: number }>
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

  // GET /canvas/presence — all agents as AgentPresence[]
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
  app.get('/canvas/states', async (request) => {
    const query = request.query as Record<string, unknown>
    const userId = typeof query.userId === 'string' && query.userId.trim()
      ? query.userId.trim()
      : 'anonymous'
    emitActivationEvent('canvas_opened', userId).catch(() => {})
    return {
      states: CANVAS_STATES,
      sensors: SENSOR_VALUES,
      schema: {
        state: 'floor | listening | thinking | rendering | ambient | decision | urgent | handoff',
        sensors: 'null | mic | camera | mic+camera (non-dismissable trust indicator)',
        agentId: 'required — which agent is driving the canvas',
        payload: 'optional — text, media, decision, agents, summary',
      },
    }
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

  // GET /canvas/flow-score — real-time team flow metric (0–1)
  app.get('/canvas/flow-score', async () => {
    const now = Date.now()
    const STALE_MS = 10 * 60 * 1000
    const WINDOW_5M = 5 * 60 * 1000

    const activeEntries = [...deps.canvasStateMap.entries()].filter(([, e]) => now - e.updatedAt < STALE_MS)
    const agentScore = Math.min(1.0, activeEntries.length / 4)

    const HIGH_FLOW_STATES = new Set(['working', 'rendering', 'thinking', 'decision'])
    const flowingCount = activeEntries.filter(([, e]) => HIGH_FLOW_STATES.has(e.state)).length
    const velocityFromStates = activeEntries.length > 0 ? flowingCount / activeEntries.length : 0

    const recent = deps.flowExpressionLog.filter(e => e.t > now - WINDOW_5M).length
    const expressionScore = Math.min(1.0, recent / 20)

    const hour = new Date(now).getHours()
    const timeScore = hour >= 9 && hour <= 22 ? 1.0 : hour >= 6 && hour <= 8 ? 0.5 : 0.2

    const score = Math.round((
      agentScore         * 0.30 +
      velocityFromStates * 0.35 +
      expressionScore    * 0.25 +
      timeScore          * 0.10
    ) * 100) / 100

    const label =
      score >= 0.8 ? 'surge' :
      score >= 0.6 ? 'flow' :
      score >= 0.4 ? 'grinding' :
      score >= 0.2 ? 'quiet' : 'idle'

    return {
      score,
      label,
      factors: {
        agents: Math.round(agentScore * 100) / 100,
        velocity: Math.round(velocityFromStates * 100) / 100,
        expressions: Math.round(expressionScore * 100) / 100,
        timeOfDay: timeScore,
      },
      activeAgents: activeEntries.length,
      expressionsLast5m: recent,
    }
  })

  // GET /canvas/team/mood — derived collective mood of all active agents
  app.get('/canvas/team/mood', async () => {
    const now = Date.now()
    const STALE_MS = 10 * 60 * 1000

    const states: string[] = []
    const agentNames: string[] = []

    for (const [agentId, entry] of deps.canvasStateMap) {
      if (now - entry.updatedAt > STALE_MS) continue
      states.push(entry.state)
      agentNames.push(agentId)
    }

    const activeCount = states.length
    const urgentCount = states.filter(s => s === 'urgent').length
    const decisionCount = states.filter(s => s === 'decision').length
    const renderingCount = states.filter(s => s === 'rendering').length
    const thinkingCount = states.filter(s => s === 'thinking').length
    const idleCount = states.filter(s => s === 'floor' || s === 'ambient').length
    const workingCount = activeCount - idleCount

    let blockedTasks = 0
    let pendingDecisions = 0
    try {
      const db = deps.getDb()
      const row = db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status = 'blocked'`).get() as { n: number }
      blockedTasks = row?.n ?? 0
      const drow = db.prepare(`SELECT COUNT(*) as n FROM tasks WHERE status = 'doing' AND priority IN ('P0','P1')`).get() as { n: number }
      pendingDecisions = decisionCount + (drow?.n ?? 0)
    } catch { /* non-fatal */ }

    const tensionRaw =
      (urgentCount * 0.35) +
      (decisionCount * 0.25) +
      (Math.min(blockedTasks, 5) * 0.08) +
      (activeCount > 0 ? (1 - idleCount / activeCount) * 0.10 : 0)
    const tension = Math.min(1.0, tensionRaw)

    const teamRhythm: string =
      urgentCount > 0 ? 'surge' :
      activeCount === 0 || idleCount === activeCount ? 'quiet' :
      decisionCount > 0 && workingCount > 0 ? 'tense' :
      renderingCount + thinkingCount >= Math.max(1, activeCount * 0.6) ? 'flow' :
      'grinding'

    const dominantState: string =
      urgentCount > 0 ? 'urgent' :
      decisionCount > 0 ? 'decision' :
      renderingCount > 0 ? 'rendering' :
      thinkingCount > 0 ? 'thinking' :
      workingCount > 0 ? 'working' :
      'idle'

    const ambientPulse: string =
      teamRhythm === 'surge' ? 'fast' :
      teamRhythm === 'flow' ? 'normal' :
      teamRhythm === 'tense' ? 'slow' :
      'slow'

    let dominantColor = '#60a5fa'
    for (const [agentId, entry] of deps.canvasStateMap) {
      if (entry.state !== 'floor' && entry.state !== 'ambient') {
        dominantColor = deps.agentIdentityColors[agentId] ?? dominantColor
        break
      }
    }

    return {
      mood: {
        teamRhythm,
        dominantState,
        tension,
        ambientPulse,
        dominantColor,
        activeAgents: agentNames,
        counts: { active: activeCount, urgent: urgentCount, rendering: renderingCount, thinking: thinkingCount, decision: decisionCount, idle: idleCount, blocked: blockedTasks },
      },
      generated_at: new Date(now).toISOString(),
    }
  })

  // GET /canvas/rejections — recent render rejections (debug)
  app.get('/canvas/rejections', async () => {
    return { rejections: deps.getRecentRejections() }
  })
}
