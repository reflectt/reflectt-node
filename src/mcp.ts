/**
 * MCP HTTP Server for reflectt-node
 * 
 * Exposes chat and task management tools via MCP protocol.
 * Supports both new HTTP transport (/mcp) and legacy SSE (/sse + /messages).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { chatManager } from "./chat.js"
import { taskManager } from "./tasks.js"
import type { AgentMessage, Task } from "./types.js"

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server Setup
// ═══════════════════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "reflectt-node",
  version: "0.1.0",
})

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Tools
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "send_message",
  "Send a message to the team chat. Use this to communicate with other agents.",
  {
    from: z.string().describe("Your agent name (e.g., 'kai', 'link', 'scout')"),
    content: z.string().describe("Message content"),
    to: z.string().optional().describe("Recipient agent name (optional, omit for broadcast)"),
    metadata: z.record(z.unknown()).optional().describe("Optional metadata"),
  },
  async ({ from, content, to, metadata }) => {
    const message = await chatManager.sendMessage({ from, content, to, metadata })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, message })
      }]
    }
  }
)

server.tool(
  "get_messages",
  "Get chat messages. Returns recent messages, optionally filtered by sender/recipient.",
  {
    from: z.string().optional().describe("Filter by sender"),
    to: z.string().optional().describe("Filter by recipient"),
    limit: z.number().optional().describe("Max messages to return (default: 50)"),
    since: z.number().optional().describe("Unix timestamp - only return messages after this time"),
  },
  async ({ from, to, limit, since }) => {
    const messages = chatManager.getMessages({ from, to, limit, since })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ messages })
      }]
    }
  }
)

server.tool(
  "list_rooms",
  "List all available chat rooms.",
  {},
  async () => {
    const rooms = chatManager.listRooms()
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ rooms })
      }]
    }
  }
)

server.tool(
  "create_room",
  "Create a new chat room.",
  {
    id: z.string().describe("Room ID (e.g., 'dev-chat', 'planning')"),
    name: z.string().describe("Room display name"),
  },
  async ({ id, name }) => {
    const room = chatManager.createRoom(id, name)
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, room })
      }]
    }
  }
)

// ═══════════════════════════════════════════════════════════════════════════════
// Task Tools
// ═══════════════════════════════════════════════════════════════════════════════

server.tool(
  "create_task",
  "Create a new task. Use this to track work that needs to be done.",
  {
    title: z.string().describe("Task title"),
    description: z.string().optional().describe("Detailed description"),
    status: z.enum(["todo", "in-progress", "done", "blocked"]).optional().describe("Task status (default: todo)"),
    assignedTo: z.string().optional().describe("Agent assigned to this task"),
    createdBy: z.string().describe("Agent creating this task"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    metadata: z.record(z.unknown()).optional().describe("Optional metadata"),
  },
  async ({ title, description, status, assignedTo, createdBy, priority, tags, metadata }) => {
    const task = taskManager.createTask({
      title,
      description,
      status: status || "todo",
      assignedTo,
      createdBy,
      priority,
      tags,
      metadata,
    })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, task })
      }]
    }
  }
)

server.tool(
  "list_tasks",
  "List tasks, optionally filtered by status, assignee, or tags.",
  {
    status: z.enum(["todo", "in-progress", "done", "blocked"]).optional().describe("Filter by status"),
    assignedTo: z.string().optional().describe("Filter by assignee"),
    createdBy: z.string().optional().describe("Filter by creator"),
    tags: z.array(z.string()).optional().describe("Filter by tags (returns tasks with any of these tags)"),
  },
  async ({ status, assignedTo, createdBy, tags }) => {
    const tasks = taskManager.listTasks({ status, assignedTo, createdBy, tags })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ tasks })
      }]
    }
  }
)

server.tool(
  "get_task",
  "Get details for a specific task by ID.",
  {
    id: z.string().describe("Task ID"),
  },
  async ({ id }) => {
    const task = taskManager.getTask(id)
    if (!task) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: "Task not found" })
        }]
      }
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ task })
      }]
    }
  }
)

server.tool(
  "update_task",
  "Update an existing task. Can change status, assignee, description, etc.",
  {
    id: z.string().describe("Task ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["todo", "in-progress", "done", "blocked"]).optional().describe("New status"),
    assignedTo: z.string().optional().describe("New assignee"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
    tags: z.array(z.string()).optional().describe("New tags"),
    metadata: z.record(z.unknown()).optional().describe("New metadata"),
  },
  async ({ id, title, description, status, assignedTo, priority, tags, metadata }) => {
    const task = taskManager.updateTask(id, {
      title,
      description,
      status,
      assignedTo,
      priority,
      tags,
      metadata,
    })
    if (!task) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: "Task not found" })
        }]
      }
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, task })
      }]
    }
  }
)

server.tool(
  "delete_task",
  "Delete a task permanently.",
  {
    id: z.string().describe("Task ID"),
  },
  async ({ id }) => {
    const deleted = taskManager.deleteTask(id)
    if (!deleted) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ error: "Task not found" })
        }]
      }
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true })
      }]
    }
  }
)

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Transport (New Protocol)
// ═══════════════════════════════════════════════════════════════════════════════

const httpTransport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
})

let initialized = false
let initPromise: Promise<void> | null = null

export async function initMCPServer() {
  if (initialized) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    await server.connect(httpTransport)
    initialized = true
    console.log("[MCP] HTTP server initialized")
  })()

  return initPromise
}

export async function handleMCPRequest(req: Request): Promise<Response> {
  if (!initialized) {
    await initMCPServer()
  }

  const method = req.method
  const accept = req.headers.get("accept") || "none"
  console.log(`[MCP] Request: ${method} Accept: ${accept.slice(0, 80)}`)

  return httpTransport.handleRequest(req)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SSE Transport (Legacy Protocol)
// ═══════════════════════════════════════════════════════════════════════════════

interface SSESession {
  controller: ReadableStreamDefaultController<Uint8Array>
  lastUsed: number
}

const sseSessions = new Map<string, SSESession>()
const SESSION_TTL_MS = 5 * 60 * 1000

function touchSession(sessionId: string) {
  const session = sseSessions.get(sessionId)
  if (session) {
    session.lastUsed = Date.now()
  }
}

function cleanupStaleSessions() {
  const now = Date.now()
  let cleaned = 0
  for (const [id, session] of sseSessions) {
    if (now - session.lastUsed > SESSION_TTL_MS) {
      try { session.controller.close?.() } catch {}
      sseSessions.delete(id)
      cleaned++
    }
  }
  if (cleaned > 0) {
    console.log(`[MCP] Cleaned up ${cleaned} stale sessions`)
  }
}

setInterval(cleanupStaleSessions, 60_000)

// Tool registry for SSE sessions
const toolHandlers: Map<string, { schema: any, handler: (args: any) => Promise<any> }> = new Map()

function initToolHandlers() {
  // Chat tools
  toolHandlers.set("send_message", {
    schema: {
      description: "Send a message to the team chat",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Your agent name" },
          content: { type: "string", description: "Message content" },
          to: { type: "string", description: "Recipient (optional)" },
          metadata: { type: "object", description: "Optional metadata" },
        },
        required: ["from", "content"],
      },
    },
    handler: async (args) => {
      const message = await chatManager.sendMessage(args)
      return { content: [{ type: "text", text: JSON.stringify({ success: true, message }) }] }
    },
  })

  toolHandlers.set("get_messages", {
    schema: {
      description: "Get chat messages",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Filter by sender" },
          to: { type: "string", description: "Filter by recipient" },
          limit: { type: "number", description: "Max messages (default: 50)" },
          since: { type: "number", description: "Unix timestamp filter" },
        },
      },
    },
    handler: async (args) => {
      const messages = chatManager.getMessages(args)
      return { content: [{ type: "text", text: JSON.stringify({ messages }) }] }
    },
  })

  toolHandlers.set("list_rooms", {
    schema: {
      description: "List all chat rooms",
      inputSchema: { type: "object", properties: {} },
    },
    handler: async () => {
      const rooms = chatManager.listRooms()
      return { content: [{ type: "text", text: JSON.stringify({ rooms }) }] }
    },
  })

  toolHandlers.set("create_room", {
    schema: {
      description: "Create a new chat room",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Room ID" },
          name: { type: "string", description: "Room display name" },
        },
        required: ["id", "name"],
      },
    },
    handler: async (args) => {
      const room = chatManager.createRoom(args.id, args.name)
      return { content: [{ type: "text", text: JSON.stringify({ success: true, room }) }] }
    },
  })

  // Task tools
  toolHandlers.set("create_task", {
    schema: {
      description: "Create a new task",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          description: { type: "string", description: "Task description" },
          status: { type: "string", enum: ["todo", "in-progress", "done", "blocked"] },
          assignedTo: { type: "string", description: "Assignee" },
          createdBy: { type: "string", description: "Creator" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          tags: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
        },
        required: ["title", "createdBy"],
      },
    },
    handler: async (args) => {
      const task = taskManager.createTask({ status: "todo", ...args })
      return { content: [{ type: "text", text: JSON.stringify({ success: true, task }) }] }
    },
  })

  toolHandlers.set("list_tasks", {
    schema: {
      description: "List tasks with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["todo", "in-progress", "done", "blocked"] },
          assignedTo: { type: "string" },
          createdBy: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
    handler: async (args) => {
      const tasks = taskManager.listTasks(args)
      return { content: [{ type: "text", text: JSON.stringify({ tasks }) }] }
    },
  })

  toolHandlers.set("get_task", {
    schema: {
      description: "Get a specific task by ID",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID" },
        },
        required: ["id"],
      },
    },
    handler: async (args) => {
      const task = taskManager.getTask(args.id)
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Task not found" }) }] }
      }
      return { content: [{ type: "text", text: JSON.stringify({ task }) }] }
    },
  })

  toolHandlers.set("update_task", {
    schema: {
      description: "Update an existing task",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string", enum: ["todo", "in-progress", "done", "blocked"] },
          assignedTo: { type: "string" },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          tags: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
        },
        required: ["id"],
      },
    },
    handler: async (args) => {
      const { id, ...updates } = args
      const task = taskManager.updateTask(id, updates)
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Task not found" }) }] }
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true, task }) }] }
    },
  })

  toolHandlers.set("delete_task", {
    schema: {
      description: "Delete a task permanently",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task ID" },
        },
        required: ["id"],
      },
    },
    handler: async (args) => {
      const deleted = taskManager.deleteTask(args.id)
      if (!deleted) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Task not found" }) }] }
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] }
    },
  })

  console.log(`[MCP] Registered ${toolHandlers.size} tools for SSE`)
}

initToolHandlers()

function getToolsList(): any[] {
  return Array.from(toolHandlers.entries()).map(([name, { schema }]) => ({
    name,
    description: schema.description || "",
    inputSchema: schema.inputSchema || {},
  }))
}

async function callTool(name: string, args: any): Promise<any> {
  const handler = toolHandlers.get(name)
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return handler.handler(args)
}

async function handleJsonRpcMessage(message: any): Promise<any> {
  const { method, params, id } = message

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "reflectt-node", version: "0.1.0" },
      },
    }
  }

  if (method === "tools/list") {
    const tools = getToolsList()
    return { jsonrpc: "2.0", id, result: { tools } }
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params
    try {
      const result = await callTool(name, args)
      return { jsonrpc: "2.0", id, result }
    } catch (e) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: String(e) } }
    }
  }

  if (method === "notifications/initialized") {
    return null
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }
}

export async function handleSSERequest(req: Request): Promise<Response> {
  const sessionId = crypto.randomUUID()
  console.log(`[MCP] SSE session started: ${sessionId}`)

  let controller: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      const endpointEvent = `event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}\n\n`
      controller.enqueue(new TextEncoder().encode(endpointEvent))
    },
    cancel() {
      console.log(`[MCP] SSE session closed: ${sessionId}`)
      sseSessions.delete(sessionId)
    },
  })

  sseSessions.set(sessionId, {
    controller: controller!,
    lastUsed: Date.now(),
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Session-Id": sessionId,
    },
  })
}

export async function handleMessagesRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get("sessionId")

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "Missing sessionId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const session = sseSessions.get(sessionId)
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    })
  }

  try {
    touchSession(sessionId)

    const body = await req.json() as { method?: string; id?: string | number; params?: any }
    console.log(`[MCP] SSE message (${sessionId}):`, body.method || body.id)

    const response = await handleJsonRpcMessage(body)

    if (response) {
      const sseMessage = `event: message\ndata: ${JSON.stringify(response)}\n\n`
      try {
        if (session.controller.desiredSize !== null) {
          session.controller.enqueue(new TextEncoder().encode(sseMessage))
        }
      } catch {
        // Controller closed - client disconnected
      }
    }

    return new Response(JSON.stringify(response || { jsonrpc: "2.0", result: null }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error(`[MCP] SSE message error:`, e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    })
  }
}
