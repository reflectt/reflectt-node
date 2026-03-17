// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Canvas Takeover Routes — extracted from server.ts
 *
 * When an agent has something to show, they take over the canvas.
 * Orbs fade to ambient. The agent's content IS the canvas.
 * Release returns to constellation view.
 *
 * task-1773689755389 (Phase 2 extraction)
 */

import type { FastifyInstance } from 'fastify'
import { eventBus as _eventBusInstance } from './events.js'
import { emitActivationEvent } from './activationEvents.js'

type EventBus = typeof _eventBusInstance

// ── Types ──

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

export interface TakeoverDeps {
  eventBus: EventBus
  queueCanvasPushEvent: (event: Record<string, unknown>) => void
}

// ── Mutable state (singleton per server) ──

let currentTakeover: TakeoverState | null = null

// ── Plugin ──

export async function canvasTakeoverRoutes(app: FastifyInstance, deps: TakeoverDeps) {

  // POST /canvas/takeover — claim the screen
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

    // Emit takeover event — frontend fades orbs to ambient, renders agent content full-screen
    const takeoverEventData = { action: 'claim', agentId, content: safeContent, title, duration, transition }
    deps.eventBus.emit({
      id,
      type: 'canvas_takeover' as const,
      timestamp: now,
      data: takeoverEventData,
    })

    // Also queue for cloud relay
    deps.queueCanvasPushEvent({ type: 'canvas_takeover', ...takeoverEventData, t: now })

    // Track activation event
    emitActivationEvent('canvas_first_action', agentId, { action: 'canvas_takeover' }).catch(() => {})

    return { success: true, id, expiresAt: now + duration }
  })

  // POST /canvas/takeover/release — give back the screen
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
}
