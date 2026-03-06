// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Team Pulse — Single canonical snapshot of team state.
 *
 * Replaces ad-hoc "status NOW" pings in chat. One endpoint,
 * everything a team lead needs to know at a glance.
 *
 * GET /pulse          — full snapshot
 * GET /pulse?compact=true — <2000 chars, optimized for heartbeat context
 */

import { taskManager } from './tasks.js'
import { presenceManager } from './presence.js'
import { chatManager } from './chat.js'
import { getFocusSummary } from './focus.js'
import { getBuildInfo } from './buildInfo.js'
import { getPreflightMetrics } from './alert-preflight.js'
import type { Task } from './types.js'

export interface PulseAgent {
  agent: string
  status: string
  doingTask?: { id: string; title: string; priority?: string } | null
  lastActive?: number
}

export interface PulseSnapshot {
  ts: number
  deploy?: { version?: string; commit?: string; pid?: number; startedAt?: number; uptimeS?: number }
  alertPreflight?: { mode: string; totalChecked: number; suppressed: number; canaryFlagged: number }
  focus?: { focus: string; setBy: string; setAt: number } | null
  board: { todo: number; doing: number; validating: number; done: number; blocked: number }
  agents: PulseAgent[]
  pendingReviews: Array<{ taskId: string; title: string; reviewer: string }>
  recentActivity?: { messagesLastHour: number; tasksCompletedToday: number }
}

export interface CompactPulse {
  ts: number
  deploy?: string  // e.g. "a481ec9 up:2h34m v0.1.5"
  alertPreflight?: string  // e.g. "enforce checked:1 suppressed:1"
  focus?: string | null
  board: string  // e.g. "T:3 D:2 V:1 ✓:5 B:0"
  agents: string[] // e.g. ["link:working→task-123(activity endpoint)", "pixel:working→task-456(UI scaffold)"]
  reviews: string[] // e.g. ["task-789→sage"]
}

function getDeployInfo(): PulseSnapshot['deploy'] {
  try {
    const info = getBuildInfo()
    const startedAtMs = info.startedAtMs
    const uptimeS = startedAtMs ? Math.round((Date.now() - startedAtMs) / 1000) : undefined
    return {
      version: info.appVersion || process.env.npm_package_version,
      commit: info.gitShortSha || info.gitSha,
      pid: process.pid,
      startedAt: startedAtMs,
      uptimeS,
    }
  } catch {
    return { pid: process.pid }
  }
}

function getAlertPreflightSummary(): PulseSnapshot['alertPreflight'] {
  try {
    const m = getPreflightMetrics()
    return {
      mode: m.mode,
      totalChecked: m.totalChecked,
      suppressed: m.suppressed,
      canaryFlagged: m.canaryFlagged,
    }
  } catch {
    return undefined
  }
}

export function generatePulse(): PulseSnapshot {
  const allTasks = taskManager.listTasks({})
  const todoCount = allTasks.filter(t => t.status === 'todo').length
  const doingCount = allTasks.filter(t => t.status === 'doing').length
  const validatingCount = allTasks.filter(t => t.status === 'validating').length
  const doneCount = allTasks.filter(t => t.status === 'done').length
  const blockedCount = allTasks.filter(t => t.status === 'blocked').length

  const doingTasks = allTasks.filter(t => t.status === 'doing')
  const validatingTasks = allTasks.filter(t => t.status === 'validating')

  // Build per-agent state
  const presences = presenceManager.getAllPresence()
  const agents: PulseAgent[] = presences.map(p => {
    const agentDoingTask = doingTasks.find(t =>
      (t.assignee || '').toLowerCase() === p.agent.toLowerCase()
    )
    return {
      agent: p.agent,
      status: p.status || 'unknown',
      doingTask: agentDoingTask ? {
        id: agentDoingTask.id,
        title: agentDoingTask.title,
        priority: agentDoingTask.priority,
      } : null,
      lastActive: p.last_active || p.lastUpdate,
    }
  })

  // Pending reviews
  const pendingReviews = validatingTasks
    .filter(t => t.reviewer)
    .map(t => ({
      taskId: t.id,
      title: t.title,
      reviewer: t.reviewer!,
    }))

  // Recent activity counts
  const oneHourAgo = Date.now() - (60 * 60 * 1000)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const recentMessages = chatManager.getMessages({ since: oneHourAgo })
  const tasksCompletedToday = allTasks.filter(t =>
    t.status === 'done' && (t.updatedAt || 0) >= todayStart.getTime()
  ).length

  return {
    ts: Date.now(),
    deploy: getDeployInfo(),
    alertPreflight: getAlertPreflightSummary(),
    focus: getFocusSummary(),
    board: { todo: todoCount, doing: doingCount, validating: validatingCount, done: doneCount, blocked: blockedCount },
    agents,
    pendingReviews,
    recentActivity: {
      messagesLastHour: recentMessages.length,
      tasksCompletedToday,
    },
  }
}

export function generateCompactPulse(): CompactPulse {
  const pulse = generatePulse()

  // Deploy summary
  const d = pulse.deploy
  let deployStr: string | undefined
  if (d) {
    const uptimeHrs = d.uptimeS ? `${Math.floor(d.uptimeS / 3600)}h${Math.floor((d.uptimeS % 3600) / 60)}m` : '?'
    deployStr = `${d.commit || '?'} up:${uptimeHrs} v${d.version || '?'}`
  }

  // Alert-preflight summary
  const ap = pulse.alertPreflight
  let apStr: string | undefined
  if (ap) {
    apStr = `${ap.mode} checked:${ap.totalChecked} suppressed:${ap.suppressed}`
    if (ap.mode === 'canary' && ap.canaryFlagged > 0) {
      apStr += ` flagged:${ap.canaryFlagged}`
    }
  }

  const boardStr = `T:${pulse.board.todo} D:${pulse.board.doing} V:${pulse.board.validating} ✓:${pulse.board.done} B:${pulse.board.blocked}`

  const agentStrs = pulse.agents
    .filter(a => a.status !== 'offline' && a.agent !== 'user')
    .map(a => {
      const taskInfo = a.doingTask
        ? `→${a.doingTask.id.slice(-12)}(${(a.doingTask.title || '').slice(0, 30)})`
        : '→idle'
      return `${a.agent}:${a.status}${taskInfo}`
    })

  const reviewStrs = pulse.pendingReviews.map(r =>
    `${r.taskId.slice(-12)}→${r.reviewer}`
  )

  return {
    ts: pulse.ts,
    deploy: deployStr,
    alertPreflight: apStr,
    focus: pulse.focus?.focus || null,
    board: boardStr,
    agents: agentStrs,
    reviews: reviewStrs,
  }
}
