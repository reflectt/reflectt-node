// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Server-Sent Events (SSE) Event Bus
 * 
 * Real-time event stream for agents to react to changes.
 * Events are emitted when:
 * - Messages are posted
 * - Tasks are created, assigned, or updated
 * - Memory entries are written
 */

import type { FastifyReply } from 'fastify'
import type { AgentMessage, Task } from './types.js'

export type EventType = 
  | 'message_posted'
  | 'task_created'
  | 'task_assigned'
  | 'task_updated'
  | 'memory_written'
  | 'presence_updated'
  | 'reflection_created'
  | 'insight_created'

export const VALID_EVENT_TYPES = new Set<EventType>([
  'message_posted',
  'task_created',
  'task_assigned',
  'task_updated',
  'memory_written',
  'presence_updated',
  'reflection_created',
  'insight_created',
])

export interface Event {
  id: string
  type: EventType
  timestamp: number
  data: unknown
}

interface Subscription {
  id: string
  reply: FastifyReply
  agent?: string
  topics?: string[]
  types?: EventType[]
  createdAt: number
}

type InternalListener = (event: Event) => void | Promise<void>

class EventBus {
  private subscriptions = new Map<string, Subscription>()
  private internalListeners = new Map<string, InternalListener>()
  private eventLog: Event[] = []
  private maxLogSize = 1000
  private batchWindowMs = 2000 // Default: 2 seconds
  private pendingEvents: Event[] = []
  private batchTimer: NodeJS.Timeout | null = null
  private keepaliveTimer: NodeJS.Timeout | null = null
  private static readonly KEEPALIVE_INTERVAL_MS = 30000 // SSE keepalive every 30s

  constructor() {
    this.startKeepalive()
  }

  /**
   * Send SSE keepalive comments to prevent proxy/Docker network timeouts.
   * SSE comment lines (starting with ':') are ignored by EventSource clients.
   */
  private startKeepalive() {
    this.keepaliveTimer = setInterval(() => {
      for (const [id, sub] of this.subscriptions) {
        try {
          if (!sub.reply.raw.destroyed) {
            sub.reply.raw.write(`:keepalive ${Date.now()}\n\n`)
          } else {
            this.subscriptions.delete(id)
          }
        } catch {
          this.subscriptions.delete(id)
        }
      }
    }, EventBus.KEEPALIVE_INTERVAL_MS)
    this.keepaliveTimer.unref()
  }

  stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }

  /**
   * Register an in-process listener for events.
   * Used for internal automation (e.g., insight→task bridge).
   */
  on(listenerId: string, listener: InternalListener): void {
    this.internalListeners.set(listenerId, listener)
  }

  /**
   * Remove an in-process listener.
   */
  off(listenerId: string): void {
    this.internalListeners.delete(listenerId)
  }

  /**
   * Subscribe to events via SSE
   */
  subscribe(reply: FastifyReply, agent?: string, topics?: string[], types?: string[]): string {
    const id = `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Set up SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    // Validate and filter event types — unknown types are silently ignored
    const validTypes: EventType[] = (types || [])
      .map(t => t.trim() as EventType)
      .filter(t => VALID_EVENT_TYPES.has(t))

    const subscription: Subscription = {
      id,
      reply,
      agent,
      topics,
      types: validTypes.length > 0 ? validTypes : undefined,
      createdAt: Date.now(),
    }

    this.subscriptions.set(id, subscription)

    // Send initial connection event
    this.sendEvent(reply, {
      id: `evt-${Date.now()}`,
      type: 'message_posted',
      timestamp: Date.now(),
      data: { 
        message: `Connected to event stream (subscription ${id})`,
        agent,
        topics,
        types: validTypes.length > 0 ? validTypes : undefined,
      },
    })

    // Clean up on close
    reply.raw.on('close', () => {
      this.subscriptions.delete(id)
      console.log(`[Events] Subscription ${id} closed (${this.subscriptions.size} remaining)`)
    })

    console.log(`[Events] New subscription ${id} (agent: ${agent || 'all'}, topics: ${topics?.join(',') || 'all'}, types: ${validTypes.length > 0 ? validTypes.join(',') : 'all'})`)
    
    return id
  }

  /**
   * Get batch configuration
   */
  getBatchConfig(): { batchWindowMs: number } {
    return { batchWindowMs: this.batchWindowMs }
  }

  /**
   * Set batch configuration
   */
  setBatchConfig(batchWindowMs: number): void {
    if (batchWindowMs < 0) {
      throw new Error('batchWindowMs must be non-negative')
    }
    this.batchWindowMs = batchWindowMs
    console.log(`[Events] Batch window set to ${batchWindowMs}ms`)
  }

  /**
   * Emit an event to all matching subscriptions (with batching)
   */
  emit(event: Event): void {
    // Add to log
    this.eventLog.push(event)
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift()
    }

    // Fire internal listeners (async, non-blocking)
    for (const [id, listener] of this.internalListeners) {
      try {
        const result = listener(event)
        if (result instanceof Promise) {
          result.catch(err => console.error(`[EventBus] Internal listener '${id}' error:`, err))
        }
      } catch (err) {
        console.error(`[EventBus] Internal listener '${id}' error:`, err)
      }
    }

    // Add to pending batch
    this.pendingEvents.push(event)

    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
    }

    // Set new timer to flush batch
    this.batchTimer = setTimeout(() => {
      this.flushBatch()
    }, this.batchWindowMs)
  }

  /**
   * Flush the pending event batch to subscribers
   */
  private flushBatch(): void {
    if (this.pendingEvents.length === 0) {
      return
    }

    const events = [...this.pendingEvents]
    this.pendingEvents = []
    this.batchTimer = null

    // If only one event, send it normally (no batch wrapper)
    if (events.length === 1) {
      const event = events[0]
      let sent = 0
      for (const [id, subscription] of this.subscriptions) {
        if (this.shouldReceive(subscription, event)) {
          try {
            this.sendEvent(subscription.reply, event)
            sent++
          } catch (err) {
            console.error(`[Events] Failed to send to ${id}:`, err)
            this.subscriptions.delete(id)
          }
        }
      }
      if (sent > 0) {
        console.log(`[Events] Emitted ${event.type} to ${sent} subscribers`)
      }
      return
    }

    // Multiple events - send as batch
    let sent = 0
    for (const [id, subscription] of this.subscriptions) {
      // Filter events for this subscription
      const filteredEvents = events.filter(event => this.shouldReceive(subscription, event))
      
      if (filteredEvents.length > 0) {
        try {
          this.sendBatchEvent(subscription.reply, filteredEvents)
          sent++
        } catch (err) {
          console.error(`[Events] Failed to send batch to ${id}:`, err)
          this.subscriptions.delete(id)
        }
      }
    }

    if (sent > 0) {
      console.log(`[Events] Emitted batch of ${events.length} events to ${sent} subscribers`)
    }
  }

  /**
   * Check if a subscription should receive an event
   */
  private shouldReceive(subscription: Subscription, event: Event): boolean {
    // Filter by exact event type (e.g., ?types=task_created,task_updated)
    if (subscription.types && subscription.types.length > 0) {
      if (!subscription.types.includes(event.type)) {
        return false
      }
    }

    // Filter by topic (e.g., "chat", "tasks", "memory") — loose match
    if (subscription.topics && subscription.topics.length > 0) {
      const eventTopic = event.type.split('_')[0] // "message_posted" -> "message"
      if (!subscription.topics.some(topic => 
        eventTopic.includes(topic) || event.type.includes(topic)
      )) {
        return false
      }
    }

    // Filter by agent (for agent-specific events like task_assigned)
    if (subscription.agent) {
      const data = event.data as any
      
      // Check if event is relevant to this agent
      if (event.type === 'task_assigned' && data.assignee !== subscription.agent) {
        return false
      }
      
      if (event.type === 'message_posted' && data.to && data.to !== subscription.agent) {
        return false
      }

      if (event.type === 'memory_written' && data.agent !== subscription.agent) {
        return false
      }
    }

    return true
  }

  /**
   * Send an event to an SSE connection
   */
  private sendEvent(reply: FastifyReply, event: Event): void {
    const message = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\nid: ${event.id}\n\n`
    reply.raw.write(message)
  }

  /**
   * Send a batch of events to an SSE connection
   */
  private sendBatchEvent(reply: FastifyReply, events: Event[]): void {
    const batchData = events.map(e => ({
      id: e.id,
      type: e.type,
      timestamp: e.timestamp,
      data: e.data,
    }))
    const message = `event: batch\ndata: ${JSON.stringify(batchData)}\n\n`
    reply.raw.write(message)
  }

  /**
   * Get event bus statistics
   */
  getStatus() {
    return {
      connected: this.subscriptions.size,
      eventLog: this.eventLog.length,
      subscriptions: Array.from(this.subscriptions.values()).map(sub => ({
        id: sub.id,
        agent: sub.agent,
        topics: sub.topics,
        types: sub.types,
        connectedMs: Date.now() - sub.createdAt,
      })),
    }
  }

  /**
   * Helper: Emit message_posted event
   */
  emitMessagePosted(message: AgentMessage): void {
    this.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'message_posted',
      timestamp: Date.now(),
      data: message,
    })
  }

  /**
   * Helper: Emit task_created event
   */
  emitTaskCreated(task: Task): void {
    this.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'task_created',
      timestamp: Date.now(),
      data: task,
    })
  }

  /**
   * Helper: Emit task_assigned event
   */
  emitTaskAssigned(task: Task): void {
    if (task.assignee) {
      this.emit({
        id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'task_assigned',
        timestamp: Date.now(),
        data: task,
      })
    }
  }

  /**
   * Helper: Emit task_updated event
   */
  emitTaskUpdated(task: Task, updates: Record<string, unknown>): void {
    this.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'task_updated',
      timestamp: Date.now(),
      data: {
        ...task,
        updates,
      },
    })
  }

  /**
   * Helper: Emit memory_written event
   */
  emitMemoryWritten(agent: string, filename: string, path: string): void {
    this.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'memory_written',
      timestamp: Date.now(),
      data: {
        agent,
        filename,
        path,
      },
    })
  }

  /**
   * Helper: Emit presence_updated event
   */
  emitPresenceUpdated(presence: any): void {
    this.emit({
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'presence_updated',
      timestamp: Date.now(),
      data: presence,
    })
  }

  /**
   * Get event log for activity feed
   */
  getEvents(filters?: { agent?: string; limit?: number; since?: number }): Event[] {
    let events = [...this.eventLog]

    // Filter by timestamp
    if (filters?.since) {
      events = events.filter(e => e.timestamp >= filters.since!)
    }

    // Filter by agent (for agent-specific activity)
    if (filters?.agent) {
      events = events.filter(e => {
        const data = e.data as any
        
        // Include events where the agent is involved
        return (
          data.agent === filters.agent ||
          data.from === filters.agent ||
          data.to === filters.agent ||
          data.assignee === filters.agent ||
          data.createdBy === filters.agent
        )
      })
    }

    // Apply limit (most recent first)
    const limit = filters?.limit || 100
    events = events.slice(-limit).reverse()

    return events
  }
}

export const eventBus = new EventBus()
