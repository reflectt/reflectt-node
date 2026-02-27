// SPDX-License-Identifier: Apache-2.0
// Host registry: remote hosts phone-home via heartbeat

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'

// ── Types ──

export interface HostHeartbeat {
  hostId: string
  hostname?: string
  os?: string
  arch?: string
  ip?: string
  version?: string
  agents?: string[]
  metadata?: Record<string, unknown>
}

export interface Host {
  id: string
  hostname: string | null
  os: string | null
  arch: string | null
  ip: string | null
  version: string | null
  agents: string[]
  metadata: Record<string, unknown>
  status: 'online' | 'offline' | 'stale'
  last_seen_at: number
  registered_at: number
}

// ── Constants ──

const STALE_THRESHOLD_MS = 5 * 60 * 1000   // 5 minutes without heartbeat → stale
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes → offline

// ── CRUD ──

/**
 * Register or update a host heartbeat.
 * Creates the host if it doesn't exist; updates last_seen + metadata if it does.
 */
export function upsertHostHeartbeat(input: HostHeartbeat): Host {
  const db = getDb()
  const now = Date.now()

  const existing = db.prepare('SELECT * FROM hosts WHERE id = ?').get(input.hostId) as Record<string, unknown> | undefined

  if (existing) {
    db.prepare(`
      UPDATE hosts SET
        hostname = COALESCE(?, hostname),
        os = COALESCE(?, os),
        arch = COALESCE(?, arch),
        ip = COALESCE(?, ip),
        version = COALESCE(?, version),
        agents = COALESCE(?, agents),
        metadata = COALESCE(?, metadata),
        status = 'online',
        last_seen_at = ?
      WHERE id = ?
    `).run(
      input.hostname ?? null,
      input.os ?? null,
      input.arch ?? null,
      input.ip ?? null,
      input.version ?? null,
      input.agents ? safeJsonStringify(input.agents) : null,
      input.metadata ? safeJsonStringify(input.metadata) : null,
      now,
      input.hostId,
    )
  } else {
    db.prepare(`
      INSERT INTO hosts (id, hostname, os, arch, ip, version, agents, metadata, status, last_seen_at, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'online', ?, ?)
    `).run(
      input.hostId,
      input.hostname ?? null,
      input.os ?? null,
      input.arch ?? null,
      input.ip ?? null,
      input.version ?? null,
      safeJsonStringify(input.agents ?? []),
      safeJsonStringify(input.metadata ?? {}),
      now,
      now,
    )
  }

  return getHost(input.hostId)!
}

/**
 * Get a single host by ID.
 */
export function getHost(hostId: string): Host | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(hostId) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToHost(row)
}

/**
 * List all known hosts, with computed status based on last_seen_at.
 */
export function listHosts(opts?: { status?: string }): Host[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM hosts ORDER BY last_seen_at DESC').all() as Array<Record<string, unknown>>

  const hosts = rows.map(rowToHost)

  if (opts?.status) {
    return hosts.filter(h => h.status === opts.status)
  }
  return hosts
}

/**
 * Remove a host from the registry.
 */
export function removeHost(hostId: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM hosts WHERE id = ?').run(hostId)
  return result.changes > 0
}

// ── Helpers ──

function rowToHost(row: Record<string, unknown>): Host {
  const now = Date.now()
  const lastSeen = Number(row.last_seen_at) || 0
  const age = now - lastSeen

  let status: Host['status'] = 'online'
  if (age >= OFFLINE_THRESHOLD_MS) status = 'offline'
  else if (age >= STALE_THRESHOLD_MS) status = 'stale'

  return {
    id: String(row.id),
    hostname: row.hostname as string | null,
    os: row.os as string | null,
    arch: row.arch as string | null,
    ip: row.ip as string | null,
    version: row.version as string | null,
    agents: safeJsonParse<string[]>(row.agents as string) ?? [],
    metadata: safeJsonParse<Record<string, unknown>>(row.metadata as string) ?? {},
    status,
    last_seen_at: lastSeen,
    registered_at: Number(row.registered_at) || 0,
  }
}
