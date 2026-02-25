import { describe, it, expect, beforeAll, vi } from 'vitest'

// Mock the embeddings module to avoid needing a real model
vi.mock('../src/embeddings.js', () => ({
  embed: vi.fn(async (text: string) => {
    // Generate a deterministic pseudo-embedding from text hash
    const hash = simpleHash(text)
    const arr = new Float32Array(384)
    for (let i = 0; i < 384; i++) {
      arr[i] = Math.sin(hash + i * 0.1) * 0.5
    }
    return arr
  }),
  embedBatch: vi.fn(async (texts: string[]) => {
    const { embed } = await import('../src/embeddings.js')
    return Promise.all(texts.map(t => embed(t)))
  }),
}))

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

import { getDb } from '../src/db.js'
import {
  initVectorTables,
  loadVecExtension,
  indexReflection,
  indexInsight,
  reindexKnowledgeBase,
  semanticSearch,
  vectorCount,
} from '../src/vector-store.js'

let vecAvailable = false

beforeAll(() => {
  try {
    const db = getDb()
    loadVecExtension(db)
    initVectorTables(db)
    vecAvailable = true
  } catch {
    console.warn('sqlite-vec not available — skipping vector store knowledge tests')
  }
})

describe('Vector Store: Knowledge Base Indexing', () => {
  describe('indexReflection', () => {
    it.skipIf(!vecAvailable)('indexes a reflection', async () => {
      const db = getDb()
      const before = vectorCount(db, 'reflection')

      await indexReflection(
        'ref-test-001',
        'Sweeper fires too often',
        'Alert fatigue for all agents',
        'Add dedup logic to sweeper loop',
        ['task-123 generated 8+ alerts'],
        'link',
      )

      const after = vectorCount(db, 'reflection')
      expect(after).toBe(before + 1)
    })

    it.skipIf(!vecAvailable)('upserts on duplicate (same id)', async () => {
      const db = getDb()

      await indexReflection('ref-test-upsert', 'Original pain', 'Original impact', 'Original fix')
      const count1 = vectorCount(db, 'reflection')

      await indexReflection('ref-test-upsert', 'Updated pain', 'Updated impact', 'Updated fix')
      const count2 = vectorCount(db, 'reflection')

      expect(count2).toBe(count1) // Same count — upserted, not duplicated
    })
  })

  describe('indexInsight', () => {
    it.skipIf(!vecAvailable)('indexes an insight', async () => {
      const db = getDb()
      const before = vectorCount(db, 'insight')

      await indexInsight(
        'ins-test-001',
        'Sweeper alert spam',
        'ops::signal-noise::sweeper',
        ['8+ alerts in 30min', 'reviewers unreachable'],
        ['link', 'sage'],
      )

      const after = vectorCount(db, 'insight')
      expect(after).toBe(before + 1)
    })

    it.skipIf(!vecAvailable)('upserts on duplicate (same id)', async () => {
      const db = getDb()

      await indexInsight('ins-test-upsert', 'Original', 'ops::a::b')
      const count1 = vectorCount(db, 'insight')

      await indexInsight('ins-test-upsert', 'Updated', 'ops::a::b')
      const count2 = vectorCount(db, 'insight')

      expect(count2).toBe(count1)
    })
  })

  describe('semanticSearch', () => {
    it.skipIf(!vecAvailable)('returns reflections in search results', async () => {
      await indexReflection('ref-search-test', 'Database queries are slow', 'Page load > 5s', 'Add indexes to hot paths')

      const results = await semanticSearch('slow database queries', { limit: 20 })
      const reflectionResults = results.filter(r => r.sourceType === 'reflection')
      expect(reflectionResults.length).toBeGreaterThanOrEqual(1)
    })

    it.skipIf(!vecAvailable)('returns insights in search results', async () => {
      await indexInsight('ins-search-test', 'CI pipeline flaky', 'engineering::ci::pipeline')

      const results = await semanticSearch('flaky CI pipeline', { limit: 20 })
      const insightResults = results.filter(r => r.sourceType === 'insight')
      expect(insightResults.length).toBeGreaterThanOrEqual(1)
    })

    it.skipIf(!vecAvailable)('filters by type', async () => {
      await indexReflection('ref-filter-test', 'Auth flow broken', 'Users locked out', 'Fix token refresh')
      await indexInsight('ins-filter-test', 'Auth failures', 'engineering::auth::login')

      const reflectionsOnly = await semanticSearch('auth', { type: 'reflection', limit: 20 })
      expect(reflectionsOnly.every(r => r.sourceType === 'reflection')).toBe(true)

      const insightsOnly = await semanticSearch('auth', { type: 'insight', limit: 20 })
      expect(insightsOnly.every(r => r.sourceType === 'insight')).toBe(true)
    })
  })

  describe('reindexKnowledgeBase', () => {
    it.skipIf(!vecAvailable)('runs without error', async () => {
      const result = await reindexKnowledgeBase()
      expect(result).toHaveProperty('reflections')
      expect(result).toHaveProperty('insights')
      expect(result).toHaveProperty('errors')
      expect(typeof result.reflections).toBe('number')
      expect(typeof result.insights).toBe('number')
    })
  })
})
