import { describe, it, expect, beforeEach } from 'vitest'
import { detectWarmBoot, getSelfKeepaliveStatus, getBootInfo } from '../src/cf-keepalive.js'
import Database from 'better-sqlite3'

describe('cf-keepalive', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    // Set up minimal schema
    db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE chat_messages (
        id TEXT PRIMARY KEY,
        "from" TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        channel TEXT DEFAULT 'general'
      );
      CREATE TABLE hosts (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'online',
        last_seen_at INTEGER NOT NULL,
        registered_at INTEGER NOT NULL
      );
    `)
  })

  describe('detectWarmBoot', () => {
    it('detects cold start on empty database', () => {
      const info = detectWarmBoot(db)

      expect(info.isColdStart).toBe(true)
      expect(info.isWarmBoot).toBe(false)
      expect(info.recoveredState).toBeNull()
      expect(info.lastActivityAge).toBeNull()
    })

    it('detects warm boot with existing tasks', () => {
      db.prepare('INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)').run(
        'task-1', 'Test task', 'doing', Date.now() - 5000
      )

      const info = detectWarmBoot(db)

      expect(info.isColdStart).toBe(false)
      expect(info.isWarmBoot).toBe(true)
      expect(info.recoveredState).not.toBeNull()
      expect(info.recoveredState!.tasks).toBe(1)
      expect(info.lastActivityAge).toBeGreaterThan(0)
      expect(info.lastActivityAge).toBeLessThan(30_000) // Recent
    })

    it('detects warm boot with existing chat messages', () => {
      db.prepare('INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)').run(
        'msg-1', 'agent', 'hello', Date.now() - 10000, 'general'
      )

      const info = detectWarmBoot(db)

      expect(info.isColdStart).toBe(false)
      expect(info.isWarmBoot).toBe(true)
      expect(info.recoveredState!.chatMessages).toBe(1)
    })

    it('reports correct recovered state counts', () => {
      db.prepare('INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)').run(
        'task-1', 'Task 1', 'todo', Date.now()
      )
      db.prepare('INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)').run(
        'task-2', 'Task 2', 'doing', Date.now()
      )
      db.prepare('INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)').run(
        'msg-1', 'agent', 'hi', Date.now(), 'general'
      )
      db.prepare('INSERT INTO hosts (id, status, last_seen_at, registered_at) VALUES (?, ?, ?, ?)').run(
        'host-1', 'online', Date.now(), Date.now()
      )

      const info = detectWarmBoot(db)

      expect(info.recoveredState!.tasks).toBe(2)
      expect(info.recoveredState!.chatMessages).toBe(1)
      expect(info.recoveredState!.hosts).toBe(1)
    })

    it('calculates lastActivityAge from most recent activity', () => {
      const oldTime = Date.now() - 60_000 // 1 min ago
      const recentTime = Date.now() - 5_000 // 5s ago

      db.prepare('INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)').run(
        'task-1', 'Old task', 'todo', oldTime
      )
      db.prepare('INSERT INTO chat_messages (id, "from", content, timestamp, channel) VALUES (?, ?, ?, ?, ?)').run(
        'msg-1', 'agent', 'recent', recentTime, 'general'
      )

      const info = detectWarmBoot(db)

      // Should use the most recent timestamp (chat message at 5s ago)
      expect(info.lastActivityAge).toBeLessThan(15_000)
    })

    it('handles missing reflections table gracefully', () => {
      // reflections table doesn't exist in our minimal schema
      db.prepare('INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)').run(
        'task-1', 'Task', 'todo', Date.now()
      )

      const info = detectWarmBoot(db)

      expect(info.isWarmBoot).toBe(true)
      expect(info.recoveredState!.reflections).toBe(0) // graceful fallback
    })

    it('stores boot info accessible via getBootInfo', () => {
      detectWarmBoot(db)

      const bootInfo = getBootInfo()
      expect(bootInfo).not.toBeNull()
      expect(bootInfo!.isColdStart).toBe(true) // empty DB
    })
  })

  describe('getSelfKeepaliveStatus', () => {
    it('returns disabled state by default', () => {
      const status = getSelfKeepaliveStatus()

      expect(status.enabled).toBe(false)
      expect(status.intervalMs).toBe(4 * 60 * 1000)
      expect(status.lastPingAt).toBeNull()
      expect(status.environment).toBeDefined()
    })
  })

  describe('cold start → warm boot recovery flow', () => {
    it('correctly transitions from cold to warm on restart simulation', () => {
      // First boot: cold start (empty DB)
      const firstBoot = detectWarmBoot(db)
      expect(firstBoot.isColdStart).toBe(true)

      // Simulate work during uptime
      db.prepare('INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)').run(
        'task-after-boot', 'Created after boot', 'doing', Date.now()
      )

      // "Restart" — detectWarmBoot again (simulating process restart)
      const secondBoot = detectWarmBoot(db)
      expect(secondBoot.isColdStart).toBe(false)
      expect(secondBoot.isWarmBoot).toBe(true)
      expect(secondBoot.recoveredState!.tasks).toBe(1)
    })
  })
})
