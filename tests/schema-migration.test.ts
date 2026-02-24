import { describe, expect, it, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { runMigrations } from '../src/db.js'

/**
 * Schema migration coverage for the reflection/insight pipeline.
 *
 * Tests come in two tiers:
 * 1. **Unit tests** — replicate migration SQL locally to verify logic
 * 2. **Integration tests** — call the real `runMigrations()` from src/db.ts
 *    to ensure the actual code path produces the expected schema
 *
 * The integration tier closes the gap where local helpers could drift
 * from the real migration code (the root cause of ins-1771944724516-d3dbxwwxg).
 */

// ── Helpers ────────────────────────────────────────────────────────────

function tmpDbPath(): string {
  const dir = join(tmpdir(), `reflectt-migration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return join(dir, 'test.db')
}

const cleanupPaths: string[] = []

afterEach(() => {
  for (const p of cleanupPaths) {
    try { rmSync(p, { recursive: true, force: true }) } catch {}
  }
  cleanupPaths.length = 0
})

/** Create a DB at a specific schema version (simulates an older install) */
function createDbAtVersion(dbPath: string, targetVersion: number): Database.Database {
  cleanupPaths.push(join(dbPath, '..'))

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // v1: base tables
  if (targetVersion >= 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        assignee TEXT,
        reviewer TEXT,
        done_criteria TEXT,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        priority TEXT,
        blocked_by TEXT,
        epic_id TEXT,
        tags TEXT,
        metadata TEXT,
        comment_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        "from" TEXT NOT NULL,
        "to" TEXT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        channel TEXT DEFAULT 'general',
        reactions TEXT,
        thread_id TEXT,
        reply_count INTEGER DEFAULT 0,
        metadata TEXT
      );
    `)
    db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(1)
  }

  // v7: reflections table
  if (targetVersion >= 7) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reflections (
        id TEXT PRIMARY KEY,
        pain TEXT NOT NULL,
        impact TEXT NOT NULL,
        evidence TEXT NOT NULL,
        went_well TEXT NOT NULL,
        suspected_why TEXT NOT NULL,
        proposed_fix TEXT NOT NULL,
        confidence REAL NOT NULL,
        role_type TEXT NOT NULL,
        severity TEXT,
        author TEXT NOT NULL,
        task_id TEXT,
        tags TEXT,
        team_id TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    for (let v = 2; v <= 7; v++) {
      db.prepare('INSERT OR IGNORE INTO _migrations (version) VALUES (?)').run(v)
    }
  }

  // v8: insights table (WITHOUT task_id — the original schema)
  if (targetVersion >= 8) {
    db.exec(`
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
        reflection_ids TEXT NOT NULL,
        independent_count INTEGER NOT NULL DEFAULT 0,
        evidence_refs TEXT NOT NULL,
        authors TEXT NOT NULL,
        promotion_readiness TEXT NOT NULL DEFAULT 'not_ready',
        recurring_candidate INTEGER NOT NULL DEFAULT 0,
        cooldown_until INTEGER,
        cooldown_reason TEXT,
        severity_max TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    db.prepare('INSERT OR IGNORE INTO _migrations (version) VALUES (?)').run(8)
  }

  return db
}

/** Run migrations v9+ on an existing DB (simulates upgrade) */
function applyMigration9(db: Database.Database): void {
  const cols = db.pragma('table_info(insights)') as Array<{ name: string }>
  if (!cols.some(c => c.name === 'task_id')) {
    db.exec('ALTER TABLE insights ADD COLUMN task_id TEXT')
  }
  db.prepare('INSERT OR IGNORE INTO _migrations (version) VALUES (?)').run(9)
}

function applyMigration11(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(insights)").all() as Array<{ name: string }>
  if (!cols.some(c => c.name === 'task_id')) {
    db.exec("ALTER TABLE insights ADD COLUMN task_id TEXT DEFAULT NULL")
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_insights_task_id ON insights(task_id)")
  db.prepare('INSERT OR IGNORE INTO _migrations (version) VALUES (?)').run(11)
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('schema migration: insight→task linkage', () => {

  it('v8 → v9: ALTER TABLE adds task_id to insights', () => {
    const dbPath = tmpDbPath()
    const db = createDbAtVersion(dbPath, 8)

    // Verify task_id does NOT exist at v8
    const colsBefore = db.pragma('table_info(insights)') as Array<{ name: string }>
    expect(colsBefore.some(c => c.name === 'task_id')).toBe(false)

    // Insert a pre-migration insight
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, status, score, priority, reflection_ids, independent_count, evidence_refs,
        authors, promotion_readiness, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-pre-v9', 'cluster-1', 'testing', 'schema', 'db',
      'Test insight', 'candidate', 5.0, 'P2', '[]', 1, '[]', '["link"]', 'not_ready',
      Date.now(), Date.now())

    // Apply v9 migration
    applyMigration9(db)

    // Verify task_id exists
    const colsAfter = db.pragma('table_info(insights)') as Array<{ name: string }>
    expect(colsAfter.some(c => c.name === 'task_id')).toBe(true)

    // Verify pre-existing insight survives with task_id = null
    const row = db.prepare('SELECT id, task_id FROM insights WHERE id = ?').get('ins-pre-v9') as any
    expect(row.id).toBe('ins-pre-v9')
    expect(row.task_id).toBeNull()

    // Verify we can now set task_id on the existing insight
    db.prepare('UPDATE insights SET task_id = ? WHERE id = ?').run('task-linked-1', 'ins-pre-v9')
    const updated = db.prepare('SELECT task_id FROM insights WHERE id = ?').get('ins-pre-v9') as any
    expect(updated.task_id).toBe('task-linked-1')

    db.close()
  })

  it('v9 → v11: idempotent re-ADD of task_id + index', () => {
    const dbPath = tmpDbPath()
    const db = createDbAtVersion(dbPath, 8)

    // Apply v9 first
    applyMigration9(db)

    // Insert an insight with task_id set
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, status, score, priority, reflection_ids, independent_count, evidence_refs,
        authors, promotion_readiness, task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-with-task', 'cluster-2', 'testing', 'migration', 'db',
      'Linked insight', 'promoted', 7.0, 'P1', '["ref-1"]', 2, '["ev-1"]', '["sage"]',
      'ready', 'task-linked-2', Date.now(), Date.now())

    // Apply v11 (should be idempotent — no error)
    expect(() => applyMigration11(db)).not.toThrow()

    // Verify data intact
    const row = db.prepare('SELECT id, task_id FROM insights WHERE id = ?').get('ins-with-task') as any
    expect(row.task_id).toBe('task-linked-2')

    // Verify index exists
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='insights'").all() as Array<{ name: string }>
    expect(indexes.some(i => i.name === 'idx_insights_task_id')).toBe(true)

    db.close()
  })

  it('v8 → v11 (skip v9): direct migration still works', () => {
    const dbPath = tmpDbPath()
    const db = createDbAtVersion(dbPath, 8)

    // Skip v9, apply v11 directly — simulates a DB that jumped versions
    applyMigration11(db)

    const cols = db.pragma('table_info(insights)') as Array<{ name: string }>
    expect(cols.some(c => c.name === 'task_id')).toBe(true)

    // Can write + read task_id
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, reflection_ids, evidence_refs, authors, task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-direct', 'c3', 'triage', 'link', 'pipeline',
      'Direct v11', '[]', '[]', '[]', 'task-direct', Date.now(), Date.now())

    const row = db.prepare('SELECT task_id FROM insights WHERE id = ?').get('ins-direct') as any
    expect(row.task_id).toBe('task-direct')

    db.close()
  })

  // ── Regression: prior failure mode ──────────────────────────────────
  // The failure was: insights created at v8 (no task_id column) then
  // promotion tried to UPDATE insights SET task_id = ? → SQL error.
  it('regression: promoting insight sets task_id on v8-origin DB after migration', () => {
    const dbPath = tmpDbPath()
    const db = createDbAtVersion(dbPath, 8)

    // Insert insight at v8 (no task_id column)
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, status, score, priority, reflection_ids, independent_count, evidence_refs,
        authors, promotion_readiness, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-promote-test', 'cluster-promote', 'testing', 'schema', 'db',
      'Promotable insight', 'candidate', 8.0, 'P0', '["ref-1","ref-2"]', 3,
      '["evidence-1"]', '["sage","link"]', 'ready', Date.now(), Date.now())

    // Simulate the promotion failure: try UPDATE with task_id before migration
    expect(() => {
      db.prepare('UPDATE insights SET task_id = ? WHERE id = ?').run('task-promoted', 'ins-promote-test')
    }).toThrow() // Should fail — column doesn't exist yet

    // Now apply migrations
    applyMigration9(db)
    applyMigration11(db)

    // Retry promotion — should succeed now
    db.prepare('UPDATE insights SET task_id = ?, status = ? WHERE id = ?')
      .run('task-promoted', 'promoted', 'ins-promote-test')

    const row = db.prepare('SELECT id, task_id, status FROM insights WHERE id = ?')
      .get('ins-promote-test') as any
    expect(row.task_id).toBe('task-promoted')
    expect(row.status).toBe('promoted')

    db.close()
  })

  it('reflection→insight→task linkage survives full migration chain', () => {
    const dbPath = tmpDbPath()
    const db = createDbAtVersion(dbPath, 8)

    // Create a reflection
    db.prepare(`
      INSERT INTO reflections (id, pain, impact, evidence, went_well, suspected_why,
        proposed_fix, confidence, role_type, severity, author, task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ref-chain-1', 'Test pain', 'Test impact', '["ev"]', 'Good',
      'Root cause', 'Fix it', 7.5, 'engineering', 'high', 'link', null,
      Date.now(), Date.now())

    // Create an insight (v8 — no task_id)
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, status, reflection_ids, evidence_refs, authors, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-chain-1', 'c-chain', 'engineering', 'testing', 'pipeline',
      'Chain insight', 'candidate', '["ref-chain-1"]', '["ev"]', '["link"]',
      Date.now(), Date.now())

    // Migrate
    applyMigration9(db)
    applyMigration11(db)

    // Create a task
    db.prepare(`
      INSERT INTO tasks (id, title, status, created_by, created_at, updated_at, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('task-chain-1', 'Fix chain issue', 'todo', 'insight-bridge',
      Date.now(), Date.now(), 'P1')

    // Link insight → task
    db.prepare('UPDATE insights SET task_id = ?, status = ? WHERE id = ?')
      .run('task-chain-1', 'promoted', 'ins-chain-1')

    // Link reflection → task
    db.prepare('UPDATE reflections SET task_id = ? WHERE id = ?')
      .run('task-chain-1', 'ref-chain-1')

    // Verify full chain
    const insight = db.prepare('SELECT task_id FROM insights WHERE id = ?').get('ins-chain-1') as any
    const reflection = db.prepare('SELECT task_id FROM reflections WHERE id = ?').get('ref-chain-1') as any

    expect(insight.task_id).toBe('task-chain-1')
    expect(reflection.task_id).toBe('task-chain-1')

    db.close()
  })
})

// ── Integration tests: real runMigrations() code path ─────────────────
// These call the actual runMigrations() from src/db.ts rather than
// local helper functions, ensuring the production migration code
// produces the expected schema. This is the key gap identified by
// insight ins-1771944724516-d3dbxwwxg.

describe('schema migration integration: real runMigrations()', () => {

  it('fresh DB: runMigrations() creates insights table with task_id column', () => {
    const dbPath = tmpDbPath()
    const db = new Database(dbPath)
    cleanupPaths.push(join(dbPath, '..'))
    db.pragma('journal_mode = WAL')

    // Run the REAL migration code
    runMigrations(db)

    // Verify insights table exists with task_id
    const cols = db.pragma('table_info(insights)') as Array<{ name: string; type: string }>
    expect(cols.some(c => c.name === 'task_id')).toBe(true)

    // Verify index exists
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='insights'"
    ).all() as Array<{ name: string }>
    expect(indexes.some(i => i.name === 'idx_insights_task_id')).toBe(true)

    // Verify we can INSERT + read back task_id
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, reflection_ids, evidence_refs, authors, task_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-fresh-1', 'cluster', 'testing', 'schema', 'db',
      'Fresh DB insight', '[]', '[]', '["link"]', 'task-fresh-1',
      Date.now(), Date.now())

    const row = db.prepare('SELECT task_id FROM insights WHERE id = ?').get('ins-fresh-1') as any
    expect(row.task_id).toBe('task-fresh-1')

    db.close()
  })

  it('v8 DB upgraded via real runMigrations(): task_id column added', () => {
    const dbPath = tmpDbPath()
    // Create a v8-era DB manually (simulates old install)
    const db = createDbAtVersion(dbPath, 8)

    // Verify task_id does NOT exist at v8
    const colsBefore = db.pragma('table_info(insights)') as Array<{ name: string }>
    expect(colsBefore.some(c => c.name === 'task_id')).toBe(false)

    // Insert a pre-migration insight
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, status, score, priority, reflection_ids, independent_count, evidence_refs,
        authors, promotion_readiness, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-v8-upgrade', 'cluster-x', 'testing', 'schema', 'db',
      'Pre-migration insight', 'candidate', 6.0, 'P2', '[]', 1, '[]',
      '["link"]', 'not_ready', Date.now(), Date.now())

    // Run the REAL migration code — should apply v9+ idempotently
    runMigrations(db)

    // Verify task_id now exists
    const colsAfter = db.pragma('table_info(insights)') as Array<{ name: string }>
    expect(colsAfter.some(c => c.name === 'task_id')).toBe(true)

    // Verify pre-existing data survives
    const row = db.prepare('SELECT id, task_id FROM insights WHERE id = ?').get('ins-v8-upgrade') as any
    expect(row.id).toBe('ins-v8-upgrade')
    expect(row.task_id).toBeNull()

    // Verify UPDATE task_id works (the original failure mode)
    db.prepare('UPDATE insights SET task_id = ? WHERE id = ?').run('task-upgraded', 'ins-v8-upgrade')
    const updated = db.prepare('SELECT task_id FROM insights WHERE id = ?').get('ins-v8-upgrade') as any
    expect(updated.task_id).toBe('task-upgraded')

    db.close()
  })

  it('v8 DB: real runMigrations() is idempotent on double-call', () => {
    const dbPath = tmpDbPath()
    const db = createDbAtVersion(dbPath, 8)

    // Run migrations twice — must not throw
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()

    // Schema still correct
    const cols = db.pragma('table_info(insights)') as Array<{ name: string }>
    expect(cols.some(c => c.name === 'task_id')).toBe(true)

    db.close()
  })

  it('real runMigrations() on v8 DB: promotion UPDATE succeeds post-migration', () => {
    const dbPath = tmpDbPath()
    const db = createDbAtVersion(dbPath, 8)

    // Insert insight at v8 (no task_id column)
    db.prepare(`
      INSERT INTO insights (id, cluster_key, workflow_stage, failure_family, impacted_unit,
        title, status, score, priority, reflection_ids, independent_count, evidence_refs,
        authors, promotion_readiness, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('ins-real-promote', 'cluster-rp', 'testing', 'migration', 'db',
      'Promotable insight', 'candidate', 9.0, 'P0', '["ref-rp"]', 2,
      '["ev-rp"]', '["sage","link"]', 'ready', Date.now(), Date.now())

    // Before migration: UPDATE task_id should fail
    expect(() => {
      db.prepare('UPDATE insights SET task_id = ? WHERE id = ?').run('task-x', 'ins-real-promote')
    }).toThrow()

    // Apply REAL migrations
    runMigrations(db)

    // After migration: UPDATE task_id should succeed
    expect(() => {
      db.prepare('UPDATE insights SET task_id = ?, status = ? WHERE id = ?')
        .run('task-promoted-real', 'promoted', 'ins-real-promote')
    }).not.toThrow()

    const row = db.prepare('SELECT task_id, status FROM insights WHERE id = ?')
      .get('ins-real-promote') as any
    expect(row.task_id).toBe('task-promoted-real')
    expect(row.status).toBe('promoted')

    db.close()
  })

  it('real runMigrations() applies all expected versions', () => {
    const dbPath = tmpDbPath()
    const db = new Database(dbPath)
    cleanupPaths.push(join(dbPath, '..'))
    db.pragma('journal_mode = WAL')

    runMigrations(db)

    // Check migration versions recorded
    const versions = db.prepare('SELECT version FROM _migrations ORDER BY version')
      .all() as Array<{ version: number }>
    const versionNums = versions.map(v => v.version)

    // Should have at least v1 through v12
    expect(versionNums).toContain(1)
    expect(versionNums).toContain(8) // insights table
    expect(versionNums).toContain(9) // task_id ALTER
    expect(versionNums).toContain(11) // task_id idempotent + index
    expect(versionNums).toContain(12) // compound indexes

    // All tables should exist
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations'"
    ).all() as Array<{ name: string }>
    const tableNames = tables.map(t => t.name)

    expect(tableNames).toContain('tasks')
    expect(tableNames).toContain('insights')
    expect(tableNames).toContain('reflections')
    expect(tableNames).toContain('chat_messages')

    db.close()
  })
})
