// SPDX-License-Identifier: Apache-2.0
// Host-native agent-to-agent messaging — replaces gateway for local agents
import { getDb } from './db.js'

export interface AgentMessage {
  id: string
  fromAgent: string
  toAgent: string
  channel: string
  content: string
  metadata: Record<string, unknown>
  readAt: number | null
  createdAt: number
}

interface MessageRow {
  id: string
  from_agent: string
  to_agent: string
  channel: string
  content: string
  metadata: string
  read_at: number | null
  created_at: number
}

function rowToMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    fromAgent: row.from_agent,
    toAgent: row.to_agent,
    channel: row.channel,
    content: row.content,
    metadata: JSON.parse(row.metadata || '{}'),
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

function generateId(): string {
  return `amsg-${Date.now()}-${Math.random().toString(36).slice(2, 13)}`
}

/**
 * Send a message from one agent to another (or to a channel).
 */
export function sendAgentMessage(opts: {
  fromAgent: string
  toAgent: string
  channel?: string
  content: string
  metadata?: Record<string, unknown>
}): AgentMessage {
  const db = getDb()
  const id = generateId()
  const now = Date.now()
  const channel = opts.channel ?? 'direct'
  const metadata = opts.metadata ?? {}

  db.prepare(`
    INSERT INTO agent_messages (id, from_agent, to_agent, channel, content, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.fromAgent, opts.toAgent, channel, opts.content, JSON.stringify(metadata), now)

  return { id, fromAgent: opts.fromAgent, toAgent: opts.toAgent, channel, content: opts.content, metadata, readAt: null, createdAt: now }
}

/**
 * List messages for an agent (inbox).
 */
export function listAgentMessages(opts: {
  agentId: string
  channel?: string
  unreadOnly?: boolean
  since?: number
  limit?: number
}): AgentMessage[] {
  const db = getDb()
  const conditions = ['to_agent = ?']
  const params: unknown[] = [opts.agentId]

  if (opts.channel) {
    conditions.push('channel = ?')
    params.push(opts.channel)
  }
  if (opts.unreadOnly) {
    conditions.push('read_at IS NULL')
  }
  if (opts.since) {
    conditions.push('created_at >= ?')
    params.push(opts.since)
  }

  const limit = opts.limit ?? 50
  const sql = `SELECT * FROM agent_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
  params.push(limit)

  return (db.prepare(sql).all(...params) as MessageRow[]).map(rowToMessage)
}

/**
 * List messages sent by an agent (outbox).
 */
export function listSentMessages(agentId: string, limit?: number): AgentMessage[] {
  const db = getDb()
  return (db.prepare('SELECT * FROM agent_messages WHERE from_agent = ? ORDER BY created_at DESC LIMIT ?')
    .all(agentId, limit ?? 50) as MessageRow[]).map(rowToMessage)
}

/**
 * Mark messages as read.
 */
export function markMessagesRead(agentId: string, messageIds?: string[]): number {
  const db = getDb()
  const now = Date.now()
  if (messageIds && messageIds.length > 0) {
    const placeholders = messageIds.map(() => '?').join(',')
    const result = db.prepare(`UPDATE agent_messages SET read_at = ? WHERE to_agent = ? AND id IN (${placeholders}) AND read_at IS NULL`)
      .run(now, agentId, ...messageIds)
    return result.changes
  }
  // Mark all unread
  const result = db.prepare('UPDATE agent_messages SET read_at = ? WHERE to_agent = ? AND read_at IS NULL').run(now, agentId)
  return result.changes
}

/**
 * Get unread count for an agent.
 */
export function getUnreadCount(agentId: string): number {
  const db = getDb()
  return (db.prepare('SELECT COUNT(*) as c FROM agent_messages WHERE to_agent = ? AND read_at IS NULL').get(agentId) as { c: number }).c
}

/**
 * List messages in a channel (broadcast/topic).
 */
export function listChannelMessages(channel: string, opts?: { since?: number; limit?: number }): AgentMessage[] {
  const db = getDb()
  const conditions = ['channel = ?']
  const params: unknown[] = [channel]
  if (opts?.since) {
    conditions.push('created_at >= ?')
    params.push(opts.since)
  }
  const limit = opts?.limit ?? 50
  return (db.prepare(`SELECT * FROM agent_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as MessageRow[]).map(rowToMessage)
}
