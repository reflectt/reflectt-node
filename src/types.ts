// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Core types for reflectt-node
 */

export interface ChatAttachment {
  id: string
  name: string
  size: number
  mimeType: string
  url: string
}

export interface AgentMessage {
  id: string
  from: string
  to?: string // undefined = broadcast
  content: string
  timestamp: number
  channel?: string // Channel name (default: "general")
  reactions?: Record<string, string[]> // emoji -> array of agent names
  threadId?: string // If set, this message is a reply in that thread
  replyCount?: number // Number of replies (calculated on fetch)
  metadata?: Record<string, unknown>
  attachments?: ChatAttachment[]
}

export interface Task {
  id: string
  title: string
  description?: string
  status: 'todo' | 'doing' | 'blocked' | 'validating' | 'done'
  assignee?: string
  reviewer?: string
  done_criteria?: string[]
  createdBy: string
  createdAt: number
  updatedAt: number
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  blocked_by?: string[]
  epic_id?: string
  tags?: string[]
  metadata?: Record<string, unknown>
  teamId?: string
}

export type TaskHistoryEventType = 'created' | 'assigned' | 'status_changed' | 'commented' | 'lane_transition'

export interface TaskComment {
  id: string
  taskId: string
  author: string
  content: string
  timestamp: number

  /** Optional comms categorization (used by comms_policy enforcement) */
  category?: string | null

  /** If true, comment is stored for audit but suppressed from default feeds */
  suppressed?: boolean

  /** Human-readable suppression reason (e.g., missing_category, non_whitelisted_category:<x>) */
  suppressedReason?: string | null

  /** Policy rule that caused suppression (if any) */
  suppressedRule?: string | null
}

export interface TaskHistoryEvent {
  id: string
  taskId: string
  type: TaskHistoryEventType
  actor: string
  timestamp: number
  data?: Record<string, unknown>
}

export type RecurringTaskSchedule =
  | {
      kind: 'weekly'
      dayOfWeek: number // 0 (Sunday) -> 6 (Saturday), server local time
      hour?: number // default: 9
      minute?: number // default: 0
    }
  | {
      kind: 'interval'
      everyMs: number
      anchorAt?: number
    }

export interface RecurringTask {
  id: string
  title: string
  description?: string
  assignee?: string
  reviewer?: string
  done_criteria?: string[]
  createdBy: string
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  blocked_by?: string[]
  epic_id?: string
  tags?: string[]
  metadata?: Record<string, unknown>
  schedule: RecurringTaskSchedule
  enabled: boolean
  status?: 'todo' | 'doing' | 'blocked' | 'validating' | 'done' // default generated status: todo
  lastRunAt?: number
  lastSkipAt?: number
  lastSkipReason?: string
  nextRunAt: number
  createdAt: number
  updatedAt: number
}

export interface OpenClawConfig {
  gatewayUrl: string
  gatewayToken?: string
  agentId: string
}

export interface ServerConfig {
  port: number
  host: string
  corsEnabled: boolean
}

export interface ChatRoom {
  id: string
  name: string
  participants: string[]
  createdAt: number
}

export interface InboxMessage extends AgentMessage {
  priority: 'high' | 'medium' | 'low'
  reason: 'mention' | 'dm' | 'subscribed' | 'general'
}

export interface InboxState {
  agent: string
  subscriptions: string[] // Channel names
  ackedMessageIds: string[] // Message IDs that have been acknowledged
  lastReadTimestamp?: number // Timestamp of last inbox check (for filtering new messages)
  lastUpdated: number
}
