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
