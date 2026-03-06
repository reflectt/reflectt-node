// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Scope Overlap Scanner
 *
 * When a PR merges, scans open tasks (doing/todo) for scope overlap:
 * - Branch name similarity
 * - Title keyword overlap
 * - Linked insight_id match
 *
 * Flags matches so assignees can confirm or close superseded work.
 * Prevents the parallel collision pattern (PR #582/#583 incident).
 */

import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import type { Task } from './types.js'

export interface ScopeOverlapMatch {
  taskId: string
  taskTitle: string
  assignee: string
  matchReason: string
  confidence: 'high' | 'medium' | 'low'
}

export interface ScopeOverlapResult {
  mergedPr: { number: number; title: string; branch: string; repo?: string }
  mergedTaskId?: string
  matches: ScopeOverlapMatch[]
  scanned: number
}

/**
 * Extract meaningful keywords from a string (title, branch name).
 * Strips common prefixes, splits on delimiters, lowercases.
 */
function extractKeywords(text: string): Set<string> {
  // Common noise words to filter out
  const noise = new Set([
    'feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'style',
    'the', 'a', 'an', 'in', 'on', 'for', 'to', 'of', 'and', 'or',
    'add', 'update', 'remove', 'with', 'from', 'is', 'task', 'pr',
  ])

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !noise.has(w))

  return new Set(words)
}

/**
 * Calculate keyword overlap ratio between two sets.
 * Returns 0-1 (proportion of smaller set matched).
 */
function keywordOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let matches = 0
  const smaller = a.size <= b.size ? a : b
  const larger = a.size > b.size ? a : b
  for (const word of smaller) {
    if (larger.has(word)) matches++
  }
  return matches / smaller.size
}

/**
 * Extract branch name from task metadata or infer from task ID.
 */
function getTaskBranch(task: Task): string | null {
  const meta = task.metadata || {}
  if (typeof meta.branch === 'string') return meta.branch
  if (typeof meta.pr_branch === 'string') return meta.pr_branch
  return null
}

/**
 * Extract insight_id from task metadata.
 */
function getInsightId(task: Task): string | null {
  const meta = task.metadata || {}
  if (typeof meta.insight_id === 'string') return meta.insight_id
  return null
}

/**
 * Scan open tasks for scope overlap with a merged PR.
 */
export function scanScopeOverlap(
  prNumber: number,
  prTitle: string,
  prBranch: string,
  mergedTaskId?: string,
  repo?: string,
): ScopeOverlapResult {
  const openTasks = [
    ...taskManager.listTasks({ status: 'doing' }),
    ...taskManager.listTasks({ status: 'todo' }),
  ]

  // Get the merged task's insight_id for cross-reference
  let mergedInsightId: string | null = null
  if (mergedTaskId) {
    const mergedTask = taskManager.getTask(mergedTaskId)
    if (mergedTask) {
      mergedInsightId = getInsightId(mergedTask)
    }
  }

  const prKeywords = extractKeywords(`${prTitle} ${prBranch}`)
  const matches: ScopeOverlapMatch[] = []

  for (const task of openTasks) {
    // Skip the task that owns the merged PR
    if (task.id === mergedTaskId) continue

    const reasons: string[] = []
    let confidence: 'high' | 'medium' | 'low' = 'low'

    // 1. Insight ID match (highest confidence)
    const taskInsightId = getInsightId(task)
    if (mergedInsightId && taskInsightId && mergedInsightId === taskInsightId) {
      reasons.push(`same insight: ${mergedInsightId}`)
      confidence = 'high'
    }

    // 2. Branch name match
    const taskBranch = getTaskBranch(task)
    if (taskBranch && prBranch) {
      const branchKeywords = extractKeywords(taskBranch)
      const branchOverlap = keywordOverlap(extractKeywords(prBranch), branchKeywords)
      if (branchOverlap >= 0.4) {
        reasons.push(`branch overlap: ${prBranch} ↔ ${taskBranch}`)
        confidence = confidence === 'high' ? 'high' : 'medium'
      }
    }

    // 3. Title keyword overlap
    const taskKeywords = extractKeywords(task.title)
    const titleOverlap = keywordOverlap(prKeywords, taskKeywords)
    if (titleOverlap >= 0.5) {
      reasons.push(`title overlap (${Math.round(titleOverlap * 100)}%)`)
      if (titleOverlap >= 0.7) {
        confidence = confidence === 'high' ? 'high' : 'medium'
      }
    }

    if (reasons.length > 0) {
      matches.push({
        taskId: task.id,
        taskTitle: task.title,
        assignee: task.assignee || 'unassigned',
        matchReason: reasons.join('; '),
        confidence,
      })
    }
  }

  // Sort: high confidence first
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
  matches.sort((a, b) => order[a.confidence] - order[b.confidence])

  return {
    mergedPr: { number: prNumber, title: prTitle, branch: prBranch, repo },
    mergedTaskId,
    matches,
    scanned: openTasks.length,
  }
}

/**
 * Scan and notify: run scope overlap scan and post results to chat.
 * Only posts when medium+ confidence matches are found.
 */
export async function scanAndNotify(
  prNumber: number,
  prTitle: string,
  prBranch: string,
  mergedTaskId?: string,
  repo?: string,
): Promise<ScopeOverlapResult> {
  const result = scanScopeOverlap(prNumber, prTitle, prBranch, mergedTaskId, repo)

  const significant = result.matches.filter(m => m.confidence !== 'low')
  if (significant.length === 0) return result

  // Build notification message
  const lines = [
    `⚠️ **Scope overlap detected** after PR #${prNumber} merged ("${prTitle}")`,
  ]

  for (const match of significant) {
    const mention = match.assignee !== 'unassigned' ? `@${match.assignee}` : 'unassigned'
    lines.push(
      `- ${mention}: **${match.taskTitle}** (${match.taskId}) — ${match.matchReason} [${match.confidence}]`,
    )
  }

  lines.push('', 'If your task is superseded by this PR, close it. If it\'s still needed, confirm and continue.')

  await chatManager.sendMessage({
    from: 'system',
    content: lines.join('\n'),
    channel: 'general',
  })

  return result
}
