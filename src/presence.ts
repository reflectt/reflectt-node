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
  last_active?: number // Last real activity (message, task action, etc.)
}

export interface AgentActivity {
  agent: string
  heartbeats_today: number
  tasks_completed_today: number
  messages_today: number
  last_active: number
  total_active_time_today_ms: number
  first_seen_today?: number
}

const EXPIRY_MS = 10 * 60 * 1000 // 10 minutes

interface DailyActivity {
  date: string // YYYY-MM-DD
  heartbeats: number
  tasks_completed: number
  messages: number
  first_seen?: number
  last_active: number
  session_starts: number[]
  session_ends: number[]
}

class PresenceManager {
  private presence = new Map<string, AgentPresence>()
  private activity = new Map<string, DailyActivity>() // agent -> today's activity
  private expiryCheckInterval?: NodeJS.Timeout

  constructor() {
    // Check for expired presence every minute
    this.expiryCheckInterval = setInterval(() => {
      this.checkExpiry()
    }, 60 * 1000)
    
    // Reset daily activity at midnight
    this.scheduleDailyReset()
  }
  
  private getCurrentDate(): string {
    return new Date().toISOString().split('T')[0]
  }
  
  private getActivity(agent: string): DailyActivity {
    const today = this.getCurrentDate()
    let activity = this.activity.get(agent)
    
    // Reset if it's a new day
    if (!activity || activity.date !== today) {
      activity = {
        date: today,
        heartbeats: 0,
        tasks_completed: 0,
        messages: 0,
        last_active: 0,
        session_starts: [],
        session_ends: [],
      }
      this.activity.set(agent, activity)
    }
    
    return activity
  }
  
  private scheduleDailyReset(): void {
    // Calculate ms until next midnight
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    const msUntilMidnight = tomorrow.getTime() - now.getTime()
    
    setTimeout(() => {
      console.log('[Presence] Daily activity reset')
      this.activity.clear()
      // Schedule next reset in 24 hours
      this.scheduleDailyReset()
    }, msUntilMidnight)
  }

  /**
   * Update agent presence
   */
  updatePresence(agent: string, status: PresenceStatus, task?: string, since?: number, updateActivity = true): AgentPresence {
    const now = Date.now()
    const existing = this.presence.get(agent)
    
    const presence: AgentPresence = {
      agent,
      status,
      task,
      since: since || now,
      lastUpdate: now,
      last_active: existing?.last_active || now,
    }

    this.presence.set(agent, presence)

    // Track heartbeat activity
    if (updateActivity) {
      const activity = this.getActivity(agent)
      activity.heartbeats++
      activity.last_active = now
      
      if (!activity.first_seen) {
        activity.first_seen = now
      }
      
      // Track session transitions
      if (existing?.status === 'offline' && status !== 'offline') {
        activity.session_starts.push(now)
      } else if (existing?.status !== 'offline' && status === 'offline') {
        activity.session_ends.push(now)
      }
    }

    // Emit presence_updated event
    eventBus.emitPresenceUpdated(presence)

    console.log(`[Presence] ${agent} → ${status}${task ? ` (${task})` : ''}`)

    return presence
  }
  
  /**
   * Record real activity (message, task action, etc.)
   */
  recordActivity(agent: string, type: 'message' | 'task_completed'): void {
    const now = Date.now()
    const activity = this.getActivity(agent)
    
    activity.last_active = now
    
    if (type === 'message') {
      activity.messages++
    } else if (type === 'task_completed') {
      activity.tasks_completed++
    }
    
    // Update presence last_active
    const presence = this.presence.get(agent)
    if (presence) {
      presence.last_active = now
      this.presence.set(agent, presence)
    }
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
        // Don't count auto-expiry as activity
        this.updatePresence(agent, 'offline', undefined, undefined, false)
        expiredCount++
      }
    }

    if (expiredCount > 0) {
      console.log(`[Presence] Auto-expired ${expiredCount} agents to offline`)
    }
  }

  /**
   * Get activity metrics for a specific agent
   */
  getAgentActivity(agent: string): AgentActivity | null {
    const activity = this.activity.get(agent)
    const presence = this.presence.get(agent)
    
    if (!activity && !presence) {
      return null
    }
    
    const act = activity || {
      date: this.getCurrentDate(),
      heartbeats: 0,
      tasks_completed: 0,
      messages: 0,
      last_active: 0,
      session_starts: [],
      session_ends: [],
    }
    
    // Calculate total active time
    let totalActiveMs = 0
    const now = Date.now()
    
    for (let i = 0; i < act.session_starts.length; i++) {
      const start = act.session_starts[i]
      const end = act.session_ends[i] || now // If session still active
      totalActiveMs += end - start
    }
    
    return {
      agent,
      heartbeats_today: act.heartbeats,
      tasks_completed_today: act.tasks_completed,
      messages_today: act.messages,
      last_active: presence?.last_active || act.last_active,
      total_active_time_today_ms: totalActiveMs,
      first_seen_today: act.first_seen,
    }
  }
  
  /**
   * Get activity metrics for all agents
   */
  getAllActivity(): AgentActivity[] {
    const agents = new Set<string>()
    
    // Collect all agents from both presence and activity
    for (const agent of this.presence.keys()) {
      agents.add(agent)
    }
    for (const agent of this.activity.keys()) {
      agents.add(agent)
    }
    
    const activities: AgentActivity[] = []
    for (const agent of agents) {
      const activity = this.getAgentActivity(agent)
      if (activity) {
        activities.push(activity)
      }
    }
    
    return activities.sort((a, b) => b.last_active - a.last_active)
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
