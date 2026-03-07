// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Activation Funnel Events — 6 lifecycle hooks for measuring
 * signup-to-value conversion at launch.
 *
 * Events:
 *   1. signup_completed     — User account created and verified
 *   2. workspace_ready      — Org + team + first host connected
 *   3. first_task_started   — First task moved to "doing"
 *   4. first_task_completed — First task moved to "done"
 *   5. first_team_message_sent — First chat message sent by a human user
 *   6. day2_return_action   — Any meaningful action ≥24h after signup
 *
 * Each event is recorded once per userId (idempotent).
 * Events are persisted to a JSONL audit file and queryable via
 * GET /activation/funnel.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getAgentRoles } from './assignment.js'

const DATA_DIR = process.env.REFLECTT_DATA_DIR || path.join(process.cwd(), 'data')
const FUNNEL_FILE = path.join(DATA_DIR, 'activation-funnel.jsonl')

/* ─── Types ─── */

export type ActivationEventType =
  | 'signup_completed'
  | 'host_preflight_passed'
  | 'host_preflight_failed'
  | 'workspace_ready'
  | 'first_task_started'
  | 'first_task_completed'
  | 'first_team_message_sent'
  | 'day2_return_action'

export interface ActivationEvent {
  type: ActivationEventType
  userId: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface UserFunnelState {
  userId: string
  events: Record<ActivationEventType, number | null> // timestamp or null
  currentStep: number   // 0-6, how far through the funnel
  completedAt: number | null // timestamp when all 6 completed
  /** Data-quality flags (e.g. out-of-order timestamps, missing prereqs, pass+fail) */
  flags?: string[]
  /** Whether the user is considered valid for aggregate funnel telemetry */
  validForAggregation?: boolean
}

/* ─── In-memory state ─── */

/** userId → { eventType → timestamp } */
const userFunnels = new Map<string, Map<ActivationEventType, number>>()

/** Ordered event log (also persisted) */
const eventLog: ActivationEvent[] = []
const MAX_LOG_SIZE = 10_000

const FUNNEL_ORDER: ActivationEventType[] = [
  'signup_completed',
  'host_preflight_passed',
  // Note: host_preflight_failed is tracked in the event log but is NOT a
  // forward funnel step — failure doesn't represent onboarding progress.
  'workspace_ready',
  'first_task_started',
  'first_task_completed',
  'first_team_message_sent',
  'day2_return_action',
]

// ── Cohort filtering + data quality ─────────────────────────────────

function isExcludedUserId(userId: string): boolean {
  if (!userId) return true
  const lower = userId.toLowerCase()
  if (lower === 'system') return true
  if (lower.startsWith('agent-')) return true
  if (lower.startsWith('test-') || lower.startsWith('proof-') || lower.startsWith('lane-')) return true

  // Exclude known agent ids/aliases from TEAM-ROLES.yaml (e.g. rhythm, link, kai)
  try {
    const roles = getAgentRoles()
    for (const r of roles) {
      if (r.name === userId) return true
      if (Array.isArray(r.aliases) && r.aliases.includes(userId)) return true
      if (typeof r.displayName === 'string' && r.displayName === userId) return true
    }
  } catch {
    // ignore role-load issues; do not block telemetry
  }

  return false
}

function getUserFunnelFlags(userMap: Map<ActivationEventType, number>): string[] {
  const flags: string[] = []

  // Mutually exclusive outcomes (preflight pass + fail)
  if (userMap.has('host_preflight_passed') && userMap.has('host_preflight_failed')) {
    flags.push('preflight_both_pass_and_fail')
  }

  // Missing prerequisites and timestamp ordering problems
  for (let i = 1; i < FUNNEL_ORDER.length; i++) {
    const prev = FUNNEL_ORDER[i - 1]
    const step = FUNNEL_ORDER[i]
    const prevTs = userMap.get(prev)
    const thisTs = userMap.get(step)

    if (thisTs !== undefined && prevTs === undefined) {
      flags.push(`missing_prereq:${step}`)
    }

    if (prevTs !== undefined && thisTs !== undefined && thisTs < prevTs) {
      flags.push(`out_of_order:${prev}->${step}`)
    }
  }

  return flags
}

function hasOrderedPath(userMap: Map<ActivationEventType, number>, stepIndex: number): boolean {
  // stepIndex is index into FUNNEL_ORDER
  let lastTs: number | null = null
  for (let i = 0; i <= stepIndex; i++) {
    const step = FUNNEL_ORDER[i]
    const ts = userMap.get(step)
    if (ts === undefined) return false
    if (lastTs !== null && ts < lastTs) return false
    lastTs = ts
  }
  return true
}

/* ─── Core API ─── */

/**
 * Emit an activation event. Idempotent per (userId, type).
 * Returns true if this was the first time the event fired for this user.
 */
export async function emitActivationEvent(
  type: ActivationEventType,
  userId: string,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  if (!userId) return false

  let userMap = userFunnels.get(userId)
  if (!userMap) {
    userMap = new Map()
    userFunnels.set(userId, userMap)
  }

  // Idempotent: skip if already recorded
  if (userMap.has(type)) return false

  // Warn at ingestion time if host_preflight_failed arrives without structured metadata.
  // This means the caller is not providing failed_checks/first_blocker, which makes
  // failure reason analysis impossible. The emitter (preflight.ts) always provides these,
  // so a null here signals a non-standard code path.
  if (type === 'host_preflight_failed' && (!metadata || (!metadata.failed_checks && !metadata.first_blocker))) {
    console.warn(
      `[ActivationFunnel] host_preflight_failed for userId=${userId} has no failed_checks or first_blocker metadata. ` +
      `Failure reason will appear as "unspecified" in the funnel. Emit metadata.failed_checks=[...] and metadata.first_blocker=<checkId>.`
    )
  }

  const timestamp = Date.now()
  userMap.set(type, timestamp)

  const event: ActivationEvent = { type, userId, timestamp, metadata }
  eventLog.push(event)
  if (eventLog.length > MAX_LOG_SIZE) {
    eventLog.splice(0, eventLog.length - MAX_LOG_SIZE)
  }

  // Persist (best-effort)
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.appendFile(FUNNEL_FILE, JSON.stringify(event) + '\n', 'utf-8')
  } catch (err) {
    console.error('[ActivationFunnel] Failed to persist event:', err)
  }

  return true
}

/**
 * Get funnel state for a specific user.
 */
export function getUserFunnelState(userId: string): UserFunnelState {
  const userMap = userFunnels.get(userId)

  const events: Record<ActivationEventType, number | null> = {
    signup_completed: null,
    host_preflight_passed: null,
    host_preflight_failed: null,
    workspace_ready: null,
    first_task_started: null,
    first_task_completed: null,
    first_team_message_sent: null,
    day2_return_action: null,
  }

  let currentStep = 0

  if (userMap) {
    for (const type of FUNNEL_ORDER) {
      const ts = userMap.get(type)
      if (ts !== undefined) {
        events[type] = ts
        currentStep++
      }
    }
    // Populate tracked-but-not-funnel events (e.g. host_preflight_failed)
    for (const [type, ts] of userMap) {
      if (!FUNNEL_ORDER.includes(type) && events[type] === null) {
        events[type] = ts
      }
    }
  }

  const allDone = currentStep === FUNNEL_ORDER.length
  const completedAt = allDone
    ? Math.max(...Object.values(events).filter((v): v is number => v !== null))
    : null

  const flags = userMap ? getUserFunnelFlags(userMap) : []

  return {
    userId,
    events,
    currentStep,
    completedAt,
    flags,
    validForAggregation: !!userMap && flags.length === 0 && !isExcludedUserId(userId),
  }
}

/**
 * Get funnel summary across all users.
 */
export function getFunnelSummary(): {
  totalUsers: number
  stepCounts: Record<ActivationEventType, number>
  completedUsers: number
  funnelByUser: UserFunnelState[]
} {
  const stepCounts: Record<ActivationEventType, number> = {
    signup_completed: 0,
    host_preflight_passed: 0,
    host_preflight_failed: 0,
    workspace_ready: 0,
    first_task_started: 0,
    first_task_completed: 0,
    first_team_message_sent: 0,
    day2_return_action: 0,
  }

  const funnelByUser: UserFunnelState[] = []
  let completedUsers = 0

  let totalUsers = 0

  for (const userId of userFunnels.keys()) {
    if (isExcludedUserId(userId)) continue
    totalUsers++

    const state = getUserFunnelState(userId)
    funnelByUser.push(state)

    for (const type of FUNNEL_ORDER) {
      if (state.events[type] !== null) {
        stepCounts[type]++
      }
    }

    if (state.completedAt !== null) completedUsers++
  }

  return {
    totalUsers,
    stepCounts,
    completedUsers,
    funnelByUser,
  }
}

/**
 * Check if a user has completed a specific event.
 */
export function hasCompletedEvent(userId: string, type: ActivationEventType): boolean {
  return userFunnels.get(userId)?.has(type) ?? false
}

/**
 * Get the signup timestamp for a user (for day2 calculation).
 */
export function getSignupTimestamp(userId: string): number | null {
  return userFunnels.get(userId)?.get('signup_completed') ?? null
}

/**
 * Check if ≥24h have passed since signup (for day2_return_action eligibility).
 */
export function isDay2Eligible(userId: string): boolean {
  const signupTs = getSignupTimestamp(userId)
  if (!signupTs) return false
  return (Date.now() - signupTs) >= 24 * 60 * 60 * 1000
}

/**
 * Load persisted funnel events from disk on startup.
 */
export async function loadActivationFunnel(): Promise<number> {
  try {
    const data = await fs.readFile(FUNNEL_FILE, 'utf-8')
    const lines = data.split('\n').filter(l => l.trim())
    let loaded = 0

    for (const line of lines) {
      try {
        const event: ActivationEvent = JSON.parse(line)
        if (!event.type || !event.userId || !event.timestamp) continue

        let userMap = userFunnels.get(event.userId)
        if (!userMap) {
          userMap = new Map()
          userFunnels.set(event.userId, userMap)
        }

        // Only keep the first occurrence
        if (!userMap.has(event.type)) {
          userMap.set(event.type, event.timestamp)
        }

        eventLog.push(event)
        loaded++
      } catch {
        // Skip malformed lines
      }
    }

    if (eventLog.length > MAX_LOG_SIZE) {
      eventLog.splice(0, eventLog.length - MAX_LOG_SIZE)
    }

    return loaded
  } catch (err: any) {
    if (err?.code === 'ENOENT') return 0
    console.error('[ActivationFunnel] Failed to load funnel data:', err)
    return 0
  }
}

// ── Dashboard / Telemetry Functions ──

export interface StepConversion {
  step: ActivationEventType
  reached: number
  /** Conversion rate from previous step (0-1). First step = 1.0 if any users. */
  conversionRate: number
  /** Median time (ms) from previous step to this step, or null if N/A */
  medianTimeMs: number | null
}

export interface FailureDistribution {
  step: ActivationEventType
  /** Users who reached the previous step but NOT this one */
  droppedCount: number
  /** Breakdown of failure reasons from event metadata */
  reasons: Array<{ reason: string; count: number }>
}

export interface WeeklyTrend {
  weekStart: string   // ISO date (Monday)
  weekEnd: string     // ISO date (Sunday)
  newUsers: number
  completedUsers: number
  stepCounts: Record<ActivationEventType, number>
  conversionRate: number // signup → completed
}

/**
 * Get step-by-step conversion funnel with rates and timing.
 */
export function getConversionFunnel(): StepConversion[] {
  const conversions: StepConversion[] = []

  // Cohort: exclude system/test/agent users; exclude invalid sequences/outcomes.
  const cohort = Array.from(userFunnels.entries())
    .filter(([userId]) => !isExcludedUserId(userId))
    .map(([userId, userMap]) => ({ userId, userMap, flags: getUserFunnelFlags(userMap) }))
    .filter(u => u.flags.length === 0)

  let prevReached = cohort.length // denominator for first step

  for (let i = 0; i < FUNNEL_ORDER.length; i++) {
    const step = FUNNEL_ORDER[i]

    // Reached = users with an ordered path through this step (all prior steps present and monotonic).
    let reached = 0
    for (const u of cohort) {
      if (hasOrderedPath(u.userMap, i)) reached++
    }

    // Compute median time from previous step, only for users that reached this step via ordered path.
    let medianTimeMs: number | null = null
    if (i > 0) {
      const prevStep = FUNNEL_ORDER[i - 1]
      const deltas: number[] = []
      for (const u of cohort) {
        if (!hasOrderedPath(u.userMap, i)) continue
        const prevTs = u.userMap.get(prevStep)
        const thisTs = u.userMap.get(step)
        if (prevTs !== undefined && thisTs !== undefined) {
          const d = thisTs - prevTs
          if (d >= 0) deltas.push(d)
        }
      }
      if (deltas.length > 0) {
        deltas.sort((a, b) => a - b)
        medianTimeMs = deltas[Math.floor(deltas.length / 2)]
      }
    }

    conversions.push({
      step,
      reached,
      conversionRate: prevReached > 0 ? reached / prevReached : 0,
      medianTimeMs,
    })

    prevReached = reached
  }

  return conversions
}

/**
 * Get failure-reason distribution per step.
 * Looks at event metadata for `failed_checks`, `first_blocker`, `error`, etc.
 */
export function getFailureDistribution(): FailureDistribution[] {
  const distribution: FailureDistribution[] = []

  const cohort = Array.from(userFunnels.entries())
    .filter(([userId]) => !isExcludedUserId(userId))
    .map(([userId, userMap]) => ({ userId, userMap, flags: getUserFunnelFlags(userMap) }))
    .filter(u => u.flags.length === 0)

  for (let i = 0; i < FUNNEL_ORDER.length; i++) {
    const step = FUNNEL_ORDER[i]
    const prevStep = i > 0 ? FUNNEL_ORDER[i - 1] : null

    // Count users who reached prev step (ordered path) but not this one.
    let droppedCount = 0
    const reasonCounts = new Map<string, number>()

    for (const u of cohort) {
      const reachedPrev = prevStep === null ? true : hasOrderedPath(u.userMap, i - 1)
      const reachedThis = hasOrderedPath(u.userMap, i)

      if (reachedPrev && !reachedThis) {
        droppedCount++

        // Preflight failures: use host_preflight_failed metadata (failed_checks/first_blocker).
        // If no host_preflight_failed event exists, the user never attempted preflight.
        if (step === 'host_preflight_passed') {
          const failEvent = eventLog.find(e => e.userId === u.userId && e.type === 'host_preflight_failed')
          if (!failEvent) {
            // User reached signup but never ran preflight — distinct from a failed run
            reasonCounts.set('no_preflight_run', (reasonCounts.get('no_preflight_run') || 0) + 1)
          } else {
            const meta = failEvent.metadata
            if (meta) {
              const fc: unknown = (meta as any).failed_checks
              if (Array.isArray(fc) && fc.length > 0) {
                for (const check of fc) {
                  const reason = String(check)
                  reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
                }
              } else if (typeof fc === 'string' && fc) {
                const reason = fc
                reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
              } else if ((meta as any).first_blocker) {
                const reason = String((meta as any).first_blocker)
                reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
              } else if ((meta as any).error) {
                const reason = String((meta as any).error)
                reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
              }
              // metadata present but no extractable reason: falls through to unspecified
            }
            // metadata null/undefined: falls through to unspecified
          }
        }

        // Workspace-ready drops: we don't have a dedicated failure event type yet.
        // Provide an actionable bucket instead of leaving everything "unspecified".
        if (step === 'workspace_ready') {
          reasonCounts.set('workspace_ready_not_emitted', (reasonCounts.get('workspace_ready_not_emitted') || 0) + 1)
        }

        // Generic: check for explicit failure metadata on any events for this user.
        const stepFailEvents = eventLog.filter(
          e => e.userId === u.userId && (e.metadata as any)?.failedAt === step
        )
        for (const fe of stepFailEvents) {
          const reason = String((fe.metadata as any)?.reason || 'unknown')
          reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
        }
      }
    }

    const reasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)

    // Add "unspecified" for drops without metadata
    const specifiedDrops = reasons.reduce((sum, r) => sum + r.count, 0)
    if (droppedCount > specifiedDrops) {
      reasons.push({ reason: 'unspecified', count: droppedCount - specifiedDrops })
    }

    distribution.push({ step, droppedCount, reasons })
  }

  return distribution
}

/**
 * Get weekly trend snapshots for planning.
 * Groups events by ISO week (Monday–Sunday).
 */
export function getWeeklyTrends(weekCount = 12): WeeklyTrend[] {
  const now = Date.now()
  const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

  // Calculate week boundaries going back `weekCount` weeks
  const trends: WeeklyTrend[] = []

  // Find Monday of the current week as anchor
  const anchor = new Date(now)
  const anchorDay = anchor.getUTCDay()
  const anchorMondayOffset = anchorDay === 0 ? -6 : 1 - anchorDay
  anchor.setUTCDate(anchor.getUTCDate() + anchorMondayOffset)
  anchor.setUTCHours(0, 0, 0, 0)
  const currentMondayTs = anchor.getTime()

  for (let w = weekCount - 1; w >= 0; w--) {
    const mondayTs = currentMondayTs - w * MS_PER_WEEK
    const sundayTs = mondayTs + MS_PER_WEEK - 1

    const stepCounts: Record<ActivationEventType, number> = {
      signup_completed: 0,
      host_preflight_passed: 0,
      host_preflight_failed: 0,
      workspace_ready: 0,
      first_task_started: 0,
      first_task_completed: 0,
      first_team_message_sent: 0,
      day2_return_action: 0,
    }

    let newUsers = 0
    let completedUsers = 0

    // Count events in this week window
    for (const event of eventLog) {
      if (isExcludedUserId(event.userId)) continue
      if (event.timestamp >= mondayTs && event.timestamp <= sundayTs) {
        if (event.type in stepCounts) {
          stepCounts[event.type as ActivationEventType]++
        }
        if (event.type === 'signup_completed') newUsers++
        if (event.type === 'day2_return_action') completedUsers++
      }
    }

    trends.push({
      weekStart: new Date(mondayTs).toISOString().slice(0, 10),
      weekEnd: new Date(sundayTs).toISOString().slice(0, 10),
      newUsers,
      completedUsers,
      stepCounts,
      conversionRate: newUsers > 0 ? completedUsers / newUsers : 0,
    })
  }

  return trends
}

/**
 * Full onboarding telemetry dashboard snapshot.
 * Combines funnel, failure distribution, and trends.
 */
export function getOnboardingDashboard(opts?: { weeks?: number }) {
  return {
    timestamp: Date.now(),
    funnel: getConversionFunnel(),
    failures: getFailureDistribution(),
    trends: getWeeklyTrends(opts?.weeks || 12),
    summary: getFunnelSummary(),
  }
}

/**
 * Reset funnel state (for testing).
 */
export function resetActivationFunnel(): void {
  userFunnels.clear()
  eventLog.length = 0
}
