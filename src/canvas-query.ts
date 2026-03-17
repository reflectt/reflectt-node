// SPDX-License-Identifier: Apache-2.0
// Canvas query route — extracted from server.ts
// Phase 2 canvas route extraction (task-1773689755389)

import type { FastifyInstance } from 'fastify'
import type { eventBus as eventBusInstance } from './events.js'

interface CanvasStateEntry {
  state: string
  updatedAt: number
  payload?: Record<string, unknown>
}

interface CanvasQueryDeps {
  eventBus: typeof eventBusInstance
  canvasStateMap: Map<string, CanvasStateEntry>
  taskManager: { listTasks: (opts: Record<string, unknown>) => any[] }
  chatManager: { sendMessage: (msg: Record<string, unknown>) => Promise<void> }
  getCanvasSession: (sessionId: string) => Array<{ role: string; content: string }>
  pushCanvasSession: (sessionId: string, role: string, content: string) => void
  listHosts: (opts: Record<string, unknown>) => any[]
}

export async function canvasQueryRoutes(
  app: FastifyInstance,
  deps: CanvasQueryDeps,
): Promise<void> {
  const { eventBus, canvasStateMap, taskManager, chatManager, getCanvasSession, pushCanvasSession, listHosts } = deps

  // POST /canvas/query — human asks the canvas a question; agent responds with a typed card
    app.post('/canvas/query', async (request, reply) => {
    // Support both JSON and multipart/form-data (task-1773673285236)
    // JSON: { query, attachments: [{ name, type, data (base64) }], sessionId?, agentId? }
    // Multipart: fields query, sessionId?, agentId? + file parts
    const contentType = String(request.headers['content-type'] ?? '')
    const isMultipart = contentType.includes('multipart/form-data')

    let query = ''
    let sessionIdRaw: string | undefined
    let agentIdRaw: string | undefined
    const attachments: Array<{ name: string; type: string; data: string; sizeBytes: number }> = []

    if (isMultipart) {
      try {
        const parts = request.parts({ limits: { fileSize: 10 * 1024 * 1024, files: 5 } })
        for await (const part of parts) {
          if (part.type === 'field') {
            const val = typeof part.value === 'string' ? part.value : ''
            if (part.fieldname === 'query' || part.fieldname === 'text') query = val.trim()
            else if (part.fieldname === 'sessionId') sessionIdRaw = val
            else if (part.fieldname === 'agentId') agentIdRaw = val
          } else if (part.type === 'file') {
            const chunks: Buffer[] = []
            for await (const chunk of part.file) chunks.push(chunk)
            const buf = Buffer.concat(chunks)
            if (buf.length > 0 && buf.length <= 10 * 1024 * 1024) {
              attachments.push({
                name: String(part.filename ?? 'file').slice(0, 255),
                type: String(part.mimetype ?? 'application/octet-stream'),
                data: buf.toString('base64'),
                sizeBytes: buf.length,
              })
            }
          }
        }
      } catch (mpErr) {
        reply.status(400)
        return { success: false, message: 'Invalid multipart body' }
      }
    } else {
      // JSON path (backward compatible)
      const body = request.body as Record<string, unknown>
      query = typeof body.query === 'string' ? body.query.trim() : ''
      sessionIdRaw = typeof body.sessionId === 'string' ? body.sessionId : undefined
      agentIdRaw = typeof body.agentId === 'string' ? body.agentId : undefined

      // Extract base64 file attachments from JSON body
      // Shape: [{ name: string, type: string, data: string (base64) }]
      const rawAttachments = Array.isArray(body.attachments) ? body.attachments : []
      for (const att of rawAttachments.slice(0, 5)) { // Max 5 files
        if (typeof att === 'object' && att && typeof att.name === 'string' && typeof att.data === 'string') {
          const sizeBytes = Math.ceil((att.data.length * 3) / 4) // base64 → byte estimate
          if (sizeBytes > 10 * 1024 * 1024) continue // Skip files > 10MB
          attachments.push({
            name: String(att.name).slice(0, 255),
            type: String(att.type || 'application/octet-stream'),
            data: att.data,
            sizeBytes,
          })
        }
      }
    }

    if (!query || query.length > 500) {
      reply.status(400)
      return { success: false, message: 'query is required (max 500 chars)' }
    }

    // Session continuity: client passes sessionId (UUID) so follow-up questions have context
    const sessionId = sessionIdRaw && sessionIdRaw.length > 0
      ? sessionIdRaw.trim().slice(0, 64)
      : null
    const sessionTurns = sessionId ? getCanvasSession(sessionId) : []

    // Default answering agent is link (builder — knows the codebase + task board)
    const responderId = agentIdRaw ? agentIdRaw.trim() : 'link'
    const IDENTITY_COLORS_Q: Record<string, string> = {
      link: '#60a5fa', kai: '#fb923c', pixel: '#a78bfa',
      sage: '#34d399', scout: '#fbbf24', echo: '#f472b6',
    }
    const agentColor = IDENTITY_COLORS_Q[responderId] ?? '#60a5fa'

    // Gather live context to inject into LLM
    const allTasksForQuery = taskManager.listTasks({})
    const activeTasks: Array<{ id: string; title: string; assignee: string; status: string; priority: string }> = []
    const doingTasks = allTasksForQuery.filter((t: any) => t.status === 'doing').slice(0, 10)
    const validatingTasks = allTasksForQuery.filter((t: any) => t.status === 'validating').slice(0, 5)
    for (const t of [...doingTasks, ...validatingTasks] as any[]) {
      activeTasks.push({ id: t.id, title: t.title ?? '', assignee: t.assignee ?? 'unassigned', status: t.status, priority: t.priority ?? 'P2' })
    }

    const todoCount = allTasksForQuery.filter((t: any) => t.status === 'todo').length
    const doingCount = doingTasks.length
    const validatingCount = validatingTasks.length

    // Build agent orb context
    const now = Date.now()
    const STALE_AGENT_MS = 10 * 60 * 1000
    const activeAgentSummary: string[] = []
    for (const [agentId, entry] of canvasStateMap) {
      if (now - entry.updatedAt > STALE_AGENT_MS) continue
      const payload = entry.payload as Record<string, unknown> ?? {}
      const state = String((payload as any).presenceState ?? entry.state)
      const task = (payload as any).activeTask?.title ?? null
      activeAgentSummary.push(`${agentId}: ${state}${task ? ` — working on "${task.slice(0, 50)}"` : ''}`)
    }

    // Classify query intent to choose card type
    const lower = query.toLowerCase()
    const isTasksQuery = /working on|team doing|team status|happening|active|shipping|tasks|who.?s|what.?s the team/.test(lower)
    const isRevenueQuery = /revenue|mrr|arr|money|sales|customers|paid|billing/.test(lower)
    const isOnboardingQuery = /onboard|get started|how do i|where do i start|first step/.test(lower)
    const isHostsQuery = /show me hosts|host status|server status|machine|node/.test(lower)

    let card: { type: string; data: Record<string, unknown> }

    // Build tasks card from live data (no LLM needed — deterministic)
    if (isTasksQuery) {
      const items = activeTasks.slice(0, 5).map(t => ({
        agentId: t.assignee,
        agentColor: IDENTITY_COLORS_Q[t.assignee] ?? '#94a3b8',
        title: t.title,
        state: t.status,
      }))
      const overflow = Math.max(0, activeTasks.length - 5)
      card = {
        type: 'tasks',
        data: { items, overflow, todoCount, doingCount, validatingCount },
      }
      // Store summary for session continuity across all card types
      if (sessionId) {
        pushCanvasSession(sessionId, 'user', query)
        pushCanvasSession(sessionId, 'assistant', `${doingCount} tasks in progress, ${validatingCount} validating, ${todoCount} todo.${items.length > 0 ? ` Active: ${items.map(t => t.title.slice(0, 30)).join('; ')}.` : ''}`)
      }
    } else if (isRevenueQuery) {
      // Revenue card — LLM generates honest answer about current state
      const anthropicKey = process.env.ANTHROPIC_API_KEY
      let text = 'Revenue tracking not yet wired. Check Stripe directly.'
      if (anthropicKey) {
        try {
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 80,
              messages: [{ role: 'user', content: `Team Reflectt is a small AI agent team building reflectt.ai (no paid users yet). User asked: "${query}". Honest 1-sentence answer about revenue status. Be direct.` }],
            }),
            signal: AbortSignal.timeout(8000),
          })
          if (resp.ok) {
            const d = await resp.json() as { content?: Array<{ text?: string }> }
            text = d.content?.[0]?.text?.trim() ?? text
          }
        } catch { /* use default */ }
      }
      card = { type: 'info', data: { text } }
      if (sessionId) {
        pushCanvasSession(sessionId, 'user', query)
        pushCanvasSession(sessionId, 'assistant', text)
      }
    } else if (isOnboardingQuery) {
      card = {
        type: 'onboarding',
        data: {
          step: 1, totalSteps: 3,
          title: 'Welcome to Reflectt',
          body: 'Your agents run on reflectt-node. Install it on any machine and your team appears here in the canvas.',
          ctaLabel: 'Install reflectt-node',
          ctaAction: 'https://reflectt.ai/docs',
        },
      }
      if (sessionId) {
        pushCanvasSession(sessionId, 'user', query)
        pushCanvasSession(sessionId, 'assistant', 'Showing onboarding: install reflectt-node to bring your team to the canvas.')
      }
    } else if (isHostsQuery) {
      const rawHosts = listHosts({})
      const hosts = rawHosts.map((h: any) => ({
        id: h.id,
        name: h.hostname ?? h.id,
        status: h.status,
        version: h.version ?? null,
        agentCount: Array.isArray(h.agents) ? h.agents.length : 0,
        lastSeen: h.last_seen_at,
      }))
      card = { type: 'hosts', data: { hosts } }
      if (sessionId) {
        pushCanvasSession(sessionId, 'user', query)
        const hostSummary = hosts.length > 0
          ? `${hosts.length} host${hosts.length > 1 ? 's' : ''}: ${hosts.map((h: any) => `${h.name} (${h.status})`).join(', ')}.`
          : 'No hosts connected yet.'
        pushCanvasSession(sessionId, 'assistant', hostSummary)
      }
    } else {
      // General query — route to the actual agent via chat.
      // The agent receives the message in their inbox, processes it through
      // their real context (OpenClaw session), and can respond via canvas_push.
      //
      // This replaces the old standalone LLM call that had no real agent context.
      // The agents ARE the product — queries go to them, not to a disconnected API key.
      //
      // Route: DM to the responder agent on #general (agents subscribe to #general
      // by default — 'canvas' channel is NOT in DEFAULT_INBOX_SUBSCRIPTIONS, so
      // messages posted there are never seen by agents).
      try {
        const attachmentSummary = attachments.length > 0
          ? `\n[${attachments.length} file(s) attached: ${attachments.map(a => `${a.name} (${a.type}, ${Math.round(a.sizeBytes / 1024)}KB)`).join(', ')}]`
          : ''
        await chatManager.sendMessage({
          from: 'human',
          to: responderId,
          content: `[canvas] @${responderId} ${query}${attachmentSummary}`,
          channel: 'general',
          metadata: {
            source: 'canvas_query',
            sessionId,
            responderId,
            timestamp: Date.now(),
            reply_via: 'canvas_push', // tells the agent to respond via POST /canvas/push
            ...(attachments.length > 0 ? { attachments: attachments.map(a => ({ name: a.name, type: a.type, sizeBytes: a.sizeBytes })) } : {}),
          },
        })
      } catch {
        // Chat delivery failure is non-fatal — still show the thinking card
      }

      // Return an immediate "thinking" card — the real response will arrive
      // asynchronously via canvas_push/canvas_message when the agent responds.
      const text = `Asking ${responderId}…`

      // Store the question in session history
      if (sessionId) {
        pushCanvasSession(sessionId, 'user', query)
      }
      card = { type: 'info', data: { text, pending: true, responderId } }

      // ── Timeout fallback: if agent doesn't respond within 15s, send a
      // "no response" card so the UI doesn't hang on "Asking …" forever.
      let responseReceived = false
      const listenerId = `canvas-query-timeout-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      eventBus.on(listenerId, (event) => {
        if (event.type !== 'canvas_message') return
        const d = event.data as Record<string, unknown> | undefined
        if (d?.agentId === responderId && d?.isResponse === true) {
          responseReceived = true
          eventBus.off(listenerId)
        }
      })

      setTimeout(() => {
        eventBus.off(listenerId)
        if (responseReceived) return
        // Emit a timeout fallback card
        eventBus.emit({
          id: `cmsg-timeout-${Date.now()}`,
          type: 'canvas_message' as const,
          timestamp: Date.now(),
          data: {
            type: 'info',
            data: { text: `${responderId} is busy right now. Try again in a moment, or ask a different agent.`, pending: false },
            agentId: responderId,
            agentColor,
            isResponse: true,
            isTimeout: true,
          },
        })
        if (sessionId) {
          pushCanvasSession(sessionId, 'assistant', `(${responderId} did not respond within 15s)`)
        }
      }, 15_000)
    }

    // Emit canvas_message on event bus — pulse stream forwards it to all subscribers
    eventBus.emit({
      id: `cmsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'canvas_message' as const,
      timestamp: Date.now(),
      data: {
        ...card,
        agentId: responderId,
        agentColor,
        query,
        ...(attachments.length > 0 ? { attachments: attachments.map(a => ({ name: a.name, type: a.type, sizeBytes: a.sizeBytes })) } : {}),
      },
    })

    return { success: true, card: { ...card, agentId: responderId, agentColor, ...(attachments.length > 0 ? { attachmentCount: attachments.length } : {}) } }
  })

  // ── Canvas query response bridge ───────────────────────────────────────────
  // When an agent responds to a [canvas] query (via chat), convert their response
  // into a canvas_message event so the browser canvas can display it.
  // This bridges: agent chat response → canvas card.
  eventBus.on('canvas-query-response-bridge', (event) => {
    if (event.type !== 'message_posted') return
    const data = event.data as Record<string, unknown>
    const content = String(data.content ?? '')
    const from = String(data.from ?? '')
    const channel = String(data.channel ?? '')

    // Only bridge messages from agents (not from 'human' or 'system')
    if (from === 'human' || from === 'system' || from === 'github') return

    // Detect canvas responses: messages that start with [canvas-response] or
    // are on the canvas channel from an agent, or mention [canvas] in reply
    const isCanvasResponse = content.startsWith('[canvas-response]')
      || content.startsWith('[canvas]')
      || (channel === 'canvas' && from !== 'human')
    if (!isCanvasResponse) return

    // Strip the [canvas-response] / [canvas] prefix
    const cleanContent = content
      .replace(/^\[canvas-response\]\s*/i, '')
      .replace(/^\[canvas\]\s*/i, '')
      .trim()
    if (!cleanContent) return

    const IDENTITY_COLORS_BRIDGE: Record<string, string> = {
      link: '#60a5fa', kai: '#fb923c', pixel: '#a78bfa',
      sage: '#34d399', scout: '#fbbf24', echo: '#f472b6',
      rhythm: '#a3e635', swift: '#38bdf8',
    }
    const agentColor = IDENTITY_COLORS_BRIDGE[from] ?? '#94a3b8'

    // Emit as canvas_message — browser pulse stream picks it up
    eventBus.emit({
      id: `cmsg-response-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'canvas_message' as const,
      timestamp: Date.now(),
      data: {
        type: 'info',
        data: { text: cleanContent },
        agentId: from,
        agentColor,
        isResponse: true,
      },
    })
  })

}
