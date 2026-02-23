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

class ChatManager {
  private messages: AgentMessage[] = []
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

      const rows = db.prepare('SELECT * FROM chat_messages ORDER BY timestamp ASC').all() as Array<{
        id: string
        from: string
        to: string | null
        content: string
        timestamp: number
        channel: string | null
        reactions: string | null
        thread_id: string | null
        metadata: string | null
      }>

      this.messages = rows.map((row) => ({
        id: row.id,
        from: row.from,
        to: row.to ?? undefined,
        content: row.content,
        timestamp: row.timestamp,
        channel: row.channel || 'general',
        reactions: safeJsonParse<Record<string, string[]>>(row.reactions) || {},
        threadId: row.thread_id ?? undefined,
        metadata: safeJsonParse<Record<string, unknown>>(row.metadata),
      }))

      console.log(`[Chat] Loaded ${this.messages.length} messages from SQLite`)
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

      // 3. Per-channel budget
      const budget = this.checkChannelBudget(channel)
      if (!budget.allowed) {
        console.warn(`[Chat/NoiseBudget] ${budget.reason}`)
        return {
          ...message,
          id: `msg-${Date.now()}-budgeted`,
          timestamp: Date.now(),
          channel,
          reactions: {},
          metadata: { ...message.metadata as Record<string, unknown>, budget_exceeded: true },
        } as AgentMessage
      }
    }

    const fullMessage: AgentMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      channel,
      reactions: message.reactions || {},
      threadId: message.threadId,
    }

    // Store locally
    this.messages.push(fullMessage)

    // Persist to disk
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
    const agents = new Set<string>()
    for (const message of this.messages) {
      agents.add(message.from)
      if (message.to) {
        agents.add(message.to)
      }
    }
    return Array.from(agents)
  }

  private handleIncomingMessage(message: AgentMessage) {
    // Avoid duplicates
    if (!this.messages.find(m => m.id === message.id)) {
      this.messages.push(message)
      this.notifySubscribers(message)
    }
  }

  getMessages(options?: {
    from?: string
    to?: string
    channel?: string
    limit?: number
    since?: number
    before?: number  // Get messages before this timestamp (cursor pagination)
    after?: number   // Get messages after this timestamp (cursor pagination)
  }): AgentMessage[] {
    let filtered = [...this.messages]

    if (options?.from) {
      filtered = filtered.filter(m => m.from === options.from)
    }

    if (options?.to) {
      filtered = filtered.filter(m => m.to === options.to)
    }

    if (options?.channel) {
      filtered = filtered.filter(m => m.channel === options.channel)
    }

    if (options?.since) {
      filtered = filtered.filter(m => m.timestamp >= options.since!)
    }

    // Cursor pagination: before/after
    if (options?.before) {
      filtered = filtered.filter(m => m.timestamp < options.before!)
    }

    if (options?.after) {
      filtered = filtered.filter(m => m.timestamp > options.after!)
    }

    // Normalize ordering by timestamp (not insertion order).
    // This prevents backfilled/late-arriving historical events from skewing
    // recency-based consumers (watchdogs, cadence checks, compliance panels).
    filtered.sort((a, b) => (Number(a.timestamp || 0) - Number(b.timestamp || 0)))

    // Apply limit (default to 20 to avoid context window blow-up)
    const limit = options?.limit !== undefined ? options.limit : 20
    if (limit > 0) {
      filtered = filtered.slice(-limit)
    }

    // Calculate reply counts for each message
    return this.addReplyCounts(filtered)
  }

  /**
   * Add replyCount field to messages
   */
  private addReplyCounts(messages: AgentMessage[]): AgentMessage[] {
    return messages.map(msg => {
      const replyCount = this.messages.filter(m => m.threadId === msg.id).length
      return { ...msg, replyCount }
    })
  }

  /**
   * Get all messages in a thread (parent + replies)
   */
  getThread(messageId: string): AgentMessage[] | null {
    // Find the parent message
    const parent = this.messages.find(m => m.id === messageId)
    if (!parent) {
      return null
    }

    // Get all replies to this message
    const replies = this.messages.filter(m => m.threadId === messageId)

    // Return parent + replies with reply counts
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
    const channelMap = new Map<string, { count: number; lastActivity: number }>()
    
    // Default channels
    DEFAULT_CHAT_CHANNELS.forEach(channel => {
      channelMap.set(channel, { count: 0, lastActivity: 0 })
    })
    
    // Count messages per channel
    this.messages.forEach(msg => {
      const channel = msg.channel || 'general'
      const existing = channelMap.get(channel)
      if (existing) {
        existing.count++
        existing.lastActivity = Math.max(existing.lastActivity, msg.timestamp)
      } else {
        channelMap.set(channel, { count: 1, lastActivity: msg.timestamp })
      }
    })
    
    return Array.from(channelMap.entries())
      .map(([channel, data]) => ({ channel, ...data }))
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }

  /**
   * Add reaction to a message
   */
  async addReaction(messageId: string, emoji: string, from: string): Promise<AgentMessage | null> {
    const message = this.messages.find(m => m.id === messageId)
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
    const message = this.messages.find(m => m.id === messageId)
    return message ? (message.reactions || {}) : null
  }

  async editMessage(messageId: string, editor: string, content: string): Promise<{ ok: true; message: AgentMessage } | { ok: false; error: 'not_found' | 'forbidden' | 'invalid_content' }> {
    const trimmed = content.trim()
    if (!trimmed) {
      return { ok: false, error: 'invalid_content' }
    }

    const message = this.messages.find(m => m.id === messageId)
    if (!message) {
      return { ok: false, error: 'not_found' }
    }

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
    const messageIndex = this.messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) {
      return { ok: false, error: 'not_found' }
    }

    const message = this.messages[messageIndex]
    if (message.from !== actor) {
      return { ok: false, error: 'forbidden' }
    }

    this.messages.splice(messageIndex, 1)
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
    const lowerQuery = query.toLowerCase()
    const results = this.messages.filter(msg => 
      msg.content.toLowerCase().includes(lowerQuery) ||
      msg.from.toLowerCase().includes(lowerQuery) ||
      (msg.channel && msg.channel.toLowerCase().includes(lowerQuery))
    )
    
    if (options?.limit) {
      return results.slice(-options.limit)
    }
    
    return results
  }

  getStats() {
    return {
      totalMessages: this.messages.length,
      rooms: this.rooms.size,
      subscribers: this.subscribers.size,
    }
  }
}

export const chatManager = new ChatManager()
