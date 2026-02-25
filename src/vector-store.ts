// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Vector store for semantic search using sqlite-vec.
 *
 * Stores embeddings alongside source metadata (type, id, text snippet).
 * All vectors stay local — no external API calls for storage or search.
 */

import type Database from 'better-sqlite3'
import { getDb } from './db.js'

// Embedding dimension for all-MiniLM-L6-v2
const EMBEDDING_DIM = 384

let _vecLoaded = false

/**
 * Load the sqlite-vec extension into the database connection.
 * Safe to call multiple times — only loads once per connection.
 */
export function loadVecExtension(db: Database.Database): void {
  if (_vecLoaded) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require('sqlite-vec')
    sqliteVec.load(db)
    _vecLoaded = true
  } catch (err: any) {
    console.error('[vector-store] Failed to load sqlite-vec extension:', err?.message)
    throw err
  }
}

/**
 * Reset the vec loaded flag (for tests)
 */
export function resetVecLoadedForTests(): void {
  _vecLoaded = false
}

/**
 * Initialize vector tables.
 * Called during migration v4.
 */
export function initVectorTables(db: Database.Database): void {
  loadVecExtension(db)

  // Metadata table for vector entries
  db.exec(`
    CREATE TABLE IF NOT EXISTS vec_metadata (
      row_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      text_snippet TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(source_type, source_id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vec_metadata_source
    ON vec_metadata(source_type, source_id)
  `)

  // Virtual table for vector search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
      row_id INTEGER PRIMARY KEY,
      embedding float[${EMBEDDING_DIM}]
    )
  `)
}

/**
 * Upsert a vector entry: store metadata + embedding.
 * If a record with the same source_type+source_id exists, it gets replaced.
 */
export function upsertVector(
  db: Database.Database,
  sourceType: string,
  sourceId: string,
  textSnippet: string,
  embedding: Float32Array,
): void {
  // Delete existing entry if present
  const existing = db.prepare(
    'SELECT row_id FROM vec_metadata WHERE source_type = ? AND source_id = ?'
  ).get(sourceType, sourceId) as { row_id: number } | undefined

  if (existing) {
    db.prepare('DELETE FROM vec_embeddings WHERE row_id = ?').run(BigInt(existing.row_id))
    db.prepare('DELETE FROM vec_metadata WHERE row_id = ?').run(existing.row_id)
  }

  // Insert metadata
  const result = db.prepare(
    'INSERT INTO vec_metadata (source_type, source_id, text_snippet, created_at) VALUES (?, ?, ?, ?)'
  ).run(sourceType, sourceId, textSnippet.slice(0, 500), Date.now())

  const rowId = BigInt(result.lastInsertRowid)

  // Insert embedding into vec0 virtual table
  db.prepare(
    'INSERT INTO vec_embeddings (row_id, embedding) VALUES (?, ?)'
  ).run(rowId, Buffer.from(embedding.buffer))
}

/**
 * Search for the nearest vectors to a query embedding.
 * Returns results sorted by distance (ascending = most similar first).
 */
export function searchVectors(
  db: Database.Database,
  queryEmbedding: Float32Array,
  limit: number = 10,
  sourceType?: string,
): Array<{
  sourceType: string
  sourceId: string
  textSnippet: string
  distance: number
}> {
  const queryBuffer = Buffer.from(queryEmbedding.buffer)

  // Query vec0 for nearest neighbors
  const rows = db.prepare(`
    SELECT row_id, distance
    FROM vec_embeddings
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(queryBuffer, limit * 2) as Array<{ row_id: number; distance: number }>

  if (rows.length === 0) return []

  // Fetch metadata for matched rows
  const results: Array<{
    sourceType: string
    sourceId: string
    textSnippet: string
    distance: number
  }> = []

  for (const row of rows) {
    const meta = db.prepare(
      'SELECT source_type, source_id, text_snippet FROM vec_metadata WHERE row_id = ?'
    ).get(row.row_id) as { source_type: string; source_id: string; text_snippet: string } | undefined

    if (!meta) continue

    // Filter by source type if specified
    if (sourceType && meta.source_type !== sourceType) continue

    results.push({
      sourceType: meta.source_type,
      sourceId: meta.source_id,
      textSnippet: meta.text_snippet,
      distance: row.distance,
    })

    if (results.length >= limit) break
  }

  return results
}

/**
 * Get the number of indexed vectors
 */
export function vectorCount(db: Database.Database, sourceType?: string): number {
  if (sourceType) {
    const row = db.prepare(
      'SELECT COUNT(*) as c FROM vec_metadata WHERE source_type = ?'
    ).get(sourceType) as { c: number }
    return row.c
  }
  const row = db.prepare('SELECT COUNT(*) as c FROM vec_metadata').get() as { c: number }
  return row.c
}

/**
 * Delete a vector entry by source type and id
 */
export function deleteVector(db: Database.Database, sourceType: string, sourceId: string): boolean {
  const existing = db.prepare(
    'SELECT row_id FROM vec_metadata WHERE source_type = ? AND source_id = ?'
  ).get(sourceType, sourceId) as { row_id: number } | undefined

  if (!existing) return false

  db.prepare('DELETE FROM vec_embeddings WHERE row_id = ?').run(BigInt(existing.row_id))
  db.prepare('DELETE FROM vec_metadata WHERE row_id = ?').run(existing.row_id)
  return true
}

/**
 * Index a task for semantic search.
 * Combines title + description + done criteria into searchable text.
 */
export async function indexTask(
  taskId: string,
  title: string,
  description?: string | null,
  doneCriteria?: string[] | null,
): Promise<void> {
  const parts = [title]
  if (description) parts.push(description)
  if (doneCriteria?.length) parts.push(doneCriteria.join('. '))
  const text = parts.join(' — ')

  const { embed } = await import('./embeddings.js')
  const embedding = await embed(text)

  const db = getDb()
  upsertVector(db, 'task', taskId, text, embedding)
}

/**
 * Index a chat message for semantic search.
 */
export async function indexChatMessage(
  messageId: string,
  content: string,
): Promise<void> {
  // Skip very short messages (not useful for search)
  if (content.trim().length < 10) return

  const { embed } = await import('./embeddings.js')
  const embedding = await embed(content)

  const db = getDb()
  upsertVector(db, 'chat', messageId, content, embedding)
}

/**
 * Index a reflection for semantic search.
 * Combines pain, impact, proposed_fix, and evidence into searchable text.
 */
export async function indexReflection(
  reflectionId: string,
  pain: string,
  impact: string,
  proposedFix: string,
  evidence?: string[] | null,
  author?: string,
): Promise<void> {
  const parts = [`Pain: ${pain}`, `Impact: ${impact}`, `Fix: ${proposedFix}`]
  if (evidence?.length) parts.push(`Evidence: ${evidence.join(', ')}`)
  if (author) parts.push(`Author: ${author}`)
  const text = parts.join(' — ')

  const { embed } = await import('./embeddings.js')
  const embedding = await embed(text)

  const db = getDb()
  upsertVector(db, 'reflection', reflectionId, text, embedding)
}

/**
 * Index an insight for semantic search.
 * Combines title, cluster key, evidence, and authors.
 */
export async function indexInsight(
  insightId: string,
  title: string,
  clusterKey: string,
  evidenceRefs?: string[] | null,
  authors?: string[] | null,
): Promise<void> {
  const parts = [title, `Cluster: ${clusterKey}`]
  if (evidenceRefs?.length) parts.push(`Evidence: ${evidenceRefs.join(', ')}`)
  if (authors?.length) parts.push(`Authors: ${authors.join(', ')}`)
  const text = parts.join(' — ')

  const { embed } = await import('./embeddings.js')
  const embedding = await embed(text)

  const db = getDb()
  upsertVector(db, 'insight', insightId, text, embedding)
}

/**
 * Reindex all reflections and insights (backfill).
 * Returns counts of indexed items.
 */
export async function reindexKnowledgeBase(): Promise<{
  reflections: number
  insights: number
  errors: number
}> {
  const db = getDb()
  let reflections = 0
  let insights = 0
  let errors = 0

  // Reindex reflections
  try {
    const rows = db.prepare('SELECT id, pain, impact, proposed_fix, evidence, author FROM reflections').all() as Array<{
      id: string; pain: string; impact: string; proposed_fix: string; evidence: string | null; author: string
    }>

    for (const row of rows) {
      try {
        const evidence = row.evidence ? JSON.parse(row.evidence) : null
        await indexReflection(row.id, row.pain, row.impact, row.proposed_fix, evidence, row.author)
        reflections++
      } catch (err: any) {
        console.error(`[vector-store] Failed to index reflection ${row.id}:`, err?.message)
        errors++
      }
    }
  } catch (err: any) {
    console.error('[vector-store] Failed to query reflections for reindex:', err?.message)
  }

  // Reindex insights
  try {
    const rows = db.prepare('SELECT id, title, cluster_key, evidence_refs, authors FROM insights').all() as Array<{
      id: string; title: string; cluster_key: string; evidence_refs: string | null; authors: string | null
    }>

    for (const row of rows) {
      try {
        const evidenceRefs = row.evidence_refs ? JSON.parse(row.evidence_refs) : null
        const authors = row.authors ? JSON.parse(row.authors) : null
        await indexInsight(row.id, row.title, row.cluster_key, evidenceRefs, authors)
        insights++
      } catch (err: any) {
        console.error(`[vector-store] Failed to index insight ${row.id}:`, err?.message)
        errors++
      }
    }
  } catch (err: any) {
    console.error('[vector-store] Failed to query insights for reindex:', err?.message)
  }

  console.log(`[vector-store] Reindex complete: ${reflections} reflections, ${insights} insights, ${errors} errors`)
  return { reflections, insights, errors }
}

/**
 * Semantic search across all indexed content.
 */
export async function semanticSearch(
  query: string,
  options?: { limit?: number; type?: string },
): Promise<Array<{
  sourceType: string
  sourceId: string
  textSnippet: string
  distance: number
  similarity: number
}>> {
  const { embed } = await import('./embeddings.js')
  const queryEmbedding = await embed(query)

  const db = getDb()
  const results = searchVectors(db, queryEmbedding, options?.limit ?? 10, options?.type)

  return results.map((r) => ({
    ...r,
    // Convert L2 distance to similarity score (0-1, higher = more similar)
    similarity: 1 / (1 + r.distance),
  }))
}
