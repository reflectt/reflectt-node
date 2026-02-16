import { describe, expect, it, beforeAll } from 'vitest'
import Database from 'better-sqlite3'

describe('vector-store', () => {
  let db: Database.Database

  beforeAll(() => {
    db = new Database(':memory:')

    // Try to load sqlite-vec
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require('sqlite-vec')
      sqliteVec.load(db)
    } catch {
      console.warn('sqlite-vec not available, skipping vector tests')
      return
    }
  })

  it('can load sqlite-vec extension and check version', () => {
    const row = db.prepare('SELECT vec_version() as v').get() as { v: string }
    expect(row.v).toBeTruthy()
    expect(typeof row.v).toBe('string')
  })

  it('can create vec0 virtual table', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS test_vec_meta (
        row_id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL
      )
    `)

    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS test_vec USING vec0(
        row_id INTEGER PRIMARY KEY,
        embedding float[4]
      )
    `)

    // Insert a vector
    const result = db.prepare('INSERT INTO test_vec_meta (label) VALUES (?)').run('hello')
    const rowId = result.lastInsertRowid

    const vec = new Float32Array([1.0, 0.0, 0.0, 0.0])
    db.prepare('INSERT INTO test_vec (row_id, embedding) VALUES (?, ?)').run(
      BigInt(rowId as number | bigint),
      Buffer.from(vec.buffer),
    )

    // Verify it was stored
    const count = db.prepare('SELECT COUNT(*) as c FROM test_vec_meta').get() as { c: number }
    expect(count.c).toBe(1)
  })

  it('can perform nearest neighbor search', () => {
    // Insert more vectors
    const vectors = [
      { label: 'north', vec: new Float32Array([0.0, 1.0, 0.0, 0.0]) },
      { label: 'east', vec: new Float32Array([0.0, 0.0, 1.0, 0.0]) },
      { label: 'south', vec: new Float32Array([0.0, -1.0, 0.0, 0.0]) },
    ]

    for (const v of vectors) {
      const result = db.prepare('INSERT INTO test_vec_meta (label) VALUES (?)').run(v.label)
      db.prepare('INSERT INTO test_vec (row_id, embedding) VALUES (?, ?)').run(
        BigInt(result.lastInsertRowid),
        Buffer.from(v.vec.buffer),
      )
    }

    // Search for something close to 'north'
    const queryVec = new Float32Array([0.1, 0.9, 0.1, 0.0])
    const results = db.prepare(`
      SELECT row_id, distance
      FROM test_vec
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT 3
    `).all(Buffer.from(queryVec.buffer)) as Array<{ row_id: number; distance: number }>

    expect(results.length).toBeGreaterThan(0)

    // The closest should be 'north' (row_id 2 — 'hello' is 1, 'north' is 2)
    const closestMeta = db.prepare('SELECT label FROM test_vec_meta WHERE row_id = ?').get(
      results[0].row_id,
    ) as { label: string }
    expect(closestMeta.label).toBe('north')
  })

  it('initVectorTables creates required tables', async () => {
    const testDb = new Database(':memory:')
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require('sqlite-vec')
      sqliteVec.load(testDb)
    } catch {
      return // skip if sqlite-vec not available
    }

    const { initVectorTables, upsertVector, searchVectors, vectorCount } = await import(
      '../src/vector-store.js'
    )

    // Reset the loaded flag since we're using a new db
    const { resetVecLoadedForTests } = await import('../src/vector-store.js')
    resetVecLoadedForTests()

    initVectorTables(testDb)

    // Should start empty
    expect(vectorCount(testDb)).toBe(0)

    // Insert a vector
    const vec = new Float32Array(384).fill(0.01)
    vec[0] = 1.0 // make it distinctive
    upsertVector(testDb, 'task', 'task-1', 'Fix the bug', vec)
    expect(vectorCount(testDb)).toBe(1)
    expect(vectorCount(testDb, 'task')).toBe(1)
    expect(vectorCount(testDb, 'chat')).toBe(0)

    // Upsert same source should replace
    const vec2 = new Float32Array(384).fill(0.02)
    vec2[0] = 0.9
    upsertVector(testDb, 'task', 'task-1', 'Fix the bug (updated)', vec2)
    expect(vectorCount(testDb)).toBe(1)

    // Insert another
    const vec3 = new Float32Array(384).fill(0.01)
    vec3[1] = 1.0
    upsertVector(testDb, 'chat', 'msg-1', 'Discussion about fixing bugs', vec3)
    expect(vectorCount(testDb)).toBe(2)
    expect(vectorCount(testDb, 'chat')).toBe(1)

    // Search — should find the closer one
    const queryVec = new Float32Array(384).fill(0.01)
    queryVec[0] = 0.95
    const results = searchVectors(testDb, queryVec, 5)
    expect(results.length).toBe(2)
    expect(results[0].sourceType).toBe('task')
    expect(results[0].sourceId).toBe('task-1')

    // Search with type filter
    const chatResults = searchVectors(testDb, queryVec, 5, 'chat')
    expect(chatResults.length).toBe(1)
    expect(chatResults[0].sourceType).toBe('chat')

    testDb.close()
  })

  it('deleteVector removes entry', async () => {
    const testDb = new Database(':memory:')
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteVec = require('sqlite-vec')
      sqliteVec.load(testDb)
    } catch {
      return
    }

    const { initVectorTables, upsertVector, deleteVector, vectorCount, resetVecLoadedForTests } =
      await import('../src/vector-store.js')

    resetVecLoadedForTests()
    initVectorTables(testDb)

    const vec = new Float32Array(384).fill(0.01)
    upsertVector(testDb, 'task', 'task-99', 'Some task', vec)
    expect(vectorCount(testDb)).toBe(1)

    const deleted = deleteVector(testDb, 'task', 'task-99')
    expect(deleted).toBe(true)
    expect(vectorCount(testDb)).toBe(0)

    const notFound = deleteVector(testDb, 'task', 'task-nonexistent')
    expect(notFound).toBe(false)

    testDb.close()
  })
})
