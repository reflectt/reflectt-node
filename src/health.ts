// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Team Health Monitoring
 *
 * Real-time team health diagnostics:
 * - Silence detection (>3 heartbeats = ~45min)
 * - Blocker tracking from messages
 * - Overlapping work detection
 * - Collaboration compliance (protocol v1)
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { presenceManager } from './presence.js'
import { chatManager } from './chat.js'
import { taskManager } from './tasks.js'
import { routeMessage } from './messageRouter.js'
import type { Task } from './types.js'
import { resolveIdleNudgeLane, type IdleNudgeLaneState } from './watchdog/idleNudgeLane.js'

export interface StaleDoingTask {
  task_id: string
  assignee: string
  title: string
  stale_minutes: number
  last_activity_at: number
}

export interface TeamHealthMetrics {
  timestamp: number
  agents: AgentHealthStatus[]
  blockers: BlockerAlert[]
  overlaps: OverlapAlert[]
  silentAgents: string[]
  activeAgents: string[]
  compliance: CollaborationCompliance
  staleDoing: {
    thresholdMinutes: number
    count: number
    tasks: StaleDoingTask[]
  }
}

export type ActiveLane = 'doing' | 'blocked' | 'validating' | 'queue-clear' | 'offline'

/**
 * Compute per-agent active lane from task board + presence data.
 * Priority: doing > blocked > validating > offline > queue-clear
 */
export function computeActiveLane(
  agentName: string,
  tasks: Pick<Task, 'assignee' | 'status'>[],
  presenceStatus?: string,
  lastSeenMs?: number,
  offlineThresholdMs = 15 * 60 * 1000,
  now = Date.now(),
): ActiveLane {
  const agent = agentName.toLowerCase()
  const agentTasks = tasks.filter(t => (t.assignee || '').toLowerCase() === agent)

  if (agentTasks.some(t => t.status === 'doing')) return 'doing'
  if (agentTasks.some(t => t.status === 'blocked')) return 'blocked'
  if (agentTasks.some(t => t.status === 'validating')) return 'validating'

  // Check if offline via presence
  if (presenceStatus === 'offline') return 'offline'
  if (lastSeenMs !== undefined && lastSeenMs > 0 && (now - lastSeenMs) >= offlineThresholdMs) return 'offline'

  return 'queue-clear'
}

export interface AgentHealthSummaryRow {
  agent: string
  last_seen: number
  active_task: string | null
  heartbeat_age_ms: number
  last_shipped_at: number | null
  shipped_age_ms: number | null
  stale_reason: string | null
  idle_with_active_task: boolean
  state: 'healthy' | 'idle' | 'stuck' | 'offline'
  active_lane: ActiveLane
}

export interface ActionableReasonBlock {
  task_id: string | null
  last_task_comment_age_min: number | null
  last_transition: {
    type: string | null
    actor: string | null
    age_min: number | null
  }
  last_mention_age_min: number | null
  suggested_action: string
}

export interface AgentHealthStatus {
  agent: string
  status: 'active' | 'idle' | 'silent' | 'blocked' | 'offline'
  lastSeen: number
  minutesSinceLastSeen: number
  currentTask?: string
  activeTaskId?: string
  activeTaskTitle?: string
  activeTaskPrLink?: string | null
  recentBlockers: string[]
  messageCount24h: number
  lastProductiveAt: number | null
  minutesSinceProductive: number | null
  idleWithActiveTask: boolean
  actionable_reason: ActionableReasonBlock | null
}

export interface BlockerAlert {
  agent: string
  blocker: string
  mentionCount: number
  firstMentioned: number
  lastMentioned: number
}

export interface OverlapAlert {
  agents: string[]
  topic: string
  confidence: 'low' | 'medium' | 'high'
}

export type ComplianceState = 'ok' | 'warning' | 'violation' | 'escalated'

export interface ComplianceSummary {
  workerCadenceMaxMin: number
  leadCadenceMaxMin: number
  blockedEscalationMin: number
  trioSilenceMaxMin: number
  workerWorstAgeMin: number
  leadAgeMin: number
  oldestBlockerMin: number
  trioSilenceMin: number
}

export interface ComplianceAgentStatus {
  agent: string
  taskId: string | null
  lastValidStatusAt: number | null
  lastValidStatusAgeMin: number
  expectedCadenceMin: number
  state: ComplianceState
}

export interface ComplianceIncident {
  id: string
  agent: string
  taskId: string | null
  type: 'trio-silence' | 'stale-working' | 'blocked-overdue'
  minutesOver: number
  escalateTo: string[]
  openedAt: number
}

export interface CollaborationCompliance {
  summary: ComplianceSummary
  agents: ComplianceAgentStatus[]
  incidents: ComplianceIncident[]
}

type WatchdogIncidentLog = {
  type?: string
  at?: number
  agent?: string
  taskId?: string | null
  thresholdMs?: number
  lastUpdateAt?: number
  blockedSinceAt?: number
  workingSinceAt?: number
}

type IdleNudgeState = {
  lastNudgeAt: number
  lastTier: 1 | 2
  lastSignature: string | null
  unchangedNudgeCount: number
}

// IdleNudgeLaneState moved to ./watchdog/idleNudgeLane.ts

export type IdleNudgeDecision = {
  agent: string
  taskId: string | null
  idleMinutes: number
  warnMin: number
  escalateMin: number
  cooldownMin: number
  recentSuppressMin: number
  decision: 'none' | 'warn' | 'escalate'
  reason:
    | 'disabled'
    | 'excluded'
    | 'focus-mode-active'
    | 'offline'
    | 'no-last-active'
    | 'below-warn-threshold'
    | 'recent-activity-suppressed'
    | 'recent-shipped-cooldown'
    | 'cooldown-active'
    | 'blocked-task-suppressed'
    | 'done-task-suppressed'
    | 'max-repeat-reached'
    | 'validating-task-suppressed'
    | 'missing-active-task'
    | 'stale-active-task'
    | 'ambiguous-active-task'
    | 'presence-task-mismatch'
    | 'recent-task-comment'
    | 'task-focus-window'
    | 'queue-clear'
    | 'eligible'
  lane: IdleNudgeLaneState
  renderedMessage: string | null
  at: number
}

class TeamHealthMonitor {
  private blockerKeywords = [
    'blocked',
    'blocker',
    'waiting on',
    'waiting for',
    'need help',
    'stuck',
    'can\'t',
    'unable to',
    'no access',
    'missing',
  ]

  private healthHistory: TeamHealthMetrics[] = []
  private readonly MAX_HISTORY = 168 // 7 days at hourly snapshots
  private lastSnapshotTime = 0
  private readonly SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

  private readonly trioAgents = ['kai', 'link', 'pixel'] as const
  private readonly workerAgents = ['link', 'pixel'] as const
  private readonly workerCadenceMaxMin = 45
  private readonly leadCadenceMaxMin = 60
  private readonly blockedEscalationMin = 20
  private readonly trioSilenceMaxMin = 60

  // System idle nudge settings (configurable via env)
  private readonly idleNudgeEnabled = process.env.IDLE_NUDGE_ENABLED !== 'false'
  private readonly idleNudgeWarnMin = Number(process.env.IDLE_NUDGE_WARN_MIN || 45)
  private readonly idleNudgeEscalateMin = Number(process.env.IDLE_NUDGE_ESCALATE_MIN || 60)
  private readonly idleNudgeCooldownMin = Number(process.env.IDLE_NUDGE_COOLDOWN_MIN || 20)
  private readonly idleNudgeSuppressRecentMin = Number(process.env.IDLE_NUDGE_SUPPRESS_RECENT_MIN || 20)
  private readonly idleNudgeShipCooldownMin = Number(process.env.IDLE_NUDGE_SHIP_COOLDOWN_MIN || 30)
  private readonly idleNudgeActiveTaskMaxAgeMin = Number(process.env.IDLE_NUDGE_ACTIVE_TASK_MAX_AGE_MIN || 180)
  private readonly idleNudgeExcluded = new Set(
    (process.env.IDLE_NUDGE_EXCLUDE || 'ryan,system,diag')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  )
  private idleNudgeState = new Map<string, IdleNudgeState>()
  private idleNudgeLastDecisions: IdleNudgeDecision[] = []

  private readonly cadenceWatchdogEnabled = process.env.CADENCE_WATCHDOG_ENABLED !== 'false'
  private readonly cadenceSilenceMin = Number(process.env.CADENCE_SILENCE_MIN || 60)
  private readonly cadenceWorkingStaleMin = Number(process.env.CADENCE_WORKING_STALE_MIN || 45)
  private readonly cadenceWorkingTaskMaxAgeMin = Number(process.env.CADENCE_WORKING_TASK_MAX_AGE_MIN || 240)
  private readonly cadenceAlertCooldownMin = Number(process.env.CADENCE_ALERT_COOLDOWN_MIN || 30)
  private cadenceAlertState = new Map<string, number>()
  private readonly staleDoingThresholdMin = Number(process.env.STALE_DOING_THRESHOLD_MIN || 240)

  // Mention rescue fallback: if Ryan pings trio and nobody replies quickly, emit a direct system ack.
  private readonly mentionRescueEnabled = process.env.MENTION_RESCUE_ENABLED !== 'false'
  private readonly mentionRescueDelayMin = Number(process.env.MENTION_RESCUE_DELAY_MIN || 0)
  private readonly mentionRescueCooldownMin = Number(process.env.MENTION_RESCUE_COOLDOWN_MIN || 10)
  private readonly mentionRescueGlobalCooldownMin = Number(process.env.MENTION_RESCUE_GLOBAL_COOLDOWN_MIN || 5)
  private mentionRescueState = new Map<string, number>()
  private mentionRescueLastAt = 0

  private systemStartTime = Date.now()
  private requestCount = 0
  private errorCount = 0
  private requestTimes: number[] = []
  private readonly MAX_REQUEST_TIMES = 1000

  /**
   * Get comprehensive team health snapshot
   */
  async getHealth(): Promise<TeamHealthMetrics> {
    const now = Date.now()
    const agents = await this.getAgentHealthStatuses(now)
    const blockers = await this.extractBlockers()
    const overlaps = await this.detectOverlaps()
    const compliance = await this.getCollaborationCompliance(now)
    const staleDoing = this.getStaleDoingSnapshot(now)

    const silentAgents = agents
      .filter(a => a.status === 'silent')
      .map(a => a.agent)

    const activeAgents = agents
      .filter(a => a.status === 'active')
      .map(a => a.agent)

    return {
      timestamp: now,
      agents,
      blockers,
      overlaps,
      silentAgents,
      activeAgents,
      compliance,
      staleDoing,
    }
  }

  private getTaskLastActivityAt(taskId: string, fallbackUpdatedAt: number): number {
    const comments = taskManager.getTaskComments(taskId)
    const latestCommentAt = comments.reduce((max, c) => Math.max(max, this.parseTimestamp(c.timestamp)), 0)
    return Math.max(fallbackUpdatedAt, latestCommentAt)
  }

  private extractTaskPrLink(task?: Task): string | null {
    if (!task?.metadata || typeof task.metadata !== 'object') return null

    const metadata = task.metadata as Record<string, unknown>
    const candidates: string[] = []

    const directPrUrl = metadata.pr_url
    const directPrLink = metadata.pr_link
    if (typeof directPrUrl === 'string') candidates.push(directPrUrl)
    if (typeof directPrLink === 'string') candidates.push(directPrLink)

    const artifacts = metadata.artifacts
    if (Array.isArray(artifacts)) {
      for (const item of artifacts) {
        if (typeof item === 'string') candidates.push(item)
      }
    }

    const qaBundle = metadata.qa_bundle
    if (qaBundle && typeof qaBundle === 'object') {
      const artifactLinks = (qaBundle as Record<string, unknown>).artifact_links
      if (Array.isArray(artifactLinks)) {
        for (const item of artifactLinks) {
          if (typeof item === 'string') candidates.push(item)
        }
      }
    }

    const pullUrlRegex = /https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+(?:[^\s]*)?/i

    for (const candidate of candidates) {
      const trimmed = candidate.trim()
      if (!trimmed) continue
      const match = trimmed.match(pullUrlRegex)
      if (match) return match[0]
    }

    return null
  }

  private getStaleDoingSnapshot(now = Date.now()): { thresholdMinutes: number; count: number; tasks: StaleDoingTask[] } {
    const doing = taskManager.listTasks({ status: 'doing' })

    const staleTasks: StaleDoingTask[] = doing
      .filter(task => Boolean(task.assignee))
      .map((task) => {
        const lastActivityAt = this.getTaskLastActivityAt(task.id, this.parseTimestamp(task.updatedAt))
        const staleMinutes = lastActivityAt > 0
          ? Math.max(0, Math.floor((now - lastActivityAt) / 60_000))
          : 9999

        return {
          task_id: task.id,
          assignee: task.assignee || 'unassigned',
          title: task.title,
          stale_minutes: staleMinutes,
          last_activity_at: lastActivityAt,
        }
      })
      .filter(task => task.stale_minutes >= this.staleDoingThresholdMin)
      .sort((a, b) => b.stale_minutes - a.stale_minutes)

    return {
      thresholdMinutes: this.staleDoingThresholdMin,
      count: staleTasks.length,
      tasks: staleTasks,
    }
  }

  async getAgentHealthSummary(now = Date.now()): Promise<{ agents: AgentHealthSummaryRow[]; thresholds: { healthyMaxMs: number; stuckMinMs: number; offlineMinMs: number }; timestamp: number }> {
    const agents = await this.getAgentHealthStatuses(now)
    const allTasks = taskManager.listTasks({})

    const healthyMaxMs = 45 * 60 * 1000
    const stuckMinMs = 60 * 60 * 1000
    const offlineMinMs = 120 * 60 * 1000

    const rows: AgentHealthSummaryRow[] = agents.map((agent) => {
      const heartbeatAgeMs = Math.max(0, agent.minutesSinceLastSeen) * 60_000

      let state: AgentHealthSummaryRow['state'] = 'healthy'
      let staleReason: string | null = null
      if (agent.lastSeen <= 0 || heartbeatAgeMs >= offlineMinMs) {
        state = 'offline'
        staleReason = 'offline-no-heartbeat'
      } else if (agent.idleWithActiveTask && heartbeatAgeMs >= stuckMinMs) {
        state = 'stuck'
        staleReason = 'active-task-idle-over-60m'
      } else if (heartbeatAgeMs > healthyMaxMs) {
        state = 'idle'
        staleReason = 'heartbeat-age-over-45m'
      }

      const presenceStatus = state === 'offline' ? 'offline' : undefined
      const activeLane = computeActiveLane(agent.agent, allTasks, presenceStatus, agent.lastSeen, offlineMinMs, now)

      return {
        agent: agent.agent,
        last_seen: agent.lastSeen,
        active_task: agent.currentTask || null,
        heartbeat_age_ms: heartbeatAgeMs,
        last_shipped_at: agent.lastProductiveAt,
        shipped_age_ms: agent.minutesSinceProductive === null ? null : Math.max(0, agent.minutesSinceProductive) * 60_000,
        stale_reason: staleReason,
        idle_with_active_task: agent.idleWithActiveTask,
        state,
        active_lane: activeLane,
      }
    })

    return {
      agents: rows,
      thresholds: {
        healthyMaxMs,
        stuckMinMs,
        offlineMinMs,
      },
      timestamp: now,
    }
  }

  async getCollaborationCompliance(now = Date.now()): Promise<CollaborationCompliance> {
    const tasks = taskManager.listTasks({})
    const messages = chatManager.getMessages({ limit: 300 })
    const incidents = await this.getComplianceIncidents(now, messages)

    const complianceAgents: ComplianceAgentStatus[] = this.trioAgents.map((agent) => {
      const expectedCadenceMin = agent === 'kai' ? this.leadCadenceMaxMin : this.workerCadenceMaxMin
      const lastValidStatusAt = this.findLastValidStatusAt(messages, agent)
      const lastValidStatusAgeMin = lastValidStatusAt
        ? Math.floor((now - lastValidStatusAt) / 1000 / 60)
        : 9999

      let state: ComplianceState = 'ok'
      if (lastValidStatusAgeMin > expectedCadenceMin) {
        state = 'violation'
      } else if (lastValidStatusAgeMin >= Math.max(0, expectedCadenceMin - 10)) {
        state = 'warning'
      }

      const hasEscalation = incidents.some(i => i.agent === agent)
      if (hasEscalation) {
        state = 'escalated'
      }

      const activeTask = tasks.find(t => t.assignee === agent && t.status === 'doing')

      return {
        agent,
        taskId: activeTask?.id || null,
        lastValidStatusAt,
        lastValidStatusAgeMin,
        expectedCadenceMin,
        state,
      }
    })

    const workerWorstAgeMin = Math.max(
      ...complianceAgents
        .filter(a => this.workerAgents.includes(a.agent as typeof this.workerAgents[number]))
        .map(a => a.lastValidStatusAgeMin),
      0,
    )

    const leadAgeMin = complianceAgents.find(a => a.agent === 'kai')?.lastValidStatusAgeMin ?? 9999

    const blockerMessages = messages.filter(
      m => typeof m.content === 'string'
        && /\bblocker\s*:\s*(?!none|no|n\/a|na\b).+/i.test(m.content)
        && this.trioAgents.includes((m.from || '').toLowerCase() as typeof this.trioAgents[number]),
    )
    const oldestBlockerMin = blockerMessages.length > 0
      ? Math.max(...blockerMessages.map(m => Math.floor((now - (m.timestamp || now)) / 1000 / 60)))
      : 0

    const lastTrioGeneralUpdate = this.findLastTrioGeneralUpdate(messages)
    const trioSilenceMin = Math.floor((now - lastTrioGeneralUpdate) / 1000 / 60)

    return {
      summary: {
        workerCadenceMaxMin: this.workerCadenceMaxMin,
        leadCadenceMaxMin: this.leadCadenceMaxMin,
        blockedEscalationMin: this.blockedEscalationMin,
        trioSilenceMaxMin: this.trioSilenceMaxMin,
        workerWorstAgeMin,
        leadAgeMin,
        oldestBlockerMin,
        trioSilenceMin,
      },
      agents: complianceAgents,
      incidents,
    }
  }

  private parseTimestamp(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const asNum = Number(value)
      if (Number.isFinite(asNum) && asNum > 0) return asNum
      const asDate = Date.parse(value)
      if (Number.isFinite(asDate) && asDate > 0) return asDate
    }
    return 0
  }

  private getLatestGeneralMessageAt(messages: any[], author: string): number {
    let lastAt = 0

    for (const m of messages) {
      if ((m.from || '').toLowerCase() !== author) continue
      if ((m.channel || 'general') !== 'general') continue
      const ts = this.parseTimestamp(m.timestamp)
      if (ts > lastAt) lastAt = ts
    }

    return lastAt
  }

  private findLastValidStatusAt(messages: any[], agent: string): number | null {
    let lastAt: number | null = null

    for (const m of messages) {
      if ((m.from || '').toLowerCase() !== agent) continue
      if ((m.channel || 'general') !== 'general') continue

      const content = typeof m.content === 'string' ? m.content : ''
      const hasTask = /\btask-[a-z0-9-]+\b/i.test(content)

      const hasStrictTriplet = /1\)\s*(?:\*\*)?[^\n]*\bshipped\b/i.test(content)
        && /2\)\s*(?:\*\*)?[^\n]*\bblocker\b/i.test(content)
        && /3\)\s*(?:\*\*)?[^\n]*\bnext\b/i.test(content)

      const hasLooseStatusSignals = (/\bshipped\b|\bartifact(?:s)?\b|\bcommit\b/i.test(content))
        && /\bblocker\b/i.test(content)
        && (/\bnext\b/i.test(content) || /\beta\b/i.test(content))

      if (!hasTask || (!hasStrictTriplet && !hasLooseStatusSignals)) continue

      const ts = this.parseTimestamp(m.timestamp)
      if (!ts) continue
      if (!lastAt || ts > lastAt) lastAt = ts
    }

    return lastAt
  }

  private findLastTrioGeneralUpdate(messages: any[]): number {
    const trioSet = new Set(this.trioAgents)
    let lastAt = 0

    for (const agent of trioSet) {
      const agentLast = this.getLatestGeneralMessageAt(messages, agent)
      if (agentLast > lastAt) lastAt = agentLast
    }

    return lastAt || Date.now()
  }

  /** Check if agent posted a task comment recently (returns age in minutes or null) */
  private getTaskCommentAgeForAgent(taskId: string, agent: string, now: number): number | null {
    const comments = taskManager.getTaskComments(taskId)
    if (!comments.length) return null

    // Find most recent comment by this agent
    let latestTs = 0
    for (const c of comments) {
      if ((c.author || '').toLowerCase() !== agent) continue
      const ts = this.parseTimestamp(c.timestamp)
      if (ts > latestTs) latestTs = ts
    }

    if (!latestTs) return null
    return Math.floor((now - latestTs) / 60_000)
  }

  /** Per-task focus window: agent started doing task recently → deep work window */
  private taskFocusWindows = new Map<string, { agent: string; startedAt: number; durationMin: number }>()

  getTaskFocusWindow(taskId: string, agent: string, now: number): { active: boolean; remainingMin: number } | null {
    const key = `${agent}:${taskId}`
    const window = this.taskFocusWindows.get(key)
    if (!window) return null

    const elapsed = Math.floor((now - window.startedAt) / 60_000)
    if (elapsed >= window.durationMin) {
      this.taskFocusWindows.delete(key)
      return null
    }

    return { active: true, remainingMin: window.durationMin - elapsed }
  }

  /** Start a focus window for a task (called when agent moves task to doing) */
  startTaskFocusWindow(agent: string, taskId: string, durationMin: number = 45): void {
    const key = `${agent}:${taskId}`
    this.taskFocusWindows.set(key, { agent, startedAt: Date.now(), durationMin })
  }

  /** Count recent status updates from agent on a task that mention ETA but no artifacts */
  private countRecentEtaOnlyUpdates(messages: any[], agent: string, taskId: string | null): number {
    if (!taskId) return 0

    let etaOnlyCount = 0
    const cutoff = Date.now() - (4 * 60 * 60 * 1000) // last 4 hours

    for (const m of messages) {
      if ((m.from || '').toLowerCase() !== agent) continue
      const ts = this.parseTimestamp(m.timestamp)
      if (!ts || ts < cutoff) continue

      const content = typeof m.content === 'string' ? m.content : ''
      if (!content.includes(taskId)) continue

      // Has ETA/time reference
      const hasEta = /\beta\b|\b\d+\s*(?:min|m|h|hr|hour)/i.test(content)
      if (!hasEta) continue

      // Does NOT have artifact signal
      const hasArtifact = /\b(shipped|artifact|commit|pr\s*#?\d+|pull request|merged|deployed|https?:\/\/github\.com)/i.test(content)
      const hasBlocker = /\bblocker\b.*:.*\S/i.test(content) && !/\bblocker\b.*:\s*none\b/i.test(content)

      if (!hasArtifact && !hasBlocker) {
        etaOnlyCount++
      }
    }

    return etaOnlyCount
  }

  private findLastProductiveActionAt(messages: any[], agent: string): number | null {
    let lastAt: number | null = null

    for (const m of messages) {
      if ((m.from || '').toLowerCase() !== agent) continue

      const content = typeof m.content === 'string' ? m.content : ''
      if (!content) continue

      // Productive shipping signal: artifact/commit/proof/merged/shipped references.
      const hasProductiveSignal = /\b(shipped|shipped:|artifact|artifacts|commit|proof|merged|pr\s*#?\d+|pull request|deployed)\b/i.test(content)
      if (!hasProductiveSignal) continue

      const ts = this.parseTimestamp(m.timestamp)
      if (!ts) continue
      if (!lastAt || ts > lastAt) lastAt = ts
    }

    return lastAt
  }

  private hasStaleDoingTask(agent: string, tasks: ReturnType<typeof taskManager.listTasks>, now: number): boolean {
    const thresholdMs = this.idleNudgeActiveTaskMaxAgeMin * 60_000

    return tasks.some((task) => {
      if ((task.assignee || '').toLowerCase() !== agent) return false
      if (task.status !== 'doing') return false

      const updatedAt = this.parseTimestamp((task as any).updatedAt) || this.parseTimestamp((task as any).createdAt)
      const lastActivityAt = this.getTaskLastActivityAt(task.id, updatedAt)
      if (!lastActivityAt) return false

      return now - lastActivityAt > thresholdMs
    })
  }

  private async getComplianceIncidents(now: number, messages: any[]): Promise<ComplianceIncident[]> {
    const fromWatchdog = await this.readWatchdogIncidents(now)
    const inMemory: ComplianceIncident[] = []

    const lastTrioGeneralUpdate = this.findLastTrioGeneralUpdate(messages)
    const trioSilenceMin = Math.floor((now - lastTrioGeneralUpdate) / 1000 / 60)
    if (trioSilenceMin > this.trioSilenceMaxMin) {
      inMemory.push({
        id: `inc-trio-${lastTrioGeneralUpdate}`,
        agent: 'trio',
        taskId: null,
        type: 'trio-silence',
        minutesOver: trioSilenceMin - this.trioSilenceMaxMin,
        escalateTo: ['kai', 'link', 'pixel'],
        openedAt: lastTrioGeneralUpdate + this.trioSilenceMaxMin * 60 * 1000,
      })
    }

    return [...fromWatchdog, ...inMemory].sort((a, b) => b.openedAt - a.openedAt)
  }

  private async readWatchdogIncidents(now: number): Promise<ComplianceIncident[]> {
    const paths = [
      process.env.WATCHDOG_INCIDENT_LOG,
      resolve(process.cwd(), '../workspace-link/openclaw-plugin-reflectt-node/incidents/watchdog-incidents.jsonl'),
      resolve(process.cwd(), '../../workspace-link/openclaw-plugin-reflectt-node/incidents/watchdog-incidents.jsonl'),
    ].filter((p): p is string => Boolean(p))

    for (const path of paths) {
      try {
        const raw = await readFile(path, 'utf8')
        const lines = raw.trim().split('\n').filter(Boolean)
        const recent = lines.slice(-100)
        const incidents = recent
          .map((line) => {
            try {
              return JSON.parse(line) as WatchdogIncidentLog
            } catch {
              return null
            }
          })
          .filter((v): v is WatchdogIncidentLog => v !== null)
          .map((entry, idx) => this.mapWatchdogIncident(entry, idx, now))
          .filter((v): v is ComplianceIncident => v !== null)

        if (incidents.length > 0) {
          return incidents
        }
      } catch {
        // try next path
      }
    }

    return []
  }

  private mapWatchdogIncident(entry: WatchdogIncidentLog, idx: number, now: number): ComplianceIncident | null {
    const openedAt = entry.at || now
    const taskId = entry.taskId ?? null
    const rawType = entry.type || ''

    if (rawType === 'trio_general_silence') {
      const thresholdMin = Math.floor((entry.thresholdMs || this.trioSilenceMaxMin * 60_000) / 60_000)
      const reference = entry.lastUpdateAt || openedAt
      const minutesOver = Math.max(0, Math.floor((now - reference) / 60_000) - thresholdMin)
      return {
        id: `inc-watchdog-trio-${openedAt}-${idx}`,
        agent: 'trio',
        taskId,
        type: 'trio-silence',
        minutesOver,
        escalateTo: ['kai', 'link', 'pixel'],
        openedAt,
      }
    }

    if (rawType === 'stale_working') {
      const agent = entry.agent || 'unknown'
      const thresholdMin = Math.floor((entry.thresholdMs || this.workerCadenceMaxMin * 60_000) / 60_000)
      const reference = entry.lastUpdateAt || openedAt
      const minutesOver = Math.max(0, Math.floor((now - reference) / 60_000) - thresholdMin)
      return {
        id: `inc-watchdog-stale-${agent}-${openedAt}-${idx}`,
        agent,
        taskId,
        type: 'stale-working',
        minutesOver,
        escalateTo: agent === 'pixel' ? ['kai', 'link'] : ['kai', 'pixel'],
        openedAt,
      }
    }

    if (rawType === 'blocked_without_handoff') {
      const agent = entry.agent || 'unknown'
      const thresholdMin = Math.floor((entry.thresholdMs || this.blockedEscalationMin * 60_000) / 60_000)
      const reference = entry.lastUpdateAt || entry.blockedSinceAt || openedAt
      const minutesOver = Math.max(0, Math.floor((now - reference) / 60_000) - thresholdMin)
      return {
        id: `inc-watchdog-blocked-${agent}-${openedAt}-${idx}`,
        agent,
        taskId,
        type: 'blocked-overdue',
        minutesOver,
        escalateTo: agent === 'pixel' ? ['kai', 'link'] : ['kai', 'pixel'],
        openedAt,
      }
    }

    return null
  }

  private getLatestTaskCommentAgeMin(taskId: string | undefined, now: number): number | null {
    if (!taskId) return null
    const comments = taskManager.getTaskComments(taskId)
    if (!comments.length) return null
    const latestTs = comments.reduce((max, c) => Math.max(max, this.parseTimestamp(c.timestamp)), 0)
    if (!latestTs) return null
    return Math.max(0, Math.floor((now - latestTs) / 60_000))
  }

  private getLatestMentionAgeMin(messages: any[], agent: string, now: number): number | null {
    const needle = `@${agent.toLowerCase()}`
    let latest = 0

    for (const m of messages) {
      const from = (m?.from || '').toLowerCase()
      if (!from || from === agent.toLowerCase()) continue
      const content = typeof m?.content === 'string' ? m.content.toLowerCase() : ''
      if (!content.includes(needle)) continue
      const ts = this.parseTimestamp(m.timestamp)
      if (ts > latest) latest = ts
    }

    if (!latest) return null
    return Math.max(0, Math.floor((now - latest) / 60_000))
  }

  private buildSuggestedAction(args: {
    status: AgentHealthStatus['status']
    idleWithActiveTask: boolean
    hasRecentBlocker: boolean
    hasTask: boolean
  }): string {
    if (args.hasRecentBlocker || args.status === 'blocked') {
      return 'Post blocker owner + unblock ETA in #general and request reviewer help if blocked >20m.'
    }
    if (args.idleWithActiveTask) {
      return 'Post shipped/blocker/next+ETA now and either move task to validating with artifact or set blocked reason.'
    }
    if (args.status === 'silent' || args.status === 'offline') {
      return 'Acknowledge in #general and confirm active lane status or set task to blocked/todo if paused.'
    }
    if (!args.hasTask && (args.status === 'idle' || args.status === 'active')) {
      return 'Claim next backlog task or post explicit no-work state; avoid idle-without-lane drift.'
    }
    return 'Post a concrete next artifact ETA and keep task status aligned with actual execution state.'
  }

  /**
   * Get health status for all agents
   */
  private async getAgentHealthStatuses(now: number): Promise<AgentHealthStatus[]> {
    const presences = presenceManager.getAllPresence()
    const tasks = taskManager.listTasks({})
    const messages = chatManager.getMessages({ limit: 300 })

    const agentStatuses: AgentHealthStatus[] = []

    // Get unique agent list from all sources
    const agentSet = new Set<string>()
    presences.forEach((p: any) => agentSet.add(p.agent))
    tasks.forEach((t: any) => t.assignee && agentSet.add(t.assignee))
    messages.forEach((m: any) => agentSet.add(m.from))

    for (const agent of agentSet) {
      const presence = presences.find((p: any) => p.agent === agent)
      const agentTasks = tasks
        .filter((t: any) => t.assignee === agent && t.status === 'doing')
        .sort((a: any, b: any) => {
          const aTs = Number(a.updatedAt || a.createdAt || 0)
          const bTs = Number(b.updatedAt || b.createdAt || 0)
          return bTs - aTs
        })
      const agentMessages = messages.filter((m: any) => m.from === agent)

      const lastSeen = presence?.lastUpdate || 0
      const minutesSinceLastSeen = Math.floor((now - lastSeen) / 1000 / 60)

      // Count messages in last 24h
      const oneDayAgo = now - (24 * 60 * 60 * 1000)
      const messageCount24h = agentMessages.filter((m: any) => m.timestamp > oneDayAgo).length
      const lastProductiveAt = this.findLastProductiveActionAt(messages, agent)
      const minutesSinceProductive = lastProductiveAt
        ? Math.floor((now - lastProductiveAt) / 1000 / 60)
        : null

      // Determine status
      let status: AgentHealthStatus['status'] = 'offline'
      if (minutesSinceLastSeen < 15) {
        status = 'active'
      } else if (minutesSinceLastSeen < 45) {
        status = 'idle'
      } else if (minutesSinceLastSeen < 120) {
        status = 'silent' // >45min = >3 heartbeats
      }

      // Check for blockers in recent messages
      const recentBlockers = this.findBlockersInMessages(
        agentMessages.slice(-10)
      )

      // Override status if explicitly blocked
      if (presence?.status === 'blocked' || recentBlockers.length > 0) {
        status = 'blocked'
      }

      const activeTask = agentTasks[0]
      const hasActiveTask = Boolean(activeTask)
      const idleWithActiveTask = hasActiveTask && minutesSinceLastSeen > 60
      const mentionAgeMin = this.getLatestMentionAgeMin(messages, agent, now)
      const lastTransition = (activeTask?.metadata as any)?.last_transition
      const lastTransitionTs = this.parseTimestamp(lastTransition?.timestamp)
      const isFlagged = status === 'blocked' || status === 'silent' || status === 'offline' || idleWithActiveTask

      const actionable_reason: ActionableReasonBlock | null = isFlagged
        ? {
            task_id: activeTask?.id || null,
            last_task_comment_age_min: this.getLatestTaskCommentAgeMin(activeTask?.id, now),
            last_transition: {
              type: typeof lastTransition?.type === 'string' ? lastTransition.type : null,
              actor: typeof lastTransition?.actor === 'string' ? lastTransition.actor : null,
              age_min: lastTransitionTs ? Math.max(0, Math.floor((now - lastTransitionTs) / 60_000)) : null,
            },
            last_mention_age_min: mentionAgeMin,
            suggested_action: this.buildSuggestedAction({
              status,
              idleWithActiveTask,
              hasRecentBlocker: recentBlockers.length > 0,
              hasTask: hasActiveTask,
            }),
          }
        : null

      agentStatuses.push({
        agent,
        status,
        lastSeen,
        minutesSinceLastSeen,
        currentTask: activeTask?.title,
        activeTaskId: activeTask?.id,
        activeTaskTitle: activeTask?.title,
        activeTaskPrLink: this.extractTaskPrLink(activeTask),
        recentBlockers,
        messageCount24h,
        lastProductiveAt,
        minutesSinceProductive,
        idleWithActiveTask,
        actionable_reason,
      })
    }

    return agentStatuses.sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /**
   * Extract blocker mentions from recent messages
   */
  private async extractBlockers(): Promise<BlockerAlert[]> {
    const messages = chatManager.getMessages({ limit: 200 })
    const blockerMap = new Map<string, BlockerAlert>()

    for (const msg of messages) {
      const blockers = this.findBlockersInMessages([msg])

      for (const blocker of blockers) {
        const key = `${msg.from}:${blocker}`

        if (blockerMap.has(key)) {
          const existing = blockerMap.get(key)!
          existing.mentionCount++
          existing.lastMentioned = msg.timestamp
        } else {
          blockerMap.set(key, {
            agent: msg.from,
            blocker,
            mentionCount: 1,
            firstMentioned: msg.timestamp,
            lastMentioned: msg.timestamp,
          })
        }
      }
    }

    return Array.from(blockerMap.values())
      .filter(b => b.mentionCount >= 2) // Only blockers mentioned multiple times
      .sort((a, b) => b.lastMentioned - a.lastMentioned)
  }

  /**
   * Find blocker keywords in messages (improved with false-positive reduction)
   */
  private findBlockersInMessages(messages: any[]): string[] {
    const blockers: string[] = []

    for (const msg of messages) {
      const from = (msg?.from || '').toLowerCase()
      if (from === 'system' || from === 'watchdog') {
        continue
      }

      const rawContent = typeof msg?.content === 'string' ? msg.content : ''
      if (!rawContent) continue
      const content = rawContent.toLowerCase()

      // Skip known non-actionable watchdog/template/fallback chatter.
      const looksLikeStatusTemplate =
        /1\)\s*shipped:\s*</i.test(rawContent) ||
        /2\)\s*blocker:\s*</i.test(rawContent) ||
        /3\)\s*next:\s*</i.test(rawContent)

      if (content.includes('post shipped / blocker / next+eta now') ||
          content.includes('system watchdog') ||
          content.includes('system fallback') ||
          content.includes('idle nudge') ||
          content.includes('required status now') ||
          content.includes('system reminder: you appear idle') ||
          content.includes('system escalation:') ||
          looksLikeStatusTemplate) {
        continue
      }

      // Skip status reports and completed work mentions
      if (content.includes('was blocked') ||
          content.includes('unblocked') ||
          content.includes('fixed') ||
          content.includes('resolved') ||
          content.includes('completed') ||
          content.includes('done')) {
        continue
      }

      for (const keyword of this.blockerKeywords) {
        if (content.includes(keyword)) {
          // Additional context check: must be near agent name or "I" to be real blocker
          const hasContext = content.includes(' i ') ||
                            content.includes('i\'m') ||
                            content.includes('we\'re') ||
                            content.match(/@\w+/)

          if (!hasContext) continue

          // Extract context around the keyword
          const index = content.indexOf(keyword)
          const start = Math.max(0, index - 20)
          const end = Math.min(content.length, index + keyword.length + 40)
          const context = rawContent.substring(start, end).trim()
          blockers.push(context)
          break // Only one blocker per message
        }
      }
    }

    return blockers
  }

  private hasScopeSplitSignal(taskId: string): boolean {
    const comments = taskManager.getTaskComments(taskId)
    const splitSignals = [
      'deconflict',
      'scope split',
      'owner map',
      'no overlap',
      'non-overlap',
      'boundary',
      'aligned',
      'split ownership',
      'avoid duplicate',
    ]

    return comments.some(comment => {
      const content = comment.content.toLowerCase()
      return splitSignals.some(signal => content.includes(signal))
    })
  }

  /**
   * Detect overlapping work (agents working on similar things)
   */
  private async detectOverlaps(): Promise<OverlapAlert[]> {
    const tasks = taskManager
      .listTasks({ status: 'doing' })
      .filter(task => Boolean(task.assignee))

    if (tasks.length < 2) return []

    const taskKeywords = new Map<string, Set<string>>()
    for (const task of tasks) {
      const keywords = this.extractKeywords(`${task.title} ${task.description || ''}`)
      taskKeywords.set(task.id, new Set(keywords))
    }

    const overlapTopics = new Map<string, Set<string>>()

    for (let i = 0; i < tasks.length; i += 1) {
      for (let j = i + 1; j < tasks.length; j += 1) {
        const a = tasks[i]
        const b = tasks[j]

        if (!a.assignee || !b.assignee) continue
        if (a.assignee === b.assignee) continue

        // If either task explicitly carries deconfliction/scope-split notes,
        // treat this pair as resolved and suppress recurring overlap alerts.
        if (this.hasScopeSplitSignal(a.id) || this.hasScopeSplitSignal(b.id)) {
          continue
        }

        const aKeywords = taskKeywords.get(a.id) || new Set<string>()
        const bKeywords = taskKeywords.get(b.id) || new Set<string>()
        const shared = Array.from(aKeywords).filter(k => bKeywords.has(k))

        // Require 2+ shared keywords to avoid generic single-word collisions.
        if (shared.length < 2) continue

        const topic = shared.slice(0, 2).join('+')
        if (!overlapTopics.has(topic)) {
          overlapTopics.set(topic, new Set())
        }
        overlapTopics.get(topic)!.add(a.assignee)
        overlapTopics.get(topic)!.add(b.assignee)
      }
    }

    const overlaps: OverlapAlert[] = []
    for (const [topic, agentsSet] of overlapTopics.entries()) {
      const agents = Array.from(agentsSet)
      if (agents.length < 2) continue

      overlaps.push({
        agents,
        topic,
        confidence: agents.length >= 3 ? 'high' : 'medium',
      })
    }

    return overlaps
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      // Domain-generic terms that cause overlap false positives.
      'task', 'tasks', 'reflectt', 'node', 'agent', 'agents', 'lane', 'lanes', 'work', 'status',
    ])

    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 3 && !stopWords.has(word))
      .slice(0, 8)
  }

  private shouldEmitCadenceAlert(key: string, now: number): boolean {
    const lastAt = this.cadenceAlertState.get(key)
    if (!lastAt) return true
    const cooldownMs = this.cadenceAlertCooldownMin * 60_000
    return now - lastAt >= cooldownMs
  }

  private markCadenceAlert(key: string, now: number): void {
    this.cadenceAlertState.set(key, now)
  }

  /**
   * Enhanced suppression: check if agent has had ANY recent activity
   * (task comment, status update, chat message, task transition) since
   * the last alert for this key. If so, suppress the repeat.
   */
  private hasRecentActivitySinceLastAlert(agent: string, key: string, now: number): boolean {
    const lastAlertAt = this.cadenceAlertState.get(key)
    if (!lastAlertAt) return false // No prior alert → can't suppress based on activity

    const messages = chatManager.getMessages({ limit: 200 })

    // Check for any message from this agent after the last alert
    const hasRecentMessage = messages.some((m: any) => {
      const from = (m.from || '').toLowerCase()
      const ts = Number(m.timestamp || 0)
      return from === agent && ts > lastAlertAt
    })
    if (hasRecentMessage) return true

    // Check for task comments from this agent after last alert
    const tasks = taskManager.listTasks({ status: 'doing' })
    for (const task of tasks) {
      if ((task.assignee || '').toLowerCase() !== agent) continue
      const comments = taskManager.getTaskComments?.(task.id) || []
      const hasRecentComment = comments.some((c: any) => {
        const author = (c.author || '').toLowerCase()
        const ts = Number(c.createdAt || 0)
        return author === agent && ts > lastAlertAt
      })
      if (hasRecentComment) return true
    }

    // Check for task status changes after last alert
    const updatedTask = tasks.find((t: any) => {
      const assignee = (t.assignee || '').toLowerCase()
      const updatedAt = Number(t.updatedAt || 0)
      return assignee === agent && updatedAt > lastAlertAt
    })
    if (updatedTask) return true

    return false
  }

  private async logWatchdogIncident(entry: Record<string, unknown>): Promise<void> {
    const path = process.env.WATCHDOG_INCIDENT_LOG
      || resolve(process.cwd(), 'incidents/watchdog-incidents.jsonl')
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private resolveIdleNudgeLane(agent: string, presenceTaskRaw: unknown, tasks: ReturnType<typeof taskManager.listTasks>, now: number): IdleNudgeLaneState {
    return resolveIdleNudgeLane(
      agent,
      presenceTaskRaw,
      tasks,
      now,
      this.idleNudgeActiveTaskMaxAgeMin,
    )
  }

  async runCadenceWatchdogTick(now = Date.now(), options?: { dryRun?: boolean }): Promise<{ alerts: string[] }> {
    const dryRun = options?.dryRun === true
    const alerts: string[] = []

    if (!this.cadenceWatchdogEnabled) {
      return { alerts }
    }

    const tasks = taskManager.listTasks({})
    const messages = chatManager.getMessages({ limit: 300 })

    const lastTrioGeneralUpdate = this.findLastTrioGeneralUpdate(messages)
    const trioSilenceMin = Math.floor((now - lastTrioGeneralUpdate) / 60_000)

    if (trioSilenceMin >= this.cadenceSilenceMin) {
      const key = 'trio_general_silence'
      if (this.shouldEmitCadenceAlert(key, now)) {
        // Enhanced suppression: skip if any trio member has had activity since last alert
        const anyTrioActive = this.trioAgents.some(a => this.hasRecentActivitySinceLastAlert(a, key, now))
        if (anyTrioActive) {
          // Activity detected — extend cooldown without re-alerting
          this.markCadenceAlert(key, now)
        } else {
          const content = `@kai @link @pixel system watchdog: no #general update from trio for ${trioSilenceMin}m (threshold ${this.cadenceSilenceMin}m). Post status now using 1) shipped 2) blocker 3) next+ETA.`
          alerts.push(content)

          if (!dryRun) {
            await routeMessage({ from: 'system', content, category: 'escalation', severity: 'warning', mentions: ['kai', 'link', 'pixel'] })
            await this.logWatchdogIncident({
              type: 'trio_general_silence',
              at: now,
              thresholdMs: this.cadenceSilenceMin * 60_000,
              lastUpdateAt: lastTrioGeneralUpdate,
            })
            this.markCadenceAlert(key, now)
          }
        }
      }
    }

    const trioSet = new Set(this.trioAgents)
    const doingByAgent = new Map<string, typeof tasks[number]>()

    for (const task of tasks) {
      if (!task.assignee) continue
      // Only monitor actively-doing tasks; skip done/cancelled/blocked
      if (task.status !== 'doing') continue
      const agent = (task.assignee || '').toLowerCase()
      if (!trioSet.has(agent as typeof this.trioAgents[number])) continue

      const taskTs = Number(task.updatedAt || task.createdAt || 0)
      const taskAgeMin = taskTs > 0 ? Math.floor((now - taskTs) / 60_000) : Number.MAX_SAFE_INTEGER
      if (taskAgeMin > this.cadenceWorkingTaskMaxAgeMin) {
        continue
      }

      const current = doingByAgent.get(agent)
      const currentTs = current ? Number(current.updatedAt || current.createdAt || 0) : 0
      if (!current || taskTs >= currentTs) {
        doingByAgent.set(agent, task)
      }
    }

    const workingTasks = Array.from(doingByAgent.values())

    for (const task of workingTasks) {
      const agent = (task.assignee || '').toLowerCase()
      const lastAt = this.getLatestGeneralMessageAt(messages, agent)
      const staleMin = lastAt > 0 ? Math.floor((now - lastAt) / 60_000) : 9999

      if (staleMin < this.cadenceWorkingStaleMin) continue

      const key = `stale_working:${agent}:${task.id}`
      if (!this.shouldEmitCadenceAlert(key, now)) continue

      // Enhanced suppression: skip if agent has had ANY activity since last alert
      if (this.hasRecentActivitySinceLastAlert(agent, key, now)) {
        this.markCadenceAlert(key, now)
        continue
      }

      // Also suppress first-time alerts if agent posted ANY #general message recently
      const agentLastGeneralAt = this.getLatestGeneralMessageAt(messages, agent)
      if (agentLastGeneralAt > 0) {
        const sinceGeneralMin = Math.floor((now - agentLastGeneralAt) / 60_000)
        if (sinceGeneralMin < this.cadenceWorkingStaleMin) continue
      }

      const content = `@${agent} @kai @pixel system watchdog: status=working with no #general update for ${staleMin}m on ${task.id}. Post required status now: 1) shipped 2) blocker 3) next+ETA.`
      alerts.push(content)

      if (!dryRun) {
        await routeMessage({ from: 'system', content, category: 'watchdog-alert', severity: 'info', taskId: task.id, mentions: [agent, 'kai', 'pixel'] })
        await this.logWatchdogIncident({
          type: 'stale_working',
          at: now,
          agent,
          taskId: task.id,
          thresholdMs: this.cadenceWorkingStaleMin * 60_000,
          lastUpdateAt: lastAt || null,
          workingSinceAt: task.updatedAt || task.createdAt || null,
        })
        this.markCadenceAlert(key, now)
      }
    }

    return { alerts }
  }

  async runMentionRescueTick(now = Date.now(), options?: { dryRun?: boolean }): Promise<{ rescued: string[] }> {
    const dryRun = options?.dryRun === true
    const rescued: string[] = []

    if (!this.mentionRescueEnabled) {
      return { rescued }
    }

    const messages = chatManager.getMessages({ limit: 300 })
    const mentions = messages.filter((m: any) => {
      const from = (m.from || '').toLowerCase()
      const channel = (m.channel || 'general')
      const content = typeof m.content === 'string' ? m.content : ''
      if (channel !== 'general' || from !== 'ryan') return false
      return /@(kai|link|pixel)\b/i.test(content)
    })

    const trioSet = new Set(this.trioAgents)
    const delayMs = this.mentionRescueDelayMin * 60_000
    const cooldownMs = this.mentionRescueCooldownMin * 60_000
    const globalCooldownMs = this.mentionRescueGlobalCooldownMin * 60_000

    for (const mention of mentions) {
      const mentionId = String(mention.id || mention.timestamp || '')
      if (!mentionId) continue

      const mentionAt = Number(mention.timestamp || 0)
      if (!mentionAt || now - mentionAt < delayMs) continue

      // Global cooldown to avoid duplicate fallback nudges across near-identical mentions.
      if (now - this.mentionRescueLastAt < globalCooldownMs) continue

      const replied = messages.some((m: any) => {
        const from = (m.from || '').toLowerCase()
        if (!trioSet.has(from as typeof this.trioAgents[number])) return false
        const ts = Number(m.timestamp || 0)
        return ts > mentionAt
      })

      if (replied) continue

      const lastRescueAt = this.mentionRescueState.get(mentionId) || 0
      if (now - lastRescueAt < cooldownMs) continue

      // Focus mode is a hard suppressor for fallback nudges.
      const anyFocused = this.trioAgents.some(a => presenceManager.isInFocus(a) !== null)
      if (anyFocused) continue

      const mentionList = this.trioAgents.map(a => `@${a}`).join(' ')
      const content = `[[reply_to:${mentionId}]] system fallback: mention received. ${mentionList} are being nudged to respond.`
      rescued.push(content)

      if (!dryRun) {
        await routeMessage({ from: 'system', content, category: 'mention-rescue', severity: 'warning' })
        this.mentionRescueState.set(mentionId, now)
        this.mentionRescueLastAt = now
      }
    }

    return { rescued }
  }

  async runIdleNudgeTick(
    now = Date.now(),
    options?: { dryRun?: boolean },
  ): Promise<{ nudged: string[]; decisions: IdleNudgeDecision[] }> {
    const dryRun = options?.dryRun === true
    const nudged: string[] = []
    const decisions: IdleNudgeDecision[] = []

    const presences = presenceManager.getAllPresence()
    const tasks = taskManager.listTasks({})
    const taskById = new Map(tasks.map((t: any) => [t.id, t]))
    const messages = chatManager.getMessages({ limit: 300 })

    for (const presence of presences) {
      const agent = (presence.agent || '').toLowerCase()
      if (!agent) continue

      const lastActiveAt = presence.last_active || presence.lastUpdate || 0
      const inactivityMin = lastActiveAt ? Math.floor((now - lastActiveAt) / 60_000) : 0
      const tier: 1 | 2 = inactivityMin >= this.idleNudgeEscalateMin ? 2 : 1
      const lane = this.resolveIdleNudgeLane(agent, presence.task, tasks, now)
      const taskId = lane.selectedTaskId

      const baseDecision: Omit<IdleNudgeDecision, 'reason' | 'decision' | 'renderedMessage'> = {
        agent,
        taskId,
        idleMinutes: inactivityMin,
        warnMin: this.idleNudgeWarnMin,
        escalateMin: this.idleNudgeEscalateMin,
        cooldownMin: this.idleNudgeCooldownMin,
        recentSuppressMin: this.idleNudgeSuppressRecentMin,
        lane,
        at: now,
      }

      if (!this.idleNudgeEnabled) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'disabled', renderedMessage: null })
        continue
      }

      if (this.idleNudgeExcluded.has(agent)) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'excluded', renderedMessage: null })
        continue
      }

      // Respect focus mode — suppress idle nudges for focused agents
      const focusState = presenceManager.isInFocus(agent)
      if (focusState) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'focus-mode-active', renderedMessage: null })
        continue
      }

      if (presence.status === 'offline') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'offline', renderedMessage: null })
        continue
      }

      // Suppress nudges for agents with no assigned work (queue-clear)
      const activeLane = computeActiveLane(agent, tasks, presence.status, undefined, undefined, now)
      if (activeLane === 'queue-clear') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'queue-clear', renderedMessage: null })
        continue
      }

      if (presence.status === 'blocked') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'blocked-task-suppressed', renderedMessage: null })
        continue
      }

      if (!lastActiveAt) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'no-last-active', renderedMessage: null })
        continue
      }

      const hasStaleDoingTask = this.hasStaleDoingTask(agent, tasks, now)
      const lastProductiveActionAt = this.findLastProductiveActionAt(messages, agent)
      if (!hasStaleDoingTask && lastProductiveActionAt) {
        const sinceShipMin = Math.floor((now - lastProductiveActionAt) / 60_000)
        if (sinceShipMin < this.idleNudgeShipCooldownMin) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'recent-shipped-cooldown', renderedMessage: null })
          continue
        }
      }

      // Task-comment activity suppression: treat task comments as not-idle
      if (taskId) {
        const taskCommentAge = this.getTaskCommentAgeForAgent(taskId, agent, now)
        if (taskCommentAge !== null && taskCommentAge < 30) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'recent-task-comment', renderedMessage: null })
          continue
        }
      }

      // Per-task focus window: 45-60m deep work suppression
      if (taskId) {
        const focusWindow = this.getTaskFocusWindow(taskId, agent, now)
        if (focusWindow && focusWindow.active) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'task-focus-window', renderedMessage: null })
          continue
        }
      }

      if (inactivityMin < this.idleNudgeWarnMin) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'below-warn-threshold', renderedMessage: null })
        continue
      }

      // Suppress if agent posted ANY message in #general recently (not just strict status format)
      const lastGeneralMsgAt = this.getLatestGeneralMessageAt(messages, agent)
      if (lastGeneralMsgAt) {
        const sinceLastGeneralMsgMin = Math.floor((now - lastGeneralMsgAt) / 60_000)
        if (sinceLastGeneralMsgMin < this.idleNudgeSuppressRecentMin) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'recent-activity-suppressed', renderedMessage: null })
          continue
        }
      }

      const lastValidStatusAt = this.findLastValidStatusAt(messages, agent)
      if (lastValidStatusAt) {
        const sinceLastStatusMin = Math.floor((now - lastValidStatusAt) / 60_000)
        if (sinceLastStatusMin < this.idleNudgeSuppressRecentMin) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'recent-activity-suppressed', renderedMessage: null })
          continue
        }
      }

      const state = this.idleNudgeState.get(agent)
      if (state) {
        const sinceNudgeMin = Math.floor((now - state.lastNudgeAt) / 60_000)
        if (sinceNudgeMin < this.idleNudgeCooldownMin) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'cooldown-active', renderedMessage: null })
          continue
        }
      }

      const hasValidatingTask = tasks.some((t: any) => (t.assignee || '').toLowerCase() === agent && t.status === 'validating')
      if (hasValidatingTask) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'validating-task-suppressed', renderedMessage: null })
        continue
      }

      if (lane.laneReason === 'no-active-lane') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'missing-active-task', renderedMessage: null })
        continue
      }

      if (lane.laneReason === 'stale-lane') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'stale-active-task', renderedMessage: null })
        continue
      }

      if (lane.laneReason === 'ambiguous-lane') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'ambiguous-active-task', renderedMessage: null })
        continue
      }

      if (lane.laneReason === 'presence-task-mismatch') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'presence-task-mismatch', renderedMessage: null })
        continue
      }

      // Safety guard: never emit when an active task is missing/invalid.
      if (!taskId || !/^task-[a-z0-9-]+$/i.test(taskId)) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'missing-active-task', renderedMessage: null })
        continue
      }

      const selectedTask = taskById.get(taskId)
      if (selectedTask?.status === 'blocked') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'blocked-task-suppressed', renderedMessage: null })
        continue
      }
      if (selectedTask?.status === 'done' || selectedTask?.status === 'cancelled') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'done-task-suppressed', renderedMessage: null })
        continue
      }

      const signature = `${taskId}:${selectedTask?.status || 'unknown'}:${selectedTask?.updatedAt || 0}`
      if (state && state.lastSignature === signature && state.unchangedNudgeCount >= 2) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'max-repeat-reached', renderedMessage: null })
        continue
      }

      // ETA-only escalation: after 2 repeated status updates without artifacts,
      // require artifact link or explicit blocker, else flag for reassignment
      const etaOnlyCount = this.countRecentEtaOnlyUpdates(messages, agent, taskId)
      const needsArtifact = etaOnlyCount >= 2

      const intro = needsArtifact
        ? `@${agent} @kai escalation: ${etaOnlyCount} status updates on ${taskId} with no artifact or blocker. Post artifact link or explicit blocker now, or task will be flagged for reassignment.`
        : tier === 1
          ? `@${agent} system reminder: you appear idle for ${inactivityMin}m. Post a quick status update now.`
          : `@${agent} @kai system escalation: ${inactivityMin}m idle. Post required status format now.`

      const template = needsArtifact
        ? [
            `Task: ${taskId}`,
            '1) Artifact: <PR link, commit, or file path> (REQUIRED)',
            '2) Blocker: <explicit blocker if no artifact>',
          ].join('\n')
        : [
            `Task: ${taskId}`,
            '1) Shipped: <artifact/commit/file>',
            '2) Blocker: <none or explicit blocker>',
            '3) Next: <next deliverable + ETA>',
          ].join('\n')

      const renderedMessage = `${intro}\n${template}`

      decisions.push({
        ...baseDecision,
        decision: tier === 1 ? 'warn' : 'escalate',
        reason: 'eligible',
        renderedMessage,
      })

      if (dryRun) {
        continue
      }

      await routeMessage({
        from: 'system',
        content: renderedMessage,
        category: 'watchdog-alert',
        severity: tier === 2 ? 'warning' : 'info',
        taskId: taskId || undefined,
        mentions: tier === 2 ? [agent, 'kai'] : [agent],
      })

      const unchangedNudgeCount = state && state.lastSignature === signature
        ? state.unchangedNudgeCount + 1
        : 1

      this.idleNudgeState.set(agent, {
        lastNudgeAt: now,
        lastTier: tier,
        lastSignature: signature,
        unchangedNudgeCount,
      })
      nudged.push(agent)
    }

    this.idleNudgeLastDecisions = decisions
    return { nudged, decisions }
  }

  getIdleNudgeDebug(): {
    config: {
      enabled: boolean
      warnMin: number
      escalateMin: number
      cooldownMin: number
      recentSuppressMin: number
      shipCooldownMin: number
      activeTaskMaxAgeMin: number
      excluded: string[]
    }
    state: Array<{ agent: string; lastNudgeAt: number; lastTier: 1 | 2; lastSignature: string | null; unchangedNudgeCount: number }>
    summary: {
      decisionCounts: Record<'none' | 'warn' | 'escalate', number>
      reasonCounts: Record<string, number>
      laneReasonCounts: Record<string, number>
    }
    lastDecisions: IdleNudgeDecision[]
    timestamp: number
  } {
    const decisionCounts: Record<'none' | 'warn' | 'escalate', number> = { none: 0, warn: 0, escalate: 0 }
    const reasonCounts: Record<string, number> = {}
    const laneReasonCounts: Record<string, number> = {}

    for (const decision of this.idleNudgeLastDecisions) {
      decisionCounts[decision.decision] += 1
      reasonCounts[decision.reason] = (reasonCounts[decision.reason] || 0) + 1
      laneReasonCounts[decision.lane.laneReason] = (laneReasonCounts[decision.lane.laneReason] || 0) + 1
    }

    return {
      config: {
        enabled: this.idleNudgeEnabled,
        warnMin: this.idleNudgeWarnMin,
        escalateMin: this.idleNudgeEscalateMin,
        cooldownMin: this.idleNudgeCooldownMin,
        recentSuppressMin: this.idleNudgeSuppressRecentMin,
        shipCooldownMin: this.idleNudgeShipCooldownMin,
        activeTaskMaxAgeMin: this.idleNudgeActiveTaskMaxAgeMin,
        excluded: Array.from(this.idleNudgeExcluded.values()).sort(),
      },
      state: Array.from(this.idleNudgeState.entries()).map(([agent, s]) => ({
        agent,
        lastNudgeAt: s.lastNudgeAt,
        lastTier: s.lastTier,
        lastSignature: s.lastSignature,
        unchangedNudgeCount: s.unchangedNudgeCount,
      })),
      summary: {
        decisionCounts,
        reasonCounts,
        laneReasonCounts,
      },
      lastDecisions: this.idleNudgeLastDecisions,
      timestamp: Date.now(),
    }
  }

  /**
   * Get simple summary for quick display
   */
  async getSummary(): Promise<string> {
    const health = await this.getHealth()

    const lines = [
      `🏥 **Team Health** (${new Date(health.timestamp).toLocaleTimeString()})`,
      '',
      `**Active:** ${health.activeAgents.join(', ') || 'none'}`,
      `**Silent >45min:** ${health.silentAgents.join(', ') || 'none'}`,
    ]

    if (health.blockers.length > 0) {
      lines.push('')
      lines.push('**🚫 Blockers:**')
      health.blockers.slice(0, 3).forEach(b => {
        lines.push(`- ${b.agent}: ${b.blocker} (${b.mentionCount}x)`)
      })
    }

    if (health.overlaps.length > 0) {
      lines.push('')
      lines.push('**⚠️ Overlapping work:**')
      health.overlaps.slice(0, 3).forEach(o => {
        lines.push(`- ${o.agents.join(', ')}: ${o.topic}`)
      })
    }

    return lines.join('\n')
  }

  /**
   * Record health snapshot for history tracking
   */
  async recordSnapshot(): Promise<void> {
    const now = Date.now()

    // Only snapshot once per hour
    if (now - this.lastSnapshotTime < this.SNAPSHOT_INTERVAL_MS) {
      return
    }

    const health = await this.getHealth()
    this.healthHistory.push(health)
    this.lastSnapshotTime = now

    // Trim old history
    if (this.healthHistory.length > this.MAX_HISTORY) {
      this.healthHistory = this.healthHistory.slice(-this.MAX_HISTORY)
    }
  }

  /**
   * Get health history for trends
   */
  getHealthHistory(days: number = 7): TeamHealthMetrics[] {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000)
    return this.healthHistory.filter(h => h.timestamp >= cutoff)
  }

  /**
   * Track request for system health monitoring
   */
  trackRequest(duration: number): void {
    this.requestCount++
    this.requestTimes.push(duration)

    // Keep only recent request times
    if (this.requestTimes.length > this.MAX_REQUEST_TIMES) {
      this.requestTimes = this.requestTimes.slice(-this.MAX_REQUEST_TIMES)
    }
  }

  /**
   * Track error for system health monitoring
   */
  trackError(): void {
    this.errorCount++
  }

  /**
   * Get system health metrics
   */
  getSystemHealth(): {
    uptime: number
    uptimeHours: number
    memory: NodeJS.MemoryUsage
    requestCount: number
    errorCount: number
    avgResponseTime: number
    p95ResponseTime: number
    errorRate: number
  } {
    const uptime = Date.now() - this.systemStartTime
    const uptimeHours = Math.floor(uptime / 1000 / 60 / 60)

    // Calculate response time percentiles
    const sorted = this.requestTimes.slice().sort((a, b) => a - b)
    const avgResponseTime = sorted.length > 0
      ? sorted.reduce((a, b) => a + b, 0) / sorted.length
      : 0
    const p95Index = Math.floor(sorted.length * 0.95)
    const p95ResponseTime = sorted[p95Index] || 0

    const errorRate = this.requestCount > 0
      ? this.errorCount / this.requestCount
      : 0

    return {
      uptime,
      uptimeHours,
      memory: process.memoryUsage(),
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTime: Math.round(avgResponseTime),
      p95ResponseTime: Math.round(p95ResponseTime),
      errorRate: Math.round(errorRate * 10000) / 100, // percentage
    }
  }
}

export const healthMonitor = new TeamHealthMonitor()
