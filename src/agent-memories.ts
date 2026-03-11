// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Agent Memories — Persistent key-value store with tags and expiration.
 *
 * Survives node restarts (SQLite-backed, WAL mode).
 * Supports:
 *   - Scoped per agent + namespace
 *   - Tag-based filtering (JSONB tags column)
 *   - TTL via expires_at
 *   - Keyword search on key + content
 *
 * Task: task-1773246466959-qxwos0ffp
 */

import { getDb, safeJsonParse } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface AgentMemory {
  id: string
  agentId: string
  namespace: string
  key: string
  content: string
  tags: string[]
  expiresAt: number | null
  createdAt: number
  updatedAt: number
}

// ── ID generation ──────────────────────────────────────────────────────────

function generateMemoryId(): string {
  return `amem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ── Row mapping ────────────────────────────────────────────────────────────

interface MemoryRow {
  id: string
  agent_id: string
  namespace: string
  key: string
  content: string
  tags: string
  expires_at: number | null
  created_at: number
  updated_at: number
}

function rowToMemory(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    agentId: row.agent_id,
    namespace: row.namespace,
    key: row.key,
    content: row.content,
    tags: safeJsonParse<string[]>(row.tags) ?? [],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

/**
 * Store or upsert a memory. If agentId + namespace + key exists, it updates.
 */
export function setMemory(opts: {
  agentId: string
  namespace?: string
  key: string
  content: string
  tags?: string[]
  expiresAt?: number | null
}): AgentMemory {
  const db = getDb()
  const now = Date.now()
  const namespace = opts.namespace ?? 'default'
  const tags = opts.tags ?? []
  const expiresAt = opts.expiresAt ?? null

  // Check for existing
  const existing = db.prepare(
    'SELECT id FROM agent_memories WHERE agent_id = ? AND namespace = ? AND key = ?',
  ).get(opts.agentId, namespace, opts.key) as { id: string } | undefined

  if (existing) {
    db.prepare(`
      UPDATE agent_memories SET content = ?, tags = ?, expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(opts.content, JSON.stringify(tags), expiresAt, now, existing.id)

    const row = db.prepare('SELECT * FROM agent_memories WHERE id = ?').get(existing.id) as MemoryRow
    return rowToMemory(row)
  }

  const id = generateMemoryId()
  db.prepare(`
    INSERT INTO agent_memories (id, agent_id, namespace, key, content, tags, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.agentId, namespace, opts.key, opts.content, JSON.stringify(tags), expiresAt, now, now)

  return {
    id,
    agentId: opts.agentId,
    namespace,
    key: opts.key,
    content: opts.content,
    tags,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Get a specific memory by agentId + namespace + key.
 */
export function getMemory(agentId: string, key: string, namespace?: string): AgentMemory | null {
  const db = getDb()
  const ns = namespace ?? 'default'
  const row = db.prepare(
    'SELECT * FROM agent_memories WHERE agent_id = ? AND namespace = ? AND key = ?',
  ).get(agentId, ns, key) as MemoryRow | undefined
  if (!row) return null
  // Check expiration
  if (row.expires_at && row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM agent_memories WHERE id = ?').run(row.id)
    return null
  }
  return rowToMemory(row)
}

/**
 * Get a memory by its ID.
 */
export function getMemoryById(id: string): AgentMemory | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agent_memories WHERE id = ?').get(id) as MemoryRow | undefined
  if (!row) return null
  if (row.expires_at && row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM agent_memories WHERE id = ?').run(row.id)
    return null
  }
  return rowToMemory(row)
}

/**
 * List memories for an agent with optional filters.
 */
export function listMemories(opts: {
  agentId: string
  namespace?: string
  tag?: string
  search?: string
  limit?: number
  includeExpired?: boolean
}): AgentMemory[] {
  const db = getDb()
  const limit = opts.limit ?? 100
  const conditions: string[] = ['agent_id = ?']
  const params: unknown[] = [opts.agentId]

  if (opts.namespace) {
    conditions.push('namespace = ?')
    params.push(opts.namespace)
  }

  if (!opts.includeExpired) {
    conditions.push('(expires_at IS NULL OR expires_at > ?)')
    params.push(Date.now())
  }

  if (opts.tag) {
    // SQLite JSON — check if tag array contains the value
    conditions.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)")
    params.push(opts.tag)
  }

  if (opts.search) {
    conditions.push('(key LIKE ? OR content LIKE ?)')
    const pattern = `%${opts.search}%`
    params.push(pattern, pattern)
  }

  const sql = `SELECT * FROM agent_memories WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as MemoryRow[]
  return rows.map(rowToMemory)
}

/**
 * Delete a specific memory.
 */
export function deleteMemory(agentId: string, key: string, namespace?: string): boolean {
  const db = getDb()
  const ns = namespace ?? 'default'
  const result = db.prepare(
    'DELETE FROM agent_memories WHERE agent_id = ? AND namespace = ? AND key = ?',
  ).run(agentId, ns, key)
  return result.changes > 0
}

/**
 * Delete a memory by ID.
 */
export function deleteMemoryById(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM agent_memories WHERE id = ?').run(id)
  return result.changes > 0
}

/**
 * Purge all expired memories (housekeeping).
 */
export function purgeExpiredMemories(): number {
  const db = getDb()
  const result = db.prepare('DELETE FROM agent_memories WHERE expires_at IS NOT NULL AND expires_at <= ?').run(Date.now())
  return result.changes
}

/**
 * Count memories for an agent.
 */
export function countMemories(agentId: string, namespace?: string): number {
  const db = getDb()
  if (namespace) {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM agent_memories WHERE agent_id = ? AND namespace = ?',
    ).get(agentId, namespace) as { count: number }
    return row.count
  }
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM agent_memories WHERE agent_id = ?',
  ).get(agentId) as { count: number }
  return row.count
}
