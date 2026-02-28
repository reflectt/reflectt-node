// SPDX-License-Identifier: Apache-2.0
// File upload/download/management
//
// Stores file bytes under REFLECTT_HOME/files/<uuid>.<ext>
// Metadata in SQLite `files` table.
// 50MB upload limit. Extension allowlist for safety.

import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { getDb } from './db.js'
import { REFLECTT_HOME } from './config.js'

// ── Types ──

export interface FileMeta {
  id: string
  originalName: string
  storedPath: string
  mimeType: string
  sizeBytes: number
  uploadedBy: string
  tags: string[]
  createdAt: number
}

// ── Constants ──

const FILES_DIR = join(REFLECTT_HOME, 'files')
const MAX_SIZE_BYTES = 50 * 1024 * 1024 // 50MB

// Extension → MIME type mapping (allowlist)
const ALLOWED_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.zip': 'application/zip',
  '.log': 'text/plain',
}

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'])

export { MAX_SIZE_BYTES, FILES_DIR }

// ── DB ──

function ensureTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id          TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type   TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL,
      uploaded_by TEXT NOT NULL DEFAULT 'anonymous',
      tags        TEXT NOT NULL DEFAULT '[]',
      created_at  INTEGER NOT NULL
    )
  `)
  mkdirSync(FILES_DIR, { recursive: true })
}

// ── Core operations ──

export interface UploadInput {
  filename: string
  buffer: Buffer
  uploadedBy?: string
  tags?: string[]
  mimeType?: string
}

export interface UploadResult {
  success: boolean
  file?: FileMeta
  error?: string
}

/** Upload a file. Returns metadata or error. */
export function uploadFile(input: UploadInput): UploadResult {
  ensureTable()

  const { filename, buffer, uploadedBy = 'anonymous', tags = [] } = input

  // Size check
  if (buffer.length > MAX_SIZE_BYTES) {
    return { success: false, error: `File exceeds ${MAX_SIZE_BYTES / (1024 * 1024)}MB limit (got ${(buffer.length / (1024 * 1024)).toFixed(1)}MB)` }
  }

  // Extension check
  const ext = extname(filename).toLowerCase()
  if (!ALLOWED_EXTENSIONS[ext]) {
    return { success: false, error: `File extension "${ext}" is not allowed. Allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}` }
  }

  const id = randomUUID()
  const storedName = `${id}${ext}`
  const storedPath = join(FILES_DIR, storedName)
  const mimeType = input.mimeType || ALLOWED_EXTENSIONS[ext] || 'application/octet-stream'

  // Write to disk
  writeFileSync(storedPath, buffer)

  // Write metadata
  const now = Date.now()
  const db = getDb()
  db.prepare(`
    INSERT INTO files (id, original_name, stored_path, mime_type, size_bytes, uploaded_by, tags, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, filename, storedPath, mimeType, buffer.length, uploadedBy, JSON.stringify(tags), now)

  const file: FileMeta = {
    id,
    originalName: filename,
    storedPath,
    mimeType,
    sizeBytes: buffer.length,
    uploadedBy,
    tags,
    createdAt: now,
  }

  return { success: true, file }
}

/** Get file metadata by ID. */
export function getFile(id: string): FileMeta | null {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToMeta(row)
}

/** Read file bytes. Returns null if not found. */
export function readFile(id: string): { meta: FileMeta; buffer: Buffer } | null {
  const meta = getFile(id)
  if (!meta) return null
  if (!existsSync(meta.storedPath)) return null
  return { meta, buffer: readFileSync(meta.storedPath) }
}

/** List files with optional filters. */
export function listFiles(opts: { uploadedBy?: string; tag?: string; limit?: number; offset?: number } = {}): { files: FileMeta[]; total: number } {
  ensureTable()
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.uploadedBy) {
    conditions.push('uploaded_by = ?')
    params.push(opts.uploadedBy)
  }
  if (opts.tag) {
    conditions.push("tags LIKE ?")
    params.push(`%"${opts.tag}"%`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(opts.limit || 50, 200)
  const offset = opts.offset || 0

  const total = (db.prepare(`SELECT COUNT(*) as c FROM files ${where}`).get(...params) as { c: number }).c
  const rows = db.prepare(`SELECT * FROM files ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<Record<string, unknown>>

  return { files: rows.map(rowToMeta), total }
}

/** Delete a file (metadata + disk). */
export function deleteFile(id: string): { success: boolean; error?: string } {
  ensureTable()
  const meta = getFile(id)
  if (!meta) return { success: false, error: 'File not found' }

  // Remove from disk
  if (existsSync(meta.storedPath)) {
    unlinkSync(meta.storedPath)
  }

  // Remove metadata
  const db = getDb()
  db.prepare('DELETE FROM files WHERE id = ?').run(id)

  return { success: true }
}

/** Check if a MIME type is an image (for inline preview). */
export function isImage(mimeType: string): boolean {
  return IMAGE_MIMES.has(mimeType)
}

// ── Helpers ──

function rowToMeta(row: Record<string, unknown>): FileMeta {
  let tags: string[] = []
  try { tags = JSON.parse(String(row.tags || '[]')) } catch { tags = [] }
  return {
    id: String(row.id),
    originalName: String(row.original_name),
    storedPath: String(row.stored_path),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes) || 0,
    uploadedBy: String(row.uploaded_by || 'anonymous'),
    tags,
    createdAt: Number(row.created_at) || 0,
  }
}
