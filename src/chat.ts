/**
 * Agent-to-agent messaging system
 */
import type { AgentMessage, ChatRoom } from './types.js'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { eventBus } from './events.js'
// OpenClaw integration pending — chat works standalone for now

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_DIR = join(__dirname, '../data')
const MESSAGES_FILE = join(DATA_DIR, 'messages.jsonl')

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
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err
        }
        // File doesn't exist yet, that's fine
        console.log('[Chat] No existing messages file, starting fresh')
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

  async sendMessage(message: Omit<AgentMessage, 'id' | 'timestamp'>): Promise<AgentMessage> {
    const fullMessage: AgentMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      channel: message.channel || 'general', // Default to general channel
      reactions: message.reactions || {}, // Initialize empty reactions
    }

    // Store locally
    this.messages.push(fullMessage)

    // Persist to disk
    await this.persistMessage(fullMessage)

    // Notify local subscribers
    this.notifySubscribers(fullMessage)

    // Emit event to event bus
    eventBus.emitMessagePosted(fullMessage)

    // TODO: Send via OpenClaw when connected

    return fullMessage
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

    if (options?.limit) {
      filtered = filtered.slice(-options.limit)
    }

    return filtered
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
