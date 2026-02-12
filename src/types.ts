/**
 * Core types for reflectt-node
 */

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
}

export interface Task {
  id: string
  title: string
  description?: string
  status: 'todo' | 'doing' | 'blocked' | 'validating' | 'done'
  assignee?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  blocked_by?: string[]
  epic_id?: string
  tags?: string[]
  metadata?: Record<string, unknown>
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
