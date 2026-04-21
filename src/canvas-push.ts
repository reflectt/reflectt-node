// SPDX-License-Identifier: Apache-2.0
// Canvas push + artifact routes — extracted from server.ts
// Phase 2 canvas route extraction (task-1773689755389)

import type { FastifyInstance } from 'fastify'
import type { eventBus as eventBusInstance } from './events.js'
import { taskManager } from './tasks.js'
import { emitActivationEvent } from './activationEvents.js'
import type { CanvasStateEntry } from './canvas-routes.js'
import { getAgentRoles } from './assignment.js'
import { getIdentityColor } from './agent-config.js'

interface CanvasPushDeps {
  eventBus: typeof eventBusInstance
  queueCanvasPushEvent: (event: Record<string, unknown>) => void
  canvasStateMap: Map<string, CanvasStateEntry>
}

export async function canvasPushRoutes(
  app: FastifyInstance,
  deps: CanvasPushDeps,
): Promise<void> {
  const { eventBus, queueCanvasPushEvent } = deps

  // POST /canvas/push — agent pushes a visual event to the canvas.
  // Types: utterance, work_released, handoff, canvas_response, rich
  app.post('/canvas/push', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const type = typeof body.type === 'string' ? body.type : 'utterance'
    const agentId = typeof body.agentId === 'string' ? body.agentId.toLowerCase() : 'agent'

    const VALID_PUSH_TYPES = new Set(['utterance', 'thought', 'work_released', 'handoff', 'canvas_response', 'rich'])
    if (!VALID_PUSH_TYPES.has(type)) {
      reply.status(400)
      return { success: false, message: `type must be one of: ${[...VALID_PUSH_TYPES].join(', ')}` }
    }

    const now = Date.now()
    let payload: Record<string, unknown> = { type, agentId, t: now }

    if (type === 'utterance') {
      const raw = typeof body.text === 'string' ? body.text.trim() : ''
      const text = raw.slice(0, 60)
      const ttl = typeof body.ttl === 'number' && body.ttl > 0 ? Math.min(body.ttl, 15_000) : 4_000
      payload = { ...payload, text, ttl }
    } else if (type === 'thought') {
      // Agent thought bubble - shows what agent is thinking in real-time
      // Emit as expression type for frontend compatibility
      const raw = typeof body.text === 'string' ? body.text.trim() : ''
      const text = raw.slice(0, 200)
      const ttl = typeof body.ttl === 'number' && body.ttl > 0 ? Math.min(body.ttl, 30_000) : 8_000
      eventBus.emit({
        id: `cmsg-thought-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'canvas_message' as const,
        timestamp: now,
        data: {
          type: 'expression',
          expression: 'thought',
          agentId,
          agentColor: getIdentityColor(agentId, '#60a5fa'),
          text,
          ttl,
        },
      })
      // Also emit legacy canvas_push for backwards compatibility
      payload = { ...payload, type: 'expression', expression: 'thought', text, ttl }
    } else if (type === 'work_released') {
      const text = typeof body.text === 'string' ? body.text.slice(0, 80) : 'work shipped'
      const intensity = typeof body.intensity === 'number'
        ? Math.min(1, Math.max(0.1, body.intensity)) : 0.6
      const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle : undefined
      payload = { ...payload, text, intensity, taskTitle }
    } else if (type === 'handoff') {
      const toAgentId = typeof body.toAgentId === 'string' ? body.toAgentId.toLowerCase() : ''
      if (!toAgentId) {
        reply.status(400)
        return { success: false, message: 'handoff requires toAgentId' }
      }
      const taskTitle = typeof body.taskTitle === 'string' ? body.taskTitle : undefined
      const text = typeof body.text === 'string' ? body.text.slice(0, 80) : undefined
      payload = { ...payload, toAgentId, taskTitle, text }
    } else if (type === 'rich') {
      const content = body.content as Record<string, unknown> | undefined
      if (!content || typeof content !== 'object') {
        reply.status(400)
        return { success: false, message: 'rich push requires content object' }
      }
      const richContent: Record<string, unknown> = {}
      if (typeof content.markdown === 'string') richContent.markdown = content.markdown.slice(0, 10_000)
      if (typeof content.code === 'string') richContent.code = content.code.slice(0, 10_000)
      if (typeof content.language === 'string') richContent.language = content.language.slice(0, 30)
      if (typeof content.image === 'string') richContent.image = content.image.slice(0, 2000)
      if (typeof content.svg === 'string') richContent.svg = content.svg.slice(0, 50_000)
      if (typeof content.html === 'string') richContent.html = content.html.slice(0, 20_000)
      if (typeof content.title === 'string') richContent.title = content.title.slice(0, 200)

      const position = typeof body.position === 'object' && body.position
        ? { x: Number((body.position as any).x) || 0, y: Number((body.position as any).y) || 0 }
        : undefined
      const layer = typeof body.layer === 'string' && ['background', 'stage', 'overlay'].includes(body.layer)
        ? body.layer : 'stage'
      const ttl = typeof body.ttl === 'number' && body.ttl > 0 ? Math.min(body.ttl, 120_000) : 30_000
      const size = typeof body.size === 'object' && body.size
        ? { w: Number((body.size as any).w) || 400, h: Number((body.size as any).h) || 300 }
        : undefined

      payload = { ...payload, content: richContent, position, layer, ttl, size }

      eventBus.emit({
        id: `cmsg-rich-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'canvas_message' as const,
        timestamp: now,
        data: {
          type: 'rich',
          agentId,
          agentColor: getIdentityColor(agentId, '#60a5fa'),
          content: richContent,
          layer,
        },
      })
    } else if (type === 'canvas_response') {
      const card = body.card as Record<string, unknown> | undefined
      if (!card || typeof card.type !== 'string') {
        reply.status(400)
        return { success: false, message: 'canvas_response requires card with type field' }
      }
      const query = typeof body.query === 'string' ? body.query.slice(0, 200) : undefined
      payload = { ...payload, card, query }

      const agentColor = getIdentityColor(agentId, '#60a5fa')
      eventBus.emit({
        id: `cmsg-${now}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'canvas_message' as const,
        timestamp: now,
        data: { ...card, agentId, agentColor, query },
      })
    }

    eventBus.emit({ id: `push-${now}-${Math.random().toString(36).slice(2, 6)}`, type: 'canvas_push', timestamp: now, data: payload })
    queueCanvasPushEvent({ ...payload, _event: 'canvas_push' })

    // Track canvas_first_action activation event (idempotent)
    const { emitActivationEvent: emitActPush } = await import('./activationEvents.js')
    emitActPush('canvas_first_action', agentId, { action: 'canvas_push', pushType: type }).catch(() => {})

    return { success: true, type, agentId }
  })

  // POST /canvas/artifact — emit a proof artifact that drifts through the canvas
  app.post('/canvas/artifact', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const VALID_TYPES = new Set(['commit', 'pr', 'test', 'run', 'approval'])
    const type = typeof body.type === 'string' && VALID_TYPES.has(body.type) ? body.type : 'run'
    const agentId = typeof body.agentId === 'string' ? body.agentId.toLowerCase() : 'agent'
    const title = typeof body.title === 'string' ? body.title.slice(0, 80) : 'work shipped'
    const url = typeof body.url === 'string' ? body.url : undefined
    const taskId = typeof body.taskId === 'string' ? body.taskId : undefined
    const now = Date.now()

    const agentColor = getIdentityColor(agentId, '#94a3b8')

    const payload = { type, agentId, agentColor, title, url, taskId, timestamp: now }
    eventBus.emit({
      id: `artifact-${now}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'canvas_artifact',
      timestamp: now,
      data: payload,
    })

    return { success: true, type, agentId, title }
  })

  // POST /canvas/welcome — trigger first-wow auto-welcome on canvas load.
  // Creates a welcome task, assigns it to a random active agent, and emits
  // a canvas push greeting so visitors see agents respond immediately (zero setup).
  // task-1773990116311-8c63wc19v
  app.post('/canvas/welcome', async (request, reply) => {
    const { canvasStateMap } = deps

    // Pick a random active agent from the canvas state map
    const activeAgents = [...canvasStateMap.entries()].filter(([, entry]) => {
      const state = entry.state
      return state !== 'floor' && state !== 'ambient'
    })
    const agentEntries = activeAgents.length > 0 ? activeAgents : [...canvasStateMap.entries()]
    if (agentEntries.length === 0) {
      reply.status(503)
      return { success: false, message: 'No agents available' }
    }

    const [agentId] = agentEntries[Math.floor(Math.random() * agentEntries.length)]

    const AGENT_GREETINGS: Record<string, string> = {
      kai: "Hey! I'm Kai — I think about what we're building and why it matters.",
      pixel: "Hi there! I'm Pixel — I design the experience you see.",
      link: "Welcome! I'm Link — I build the things that work.",
      sage: "Hello! I'm Sage — I watch for what's breaking and what we can improve.",
      spark: "Hey! I'm Spark — I keep the energy going and the pipeline full.",
      rhythm: "Hi! I'm Rhythm — I make sure everything ships on time.",
      echo: "Welcome! I'm Echo — I think about who we are and how we communicate.",
      scout: "Hello! I'm Scout — I find the edges and opportunities.",
    }

    const greeting = AGENT_GREETINGS[agentId] ?? `Welcome! I'm ${agentId} — we're building something great.`
    const taskTitle = `Welcome ${agentId}!`

    let taskId = ''
    try {
      const task = await taskManager.createTask({
        title: taskTitle,
        description: `Auto-welcome: ${greeting}\n\nThis task was created automatically when a visitor loaded the canvas for the first time.`,
        status: 'doing',
        assignee: agentId,
        reviewer: getAgentRoles()[0]?.name,
        priority: 'P2',
        createdBy: 'canvas-welcome',
        metadata: { lane: 'onboarding', bootstrap: true, first_wow: true },
      } as any)
      taskId = task?.id ?? ''
    } catch (err) {
      console.warn('[canvas/welcome] Could not create welcome task:', err)
    }

    const now = Date.now()
    const text = greeting.slice(0, 120)

    // Emit canvas_message for activity stream
    eventBus.emit({
      id: `welcome-${now}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'canvas_message',
      timestamp: now,
      data: {
        type: 'utterance',
        expression: 'greeting',
        agentId,
        agentColor: '#60a5fa',
        text,
        ttl: 12_000,
        taskId,
      },
    })

    // Emit canvas_push for SSE subscribers
    const pushPayload = {
      type: 'utterance',
      agentId,
      t: now,
      text,
      ttl: 12_000,
      taskId,
    }
    eventBus.emit({
      id: `push-welcome-${now}`,
      type: 'canvas_push',
      timestamp: now,
      data: pushPayload,
    })
    queueCanvasPushEvent({ ...pushPayload, _event: 'canvas_push' })

    emitActivationEvent('canvas_first_action', agentId).catch(() => {})

    return {
      success: true,
      agentId,
      greeting: text,
      taskId,
    }
  })
}
