// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Knowledge docs — structured knowledge articles with tags and categories.
 *
 * Gives the team a place to write durable knowledge beyond task artifacts
 * and reflections. Documents are auto-indexed in the vector store for
 * semantic search via /knowledge/search.
 *
 * Categories: decision, runbook, architecture, lesson, how-to
 * SQLite table: knowledge_docs
 */

import { getDb } from './db.js'

// ── Types ──

export const KNOWLEDGE_CATEGORIES = ['decision', 'runbook', 'architecture', 'lesson', 'how-to'] as const
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number]

export interface KnowledgeDoc {
  id: string
  title: string
  content: string            // markdown
  tags: string[]
  category: KnowledgeCategory
  author: string
  related_task_ids: string[]
  related_insight_ids: string[]
  created_at: number
  updated_at: number
}

export interface CreateKnowledgeDocInput {
  title: string
  content: string
  tags?: string[]
  category: KnowledgeCategory
  author: string
  related_task_ids?: string[]
  related_insight_ids?: string[]
}

export interface UpdateKnowledgeDocInput {
  title?: string
  content?: string
  tags?: string[]
  category?: KnowledgeCategory
  related_task_ids?: string[]
  related_insight_ids?: string[]
}

export interface KnowledgeDocListOpts {
  tag?: string
  category?: KnowledgeCategory
  author?: string
  q?: string
  limit?: number
  offset?: number
}

// ── DB row ──

interface KnowledgeDocRow {
  id: string
  title: string
  content: string
  tags: string            // JSON array
  category: string
  author: string
  related_task_ids: string // JSON array
  related_insight_ids: string // JSON array
  created_at: number
  updated_at: number
}

function rowToDoc(row: KnowledgeDocRow): KnowledgeDoc {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags || '[]'),
    category: row.category as KnowledgeCategory,
    author: row.author,
    related_task_ids: JSON.parse(row.related_task_ids || '[]'),
    related_insight_ids: JSON.parse(row.related_insight_ids || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function generateId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 11)
  return `kdoc-${ts}-${rand}`
}

// ── Migration ──

export function initKnowledgeDocsTable(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL,
      author TEXT NOT NULL,
      related_task_ids TEXT NOT NULL DEFAULT '[]',
      related_insight_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_docs_category ON knowledge_docs(category)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_knowledge_docs_author ON knowledge_docs(author)`)
}

// ── CRUD ──

export function createKnowledgeDoc(input: CreateKnowledgeDocInput): KnowledgeDoc {
  const db = getDb()
  const now = Date.now()
  const id = generateId()

  const doc: KnowledgeDoc = {
    id,
    title: input.title,
    content: input.content,
    tags: input.tags || [],
    category: input.category,
    author: input.author,
    related_task_ids: input.related_task_ids || [],
    related_insight_ids: input.related_insight_ids || [],
    created_at: now,
    updated_at: now,
  }

  db.prepare(`
    INSERT INTO knowledge_docs (id, title, content, tags, category, author, related_task_ids, related_insight_ids, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    doc.id, doc.title, doc.content,
    JSON.stringify(doc.tags), doc.category, doc.author,
    JSON.stringify(doc.related_task_ids), JSON.stringify(doc.related_insight_ids),
    doc.created_at, doc.updated_at,
  )

  return doc
}

export function getKnowledgeDoc(id: string): KnowledgeDoc | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(id) as KnowledgeDocRow | undefined
  return row ? rowToDoc(row) : null
}

export function updateKnowledgeDoc(id: string, input: UpdateKnowledgeDocInput): KnowledgeDoc | null {
  const db = getDb()
  const existing = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(id) as KnowledgeDocRow | undefined
  if (!existing) return null

  const now = Date.now()
  const sets: string[] = ['updated_at = ?']
  const params: unknown[] = [now]

  if (input.title !== undefined) { sets.push('title = ?'); params.push(input.title) }
  if (input.content !== undefined) { sets.push('content = ?'); params.push(input.content) }
  if (input.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(input.tags)) }
  if (input.category !== undefined) { sets.push('category = ?'); params.push(input.category) }
  if (input.related_task_ids !== undefined) { sets.push('related_task_ids = ?'); params.push(JSON.stringify(input.related_task_ids)) }
  if (input.related_insight_ids !== undefined) { sets.push('related_insight_ids = ?'); params.push(JSON.stringify(input.related_insight_ids)) }

  params.push(id)
  db.prepare(`UPDATE knowledge_docs SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  return getKnowledgeDoc(id)
}

export function deleteKnowledgeDoc(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(id)
  return result.changes > 0
}

export function listKnowledgeDocs(opts: KnowledgeDocListOpts = {}): { docs: KnowledgeDoc[]; total: number } {
  const db = getDb()
  const where: string[] = []
  const params: unknown[] = []

  if (opts.category) { where.push('category = ?'); params.push(opts.category) }
  if (opts.author) { where.push('author = ?'); params.push(opts.author) }
  if (opts.tag) { where.push("tags LIKE '%' || ? || '%'"); params.push(`"${opts.tag}"`) }
  if (opts.q) {
    where.push("(title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%')")
    params.push(opts.q, opts.q)
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(opts.limit || 50, 200)
  const offset = opts.offset || 0

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM knowledge_docs ${whereClause}`).get(...params) as { c: number }
  const rows = db.prepare(
    `SELECT * FROM knowledge_docs ${whereClause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as KnowledgeDocRow[]

  return { docs: rows.map(rowToDoc), total: countRow.c }
}

export function countKnowledgeDocs(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as c FROM knowledge_docs').get() as { c: number }
  return row.c
}
