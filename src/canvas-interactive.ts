// SPDX-License-Identifier: Apache-2.0
// Canvas interactive routes — gaze, briefing, victory, spark, express
// Extracted from server.ts for Phase 2 canvas route extraction (task-1773689755389)

import type { FastifyInstance } from 'fastify'
import type { eventBus as eventBusInstance } from './events.js'
import { getDb } from './db.js'

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

// ── Capability map ──────────────────────────────────────────────────────────────
export type CapabilityId = 'email' | 'sms' | 'voice' | 'phone' | 'browser' | 'memory' | 'tasks' | 'canvas' | 'github' | 'sentry' | 'chat' | 'storage'
export type CapabilityStatus = 'active' | 'warning' | 'offline'
export interface Capability { id: CapabilityId; status: CapabilityStatus; label?: string; detail?: string }
export interface AgentCapabilities { agentId: string; agentName: string; capabilities: Capability[]; updatedAt: number }
const agentCapabilitiesMap = new Map<string, AgentCapabilities>()

/**
 * Seed the capability map with platform integrations on startup.
 * In production, agents self-register via POST /canvas/capability.
 * This seeds the map so the UI always has real data to display.
 */
export function seedCapabilityMap(agents: Array<{ name: string; role?: string }>): void {
  const PLATFORM_CAPABILITIES: Capability[] = [
    { id: 'tasks', status: 'active', label: 'Tasks', detail: 'Create, assign, and track tasks' },
    { id: 'canvas', status: 'active', label: 'Canvas', detail: 'Live visual canvas with orbs and panels' },
    { id: 'chat', status: 'active', label: 'Chat', detail: 'Team messaging and coordination' },
    { id: 'voice', status: process.env.KOKORO_MODEL_PATH ? 'active' : 'offline', label: 'Voice', detail: 'Speech synthesis via Kokoro TTS' },
    { id: 'github', status: process.env.REFLECTT_GITHUB_APP_PRIVATE_KEY_SECRET ? 'active' : 'offline', label: 'GitHub', detail: 'PR creation and repository management' },
    { id: 'sentry', status: process.env.SENTRY_DSN ? 'active' : 'offline', label: 'Sentry', detail: 'Error tracking and performance monitoring' },
    { id: 'email', status: process.env.RESEND_API_KEY ? 'active' : 'offline', label: 'Email', detail: 'Transactional email via Resend' },
    { id: 'storage', status: 'active', label: 'Storage', detail: 'Artifact store and file attachments' },
    { id: 'browser', status: 'active', label: 'Browser', detail: 'Web browsing and scraping via browser toolkit' },
  ]

  for (const agent of agents) {
    // All agents get core platform capabilities
    const coreCaps = PLATFORM_CAPABILITIES.filter(c => c.status === 'active')
    // Role-specific extras
    const roleExtras: CapabilityId[] = agent.role === 'builder' || agent.role === 'backend'
      ? ['memory']
      : agent.role === 'designer' || agent.role === 'frontend'
      ? ['browser']
      : []
    const allCaps = [
      ...coreCaps,
      ...PLATFORM_CAPABILITIES.filter(c => roleExtras.includes(c.id)),
    ]
    agentCapabilitiesMap.set(agent.name, {
      agentId: agent.name,
      agentName: agent.name,
      capabilities: allCaps,
      updatedAt: Date.now(),
    })
  }
}

export { agentCapabilitiesMap }

function broadcastCapabilityEvent(agentId: string, caps: Capability[]) {
  const payload = JSON.stringify({ type: 'capability_setup', agentId, capabilities: caps, updatedAt: Date.now() })
  for (const [subId, sub] of renderStreamSubscribers) {
    if (sub.closed) { renderStreamSubscribers.delete(subId); continue }
    try { sub.send(payload) } catch { sub.closed = true; renderStreamSubscribers.delete(subId) }
  }
}

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

  // ── TTS: Kokoro audio generation + cache ─────────────────────────────────
  const KOKORO_BASE = process.env.KOKORO_BASE_URL || process.env.KOKORO_BASE
  const TTS_TTL = 30 * 60 * 1000
  const ttsCache = new Map<string, { audio: Buffer; ts: number }>()

  async function hashTts(text: string, voice: string): Promise<string> {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text + voice))
    return Array.from(new Uint8Array(h)).map((b: number) => b.toString(16).padStart(2, '0')).join('')
  }

  const ELEVEN_BASE = 'https://api.elevenlabs.io/v1'
  const ELEVEN_API_KEY = process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY
  // No hardcoded voice maps — agents own their identity via agent_config.
  // Generic fallbacks for agents that haven't claimed a voice.
  const KOKORO_DEFAULT_VOICE = process.env.KOKORO_DEFAULT_VOICE_ID || 'af_sarah'
  const ELEVENLABS_DEFAULT_VOICE = process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'

  function getClaimedVoice(agentId: string): { kokoro: string; eleven: string } {
    try {
      const row = getDb().prepare('SELECT settings FROM agent_config WHERE agent_id = ?').get(agentId) as { settings: string } | undefined
      if (row) {
        const settings = JSON.parse(row.settings)
        if (settings?.voice) return { kokoro: settings.voice, eleven: settings.voice }
      }
    } catch { /* fall through to defaults */ }
    return { kokoro: KOKORO_DEFAULT_VOICE, eleven: ELEVENLABS_DEFAULT_VOICE }
  }

  async function makeTts(text: string, agentId: string): Promise<{ url: string; ms: number } | null> {
    const claimed = getClaimedVoice(agentId)
    const kokoroVoice = claimed.kokoro
    const elevenVoice = claimed.eleven
    const key = await hashTts(text, kokoroVoice)
    const cached = ttsCache.get(key)
    if (cached && Date.now() - cached.ts < TTS_TTL) return { url: '/audio/' + key, ms: Math.round(text.length * 50) }

    // Try Kokoro first (120s timeout — Fly free tier cold starts take 60-90s)
    if (KOKORO_BASE) {
      try {
        console.log(`[voice] Kokoro fetch: ${KOKORO_BASE}/v1/audio/speech voice=${kokoroVoice} text="${text.substring(0, 30)}..."`)
        const ac = new AbortController()
        setTimeout(() => ac.abort(), 120_000)
        const r = await fetch(KOKORO_BASE + '/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'kokoro', input: text, voice: kokoroVoice }),
          signal: ac.signal,
        })
        console.log(`[voice] Kokoro response: status=${r.status} ok=${r.ok}`)
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer())
          console.log(`[voice] Kokoro audio: ${buf.byteLength} bytes, caching as ${key}`)
          ttsCache.set(key, { audio: buf, ts: Date.now() })
          return { url: '/audio/' + key, ms: Math.round(text.length * 50) }
        }
      } catch (err) {
        console.error(`[voice] Kokoro error:`, err instanceof Error ? err.message : err)
        /* fall through to ElevenLabs */
      }
    } else {
      console.warn(`[voice] KOKORO_BASE not set — skipping Kokoro`)
    }

    // ElevenLabs fallback
    if (ELEVEN_API_KEY) {
      try {
        const ac = new AbortController()
        setTimeout(() => ac.abort(), 10000)
        const r = await fetch(ELEVEN_BASE + '/text-to-speech/' + elevenVoice, {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': ELEVEN_API_KEY,
          },
          body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1', voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
          signal: ac.signal,
        })
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer())
          ttsCache.set(key, { audio: buf, ts: Date.now() })
          return { url: '/audio/' + key, ms: Math.round(text.length * 50) }
        }
      } catch { return null }
    }

    return null
  }

  // ── Audio cache retrieval ─────────────────────────────────────────────────
  app.get('/audio/:id', (req: any, reply: any) => {
    const e = ttsCache.get((req.params as any).id)
    if (!e || Date.now() - e.ts > TTS_TTL) {
      reply.status(404)
      return { error: 'Not found or expired' }
    }
    reply.header('Content-Type', 'audio/mpeg')
    reply.header('Cache-Control', 'public, max-age=1800')
    return reply.send(e.audio)
  })

  // ── Voice output: async TTS generation + SSE events ─────────────────────────
  // POST /canvas/speak returns immediately, generates in background.
  // Emits voice_queued immediately, voice_output when audio is ready.
  // Clients listen to the render stream SSE for voice events.
  app.post('/canvas/speak', async (req: any, reply: any) => {
    const body = req.body as any
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const agentId = typeof body?.agentId === 'string' ? body.agentId : 'unknown'
    const agentName = typeof body?.agentName === 'string' ? body.agentName : agentId
    if (!text || text.length > 1000) return { error: 'text required, max 1000' }

    // Deterministic ID so clients can match queued → ready events
    const voiceId = await hashTts(text, agentId)
    const estimatedMs = Math.round(text.length * 50)

    // Emit voice_queued immediately so UI can show "speaking" state
    const queuedPayload = JSON.stringify({ type: 'voice_queued', voiceId, text, agentId, agentName, estimatedMs })
    for (const [, client] of renderStreamSubscribers) {
      try { client.send('event: voice_queued\r\ndata: ' + queuedPayload + '\r\n\r\n') } catch {}
    }

    // Generate audio in background — do not await
    makeTts(text, agentId).then(async (result) => {
      if (!result) {
        console.error(`[voice] makeTts returned null for "${text.substring(0, 30)}..." — Kokoro + ElevenLabs both failed`)
        return
      }
      console.log(`[voice] TTS ready: voiceId=${voiceId} url=${result.url} ms=${result.ms}`)
      // Re-emit with audio URL so clients can play
      const event = { type: 'voice_output', voiceId, text, url: result.url, agentId, agentName, durationMs: result.ms }
      const payload = JSON.stringify(event)
      for (const [, client] of renderStreamSubscribers) {
        try { client.send('event: voice_output\r\ndata: ' + payload + '\r\n\r\n') } catch {}
      }
    }).catch((err) => {
      console.error(`[voice] makeTts failed:`, err instanceof Error ? err.message : err)
    })

    return { ok: true, voiceId, estimatedMs }
  })
}

// ── ApprovalCard command ────────────────────────────────────────────────────────
export interface ApprovalCardCommand {
  type: 'render_approval'
  id: string
  agentName: string
  agentColor?: string
  title: string
  description: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  acceptLabel?: string
  modifyLabel?: string
  escalateLabel?: string
  timeoutSeconds?: number
  trustDelta?: number
}

export interface ApprovalDecisionEvent {
  type: 'approval_decision'
  id: string
  decision: 'accept' | 'modify' | 'escalate'
  modifiedValue?: string
}

// ── DecisionCard command ────────────────────────────────────────────────────────
export interface DecisionCardCommand {
  type: 'render_decision'
  id: string
  agentName: string
  agentColor?: string
  title: string
  description?: string
  options: Array<{ id: string; label: string; description?: string }>
}

export interface DecisionSelectEvent {
  type: 'decision_select'
  id: string
  optionId: string
}



// ── Capability registration endpoints ──────────────────────────────────────────
export function registerCapabilityRoutes(app: any) {
  app.get('/canvas/capability', (_req: any, _reply: any) => {
    const all = Array.from(agentCapabilitiesMap.values())
    return { capabilities: all }
  })
  app.post('/canvas/capability', async (req: any, _reply: any) => {
    const { agentId, agentName, capabilities } = req.body as any
    if (!agentId || !Array.isArray(capabilities)) {
      return { error: 'agentId and capabilities[] required' }
    }
    agentCapabilitiesMap.set(agentId, { agentId, agentName: agentName || agentId, capabilities, updatedAt: Date.now() })
    broadcastCapabilityEvent(agentId, capabilities)
    return { ok: true, agentId, count: capabilities.length }
  })
}