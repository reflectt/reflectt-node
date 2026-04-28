// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

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
import { calendarEvents } from "./calendar-events.js"
import { inboxManager } from "./inbox.js"
import { eventBus } from "./events.js"
import { PKG_VERSION } from "./version.js"
import type { AgentMessage, Task } from "./types.js"
import { getAgentRoles } from "./assignment.js"
import { listRoomParticipants, getRoomPresenceStatus } from "./room-presence-store.js"
import { getRecentTranscript, getRoomTranscriptStatus } from "./room-transcript-store.js"
import { getArtifact, listArtifacts, readArtifactContent, ROOM_ARTIFACT_AGENT_ID } from "./artifact-store.js"

// ═══════════════════════════════════════════════════════════════════════════════
// MCP Server Setup
// ═══════════════════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "reflectt-node",
  version: PKG_VERSION,
})

// Wrapper to avoid TS2589 (excessively deep type instantiation) with MCP SDK + Zod
// The SDK's .tool() generic causes infinite recursion in tsc with complex schemas.
// Using `any` for the schema/handler params breaks the deep inference chain while
// keeping runtime behavior identical.
const tool: (...args: any[]) => void = server.tool.bind(server)

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Tools
// ═══════════════════════════════════════════════════════════════════════════════

tool(
  "send_message",
  "Send a message to the team chat. Use this to communicate with other agents. When reporting on a tool result that produced an image, file, or other binary artifact (screenshot, generated image, document, etc.), pass the artifact via the `attachments` parameter using the actual values from the tool result — do NOT inline base64 or paste the raw URL into `content`.",
  {
    from: z.string().describe("Your agent name (e.g., 'main', 'builder', 'ops')"),
    content: z.string().describe("Message content"),
    to: z.string().optional().describe("Recipient agent name (optional, omit for broadcast)"),
    metadata: z.record(z.unknown()).optional().describe("Optional metadata"),
    attachments: z.array(z.object({
      id: z.string().describe("Stable id for the attachment (use the producing tool's id if present, e.g. screenshot id, generated image id)"),
      name: z.string().describe("Filename to display (e.g. 'screenshot.png', 'diagram.png')"),
      size: z.number().describe("Size in bytes from the tool result"),
      mimeType: z.string().describe("MIME type from the tool result (e.g. 'image/png')"),
      url: z.string().describe("Source URL from the tool result — http(s):// or data:<mime>;base64,... — use the value the tool returned, do not re-encode"),
    })).optional().describe("File attachments produced by a real tool result (images, documents, screenshots). Set only when an upstream tool actually returned an artifact with these fields."),
  },
  async ({ from, content, to, metadata, attachments }: any) => {
    const message = await chatManager.sendMessage({ from, content, to, metadata, attachments })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, message })
      }]
    }
  }
)

tool(
  "get_messages",
  "Get chat messages. Returns recent messages, optionally filtered by sender/recipient.",
  {
    from: z.string().optional().describe("Filter by sender"),
    to: z.string().optional().describe("Filter by recipient"),
    limit: z.number().optional().describe("Max messages to return (default: 50)"),
    since: z.number().optional().describe("Unix timestamp - only return messages after this time"),
  },
  async ({ from, to, limit, since }: any) => {
    const messages = chatManager.getMessages({ from, to, limit, since })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ messages })
      }]
    }
  }
)

tool(
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

tool(
  "create_room",
  "Create a new chat room.",
  {
    id: z.string().describe("Room ID (e.g., 'dev-chat', 'planning')"),
    name: z.string().describe("Room display name"),
  },
  async ({ id, name }: any) => {
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

tool(
  "create_task",
  "Create a new task. Use this to track work that needs to be done.",
  {
    title: z.string().describe("Task title"),
    description: z.string().optional().describe("Detailed description"),
    status: z.enum(["todo", "doing", "blocked", "validating", "done", "resolved_externally", "cancelled"]).optional().describe("Task status (default: todo)"),
    assignee: z.string().min(1).describe("Task owner/assignee"),
    reviewer: z.string().min(1).describe("Task reviewer"),
    done_criteria: z.array(z.string().min(1)).min(1).describe("Explicit done criteria"),
    eta: z.string().min(1).describe("ETA for next deliverable or completion"),
    createdBy: z.string().describe("Agent creating this task"),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional().describe("Task priority (P0=critical, P1=high, P2=medium, P3=low)"),
    blocked_by: z.array(z.string()).optional().describe("Task IDs blocking this task"),
    epic_id: z.string().optional().describe("Epic ID this task belongs to"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
    metadata: z.record(z.unknown()).optional().describe("Optional metadata"),
  },
  async ({ title, description, status, assignee, reviewer, done_criteria, eta, createdBy, priority, blocked_by, epic_id, tags, metadata }: any) => {
    const task = await taskManager.createTask({
      title,
      description,
      status: status || "todo",
      assignee,
      reviewer,
      done_criteria,
      createdBy,
      priority,
      blocked_by,
      epic_id,
      tags,
      metadata: {
        ...(metadata || {}),
        eta,
      },
    })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, task })
      }]
    }
  }
)

tool(
  "list_tasks",
  "List tasks, optionally filtered by status, assignee, priority, or tags.",
  {
    status: z.enum(["todo", "doing", "blocked", "validating", "done", "resolved_externally", "cancelled"]).optional().describe("Filter by status"),
    assignee: z.string().optional().describe("Filter by assignee"),
    createdBy: z.string().optional().describe("Filter by creator"),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional().describe("Filter by priority"),
    tags: z.array(z.string()).optional().describe("Filter by tags (returns tasks with any of these tags)"),
  },
  async ({ status, assignee, createdBy, priority, tags }: any) => {
    const tasks = taskManager.listTasks({ status, assignee, createdBy, priority, tags })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ tasks })
      }]
    }
  }
)

tool(
  "get_task",
  "Get details for a specific task by ID.",
  {
    id: z.string().describe("Task ID"),
  },
  async ({ id }: any) => {
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

tool(
  "update_task",
  "Update an existing task. Can change status, assignee, description, etc.",
  {
    id: z.string().describe("Task ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    status: z.enum(["todo", "doing", "blocked", "validating", "done", "resolved_externally", "cancelled"]).optional().describe("New status"),
    assignee: z.string().optional().describe("New assignee"),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional().describe("New priority"),
    blocked_by: z.array(z.string()).optional().describe("Task IDs blocking this task"),
    epic_id: z.string().optional().describe("Epic ID this task belongs to"),
    tags: z.array(z.string()).optional().describe("New tags"),
    metadata: z.record(z.unknown()).optional().describe("New metadata"),
  },
  async ({ id, title, description, status, assignee, priority, blocked_by, epic_id, tags, metadata }: any) => {
    const task = await taskManager.updateTask(id, {
      title,
      description,
      status,
      assignee,
      priority,
      blocked_by,
      epic_id,
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

tool(
  "delete_task",
  "Delete a task permanently.",
  {
    id: z.string().describe("Task ID"),
  },
  async ({ id }: any) => {
    const deleted = await taskManager.deleteTask(id)
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

tool(
  "get_next_task",
  "Get the next highest-priority task to work on (pull-based assignment). Returns unassigned todo tasks, prioritized P0 > P1 > P2 > P3, oldest first.",
  {
    agent: z.string().optional().describe("Agent name to filter tasks for (optional)"),
  },
  async ({ agent }: any) => {
    const task = taskManager.getNextTask(agent)
    if (!task) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ task: null, message: "No available tasks" })
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

// ═══════════════════════════════════════════════════════════════════════════════
// Inbox + Heartbeat Tools
// ═══════════════════════════════════════════════════════════════════════════════

tool(
  "get_inbox",
  "Get unread inbox messages for an agent — mentions, replies, and high-priority chat. Use this to check what teammates have said to you.",
  {
    agent: z.string().describe("Your agent name (e.g. 'claude')"),
    limit: z.number().optional().describe("Max messages to return (default: 20)"),
    since: z.number().optional().describe("Unix timestamp ms — only return messages after this time"),
  },
  async ({ agent, limit, since }: any) => {
    const allMessages = chatManager.getMessages({ limit: 500 })
    const inbox = inboxManager.getInbox(agent, allMessages, { limit: limit ?? 20, since })
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ inbox, count: inbox.length })
      }]
    }
  }
)

tool(
  "ack_inbox",
  "Acknowledge (mark as read) inbox messages for an agent. Call after reading and responding to mentions.",
  {
    agent: z.string().describe("Your agent name (e.g. 'claude')"),
    message_ids: z.array(z.string()).optional().describe("Specific message IDs to ack (omit to ack by timestamp)"),
    up_to_timestamp: z.number().optional().describe("Ack all messages up to this Unix timestamp ms"),
  },
  async ({ agent, message_ids, up_to_timestamp }: any) => {
    await inboxManager.ackMessages(agent, message_ids, up_to_timestamp)
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ success: true, agent })
      }]
    }
  }
)

tool(
  "get_heartbeat",
  "Get your agent heartbeat — active task, inbox count, queue state, and recommended action. The single most efficient call for staying oriented.",
  {
    agent: z.string().describe("Your agent name (e.g. 'claude')"),
  },
  async ({ agent }: any) => {
    const allMessages = chatManager.getMessages({ limit: 500 })
    const inbox = inboxManager.getInbox(agent, allMessages, { limit: 10 })
    const activeTasks = taskManager.listTasks({ status: "doing", assignee: agent })
    const nextTask = taskManager.getNextTask(agent)
    const queue = {
      todo: taskManager.listTasks({ status: "todo", assignee: agent }).length,
      doing: activeTasks.length,
      validating: taskManager.listTasks({ status: "validating", assignee: agent }).length,
    }
    const action = inbox.length > 0
      ? `Check inbox (${inbox.length} messages)`
      : activeTasks.length > 0
        ? `Continue task: ${activeTasks[0]?.title}`
        : nextTask
          ? `Pick up next task: ${nextTask.title}`
          : "IDLE — no tasks or inbox items"
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ agent, ts: Date.now(), inbox, inboxCount: inbox.length, active: activeTasks[0] ?? null, next: nextTask ?? null, queue, action })
      }]
    }
  }
)

tool(
  "get_pulse",
  "Get the team pulse snapshot — deploy status, board counts, per-agent activity. Use to understand what the team is working on.",
  {},
  async () => {
    const agents = getAgentRoles().map(r => r.name)
    const agentStates = agents.map(a => ({
      agent: a,
      doing: taskManager.listTasks({ status: "doing", assignee: a }).length,
      todo: taskManager.listTasks({ status: "todo", assignee: a }).length,
    }))
    const board = {
      todo: taskManager.listTasks({ status: "todo" }).length,
      doing: taskManager.listTasks({ status: "doing" }).length,
      validating: taskManager.listTasks({ status: "validating" }).length,
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ts: Date.now(), board, agents: agentStates })
      }]
    }
  }
)

// ═══════════════════════════════════════════════════════════════════════════════
// Room Tools (room-model-v0.1.1 slice 2 — agents see humans)
// ═══════════════════════════════════════════════════════════════════════════════

tool(
  "room_list_participants",
  "List humans currently present in this host's room. Returns the ephemeral participant set from the live Supabase Realtime presence channel — these are the people who have a /canvas tab open right now. Use this when deciding whether to greet someone, hold off on autonomous chatter, or check if a human is around to answer a question. Empty list = nobody on canvas right now (autonomous mode).",
  {},
  async () => {
    const participants = listRoomParticipants()
    const status = getRoomPresenceStatus()
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          participants,
          count: participants.length,
          hostId: status.hostId,
          initialized: status.initialized,
        })
      }]
    }
  }
)

tool(
  "room_recent_transcript",
  "Recent FINALIZED speech segments from humans in this host's room (browser-STT v0). Each segment has speaker identity (participantId, userId), text, startedAt, finalizedAt, and receivedAt (node arrival). Returns the last `seconds` of finals (default 30, max 60 — the ring buffer window). Browser-STT v0 is best-effort — Firefox and other browsers without the Web Speech API contribute nothing. Use this when you want to know what people just said without waiting for the next push.",
  { seconds: z.number().int().min(1).max(60).optional() },
  async (args: { seconds?: number }) => {
    const seconds = typeof args?.seconds === 'number' ? args.seconds : 30
    const since = Date.now() - seconds * 1000
    const segments = getRecentTranscript(since)
    const status = getRoomTranscriptStatus()
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          segments,
          count: segments.length,
          hostId: status.hostId,
          initialized: status.initialized,
          windowMs: status.windowMs,
        })
      }]
    }
  }
)

tool(
  "room_list_artifacts",
  "Artifacts shared into this host's room (Room Share Snapshot v0). Returns metadata only — fetch bytes via the cloud-proxied content/thumbnail URLs. `kind` filters by artifact discriminator (snapshots are the only kind in v0; recordings/agent outputs may follow). `since` is a unix-ms cursor for incremental polling — pass the previous result's max createdAt. `limit` defaults to 50, max 200. Each item carries id, kind, name, mimeType, sizeBytes, createdAt, sharedBy, sharedByDisplayName, optional dimensions, plus url + thumbnailUrl. Use when you want to look back at what people just shared without waiting for the next push.",
  { kind: z.string().optional(), since: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).optional() },
  async (args: { kind?: string; since?: number; limit?: number }) => {
    const limit = typeof args?.limit === 'number' ? args.limit : 50
    const artifacts = listArtifacts({
      agentId: ROOM_ARTIFACT_AGENT_ID,
      kind: args?.kind,
      sinceMs: args?.since,
      limit,
    })
    const items = artifacts.map((a) => ({
      id: a.id,
      kind: (a.metadata?.kind as string | undefined) ?? null,
      name: a.name,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
      sharedBy: (a.metadata?.sharedBy as string | undefined) ?? null,
      sharedByDisplayName: (a.metadata?.sharedByDisplayName as string | undefined) ?? null,
      dimensions: (a.metadata?.dimensions as { width: number; height: number } | undefined) ?? null,
      url: `/room/artifacts/${a.id}/content`,
      thumbnailUrl: `/room/artifacts/${a.id}/thumbnail`,
    }))
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          artifacts: items,
          count: items.length,
          kind: args?.kind ?? null,
        })
      }]
    }
  }
)

tool(
  "room_get_artifact_image",
  "Fetch a room artifact's actual image bytes so you can see it. Use this whenever a snapshot is shared into the room (room_artifact_shared push, or a `room: ... shared a snapshot ... → /room/artifacts/<id>/content` chat line) and you need to describe or reason about what's in it. Pass the artifact id (e.g. `art-1777340177042-vbh4q3lh9h`). Returns inline image content the model can see directly — same shape browser screenshots use. If the artifact is not an image (kind without bytes you can view) or doesn't exist, returns a text error.",
  { id: z.string().min(1).describe("Artifact id (e.g. 'art-1777340177042-vbh4q3lh9h')") },
  async ({ id }: { id: string }) => {
    const art = getArtifact(id)
    if (!art || art.agentId !== ROOM_ARTIFACT_AGENT_ID) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "artifact not found", id }) }] }
    }
    if (!art.mimeType.startsWith("image/")) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "artifact is not an image", id, mimeType: art.mimeType }) }] }
    }
    const buf = readArtifactContent(id)
    if (!buf) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "artifact bytes unavailable (evicted)", id }) }] }
    }
    return {
      content: [{
        type: "image",
        data: buf.toString("base64"),
        mimeType: art.mimeType,
      }],
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
  samplingCapable: boolean
}

const sseSessions = new Map<string, SSESession>()

/**
 * Returns the names of model providers available via subscription-backed sampling sessions.
 * A sampling-capable Claude Code session → 'claude' (Anthropic subscription).
 * Used by capability-readiness to report subscription-backed model availability.
 */
export function getActiveSamplingProviders(): string[] {
  const hasSampling = Array.from(sseSessions.values()).some(
    s => s.samplingCapable && s.controller.desiredSize !== null
  )
  return hasSampling ? ['claude'] : []
}
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
          status: { type: "string", enum: ["todo", "doing", "blocked", "validating", "done", "cancelled"] },
          assignee: { type: "string", description: "Assignee" },
          createdBy: { type: "string", description: "Creator" },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          blocked_by: { type: "array", items: { type: "string" }, description: "Blocking task IDs" },
          epic_id: { type: "string", description: "Epic ID" },
          tags: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
        },
        required: ["title", "createdBy"],
      },
    },
    handler: async (args) => {
      const task = await taskManager.createTask({ status: "todo", ...args })
      return { content: [{ type: "text", text: JSON.stringify({ success: true, task }) }] }
    },
  })

  toolHandlers.set("list_tasks", {
    schema: {
      description: "List tasks with optional filters",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["todo", "doing", "blocked", "validating", "done", "cancelled"] },
          assignee: { type: "string" },
          createdBy: { type: "string" },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
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
          status: { type: "string", enum: ["todo", "doing", "blocked", "validating", "done", "cancelled"] },
          assignee: { type: "string" },
          priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
          blocked_by: { type: "array", items: { type: "string" } },
          epic_id: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          metadata: { type: "object" },
        },
        required: ["id"],
      },
    },
    handler: async (args) => {
      const { id, ...updates } = args
      const task = await taskManager.updateTask(id, updates)
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
      const deleted = await taskManager.deleteTask(args.id)
      if (!deleted) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Task not found" }) }] }
      }
      return { content: [{ type: "text", text: JSON.stringify({ success: true }) }] }
    },
  })

  toolHandlers.set("get_next_task", {
    schema: {
      description: "Get the next highest-priority task to work on (pull-based assignment)",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent name to filter tasks for (optional)" },
        },
      },
    },
    handler: async (args) => {
      const task = taskManager.getNextTask(args.agent)
      if (!task) {
        return { content: [{ type: "text", text: JSON.stringify({ task: null, message: "No available tasks" }) }] }
      }
      return { content: [{ type: "text", text: JSON.stringify({ task }) }] }
    },
  })

  // ── Calendar tools ────────────────────────────────────────────────────────

  toolHandlers.set("calendar_upcoming", {
    schema: {
      description: "Get upcoming calendar events. Use when someone asks 'what's on my calendar', 'what's happening this week', etc. Returns events sorted chronologically.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Number of days ahead to look (1–90, default 7)" },
        },
      },
    },
    handler: async (args) => {
      const days = Math.max(1, Math.min(90, Number(args.days) || 7))
      const now = Date.now()
      const to = now + days * 24 * 60 * 60 * 1000
      const events = calendarEvents.listEvents({ from: now, to, status: 'confirmed' })
      const result = events.map(e => ({
        id: e.id,
        title: e.summary,
        start: new Date(e.dtstart).toISOString(),
        end: new Date(e.dtend).toISOString(),
        attendees: e.attendees.map(a => a.name),
        description: e.description || null,
        location: e.location || null,
      }))
      return { content: [{ type: "text", text: JSON.stringify({ events: result, count: result.length, days }) }] }
    },
  })

  toolHandlers.set("calendar_create", {
    schema: {
      description: "Create a calendar event. Use when someone says 'schedule', 'book', 'add a meeting', 'set up a standup', etc. Start time must be in the future.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title (e.g. 'Standup', 'Team sync')" },
          start: { type: "string", description: "Start time as ISO-8601 (e.g. '2026-03-15T10:00:00-07:00')" },
          duration_minutes: { type: "number", description: "Duration in minutes (default 60)" },
          attendees: {
            type: "array",
            items: { type: "string" },
            description: "Attendee names or emails (max 50)",
          },
          description: { type: "string", description: "Optional event description" },
          location: { type: "string", description: "Optional location" },
        },
        required: ["title", "start"],
      },
    },
    handler: async (args) => {
      const title = String(args.title || '').trim()
      const startStr = String(args.start || '')
      if (!title) return { content: [{ type: "text", text: JSON.stringify({ error: "title is required" }) }] }
      if (!startStr) return { content: [{ type: "text", text: JSON.stringify({ error: "start is required" }) }] }

      const dtstart = Date.parse(startStr)
      if (isNaN(dtstart)) return { content: [{ type: "text", text: JSON.stringify({ error: "start must be a valid ISO-8601 datetime" }) }] }
      if (dtstart < Date.now()) return { content: [{ type: "text", text: JSON.stringify({ error: "start must be in the future", code: "PAST_DATE" }) }] }

      const durationMinutes = typeof args.duration_minutes === 'number' ? args.duration_minutes : 60
      const dtend = dtstart + durationMinutes * 60 * 1000

      // Duplicate check
      const existing = calendarEvents.listEvents({ from: dtstart - 1000, to: dtstart + 1000 })
      const duplicate = existing.find(e => e.summary.toLowerCase() === title.toLowerCase() && e.dtstart === dtstart)
      if (duplicate) return { content: [{ type: "text", text: JSON.stringify({ error: "Duplicate: same title and start time already exists", existing_id: duplicate.id }) }] }

      const rawAttendees = Array.isArray(args.attendees) ? args.attendees.slice(0, 50) : []
      const event = calendarEvents.createEvent({
        summary: title,
        description: typeof args.description === 'string' ? args.description : undefined,
        dtstart,
        dtend,
        organizer: 'agent',
        attendees: rawAttendees.map((a: unknown) => ({
          name: typeof a === 'string' ? a : String(a),
          email: typeof a === 'string' && a.includes('@') ? a : undefined,
          status: 'needs-action' as const,
        })),
        categories: [],
      })
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            id: event.id,
            title: event.summary,
            start: new Date(event.dtstart).toISOString(),
            end: new Date(event.dtend).toISOString(),
          }),
        }],
      }
    },
  })

  toolHandlers.set("calendar_cancel", {
    schema: {
      description: "Cancel (delete) a calendar event by ID. Use when someone says 'cancel', 'remove', 'delete a meeting'. Get the event ID from calendar_upcoming first if needed.",
      inputSchema: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "Event ID to cancel" },
        },
        required: ["event_id"],
      },
    },
    handler: async (args) => {
      const eventId = String(args.event_id || '').trim()
      if (!eventId) return { content: [{ type: "text", text: JSON.stringify({ error: "event_id is required" }) }] }
      const event = calendarEvents.getEvent(eventId)
      if (!event) return { content: [{ type: "text", text: JSON.stringify({ error: "Event not found", event_id: eventId }) }] }
      const deleted = calendarEvents.deleteEvent(eventId)
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: deleted, event_id: eventId, title: event.summary }),
        }],
      }
    },
  })

  // Inbox + heartbeat tools
  toolHandlers.set("get_inbox", {
    schema: {
      description: "Get unread inbox messages for an agent — mentions, replies, high-priority chat.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Your agent name (e.g. 'claude')" },
          limit: { type: "number", description: "Max messages (default: 20)" },
          since: { type: "number", description: "Unix timestamp ms — only return messages after this time" },
        },
        required: ["agent"],
      },
    },
    handler: async (args) => {
      const allMessages = chatManager.getMessages({ limit: 500 })
      const inbox = inboxManager.getInbox(args.agent, allMessages, { limit: args.limit ?? 20, since: args.since })
      return { content: [{ type: "text", text: JSON.stringify({ inbox, count: inbox.length }) }] }
    },
  })

  toolHandlers.set("ack_inbox", {
    schema: {
      description: "Acknowledge inbox messages as read. Call after responding to mentions.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Your agent name" },
          message_ids: { type: "array", items: { type: "string" }, description: "Message IDs to ack" },
          up_to_timestamp: { type: "number", description: "Ack all messages up to this timestamp ms" },
        },
        required: ["agent"],
      },
    },
    handler: async (args) => {
      await inboxManager.ackMessages(args.agent, args.message_ids, args.up_to_timestamp)
      return { content: [{ type: "text", text: JSON.stringify({ success: true, agent: args.agent }) }] }
    },
  })

  toolHandlers.set("get_heartbeat", {
    schema: {
      description: "Get agent heartbeat — active task, inbox count, queue, recommended action.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Your agent name (e.g. 'claude')" },
        },
        required: ["agent"],
      },
    },
    handler: async (args) => {
      const allMessages = chatManager.getMessages({ limit: 500 })
      const inbox = inboxManager.getInbox(args.agent, allMessages, { limit: 10 })
      const activeTasks = taskManager.listTasks({ status: "doing", assignee: args.agent })
      const nextTask = taskManager.getNextTask(args.agent)
      const queue = {
        todo: taskManager.listTasks({ status: "todo", assignee: args.agent }).length,
        doing: activeTasks.length,
        validating: taskManager.listTasks({ status: "validating", assignee: args.agent }).length,
      }
      const action = inbox.length > 0
        ? `Check inbox (${inbox.length} messages)`
        : activeTasks.length > 0
          ? `Continue task: ${activeTasks[0]?.title}`
          : nextTask ? `Pick up next task: ${nextTask.title}` : "IDLE"
      return { content: [{ type: "text", text: JSON.stringify({ agent: args.agent, ts: Date.now(), inbox, inboxCount: inbox.length, active: activeTasks[0] ?? null, next: nextTask ?? null, queue, action }) }] }
    },
  })

  toolHandlers.set("get_pulse", {
    schema: {
      description: "Get team pulse — board counts and per-agent activity.",
      inputSchema: { type: "object", properties: {} },
    },
    handler: async () => {
      const agents = getAgentRoles().map(r => r.name)
      const agentStates = agents.map(a => ({
        agent: a,
        doing: taskManager.listTasks({ status: "doing", assignee: a }).length,
        todo: taskManager.listTasks({ status: "todo", assignee: a }).length,
      }))
      const board = {
        todo: taskManager.listTasks({ status: "todo" }).length,
        doing: taskManager.listTasks({ status: "doing" }).length,
        validating: taskManager.listTasks({ status: "validating" }).length,
      }
      return { content: [{ type: "text", text: JSON.stringify({ ts: Date.now(), board, agents: agentStates }) }] }
    },
  })

  console.log(`[MCP] Registered ${toolHandlers.size} tools for SSE`)
}

initToolHandlers()

// ═══════════════════════════════════════════════════════════════════════════════
// Sampling: server-initiated @claude mentions
// ═══════════════════════════════════════════════════════════════════════════════

const CLAUDE_MENTION_RE = /@claude\b/i

/**
 * Push a sampling/createMessage request to all sampling-capable SSE sessions.
 * Called when a message mentioning @claude arrives — lets Claude Code respond
 * autonomously without the user having to manually trigger a turn.
 */
function pushClaudeSampling(triggerMessage: AgentMessage): void {
  const capableSessions = Array.from(sseSessions.entries()).filter(
    ([, s]) => s.samplingCapable && s.controller.desiredSize !== null
  )

  if (capableSessions.length === 0) return

  // Build recent context (last 10 messages)
  const recentMessages = chatManager.getMessages({ limit: 10 })
  const contextText = recentMessages
    .map(m => `[${m.from}${m.channel ? `/#${m.channel}` : ''}]: ${m.content}`)
    .join('\n')

  const userText =
    `You are @claude, a member of the reflectt team. A teammate mentioned you in chat.\n\n` +
    `Recent conversation:\n${contextText}\n\n` +
    `New message from @${triggerMessage.from} in #${triggerMessage.channel ?? 'general'}:\n` +
    `${triggerMessage.content}\n\n` +
    `Respond using the send_message tool (from: "claude", room: "${triggerMessage.channel ?? 'general'}"). ` +
    `Keep responses concise and on-point. Use other MCP tools (get_task, list_tasks, etc.) as needed.`

  const request = {
    jsonrpc: "2.0",
    id: `smpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method: "sampling/createMessage",
    params: {
      messages: [{ role: "user", content: { type: "text", text: userText } }],
      systemPrompt: "You are @claude, a software engineer on the reflectt team. You have access to team chat and tasks via MCP tools. Be concise, direct, and helpful.",
      maxTokens: 4096,
      includeContext: "thisServer",
    },
  }

  const encoded = new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(request)}\n\n`)

  for (const [sessionId, session] of capableSessions) {
    try {
      session.controller.enqueue(encoded)
      session.lastUsed = Date.now()
      console.log(`[MCP] Pushed sampling/createMessage to session ${sessionId} (trigger: @${triggerMessage.from})`)
    } catch {
      sseSessions.delete(sessionId)
    }
  }
}

// Listen for message_posted events and trigger sampling when @claude is mentioned
eventBus.on('mcp-claude-sampling', (event) => {
  if (event.type !== 'message_posted') return
  const message = event.data as AgentMessage
  // Don't loop — ignore messages from claude itself or system
  if (message.from === 'claude' || message.from === 'system') return
  if (CLAUDE_MENTION_RE.test(message.content)) {
    pushClaudeSampling(message)
  }
})

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

async function handleJsonRpcMessage(message: any, sessionId?: string): Promise<any> {
  const { method, params, id } = message

  if (method === "initialize") {
    // Track whether the client declared sampling capability
    if (sessionId) {
      const session = sseSessions.get(sessionId)
      if (session) {
        const clientCaps = params?.capabilities ?? {}
        session.samplingCapable = Boolean(clientCaps.sampling)
        console.log(`[MCP] Session ${sessionId} samplingCapable=${session.samplingCapable}`)
      }
    }
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "reflectt-node", version: PKG_VERSION },
      },
    }
  }

  // Sampling response from client (result or error in response to our sampling/createMessage request)
  if (method === undefined && (message.result !== undefined || message.error !== undefined) && id !== undefined) {
    // This is a JSON-RPC response to a server-initiated request (e.g. sampling/createMessage)
    // Nothing to do — the model has already acted on the sampling request autonomously
    console.log(`[MCP] Received sampling response for request ${id}`)
    return null
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
    samplingCapable: false, // updated after initialize
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

    const response = await handleJsonRpcMessage(body, sessionId)

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
