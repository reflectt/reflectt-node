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
// OpenClaw integration pending — chat works standalone for now

const MESSAGES_FILE = join(DATA_DIR, 'messages.jsonl')
const LEGACY_MESSAGES_FILE = join(LEGACY_DATA_DIR, 'messages.jsonl')

class ChatManager {
  private messages: AgentMessage[] = []
  private rooms = new Map<string, ChatRoom>()
  private subscribers = new Set<(message: AgentMessage) => void>()
  private initialized = false

  constructor() {
    // OpenClaw listener disabled for now — chat works standalone
    // TODO: re-enable when OpenClaw connection is configured
    // openclawClient.on('message', ...)

    // Create default room
    this.createRoom('general', 'General Chat')
    
    // Load persisted messages
    this.loadMessages().catch(err => {
      console.error('[Chat] Failed to load messages:', err)
    })
  }

  private async loadMessages(): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(DATA_DIR, { recursive: true })

      // Try to read existing messages
      let messagesLoaded = false
      try {
        const content = await fs.readFile(MESSAGES_FILE, 'utf-8')
        const lines = content.trim().split('\n').filter(line => line.length > 0)
        
        for (const line of lines) {
          try {
            const message = JSON.parse(line) as AgentMessage
            this.messages.push(message)
          } catch (err) {
            console.error('[Chat] Failed to parse message line:', err)
          }
        }
        
        console.log(`[Chat] Loaded ${this.messages.length} messages from disk`)
        messagesLoaded = true
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        // File doesn't exist yet - try legacy location
      }

      // Migration: Check legacy data directory
      if (!messagesLoaded) {
        try {
          const legacyContent = await fs.readFile(LEGACY_MESSAGES_FILE, 'utf-8')
          const lines = legacyContent.trim().split('\n').filter(line => line.length > 0)
          
          for (const line of lines) {
            try {
              const message = JSON.parse(line) as AgentMessage
              this.messages.push(message)
            } catch (err) {
              console.error('[Chat] Failed to parse legacy message line:', err)
            }
          }
          
          console.log(`[Chat] Migrated ${this.messages.length} messages from legacy location`)
          
          // Write to new location
          if (this.messages.length > 0) {
            const content = this.messages.map(m => JSON.stringify(m)).join('\n') + '\n'
            await fs.writeFile(MESSAGES_FILE, content, 'utf-8')
            console.log('[Chat] Migration complete - messages saved to new location')
          }
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            console.error('[Chat] Failed to migrate from legacy location:', err)
          }
          // No legacy file either - starting fresh
          console.log('[Chat] No existing messages file, starting fresh')
        }
      }
    } finally {
      this.initialized = true
    }
  }

  private async persistMessage(message: AgentMessage): Promise<void> {
    try {
      // Ensure data directory exists
      await fs.mkdir(DATA_DIR, { recursive: true })
      
      // Append message as JSONL
      await fs.appendFile(MESSAGES_FILE, JSON.stringify(message) + '\n', 'utf-8')
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

  async sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp' | 'replyCount'>): Promise<AgentMessage> {
    const fullMessage: AgentMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      channel: message.channel || 'general', // Default to general channel
      reactions: message.reactions || {}, // Initialize empty reactions
      threadId: message.threadId, // Preserve threadId if provided
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
    const defaultChannels = ['general', 'problems', 'shipping', 'dev', 'decisions']
    defaultChannels.forEach(channel => {
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
    
    // Persist updated message (rewrite entire JSONL file)
    await this.rewriteMessages()
    
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

    await this.rewriteMessages()
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
    await this.rewriteMessages()

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

  /**
   * Rewrite all messages to disk (for updates like reactions)
   */
  private async rewriteMessages(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      
      // Write all messages as JSONL
      const content = this.messages.map(m => JSON.stringify(m)).join('\n') + '\n'
      await fs.writeFile(MESSAGES_FILE, content, 'utf-8')
    } catch (err) {
      console.error('[Chat] Failed to rewrite messages:', err)
    }
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
