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

export interface TeamHealthMetrics {
  timestamp: number
  agents: AgentHealthStatus[]
  blockers: BlockerAlert[]
  overlaps: OverlapAlert[]
  silentAgents: string[]
  activeAgents: string[]
  compliance: CollaborationCompliance
}

export interface AgentHealthStatus {
  agent: string
  status: 'active' | 'idle' | 'silent' | 'blocked' | 'offline'
  lastSeen: number
  minutesSinceLastSeen: number
  currentTask?: string
  recentBlockers: string[]
  messageCount24h: number
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
}

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
    | 'offline'
    | 'no-last-active'
    | 'below-warn-threshold'
    | 'recent-activity-suppressed'
    | 'cooldown-active'
    | 'missing-active-task'
    | 'eligible'
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
  private readonly idleNudgeCooldownMin = Number(process.env.IDLE_NUDGE_COOLDOWN_MIN || 30)
  private readonly idleNudgeSuppressRecentMin = Number(process.env.IDLE_NUDGE_SUPPRESS_RECENT_MIN || 10)
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
  private readonly cadenceAlertCooldownMin = Number(process.env.CADENCE_ALERT_COOLDOWN_MIN || 30)
  private cadenceAlertState = new Map<string, number>()

  // Mention rescue fallback: if Ryan pings trio and nobody replies quickly, emit a direct system ack.
  private readonly mentionRescueEnabled = process.env.MENTION_RESCUE_ENABLED !== 'false'
  private readonly mentionRescueDelayMin = Number(process.env.MENTION_RESCUE_DELAY_MIN || 0)
  private readonly mentionRescueCooldownMin = Number(process.env.MENTION_RESCUE_COOLDOWN_MIN || 10)
  private mentionRescueState = new Map<string, number>()

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

  private findLastValidStatusAt(messages: any[], agent: string): number | null {
    let lastAt: number | null = null

    for (const m of messages) {
      if ((m.from || '').toLowerCase() !== agent) continue
      if ((m.channel || 'general') !== 'general') continue

      const content = typeof m.content === 'string' ? m.content : ''
      const hasTask = /\btask-[a-z0-9-]+\b/i.test(content)
      const hasFormat = /1\)\s*(?:\*\*)?\s*shipped\s*(?:\*\*)?\s*:/i.test(content)
        && /2\)\s*(?:\*\*)?\s*blocker\s*(?:\*\*)?\s*:/i.test(content)
        && /3\)\s*(?:\*\*)?\s*next\s*(?:\*\*)?\s*:/i.test(content)

      if (!hasTask || !hasFormat) continue

      const ts = Number(m.timestamp || 0)
      if (!ts) continue
      if (!lastAt || ts > lastAt) lastAt = ts
    }

    return lastAt
  }

  private findLastTrioGeneralUpdate(messages: any[]): number {
    const trioSet = new Set(this.trioAgents)
    let lastAt = 0

    for (const m of messages) {
      const from = (m.from || '').toLowerCase()
      const channel = (m.channel || 'general')
      if (!trioSet.has(from as typeof this.trioAgents[number])) continue
      if (channel !== 'general') continue

      const ts = Number(m.timestamp || 0)
      if (ts > lastAt) lastAt = ts
    }

    return lastAt || Date.now()
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

  /**
   * Get health status for all agents
   */
  private async getAgentHealthStatuses(now: number): Promise<AgentHealthStatus[]> {
    const presences = presenceManager.getAllPresence()
    const tasks = taskManager.listTasks({})
    const messages = chatManager.getMessages({ limit: 100 })

    const agentStatuses: AgentHealthStatus[] = []

    // Get unique agent list from all sources
    const agentSet = new Set<string>()
    presences.forEach((p: any) => agentSet.add(p.agent))
    tasks.forEach((t: any) => t.assignee && agentSet.add(t.assignee))
    messages.forEach((m: any) => agentSet.add(m.from))

    for (const agent of agentSet) {
      const presence = presences.find((p: any) => p.agent === agent)
      const agentTasks = tasks.filter((t: any) => t.assignee === agent && t.status === 'doing')
      const agentMessages = messages.filter((m: any) => m.from === agent)

      const lastSeen = presence?.lastUpdate || 0
      const minutesSinceLastSeen = Math.floor((now - lastSeen) / 1000 / 60)

      // Count messages in last 24h
      const oneDayAgo = now - (24 * 60 * 60 * 1000)
      const messageCount24h = agentMessages.filter((m: any) => m.timestamp > oneDayAgo).length

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

      agentStatuses.push({
        agent,
        status,
        lastSeen,
        minutesSinceLastSeen,
        currentTask: agentTasks[0]?.title,
        recentBlockers,
        messageCount24h,
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
      const content = msg.content.toLowerCase()

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
          const context = msg.content.substring(start, end).trim()
          blockers.push(context)
          break // Only one blocker per message
        }
      }
    }

    return blockers
  }

  /**
   * Detect overlapping work (agents working on similar things)
   */
  private async detectOverlaps(): Promise<OverlapAlert[]> {
    const tasks = taskManager.listTasks({ status: 'doing' })
    const overlaps: OverlapAlert[] = []

    // Group tasks by keyword similarity
    const tasksByKeywords = new Map<string, string[]>()

    for (const task of tasks) {
      if (!task.assignee) continue

      const keywords = this.extractKeywords(task.title + ' ' + (task.description || ''))

      for (const keyword of keywords) {
        if (!tasksByKeywords.has(keyword)) {
          tasksByKeywords.set(keyword, [])
        }
        tasksByKeywords.get(keyword)!.push(task.assignee)
      }
    }

    // Find overlaps
    for (const [topic, agents] of tasksByKeywords) {
      const uniqueAgents = Array.from(new Set(agents))

      if (uniqueAgents.length >= 2) {
        overlaps.push({
          agents: uniqueAgents,
          topic,
          confidence: uniqueAgents.length >= 3 ? 'high' : 'medium',
        })
      }
    }

    return overlaps
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'])

    return text
      .toLowerCase()
      .split(/\W+/)
      .filter(word => word.length > 3 && !stopWords.has(word))
      .slice(0, 5) // Top 5 keywords
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

  private async logWatchdogIncident(entry: Record<string, unknown>): Promise<void> {
    const path = process.env.WATCHDOG_INCIDENT_LOG
      || resolve(process.cwd(), 'incidents/watchdog-incidents.jsonl')
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
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
        const content = `@kai @link @pixel system watchdog: no #general update from trio for ${trioSilenceMin}m (threshold ${this.cadenceSilenceMin}m). Post status now using 1) shipped 2) blocker 3) next+ETA.`
        alerts.push(content)

        if (!dryRun) {
          await chatManager.sendMessage({ from: 'system', channel: 'general', content })
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

    const trioSet = new Set(this.trioAgents)
    const doingByAgent = new Map<string, typeof tasks[number]>()

    for (const task of tasks) {
      if (task.status !== 'doing' || !task.assignee) continue
      const agent = (task.assignee || '').toLowerCase()
      if (!trioSet.has(agent as typeof this.trioAgents[number])) continue

      const current = doingByAgent.get(agent)
      const taskTs = Number(task.updatedAt || task.createdAt || 0)
      const currentTs = current ? Number(current.updatedAt || current.createdAt || 0) : 0
      if (!current || taskTs >= currentTs) {
        doingByAgent.set(agent, task)
      }
    }

    const workingTasks = Array.from(doingByAgent.values())

    for (const task of workingTasks) {
      const agent = (task.assignee || '').toLowerCase()
      let lastAt = 0
      for (const m of messages) {
        if ((m.from || '').toLowerCase() !== agent) continue
        if ((m.channel || 'general') !== 'general') continue
        const ts = Number(m.timestamp || 0)
        if (ts > lastAt) lastAt = ts
      }
      const staleMin = lastAt > 0 ? Math.floor((now - lastAt) / 60_000) : 9999

      if (staleMin < this.cadenceWorkingStaleMin) continue

      const key = `stale_working:${agent}:${task.id}`
      if (!this.shouldEmitCadenceAlert(key, now)) continue

      const content = `@${agent} @kai @pixel system watchdog: status=working with no #general update for ${staleMin}m on ${task.id}. Post required status now: 1) shipped 2) blocker 3) next+ETA.`
      alerts.push(content)

      if (!dryRun) {
        await chatManager.sendMessage({ from: 'system', channel: 'general', content })
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

    for (const mention of mentions) {
      const mentionId = String(mention.id || mention.timestamp || '')
      if (!mentionId) continue

      const mentionAt = Number(mention.timestamp || 0)
      if (!mentionAt || now - mentionAt < delayMs) continue

      const replied = messages.some((m: any) => {
        const from = (m.from || '').toLowerCase()
        if (!trioSet.has(from as typeof this.trioAgents[number])) return false
        const ts = Number(m.timestamp || 0)
        return ts > mentionAt
      })

      if (replied) continue

      const lastRescueAt = this.mentionRescueState.get(mentionId) || 0
      if (now - lastRescueAt < cooldownMs) continue

      const content = `[[reply_to:${mentionId}]] system fallback: mention received. @kai @link @pixel are being nudged to respond.`
      rescued.push(content)

      if (!dryRun) {
        await chatManager.sendMessage({ from: 'system', channel: 'general', content })
        this.mentionRescueState.set(mentionId, now)
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
    const messages = chatManager.getMessages({ limit: 300 })

    for (const presence of presences) {
      const agent = (presence.agent || '').toLowerCase()
      if (!agent) continue

      const lastActiveAt = presence.last_active || presence.lastUpdate || 0
      const inactivityMin = lastActiveAt ? Math.floor((now - lastActiveAt) / 60_000) : 0
      const tier: 1 | 2 = inactivityMin >= this.idleNudgeEscalateMin ? 2 : 1
      const activeTask = tasks.find((t) => t.assignee === agent && t.status === 'doing')
      const taskId = activeTask?.id || null

      const baseDecision: Omit<IdleNudgeDecision, 'reason' | 'decision' | 'renderedMessage'> = {
        agent,
        taskId,
        idleMinutes: inactivityMin,
        warnMin: this.idleNudgeWarnMin,
        escalateMin: this.idleNudgeEscalateMin,
        cooldownMin: this.idleNudgeCooldownMin,
        recentSuppressMin: this.idleNudgeSuppressRecentMin,
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

      if (presence.status === 'offline') {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'offline', renderedMessage: null })
        continue
      }

      if (!lastActiveAt) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'no-last-active', renderedMessage: null })
        continue
      }

      if (inactivityMin < this.idleNudgeWarnMin) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'below-warn-threshold', renderedMessage: null })
        continue
      }

      const lastAgentMessage = messages.find((m: any) => (m.from || '').toLowerCase() === agent)
      if (lastAgentMessage?.timestamp) {
        const sinceLastMessageMin = Math.floor((now - lastAgentMessage.timestamp) / 60_000)
        if (sinceLastMessageMin < this.idleNudgeSuppressRecentMin) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'recent-activity-suppressed', renderedMessage: null })
          continue
        }
      }

      const state = this.idleNudgeState.get(agent)
      if (state) {
        const sinceNudgeMin = Math.floor((now - state.lastNudgeAt) / 60_000)
        if (sinceNudgeMin < this.idleNudgeCooldownMin && state.lastTier >= tier) {
          decisions.push({ ...baseDecision, decision: 'none', reason: 'cooldown-active', renderedMessage: null })
          continue
        }
      }

      // Safety guard: never emit invalid placeholder task ids.
      if (!taskId || !/^task-[a-z0-9-]+$/i.test(taskId)) {
        decisions.push({ ...baseDecision, decision: 'none', reason: 'missing-active-task', renderedMessage: null })
        continue
      }

      const intro = tier === 1
        ? `@${agent} system reminder: you appear idle for ${inactivityMin}m. Post a quick status update now.`
        : `@${agent} @kai system escalation: ${inactivityMin}m idle. Post required status format now.`

      const template = [
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

      await chatManager.sendMessage({
        from: 'system',
        channel: 'general',
        content: renderedMessage,
      })

      this.idleNudgeState.set(agent, {
        lastNudgeAt: now,
        lastTier: tier,
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
      excluded: string[]
    }
    state: Array<{ agent: string; lastNudgeAt: number; lastTier: 1 | 2 }>
    lastDecisions: IdleNudgeDecision[]
    timestamp: number
  } {
    return {
      config: {
        enabled: this.idleNudgeEnabled,
        warnMin: this.idleNudgeWarnMin,
        escalateMin: this.idleNudgeEscalateMin,
        cooldownMin: this.idleNudgeCooldownMin,
        recentSuppressMin: this.idleNudgeSuppressRecentMin,
        excluded: Array.from(this.idleNudgeExcluded.values()).sort(),
      },
      state: Array.from(this.idleNudgeState.entries()).map(([agent, s]) => ({
        agent,
        lastNudgeAt: s.lastNudgeAt,
        lastTier: s.lastTier,
      })),
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
