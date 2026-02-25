// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Knowledge Auto-Index Pipeline
 *
 * Automatically indexes knowledge into the vector store when:
 * 1. A task transitions to done (indexes artifacts, QA bundle, done criteria)
 * 2. Process files are written via API
 * 3. Task comments tagged as decisions are created
 *
 * Dedup: uses composite source IDs to prevent duplicate indexing.
 */

import { getDb } from './db.js'

// ── Dedup tracking ─────────────────────────────────────────────────────────

// Track what's been indexed this session to avoid redundant embedding calls
const indexedSet = new Set<string>()

function makeKey(sourceType: string, sourceId: string): string {
  return `${sourceType}::${sourceId}`
}

function alreadyIndexed(sourceType: string, sourceId: string): boolean {
  return indexedSet.has(makeKey(sourceType, sourceId))
}

function markIndexed(sourceType: string, sourceId: string): void {
  indexedSet.add(makeKey(sourceType, sourceId))
}

// ── Task Ship Indexing ─────────────────────────────────────────────────────

interface TaskShipData {
  taskId: string
  title: string
  description?: string | null
  doneCriteria?: string[] | null
  assignee?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Called when a task transitions to done.
 * Indexes: task content, QA bundle summary, artifact references.
 */
export async function onTaskShipped(data: TaskShipData): Promise<number> {
  let indexed = 0

  try {
    const { upsertVector } = await import('./vector-store.js')
    const { embed } = await import('./embeddings.js')
    const db = getDb()

    // 1. Index the task itself (may already be indexed, but update with final state)
    const taskKey = `task-ship::${data.taskId}`
    if (!alreadyIndexed('task_ship', taskKey)) {
      const parts = [`Task shipped: ${data.title}`]
      if (data.description) parts.push(data.description)
      if (data.doneCriteria?.length) parts.push(`Done: ${data.doneCriteria.join('. ')}`)
      if (data.assignee) parts.push(`By: ${data.assignee}`)
      const text = parts.join(' — ')

      const embedding = await embed(text)
      upsertVector(db, 'task_ship', data.taskId, text.slice(0, 500), embedding)
      markIndexed('task_ship', taskKey)
      indexed++
    }

    // 2. Index QA bundle summary if present
    const meta = data.metadata || {}
    const qaBundleSummary = (meta.qa_bundle as any)?.summary
    if (qaBundleSummary && typeof qaBundleSummary === 'string') {
      const qaKey = `qa::${data.taskId}`
      if (!alreadyIndexed('qa_bundle', qaKey)) {
        const qaText = `QA: ${data.title} — ${qaBundleSummary}`
        const embedding = await embed(qaText)
        upsertVector(db, 'qa_bundle', data.taskId, qaText.slice(0, 500), embedding)
        markIndexed('qa_bundle', qaKey)
        indexed++
      }
    }

    // 3. Index artifact paths/links
    const artifacts = (meta.artifacts as string[]) || []
    const artifactPath = meta.artifact_path as string | undefined
    if (artifactPath) artifacts.push(artifactPath)

    for (const artifact of artifacts) {
      const artKey = `artifact::${data.taskId}::${artifact}`
      if (!alreadyIndexed('artifact', artKey)) {
        const artText = `Artifact for "${data.title}": ${artifact}`
        const embedding = await embed(artText)
        upsertVector(db, 'artifact', `${data.taskId}::${artifact}`, artText.slice(0, 500), embedding)
        markIndexed('artifact', artKey)
        indexed++
      }
    }
  } catch (err: any) {
    console.error(`[KnowledgeAutoIndex] Failed to index shipped task ${data.taskId}:`, err?.message)
  }

  if (indexed > 0) {
    console.log(`[KnowledgeAutoIndex] Indexed ${indexed} entries for shipped task ${data.taskId}`)
  }

  return indexed
}

// ── Process File Indexing ──────────────────────────────────────────────────

/**
 * Called when a file in process/ is written via API or filesystem.
 * Re-indexes the file content.
 */
export async function onProcessFileWritten(filePath: string, content: string): Promise<boolean> {
  const key = `process_file::${filePath}`
  // Don't check alreadyIndexed for file writes — content may have changed
  try {
    const { upsertVector } = await import('./vector-store.js')
    const { embed } = await import('./embeddings.js')
    const db = getDb()

    const text = `File: ${filePath}\n${content.slice(0, 3000)}`
    const embedding = await embed(text)
    upsertVector(db, 'shared_file', filePath, text.slice(0, 500), embedding)
    markIndexed('shared_file', key)
    return true
  } catch (err: any) {
    console.error(`[KnowledgeAutoIndex] Failed to index process file ${filePath}:`, err?.message)
    return false
  }
}

// ── Decision Comment Indexing ──────────────────────────────────────────────

interface DecisionCommentData {
  taskId: string
  commentId: string
  author: string
  content: string
  taskTitle?: string
}

/**
 * Called when a task comment is created with category 'decision' or
 * contains decision-indicating content.
 */
export async function onDecisionComment(data: DecisionCommentData): Promise<boolean> {
  const key = `decision::${data.commentId}`
  if (alreadyIndexed('decision', key)) return false

  try {
    const { upsertVector } = await import('./vector-store.js')
    const { embed } = await import('./embeddings.js')
    const db = getDb()

    const parts = [`Decision on "${data.taskTitle || data.taskId}"`]
    parts.push(data.content)
    parts.push(`By: ${data.author}`)
    const text = parts.join(' — ')

    const embedding = await embed(text)
    upsertVector(db, 'decision', data.commentId, text.slice(0, 500), embedding)
    markIndexed('decision', key)
    return true
  } catch (err: any) {
    console.error(`[KnowledgeAutoIndex] Failed to index decision comment ${data.commentId}:`, err?.message)
    return false
  }
}

/**
 * Check if a comment looks like a decision.
 * Matches category=decision or content patterns.
 */
export function isDecisionComment(content: string, category?: string | null): boolean {
  if (category === 'decision') return true
  // Content heuristics
  const lower = content.toLowerCase()
  return lower.startsWith('decision:') || lower.includes('[decision]')
}
