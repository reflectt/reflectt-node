// SPDX-License-Identifier: Apache-2.0
// Team Pulse — Proactive periodic team status broadcast
//
// Addresses the trust gap: human confidence drops when autonomous activity
// isn't visibly progressing. Posts a structured status summary at regular
// intervals so stakeholders see real work without needing to ask.
//
// Frequency: configurable (default: every 2 hours during active hours)
// Channel: configurable (default: ops, with option for general)
// Content: per-agent lane status, recent ships, blockers, queue depth

import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import { routeMessage } from './messageRouter.js'

// ── Types ──

export interface TeamPulseConfig {
  enabled: boolean
  /** Interval between pulses in minutes */
  intervalMin: number
  /** Channel to post pulse to */
  channel: string
  /** Active hours (24h format): only post during these hours */
  activeHoursStart: number
  activeHoursEnd: number
  /** Agents to include in pulse */
  agents: string[]
  /** Minimum doing/todo tasks to suppress "idle team" warnings */
  minActiveThreshold: number
}

export interface AgentPulseStatus {
  agent: string
  doingCount: number
  doingTitles: string[]
  todoCount: number
  recentShips: number // tasks moved to done in last pulse interval
  lastActivity: number | null // timestamp of most recent task update
  status: 'active' | 'idle' | 'blocked'
}

export interface TeamPulseSnapshot {
  timestamp: number
  agents: AgentPulseStatus[]
  totalDoing: number
  totalTodo: number
  totalRecentShips: number
  teamStatus: 'healthy' | 'slow' | 'stalled'
  queueDepth: number
}

// ── State ──

let config: TeamPulseConfig = {
  enabled: true,
  intervalMin: 120, // 2 hours
  channel: 'ops',
  activeHoursStart: 8,
  activeHoursEnd: 22,
  agents: ['link', 'sage', 'kai', 'pixel', 'echo', 'scout', 'harmony'],
  minActiveThreshold: 2,
}

let timer: ReturnType<typeof setInterval> | null = null
let lastPulseAt = 0
let pulseHistory: TeamPulseSnapshot[] = []
const MAX_PULSE_HISTORY = 48 // 4 days at 2h intervals

// ── Config ──

export function configureTeamPulse(partial: Partial<TeamPulseConfig>): void {
  config = { ...config, ...partial }
}

export function getTeamPulseConfig(): TeamPulseConfig {
  return { ...config }
}

// ── Core ──

/**
 * Compute the current team pulse snapshot.
 */
export function computeTeamPulse(now = Date.now()): TeamPulseSnapshot {
  const windowMs = config.intervalMin * 60_000
  const since = now - windowMs

  const agentStatuses: AgentPulseStatus[] = config.agents.map(agent => {
    const doingTasks = taskManager.listTasks({ status: 'doing', assignee: agent })
    const todoTasks = taskManager.listTasks({ status: 'todo', assignee: agent })

    // Count tasks that moved to done within the pulse window
    const allTasks = taskManager.listTasks({ assignee: agent })
    const recentShips = allTasks.filter(t =>
      t.status === 'done' && t.updatedAt >= since
    ).length

    // Most recent task activity
    const allAgentTasks = [...doingTasks, ...todoTasks, ...allTasks]
    const lastActivity = allAgentTasks.length > 0
      ? Math.max(...allAgentTasks.map(t => t.updatedAt))
      : null

    // Determine status
    let status: AgentPulseStatus['status'] = 'idle'
    if (doingTasks.length > 0) {
      status = 'active'
    }
    // Check for blocked
    const blockedTasks = doingTasks.filter(t =>
      t.status === 'doing' && lastActivity && (now - lastActivity > 2 * 60 * 60_000)
    )
    if (blockedTasks.length > 0 && doingTasks.length > 0) {
      status = 'blocked'
    }

    return {
      agent,
      doingCount: doingTasks.length,
      doingTitles: doingTasks.slice(0, 3).map(t => t.title.slice(0, 60)),
      todoCount: todoTasks.length,
      recentShips,
      lastActivity,
      status,
    }
  })

  const totalDoing = agentStatuses.reduce((sum, a) => sum + a.doingCount, 0)
  const totalTodo = agentStatuses.reduce((sum, a) => sum + a.todoCount, 0)
  const totalRecentShips = agentStatuses.reduce((sum, a) => sum + a.recentShips, 0)
  const activeAgents = agentStatuses.filter(a => a.status === 'active').length

  let teamStatus: TeamPulseSnapshot['teamStatus'] = 'healthy'
  if (totalDoing === 0 && totalTodo === 0) {
    teamStatus = 'stalled'
  } else if (activeAgents < config.minActiveThreshold) {
    teamStatus = 'slow'
  }

  return {
    timestamp: now,
    agents: agentStatuses,
    totalDoing,
    totalTodo,
    totalRecentShips,
    teamStatus,
    queueDepth: totalTodo,
  }
}

/**
 * Format a pulse snapshot into a readable message.
 */
export function formatPulseMessage(pulse: TeamPulseSnapshot): string {
  const statusEmoji = pulse.teamStatus === 'healthy' ? '🟢' : pulse.teamStatus === 'slow' ? '🟡' : '🔴'
  const lines: string[] = []

  lines.push(`${statusEmoji} **Team Pulse** — ${pulse.totalDoing} active, ${pulse.totalTodo} queued, ${pulse.totalRecentShips} shipped recently`)
  lines.push('')

  for (const agent of pulse.agents) {
    if (agent.doingCount === 0 && agent.todoCount === 0 && agent.recentShips === 0) continue

    const statusIcon = agent.status === 'active' ? '🔵' : agent.status === 'blocked' ? '🔴' : '⚪'
    const doing = agent.doingCount > 0 ? agent.doingTitles.map(t => `_${t}_`).join(', ') : 'idle'
    lines.push(`${statusIcon} **${agent.agent}**: ${doing} (${agent.todoCount} queued, ${agent.recentShips} shipped)`)
  }

  if (pulse.teamStatus === 'stalled') {
    lines.push('')
    lines.push('⚠️ No active or queued work detected.')
  }

  return lines.join('\n')
}

/**
 * Post a team pulse to the configured channel.
 */
export async function postTeamPulse(now = Date.now()): Promise<TeamPulseSnapshot> {
  const pulse = computeTeamPulse(now)
  const message = formatPulseMessage(pulse)

  await routeMessage({
    from: 'system',
    content: message,
    category: 'status-update',
    severity: pulse.teamStatus === 'stalled' ? 'warning' : 'info',
    forceChannel: config.channel,
  })

  lastPulseAt = now
  pulseHistory.push(pulse)
  if (pulseHistory.length > MAX_PULSE_HISTORY) {
    pulseHistory.splice(0, pulseHistory.length - MAX_PULSE_HISTORY)
  }

  return pulse
}

// ── Lifecycle ──

function isActiveHours(now = Date.now()): boolean {
  const hour = new Date(now).getHours()
  return hour >= config.activeHoursStart && hour < config.activeHoursEnd
}

export function startTeamPulse(): void {
  if (!config.enabled) return
  if (timer) return

  const checkIntervalMs = 5 * 60_000 // Check every 5 minutes
  timer = setInterval(() => {
    if (!isActiveHours()) return
    const now = Date.now()
    const intervalMs = config.intervalMin * 60_000
    if (now - lastPulseAt >= intervalMs) {
      void postTeamPulse(now).catch(err => {
        console.error('[TeamPulse] Failed to post pulse:', err)
      })
    }
  }, checkIntervalMs)
  timer.unref()

  console.log(`[TeamPulse] Started (every ${config.intervalMin}m, ${config.activeHoursStart}-${config.activeHoursEnd}h)`)
}

export function stopTeamPulse(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function getTeamPulseHistory(): TeamPulseSnapshot[] {
  return [...pulseHistory]
}

export function getLastPulseAt(): number {
  return lastPulseAt
}

// ── Test helpers ──

export function _resetTeamPulse(): void {
  lastPulseAt = 0
  pulseHistory = []
}
