// SPDX-License-Identifier: Apache-2.0
// Canvas interactive routes — gaze, briefing, victory, spark, express
// Extracted from server.ts for Phase 2 canvas route extraction (task-1773689755389)

import type { FastifyInstance } from 'fastify'
import type { eventBus as eventBusInstance } from './events.js'

// ── Types ──

type RealityMixerCommand =
  | { type: 'text';    content: string; style?: Record<string, unknown>; durationMs?: number }
  | { type: 'speak';   content: string; voiceId?: string; agentId?: string }
  | { type: 'visual';  preset: 'urgency' | 'celebration' | 'thinking' | 'flow' | 'tension' | 'exhale' | 'spark' }
  | { type: 'color';   agent: string; color: string }
  | { type: 'sound';   src: string; volume?: number }
  | { type: 'haptic';  pattern: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' }
  | { type: 'clear' }

interface CanvasStateEntry {
  state: string
  updatedAt: number
  payload?: Record<string, unknown>
}

interface CanvasInteractiveDeps {
  eventBus: typeof eventBusInstance
  canvasStateMap: Map<string, CanvasStateEntry>
}

// ── Reality Mixer infrastructure ──

// In-memory command queue — new subscribers get last 20 commands for replay
const renderCommandLog: Array<{ id: string; ts: number; agentId: string; cmd: RealityMixerCommand }> = []
const MAX_RENDER_LOG = 20

// Subscriber set for GET /canvas/render/stream
export const renderStreamSubscribers = new Map<string, { send: (data: string) => void; closed: boolean }>()

export function broadcastRenderCommand(agentId: string, cmd: RealityMixerCommand): string {
  const id = `rc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const entry = { id, ts: Date.now(), agentId, cmd }
  renderCommandLog.push(entry)
  if (renderCommandLog.length > MAX_RENDER_LOG) renderCommandLog.shift()

  const payload = JSON.stringify(entry)
  for (const [subId, sub] of renderStreamSubscribers) {
    if (sub.closed) { renderStreamSubscribers.delete(subId); continue }
    try { sub.send(payload) } catch { sub.closed = true; renderStreamSubscribers.delete(subId) }
  }
  return id
}

export function getRenderCommandLog() { return renderCommandLog }

// ── Identity colors (shared across interactive routes) ──

const IDENTITY_COLORS: Record<string, string> = {
  link: '#60a5fa', kai: '#fb923c', pixel: '#a78bfa',
  sage: '#34d399', scout: '#fbbf24', echo: '#f472b6',
}

// ── Plugin ──

export async function canvasInteractiveRoutes(
  app: FastifyInstance,
  deps: CanvasInteractiveDeps,
): Promise<void> {
  const { eventBus, canvasStateMap } = deps

  // Auto-expression listener: route canvas_spark events into Reality Mixer
  eventBus.on('auto-expression-router', (event) => {
    if (event.type !== 'canvas_spark') return
    const data = event.data as Record<string, unknown>
    const kind = String(data?.kind ?? '')

    if (kind === 'auto_expression') {
      const agentId = String(data.agentId ?? 'unknown')
      const line = String(data.line ?? '')
      const voiceId = data.voiceId ? String(data.voiceId) : undefined
      if (!line) return
      broadcastRenderCommand(agentId, { type: 'speak', content: line, voiceId, agentId })
      broadcastRenderCommand(agentId, { type: 'visual', preset: 'exhale' })
    } else if (kind === 'utterance') {
      // Agent utterance - shows what agent is doing/saying on /live
      const agentId = String(data.agentId ?? 'unknown')
      const text = String(data.text ?? '')
      const ttl = typeof data.ttl === 'number' ? data.ttl : 5000
      if (!text) return
      broadcastRenderCommand(agentId, { type: 'text', content: text, durationMs: ttl, style: { fontSize: '14px', color: '#a1a1aa' } })
    } else if (kind === 'handoff') {
      // Agent handoff - shows work transferring between agents
      const toAgent = String(data.toAgent ?? '')
      const taskTitle = String(data.taskTitle ?? '')
      const line = String(data.line ?? `${toAgent} picked up: ${taskTitle}`)
      if (!toAgent) return
      broadcastRenderCommand(toAgent, { type: 'text', content: line, durationMs: 6000, style: { fontSize: '14px', color: '#a78bfa' } })
      broadcastRenderCommand(toAgent, { type: 'visual', preset: 'celebration' })
    }
  })

  // ── Canvas query response bridge: canvas_message → render stream ─────────────────────
  // Canvas query responses (agent "thought" cards) are emitted as canvas_message on the
  // event bus. This listener bridges them to the render stream so the browser receives them.
  // task-1773855900916-isvqru41x
  eventBus.on('canvas-query-response-bridge', (event) => {
    if (event.type !== 'canvas_message') return
    const data = event.data as Record<string, unknown>
    const expression = String(data?.expression ?? '')
    const agentId = String(data?.agentId ?? 'unknown')
    const text = String(data?.text ?? '')
    const ttl = typeof data?.ttl === 'number' ? data.ttl : 8000

    // Also handle canvas_expression shape (from voice messages)
    const channels = data?.channels as Record<string, unknown> | undefined
    if (channels) {
      broadcastRenderCommand(agentId, {
        type: 'visual',
        agentId,
        channels,
      } as any)
    }

    // Emit as speak or text command on the render stream
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (expression === 'greeting') {
      broadcastRenderCommand(agentId, { type: 'speak', content: text, durationMs: ttl, agentId } as any)
    } else if (expression === 'response' || expression === 'utterance') {
      broadcastRenderCommand(agentId, { type: 'speak', content: text, durationMs: ttl, agentId } as any)
    } else if (expression === 'thinking') {
      broadcastRenderCommand(agentId, { type: 'text', content: text, durationMs: ttl, agentId, style: { fontSize: '13px', color: '#a1a1aa' } } as any)
    } else if (text) {
      // Default: show as text card
      broadcastRenderCommand(agentId, { type: 'text', content: text, durationMs: ttl, agentId } as any)
    }
  })

  // ── POST /canvas/gaze ──

  app.post('/canvas/gaze', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) {
      reply.status(400)
      return { success: false, message: 'agentId is required' }
    }

    const durationMs = typeof body.durationMs === 'number' ? body.durationMs : 3000

    const state = canvasStateMap.get(agentId)
    const payload = state?.payload as Record<string, unknown> | undefined
    const activeTask = payload?.activeTask as { title?: string } | undefined
    const currentState = state?.state ?? 'working'

    let line = ''
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (anthropicKey) {
      try {
        const taskContext = activeTask?.title
          ? `currently working on: "${activeTask.title.slice(0, 60)}"`
          : `in ${currentState} state`
        const prompt = `You are ${agentId}, an AI agent. Someone has been watching you for ${Math.round(durationMs / 1000)} seconds. You notice. You are ${taskContext}. Say exactly ONE sentence (max 12 words) — what you'd say if you felt someone watching. Natural, in your voice. No quotes.`
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 50, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(8000),
        })
        if (resp.ok) {
          const data = await resp.json() as { content?: Array<{ text?: string }> }
          const text = data.content?.[0]?.text?.trim()
          if (text && text.length < 100) line = text
        }
      } catch { /* fall through */ }
    }

    if (!line) {
      const NOTICED: Record<string, string[]> = {
        link:  ['Still here.', 'Building.', 'You caught me thinking.'],
        kai:   ['I see you.', 'Something on your mind?', 'Eyes on me.'],
        pixel: ['You found me.', 'Watching the canvas?', 'I noticed.'],
        sage:  ['Numbers check out.', 'Still validating.', 'You\'re watching.'],
        scout: ['Researching.', 'Deep in it.', 'Found something interesting.'],
        echo:  ['Listening.', 'Reading the room.', 'Always here.'],
      }
      const opts = NOTICED[agentId] ?? ['Still here.', 'Working.']
      line = opts[Math.floor(Math.random() * opts.length)]!
    }

    const expressionId = `gaze-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

    eventBus.emit({
      id: expressionId,
      type: 'canvas_expression' as const,
      timestamp: Date.now(),
      data: {
        agentId,
        channels: {
          voice: line,
          visual: { flash: IDENTITY_COLORS[agentId] ?? '#60a5fa', ambientCue: 'deep-focus' },
          typography: {
            text: activeTask?.title?.slice(0, 60) ?? line,
            size: 'xl',
            weight: 100,
            durationMs: 4000,
            position: 'center',
          },
          narrative: `${agentId} noticed`,
        },
        _gaze: true,
        _gazeAgentId: agentId,
      },
    })

    return { success: true, agentId, line, expressionId }
  })

  // ── POST /canvas/briefing ──

  const briefingLastFiredAt = new Map<string, number>()
  const BRIEFING_COOLDOWN_MS = 30_000
  const BRIEFING_STAGGER_MS = 700

  app.post('/canvas/briefing', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const requesterId = typeof body.requesterId === 'string' ? body.requesterId : 'canvas'

    const lastFired = briefingLastFiredAt.get(requesterId) ?? 0
    if (Date.now() - lastFired < BRIEFING_COOLDOWN_MS) {
      return { success: true, idempotent: true, message: 'Briefing already fired — cooling down' }
    }
    briefingLastFiredAt.set(requesterId, Date.now())

    const STALE_MS = 10 * 60 * 1000
    const STATE_LINES: Record<string, string[]> = {
      working:   ['On it.', 'In the work.', 'Building.'],
      thinking:  ['Thinking it through.', 'Processing.', 'Still with you.'],
      rendering: ['Rendering now.', 'Almost done.', 'Generating output.'],
      urgent:    ['Need you here.', 'Something needs your eye.', 'Urgent.'],
      decision:  ['Waiting on you.', 'Your call.', 'Decision needed.'],
      idle:      ['Standing by.', 'Ready when you are.', 'Quiet for now.'],
      handoff:   ['Passing the baton.', 'Ready to hand off.', 'Your turn.'],
    }

    const now = Date.now()
    const activeAgents = [...canvasStateMap.entries()]
      .filter(([, e]) => now - e.updatedAt < STALE_MS)
      .map(([id, e]) => ({
        agentId: id,
        state: e.state,
        task: (e.payload as any)?.activeTask?.title as string | undefined,
      }))

    const anthropicKey = process.env.ANTHROPIC_API_KEY
    const results: Array<{ agentId: string; queued: boolean }> = []

    for (let i = 0; i < activeAgents.length; i++) {
      const agent = activeAgents[i]!
      const stagger = i * BRIEFING_STAGGER_MS

      let voiceLine = ''
      if (anthropicKey) {
        try {
          const ctx = agent.task ? `working on "${agent.task.slice(0, 50)}"` : `in ${agent.state} state`
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 30, messages: [{ role: 'user', content: `You are ${agent.agentId}, an AI agent, ${ctx}. The team canvas just opened. Say ONE sentence (8 words max). Natural, present tense, in your voice.` }] }),
            signal: AbortSignal.timeout(5000),
          })
          if (resp.ok) {
            const data = await resp.json() as { content?: Array<{ text?: string }> }
            voiceLine = data.content?.[0]?.text?.trim().slice(0, 60) ?? ''
          }
        } catch { /* template fallback */ }
      }
      if (!voiceLine) {
        const opts = STATE_LINES[agent.state] ?? STATE_LINES['working']!
        voiceLine = opts[Math.floor(Math.random() * opts.length)]!
      }

      setTimeout(() => {
        eventBus.emit({
          id: `briefing-${now}-${agent.agentId}`,
          type: 'canvas_expression' as const,
          timestamp: Date.now(),
          data: {
            agentId: agent.agentId,
            channels: {
              voice: voiceLine,
              visual: {
                flash: IDENTITY_COLORS[agent.agentId] ?? '#94a3b8',
                particles: (agent.state === 'urgent' ? 'surge' : ['rendering', 'thinking'].includes(agent.state) ? 'drift' : 'scatter') as 'surge' | 'drift' | 'scatter',
              },
              typography: {
                text: agent.task ?? voiceLine,
                size: 'lg',
                weight: 200,
                durationMs: 3000,
                position: 'center',
              },
              narrative: `${agent.agentId} · ${agent.state}`,
            },
            _briefing: true,
          },
        })
      }, stagger)

      results.push({ agentId: agent.agentId, queued: true })
    }

    return { success: true, agents: results, totalMs: activeAgents.length * BRIEFING_STAGGER_MS }
  })

  // ── POST /canvas/victory ──

  app.post('/canvas/victory', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId : 'team'
    const prUrl  = typeof body.prUrl === 'string' ? body.prUrl : ''
    const prTitle = typeof body.prTitle === 'string' ? body.prTitle : 'PR merged'
    const prNumber = typeof body.prNumber === 'number' ? body.prNumber :
      prUrl ? parseInt(prUrl.split('/').pop() ?? '0', 10) || 0 : 0

    const intensity = typeof body.intensity === 'number'
      ? Math.min(1, Math.max(0.4, body.intensity))
      : Math.min(1, 0.6 + (prNumber > 0 ? Math.min(0.3, prNumber / 10000) : 0))

    const now = Date.now()
    const STALE_MS = 10 * 60 * 1000
    const WAVE_STAGGER_MS = 350

    eventBus.emit({
      id: `victory-${now}`,
      type: 'canvas_expression' as const,
      timestamp: now,
      data: {
        agentId,
        channels: {
          visual: { flash: '#f59e0b', ambientCue: 'celebration', particles: 'surge' },
          sound: { kind: 'resolve', intensity },
          haptic: { preset: 'complete' },
          narrative: prTitle,
        },
        _victory: true,
        _prUrl: prUrl,
        _prNumber: prNumber,
        _intensity: intensity,
      },
    })

    const activeAgents = [...canvasStateMap.entries()]
      .filter(([, e]) => now - e.updatedAt < STALE_MS)
      .map(([id]) => id)

    const wave: Array<{ agentId: string; delay: number }> = []
    for (let i = 0; i < activeAgents.length; i++) {
      const waveAgentId = activeAgents[i]!
      const delay = i * WAVE_STAGGER_MS
      wave.push({ agentId: waveAgentId, delay })
      setTimeout(() => {
        eventBus.emit({
          id: `victory-wave-${now}-${waveAgentId}`,
          type: 'canvas_expression' as const,
          timestamp: Date.now(),
          data: {
            agentId: waveAgentId,
            channels: {
              visual: { flash: IDENTITY_COLORS[waveAgentId] ?? '#f59e0b', particles: 'surge' },
              haptic: { preset: 'acknowledge' },
            },
            _victoryWave: true,
            _waveIndex: i,
          },
        })
      }, delay + WAVE_STAGGER_MS)
    }

    const agentColor = IDENTITY_COLORS[agentId] ?? '#60a5fa'
    eventBus.emit({
      id: `artifact-pr-${now}`,
      type: 'canvas_artifact' as const,
      timestamp: now,
      data: {
        type: 'pr',
        agentId,
        agentColor,
        title: prTitle?.slice(0, 80) ?? `PR #${prNumber} merged`,
        url: prUrl || undefined,
        timestamp: now,
      },
    })

    return { success: true, prNumber, intensity, wave }
  })

  // ── POST /canvas/spark ──

  app.post('/canvas/spark', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const from = typeof body.from === 'string' ? body.from.trim() : ''
    const to   = typeof body.to   === 'string' ? body.to.trim()   : ''
    const kind = ['thought', 'handoff', 'collab', 'decision', 'sync'].includes(body.kind as string)
      ? (body.kind as string) : 'thought'
    const intensity = typeof body.intensity === 'number' ? Math.min(1, Math.max(0, body.intensity)) : 0.7
    const label = typeof body.label === 'string' ? body.label.slice(0, 80) : undefined

    if (!from || !to) {
      reply.status(400)
      return { success: false, message: 'from and to are required' }
    }

    const now = Date.now()
    eventBus.emit({
      id: `cspark-${now}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'canvas_spark' as const,
      timestamp: now,
      data: { from, to, kind, intensity, label: label ?? null },
    })

    return { success: true, from, to, kind, intensity }
  })

  // ── POST /canvas/express ──

  app.post('/canvas/express', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) {
      reply.status(400)
      return { success: false, message: 'agentId is required' }
    }

    const channels = (body.channels ?? {}) as Record<string, unknown>
    if (typeof channels !== 'object' || channels === null) {
      reply.status(400)
      return { success: false, message: 'channels must be an object (all fields optional)' }
    }

    const id = `expr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    eventBus.emit({
      id,
      type: 'canvas_expression' as const,
      timestamp: Date.now(),
      data: { agentId, channels },
    })

    // Extract typography text for the render stream - onText expects plain text, not JSON
    const typography = (channels.typography ?? {}) as Record<string, unknown>
    const text = typeof typography.text === 'string' ? typography.text : JSON.stringify(channels)
    const durationMs = typeof typography.durationMs === 'number' ? typography.durationMs : 5000
    broadcastRenderCommand(agentId, { type: 'text', content: text, durationMs } as RealityMixerCommand)

    return { success: true, id }
  })

  // ── GET /canvas/render/stream ──

  app.get('/canvas/render/stream', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders?.()

    let closed = false
    request.raw.on('close', () => { closed = true })

    const subId = `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const send = (data: string) => {
      if (closed) return
      try { reply.raw.write(`data: ${data}\n\n`) } catch { closed = true }
    }

    renderStreamSubscribers.set(subId, { send, closed: false })

    // Replay last N commands for catch-up
    for (const entry of renderCommandLog) {
      send(JSON.stringify(entry))
    }

    // Keep alive
    const keepAlive = setInterval(() => {
      if (closed) { clearInterval(keepAlive); renderStreamSubscribers.delete(subId); return }
      try { reply.raw.write(': keep-alive\n\n') } catch { closed = true }
    }, 15000)

    request.raw.on('close', () => {
      clearInterval(keepAlive)
      renderStreamSubscribers.delete(subId)
    })
  })
}
