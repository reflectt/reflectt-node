// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Since-Last-Seen Change Feed
 *
 * Unified timeline of changes relevant to an agent since a given timestamp.
 * Covers: task state changes, PR merges, deploys, reviewer comments,
 * direct mentions, and assignment changes.
 *
 * Agents can catch up after deep work without reading all of #general.
 */

import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import type { Task, TaskHistoryEvent, TaskComment } from './types.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type FeedEventKind =
  | 'task_created'
  | 'task_status_changed'
  | 'task_assigned'
  | 'task_commented'
  | 'task_completed'
  | 'pr_merged'
  | 'mention'
  | 'review_requested'
  | 'deploy'
  | 'blocker'
  | 'digest'

export interface FeedEvent {
  id: string
  kind: FeedEventKind
  timestamp: number
  /** Agent this event is relevant to (null = relevant to all) */
  relevantTo: string | null
  /** Source agent/actor */
  actor: string
  /** Human-readable summary */
  summary: string
  /** Related task ID if applicable */
  taskId: string | null
  /** Related PR URL if applicable */
  prUrl: string | null
  /** Raw data for programmatic consumption */
  data: Record<string, unknown>
}

export interface FeedOptions {
  /** Return events since this timestamp (required) */
  since: number
  /** Maximum events to return (default: 100) */
  limit?: number
  /** Filter to specific event kinds */
  kinds?: FeedEventKind[]
  /** Include events relevant to all agents (default: true) */
  includeGlobal?: boolean
}

export interface FeedResult {
  agent: string
  since: number
  until: number
  events: FeedEvent[]
  count: number
  hasMore: boolean
}

// ── Feed Builder ───────────────────────────────────────────────────────────

export function buildAgentFeed(agent: string, options: FeedOptions): FeedResult {
  const since = options.since
  const limit = options.limit ?? 100
  const includeGlobal = options.includeGlobal ?? true
  const now = Date.now()
  const agentLower = agent.toLowerCase()

  const events: FeedEvent[] = []

  // 1. Task state changes from history
  collectTaskEvents(agentLower, since, events)

  // 2. Task comments (on agent's tasks or mentioning agent)
  collectTaskComments(agentLower, since, events)

  // 3. Chat mentions and relevant messages
  collectChatEvents(agentLower, since, events)

  // 4. PR/deploy signals from chat
  collectPrAndDeployEvents(agentLower, since, events)

  // Filter by relevance
  let filtered = events.filter(e =>
    e.relevantTo === agentLower || (includeGlobal && e.relevantTo === null),
  )

  // Filter by kinds if specified
  if (options.kinds?.length) {
    const kindSet = new Set(options.kinds)
    filtered = filtered.filter(e => kindSet.has(e.kind))
  }

  // Sort by timestamp descending (most recent first)
  filtered.sort((a, b) => b.timestamp - a.timestamp)

  // Deduplicate by id
  const seen = new Set<string>()
  const deduped: FeedEvent[] = []
  for (const event of filtered) {
    if (!seen.has(event.id)) {
      seen.add(event.id)
      deduped.push(event)
    }
  }

  const hasMore = deduped.length > limit
  const result = deduped.slice(0, limit)

  return {
    agent: agentLower,
    since,
    until: now,
    events: result,
    count: result.length,
    hasMore,
  }
}

// ── Collectors ─────────────────────────────────────────────────────────────

function collectTaskEvents(agent: string, since: number, events: FeedEvent[]): void {
  const allTasks = taskManager.listTasks({})

  for (const task of allTasks) {
    const history = taskManager.getTaskHistory(task.id)

    for (const event of history) {
      if (event.timestamp < since) continue

      const isRelevant = isTaskRelevantToAgent(task, agent, event)
      if (!isRelevant) continue

      switch (event.type) {
        case 'created':
          if ((task.assignee || '').toLowerCase() === agent) {
            events.push({
              id: `feed-${event.id}`,
              kind: 'task_created',
              timestamp: event.timestamp,
              relevantTo: agent,
              actor: event.actor,
              summary: `New task assigned to you: ${task.title}`,
              taskId: task.id,
              prUrl: null,
              data: { taskTitle: task.title, assignee: task.assignee },
            })
          }
          break

        case 'status_changed': {
          const newStatus = (event.data?.to as string) || task.status
          const oldStatus = (event.data?.from as string) || 'unknown'

          if (newStatus === 'done') {
            events.push({
              id: `feed-${event.id}`,
              kind: 'task_completed',
              timestamp: event.timestamp,
              relevantTo: isMyTask(task, agent) ? agent : null,
              actor: event.actor,
              summary: `Task completed: ${task.title} (${oldStatus} → done)`,
              taskId: task.id,
              prUrl: extractPrUrl(task),
              data: { from: oldStatus, to: newStatus },
            })
          } else if (newStatus === 'validating' && (task.reviewer || '').toLowerCase() === agent) {
            events.push({
              id: `feed-${event.id}`,
              kind: 'review_requested',
              timestamp: event.timestamp,
              relevantTo: agent,
              actor: event.actor,
              summary: `Review requested: ${task.title} → validating`,
              taskId: task.id,
              prUrl: extractPrUrl(task),
              data: { from: oldStatus, to: newStatus, assignee: task.assignee },
            })
          } else {
            events.push({
              id: `feed-${event.id}`,
              kind: 'task_status_changed',
              timestamp: event.timestamp,
              relevantTo: isMyTask(task, agent) ? agent : null,
              actor: event.actor,
              summary: `${task.title}: ${oldStatus} → ${newStatus}`,
              taskId: task.id,
              prUrl: null,
              data: { from: oldStatus, to: newStatus },
            })
          }
          break
        }

        case 'assigned': {
          const newAssignee = (event.data?.to as string || '').toLowerCase()
          if (newAssignee === agent) {
            events.push({
              id: `feed-${event.id}`,
              kind: 'task_assigned',
              timestamp: event.timestamp,
              relevantTo: agent,
              actor: event.actor,
              summary: `Task assigned to you: ${task.title}`,
              taskId: task.id,
              prUrl: null,
              data: { from: event.data?.from, to: event.data?.to },
            })
          }
          break
        }
      }
    }
  }
}

function collectTaskComments(agent: string, since: number, events: FeedEvent[]): void {
  const allTasks = taskManager.listTasks({})

  for (const task of allTasks) {
    if (!isMyTask(task, agent)) continue

    const comments = taskManager.getTaskComments(task.id)
    for (const comment of comments) {
      if (comment.timestamp < since) continue
      if (comment.author.toLowerCase() === agent) continue // Skip own comments

      events.push({
        id: `feed-comment-${comment.id}`,
        kind: 'task_commented',
        timestamp: comment.timestamp,
        relevantTo: agent,
        actor: comment.author,
        summary: `${comment.author} commented on ${task.title}: ${truncate(comment.content, 80)}`,
        taskId: task.id,
        prUrl: null,
        data: { commentId: comment.id, content: comment.content },
      })
    }
  }
}

function collectChatEvents(agent: string, since: number, events: FeedEvent[]): void {
  const messages = chatManager.getMessages({ since, limit: 500 })
  const mentionPattern = new RegExp(`@${agent}\\b`, 'i')

  for (const msg of messages) {
    const from = (msg.from || '').toLowerCase()
    if (from === agent) continue // Skip own messages
    const content = typeof msg.content === 'string' ? msg.content : ''

    // Direct mentions
    if (mentionPattern.test(content)) {
      events.push({
        id: `feed-mention-${msg.id}`,
        kind: 'mention',
        timestamp: msg.timestamp,
        relevantTo: agent,
        actor: from,
        summary: `${msg.from} mentioned you: ${truncate(content, 100)}`,
        taskId: extractTaskId(content),
        prUrl: extractPrUrlFromText(content),
        data: { channel: msg.channel, messageId: msg.id },
      })
    }

    // Blocker signals
    if (/\bblocker\b/i.test(content) && from !== 'system' && from !== 'watchdog') {
      const taskId = extractTaskId(content)
      if (taskId) {
        const task = taskManager.getTask(taskId)
        if (task && isMyTask(task, agent)) {
          events.push({
            id: `feed-blocker-${msg.id}`,
            kind: 'blocker',
            timestamp: msg.timestamp,
            relevantTo: agent,
            actor: from,
            summary: `Blocker reported: ${truncate(content, 100)}`,
            taskId,
            prUrl: null,
            data: { channel: msg.channel, content },
          })
        }
      }
    }
  }
}

function collectPrAndDeployEvents(agent: string, since: number, events: FeedEvent[]): void {
  const messages = chatManager.getMessages({ since, channel: 'shipping', limit: 200 })
  const prPattern = /(?:PR|pull request)\s*#?(\d+)/i
  const mergedPattern = /\bmerged\b/i
  const deployPattern = /\b(?:deployed|deploy|shipped)\b/i

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''
    const from = (msg.from || '').toLowerCase()

    // PR merge signals
    const prMatch = content.match(prPattern)
    if (prMatch && mergedPattern.test(content)) {
      const prUrl = extractPrUrlFromText(content)
      const taskId = extractTaskId(content)
      const isRelevant = taskId
        ? isTaskRelevantById(taskId, agent)
        : mentionsAgent(content, agent)

      if (isRelevant || from === agent) {
        events.push({
          id: `feed-pr-${msg.id}`,
          kind: 'pr_merged',
          timestamp: msg.timestamp,
          relevantTo: isRelevant ? agent : null,
          actor: from,
          summary: `PR #${prMatch[1]} merged: ${truncate(content, 100)}`,
          taskId,
          prUrl,
          data: { prNumber: Number(prMatch[1]), channel: msg.channel },
        })
      }
    }

    // Deploy signals
    if (deployPattern.test(content) && !prMatch) {
      events.push({
        id: `feed-deploy-${msg.id}`,
        kind: 'deploy',
        timestamp: msg.timestamp,
        relevantTo: null, // Deploys are relevant to everyone
        actor: from,
        summary: `Deploy: ${truncate(content, 100)}`,
        taskId: extractTaskId(content),
        prUrl: extractPrUrlFromText(content),
        data: { channel: msg.channel },
      })
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isMyTask(task: Task, agent: string): boolean {
  return (task.assignee || '').toLowerCase() === agent
    || (task.reviewer || '').toLowerCase() === agent
}

function isTaskRelevantToAgent(task: Task, agent: string, event: TaskHistoryEvent): boolean {
  // Relevant if agent is assignee, reviewer, or the actor
  return isMyTask(task, agent) || event.actor.toLowerCase() === agent
}

function isTaskRelevantById(taskId: string, agent: string): boolean {
  const task = taskManager.getTask(taskId)
  if (!task) return false
  return isMyTask(task, agent)
}

function mentionsAgent(text: string, agent: string): boolean {
  return new RegExp(`@${agent}\\b`, 'i').test(text)
}

function isValidPrUrl(url: string): boolean {
  const match = url.match(/\/pull\/(\d+)/)
  if (!match) return false
  return parseInt(match[1], 10) > 0
}

function extractPrUrl(task: Task): string | null {
  const meta = task.metadata as Record<string, unknown> | null
  if (!meta) return null
  // Skip doc-only/config-only tasks that use placeholder PR URLs
  const handoff = meta.review_handoff as Record<string, unknown> | undefined
  if (handoff?.doc_only || handoff?.config_only) return null
  const candidates: string[] = []
  if (typeof meta.pr_url === 'string') candidates.push(meta.pr_url)
  if (typeof meta.pr_link === 'string') candidates.push(meta.pr_link)
  if (handoff && typeof handoff.pr_url === 'string') candidates.push(handoff.pr_url)
  for (const url of candidates) {
    if (isValidPrUrl(url)) return url
  }
  return null
}

function extractPrUrlFromText(text: string): string | null {
  const match = text.match(/https?:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/)
  return match ? match[0] : null
}

function extractTaskId(text: string): string | null {
  const match = text.match(/\b(task-[a-z0-9-]+)\b/i)
  return match ? match[1] : null
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}
