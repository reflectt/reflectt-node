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
import type { AgentMessage, Task } from './types.js'

// Schemas
const SendMessageSchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  content: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
})

const CreateTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['todo', 'in-progress', 'done', 'blocked']).default('todo'),
  assignedTo: z.string().optional(),
  createdBy: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
})

const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(['todo', 'in-progress', 'done', 'blocked']).optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
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
      timestamp: Date.now(),
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
    return { success: true, message }
  })

  // Get messages
  app.get('/chat/messages', async (request) => {
    const query = request.query as Record<string, string>
    const messages = chatManager.getMessages({
      from: query.from,
      to: query.to,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      since: query.since ? parseInt(query.since, 10) : undefined,
    })
    return { messages }
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
      assignedTo: query.assignedTo,
      createdBy: query.createdBy,
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
    const task = taskManager.createTask(data)
    return { success: true, task }
  })

  // Update task
  app.patch<{ Params: { id: string } }>('/tasks/:id', async (request) => {
    const updates = UpdateTaskSchema.parse(request.body)
    const task = taskManager.updateTask(request.params.id, updates)
    if (!task) {
      return { error: 'Task not found' }
    }
    return { success: true, task }
  })

  // Delete task
  app.delete<{ Params: { id: string } }>('/tasks/:id', async (request) => {
    const deleted = taskManager.deleteTask(request.params.id)
    if (!deleted) {
      return { error: 'Task not found' }
    }
    return { success: true }
  })

  // ============ OPENCLAW ENDPOINTS ============

  // OpenClaw status (TODO: wire up when gateway token configured)
  app.get('/openclaw/status', async () => {
    return { connected: false, note: 'OpenClaw integration pending' }
  })

  return app
}
