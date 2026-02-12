/**
 * Team Health Monitoring
 *
 * Real-time team health diagnostics:
 * - Silence detection (>3 heartbeats = ~45min)
 * - Blocker tracking from messages
 * - Overlapping work detection
 * - Collaboration compliance (protocol v1)
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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
    const last = messages.find((m: any) => {
      if ((m.from || '').toLowerCase() !== agent) return false
      if ((m.channel || 'general') !== 'general') return false
      const content = typeof m.content === 'string' ? m.content : ''

      const hasTask = /\btask-[a-z0-9-]+\b/i.test(content)
      const hasFormat = /1\)\s*(?:\*\*)?\s*shipped\s*(?:\*\*)?\s*:/i.test(content)
        && /2\)\s*(?:\*\*)?\s*blocker\s*(?:\*\*)?\s*:/i.test(content)
        && /3\)\s*(?:\*\*)?\s*next\s*(?:\*\*)?\s*:/i.test(content)

      return hasTask && hasFormat
    })

    return last?.timestamp || null
  }

  private findLastTrioGeneralUpdate(messages: any[]): number {
    const trioSet = new Set(this.trioAgents)
    const last = messages.find((m: any) => {
      const from = (m.from || '').toLowerCase()
      const channel = (m.channel || 'general')
      return trioSet.has(from as typeof this.trioAgents[number]) && channel === 'general'
    })

    return last?.timestamp || Date.now()
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
