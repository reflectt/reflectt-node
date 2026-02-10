/**
 * Core types for reflectt-node
 */

export interface AgentMessage {
  id: string
  from: string
  to?: string // undefined = broadcast
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface Task {
  id: string
  title: string
  description?: string
  status: 'todo' | 'in-progress' | 'done' | 'blocked'
  assignedTo?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  priority?: 'low' | 'medium' | 'high'
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
