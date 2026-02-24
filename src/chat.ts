// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Agent-to-agent messaging system
 */
import type { AgentMessage, ChatRoom } from './types.js'
import { promises as fs } from 'fs'
import { join } from 'path'
import { eventBus } from './events.js'
import { DATA_DIR, LEGACY_DATA_DIR } from './config.js'
import { CHANNEL_DEFINITIONS, DEFAULT_CHAT_CHANNELS } from './channels.js'
import { getDb, importJsonlIfNeeded, safeJsonParse, safeJsonStringify } from './db.js'
import type Database from 'better-sqlite3'
// OpenClaw integration pending — chat works standalone for now

const MESSAGES_FILE = join(DATA_DIR, 'messages.jsonl')
const LEGACY_MESSAGES_FILE = join(LEGACY_DATA_DIR, 'messages.jsonl')

function importMessages(db: Database.Database, records: unknown[]): number {
  const byId = new Map<string, AgentMessage>()

  for (const record of records) {
    if (!record || typeof record !== 'object') continue

    const message = record as Partial<AgentMessage>
    if (typeof message.id !== 'string' || message.id.length === 0) continue

    const deleteUpdate = Boolean((message.metadata as any)?.deleteUpdate)
    if (deleteUpdate) {
      byId.delete(message.id)
      continue
    }

    if (typeof message.from !== 'string' || typeof message.content !== 'string') continue

    byId.set(message.id, {
      id: message.id,
      from: message.from,
      to: message.to,
      content: message.content,
      timestamp: Number(message.timestamp) || Date.now(),
      channel: message.channel || 'general',
      reactions: message.reactions || {},
      threadId: message.threadId,
      metadata: message.metadata,
    })
  }

  if (byId.size === 0) return 0

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO chat_messages (
      id, "from", "to", content, timestamp, channel, reactions, thread_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((messages: AgentMessage[]) => {
    for (const msg of messages) {
      upsert.run(
        msg.id,
        msg.from,
        msg.to ?? null,
        msg.content,
        msg.timestamp,
        msg.channel || 'general',
        safeJsonStringify(msg.reactions),
        msg.threadId ?? null,
        safeJsonStringify(msg.metadata),
      )
    }
  })

  const messages = Array.from(byId.values())
  insertMany(messages)
  return messages.length
}

/** Row shape returned by SQLite queries on chat_messages */
interface ChatMessageRow {
  id: string
  from: string
  to: string | null
  content: string
  timestamp: number
  channel: string | null
  reactions: string | null
  thread_id: string | null
  metadata: string | null
}

/** Convert a SQLite row to an AgentMessage */
function rowToMessage(row: ChatMessageRow): AgentMessage {
  return {
    id: row.id,
    from: row.from,
    to: row.to ?? undefined,
    content: row.content,
    timestamp: row.timestamp,
    channel: row.channel || 'general',
    reactions: safeJsonParse<Record<string, string[]>>(row.reactions) || {},
    threadId: row.thread_id ?? undefined,
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
  }
}

class ChatManager {
  private rooms = new Map<string, ChatRoom>()
  private subscribers = new Set<(message: AgentMessage) => void>()
  private initialized = false

  constructor() {
    // OpenClaw listener disabled for now — chat works standalone
    // TODO: re-enable when OpenClaw connection is configured
    // openclawClient.on('message', ...)

    // Create default rooms/channels
    for (const channel of CHANNEL_DEFINITIONS) {
      this.createRoom(channel.id, channel.name)
    }
    
    // Load persisted messages
    this.loadMessages().catch(err => {
      console.error('[Chat] Failed to load messages:', err)
    })
  }

  private async loadMessages(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })

      const db = getDb()

      // One-time JSONL -> SQLite import (current + legacy paths)
      importJsonlIfNeeded(db, MESSAGES_FILE, 'chat_messages', importMessages)
      importJsonlIfNeeded(db, LEGACY_MESSAGES_FILE, 'chat_messages', importMessages)

      // All queries now go directly to SQLite — no in-memory array.
      const countRow = db.prepare('SELECT COUNT(*) as count FROM chat_messages').get() as { count: number }
      console.log(`[Chat] SQLite has ${countRow.count} messages (all queries go to DB, no in-memory cache)`)
    } finally {
      this.initialized = true
    }
  }

  private writeMessageToDb(message: AgentMessage): void {
    const db = getDb()
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO chat_messages (
        id, "from", "to", content, timestamp, channel, reactions, thread_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    upsert.run(
      message.id,
      message.from,
      message.to ?? null,
      message.content,
      message.timestamp,
      message.channel || 'general',
      safeJsonStringify(message.reactions),
      message.threadId ?? null,
      safeJsonStringify(message.metadata),
    )
  }

  private deleteMessageFromDb(messageId: string): void {
    const db = getDb()
    db.prepare('DELETE FROM chat_messages WHERE id = ?').run(messageId)
  }

  private async appendAuditRecord(record: unknown): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      await fs.appendFile(MESSAGES_FILE, JSON.stringify(record) + '\n', 'utf-8')
    } catch (err) {
      console.error('[Chat] Failed to append audit record:', err)
    }
  }

  private async persistMessage(message: AgentMessage): Promise<void> {
    try {
      this.writeMessageToDb(message)
      await this.appendAuditRecord(message)
    } catch (err) {
      console.error('[Chat] Failed to persist message:', err)
    }
  }

  createRoom(id: string, name: string): ChatRoom {
    const room: ChatRoom = {
      id,
      name,
      participants: [],
      createdAt: Date.now(),
    }
    this.rooms.set(id, room)
    return room
  }

  getRoom(id: string): ChatRoom | undefined {
    return this.rooms.get(id)
  }

  listRooms(): ChatRoom[] {
    return Array.from(this.rooms.values())
  }

  // ── Noise Budget State ──
  // Per-channel message counts in rolling windows
  private channelBudgetCounters = new Map<string, { count: number; windowStart: number }>()
  // Duplicate suppression: hash → timestamp of last send
  private recentMessageHashes = new Map<string, number>()
  // Digest batching: queued system reminders per channel
  private digestQueue = new Map<string, Array<{ content: string; from: string; queuedAt: number }>>()
  private digestTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Configurable limits
  private static readonly CHANNEL_BUDGET_WINDOW_MS = 60 * 60 * 1000 // 1 hour
  private static readonly CHANNEL_BUDGET_MAX: Record<string, number> = {
    general: 30,    // max 30 messages per hour in #general
    shipping: 20,
    reviews: 20,
    blockers: 15,
    _default: 40,
  }
  private static readonly DEDUP_WINDOW_MS = 5 * 60 * 1000 // 5 minute dedup window
  private static readonly DIGEST_BATCH_DELAY_MS = 30 * 1000 // 30s digest batching window
  private static readonly SYSTEM_REMINDER_PATTERNS = [
    /^⚠️ Working contract warning/,
    /^⚠️ \[Product Enforcement\]/,
    /^🔄.*Auto-requeued/,
    /^⚠️ SLA breach/,
    /^🪞 Reflection nudge/,
  ]

  /**
   * Check if message is within per-channel budget
   */
  private checkChannelBudget(channel: string): { allowed: boolean; reason?: string } {
    const now = Date.now()
    const counter = this.channelBudgetCounters.get(channel)
    const maxBudget = ChatManager.CHANNEL_BUDGET_MAX[channel] ?? ChatManager.CHANNEL_BUDGET_MAX._default

    if (!counter || now - counter.windowStart > ChatManager.CHANNEL_BUDGET_WINDOW_MS) {
      // New window
      this.channelBudgetCounters.set(channel, { count: 1, windowStart: now })
      return { allowed: true }
    }

    if (counter.count >= maxBudget) {
      return { allowed: false, reason: `Channel #${channel} budget exceeded (${counter.count}/${maxBudget} per hour)` }
    }

    counter.count++
    return { allowed: true }
  }

  /**
   * Check for duplicate messages within suppression window
   */
  private checkDuplicate(from: string, channel: string, content: string): boolean {
    const now = Date.now()
    // Clean expired entries
    for (const [key, ts] of this.recentMessageHashes) {
      if (now - ts > ChatManager.DEDUP_WINDOW_MS) this.recentMessageHashes.delete(key)
    }

    // Hash: from + channel + normalized content (strip timestamps/IDs)
    const normalized = content.replace(/\d{10,}/g, '').replace(/task-\S+/g, 'TASK').trim().slice(0, 200)
    const hash = `${from}:${channel}:${normalized}`

    if (this.recentMessageHashes.has(hash)) {
      return true // duplicate
    }

    this.recentMessageHashes.set(hash, now)
    return false
  }

  /**
   * Check if message is a system reminder eligible for digest batching
   */
  private isSystemReminder(content: string): boolean {
    return ChatManager.SYSTEM_REMINDER_PATTERNS.some(p => p.test(content))
  }

  /**
   * Queue a system reminder for digest batching
   * Returns true if queued (caller should skip sending), false if digest should flush now
   */
  private queueForDigest(channel: string, from: string, content: string): boolean {
    const queue = this.digestQueue.get(channel) || []
    queue.push({ content, from, queuedAt: Date.now() })
    this.digestQueue.set(channel, queue)

    // If timer already running, just add to queue
    if (this.digestTimers.has(channel)) return true

    // Start digest timer
    const timer = setTimeout(() => {
      this.flushDigest(channel)
      this.digestTimers.delete(channel)
    }, ChatManager.DIGEST_BATCH_DELAY_MS)
    timer.unref()
    this.digestTimers.set(channel, timer)

    return true
  }

  /**
   * Flush queued digest messages into a single batched message
   */
  private flushDigest(channel: string): void {
    const queue = this.digestQueue.get(channel)
    if (!queue || queue.length === 0) return
    this.digestQueue.delete(channel)

    if (queue.length === 1) {
      // Single message — send as-is
      void this.sendMessage({ from: queue[0].from, channel, content: queue[0].content })
      return
    }

    // Batch multiple reminders into a single digest
    const summary = `📋 **System digest** (${queue.length} reminders):\n` +
      queue.map((q, i) => `${i + 1}. ${q.content.split('\n')[0].slice(0, 120)}`).join('\n')

    void this.sendMessage({
      from: 'system',
      channel,
      content: summary,
      metadata: { digest: true, batchedCount: queue.length },
    })
  }

  async sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp' | 'replyCount'>): Promise<AgentMessage> {
    const channel = message.channel || 'general'

    // ── Noise Budget Checks ──
    // Skip budget checks for direct messages (has `to` field) and metadata.bypass_budget
    const bypassBudget = (message.metadata as any)?.bypass_budget === true || message.to
    if (!bypassBudget) {
      // 1. Duplicate suppression
      if (this.checkDuplicate(message.from, channel, message.content)) {
        console.log(`[Chat/NoiseBudget] Suppressed duplicate from ${message.from} in #${channel}`)
        // Return a synthetic message so callers don't break
        return {
          ...message,
          id: `msg-${Date.now()}-suppressed`,
          timestamp: Date.now(),
          channel,
          reactions: {},
        } as AgentMessage
      }

      // 2. System reminder digest batching
      if (this.isSystemReminder(message.content)) {
        if (this.queueForDigest(channel, message.from, message.content)) {
          console.log(`[Chat/NoiseBudget] Queued system reminder for digest in #${channel}`)
          return {
            ...message,
            id: `msg-${Date.now()}-queued`,
            timestamp: Date.now(),
            channel,
            reactions: {},
          } as AgentMessage
        }
      }

      // 3. Per-channel budget — DISABLED
      // Was silently dropping messages after 30/hr with a fake success response.
      // Dedup + watchdog are sufficient noise controls.
      // const budget = this.checkChannelBudget(channel)
      // if (!budget.allowed) { ... }
    }

    const fullMessage: AgentMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      channel,
      reactions: message.reactions || {},
      threadId: message.threadId,
    }

    // Persist to SQLite + JSONL audit
    await this.persistMessage(fullMessage)

    // Notify local subscribers
    this.notifySubscribers(fullMessage)

    // Emit event to event bus
    eventBus.emitMessagePosted(fullMessage)

    // Route to agent inboxes (auto-routing)
    // Note: We'll import inboxManager in a way that avoids circular dependency
    this.routeToInboxes(fullMessage)

    // TODO: Send via OpenClaw when connected

    return fullMessage
  }

  /**
   * Route message to agent inboxes
   * This is called automatically when a message is posted
   */
  private routeToInboxes(message: AgentMessage): void {
    // Import here to avoid circular dependency at module level
    import('./inbox.js').then(({ inboxManager }) => {
      // Get list of all agents from presence or a registry
      // For now, we'll extract agents from message history
      const agents = this.getKnownAgents()
      inboxManager.routeMessage(message, agents)
    }).catch(err => {
      console.error('[Chat] Failed to route message to inboxes:', err)
    })
  }

  /**
   * Get list of all known agents from message history
   */
  private getKnownAgents(): string[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT DISTINCT "from" as agent FROM chat_messages
      UNION
      SELECT DISTINCT "to" as agent FROM chat_messages WHERE "to" IS NOT NULL
    `).all() as Array<{ agent: string }>
    return rows.map(r => r.agent)
  }

  private handleIncomingMessage(message: AgentMessage) {
    // Persist to DB (INSERT OR REPLACE handles dedup)
    this.writeMessageToDb(message)
    this.notifySubscribers(message)
  }

  getMessages(options?: {
    from?: string
    to?: string
    channel?: string
    limit?: number
    since?: number
    before?: number
    after?: number
  }): AgentMessage[] {
    const db = getDb()
    const conditions: string[] = []
    const params: unknown[] = []

    if (options?.from) {
      conditions.push('"from" = ?')
      params.push(options.from)
    }
    if (options?.to) {
      conditions.push('"to" = ?')
      params.push(options.to)
    }
    if (options?.channel) {
      conditions.push('channel = ?')
      params.push(options.channel)
    }
    if (options?.since) {
      conditions.push('timestamp >= ?')
      params.push(options.since)
    }
    if (options?.before) {
      conditions.push('timestamp < ?')
      params.push(options.before)
    }
    if (options?.after) {
      conditions.push('timestamp > ?')
      params.push(options.after)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = options?.limit !== undefined ? options.limit : 20

    // Use subquery to get last N messages then order ascending
    const sql = limit > 0
      ? `SELECT * FROM (SELECT * FROM chat_messages ${where} ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp ASC`
      : `SELECT * FROM chat_messages ${where} ORDER BY timestamp ASC`

    if (limit > 0) params.push(limit)

    const rows = db.prepare(sql).all(...params) as ChatMessageRow[]
    const messages = rows.map(rowToMessage)

    return this.addReplyCounts(messages)
  }

  /**
   * Add replyCount field to messages
   */
  private addReplyCounts(messages: AgentMessage[]): AgentMessage[] {
    if (messages.length === 0) return messages
    const db = getDb()
    const stmt = db.prepare('SELECT COUNT(*) as count FROM chat_messages WHERE thread_id = ?')
    return messages.map(msg => {
      const row = stmt.get(msg.id) as { count: number }
      return { ...msg, replyCount: row.count }
    })
  }

  /**
   * Get all messages in a thread (parent + replies)
   */
  getThread(messageId: string): AgentMessage[] | null {
    const db = getDb()
    const parentRow = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as ChatMessageRow | undefined
    if (!parentRow) return null
    const parent = rowToMessage(parentRow)

    const replyRows = db.prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY timestamp ASC').all(messageId) as ChatMessageRow[]
    const replies = replyRows.map(rowToMessage)

    return this.addReplyCounts([parent, ...replies])
  }

  subscribe(callback: (message: AgentMessage) => void) {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notifySubscribers(message: AgentMessage) {
    this.subscribers.forEach(callback => {
      try {
        callback(message)
      } catch (err) {
        console.error('[Chat] Subscriber error:', err)
      }
    })
  }

  /**
   * Get all channels with message counts
   */
  getChannels(): Array<{ channel: string; count: number; lastActivity: number }> {
    const db = getDb()
    const rows = db.prepare(`
      SELECT COALESCE(channel, 'general') as channel, COUNT(*) as count, MAX(timestamp) as lastActivity
      FROM chat_messages
      GROUP BY COALESCE(channel, 'general')
      ORDER BY lastActivity DESC
    `).all() as Array<{ channel: string; count: number; lastActivity: number }>

    // Include default channels even if empty
    const channelMap = new Map<string, { count: number; lastActivity: number }>()
    DEFAULT_CHAT_CHANNELS.forEach(ch => channelMap.set(ch, { count: 0, lastActivity: 0 }))
    for (const row of rows) {
      channelMap.set(row.channel, { count: row.count, lastActivity: row.lastActivity })
    }

    return Array.from(channelMap.entries())
      .map(([channel, data]) => ({ channel, ...data }))
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }

  /**
   * Add reaction to a message
   */
  async addReaction(messageId: string, emoji: string, from: string): Promise<AgentMessage | null> {
    const db = getDb()
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as ChatMessageRow | undefined
    if (!row) return null
    const message = rowToMessage(row)
    if (!message) {
      return null
    }
    
    // Initialize reactions if needed
    if (!message.reactions) {
      message.reactions = {}
    }
    
    // Add agent to reaction list (toggle off if already present)
    if (!message.reactions[emoji]) {
      message.reactions[emoji] = []
    }
    
    const agents = message.reactions[emoji]
    const index = agents.indexOf(from)
    
    if (index >= 0) {
      // Remove reaction (toggle off)
      agents.splice(index, 1)
      if (agents.length === 0) {
        delete message.reactions[emoji]
      }
    } else {
      // Add reaction
      agents.push(from)
    }
    
    // Persist updated message to SQLite + JSONL audit
    this.writeMessageToDb(message)
    await this.appendAuditRecord(message)

    // Notify subscribers
    this.notifySubscribers(message)
    
    // Emit event
    eventBus.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'message_posted', // Using existing event type for now
      timestamp: Date.now(),
      data: { ...message, reactionUpdate: true },
    })
    
    return message
  }

  /**
   * Get reactions for a message
   */
  getReactions(messageId: string): Record<string, string[]> | null {
    const db = getDb()
    const row = db.prepare('SELECT reactions FROM chat_messages WHERE id = ?').get(messageId) as { reactions: string | null } | undefined
    if (!row) return null
    return safeJsonParse<Record<string, string[]>>(row.reactions) || {}
  }

  async editMessage(messageId: string, editor: string, content: string): Promise<{ ok: true; message: AgentMessage } | { ok: false; error: 'not_found' | 'forbidden' | 'invalid_content' }> {
    const trimmed = content.trim()
    if (!trimmed) {
      return { ok: false, error: 'invalid_content' }
    }

    const db = getDb()
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as ChatMessageRow | undefined
    if (!row) {
      return { ok: false, error: 'not_found' }
    }

    const message = rowToMessage(row)
    if (message.from !== editor) {
      return { ok: false, error: 'forbidden' }
    }

    message.content = trimmed
    message.metadata = {
      ...(message.metadata || {}),
      editedAt: Date.now(),
      editedBy: editor,
    }

    this.writeMessageToDb(message)
    await this.appendAuditRecord(message)
    this.notifySubscribers(message)

    eventBus.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'message_posted',
      timestamp: Date.now(),
      data: { ...message, editUpdate: true },
    })

    return { ok: true, message }
  }

  async deleteMessage(messageId: string, actor: string): Promise<{ ok: true } | { ok: false; error: 'not_found' | 'forbidden' }> {
    const db = getDb()
    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as ChatMessageRow | undefined
    if (!row) {
      return { ok: false, error: 'not_found' }
    }

    const message = rowToMessage(row)
    if (message.from !== actor) {
      return { ok: false, error: 'forbidden' }
    }

    this.deleteMessageFromDb(messageId)
    await this.appendAuditRecord({
      id: messageId,
      from: actor,
      content: '',
      timestamp: Date.now(),
      channel: message.channel || 'general',
      metadata: {
        deleteUpdate: true,
        deletedBy: actor,
      },
    })

    eventBus.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'message_posted',
      timestamp: Date.now(),
      data: { id: messageId, deleteUpdate: true },
    })

    return { ok: true }
  }

  /**
   * Search messages by content
   */
  search(query: string, options?: { limit?: number }): AgentMessage[] {
    const db = getDb()
    const likePattern = `%${query}%`
    const limit = options?.limit ?? 50
    const rows = db.prepare(`
      SELECT * FROM chat_messages
      WHERE content LIKE ? COLLATE NOCASE
         OR "from" LIKE ? COLLATE NOCASE
         OR channel LIKE ? COLLATE NOCASE
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(likePattern, likePattern, likePattern, limit) as ChatMessageRow[]

    // Return in chronological order
    return rows.map(rowToMessage).reverse()
  }

  getStats() {
    const db = getDb()
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM chat_messages').get() as { count: number } | undefined
    return {
      totalMessages: totalRow?.count ?? 0,
      rooms: this.rooms.size,
      subscribers: this.subscribers.size,
    }
  }
}

export const chatManager = new ChatManager()
