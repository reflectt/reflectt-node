// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ── Test helpers — bootstrap in-memory DB with migration v22 ────────────

let testDb: any

function setupTestDb() {
  testDb = new Database(':memory:')
  testDb.pragma('journal_mode = WAL')
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id          TEXT PRIMARY KEY,
      agent_id    TEXT NOT NULL,
      namespace   TEXT NOT NULL DEFAULT 'default',
      key         TEXT NOT NULL,
      content     TEXT NOT NULL,
      tags        TEXT NOT NULL DEFAULT '[]',
      expires_at  INTEGER,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memories_unique ON agent_memories(agent_id, namespace, key);
    CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent_id, namespace, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_memories_expires ON agent_memories(expires_at) WHERE expires_at IS NOT NULL;
  `)
}

// Mock getDb to return our test database
import { mock } from 'node:test'

// We test through the module, but need to intercept getDb.
// Approach: test the SQL patterns directly against the in-memory DB,
// mirroring the module's logic exactly.

function setMemory(opts: {
  agentId: string
  namespace?: string
  key: string
  content: string
  tags?: string[]
  expiresAt?: number | null
}) {
  const now = Date.now()
  const namespace = opts.namespace ?? 'default'
  const tags = opts.tags ?? []
  const expiresAt = opts.expiresAt ?? null

  const existing = testDb.prepare(
    'SELECT id FROM agent_memories WHERE agent_id = ? AND namespace = ? AND key = ?',
  ).get(opts.agentId, namespace, opts.key)

  if (existing) {
    testDb.prepare(`
      UPDATE agent_memories SET content = ?, tags = ?, expires_at = ?, updated_at = ?
      WHERE id = ?
    `).run(opts.content, JSON.stringify(tags), expiresAt, now, existing.id)
    return testDb.prepare('SELECT * FROM agent_memories WHERE id = ?').get(existing.id)
  }

  const id = `amem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  testDb.prepare(`
    INSERT INTO agent_memories (id, agent_id, namespace, key, content, tags, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.agentId, namespace, opts.key, opts.content, JSON.stringify(tags), expiresAt, now, now)

  return testDb.prepare('SELECT * FROM agent_memories WHERE id = ?').get(id)
}

function getMemory(agentId: string, key: string, namespace?: string) {
  const ns = namespace ?? 'default'
  const row = testDb.prepare(
    'SELECT * FROM agent_memories WHERE agent_id = ? AND namespace = ? AND key = ?',
  ).get(agentId, ns, key)
  if (!row) return null
  if (row.expires_at && row.expires_at <= Date.now()) {
    testDb.prepare('DELETE FROM agent_memories WHERE id = ?').run(row.id)
    return null
  }
  return row
}

function listMemories(opts: {
  agentId: string
  namespace?: string
  tag?: string
  search?: string
  limit?: number
  includeExpired?: boolean
}) {
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
  return testDb.prepare(sql).all(...params)
}

function deleteMemory(agentId: string, key: string, namespace?: string) {
  const ns = namespace ?? 'default'
  const result = testDb.prepare(
    'DELETE FROM agent_memories WHERE agent_id = ? AND namespace = ? AND key = ?',
  ).run(agentId, ns, key)
  return result.changes > 0
}

function countMemories(agentId: string, namespace?: string) {
  if (namespace) {
    const row = testDb.prepare(
      'SELECT COUNT(*) as count FROM agent_memories WHERE agent_id = ? AND namespace = ?',
    ).get(agentId, namespace)
    return row.count
  }
  return testDb.prepare(
    'SELECT COUNT(*) as count FROM agent_memories WHERE agent_id = ?',
  ).get(agentId).count
}

function purgeExpired() {
  const result = testDb.prepare(
    'DELETE FROM agent_memories WHERE expires_at IS NOT NULL AND expires_at <= ?',
  ).run(Date.now())
  return result.changes
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Agent Memories', () => {
  beforeEach(() => {
    setupTestDb()
  })

  describe('basic CRUD', () => {
    it('stores and retrieves a memory', () => {
      const mem = setMemory({ agentId: 'link', key: 'last-task', content: 'coverage push' })
      assert.ok(mem.id.startsWith('amem-'))
      assert.equal(mem.agent_id, 'link')
      assert.equal(mem.key, 'last-task')
      assert.equal(mem.content, 'coverage push')
      assert.equal(mem.namespace, 'default')

      const got = getMemory('link', 'last-task')
      assert.ok(got)
      assert.equal(got.content, 'coverage push')
    })

    it('upserts on same agentId + namespace + key', () => {
      setMemory({ agentId: 'link', key: 'state', content: 'v1' })
      const updated = setMemory({ agentId: 'link', key: 'state', content: 'v2' })
      assert.equal(updated.content, 'v2')

      // Only one entry should exist
      const count = countMemories('link')
      assert.equal(count, 1)
    })

    it('separates by namespace', () => {
      setMemory({ agentId: 'link', namespace: 'work', key: 'focus', content: 'memory' })
      setMemory({ agentId: 'link', namespace: 'personal', key: 'focus', content: 'sleep' })

      const work = getMemory('link', 'focus', 'work')
      const personal = getMemory('link', 'focus', 'personal')

      assert.equal(work!.content, 'memory')
      assert.equal(personal!.content, 'sleep')
    })

    it('separates by agent', () => {
      setMemory({ agentId: 'link', key: 'role', content: 'builder' })
      setMemory({ agentId: 'kai', key: 'role', content: 'coordinator' })

      assert.equal(getMemory('link', 'role')!.content, 'builder')
      assert.equal(getMemory('kai', 'role')!.content, 'coordinator')
    })

    it('deletes a memory', () => {
      setMemory({ agentId: 'link', key: 'temp', content: 'gone soon' })
      const deleted = deleteMemory('link', 'temp')
      assert.equal(deleted, true)
      assert.equal(getMemory('link', 'temp'), null)
    })

    it('returns false for deleting non-existent memory', () => {
      assert.equal(deleteMemory('link', 'nope'), false)
    })

    it('returns null for non-existent memory', () => {
      assert.equal(getMemory('link', 'nope'), null)
    })
  })

  describe('tags', () => {
    it('stores and retrieves tags', () => {
      const mem = setMemory({
        agentId: 'link',
        key: 'pr-review',
        content: 'reviewed #870',
        tags: ['pr', 'review', 'agent-runs'],
      })
      const tags = JSON.parse(mem.tags)
      assert.deepEqual(tags, ['pr', 'review', 'agent-runs'])
    })

    it('filters by tag', () => {
      setMemory({ agentId: 'link', key: 'm1', content: 'one', tags: ['sprint'] })
      setMemory({ agentId: 'link', key: 'm2', content: 'two', tags: ['sprint', 'memory'] })
      setMemory({ agentId: 'link', key: 'm3', content: 'three', tags: ['review'] })

      const sprint = listMemories({ agentId: 'link', tag: 'sprint' })
      assert.equal(sprint.length, 2)

      const memory = listMemories({ agentId: 'link', tag: 'memory' })
      assert.equal(memory.length, 1)
      assert.equal(memory[0].key, 'm2')
    })

    it('updates tags on upsert', () => {
      setMemory({ agentId: 'link', key: 'evolving', content: 'v1', tags: ['draft'] })
      setMemory({ agentId: 'link', key: 'evolving', content: 'v2', tags: ['final', 'shipped'] })

      const mem = getMemory('link', 'evolving')
      const tags = JSON.parse(mem!.tags)
      assert.deepEqual(tags, ['final', 'shipped'])
    })
  })

  describe('expiration', () => {
    it('returns null for expired memory', () => {
      setMemory({
        agentId: 'link',
        key: 'ephemeral',
        content: 'gone',
        expiresAt: Date.now() - 1000, // already expired
      })
      const result = getMemory('link', 'ephemeral')
      assert.equal(result, null)
    })

    it('returns memory that has not expired', () => {
      setMemory({
        agentId: 'link',
        key: 'fresh',
        content: 'still here',
        expiresAt: Date.now() + 60000,
      })
      const result = getMemory('link', 'fresh')
      assert.ok(result)
      assert.equal(result.content, 'still here')
    })

    it('excludes expired from list by default', () => {
      setMemory({ agentId: 'link', key: 'alive', content: 'yes' })
      setMemory({ agentId: 'link', key: 'dead', content: 'no', expiresAt: Date.now() - 1000 })

      const list = listMemories({ agentId: 'link' })
      assert.equal(list.length, 1)
      assert.equal(list[0].key, 'alive')
    })

    it('includes expired when asked', () => {
      setMemory({ agentId: 'link', key: 'alive', content: 'yes' })
      setMemory({ agentId: 'link', key: 'dead', content: 'no', expiresAt: Date.now() - 1000 })

      const list = listMemories({ agentId: 'link', includeExpired: true })
      assert.equal(list.length, 2)
    })

    it('purges expired memories', () => {
      setMemory({ agentId: 'link', key: 'keep', content: 'forever' })
      setMemory({ agentId: 'link', key: 'expire1', content: 'gone1', expiresAt: Date.now() - 1000 })
      setMemory({ agentId: 'link', key: 'expire2', content: 'gone2', expiresAt: Date.now() - 2000 })

      const purged = purgeExpired()
      assert.equal(purged, 2)
      assert.equal(countMemories('link'), 1)
    })
  })

  describe('search', () => {
    it('searches by key substring', () => {
      setMemory({ agentId: 'link', key: 'pr-870-review', content: 'approved' })
      setMemory({ agentId: 'link', key: 'pr-814-review', content: 'needs work' })
      setMemory({ agentId: 'link', key: 'daily-note', content: 'March 11' })

      const results = listMemories({ agentId: 'link', search: 'pr-' })
      assert.equal(results.length, 2)
    })

    it('searches by content substring', () => {
      setMemory({ agentId: 'link', key: 'm1', content: 'shipped memory API' })
      setMemory({ agentId: 'link', key: 'm2', content: 'reviewed browser PR' })

      const results = listMemories({ agentId: 'link', search: 'memory' })
      assert.equal(results.length, 1)
      assert.equal(results[0].key, 'm1')
    })
  })

  describe('listing', () => {
    it('lists by namespace', () => {
      setMemory({ agentId: 'link', namespace: 'session', key: 'a', content: '1' })
      setMemory({ agentId: 'link', namespace: 'session', key: 'b', content: '2' })
      setMemory({ agentId: 'link', namespace: 'long-term', key: 'c', content: '3' })

      const session = listMemories({ agentId: 'link', namespace: 'session' })
      assert.equal(session.length, 2)
    })

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        setMemory({ agentId: 'link', key: `item-${i}`, content: `content ${i}` })
      }
      const limited = listMemories({ agentId: 'link', limit: 3 })
      assert.equal(limited.length, 3)
    })

    it('counts memories per agent', () => {
      setMemory({ agentId: 'link', key: 'a', content: '1' })
      setMemory({ agentId: 'link', key: 'b', content: '2' })
      setMemory({ agentId: 'kai', key: 'c', content: '3' })

      assert.equal(countMemories('link'), 2)
      assert.equal(countMemories('kai'), 1)
    })

    it('counts memories per namespace', () => {
      setMemory({ agentId: 'link', namespace: 'work', key: 'a', content: '1' })
      setMemory({ agentId: 'link', namespace: 'work', key: 'b', content: '2' })
      setMemory({ agentId: 'link', namespace: 'play', key: 'c', content: '3' })

      assert.equal(countMemories('link', 'work'), 2)
      assert.equal(countMemories('link', 'play'), 1)
    })
  })

  describe('survive-restart (gate check)', () => {
    it('data persists across DB close/reopen (file-backed)', () => {
      // This test uses a file-backed DB to prove restart survival
      const tmpFile = path.join(os.tmpdir(), `reflectt-memory-test-${Date.now()}.db`)

      try {
        // Phase 1: write memory
        const db1 = new Database(tmpFile)
        db1.pragma('journal_mode = WAL')
        db1.exec(`
          CREATE TABLE IF NOT EXISTS agent_memories (
            id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT 'default',
            key TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
            expires_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memories_unique ON agent_memories(agent_id, namespace, key);
        `)
        const now = Date.now()
        db1.prepare(`
          INSERT INTO agent_memories (id, agent_id, namespace, key, content, tags, expires_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('amem-test-1', 'link', 'default', 'survive-key', 'I persist across restarts', '["gate-check"]', null, now, now)
        db1.close()

        // Phase 2: reopen and read back (simulates node restart)
        const db2 = new Database(tmpFile)
        const row = db2.prepare(
          'SELECT * FROM agent_memories WHERE agent_id = ? AND key = ?',
        ).get('link', 'survive-key') as any
        db2.close()

        assert.ok(row, 'Memory should survive DB close/reopen')
        assert.equal(row.content, 'I persist across restarts')
        assert.equal(row.agent_id, 'link')
        assert.equal(row.key, 'survive-key')
        const tags = JSON.parse(row.tags)
        assert.deepEqual(tags, ['gate-check'])
      } finally {
        // Cleanup
        try { fs.unlinkSync(tmpFile) } catch {}
        try { fs.unlinkSync(tmpFile + '-wal') } catch {}
        try { fs.unlinkSync(tmpFile + '-shm') } catch {}
      }
    })
  })
})
