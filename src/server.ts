/**
 * Fastify server with REST + WebSocket endpoints
 */
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
import { z } from 'zod'
import { createHash } from 'crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket } from 'ws'
import { serverConfig, isDev } from './config.js'
import { chatManager } from './chat.js'
import { taskManager } from './tasks.js'
import { inboxManager } from './inbox.js'
import type { AgentMessage, Task } from './types.js'
import { handleMCPRequest, handleSSERequest, handleMessagesRequest } from './mcp.js'
import { memoryManager } from './memory.js'
import { eventBus } from './events.js'
import { presenceManager } from './presence.js'
import type { PresenceStatus } from './presence.js'
import { analyticsManager } from './analytics.js'
import { getDashboardHTML } from './dashboard.js'
import { healthMonitor } from './health.js'
import { contentManager } from './content.js'

// Schemas
const SendMessageSchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  content: z.string().min(1),
  channel: z.string().optional(),
  threadId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done']).default('todo'),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  done_criteria: z.array(z.string().min(1)).optional(),
  createdBy: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done']).optional(),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  done_criteria: z.array(z.string().min(1)).optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const RecurringTaskScheduleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('weekly'),
    dayOfWeek: z.number().int().min(0).max(6),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
  }),
  z.object({
    kind: z.literal('interval'),
    everyMs: z.number().int().min(60_000),
    anchorAt: z.number().int().positive().optional(),
  }),
])

const CreateRecurringTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
  done_criteria: z.array(z.string().min(1)).optional(),
  createdBy: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  schedule: RecurringTaskScheduleSchema,
  enabled: z.boolean().optional(),
  status: z.enum(['todo', 'doing', 'blocked', 'validating', 'done']).optional(),
})

const DEFAULT_LIMITS = {
  chatMessages: 50,
  chatSearch: 25,
  inbox: 30,
  unreadMentions: 20,
  activity: 60,
  tasks: 50,
  contentCalendar: 50,
  contentPublished: 50,
} as const

const MAX_LIMITS = {
  chatMessages: 200,
  chatSearch: 100,
  inbox: 100,
  unreadMentions: 100,
  activity: 200,
  tasks: 200,
  contentCalendar: 200,
  contentPublished: 200,
  inboxScanMessages: 150,
  unreadScanMessages: 300,
} as const

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function parseEpochMs(value: string | undefined): number | undefined {
  const parsed = parsePositiveInt(value)
  return parsed
}

function boundedLimit(
  value: string | undefined,
  defaultsTo: number,
  max: number,
): number {
  const parsed = parsePositiveInt(value)
  if (!parsed) return defaultsTo
  return Math.min(parsed, max)
}

function generateWeakETag(payload: unknown): string {
  const body = JSON.stringify(payload)
  const digest = createHash('sha1').update(body).digest('base64url')
  return `W/"${digest}"`
}

function applyConditionalCaching(
  request: FastifyRequest,
  reply: any,
  payload: unknown,
  lastModifiedMs?: number,
): boolean {
  const etag = generateWeakETag(payload)
  reply.header('ETag', etag)
  reply.header('Cache-Control', 'private, max-age=0, must-revalidate')

  if (lastModifiedMs) {
    reply.header('Last-Modified', new Date(lastModifiedMs).toUTCString())
  }

  const ifNoneMatch = request.headers['if-none-match']
  if (ifNoneMatch && ifNoneMatch === etag) {
    reply.code(304).send()
    return true
  }

  const ifModifiedSince = request.headers['if-modified-since']
  if (lastModifiedMs && ifModifiedSince) {
    const sinceMs = Date.parse(ifModifiedSince)
    if (!Number.isNaN(sinceMs) && lastModifiedMs <= sinceMs) {
      reply.code(304).send()
      return true
    }
  }

  return false
}

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: isDev ? {
      transport: {
        target: 'pino-pretty',
      }
    } : true,
  })

  // Register plugins
  await app.register(fastifyCors, {
    origin: serverConfig.corsEnabled ? true : false,
  })

  await app.register(fastifyWebsocket)

  // Request tracking middleware for system health monitoring
  app.addHook('onRequest', async (request) => {
    ;(request as any).startTime = Date.now()
  })

  app.addHook('onResponse', async (request, reply) => {
    const duration = Date.now() - ((request as any).startTime || Date.now())
    healthMonitor.trackRequest(duration)
    
    if (reply.statusCode >= 400) {
      healthMonitor.trackError()
    }
  })

  // Periodic health snapshot (every request, but throttled internally)
  app.addHook('onResponse', async () => {
    await healthMonitor.recordSnapshot().catch(() => {}) // Silent fail
  })

  // System idle nudge watchdog (process-in-code guardrail)
  const idleNudgeTimer = setInterval(() => {
    healthMonitor.runIdleNudgeTick().catch(() => {})
  }, 60 * 1000)
  idleNudgeTimer.unref()

  app.addHook('onClose', async () => {
    clearInterval(idleNudgeTimer)
  })

  // Health check
  app.get('/health', async () => {
    return {
      status: 'ok',
      openclaw: 'not configured',
      chat: chatManager.getStats(),
      tasks: taskManager.getStats(),
      inbox: inboxManager.getStats(),
      timestamp: Date.now(),
    }
  })

  // Team health monitoring
  app.get('/health/team', async (request, reply) => {
    const health = await healthMonitor.getHealth()
    if (applyConditionalCaching(request, reply, health, health.timestamp)) {
      return
    }
    return health
  })

  // Team health compliance payload (dashboard panel)
  app.get('/health/compliance', async (request, reply) => {
    const compliance = await healthMonitor.getCollaborationCompliance()
    const payload = { compliance, timestamp: Date.now() }
    if (applyConditionalCaching(request, reply, payload, payload.timestamp)) {
      return
    }
    return payload
  })

  // Team health summary (quick view)
  app.get('/health/team/summary', async (request, reply) => {
    const summary = await healthMonitor.getSummary()
    const payload = { summary }
    const cacheBucketMs = Math.floor(Date.now() / 30000) * 30000 // 30s cache bucket
    if (applyConditionalCaching(request, reply, payload, cacheBucketMs)) {
      return
    }
    return payload
  })

  // Team health history (trends over time)
  app.get('/health/team/history', async (request) => {
    const query = request.query as Record<string, string>
    const days = query.days ? parseInt(query.days, 10) : 7
    const history = healthMonitor.getHealthHistory(days)
    return { history, count: history.length, days }
  })

  // System health (uptime, performance, errors)
  app.get('/health/system', async () => {
    return healthMonitor.getSystemHealth()
  })

  // Error logs (for debugging)
  app.get('/logs', async (request) => {
    const query = request.query as Record<string, string>
    const level = query.level || 'error'
    const since = query.since ? parseInt(query.since, 10) : Date.now() - (24 * 60 * 60 * 1000)
    
    // For now, return empty array with note
    // In production, this would read from actual log files
    return {
      logs: [],
      message: 'Log storage not implemented yet. Use system logs or monitoring service.',
      level,
      since,
    }
  })

  // ============ DASHBOARD ============

  app.get('/dashboard', async (_request, reply) => {
    reply.type('text/html').send(getDashboardHTML())
  })

  // Serve avatar images
  app.get<{ Params: { filename: string } }>('/avatars/:filename', async (request, reply) => {
    const { filename } = request.params
    // Basic security: only allow .png files with alphanumeric names
    if (!/^[a-z]+\.png$/.test(filename)) {
      return reply.code(404).send({ error: 'Not found' })
    }
    
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')
      
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const publicDir = join(__dirname, '..', 'public', 'avatars')
      const filePath = join(publicDir, filename)
      
      const data = await fs.readFile(filePath)
      reply.type('image/png').send(data)
    } catch (err) {
      reply.code(404).send({ error: 'Avatar not found' })
    }
  })

  // Serve dashboard animations CSS
  app.get('/dashboard-animations.css', async (_request, reply) => {
    try {
      const { promises: fs } = await import('fs')
      const { join } = await import('path')
      const { fileURLToPath } = await import('url')
      const { dirname } = await import('path')
      
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)
      const publicDir = join(__dirname, '..', 'public')
      const filePath = join(publicDir, 'dashboard-animations.css')
      
      const data = await fs.readFile(filePath, 'utf-8')
      reply.type('text/css').send(data)
    } catch (err) {
      reply.code(404).send({ error: 'Animations CSS not found' })
    }
  })

  // ============ CHAT ENDPOINTS ============

  // WebSocket for real-time chat
  app.get('/chat/ws', { websocket: true }, (socket: WebSocket) => {
    console.log('[Server] New WebSocket connection')

    // Send existing messages
    const messages = chatManager.getMessages({ limit: 50 })
    socket.send(JSON.stringify({
      type: 'history',
      messages,
    }))

    // Subscribe to new messages
    const unsubscribe = chatManager.subscribe((message: AgentMessage) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({
          type: 'message',
          message,
        }))
      }
    })

    socket.on('close', () => {
      console.log('[Server] WebSocket closed')
      unsubscribe()
    })

    socket.on('error', (err) => {
      console.error('[Server] WebSocket error:', err)
    })
  })

  // Send message
  app.post('/chat/messages', async (request) => {
    const data = SendMessageSchema.parse(request.body)
    const message = await chatManager.sendMessage(data)
    
    // Auto-update presence: if you're posting, you're active
    if (data.from) {
      presenceManager.recordActivity(data.from, 'message')
      presenceManager.updatePresence(data.from, 'working')
    }
    
    return { success: true, message }
  })

  // Get messages
  app.get('/chat/messages', async (request, reply) => {
    const query = request.query as Record<string, string>
    const messages = chatManager.getMessages({
      from: query.from,
      to: query.to,
      channel: query.channel,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.chatMessages, MAX_LIMITS.chatMessages),
      since: parseEpochMs(query.since),
      before: parseEpochMs(query.before),
      after: parseEpochMs(query.after),
    })
    const payload = { messages }
    const lastModified = messages.length > 0 ? Math.max(...messages.map(m => m.timestamp || 0)) : undefined
    if (applyConditionalCaching(request, reply, payload, lastModified)) {
      return
    }
    return payload
  })

  // Add reaction to message
  app.post<{ Params: { id: string } }>('/chat/messages/:id/react', async (request) => {
    const body = request.body as { emoji: string; from: string }
    if (!body.emoji || !body.from) {
      return { error: 'emoji and from are required' }
    }
    const message = await chatManager.addReaction(request.params.id, body.emoji, body.from)
    if (!message) {
      return { error: 'Message not found' }
    }
    return { success: true, message }
  })

  // Get reactions for a message
  app.get<{ Params: { id: string } }>('/chat/messages/:id/reactions', async (request) => {
    const reactions = chatManager.getReactions(request.params.id)
    if (reactions === null) {
      return { error: 'Message not found' }
    }
    return { reactions }
  })

  // Get channels with message counts
  app.get('/chat/channels', async () => {
    const channels = chatManager.getChannels()
    return { channels }
  })

  // Search messages
  app.get('/chat/search', async (request) => {
    const query = request.query as Record<string, string>
    if (!query.q) {
      return { error: 'query parameter "q" is required' }
    }
    const messages = chatManager.search(query.q, {
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.chatSearch, MAX_LIMITS.chatSearch),
    })
    return { messages, count: messages.length }
  })

  // Get thread (parent + all replies)
  app.get<{ Params: { id: string } }>('/chat/messages/:id/thread', async (request) => {
    const thread = chatManager.getThread(request.params.id)
    if (!thread) {
      return { error: 'Message not found' }
    }
    return { messages: thread, count: thread.length }
  })

  // ============ INBOX ENDPOINTS ============

  // Get inbox for an agent
  app.get<{ Params: { agent: string } }>('/inbox/:agent', async (request) => {
    const query = request.query as Record<string, string>
    
    // For inbox, get more messages than default to scan for @mentions etc.
    // But still cap it to avoid blowing through context windows
    // Get last 100 messages or since timestamp if provided
    const allMessages = chatManager.getMessages({
      limit: MAX_LIMITS.inboxScanMessages,
      since: parseEpochMs(query.since),
    })
    
    const inbox = inboxManager.getInbox(request.params.agent, allMessages, {
      priority: query.priority as 'high' | 'medium' | 'low' | undefined,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.inbox, MAX_LIMITS.inbox),
      since: parseEpochMs(query.since),
    })
    
    // Auto-update presence when agent checks inbox
    presenceManager.updatePresence(request.params.agent, 'working')
    
    return { messages: inbox, count: inbox.length }
  })

  // Acknowledge messages
  app.post<{ Params: { agent: string } }>('/inbox/:agent/ack', async (request) => {
    const body = request.body as { messageIds?: string[]; all?: boolean; timestamp?: number }
    
    if (body.all) {
      const allMessages = chatManager.getMessages()
      await inboxManager.ackAll(request.params.agent, allMessages)
      return { success: true, message: 'All messages acknowledged' }
    }
    
    // Allow updating lastReadTimestamp without acking specific messages
    if (body.timestamp !== undefined && !body.messageIds) {
      await inboxManager.ackMessages(request.params.agent, undefined, body.timestamp)
      return { success: true, message: 'lastReadTimestamp updated' }
    }
    
    if (!body.messageIds || !Array.isArray(body.messageIds)) {
      return { error: 'messageIds array, timestamp, or all=true is required' }
    }
    
    await inboxManager.ackMessages(request.params.agent, body.messageIds, body.timestamp)
    return { success: true, count: body.messageIds.length }
  })

  // Update subscriptions
  app.post<{ Params: { agent: string } }>('/inbox/:agent/subscribe', async (request) => {
    const body = request.body as { channels: string[] }
    
    if (!body.channels || !Array.isArray(body.channels)) {
      return { error: 'channels array is required' }
    }
    
    const subscriptions = await inboxManager.updateSubscriptions(request.params.agent, body.channels)
    return { success: true, subscriptions }
  })

  // Get subscriptions
  app.get<{ Params: { agent: string } }>('/inbox/:agent/subscriptions', async (request) => {
    const subscriptions = inboxManager.getSubscriptions(request.params.agent)
    return { subscriptions }
  })

  // Get unread mentions count (for notification badge)
  app.get<{ Params: { agent: string } }>('/inbox/:agent/unread', async (request) => {
    const allMessages = chatManager.getMessages({ limit: MAX_LIMITS.unreadScanMessages })
    const count = inboxManager.getUnreadMentionsCount(request.params.agent, allMessages)
    return { count, agent: request.params.agent }
  })

  // Get unread mentions (for dropdown/panel)
  app.get<{ Params: { agent: string } }>('/inbox/:agent/mentions', async (request) => {
    const query = request.query as Record<string, string>
    const limit = boundedLimit(query.limit, DEFAULT_LIMITS.unreadMentions, MAX_LIMITS.unreadMentions)
    
    const allMessages = chatManager.getMessages({ limit: MAX_LIMITS.unreadScanMessages })
    const mentions = inboxManager.getUnreadMentions(request.params.agent, allMessages)
    
    return { 
      mentions: mentions.slice(0, limit), 
      count: mentions.length,
      agent: request.params.agent
    }
  })

  // List rooms
  app.get('/chat/rooms', async () => {
    const rooms = chatManager.listRooms()
    return { rooms }
  })

  // Create room
  app.post('/chat/rooms', async (request) => {
    const body = request.body as { id: string; name: string }
    const room = chatManager.createRoom(body.id, body.name)
    return { success: true, room }
  })

  // ============ TASK ENDPOINTS ============

  // List tasks
  app.get('/tasks', async (request, reply) => {
    const query = request.query as Record<string, string>
    const updatedSince = parseEpochMs(query.updatedSince || query.since)
    const limit = boundedLimit(query.limit, DEFAULT_LIMITS.tasks, MAX_LIMITS.tasks)

    let tasks = taskManager.listTasks({
      status: query.status as Task['status'] | undefined,
      assignee: query.assignee || query.assignedTo, // Support both for backward compatibility
      createdBy: query.createdBy,
      priority: query.priority as Task['priority'] | undefined,
      tags: query.tags ? query.tags.split(',') : undefined,
    })

    if (updatedSince) {
      tasks = tasks.filter(task => task.updatedAt >= updatedSince)
    }

    tasks = tasks.slice(0, limit)

    const payload = { tasks }
    const lastModified = tasks.length > 0 ? Math.max(...tasks.map(t => t.updatedAt || 0)) : undefined
    if (applyConditionalCaching(request, reply, payload, lastModified)) {
      return
    }

    return payload
  })

  // List recurring task definitions
  app.get('/tasks/recurring', async (request) => {
    const query = request.query as Record<string, string>
    const enabled = query.enabled === undefined
      ? undefined
      : query.enabled === 'true'

    const recurring = taskManager.listRecurringTasks({ enabled })
    return { recurring, count: recurring.length }
  })

  // Create recurring task definition
  app.post('/tasks/recurring', async (request) => {
    try {
      const data = CreateRecurringTaskSchema.parse(request.body)
      const recurring = await taskManager.createRecurringTask(data)
      return { success: true, recurring }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create recurring task' }
    }
  })

  // Force recurring materialization pass
  app.post('/tasks/recurring/materialize', async () => {
    const result = await taskManager.materializeDueRecurringTasks()
    return { success: true, ...result }
  })

  // Get task
  app.get<{ Params: { id: string } }>('/tasks/:id', async (request) => {
    const task = taskManager.getTask(request.params.id)
    if (!task) {
      return { error: 'Task not found' }
    }
    return { task }
  })

  // Create task
  app.post('/tasks', async (request) => {
    try {
      const data = CreateTaskSchema.parse(request.body)
      const task = await taskManager.createTask(data)
      
      // Auto-update presence: creating tasks = working
      if (data.createdBy) {
        presenceManager.updatePresence(data.createdBy, 'working')
      }
      
      return { success: true, task }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to create task' }
    }
  })

  // Update task
  app.patch<{ Params: { id: string } }>('/tasks/:id', async (request) => {
    try {
      const updates = UpdateTaskSchema.parse(request.body)
      const task = await taskManager.updateTask(request.params.id, updates)
      if (!task) {
        return { error: 'Task not found' }
      }
      
      // Auto-update presence on task activity
      if (task.assignee) {
        if (updates.status === 'done') {
          presenceManager.recordActivity(task.assignee, 'task_completed')
          presenceManager.updatePresence(task.assignee, 'working')
        } else if (updates.status === 'doing') {
          presenceManager.updatePresence(task.assignee, 'working')
        } else if (updates.status === 'blocked') {
          presenceManager.updatePresence(task.assignee, 'blocked')
        } else if (updates.status === 'validating') {
          presenceManager.updatePresence(task.assignee, 'reviewing')
        }
      }
      
      return { success: true, task }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update task' }
    }
  })

  // Delete task
  app.delete<{ Params: { id: string } }>('/tasks/:id', async (request) => {
    const deleted = await taskManager.deleteTask(request.params.id)
    if (!deleted) {
      return { error: 'Task not found' }
    }
    return { success: true }
  })

  // Get next task (pull-based assignment)
  app.get('/tasks/next', async (request) => {
    const query = request.query as Record<string, string>
    const agent = query.agent
    const task = taskManager.getNextTask(agent)
    if (!task) {
      return { task: null, message: 'No available tasks' }
    }
    return { task }
  })

  // Task lifecycle instrumentation: reviewer + done criteria gates
  app.get('/tasks/instrumentation/lifecycle', async () => {
    const instrumentation = taskManager.getLifecycleInstrumentation()
    return { instrumentation }
  })

  // ============ MEMORY ENDPOINTS ============

  // Get all memory files for an agent
  app.get<{ Params: { agent: string } }>('/memory/:agent', async (request) => {
    try {
      const memories = await memoryManager.getMemories(request.params.agent)
      return { success: true, memories }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Append to daily memory file
  app.post<{ Params: { agent: string }; Body: { content: string } }>('/memory/:agent', async (request) => {
    try {
      const body = request.body as { content: string }
      if (!body.content || typeof body.content !== 'string') {
        return { success: false, error: 'content is required' }
      }
      const result = await memoryManager.appendToDaily(request.params.agent, body.content)
      return { success: true, ...result }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Search memory files
  app.get<{ Params: { agent: string }; Querystring: { q: string } }>('/memory/:agent/search', async (request) => {
    try {
      const query = (request.query as { q: string }).q
      if (!query) {
        return { success: false, error: 'query parameter "q" is required' }
      }
      const results = await memoryManager.searchMemories(request.params.agent, query)
      return { success: true, results, count: results.length }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ============ PRESENCE ENDPOINTS ============

  // Update agent presence
  app.post<{ Params: { agent: string } }>('/presence/:agent', async (request) => {
    try {
      const body = request.body as { status: PresenceStatus; task?: string; since?: number }
      
      if (!body.status) {
        return { success: false, error: 'status is required' }
      }

      const validStatuses = ['idle', 'working', 'reviewing', 'blocked', 'offline']
      if (!validStatuses.includes(body.status)) {
        return { success: false, error: `status must be one of: ${validStatuses.join(', ')}` }
      }

      const presence = presenceManager.updatePresence(
        request.params.agent,
        body.status,
        body.task,
        body.since
      )

      return { success: true, presence }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get all agent presences
  app.get('/presence', async () => {
    const explicitPresences = presenceManager.getAllPresence()
    const allActivity = presenceManager.getAllActivity()
    
    // Build map of explicit presence by agent
    const presenceMap = new Map(explicitPresences.map(p => [p.agent, p]))
    
    // Add inferred presence for agents with only activity
    const now = Date.now()
    for (const activity of allActivity) {
      if (!presenceMap.has(activity.agent) && activity.last_active) {
        const inactiveMs = now - activity.last_active
        
        let status: PresenceStatus = 'offline'
        if (inactiveMs < 10 * 60 * 1000) { // Active in last 10 minutes
          status = activity.tasks_completed_today > 0 ? 'working' : 'idle'
        }
        
        presenceMap.set(activity.agent, {
          agent: activity.agent,
          status,
          since: activity.first_seen_today || activity.last_active,
          lastUpdate: activity.last_active,
          last_active: activity.last_active,
        })
      }
    }
    
    return { presences: Array.from(presenceMap.values()) }
  })

  // Get specific agent presence
  app.get<{ Params: { agent: string } }>('/presence/:agent', async (request) => {
    let presence = presenceManager.getPresence(request.params.agent)
    
    // If no explicit presence, infer from activity
    if (!presence) {
      const activity = presenceManager.getAgentActivity(request.params.agent)
      if (activity && activity.last_active) {
        const now = Date.now()
        const inactiveMs = now - activity.last_active
        
        // Infer status based on recent activity
        let status: PresenceStatus = 'offline'
        if (inactiveMs < 10 * 60 * 1000) { // Active in last 10 minutes
          status = activity.tasks_completed_today > 0 ? 'working' : 'idle'
        }
        
        presence = {
          agent: request.params.agent,
          status,
          since: activity.first_seen_today || activity.last_active,
          lastUpdate: activity.last_active,
          last_active: activity.last_active,
        }
      }
    }
    
    if (!presence) {
      return { presence: null, message: 'No presence data for this agent' }
    }
    return { presence }
  })

  // Get all agent activity metrics
  app.get('/agents/activity', async () => {
    const activity = presenceManager.getAllActivity()
    return { activity }
  })

  // Get specific agent activity metrics
  app.get<{ Params: { agent: string } }>('/agents/:agent/activity', async (request) => {
    const activity = presenceManager.getAgentActivity(request.params.agent)
    if (!activity) {
      return { activity: null, message: 'No activity data for this agent' }
    }
    return { activity }
  })

  // ============ ACTIVITY FEED ENDPOINT ============

  // Get recent activity across all systems
  app.get('/activity', async (request, reply) => {
    const query = request.query as Record<string, string>
    const events = eventBus.getEvents({
      agent: query.agent,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.activity, MAX_LIMITS.activity),
      since: parseEpochMs(query.since),
    })
    const payload = { events, count: events.length }
    const lastModified = events.length > 0 ? Math.max(...events.map(e => e.timestamp || 0)) : undefined
    if (applyConditionalCaching(request, reply, payload, lastModified)) {
      return
    }
    return payload
  })

  // ============ ANALYTICS ENDPOINTS ============

  // Get Vercel analytics for forAgents.dev
  app.get('/analytics/foragents', async (request) => {
    const query = request.query as Record<string, string>
    const period = (query.period || '7d') as '1h' | '24h' | '7d' | '30d'
    
    const analytics = await analyticsManager.getForAgentsAnalytics(period)
    
    if (!analytics) {
      return { 
        error: 'Vercel analytics not configured', 
        message: 'Set VERCEL_TOKEN and VERCEL_PROJECT_ID in .env' 
      }
    }
    
    return { analytics }
  })

  // Get dev.to + forAgents content performance
  app.get('/content/performance', async () => {
    const performance = await analyticsManager.getContentPerformance()
    return { performance }
  })

  // Get task analytics
  app.get('/tasks/analytics', async (request) => {
    const query = request.query as Record<string, string>
    const since = query.since ? parseInt(query.since, 10) : undefined
    
    const analytics = analyticsManager.getTaskAnalytics(since)
    return { analytics }
  })

  // Get summary metrics dashboard
  app.get('/metrics/summary', async (request, reply) => {
    const query = request.query as Record<string, string>
    const includeContent = query.includeContent !== 'false'
    
    const summary = await analyticsManager.getMetricsSummary(includeContent)
    const rawTimestamp = (summary as any)?.timestamp || Date.now()
    const cacheBucketMs = Math.floor(rawTimestamp / 30000) * 30000 // 30s bucket

    const payload = {
      summary: {
        ...(summary as any),
        timestamp: cacheBucketMs,
      },
    }

    if (applyConditionalCaching(request, reply, payload, cacheBucketMs)) {
      return
    }
    return payload
  })

  // ============ CONTENT ENDPOINTS ============

  // Log a published piece of content
  app.post('/content/published', async (request) => {
    try {
      const body = request.body as {
        title: string
        topic: string
        url: string
        platform: 'dev.to' | 'foragents.dev' | 'medium' | 'substack' | 'twitter' | 'linkedin' | 'other'
        publishedBy: string
        publishedAt?: number
        tags?: string[]
        metadata?: Record<string, unknown>
      }

      if (!body.title || !body.topic || !body.url || !body.platform || !body.publishedBy) {
        return {
          success: false,
          error: 'title, topic, url, platform, and publishedBy are required',
        }
      }

      const publication = await contentManager.logPublication(body)

      // Update presence: publishing content = working
      if (body.publishedBy) {
        presenceManager.recordActivity(body.publishedBy, 'message')
        presenceManager.updatePresence(body.publishedBy, 'working')
      }

      return { success: true, publication }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get content calendar (scheduled/published/draft)
  app.get('/content/calendar', async (request) => {
    const query = request.query as Record<string, string>
    const calendar = contentManager.getCalendar({
      status: query.status as 'draft' | 'scheduled' | 'published' | undefined,
      assignee: query.assignee,
      platform: query.platform,
      tags: query.tags ? query.tags.split(',') : undefined,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.contentCalendar, MAX_LIMITS.contentCalendar),
      since: parseEpochMs(query.since),
    })
    return { calendar, count: calendar.length }
  })

  // Get publication log
  app.get('/content/published', async (request) => {
    const query = request.query as Record<string, string>
    const publications = contentManager.getPublications({
      platform: query.platform as any,
      publishedBy: query.publishedBy,
      tags: query.tags ? query.tags.split(',') : undefined,
      limit: boundedLimit(query.limit, DEFAULT_LIMITS.contentPublished, MAX_LIMITS.contentPublished),
      since: parseEpochMs(query.since),
    })
    return { publications, count: publications.length }
  })

  // Add or update calendar item
  app.post('/content/calendar', async (request) => {
    try {
      const body = request.body as {
        id?: string
        title: string
        topic: string
        status: 'draft' | 'scheduled' | 'published'
        assignee?: string
        createdBy: string
        scheduledFor?: number
        publishedAt?: number
        platform?: string
        url?: string
        tags?: string[]
        notes?: string
        metadata?: Record<string, unknown>
      }

      if (!body.title || !body.topic || !body.status || !body.createdBy) {
        return {
          success: false,
          error: 'title, topic, status, and createdBy are required',
        }
      }

      const item = await contentManager.upsertCalendarItem(body)

      // Update presence when adding content to calendar
      if (body.createdBy) {
        presenceManager.updatePresence(body.createdBy, 'working')
      }

      return { success: true, item }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Update content performance metrics
  app.patch<{ Params: { id: string } }>('/content/published/:id/performance', async (request) => {
    try {
      const body = request.body as {
        views?: number
        reactions?: number
        comments?: number
        shares?: number
      }

      const publication = await contentManager.updatePerformance(request.params.id, body)

      if (!publication) {
        return { success: false, error: 'Publication not found' }
      }

      return { success: true, publication }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Get single publication
  app.get<{ Params: { id: string } }>('/content/published/:id', async (request) => {
    const publication = contentManager.getPublication(request.params.id)
    if (!publication) {
      return { error: 'Publication not found' }
    }
    return { publication }
  })

  // Get single calendar item
  app.get<{ Params: { id: string } }>('/content/calendar/:id', async (request) => {
    const item = contentManager.getCalendarItem(request.params.id)
    if (!item) {
      return { error: 'Calendar item not found' }
    }
    return { item }
  })

  // Delete calendar item
  app.delete<{ Params: { id: string } }>('/content/calendar/:id', async (request) => {
    const deleted = await contentManager.deleteCalendarItem(request.params.id)
    if (!deleted) {
      return { error: 'Calendar item not found' }
    }
    return { success: true }
  })

  // Get content stats
  app.get('/content/stats', async () => {
    const stats = contentManager.getStats()
    return { stats }
  })

  // ============ EVENT ENDPOINTS ============

  // Subscribe to events via SSE
  app.get('/events/subscribe', async (request, reply) => {
    const query = request.query as Record<string, string>
    const agent = query.agent
    const topics = query.topics ? query.topics.split(',').map(t => t.trim()) : undefined

    eventBus.subscribe(reply, agent, topics)
    
    // Keep the connection open - don't return anything
    // The reply is handled by the event bus
  })

  // Get event bus status
  app.get('/events/status', async () => {
    return eventBus.getStatus()
  })

  // Get event batch configuration
  app.get('/events/config', async () => {
    return eventBus.getBatchConfig()
  })

  // Set event batch configuration
  app.post('/events/config', async (request) => {
    const body = request.body as { batchWindowMs: number }
    if (typeof body.batchWindowMs !== 'number') {
      return { error: 'batchWindowMs must be a number' }
    }
    try {
      eventBus.setBatchConfig(body.batchWindowMs)
      return { success: true, config: eventBus.getBatchConfig() }
    } catch (err: any) {
      return { error: err.message }
    }
  })

  // ============ OPENCLAW ENDPOINTS ============

  // OpenClaw status (TODO: wire up when gateway token configured)
  app.get('/openclaw/status', async () => {
    return { connected: false, note: 'OpenClaw integration pending' }
  })

  // ============ MCP ENDPOINTS ============

  // MCP HTTP endpoint (new protocol)
  app.all('/mcp', async (request, reply) => {
    const fullUrl = `http://${request.headers.host || 'localhost'}${request.url}`
    const req = new Request(fullUrl, {
      method: request.method,
      headers: request.headers as any,
      body: request.body ? JSON.stringify(request.body) : undefined,
    })
    const response = await handleMCPRequest(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })
    const body = await response.text()
    return body
  })

  // MCP SSE endpoint (legacy protocol)
  app.get('/sse', async (request, reply) => {
    const fullUrl = `http://${request.headers.host || 'localhost'}${request.url}`
    const req = new Request(fullUrl)
    const response = await handleSSERequest(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })
    reply.send(response.body)
  })

  // MCP messages endpoint (legacy protocol)
  app.post('/mcp/messages', async (request, reply) => {
    const fullUrl = `http://${request.headers.host || 'localhost'}${request.url}`
    const req = new Request(fullUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
    })
    const response = await handleMessagesRequest(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => {
      reply.header(key, value)
    })
    const body = await response.text()
    return body
  })

  return app
}
