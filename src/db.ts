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

  // Prevent SQLITE_BUSY timeouts under concurrent agent access.
  // 5000ms wait before returning BUSY — covers typical heartbeat storms.
  _db.pragma('busy_timeout = 5000')

  // WAL auto-checkpoint every 1000 pages (~4MB) to prevent unbounded WAL growth
  _db.pragma('wal_autocheckpoint = 1000')

  // Checkpoint WAL on startup to reclaim disk space from accumulated writes
  try {
    _db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    // Non-fatal: checkpoint may fail if another process holds a read lock
  }

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
export function runMigrations(db: Database.Database): void {
  // Create migration tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM _migrations').get() as { v: number | null }
  const version = currentVersion?.v ?? 0

  const migrations: Array<{ version: number; sql?: string; runFn?: (db: Database.Database) => void }> = [
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

        -- Legacy inbox message table (kept for backward compatibility)
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
    {
      version: 2,
      sql: `
        -- Sync ledger for incremental cloud coordination
        CREATE TABLE IF NOT EXISTS sync_ledger (
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          local_updated_at INTEGER NOT NULL,
          cloud_synced_at INTEGER,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          PRIMARY KEY (record_type, record_id)
        );

        CREATE INDEX IF NOT EXISTS idx_sync_ledger_status ON sync_ledger(sync_status);
        CREATE INDEX IF NOT EXISTS idx_sync_ledger_local_updated ON sync_ledger(local_updated_at);

        -- Backfill current task state into sync ledger (first incremental run)
        INSERT OR IGNORE INTO sync_ledger (record_type, record_id, local_updated_at, sync_status)
        SELECT 'task', id, updated_at, 'pending'
        FROM tasks;

        -- Keep ledger pending whenever tasks are inserted/updated/deleted
        CREATE TRIGGER IF NOT EXISTS trg_tasks_sync_ledger_insert
        AFTER INSERT ON tasks
        BEGIN
          INSERT INTO sync_ledger (record_type, record_id, local_updated_at, cloud_synced_at, sync_status, attempt_count, last_error)
          VALUES ('task', NEW.id, NEW.updated_at, NULL, 'pending', 0, NULL)
          ON CONFLICT(record_type, record_id) DO UPDATE SET
            local_updated_at = excluded.local_updated_at,
            sync_status = 'pending',
            last_error = NULL;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_tasks_sync_ledger_update
        AFTER UPDATE ON tasks
        BEGIN
          INSERT INTO sync_ledger (record_type, record_id, local_updated_at, cloud_synced_at, sync_status, attempt_count, last_error)
          VALUES ('task', NEW.id, NEW.updated_at, NULL, 'pending', 0, NULL)
          ON CONFLICT(record_type, record_id) DO UPDATE SET
            local_updated_at = excluded.local_updated_at,
            sync_status = 'pending',
            last_error = NULL;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_tasks_sync_ledger_delete
        AFTER DELETE ON tasks
        BEGIN
          DELETE FROM sync_ledger
          WHERE record_type = 'task' AND record_id = OLD.id;
        END;
      `,
    },
    {
      version: 3,
      sql: `
        -- Inbox state moved from per-agent files to SQLite
        CREATE TABLE IF NOT EXISTS inbox_states (
          agent TEXT PRIMARY KEY,
          subscriptions TEXT NOT NULL, -- JSON array
          last_read_timestamp INTEGER NOT NULL DEFAULT 0,
          last_updated INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS inbox_acks (
          agent TEXT NOT NULL,
          message_id TEXT NOT NULL,
          acked_at INTEGER NOT NULL,
          PRIMARY KEY (agent, message_id)
        );

        CREATE INDEX IF NOT EXISTS idx_inbox_acks_agent ON inbox_acks(agent);
        CREATE INDEX IF NOT EXISTS idx_inbox_acks_message_id ON inbox_acks(message_id);
      `,
    },
    {
      version: 4,
      sql: 'SELECT 1', // Vector tables initialized via initVectorTables() after extension load
    },
    {
      version: 5,
      sql: `
        -- Focus mode persistence across restarts
        CREATE TABLE IF NOT EXISTS focus_states (
          agent TEXT PRIMARY KEY,
          active INTEGER NOT NULL DEFAULT 0,
          level TEXT NOT NULL DEFAULT 'soft',
          started_at INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER,
          reason TEXT,
          updated_at INTEGER NOT NULL
        );
      `,
    },
    {
      version: 6,
      sql: `
        ALTER TABLE tasks ADD COLUMN team_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_tasks_team_id ON tasks(team_id);
      `,
    },
    {
      version: 7,
      sql: `
        CREATE TABLE IF NOT EXISTS reflections (
          id TEXT PRIMARY KEY,
          pain TEXT NOT NULL,
          impact TEXT NOT NULL,
          evidence TEXT NOT NULL,        -- JSON array of strings
          went_well TEXT NOT NULL,
          suspected_why TEXT NOT NULL,
          proposed_fix TEXT NOT NULL,
          confidence REAL NOT NULL,      -- 0-10
          role_type TEXT NOT NULL,       -- engineering|product|ops|comms|growth|support|sales|finance|hr|other
          severity TEXT,                 -- low|medium|high|critical (nullable)
          author TEXT NOT NULL,
          task_id TEXT,                  -- optional link to originating task
          tags TEXT,                     -- JSON array (nullable)
          team_id TEXT,                  -- optional team scope
          metadata TEXT,                 -- JSON object (nullable)
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reflections_author ON reflections(author);
        CREATE INDEX IF NOT EXISTS idx_reflections_role_type ON reflections(role_type);
        CREATE INDEX IF NOT EXISTS idx_reflections_severity ON reflections(severity);
        CREATE INDEX IF NOT EXISTS idx_reflections_task_id ON reflections(task_id);
        CREATE INDEX IF NOT EXISTS idx_reflections_created_at ON reflections(created_at);
      `,
    },
    {
      version: 8,
      sql: `
        CREATE TABLE IF NOT EXISTS insights (
          id TEXT PRIMARY KEY,
          cluster_key TEXT NOT NULL,
          workflow_stage TEXT NOT NULL,
          failure_family TEXT NOT NULL,
          impacted_unit TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'candidate',
          score REAL NOT NULL DEFAULT 0,
          priority TEXT NOT NULL DEFAULT 'P3',
          reflection_ids TEXT NOT NULL,       -- JSON array
          independent_count INTEGER NOT NULL DEFAULT 0,
          evidence_refs TEXT NOT NULL,        -- JSON array
          authors TEXT NOT NULL,              -- JSON array
          promotion_readiness TEXT NOT NULL DEFAULT 'not_ready',
          recurring_candidate INTEGER NOT NULL DEFAULT 0,
          cooldown_until INTEGER,
          cooldown_reason TEXT,
          severity_max TEXT,
          task_id TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_insights_cluster_key ON insights(cluster_key);
        CREATE INDEX IF NOT EXISTS idx_insights_status ON insights(status);
        CREATE INDEX IF NOT EXISTS idx_insights_priority ON insights(priority);
        CREATE INDEX IF NOT EXISTS idx_insights_score ON insights(score);
      `,
    },
    {
      version: 9,
      // task_id now in base schema; ALTER handled via runFn for legacy DBs
      runFn: (database) => {
        const cols = database.pragma('table_info(insights)') as Array<{ name: string }>
        if (!cols.some(c => c.name === 'task_id')) {
          database.exec('ALTER TABLE insights ADD COLUMN task_id TEXT')
        }
      },
    },
    {
      version: 10,
      sql: `
        CREATE TABLE IF NOT EXISTS mention_rescue_state (
          thread_key TEXT PRIMARY KEY,
          message_ids TEXT NOT NULL DEFAULT '[]',
          rescued_at INTEGER NOT NULL,
          rescue_count INTEGER NOT NULL DEFAULT 1
        );
      `,
    },
    {
      version: 11,
      // Add task_id column to insights table for insight→task linkage
      runFn: (db: Database.Database) => {
        // Check if column already exists (idempotent)
        const cols = db.prepare("PRAGMA table_info(insights)").all() as Array<{ name: string }>
        if (!cols.some(c => c.name === 'task_id')) {
          db.exec("ALTER TABLE insights ADD COLUMN task_id TEXT DEFAULT NULL")
        }
        db.exec("CREATE INDEX IF NOT EXISTS idx_insights_task_id ON insights(task_id)")
      },
    },
    {
      version: 12,
      // Compound indexes for hot query paths — eliminates TEMP B-TREE sorts
      // on chat_messages (92K+ rows) and tasks (900+ rows) under concurrent agent load.
      sql: `
        CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_ts ON chat_messages(channel, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_messages_from_ts ON chat_messages("from", timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assignee, status);
        CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks(status, priority);
      `,
    },
    {
      version: 13,
      // Task comment comms_policy suppression metadata
      runFn: (db: Database.Database) => {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='task_comments'").get() as { name: string } | undefined
        if (!table) {
          // Some synthetic migration tests construct partial pre-v1 schemas.
          // If task_comments does not exist, skip this migration safely.
          return
        }

        const cols = db.prepare('PRAGMA table_info(task_comments)').all() as Array<{ name: string }>
        const has = (name: string) => cols.some(c => c.name === name)

        if (!has('category')) db.exec('ALTER TABLE task_comments ADD COLUMN category TEXT')
        if (!has('suppressed')) db.exec('ALTER TABLE task_comments ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0')
        if (!has('suppressed_reason')) db.exec('ALTER TABLE task_comments ADD COLUMN suppressed_reason TEXT')
        if (!has('suppressed_rule')) db.exec('ALTER TABLE task_comments ADD COLUMN suppressed_rule TEXT')

        db.exec('CREATE INDEX IF NOT EXISTS idx_task_comments_task_id_ts ON task_comments(task_id, timestamp ASC)')
        db.exec('CREATE INDEX IF NOT EXISTS idx_task_comments_task_id_suppressed ON task_comments(task_id, suppressed)')
      },
    },
    {
      version: 14,
      sql: `
        -- Persistent suppression ledger for system message deduplication
        CREATE TABLE IF NOT EXISTS suppression_ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          dedup_key TEXT NOT NULL,
          category TEXT NOT NULL,
          channel TEXT NOT NULL,
          "from" TEXT NOT NULL,
          content_preview TEXT,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          hit_count INTEGER NOT NULL DEFAULT 1,
          suppressed INTEGER NOT NULL DEFAULT 0,
          window_ms INTEGER NOT NULL DEFAULT 1800000
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_suppression_ledger_dedup_key ON suppression_ledger(dedup_key);
        CREATE INDEX IF NOT EXISTS idx_suppression_ledger_last_seen ON suppression_ledger(last_seen_at);
        CREATE INDEX IF NOT EXISTS idx_suppression_ledger_channel ON suppression_ledger(channel);

        -- Add dedup_key column to chat_messages for traceability
        ALTER TABLE chat_messages ADD COLUMN dedup_key TEXT;
      `,
    },
    {
      version: 15,
      sql: `
        -- Context budget memos (persisted summaries)
        CREATE TABLE IF NOT EXISTS context_memos (
          scope_id TEXT NOT NULL,
          layer TEXT NOT NULL,
          memo_version INTEGER NOT NULL DEFAULT 1,
          content TEXT NOT NULL,
          source_window TEXT, -- JSON object
          source_hash TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope_id, layer)
        );

        CREATE INDEX IF NOT EXISTS idx_context_memos_updated_at ON context_memos(updated_at);
      `,
    },
    {
      version: 16,
      sql: `
        -- Host registry: remote hosts phone-home via heartbeat
        CREATE TABLE IF NOT EXISTS hosts (
          id TEXT PRIMARY KEY,
          hostname TEXT,
          os TEXT,
          arch TEXT,
          ip TEXT,
          version TEXT,
          agents TEXT, -- JSON array of agent names
          metadata TEXT, -- JSON object
          status TEXT NOT NULL DEFAULT 'online',
          last_seen_at INTEGER NOT NULL,
          registered_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_hosts_last_seen ON hosts(last_seen_at);
        CREATE INDEX IF NOT EXISTS idx_hosts_status ON hosts(status);
      `,
    },
    {
      version: 17,
      sql: `
        -- Persisted loop tick timestamps for /health/system
        CREATE TABLE IF NOT EXISTS system_loop_ticks (
          name TEXT PRIMARY KEY,
          last_tick_at INTEGER NOT NULL
        );
      `,
    },
    {
      version: 18,
      sql: `
        -- Chat message attachments (JSON array of file references)
        ALTER TABLE chat_messages ADD COLUMN attachments TEXT;
      `,
    },
  ]

  const insertMigration = db.prepare('INSERT INTO _migrations (version) VALUES (?)')

  for (const migration of migrations) {
    if (migration.version > version) {
      if ('runFn' in migration && typeof migration.runFn === 'function') {
        migration.runFn(db)
      } else if ('sql' in migration) {
        db.exec(migration.sql as string)
      }
      insertMigration.run(migration.version)
      console.log(`[DB] Applied migration v${migration.version}`)
    }
  }

  // ── Migration integrity check ──────────────────────────────────────────
  // Verify tables that should exist actually do. If a migration was recorded
  // as applied but the table is missing (e.g. transaction anomaly), re-run
  // the SQL to recreate it. Only covers SQL-based migrations with CREATE TABLE.

  const expectedTables: Array<{ version: number; tables: string[] }> = [
    { version: 1, tables: ['tasks', 'task_comments', 'task_history', 'recurring_tasks', 'chat_messages', 'inbox'] },
    { version: 2, tables: ['sync_ledger'] },
    { version: 3, tables: ['inbox_states', 'inbox_acks'] },
    { version: 5, tables: ['focus_states'] },
    { version: 7, tables: ['reflections'] },
    { version: 8, tables: ['insights'] },
    { version: 10, tables: ['mention_rescue_state'] },
    { version: 14, tables: ['suppression_ledger'] },
    { version: 15, tables: ['context_memos'] },
    { version: 16, tables: ['hosts'] },
    { version: 17, tables: ['system_loop_ticks'] },
  ]

  const existingTables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map(r => r.name),
  )

  const appliedVersions = new Set(
    (db.prepare('SELECT version FROM _migrations').all() as Array<{ version: number }>)
      .map(r => r.version),
  )

  for (const entry of expectedTables) {
    if (!appliedVersions.has(entry.version)) continue // not yet applied — skip

    const missing = entry.tables.filter(t => !existingTables.has(t))
    if (missing.length === 0) continue

    // Find the migration SQL and re-run it
    const migration = migrations.find(m => m.version === entry.version)
    if (migration && 'sql' in migration && migration.sql) {
      console.warn(`[DB] Migration v${entry.version} recorded but tables missing: ${missing.join(', ')}. Re-running SQL.`)
      db.exec(migration.sql)
    } else if (migration && 'runFn' in migration && typeof migration.runFn === 'function') {
      console.warn(`[DB] Migration v${entry.version} recorded but tables missing: ${missing.join(', ')}. Re-running function.`)
      migration.runFn(db)
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

/**
 * SQLite-vec helper utilities.
 *
 * Kept in db.ts so search/indexing code can depend on one storage module
 * while embeddings implementation stays isolated in src/embeddings.ts.
 */
export async function embedTextForDb(text: string): Promise<Float32Array> {
  const { embed } = await import('./embeddings.js')
  return embed(text)
}

export async function embedBatchForDb(texts: string[]): Promise<Float32Array[]> {
  const { embedBatch } = await import('./embeddings.js')
  return embedBatch(texts)
}

/**
 * Initialize vector search tables (sqlite-vec).
 * Called lazily on first vector operation or explicitly at startup.
 * Safe to call multiple times.
 */
let _vecInitialized = false
export function initVectorSearch(): void {
  if (_vecInitialized) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { initVectorTables } = require('./vector-store.js')
    const db = getDb()
    initVectorTables(db)
    _vecInitialized = true
    console.log('[DB] Vector search tables initialized')
  } catch (err: any) {
    console.warn('[DB] Vector search not available:', err?.message)
  }
}

export function isVectorSearchAvailable(): boolean {
  return _vecInitialized
}

export function resetVecInitForTests(): void {
  _vecInitialized = false
}
