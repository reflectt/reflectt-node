// SPDX-License-Identifier: Apache-2.0
// Escalation automation for P1/P0 support incidents
// Tracks ack timers, triggers alerts, and runs escalation chains

import {
  type FeedbackRecord,
  type SupportTier,
  type BreachRisk,
  computeSLAStatus,
  TIER_POLICIES,
  getFeedback,
} from './feedback.js'

// ── Types ──

export type EscalationLevel = 'owner_alert' | 'ack_missed' | 'manager_escalation' | 'exec_escalation'
export type EscalationStatus = 'active' | 'acknowledged' | 'resolved' | 'escalated'

export interface EscalationRecord {
  id: string
  feedbackId: string
  priority: string
  tier: SupportTier
  status: EscalationStatus
  /** Who should own this incident */
  owner: string
  /** Current escalation level */
  level: EscalationLevel
  /** When the escalation was created */
  createdAt: number
  /** When owner acknowledged (undefined = not yet) */
  acknowledgedAt?: number
  /** Ack deadline (createdAt + ackWindowMs) */
  ackDeadlineAt: number
  /** Alert history */
  alerts: EscalationAlert[]
  /** Last time we checked/ticked this escalation */
  lastTickAt: number
}

export interface EscalationAlert {
  level: EscalationLevel
  target: string
  message: string
  sentAt: number
}

// ── Config ──

/** Ack window by priority — how long before escalating on no-ack */
const ACK_WINDOW_MS: Record<string, number> = {
  P0: 5 * 60_000,    // 5 minutes
  P1: 15 * 60_000,   // 15 minutes
}

/** Escalation chain: level → next level */
const ESCALATION_CHAIN: Record<EscalationLevel, EscalationLevel | null> = {
  owner_alert: 'ack_missed',
  ack_missed: 'manager_escalation',
  manager_escalation: 'exec_escalation',
  exec_escalation: null, // terminal
}

/** Time between escalation levels (after missed ack) */
const ESCALATION_INTERVAL_MS: Record<string, number> = {
  P0: 10 * 60_000,   // 10 minutes between escalation levels for P0
  P1: 30 * 60_000,   // 30 minutes for P1
}

/** Default escalation targets by level */
const DEFAULT_TARGETS: Record<EscalationLevel, string> = {
  owner_alert: 'on-call',
  ack_missed: 'on-call',
  manager_escalation: 'team-lead',
  exec_escalation: 'admin',
}

// ── Store ──

const escalationStore = new Map<string, EscalationRecord>()
let alertSink: (alert: EscalationAlert, record: EscalationRecord) => void = () => {}

/**
 * Set the alert delivery function. Called whenever an alert fires.
 * Default is no-op (logs silently). Wire this to chatManager, webhooks, etc.
 */
export function setAlertSink(sink: (alert: EscalationAlert, record: EscalationRecord) => void): void {
  alertSink = sink
}

// ── Core Logic ──

let idCounter = 0

/**
 * Create a new escalation for a P0/P1 feedback item.
 * Returns null if priority is not P0/P1 or escalation already exists.
 */
export function createEscalation(
  feedbackId: string,
  priority: string,
  tier: SupportTier,
  owner?: string,
): EscalationRecord | null {
  // Only P0/P1 get escalation
  if (priority !== 'P0' && priority !== 'P1') return null

  // Don't duplicate
  const existing = Array.from(escalationStore.values()).find(e => e.feedbackId === feedbackId)
  if (existing) return existing

  const now = Date.now()
  const ackWindow = ACK_WINDOW_MS[priority] || ACK_WINDOW_MS.P1
  const resolvedOwner = owner || DEFAULT_TARGETS.owner_alert

  const id = `esc-${++idCounter}-${Date.now().toString(36)}`
  const record: EscalationRecord = {
    id,
    feedbackId,
    priority,
    tier,
    status: 'active',
    owner: resolvedOwner,
    level: 'owner_alert',
    createdAt: now,
    ackDeadlineAt: now + ackWindow,
    alerts: [],
    lastTickAt: now,
  }

  // Fire initial owner alert
  const alert: EscalationAlert = {
    level: 'owner_alert',
    target: resolvedOwner,
    message: `🚨 ${priority} incident created — feedback ${feedbackId} (${tier} tier). Ack within ${ackWindow / 60_000}m.`,
    sentAt: now,
  }
  record.alerts.push(alert)
  alertSink(alert, record)

  escalationStore.set(id, record)
  return record
}

/**
 * Acknowledge an escalation. Stops the ack timer.
 */
export function acknowledgeEscalation(escalationId: string, actor?: string): EscalationRecord | null {
  const record = escalationStore.get(escalationId)
  if (!record) return null
  if (record.status !== 'active') return record

  record.acknowledgedAt = Date.now()
  record.status = 'acknowledged'
  record.lastTickAt = Date.now()

  return record
}

/**
 * Resolve an escalation (incident handled).
 */
export function resolveEscalation(escalationId: string): EscalationRecord | null {
  const record = escalationStore.get(escalationId)
  if (!record) return null

  record.status = 'resolved'
  record.lastTickAt = Date.now()

  return record
}

/**
 * Tick all active escalations — checks ack timers and triggers escalation chain.
 * Call this periodically (e.g. every 60s from a watchdog/sweeper).
 */
export function tickEscalations(now: number = Date.now()): EscalationTickResult {
  const results: EscalationTickResult = {
    checked: 0,
    escalated: 0,
    alerts: [],
  }

  for (const record of escalationStore.values()) {
    if (record.status === 'resolved') continue
    results.checked++

    // For active (un-acked) records: check ack deadline and run escalation chain
    if (record.status === 'active' && !record.acknowledgedAt && now >= record.ackDeadlineAt) {
      const nextLevel = ESCALATION_CHAIN[record.level]
      if (nextLevel) {
        const interval = ESCALATION_INTERVAL_MS[record.priority] || ESCALATION_INTERVAL_MS.P1
        const timeSinceLastEscalation = now - (record.alerts[record.alerts.length - 1]?.sentAt || record.createdAt)

        // Only escalate if enough time has passed since last alert
        if (timeSinceLastEscalation >= interval || record.level === 'owner_alert') {
          record.level = nextLevel
          record.status = nextLevel === 'exec_escalation' ? 'escalated' : 'active'

          const target = DEFAULT_TARGETS[nextLevel]
          const alert: EscalationAlert = {
            level: nextLevel,
            target,
            message: `⚠️ ${record.priority} escalation (${nextLevel}): feedback ${record.feedbackId} (${record.tier} tier). No ack after ${Math.round((now - record.createdAt) / 60_000)}m.`,
            sentAt: now,
          }
          record.alerts.push(alert)
          alertSink(alert, record)

          results.escalated++
          results.alerts.push(alert)
        }
      }
    }

    // Check SLA breach risk for acknowledged incidents — re-escalate if SLA breached despite ack
    if (record.status === 'acknowledged') {
      const feedback = getFeedback(record.feedbackId)
      if (feedback) {
        const sla = computeSLAStatus(feedback, now)
        if (sla.overallBreachRisk === 'breached') {
          // Only fire this alert once
          const hasBreach = record.alerts.some(a => a.message.includes('SLA BREACHED'))
          if (!hasBreach) {
            const alert: EscalationAlert = {
              level: 'manager_escalation',
              target: DEFAULT_TARGETS.manager_escalation,
              message: `🔴 SLA BREACHED on ${record.priority} — feedback ${record.feedbackId} (${record.tier} tier). Despite ack, SLA exceeded.`,
              sentAt: now,
            }
            record.alerts.push(alert)
            record.status = 'escalated'
            alertSink(alert, record)
            results.escalated++
            results.alerts.push(alert)
          }
        }
      }
    }

    record.lastTickAt = now
  }

  return results
}

export interface EscalationTickResult {
  checked: number
  escalated: number
  alerts: EscalationAlert[]
}

// ── Query ──

export function getEscalation(id: string): EscalationRecord | undefined {
  return escalationStore.get(id)
}

export function getEscalationByFeedback(feedbackId: string): EscalationRecord | undefined {
  return Array.from(escalationStore.values()).find(e => e.feedbackId === feedbackId)
}

export interface EscalationSummary {
  active: number
  acknowledged: number
  escalated: number
  resolved: number
  items: EscalationRecord[]
}

export function listEscalations(status?: EscalationStatus): EscalationSummary {
  const all = Array.from(escalationStore.values())
  const items = status ? all.filter(e => e.status === status) : all

  return {
    active: all.filter(e => e.status === 'active').length,
    acknowledged: all.filter(e => e.status === 'acknowledged').length,
    escalated: all.filter(e => e.status === 'escalated').length,
    resolved: all.filter(e => e.status === 'resolved').length,
    items: items.sort((a, b) => b.createdAt - a.createdAt),
  }
}

// ── Testing ──

export function _clearEscalationStore(): void {
  escalationStore.clear()
  idCounter = 0
  alertSink = () => {}
}

export { ACK_WINDOW_MS, ESCALATION_CHAIN, ESCALATION_INTERVAL_MS, DEFAULT_TARGETS }
