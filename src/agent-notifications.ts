// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Agent Notifications — Storage & CRUD
 *
 * Provides structured notification delivery to agents with ack workflow.
 * Stored in SQLite (agent_notifications table, migration v27).
 */

import type Database from 'better-sqlite3'

// ── Types ──

export type NotificationType = 'info' | 'task' | 'review' | 'mention' | 'alert' | 'system'
export type NotificationPriorityLevel = 'low' | 'medium' | 'high' | 'critical'
export type NotificationStatus = 'pending' | 'acked' | 'expired'
export type AckDecision = 'seen' | 'accept' | 'defer' | 'dismiss'

export interface AgentNotification {
  id: string
  target_agent: string
  source_agent: string | null
  type: NotificationType
  title: string
  body: string | null
  priority: NotificationPriorityLevel
  status: NotificationStatus
  ack_decision: AckDecision | null
  ack_at: number | null
  task_id: string | null
  metadata: Record<string, unknown> | null
  created_at: number
  expires_at: number | null
}

export interface CreateNotificationParams {
  target_agent: string
  source_agent?: string
  type?: NotificationType
  title: string
  body?: string
  priority?: NotificationPriorityLevel
  task_id?: string
  metadata?: Record<string, unknown>
  expires_at?: number
}

export interface GetNotificationsOptions {
  status?: NotificationStatus
  limit?: number
}

// ── ID generation ──

export function generateNotificationId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  return `notif-${ts}-${rand}`
}

// ── CRUD ──

const PRIORITY_ORDER: Record<NotificationPriorityLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function createNotification(
  db: Database.Database,
  params: CreateNotificationParams,
): AgentNotification {
  const id = generateNotificationId()
  const now = Date.now()
  const notification: AgentNotification = {
    id,
    target_agent: params.target_agent,
    source_agent: params.source_agent ?? null,
    type: params.type ?? 'info',
    title: params.title,
    body: params.body ?? null,
    priority: params.priority ?? 'medium',
    status: 'pending',
    ack_decision: null,
    ack_at: null,
    task_id: params.task_id ?? null,
    metadata: params.metadata ?? null,
    created_at: now,
    expires_at: params.expires_at ?? null,
  }

  db.prepare(`
    INSERT INTO agent_notifications
      (id, target_agent, source_agent, type, title, body, priority, status,
       ack_decision, ack_at, task_id, metadata, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    notification.id,
    notification.target_agent,
    notification.source_agent,
    notification.type,
    notification.title,
    notification.body,
    notification.priority,
    notification.status,
    notification.ack_decision,
    notification.ack_at,
    notification.task_id,
    notification.metadata ? JSON.stringify(notification.metadata) : null,
    notification.created_at,
    notification.expires_at,
  )

  return notification
}

export function ackNotification(
  db: Database.Database,
  id: string,
  decision: AckDecision,
): AgentNotification | null {
  const now = Date.now()
  const result = db.prepare(`
    UPDATE agent_notifications
    SET status = 'acked', ack_decision = ?, ack_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(decision, now, id)

  if (result.changes === 0) return null

  return getNotificationById(db, id)
}

export function getNotificationById(
  db: Database.Database,
  id: string,
): AgentNotification | null {
  const row = db.prepare('SELECT * FROM agent_notifications WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return deserializeNotification(row)
}

export function getNotifications(
  db: Database.Database,
  agentId: string,
  opts?: GetNotificationsOptions,
): { notifications: AgentNotification[]; total: number } {
  const status = opts?.status ?? 'pending'
  const limit = opts?.limit ?? 50

  const rows = db.prepare(`
    SELECT * FROM agent_notifications
    WHERE target_agent = ? AND status = ?
    ORDER BY
      CASE priority
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END ASC,
      created_at ASC
    LIMIT ?
  `).all(agentId, status, limit) as Record<string, unknown>[]

  const totalRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM agent_notifications
    WHERE target_agent = ? AND status = ?
  `).get(agentId, status) as { cnt: number }

  return {
    notifications: rows.map(deserializeNotification),
    total: totalRow.cnt,
  }
}

// ── Helpers ──

function deserializeNotification(row: Record<string, unknown>): AgentNotification {
  return {
    id: row.id as string,
    target_agent: row.target_agent as string,
    source_agent: row.source_agent as string | null,
    type: row.type as NotificationType,
    title: row.title as string,
    body: row.body as string | null,
    priority: row.priority as NotificationPriorityLevel,
    status: row.status as NotificationStatus,
    ack_decision: row.ack_decision as AckDecision | null,
    ack_at: row.ack_at as number | null,
    task_id: row.task_id as string | null,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown> | null),
    created_at: row.created_at as number,
    expires_at: row.expires_at as number | null,
  }
}
