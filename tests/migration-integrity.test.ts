// SPDX-License-Identifier: Apache-2.0
// Migration integrity check tests
// Proves: if a migration was recorded but its table is missing, it gets recreated on startup.

import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { runMigrations } from '../src/db.js'

describe('Migration integrity check', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const dir of tempDirs) {
      try { rmSync(dir, { recursive: true }) } catch { /* ok */ }
    }
    tempDirs.length = 0
  })

  function createTempDb(): Database.Database {
    const dir = mkdtempSync(join(tmpdir(), 'reflectt-test-'))
    tempDirs.push(dir)
    const db = new Database(join(dir, 'test.db'))
    db.pragma('journal_mode = WAL')
    return db
  }

  it('creates all expected tables on fresh database', () => {
    const db = createTempDb()
    runMigrations(db)

    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map(r => r.name),
    )

    // Check key tables from various migration versions
    expect(tables.has('tasks')).toBe(true)             // v1
    expect(tables.has('sync_ledger')).toBe(true)       // v2
    expect(tables.has('hosts')).toBe(true)              // v16
    expect(tables.has('system_loop_ticks')).toBe(true)  // v17

    db.close()
  })

  it('re-creates hosts table when v16 is recorded but table is missing', () => {
    const db = createTempDb()

    // First, run all migrations normally
    runMigrations(db)

    // Verify hosts exists
    const beforeTables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hosts'").all() as Array<{ name: string }>)
    expect(beforeTables.length).toBe(1)

    // Now simulate the bug: drop the hosts table but leave the migration record
    db.exec('DROP TABLE hosts')
    const afterDrop = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hosts'").all() as Array<{ name: string }>)
    expect(afterDrop.length).toBe(0)

    // Migration v16 should still be recorded
    const v16 = db.prepare('SELECT version FROM _migrations WHERE version = 16').get()
    expect(v16).toBeDefined()

    // Re-run migrations — integrity check should recreate the hosts table
    runMigrations(db)

    const restored = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hosts'").all() as Array<{ name: string }>)
    expect(restored.length).toBe(1)

    // Verify the table is functional
    db.exec("INSERT INTO hosts (id, status, last_seen_at, registered_at) VALUES ('test-host', 'online', 1000, 1000)")
    const row = db.prepare("SELECT id FROM hosts WHERE id = 'test-host'").get() as { id: string }
    expect(row.id).toBe('test-host')

    db.close()
  })

  it('re-creates multiple missing tables from different migrations', () => {
    const db = createTempDb()
    runMigrations(db)

    // Drop tables from two different migrations
    db.exec('DROP TABLE hosts')           // v16
    db.exec('DROP TABLE system_loop_ticks') // v17

    // Re-run migrations — both should be restored
    runMigrations(db)

    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map(r => r.name),
    )

    expect(tables.has('hosts')).toBe(true)
    expect(tables.has('system_loop_ticks')).toBe(true)

    db.close()
  })

  it('does not re-run migrations for tables that exist', () => {
    const db = createTempDb()
    runMigrations(db)

    // Insert a row into hosts
    db.exec("INSERT INTO hosts (id, status, last_seen_at, registered_at) VALUES ('persist-test', 'online', 1000, 1000)")

    // Re-run migrations — hosts table should not be dropped/recreated (CREATE TABLE IF NOT EXISTS)
    runMigrations(db)

    // Row should still exist
    const row = db.prepare("SELECT id FROM hosts WHERE id = 'persist-test'").get() as { id: string } | undefined
    expect(row?.id).toBe('persist-test')

    db.close()
  })
})
