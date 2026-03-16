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

// ── Takeover state (module-level, shared between claim/release/get) ──

interface TakeoverState {
  agentId: string
  id: string
  content: Record<string, unknown>
  title?: string
  startedAt: number
  duration: number
  transition: string
  releaseTimer?: ReturnType<typeof setTimeout>
}

let currentTakeover: TakeoverState | null = null

/** Exported for server.ts to read/clear if needed during shutdown */
export function getCurrentTakeover() { return currentTakeover }
export function clearCurrentTakeover() { currentTakeover = null }

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

// ── Phase 2: Takeover, Attention, Activity-Stream routes ──

/**
 * Phase 2 dependencies — heavier state coupling than Phase 1.
 */
export interface CanvasPhase2Deps {
  eventBus: {
    emit: (event: { id: string; type: string; timestamp: number; data: unknown }) => void
  }
  queueCanvasPushEvent: (event: Record<string, unknown>) => void
  taskManager: {
    listTasks: (filter: { status: string }) => any[]
  }
  getDb: () => any
  activityRingBuffer: any[]
  activityStreamSubscribers: Map<string, { closed: boolean; send: (data: string) => void }>
}

/**
 * Phase 2 canvas routes — takeover, attention, activity-stream.
 * task-1773689755389-ux4bbn1lo
 */
export async function canvasPhase2Routes(app: FastifyInstance, deps: CanvasPhase2Deps) {

  // ── Takeover ──

  // POST /canvas/takeover — agent claims full screen
  app.post('/canvas/takeover', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim().toLowerCase() : ''
    if (!agentId) {
      reply.status(400)
      return { success: false, message: 'agentId is required' }
    }

    const content = body.content as Record<string, unknown> | undefined
    if (!content || typeof content !== 'object') {
      reply.status(400)
      return { success: false, message: 'content object is required' }
    }

    // Sanitize content fields
    const safeContent: Record<string, unknown> = {}
    if (typeof content.html === 'string') safeContent.html = content.html.slice(0, 50_000)
    if (typeof content.markdown === 'string') safeContent.markdown = content.markdown.slice(0, 20_000)
    if (typeof content.code === 'string') safeContent.code = content.code.slice(0, 20_000)
    if (typeof content.language === 'string') safeContent.language = content.language.slice(0, 30)
    if (typeof content.image === 'string') safeContent.image = content.image.slice(0, 2000)
    if (typeof content.svg === 'string') safeContent.svg = content.svg.slice(0, 100_000)
    if (typeof content.video === 'string') safeContent.video = content.video.slice(0, 2000)
    if (typeof content.threejs === 'string') safeContent.threejs = content.threejs.slice(0, 100_000)
    if (typeof content.title === 'string') safeContent.title = content.title.slice(0, 200)

    const duration = typeof body.duration === 'number' && body.duration > 0
      ? Math.min(body.duration, 120_000) : 30_000
    const transition = typeof body.transition === 'string' && ['fade', 'slide', 'instant'].includes(body.transition)
      ? body.transition : 'fade'
    const title = typeof body.title === 'string' ? body.title.slice(0, 200) : undefined

    // Release previous takeover if any
    if (currentTakeover?.releaseTimer) clearTimeout(currentTakeover.releaseTimer)

    const id = `takeover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    currentTakeover = { agentId, id, content: safeContent, title, startedAt: now, duration, transition }

    // Auto-release after duration
    currentTakeover.releaseTimer = setTimeout(() => {
      if (currentTakeover?.id === id) {
        deps.eventBus.emit({
          id: `takeover-release-${Date.now()}`,
          type: 'canvas_takeover' as const,
          timestamp: Date.now(),
          data: { action: 'release', agentId, transition: 'fade', reason: 'timeout' },
        })
        currentTakeover = null
      }
    }, duration)

    // Emit takeover event
    const takeoverEventData = { action: 'claim', agentId, content: safeContent, title, duration, transition }
    deps.eventBus.emit({
      id,
      type: 'canvas_takeover' as const,
      timestamp: now,
      data: takeoverEventData,
    })

    // Also queue for cloud relay
    deps.queueCanvasPushEvent({ type: 'canvas_takeover', ...takeoverEventData, t: now })

    // Track canvas_first_action activation event
    emitActivationEvent('canvas_first_action', agentId, { action: 'canvas_takeover' }).catch(() => {})

    return { success: true, id, expiresAt: now + duration }
  })

  // POST /canvas/takeover/release — agent releases takeover
  app.post('/canvas/takeover/release', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim().toLowerCase() : ''
    if (!agentId) {
      reply.status(400)
      return { success: false, message: 'agentId is required' }
    }

    if (!currentTakeover || currentTakeover.agentId !== agentId) {
      return { success: true, message: 'no active takeover by this agent' }
    }

    if (currentTakeover.releaseTimer) clearTimeout(currentTakeover.releaseTimer)
    const transition = typeof body.transition === 'string' && ['fade', 'slide', 'instant'].includes(body.transition)
      ? body.transition : 'fade'

    const releaseNow = Date.now()
    const releaseData = { action: 'release', agentId, transition, reason: 'agent_released' }
    deps.eventBus.emit({
      id: `takeover-release-${releaseNow}`,
      type: 'canvas_takeover' as const,
      timestamp: releaseNow,
      data: releaseData,
    })
    deps.queueCanvasPushEvent({ type: 'canvas_takeover', ...releaseData, t: releaseNow })

    currentTakeover = null
    return { success: true }
  })

  // GET /canvas/takeover — check current takeover state
  app.get('/canvas/takeover', async () => {
    if (!currentTakeover) return { active: false }
    return {
      active: true,
      agentId: currentTakeover.agentId,
      id: currentTakeover.id,
      title: currentTakeover.title,
      content: currentTakeover.content,
      startedAt: currentTakeover.startedAt,
      expiresAt: currentTakeover.startedAt + currentTakeover.duration,
      remainingMs: Math.max(0, (currentTakeover.startedAt + currentTakeover.duration) - Date.now()),
    }
  })

  // ── Attention ──

  // GET /canvas/attention — highest-priority actionable item
  app.get('/canvas/attention', async (request) => {
    const query = request.query as Record<string, string>
    const viewer = typeof query.viewer === 'string' ? query.viewer.trim() : 'human'

    const notifModule = await import('./agent-notifications.js')
    const notifResult = notifModule.getNotifications(deps.getDb(), viewer, { status: 'pending', limit: 1 })
    const topNotif = notifResult.notifications[0]

    const validatingTasks = deps.taskManager.listTasks({ status: 'validating' })
    const reviewable = validatingTasks.find((t: any) =>
      t.assignee !== viewer && t.reviewers?.includes(viewer)
    ) ?? validatingTasks[0]

    const blockedTasks = deps.taskManager.listTasks({ status: 'blocked' })
    const viewerBlocked = blockedTasks.find((t: any) => t.assignee === viewer)

    type AttentionItem = {
      source: 'notification' | 'review' | 'blocked'
      priority: 'critical' | 'high' | 'medium' | 'low'
      title: string
      detail?: string
      taskId?: string
      prUrl?: string
      agentId?: string
      actionLabel: string
      actionType: 'ack' | 'review' | 'unblock'
      notificationId?: string
    }

    let item: AttentionItem | null = null

    if (topNotif && (topNotif.priority === 'critical' || topNotif.priority === 'high')) {
      item = {
        source: 'notification',
        priority: topNotif.priority,
        title: topNotif.title,
        detail: topNotif.body ?? undefined,
        taskId: topNotif.task_id ?? undefined,
        agentId: topNotif.source_agent ?? undefined,
        actionLabel: topNotif.type === 'review' ? 'Review' : 'Acknowledge',
        actionType: 'ack',
        notificationId: topNotif.id,
      }
    } else if (reviewable) {
      const t = reviewable as any
      item = {
        source: 'review',
        priority: 'high',
        title: t.title ?? 'Task needs review',
        detail: `Assigned to ${t.assignee ?? 'unassigned'}`,
        taskId: t.id,
        agentId: t.assignee ?? undefined,
        actionLabel: 'Review',
        actionType: 'review',
      }
    } else if (viewerBlocked) {
      const t = viewerBlocked as any
      item = {
        source: 'blocked',
        priority: 'medium',
        title: t.title ?? 'Task is blocked',
        detail: t.metadata?.blocked_reason ?? 'Needs attention',
        taskId: t.id,
        agentId: t.assignee ?? undefined,
        actionLabel: 'Unblock',
        actionType: 'unblock',
      }
    } else if (topNotif) {
      item = {
        source: 'notification',
        priority: topNotif.priority ?? 'low',
        title: topNotif.title,
        detail: topNotif.body ?? undefined,
        taskId: topNotif.task_id ?? undefined,
        agentId: topNotif.source_agent ?? undefined,
        actionLabel: 'View',
        actionType: 'ack',
        notificationId: topNotif.id,
      }
    }

    return { item, pendingNotifications: notifResult.total }
  })

  // ── Activity Stream ──

  // GET /canvas/activity-stream — SSE stream with backfill
  app.get('/canvas/activity-stream', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.raw.flushHeaders?.()

    let closed = false
    const subId = `asub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Replay backfill — last 20 events with stagger hint for animated replay
    const backfill = deps.activityRingBuffer.slice(-20)
    for (let i = 0; i < backfill.length; i++) {
      if (closed) break
      try {
        const entry = { ...backfill[i], _backfill: true, _staggerMs: i * 50 }
        reply.raw.write(`event: backfill\ndata: ${JSON.stringify(entry)}\n\n`)
      } catch { break }
    }

    // Signal backfill complete
    if (!closed) {
      try { reply.raw.write(`event: backfill_done\ndata: {}\n\n`) } catch { /* */ }
    }

    // Register for live events via shared subscriber map
    deps.activityStreamSubscribers.set(subId, {
      closed: false,
      send: (data: string) => {
        if (closed) return
        try { reply.raw.write(`event: activity\ndata: ${data}\n\n`) } catch { closed = true }
      },
    })

    request.raw.on('close', () => {
      closed = true
      deps.activityStreamSubscribers.delete(subId)
    })

    return new Promise<void>(() => {})
  })
}
