// SPDX-License-Identifier: Apache-2.0
// Task-comment ingestion observability + reject ledger

import { getDb, safeJsonStringify } from './db.js'

export type TaskCommentProvenance = {
  source_channel?: string
  sender_id?: string
  original_message_id?: string
  integration?: string
  // Any additional caller-provided context
  [k: string]: unknown
}

export type TaskCommentReject = {
  attempted_task_param: string
  resolved_task_id?: string | null
  author?: string | null
  content?: string | null
  reason: 'task_not_found' | 'invalid_task_refs' | 'other'
  details?: Record<string, unknown>
  provenance?: TaskCommentProvenance
  timestamp?: number
}

export function ensureTaskCommentRejectTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_comment_ingest_rejects (
      id TEXT PRIMARY KEY,
      attempted_task_param TEXT NOT NULL,
      resolved_task_id TEXT,
      author TEXT,
      content TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      provenance TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_comment_rejects_ts ON task_comment_ingest_rejects(timestamp);
    CREATE INDEX IF NOT EXISTS idx_task_comment_rejects_reason ON task_comment_ingest_rejects(reason);
    CREATE INDEX IF NOT EXISTS idx_task_comment_rejects_author ON task_comment_ingest_rejects(author);
  `)
}

export function recordTaskCommentReject(input: TaskCommentReject): { id: string } {
  ensureTaskCommentRejectTable()
  const db = getDb()
  const now = input.timestamp ?? Date.now()
  const id = `tcrej-${now}-${Math.random().toString(36).slice(2, 10)}`

  db.prepare(`
    INSERT INTO task_comment_ingest_rejects (
      id, attempted_task_param, resolved_task_id, author, content, reason, details, provenance, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.attempted_task_param,
    input.resolved_task_id ?? null,
    input.author ?? null,
    input.content ?? null,
    input.reason,
    safeJsonStringify(input.details ?? null),
    safeJsonStringify(input.provenance ?? null),
    now,
  )

  return { id }
}
