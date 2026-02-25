// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Knowledge Documents — Structured team knowledge with tags and categories
 *
 * CRUD for durable knowledge articles: decisions, runbooks, architecture docs,
 * lessons, and how-tos. Auto-indexed in vector store for semantic search.
 */

import { getDb } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type DocCategory = 'decision' | 'runbook' | 'architecture' | 'lesson' | 'how-to'

export const VALID_CATEGORIES: DocCategory[] = ['decision', 'runbook', 'architecture', 'lesson', 'how-to']

export interface KnowledgeDoc {
  id: string
  title: string
  content: string               // markdown
  tags: string[]
  category: DocCategory
  author: string
  related_task_ids: string[]
  related_insight_ids: string[]
  created_at: number
  updated_at: number
}

export interface CreateDocInput {
  title: string
  content: string
  tags?: string[]
  category: DocCategory
  author: string
  related_task_ids?: string[]
  related_insight_ids?: string[]
}

export interface UpdateDocInput {
  title?: string
  content?: string
  tags?: string[]
  category?: DocCategory
  author?: string
  related_task_ids?: string[]
  related_insight_ids?: string[]
}

// ── Database setup ─────────────────────────────────────────────────────────

let initialized = false

function ensureTable(): void {
  if (initialized) return
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL CHECK(category IN ('decision', 'runbook', 'architecture', 'lesson', 'how-to')),
      author TEXT NOT NULL,
      related_task_ids_json TEXT NOT NULL DEFAULT '[]',
      related_insight_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_kdocs_category ON knowledge_docs(category)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_kdocs_author ON knowledge_docs(author)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_kdocs_created ON knowledge_docs(created_at)')

  initialized = true
}

// ── ID generation ──────────────────────────────────────────────────────────

function generateId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 10)
  return `kdoc-${ts}-${rand}`
}

// ── Row conversion ─────────────────────────────────────────────────────────

interface DocRow {
  id: string
  title: string
  content: string
  tags_json: string
  category: DocCategory
  author: string
  related_task_ids_json: string
  related_insight_ids_json: string
  created_at: number
  updated_at: number
}

function rowToDoc(row: DocRow): KnowledgeDoc {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    tags: JSON.parse(row.tags_json || '[]'),
    category: row.category,
    author: row.author,
    related_task_ids: JSON.parse(row.related_task_ids_json || '[]'),
    related_insight_ids: JSON.parse(row.related_insight_ids_json || '[]'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateCreateInput(input: CreateDocInput): string[] {
  const errors: string[] = []
  if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
    errors.push('title is required')
  }
  if (!input.content || typeof input.content !== 'string' || input.content.trim() === '') {
    errors.push('content is required')
  }
  if (!input.category || !VALID_CATEGORIES.includes(input.category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(', ')}`)
  }
  if (!input.author || typeof input.author !== 'string' || input.author.trim() === '') {
    errors.push('author is required')
  }
  if (input.tags && !Array.isArray(input.tags)) {
    errors.push('tags must be an array')
  }
  return errors
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export function createDoc(input: CreateDocInput): KnowledgeDoc {
  ensureTable()
  const errors = validateCreateInput(input)
  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join('; ')}`)
  }

  const db = getDb()
  const now = Date.now()
  const id = generateId()

  db.prepare(`
    INSERT INTO knowledge_docs (id, title, content, tags_json, category, author, related_task_ids_json, related_insight_ids_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title.trim(),
    input.content,
    JSON.stringify(input.tags || []),
    input.category,
    input.author.trim(),
    JSON.stringify(input.related_task_ids || []),
    JSON.stringify(input.related_insight_ids || []),
    now, now,
  )

  return getDoc(id)!
}

export function getDoc(id: string): KnowledgeDoc | null {
  ensureTable()
  const db = getDb()
  const row = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(id) as DocRow | undefined
  return row ? rowToDoc(row) : null
}

export function listDocs(filters?: {
  tag?: string
  category?: DocCategory
  author?: string
  search?: string        // simple text search in title/content
  limit?: number
}): KnowledgeDoc[] {
  ensureTable()
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filters?.category) {
    conditions.push('category = ?')
    params.push(filters.category)
  }
  if (filters?.author) {
    conditions.push('author = ?')
    params.push(filters.author)
  }
  if (filters?.search) {
    conditions.push('(title LIKE ? OR content LIKE ?)')
    const term = `%${filters.search}%`
    params.push(term, term)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filters?.limit || 100

  let docs = (db.prepare(`SELECT * FROM knowledge_docs ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params, limit) as DocRow[]).map(rowToDoc)

  // Post-filter: tag (JSON array in tags_json)
  if (filters?.tag) {
    const tag = filters.tag.toLowerCase()
    docs = docs.filter(d => d.tags.some(t => t.toLowerCase() === tag))
  }

  return docs
}

export function updateDoc(id: string, input: UpdateDocInput): KnowledgeDoc | null {
  ensureTable()
  const db = getDb()
  const existing = getDoc(id)
  if (!existing) return null

  const updates: string[] = []
  const params: unknown[] = []

  if (input.title !== undefined) {
    updates.push('title = ?')
    params.push(input.title.trim())
  }
  if (input.content !== undefined) {
    updates.push('content = ?')
    params.push(input.content)
  }
  if (input.tags !== undefined) {
    updates.push('tags_json = ?')
    params.push(JSON.stringify(input.tags))
  }
  if (input.category !== undefined) {
    if (!VALID_CATEGORIES.includes(input.category)) {
      throw new Error(`category must be one of: ${VALID_CATEGORIES.join(', ')}`)
    }
    updates.push('category = ?')
    params.push(input.category)
  }
  if (input.author !== undefined) {
    updates.push('author = ?')
    params.push(input.author.trim())
  }
  if (input.related_task_ids !== undefined) {
    updates.push('related_task_ids_json = ?')
    params.push(JSON.stringify(input.related_task_ids))
  }
  if (input.related_insight_ids !== undefined) {
    updates.push('related_insight_ids_json = ?')
    params.push(JSON.stringify(input.related_insight_ids))
  }

  if (updates.length === 0) return existing

  const now = Date.now()
  updates.push('updated_at = ?')
  params.push(now)
  params.push(id)

  db.prepare(`UPDATE knowledge_docs SET ${updates.join(', ')} WHERE id = ?`).run(...params)
  return getDoc(id)
}

export function deleteDoc(id: string): boolean {
  ensureTable()
  const db = getDb()
  const result = db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(id)
  return (result as any).changes > 0
}

export function countDocs(category?: DocCategory): number {
  ensureTable()
  const db = getDb()
  if (category) {
    return (db.prepare('SELECT COUNT(*) as c FROM knowledge_docs WHERE category = ?').get(category) as { c: number }).c
  }
  return (db.prepare('SELECT COUNT(*) as c FROM knowledge_docs').get() as { c: number }).c
}
