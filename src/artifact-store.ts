// SPDX-License-Identifier: Apache-2.0
// Host-native artifact store — run/task-linked file storage
import { getDb } from './db.js'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

/**
 * Canonical agentId for room-scoped artifacts (Room Share Snapshot v0).
 * All room artifacts (snapshots in v0; recordings, agent outputs later)
 * ride a single agentId so the storage path stays clean and per-kind
 * retention is straightforward. In v0 a host = a room, so this constant
 * also serves as the "owner of room storage" identity.
 */
export const ROOM_ARTIFACT_AGENT_ID = 'room'

export interface Artifact {
  id: string
  agentId: string
  teamId: string
  runId: string | null
  taskId: string | null
  name: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  metadata: Record<string, unknown>
  createdAt: number
}

interface ArtifactRow {
  id: string
  agent_id: string
  team_id: string
  run_id: string | null
  task_id: string | null
  name: string
  mime_type: string
  size_bytes: number
  storage_path: string
  metadata: string
  created_at: number
}

function rowToArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    agentId: row.agent_id,
    teamId: row.team_id,
    runId: row.run_id,
    taskId: row.task_id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
  }
}

function generateId(): string {
  return `art-${Date.now()}-${Math.random().toString(36).slice(2, 13)}`
}

function getStorageRoot(): string {
  return join(homedir(), '.reflectt', 'artifacts')
}

/**
 * Store an artifact (writes file to disk + row to DB).
 */
export function storeArtifact(opts: {
  agentId: string
  teamId?: string
  runId?: string
  taskId?: string
  name: string
  mimeType?: string
  content: Buffer | string
  metadata?: Record<string, unknown>
}): Artifact {
  const db = getDb()
  const id = generateId()
  const now = Date.now()
  const teamId = opts.teamId ?? 'default'

  // Storage path: ~/.reflectt/artifacts/<agentId>/<YYYY-MM>/<id>-<name>
  const datePrefix = new Date(now).toISOString().slice(0, 7) // YYYY-MM
  const safeName = opts.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = join(getStorageRoot(), opts.agentId, datePrefix, `${id}-${safeName}`)

  // Write file
  mkdirSync(dirname(storagePath), { recursive: true })
  const content = typeof opts.content === 'string' ? Buffer.from(opts.content) : opts.content
  writeFileSync(storagePath, content)

  const mimeType = opts.mimeType ?? guessMimeType(opts.name)

  db.prepare(`
    INSERT INTO artifacts (id, agent_id, team_id, run_id, task_id, name, mime_type, size_bytes, storage_path, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.agentId, teamId, opts.runId ?? null, opts.taskId ?? null, opts.name, mimeType, content.length, storagePath, JSON.stringify(opts.metadata ?? {}), now)

  return { id, agentId: opts.agentId, teamId, runId: opts.runId ?? null, taskId: opts.taskId ?? null, name: opts.name, mimeType, sizeBytes: content.length, storagePath, metadata: opts.metadata ?? {}, createdAt: now }
}

/**
 * Get artifact metadata by ID.
 */
export function getArtifact(id: string): Artifact | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as ArtifactRow | undefined
  return row ? rowToArtifact(row) : null
}

/**
 * Read artifact content from disk.
 */
export function readArtifactContent(id: string): Buffer | null {
  const art = getArtifact(id)
  if (!art || !existsSync(art.storagePath)) return null
  return readFileSync(art.storagePath)
}

/**
 * List artifacts for an agent, run, or task. Optional `kind` filters on
 * `metadata.kind` (Room Share Snapshot v0 introduced this discriminator;
 * snapshots are the first kind, recordings/etc. will follow). Kind filter
 * is applied via SQLite JSON extraction so future-kind artifacts pile up
 * cleanly under the same agent without a schema change.
 */
export function listArtifacts(opts: {
  agentId?: string
  runId?: string
  taskId?: string
  kind?: string
  sinceMs?: number
  limit?: number
}): Artifact[] {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.agentId) { conditions.push('agent_id = ?'); params.push(opts.agentId) }
  if (opts.runId) { conditions.push('run_id = ?'); params.push(opts.runId) }
  if (opts.taskId) { conditions.push('task_id = ?'); params.push(opts.taskId) }
  if (opts.kind) { conditions.push("json_extract(metadata, '$.kind') = ?"); params.push(opts.kind) }
  if (typeof opts.sinceMs === 'number') { conditions.push('created_at >= ?'); params.push(opts.sinceMs) }

  if (conditions.length === 0) conditions.push('1=1')
  const limit = opts.limit ?? 50
  return (db.prepare(`SELECT * FROM artifacts WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as ArtifactRow[]).map(rowToArtifact)
}

/**
 * Merge `partial` into an artifact's metadata column. Used by the snapshot
 * write path to attach `thumbnailPath` + `dimensions` after the thumbnail
 * is generated post-store. Returns the updated artifact, or null if the id
 * doesn't exist (e.g. concurrent retention sweep already evicted it).
 */
export function updateArtifactMetadata(id: string, partial: Record<string, unknown>): Artifact | null {
  const db = getDb()
  const existing = getArtifact(id)
  if (!existing) return null
  const merged = { ...existing.metadata, ...partial }
  db.prepare('UPDATE artifacts SET metadata = ? WHERE id = ?').run(JSON.stringify(merged), id)
  return { ...existing, metadata: merged }
}

/**
 * Snapshot retention sweep — Room Share Snapshot v0 lock: keep last `max`
 * snapshots per `agentId` (= per host = per room in v0), evict oldest.
 * Deletes both the original PNG and the matching `*-thumb.png` thumbnail
 * file alongside the DB row. Synchronous + cheap; no scheduler.
 *
 * Per-kind cap so future kinds (recordings, agent outputs) carry their
 * own retention rules set by their own specs without conflict.
 */
export function pruneSnapshotsForRetention(agentId: string, max: number = 20): { removed: number } {
  const snapshots = listArtifacts({ agentId, kind: 'snapshot', limit: 1000 })
  if (snapshots.length <= max) return { removed: 0 }
  const toRemove = snapshots.slice(max)
  let removed = 0
  for (const art of toRemove) {
    const thumb = (art.metadata?.thumbnailPath as string | undefined) ?? null
    if (deleteArtifact(art.id)) {
      removed++
      if (thumb) {
        try { if (existsSync(thumb)) unlinkSync(thumb) } catch { /* best effort */ }
      }
    }
  }
  return { removed }
}

/**
 * Delete artifact (removes file + DB row).
 */
export function deleteArtifact(id: string): boolean {
  const db = getDb()
  const art = getArtifact(id)
  if (!art) return false
  try { if (existsSync(art.storagePath)) unlinkSync(art.storagePath) } catch { /* best effort */ }
  db.prepare('DELETE FROM artifacts WHERE id = ?').run(id)
  return true
}

/**
 * Get total storage used by an agent.
 */
export function getStorageUsage(agentId: string): { totalBytes: number; count: number } {
  const db = getDb()
  const row = db.prepare('SELECT COALESCE(SUM(size_bytes), 0) as totalBytes, COUNT(*) as count FROM artifacts WHERE agent_id = ?').get(agentId) as { totalBytes: number; count: number }
  return row
}

function guessMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    'json': 'application/json', 'md': 'text/markdown', 'txt': 'text/plain',
    'html': 'text/html', 'css': 'text/css', 'js': 'application/javascript',
    'ts': 'text/typescript', 'png': 'image/png', 'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg', 'gif': 'image/gif', 'svg': 'image/svg+xml',
    'pdf': 'application/pdf', 'zip': 'application/zip',
  }
  return map[ext ?? ''] ?? 'application/octet-stream'
}
