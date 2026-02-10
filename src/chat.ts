/**
 * Agent-to-agent messaging system
 */
import type { AgentMessage, ChatRoom } from './types.js'
import { openclawClient } from './openclaw.js'

class ChatManager {
  private messages: AgentMessage[] = []
  private rooms = new Map<string, ChatRoom>()
  private subscribers = new Set<(message: AgentMessage) => void>()

  constructor() {
    // Listen for incoming messages from OpenClaw
    openclawClient.on('message', (payload: unknown) => {
      if (typeof payload === 'object' && payload !== null && 'content' in payload) {
        this.handleIncomingMessage(payload as AgentMessage)
      }
    })

    // Create default room
    this.createRoom('general', 'General Chat')
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
    }

    // Store locally
    this.messages.push(fullMessage)

    // Notify local subscribers
    this.notifySubscribers(fullMessage)

    // Send via OpenClaw (will broadcast to other agents)
    try {
      await openclawClient.sendMessage(fullMessage)
    } catch (err) {
      console.error('[Chat] Failed to send via OpenClaw:', err)
    }

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

  getStats() {
    return {
      totalMessages: this.messages.length,
      rooms: this.rooms.size,
      subscribers: this.subscribers.size,
    }
  }
}

export const chatManager = new ChatManager()
