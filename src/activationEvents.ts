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

const DATA_DIR = process.env.REFLECTT_DATA_DIR || path.join(process.cwd(), 'data')
const FUNNEL_FILE = path.join(DATA_DIR, 'activation-funnel.jsonl')

/* ─── Types ─── */

export type ActivationEventType =
  | 'signup_completed'
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
}

/* ─── In-memory state ─── */

/** userId → { eventType → timestamp } */
const userFunnels = new Map<string, Map<ActivationEventType, number>>()

/** Ordered event log (also persisted) */
const eventLog: ActivationEvent[] = []
const MAX_LOG_SIZE = 10_000

const FUNNEL_ORDER: ActivationEventType[] = [
  'signup_completed',
  'workspace_ready',
  'first_task_started',
  'first_task_completed',
  'first_team_message_sent',
  'day2_return_action',
]

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
  }

  const allDone = currentStep === FUNNEL_ORDER.length
  const completedAt = allDone
    ? Math.max(...Object.values(events).filter((v): v is number => v !== null))
    : null

  return { userId, events, currentStep, completedAt }
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
    workspace_ready: 0,
    first_task_started: 0,
    first_task_completed: 0,
    first_team_message_sent: 0,
    day2_return_action: 0,
  }

  const funnelByUser: UserFunnelState[] = []
  let completedUsers = 0

  for (const userId of userFunnels.keys()) {
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
    totalUsers: userFunnels.size,
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

/**
 * Reset funnel state (for testing).
 */
export function resetActivationFunnel(): void {
  userFunnels.clear()
  eventLog.length = 0
}
