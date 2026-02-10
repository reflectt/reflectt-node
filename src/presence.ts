/**
 * Agent Presence Manager
 * 
 * Tracks agent status and activity.
 * Auto-expires to offline after 10 minutes of inactivity.
 */

import { eventBus } from './events.js'

export type PresenceStatus = 'idle' | 'working' | 'reviewing' | 'blocked' | 'offline'

export interface AgentPresence {
  agent: string
  status: PresenceStatus
  task?: string
  since: number
  lastUpdate: number
}

const EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

class PresenceManager {
  private presence = new Map<string, AgentPresence>()
  private expiryCheckInterval?: NodeJS.Timeout

  constructor() {
    // Check for expired presence every minute
    this.expiryCheckInterval = setInterval(() => {
      this.checkExpiry()
    }, 60 * 1000)
  }

  /**
   * Update agent presence
   */
  updatePresence(agent: string, status: PresenceStatus, task?: string, since?: number): AgentPresence {
    const now = Date.now()
    const presence: AgentPresence = {
      agent,
      status,
      task,
      since: since || now,
      lastUpdate: now,
    }

    this.presence.set(agent, presence)

    // Emit presence_updated event
    eventBus.emitPresenceUpdated(presence)

    console.log(`[Presence] ${agent} → ${status}${task ? ` (${task})` : ''}`)

    return presence
  }

  /**
   * Get presence for a specific agent
   */
  getPresence(agent: string): AgentPresence | null {
    return this.presence.get(agent) || null
  }

  /**
   * Get all agent presences
   */
  getAllPresence(): AgentPresence[] {
    return Array.from(this.presence.values())
  }

  /**
   * Check for expired presence and set to offline
   */
  private checkExpiry(): void {
    const now = Date.now()
    let expiredCount = 0

    for (const [agent, presence] of this.presence) {
      if (presence.status !== 'offline' && now - presence.lastUpdate > EXPIRY_MS) {
        this.updatePresence(agent, 'offline')
        expiredCount++
      }
    }

    if (expiredCount > 0) {
      console.log(`[Presence] Auto-expired ${expiredCount} agents to offline`)
    }
  }

  /**
   * Get stats
   */
  getStats() {
    const statusCounts: Record<PresenceStatus, number> = {
      idle: 0,
      working: 0,
      reviewing: 0,
      blocked: 0,
      offline: 0,
    }

    for (const presence of this.presence.values()) {
      statusCounts[presence.status]++
    }

    return {
      total: this.presence.size,
      statusCounts,
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.expiryCheckInterval) {
      clearInterval(this.expiryCheckInterval)
    }
  }
}

export const presenceManager = new PresenceManager()
