// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Agent Presence Manager
 * 
 * Tracks agent status and activity.
 * Auto-expires to offline after 10 minutes of inactivity.
 */

import { eventBus } from './events.js'
import { getDb } from './db.js'
import { getAgentRoles } from './assignment.js'

export type PresenceStatus = 'idle' | 'working' | 'reviewing' | 'blocked' | 'waiting' | 'offline'

export type FocusLevel = 'soft' | 'deep'
// soft: suppress system fallback nudges, idle-nudge; allow direct @mentions
// deep: suppress everything except blocker/review pings with task IDs

export interface FocusState {
  active: boolean
  level: FocusLevel
  startedAt: number
  expiresAt?: number // optional auto-expire
  reason?: string    // what they're focusing on
}

export interface WaitingState {
  reason: string          // e.g. 'approval', 'review', 'human_input', 'token_refresh'
  waitingFor?: string     // who/what specifically (e.g. 'ryan', 'kai', 'host_token')
  taskId?: string         // related task
  since: number           // when wait started
  expiresAt?: number      // optional timeout
}

export interface AgentPresence {
  agent: string
  status: PresenceStatus
  task?: string
  since: number
  lastUpdate: number
  last_active?: number // Last real activity (message, task action, etc.)
  focus?: FocusState
  waiting?: WaitingState  // populated when status === 'waiting'
  thought?: string        // agent's current thought — expires after 8s TTL on canvas
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

const IDLE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes — active agents decay to idle
const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes — idle agents decay to offline

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

export class PresenceManager {
  private presence = new Map<string, AgentPresence>()
  private activity = new Map<string, DailyActivity>() // agent -> today's activity
  /** Debounce map: `agent:status` → last emit timestamp (ms). Prevents SSE flood on restart. */
  private _lastEmit = new Map<string, number>()
  private expiryCheckInterval?: NodeJS.Timeout

  constructor() {
    // Check for expired presence every minute
    this.expiryCheckInterval = setInterval(() => {
      this.checkExpiry()
    }, 60 * 1000)
    
    // Reset daily activity at midnight
    this.scheduleDailyReset()

    // Seed presence from recent activity so heartbeat doesn't send empty agents
    this.seedPresenceFromRecentActivity()

    // Restore persisted focus states from SQLite
    this.loadFocusStates()
  }

  /**
   * Load persisted focus states from SQLite on startup
   */
  private loadFocusStates(): void {
    try {
      const db = getDb()
      const rows = db.prepare(
        'SELECT agent, active, level, started_at, expires_at, reason FROM focus_states WHERE active = 1'
      ).all() as Array<{
        agent: string
        active: number
        level: string
        started_at: number
        expires_at: number | null
        reason: string | null
      }>

      const now = Date.now()
      let restored = 0

      for (const row of rows) {
        // Skip expired focus states
        if (row.expires_at && now > row.expires_at) {
          db.prepare('UPDATE focus_states SET active = 0 WHERE agent = ?').run(row.agent)
          continue
        }

        const focus: FocusState = {
          active: true,
          level: (row.level === 'deep' ? 'deep' : 'soft') as FocusLevel,
          startedAt: row.started_at,
          expiresAt: row.expires_at ?? undefined,
          reason: row.reason ?? undefined,
        }

        const existing = this.presence.get(row.agent)
        if (existing) {
          existing.focus = focus
        } else {
          this.presence.set(row.agent, {
            agent: row.agent,
            status: 'offline',
            since: now,
            lastUpdate: now,
            focus,
          })
        }
        restored++
      }

      if (restored > 0) {
        console.log(`[Focus] Restored ${restored} persisted focus state(s) from SQLite`)
      }
    } catch (err: any) {
      // DB might not be ready yet on very first boot — non-fatal
      console.warn('[Focus] Could not load persisted focus states:', err?.message)
    }
  }

  private lookupTaskForStatus(agent: string, status: PresenceStatus): { id: string; activityAt: number } | null {
    if (!agent) return null

    const taskStatus = status === 'blocked'
      ? 'blocked'
      : status === 'reviewing'
        ? 'validating'
        : status === 'working'
          ? 'doing'
          : null

    if (!taskStatus) return null

    try {
      const db = getDb()
      const row = db.prepare(
        `SELECT id, updated_at, created_at
         FROM tasks
         WHERE assignee = ? AND status = ?
         ORDER BY COALESCE(updated_at, created_at, 0) DESC
         LIMIT 1`
      ).get(agent, taskStatus) as { id: string; updated_at?: number | null; created_at?: number | null } | undefined

      if (!row?.id) return null
      return {
        id: row.id,
        activityAt: Number(row.updated_at || row.created_at || Date.now()),
      }
    } catch {
      return null
    }
  }

  /**
   * Seed presence from recent chat/task activity on startup.
   * Prevents the cold-start problem where heartbeat sends empty agents
   * to cloud, making the sidebar show "No agents online".
   *
   * Important: if an agent already has a doing task in SQLite, hydrate that
   * task into presence immediately so restart does not make active work look
   * dropped/idle before the agent posts again.
   */
  private seedPresenceFromRecentActivity(): void {
    try {
      const db = getDb()
      const now = Date.now()
      const recentWindow = 10 * 60 * 1000 // 10 minutes

      // Agents with recent chat messages
      const chatAgents = db.prepare(
        'SELECT DISTINCT "from" as agent FROM chat_messages WHERE timestamp > ? AND "from" NOT IN (\'system\', \'user\')'
      ).all(now - recentWindow) as Array<{ agent: string }>

      // Latest doing task per assignee — source of truth for active work continuity.
      const doingTaskRows = db.prepare(
        `SELECT assignee as agent, id, updated_at, created_at
         FROM tasks
         WHERE status = 'doing' AND assignee IS NOT NULL AND assignee != ''
         ORDER BY COALESCE(updated_at, created_at, 0) DESC`
      ).all() as Array<{ agent: string; id: string; updated_at?: number | null; created_at?: number | null }>

      // Build set of known agents from TEAM-ROLES registry to prevent cross-node leakage
      const knownAgents = new Set(getAgentRoles().map(r => r.name.toLowerCase()))

      const hasKnownAgent = (name: string): boolean => {
        return knownAgents.size === 0 || knownAgents.has(name)
      }

      const taskSeedByAgent = new Map<string, { id: string; activityAt: number }>()
      for (const row of doingTaskRows) {
        const name = (row.agent || '').toLowerCase().trim()
        // Active task rows are already local node state. Keep the system/email
        // guards, but do not require TEAM-ROLES membership here or restart
        // continuity breaks for valid assignees before roster sync catches up.
        if (!name || name.startsWith('email:') || name === 'system' || name === 'user') {
          continue
        }
        if (!taskSeedByAgent.has(name)) {
          taskSeedByAgent.set(name, {
            id: row.id,
            activityAt: Number(row.updated_at || row.created_at || now),
          })
        }
      }

      const agents = new Set<string>()
      for (const row of chatAgents) {
        const name = (row.agent || '').toLowerCase().trim()
        if (name && !name.startsWith('email:') && name !== 'system' && name !== 'user' && hasKnownAgent(name)) {
          agents.add(name)
        }
      }
      for (const agent of taskSeedByAgent.keys()) {
        agents.add(agent)
      }

      let seeded = 0
      for (const agent of agents) {
        if (this.presence.has(agent)) continue

        const activeTask = taskSeedByAgent.get(agent)
        if (activeTask) {
          this.presence.set(agent, {
            agent,
            status: 'working',
            task: activeTask.id,
            since: activeTask.activityAt,
            lastUpdate: activeTask.activityAt,
            last_active: activeTask.activityAt,
          })
        } else {
          this.presence.set(agent, {
            agent,
            status: 'idle',
            since: now,
            lastUpdate: now,
          })
        }
        seeded++
      }

      if (seeded > 0) {
        console.log(`[Presence] Seeded ${seeded} agent(s) from recent activity: ${[...agents].join(', ')}`)
      }
    } catch (err: any) {
      // Non-fatal — presence will populate as agents interact
      console.warn('[Presence] Could not seed from recent activity:', err?.message)
    }
  }

  /**
   * Persist focus state to SQLite
   */
  private persistFocusState(agent: string, focus: FocusState): void {
    try {
      const db = getDb()
      db.prepare(`
        INSERT INTO focus_states (agent, active, level, started_at, expires_at, reason, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(agent) DO UPDATE SET
          active = excluded.active,
          level = excluded.level,
          started_at = excluded.started_at,
          expires_at = excluded.expires_at,
          reason = excluded.reason,
          updated_at = excluded.updated_at
      `).run(
        agent,
        focus.active ? 1 : 0,
        focus.level,
        focus.startedAt,
        focus.expiresAt ?? null,
        focus.reason ?? null,
        Date.now(),
      )
    } catch (err: any) {
      console.warn('[Focus] Could not persist focus state:', err?.message)
    }
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
   * Touch agent presence: bump lastUpdate without overriding status.
   * Used for indirect activity signals (chat messages, reflections, task creation)
   * that prove the agent is alive but shouldn't override task-derived status.
   * If the agent is offline/idle/unknown, promotes to 'working'.
   */
  touchPresence(agent: string): AgentPresence {
    const now = Date.now()
    const existing = this.presence.get(agent)

    if (!existing || existing.status === 'offline' || existing.status === 'idle') {
      return this.updatePresence(agent, 'working')
    }

    // Already active — just bump the timestamp to prevent decay
    const updated = { ...existing, lastUpdate: now, last_active: now }
    this.presence.set(agent, updated)

    const activity = this.getActivity(agent)
    activity.last_active = now

    return updated
  }

  /**
   * Update agent presence.
   *
   * task semantics:
   * - string => set explicit task pointer
   * - null   => clear task pointer
   * - undefined => preserve existing task pointer; if none exists and the new
   *   status implies active work, hydrate from the current board row
   */
  updatePresence(agent: string, status: PresenceStatus, task?: string | null, since?: number, updateActivity = true): AgentPresence {
    const now = Date.now()
    const existing = this.presence.get(agent)
    const explicitTask = typeof task === 'string' ? task.trim() : task
    const hydratedTask = explicitTask === undefined && !existing?.task
      ? this.lookupTaskForStatus(agent, status)
      : null

    const resolvedTask = explicitTask === null
      ? undefined
      : explicitTask && explicitTask.length > 0
        ? explicitTask
        : existing?.task || hydratedTask?.id

    const presence: AgentPresence = {
      agent,
      status,
      task: resolvedTask,
      since: since || existing?.since || hydratedTask?.activityAt || now,
      lastUpdate: now,
      last_active: existing?.last_active || hydratedTask?.activityAt || now,
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

    // Emit presence_updated — but debounce to prevent broadcast floods on rapid restarts.
    // Skip if nothing actually changed (same status + same task) to avoid SSE noise.
    // Also enforce a minimum interval between emissions for the same agent+status pair
    // to prevent cadence degradation when updatePresence is called in a tight loop
    // (e.g., seeding all agents to 'idle' on each restart).
    // task-1773516754378-6pyxtkuzt (COO signal #5)
    const prevStatus = existing?.status
    const prevTask = existing?.task
    const statusChanged = prevStatus !== status
    const taskChanged = prevTask !== presence.task
    const shouldEmit = statusChanged || taskChanged

    if (shouldEmit) {
      const lastEmitKey = `${agent}:${status}`
      const lastEmitAt = this._lastEmit.get(lastEmitKey) ?? 0
      const MIN_EMIT_INTERVAL_MS = 60_000 // 1 min debounce for same-agent+same-status
      if (statusChanged || Date.now() - lastEmitAt >= MIN_EMIT_INTERVAL_MS) {
        this._lastEmit.set(lastEmitKey, Date.now())
        eventBus.emitPresenceUpdated(presence)
      }
    }

    console.log(`[Presence] ${agent} → ${status}${presence.task ? ` (${presence.task})` : ''}${shouldEmit ? '' : ' [no-op]'}`)

    return presence
  }

  /**
   * Set focus mode for an agent
   */
  setFocus(agent: string, active: boolean, options?: { level?: FocusLevel; durationMin?: number; reason?: string }): FocusState {
    const presence = this.presence.get(agent)
    const now = Date.now()

    const focus: FocusState = {
      active,
      level: options?.level || 'soft',
      startedAt: active ? now : 0,
      expiresAt: active && options?.durationMin ? now + options.durationMin * 60_000 : undefined,
      reason: options?.reason,
    }

    if (presence) {
      presence.focus = focus
      presence.lastUpdate = now
    } else {
      // Create minimal presence if agent hasn't checked in
      this.presence.set(agent, {
        agent,
        status: 'working',
        since: now,
        lastUpdate: now,
        focus,
      })
    }

    console.log(`[Focus] ${agent} → ${active ? `ON (${focus.level})` : 'OFF'}${focus.reason ? ` — ${focus.reason}` : ''}`)
    this.persistFocusState(agent, focus)
    return focus
  }

  /**
   * Check if agent is in focus mode (respects auto-expiry)
   */
  isInFocus(agent: string): FocusState | null {
    const presence = this.presence.get(agent)
    if (!presence?.focus?.active) return null

    // Check auto-expiry
    if (presence.focus.expiresAt && Date.now() > presence.focus.expiresAt) {
      presence.focus.active = false
      console.log(`[Focus] ${agent} → OFF (expired)`)
      this.persistFocusState(agent, presence.focus)
      return null
    }

    return presence.focus
  }

  /**
   * Set agent to waiting state (blocked on human).
   */
  setWaiting(agent: string, opts: { reason: string; waitingFor?: string; taskId?: string; expiresAt?: number }): void {
    const lower = agent.toLowerCase()
    const presence = this.presence.get(lower) || { agent: lower, status: 'idle' as PresenceStatus, since: Date.now(), lastUpdate: Date.now() }
    presence.status = 'waiting'
    presence.waiting = { reason: opts.reason, waitingFor: opts.waitingFor, taskId: opts.taskId, since: Date.now(), expiresAt: opts.expiresAt }
    presence.lastUpdate = Date.now()
    this.presence.set(lower, presence)
  }

  /**
   * Clear waiting state — agent is unblocked.
   */
  clearWaiting(agent: string): void {
    const lower = agent.toLowerCase()
    const presence = this.presence.get(lower)
    if (presence?.status === 'waiting') {
      presence.status = 'idle'
      presence.waiting = undefined
      presence.lastUpdate = Date.now()
    }
  }

  /**
   * Record real activity (message, task action, etc.)
   */
  recordActivity(agent: string, type: 'message' | 'task_completed' | 'heartbeat'): void {
    const now = Date.now()
    const activity = this.getActivity(agent)
    
    activity.last_active = now
    
    if (type === 'message') {
      activity.messages++
    } else if (type === 'task_completed') {
      activity.tasks_completed++
    }
    
    // Update presence timestamps — both last_active AND lastUpdate so
    // health status reads and decay timers see the latest activity.
    const presence = this.presence.get(agent)
    if (presence) {
      presence.last_active = now
      presence.lastUpdate = now
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
   * Two-step presence decay:
   * 1. working/reviewing/blocked → idle after IDLE_THRESHOLD_MS (15m)
   * 2. idle → offline after OFFLINE_THRESHOLD_MS (30m)
   */
  private checkExpiry(): void {
    const now = Date.now()
    let idledCount = 0
    let offlinedCount = 0

    for (const [agent, presence] of this.presence) {
      // Use the most recent activity signal to avoid premature decay when
      // recordActivity() updated last_active but not lastUpdate.
      const lastSignal = Math.max(presence.lastUpdate, presence.last_active || 0)
      const inactiveMs = now - lastSignal
      if (presence.status !== 'offline' && presence.status !== 'idle' && inactiveMs > IDLE_THRESHOLD_MS) {
        // Step 1: Active → idle (preserve lastUpdate so step 2 timing is from original activity)
        this.presence.set(agent, { ...presence, status: 'idle', since: now })
        idledCount++
      } else if (presence.status === 'idle' && inactiveMs > OFFLINE_THRESHOLD_MS) {
        // Step 2: idle → offline
        this.updatePresence(agent, 'offline', undefined, undefined, false)
        offlinedCount++
      }
    }

    if (idledCount > 0) {
      console.log(`[Presence] Decayed ${idledCount} agents to idle`)
    }
    if (offlinedCount > 0) {
      console.log(`[Presence] Auto-expired ${offlinedCount} agents to offline`)
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

  clearAll(): void {
    this.presence.clear()
    this.activity.clear()
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
      waiting: 0,
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
