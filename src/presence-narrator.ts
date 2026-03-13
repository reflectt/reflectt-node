// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Presence Narrator
 *
 * Generates and publishes first-person agent narration messages to chat
 * every 5 minutes (±60s jitter) when the agent has an active task.
 *
 * Follows echo's constraint pack:
 * - First person singular only: "I…"
 * - 1–2 sentences, 8–22 words, 140 char hard cap
 * - Specific artifact/state references — no generic filler
 * - Skip if no meaningful state change since last narration
 * - Suppress near-duplicates for 20 minutes minimum
 * - Minimum 5 min spacing + ±60s jitter
 */

type TaskStatus = 'todo' | 'doing' | 'blocked' | 'validating' | 'done' | 'cancelled' | 'resolved_externally'

// Duck-typed interface matching the subset of taskManager we need
interface NarratorTaskManager {
  listTasks(opts: { status?: TaskStatus | TaskStatus[]; assignee?: string }): Array<{
    id: string
    title: string
    status: string
    done_criteria?: string[]
    createdAt: number
    updatedAt?: number
  }>
  getTaskComments(taskId: string): Array<{
    author: string
    content: string
    timestamp: number
  }>
}

interface NarratorState {
  lastNarrationAt: number      // timestamp of last published narration
  lastContent: string          // text of last published narration (for dedup)
  lastTaskId: string | null    // task id when last narration was published
}

// Per-agent state (in-memory, survives sweeper but not restart — acceptable)
const agentState = new Map<string, NarratorState>()

const NARRATION_INTERVAL_MS = 5 * 60 * 1000   // 5 minutes base
const NARRATION_JITTER_MS   = 60 * 1000        // ±60s jitter
const DEDUP_WINDOW_MS       = 20 * 60 * 1000   // 20 min near-duplicate window
const MAX_LENGTH             = 140

// Banned filler patterns per echo's spec
const BANNED_PATTERNS = [
  /^i['']?m still working/i,
  /making progress/i,
  /checking in/i,
  /just an update/i,
  /quick update/i,
  /working on it/i,
  /^i['']?m working$/i,
]

/**
 * Generate a narration line for an agent based on their current task state.
 * Returns null if no meaningful content can be produced.
 */
export function generateNarration(
  agentId: string,
  taskManager: NarratorTaskManager,
): string | null {
  // Find the agent's active doing task
  const activeTasks = taskManager.listTasks({ status: 'doing', assignee: agentId })
  const doingTask = activeTasks[0] ?? null

  if (!doingTask) {
    // Check for validating tasks (just finished something)
    const validatingTasks = taskManager.listTasks({ status: 'validating', assignee: agentId })
    const recentValidating = validatingTasks[0] ?? null
    if (!recentValidating) return null

    // Only narrate validating if it moved there recently (< 30 min)
    const movedAt = recentValidating.updatedAt ?? recentValidating.createdAt
    if (Date.now() - movedAt > 30 * 60 * 1000) return null

    const title = recentValidating.title.replace(/^feat[:(]/i, '').replace(/^fix[:(]/i, '').trim()
    return trim140(`I just finished ${title.slice(0, 80)} and I'm waiting on review.`)
  }

  // Get recent task comments to extract concrete activity signals
  const comments = taskManager.getTaskComments(doingTask.id)
  const now2 = Date.now()
  const recentComments = comments
    .filter((c) => c.author === agentId && now2 - c.timestamp < 60 * 60 * 1000)
    .sort((a, b) => b.timestamp - a.timestamp)

  const recentComment = recentComments[0]

  // Extract PR/commit mentions from recent comment
  const prMatch = recentComment?.content.match(/PR #(\d+)|pull\/(\d+)/)
  const prRef = prMatch ? `PR #${prMatch[1] ?? prMatch[2]}` : null

  const title = doingTask.title
    .replace(/^feat[:(]\s*/i, '')
    .replace(/^fix[:(]\s*/i, '')
    .replace(/^chore[:(]\s*/i, '')
    .replace(/^infra[:(]\s*/i, '')
    .trim()
    .slice(0, 80)

  // Status-aware narration
  if (doingTask.status === 'doing') {
    // Age of doing state (how long in active work)
    const startedAt = doingTask.updatedAt ?? doingTask.createdAt
    const ageMin = Math.floor((Date.now() - startedAt) / 60000)

    if (prRef && recentComment) {
      // Just pushed a PR
      const prAgeMin = Math.floor((Date.now() - recentComment.timestamp) / 60000)
      if (prAgeMin < 30) {
        return trim140(`I just pushed ${prRef} for ${title} and I'm watching CI.`)
      }
    }

    if (ageMin < 10) {
      return trim140(`I just picked up ${title} and I'm reading the codebase.`)
    }

    if (ageMin < 45) {
      return trim140(`I'm implementing ${title}.`)
    }

    // Longer work session — use done_criteria for specificity
    const criteria = doingTask.done_criteria ?? []
    if (criteria.length > 0) {
      const firstCriterion = criteria[0]!.toLowerCase().slice(0, 60)
      return trim140(`I'm working on ${title} — next: ${firstCriterion}.`)
    }

    return trim140(`I'm working on ${title}.`)
  }

  return null
}

function trim140(text: string): string {
  if (text.length <= MAX_LENGTH) return text
  return text.slice(0, MAX_LENGTH - 1) + '…'
}

/**
 * Check if new content is a near-duplicate of the last narration.
 * Simple word-overlap check (sufficient for 1-2 sentence messages).
 */
function isNearDuplicate(a: string, b: string): boolean {
  if (!a || !b) return false
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const wa = words(a)
  const wb = words(b)
  const intersection = [...wa].filter(w => wb.has(w))
  const union = new Set([...wa, ...wb])
  return union.size > 0 && intersection.length / union.size > 0.6
}

/**
 * Check if narration should be suppressed by banned patterns.
 */
function isBanned(text: string): boolean {
  return BANNED_PATTERNS.some(p => p.test(text))
}

/**
 * Attempt to publish a narration for an agent.
 * Posts to node chat via the internal API.
 * Returns true if a message was published.
 */
export async function publishNarration(
  agentId: string,
  taskManager: NarratorTaskManager,
  apiBase = 'http://127.0.0.1:4445',
): Promise<boolean> {
  const state = agentState.get(agentId) ?? { lastNarrationAt: 0, lastContent: '', lastTaskId: null }
  const now = Date.now()

  // Enforce minimum spacing
  if (now - state.lastNarrationAt < NARRATION_INTERVAL_MS - NARRATION_JITTER_MS) {
    return false
  }

  const content = generateNarration(agentId, taskManager)
  if (!content) return false

  // Check banned patterns
  if (isBanned(content)) return false

  // Near-duplicate suppression (20 min window)
  if (now - state.lastNarrationAt < DEDUP_WINDOW_MS && isNearDuplicate(content, state.lastContent)) {
    return false
  }

  // Post to node chat
  const res = await fetch(`${apiBase}/chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: agentId,
      content,
      channel: 'general',
      metadata: { type: 'presence_narration', auto: true },
    }),
  })

  if (!res.ok) {
    console.warn(`[narrator] POST /chat/messages failed for ${agentId}: ${res.status}`)
    return false
  }

  // Update state
  agentState.set(agentId, {
    lastNarrationAt: now,
    lastContent: content,
    lastTaskId: (taskManager.listTasks({ status: 'doing', assignee: agentId })[0]?.id) ?? null,
  })

  console.log(`[narrator] ${agentId}: "${content}"`)
  return true
}

/**
 * Start the presence narration scheduler for a set of agents.
 * Runs every 5 minutes with per-agent jitter to avoid synchronized posts.
 * Returns a cleanup function.
 */
export function startPresenceNarrator(
  agentIds: string[],
  taskManager: NarratorTaskManager,
  apiBase = 'http://127.0.0.1:4445',
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = []

  function scheduleNext(agentId: string): void {
    const jitter = (Math.random() * 2 - 1) * NARRATION_JITTER_MS  // ±60s
    const delay = NARRATION_INTERVAL_MS + jitter

    const t = setTimeout(async () => {
      try {
        await publishNarration(agentId, taskManager, apiBase)
      } catch (err) {
        console.warn(`[narrator] error for ${agentId}:`, err instanceof Error ? err.message : err)
      }
      scheduleNext(agentId)
    }, delay)
    t.unref()
    timers.push(t)
  }

  // Stagger initial run per agent to avoid thundering herd
  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i]!
    const stagger = i * 30_000  // 30s between agents
    const t = setTimeout(() => scheduleNext(agentId), stagger)
    t.unref()
    timers.push(t)
  }

  console.log(`[narrator] started for agents: ${agentIds.join(', ')}`)

  return () => {
    for (const t of timers) clearTimeout(t)
    console.log('[narrator] stopped')
  }
}
