/**
 * Fastify server with REST + WebSocket endpoints
 */
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
import { z } from 'zod'
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
import { getDashboardHTML } from './dashboard.js'

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
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
  blocked_by: z.array(z.string()).optional(),
  epic_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

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

  // ============ DASHBOARD ============

  app.get('/dashboard', async (_request, reply) => {
    reply.type('text/html').send(getDashboardHTML())
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
    return { success: true, message }
  })

  // Get messages
  app.get('/chat/messages', async (request) => {
    const query = request.query as Record<string, string>
    const messages = chatManager.getMessages({
      from: query.from,
      to: query.to,
      channel: query.channel,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      since: query.since ? parseInt(query.since, 10) : undefined,
    })
    return { messages }
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
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
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
    const allMessages = chatManager.getMessages()
    
    const inbox = inboxManager.getInbox(request.params.agent, allMessages, {
      priority: query.priority as 'high' | 'medium' | 'low' | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      since: query.since ? parseInt(query.since, 10) : undefined,
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
  app.get('/tasks', async (request) => {
    const query = request.query as Record<string, string>
    const tasks = taskManager.listTasks({
      status: query.status as Task['status'] | undefined,
      assignee: query.assignee || query.assignedTo, // Support both for backward compatibility
      createdBy: query.createdBy,
      priority: query.priority as Task['priority'] | undefined,
      tags: query.tags ? query.tags.split(',') : undefined,
    })
    return { tasks }
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
    const data = CreateTaskSchema.parse(request.body)
    const task = await taskManager.createTask(data)
    return { success: true, task }
  })

  // Update task
  app.patch<{ Params: { id: string } }>('/tasks/:id', async (request) => {
    const updates = UpdateTaskSchema.parse(request.body)
    const task = await taskManager.updateTask(request.params.id, updates)
    if (!task) {
      return { error: 'Task not found' }
    }
    return { success: true, task }
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
    const presences = presenceManager.getAllPresence()
    return { presences }
  })

  // Get specific agent presence
  app.get<{ Params: { agent: string } }>('/presence/:agent', async (request) => {
    const presence = presenceManager.getPresence(request.params.agent)
    if (!presence) {
      return { presence: null, message: 'No presence data for this agent' }
    }
    return { presence }
  })

  // ============ ACTIVITY FEED ENDPOINT ============

  // Get recent activity across all systems
  app.get('/activity', async (request) => {
    const query = request.query as Record<string, string>
    const events = eventBus.getEvents({
      agent: query.agent,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      since: query.since ? parseInt(query.since, 10) : undefined,
    })
    return { events, count: events.length }
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
