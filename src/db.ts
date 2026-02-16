// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * SQLite database module for reflectt-node
 *
 * Primary local store with WAL mode for concurrent reads.
 * Replaces JSONL flat files while keeping JSONL as append-only audit log.
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { existsSync, readFileSync, mkdirSync } from 'fs'
import { DATA_DIR } from './config.js'

const DB_PATH = join(DATA_DIR, 'reflectt.db')

let _db: Database.Database | null = null

/**
 * Get or create the SQLite database connection
 */
export function getDb(): Database.Database {
  if (_db) return _db

  mkdirSync(DATA_DIR, { recursive: true })

  _db = new Database(DB_PATH)

  // WAL mode for concurrent reads + better write performance
  _db.pragma('journal_mode = WAL')
  _db.pragma('synchronous = NORMAL')
  _db.pragma('foreign_keys = ON')

  // Run schema migrations
  runMigrations(_db)

  return _db
}

/**
 * Close the database connection (call on shutdown)
 */
export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

/**
 * Schema version tracking + migrations
 */
function runMigrations(db: Database.Database): void {
  // Create migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number | null }
  const version = currentVersion?.v ?? 0

  const migrations: Array<{ version: number; sql: string }> = [
    {
      version: 1,
      sql: `
        -- Tasks table
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'todo',
          assignee TEXT,
          reviewer TEXT,
          done_criteria TEXT, -- JSON array
          created_by TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          priority TEXT,
          blocked_by TEXT, -- JSON array
          epic_id TEXT,
          tags TEXT, -- JSON array
          metadata TEXT, -- JSON object
          comment_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);

        -- Task comments
        CREATE TABLE IF NOT EXISTS task_comments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);

        -- Task history
        CREATE TABLE IF NOT EXISTS task_history (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          type TEXT NOT NULL,
          actor TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          data TEXT -- JSON object
        );

        CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);

        -- Recurring tasks
        CREATE TABLE IF NOT EXISTS recurring_tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          assignee TEXT,
          reviewer TEXT,
          done_criteria TEXT, -- JSON array
          created_by TEXT NOT NULL,
          priority TEXT,
          blocked_by TEXT, -- JSON array
          epic_id TEXT,
          tags TEXT, -- JSON array
          metadata TEXT, -- JSON object
          schedule TEXT NOT NULL, -- JSON object
          enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT DEFAULT 'todo',
          last_run_at INTEGER,
          last_skip_at INTEGER,
          last_skip_reason TEXT,
          next_run_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- Chat messages
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          "from" TEXT NOT NULL,
          "to" TEXT,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          channel TEXT DEFAULT 'general',
          reactions TEXT, -- JSON object
          thread_id TEXT,
          reply_count INTEGER DEFAULT 0,
          metadata TEXT -- JSON object
        );

        CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_from ON chat_messages("from");
        CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);

        -- Inbox
        CREATE TABLE IF NOT EXISTS inbox (
          id TEXT PRIMARY KEY,
          agent TEXT NOT NULL,
          "from" TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          read INTEGER NOT NULL DEFAULT 0,
          metadata TEXT -- JSON object
        );

        CREATE INDEX IF NOT EXISTS idx_inbox_agent ON inbox(agent);
        CREATE INDEX IF NOT EXISTS idx_inbox_read ON inbox(read);
      `,
    },
  ]

  const insertMigration = db.prepare('INSERT INTO _migrations (version) VALUES (?)')

  for (const migration of migrations) {
    if (migration.version > version) {
      db.exec(migration.sql)
      insertMigration.run(migration.version)
      console.log(`[DB] Applied migration v${migration.version}`)
    }
  }
}

// ---- JSONL import helpers ----

/**
 * Import data from a JSONL file into a table
 * Used for one-time migration from JSONL → SQLite on first boot
 */
export function importJsonlIfNeeded(
  db: Database.Database,
  jsonlPath: string,
  tableName: string,
  importFn: (db: Database.Database, records: unknown[]) => number,
): number {
  // Check if table already has data
  const count = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number }
  if (count.c > 0) return 0

  if (!existsSync(jsonlPath)) return 0

  try {
    const content = readFileSync(jsonlPath, 'utf-8')
    const records = content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)

    if (records.length === 0) return 0

    const imported = importFn(db, records)
    console.log(`[DB] Imported ${imported} records from ${jsonlPath} → ${tableName}`)
    return imported
  } catch (err: any) {
    console.error(`[DB] Failed to import ${jsonlPath}:`, err?.message)
    return 0
  }
}

/**
 * Helper to safely parse JSON or return null
 */
export function safeJsonStringify(value: unknown): string | null {
  if (value === null || value === undefined) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

/**
 * Helper to safely parse JSON string
 */
export function safeJsonParse<T = unknown>(value: string | null | undefined): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}
