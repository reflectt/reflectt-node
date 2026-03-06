// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Activity Timeline — unified event feed with server-side grouping
// Spec: design/activity-timeline-spec-v0.md

import { createHash } from 'crypto'
import { getDb } from './db.js'

// ── Types ──────────────────────────────────────────────────────────────────

export const ACTIVITY_SOURCES = ['tasks', 'reviews', 'chat', 'presence', 'reflections', 'insights'] as const
export type ActivitySource = typeof ACTIVITY_SOURCES[number]

export type TimelineEventType =
  | 'task.created'
  | 'task.assigned'
  | 'task.status_changed'
  | 'task.commented'
  | 'review.approved'
  | 'review.rejected'
  | 'agent.online'
  | 'agent.offline'
  | 'chat.message'
  | 'chat.message_group'
  | 'reflection.created'
  | 'insight.promoted'

export interface TimelineActor {
  kind: 'human' | 'agent' | 'system'
  id?: string
  label: string
}

export interface TimelineSubject {
  kind: 'task' | 'review' | 'agent' | 'chat' | 'reflection' | 'insight'
  id?: string
  label?: string
  href?: string
}

export interface TimelineEventGroup {
  kind: 'chat_burst' | 'task_status_sequence' | 'presence_changes'
  count: number
  window_minutes: number
  children?: TimelineEvent[]
}

export interface TimelineEvent {
  id: string
  ts: string       // ISO
  ts_ms: number    // epoch ms
  type: TimelineEventType
  severity?: 'info' | 'success' | 'warning' | 'error'
  actor?: TimelineActor
  subject?: TimelineSubject
  summary: string
  detail?: string
  meta?: Record<string, unknown>
  group?: TimelineEventGroup
}

export interface ActivityRange {
  from: string      // ISO
  to: string        // ISO
  from_ms: number
  to_ms: number
  tz: string
}

export interface ActivityResponse {
  events: TimelineEvent[]
  total: number     // post-grouping count
  range: ActivityRange
  partial?: {
    missing: ActivitySource[]
    reason?: string
  }
  generated_at: string
  generated_at_ms: number
  next_cursor: string | null
}

export interface ActivityQuery {
  range?: '24h' | '7d'
  type?: string[]       // filter by event type prefix (task, chat, review, etc.)
  agent?: string        // filter by actor
  limit?: number
  after?: string        // cursor (opaque base64url-encoded ts_ms)
}

// ── Constants ──────────────────────────────────────────────────────────────

const CHAT_GROUP_WINDOW_MS = 5 * 60 * 1000    // 5 minutes
const TASK_CHURN_WINDOW_MS = 10 * 60 * 1000   // 10 minutes
const PRESENCE_FLAP_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// ── Event ID generation ────────────────────────────────────────────────────

function makeEventId(type: string, subjectId: string, tsMs: number): string {
  const bucket = Math.floor(tsMs / 1000) // 1-second buckets
  const hash = createHash('sha256')
    .update(`${type}:${subjectId}:${bucket}`)
    .digest('hex')
    .slice(0, 12)
  return `evt-${hash}`
}

// ── Internal raw event type ────────────────────────────────────────────────

interface RawEvent {
  ts_ms: number
  type: TimelineEventType
  actor?: TimelineActor
  subject?: TimelineSubject
  summary: string
  detail?: string
  severity?: 'info' | 'success' | 'warning' | 'error'
  meta?: Record<string, unknown>
  source: ActivitySource
  groupKey?: string  // for grouping: same key = same group
}

// ── Data source collectors ─────────────────────────────────────────────────

function collectTaskEvents(db: ReturnType<typeof getDb>, fromMs: number, toMs: number, agentFilter?: string): RawEvent[] {
  const events: RawEvent[] = []

  // Task history events (status changes, assignments)
  const historyRows = db.prepare(`
    SELECT th.id, th.task_id, th.type, th.actor, th.timestamp, th.data, t.title
    FROM task_history th
    LEFT JOIN tasks t ON t.id = th.task_id
    WHERE th.timestamp >= ? AND th.timestamp <= ?
    ORDER BY th.timestamp DESC
  `).all(fromMs, toMs) as Array<{
    id: string; task_id: string; type: string; actor: string;
    timestamp: number; data: string | null; title: string | null
  }>

  for (const row of historyRows) {
    if (agentFilter && row.actor !== agentFilter) continue

    const data = row.data ? safeJsonParse<Record<string, unknown>>(row.data) : {}
    const taskTitle = row.title || row.task_id

    if (row.type === 'status_changed' || row.type === 'status-changed') {
      const from = (data?.from as string) || '?'
      const to = (data?.to as string) || '?'

      // Check if this is a review decision
      if (to === 'done' && data?.review_action === 'approved') {
        events.push({
          ts_ms: row.timestamp, type: 'review.approved',
          actor: { kind: 'agent', label: row.actor },
          subject: { kind: 'task', id: row.task_id, label: taskTitle, href: `/tasks/${row.task_id}` },
          summary: `${row.actor} approved "${truncate(taskTitle, 60)}"`,
          severity: 'success', source: 'reviews', meta: data ?? undefined,
        })
        continue
      }
      if (data?.review_action === 'rejected') {
        events.push({
          ts_ms: row.timestamp, type: 'review.rejected',
          actor: { kind: 'agent', label: row.actor },
          subject: { kind: 'task', id: row.task_id, label: taskTitle, href: `/tasks/${row.task_id}` },
          summary: `${row.actor} rejected "${truncate(taskTitle, 60)}"`,
          detail: (data?.review_reason as string) || undefined,
          severity: 'warning', source: 'reviews', meta: data ?? undefined,
        })
        continue
      }

      const severity = to === 'done' ? 'success' as const
        : to === 'blocked' ? 'warning' as const : 'info' as const

      events.push({
        ts_ms: row.timestamp, type: 'task.status_changed',
        actor: { kind: 'agent', label: row.actor },
        subject: { kind: 'task', id: row.task_id, label: taskTitle, href: `/tasks/${row.task_id}` },
        summary: `${row.actor} moved "${truncate(taskTitle, 50)}" ${from} → ${to}`,
        severity, source: 'tasks',
        meta: { from, to, ...(data ?? {}) },
        groupKey: `task-churn:${row.task_id}`,
      })
    } else if (row.type === 'created') {
      events.push({
        ts_ms: row.timestamp, type: 'task.created',
        actor: { kind: 'agent', label: row.actor },
        subject: { kind: 'task', id: row.task_id, label: taskTitle, href: `/tasks/${row.task_id}` },
        summary: `${row.actor} created "${truncate(taskTitle, 60)}"`,
        severity: 'info', source: 'tasks',
      })
    } else if (row.type === 'assigned' || row.type === 'assignee_changed') {
      events.push({
        ts_ms: row.timestamp, type: 'task.assigned',
        actor: { kind: 'agent', label: row.actor },
        subject: { kind: 'task', id: row.task_id, label: taskTitle, href: `/tasks/${row.task_id}` },
        summary: `${row.actor} assigned "${truncate(taskTitle, 50)}" to ${(data?.assignee as string) || '?'}`,
        severity: 'info', source: 'tasks', meta: data ?? undefined,
      })
    }
  }

  // Task comments
  const commentRows = db.prepare(`
    SELECT tc.id, tc.task_id, tc.author, tc.content, tc.timestamp, t.title
    FROM task_comments tc
    LEFT JOIN tasks t ON t.id = tc.task_id
    WHERE tc.timestamp >= ? AND tc.timestamp <= ?
    ORDER BY tc.timestamp DESC
  `).all(fromMs, toMs) as Array<{
    id: string; task_id: string; author: string;
    content: string; timestamp: number; title: string | null
  }>

  for (const row of commentRows) {
    if (agentFilter && row.author !== agentFilter) continue
    events.push({
      ts_ms: row.timestamp, type: 'task.commented',
      actor: { kind: 'agent', label: row.author },
      subject: { kind: 'task', id: row.task_id, label: row.title || row.task_id, href: `/tasks/${row.task_id}` },
      summary: `${row.author} commented on "${truncate(row.title || row.task_id, 50)}"`,
      detail: truncate(row.content, 200),
      severity: 'info', source: 'tasks',
    })
  }

  return events
}

function collectChatEvents(db: ReturnType<typeof getDb>, fromMs: number, toMs: number, agentFilter?: string): RawEvent[] {
  const events: RawEvent[] = []

  const rows = db.prepare(`
    SELECT id, "from", channel, content, timestamp
    FROM chat_messages
    WHERE timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp DESC
  `).all(fromMs, toMs) as Array<{
    id: string; from: string; channel: string; content: string; timestamp: number
  }>

  for (const row of rows) {
    if (agentFilter && row.from !== agentFilter) continue
    events.push({
      ts_ms: row.timestamp, type: 'chat.message',
      actor: { kind: 'agent', label: row.from },
      subject: { kind: 'chat', id: row.channel, label: `#${row.channel}` },
      summary: `${row.from} in #${row.channel}: "${truncate(row.content, 80)}"`,
      severity: 'info', source: 'chat',
      groupKey: `chat:${row.channel}`,
    })
  }

  return events
}

function collectPresenceEvents(db: ReturnType<typeof getDb>, fromMs: number, _toMs: number, agentFilter?: string): RawEvent[] {
  const events: RawEvent[] = []

  const hosts = db.prepare(`
    SELECT id, hostname, agents, status, last_seen_at FROM hosts WHERE last_seen_at >= ?
  `).all(fromMs) as Array<{
    id: string; hostname: string | null; agents: string | null; status: string; last_seen_at: number
  }>

  for (const host of hosts) {
    const agents: string[] = host.agents ? safeJsonParse<string[]>(host.agents) || [] : []
    for (const agent of agents) {
      if (agentFilter && agent !== agentFilter) continue
      const isOnline = host.status === 'online'
      events.push({
        ts_ms: host.last_seen_at,
        type: isOnline ? 'agent.online' : 'agent.offline',
        actor: { kind: 'system', label: 'system' },
        subject: { kind: 'agent', id: agent, label: agent },
        summary: `${agent} ${isOnline ? 'came online' : 'went offline'}`,
        severity: isOnline ? 'info' : 'warning',
        source: 'presence', groupKey: `presence:${agent}`,
      })
    }
  }

  return events
}

function collectReflectionEvents(db: ReturnType<typeof getDb>, fromMs: number, toMs: number, agentFilter?: string): RawEvent[] {
  const events: RawEvent[] = []

  const rows = db.prepare(`
    SELECT id, pain, author, severity, created_at FROM reflections
    WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC
  `).all(fromMs, toMs) as Array<{
    id: string; pain: string; author: string; severity: string | null; created_at: number
  }>

  for (const row of rows) {
    if (agentFilter && row.author !== agentFilter) continue
    events.push({
      ts_ms: row.created_at, type: 'reflection.created',
      actor: { kind: 'agent', label: row.author },
      subject: { kind: 'reflection', id: row.id, label: truncate(row.pain, 60) },
      summary: `${row.author} reflected: "${truncate(row.pain, 80)}"`,
      severity: row.severity === 'critical' || row.severity === 'high' ? 'warning' : 'info',
      source: 'reflections',
    })
  }

  return events
}

function collectInsightEvents(db: ReturnType<typeof getDb>, fromMs: number, toMs: number, agentFilter?: string): RawEvent[] {
  const events: RawEvent[] = []

  const rows = db.prepare(`
    SELECT id, title, status, task_id, authors, severity_max, updated_at FROM insights
    WHERE status IN ('promoted', 'task_created') AND updated_at >= ? AND updated_at <= ?
    ORDER BY updated_at DESC
  `).all(fromMs, toMs) as Array<{
    id: string; title: string; status: string; task_id: string | null;
    authors: string | null; severity_max: string | null; updated_at: number
  }>

  for (const row of rows) {
    const authors: string[] = row.authors ? safeJsonParse<string[]>(row.authors) || [] : []
    if (agentFilter && !authors.includes(agentFilter)) continue
    events.push({
      ts_ms: row.updated_at, type: 'insight.promoted',
      actor: { kind: 'system', label: 'system' },
      subject: { kind: 'insight', id: row.id, label: truncate(row.title, 60) },
      summary: `Insight promoted: "${truncate(row.title, 60)}"${row.task_id ? ` → task ${row.task_id}` : ''}`,
      severity: row.severity_max === 'critical' ? 'error' : row.severity_max === 'high' ? 'warning' : 'info',
      source: 'insights', meta: { task_id: row.task_id, authors },
    })
  }

  return events
}

// ── Grouping engine ────────────────────────────────────────────────────────

export function groupEvents(events: TimelineEvent[]): TimelineEvent[] {
  if (events.length === 0) return events

  // Group by groupKey — collect all events per key, then group those within window
  const byKey = new Map<string, TimelineEvent[]>()
  const ungrouped: TimelineEvent[] = []

  for (const e of events) {
    const gk = (e.meta as Record<string, unknown> | undefined)?._groupKey as string | undefined
    if (!gk) {
      ungrouped.push(e)
      continue
    }
    let list = byKey.get(gk)
    if (!list) { list = []; byKey.set(gk, list) }
    list.push(e)
  }

  const grouped: TimelineEvent[] = [...ungrouped]

  for (const [key, items] of byKey) {
    if (items.length < 2) {
      grouped.push(...items)
      continue
    }

    // Sort by ts_ms descending (newest first)
    items.sort((a, b) => b.ts_ms - a.ts_ms)

    const windowMs = key.startsWith('chat:') ? CHAT_GROUP_WINDOW_MS
      : key.startsWith('task-churn:') ? TASK_CHURN_WINDOW_MS
      : key.startsWith('presence:') ? PRESENCE_FLAP_WINDOW_MS
      : 0

    if (windowMs === 0) {
      grouped.push(...items)
      continue
    }

    // Check if all items fall within the window
    const oldest = items[items.length - 1].ts_ms
    const newest = items[0].ts_ms
    if (newest - oldest <= windowMs) {
      grouped.push(createGroupedEvent(key, items, windowMs))
    } else {
      // Split into sub-windows
      let batch: TimelineEvent[] = [items[0]]
      for (let i = 1; i < items.length; i++) {
        if (batch[0].ts_ms - items[i].ts_ms <= windowMs) {
          batch.push(items[i])
        } else {
          grouped.push(batch.length >= 2 ? createGroupedEvent(key, batch, windowMs) : batch[0])
          batch = [items[i]]
        }
      }
      grouped.push(batch.length >= 2 ? createGroupedEvent(key, batch, windowMs) : batch[0])
    }
  }

  // Sort final result newest-first
  grouped.sort((a, b) => b.ts_ms - a.ts_ms)
  return grouped
}

function createGroupedEvent(groupKey: string, children: TimelineEvent[], windowMs: number): TimelineEvent {
  const windowMinutes = Math.round(windowMs / 60000)
  const newest = children[0]

  if (groupKey.startsWith('chat:')) {
    const channel = children[0].subject?.label || '#general'
    return {
      id: makeEventId('chat.message_group', groupKey, newest.ts_ms),
      ts: newest.ts, ts_ms: newest.ts_ms,
      type: 'chat.message_group', severity: 'info',
      subject: children[0].subject,
      summary: `${children.length} messages in ${channel}`,
      detail: children.slice(0, 3).map(c => c.summary).join('\n'),
      group: { kind: 'chat_burst', count: children.length, window_minutes: windowMinutes, children },
    }
  }

  if (groupKey.startsWith('task-churn:')) {
    const statuses = children
      .map(c => (c.meta as Record<string, unknown>)?.to as string)
      .filter(Boolean)
      .reverse()
    return {
      id: makeEventId('task.status_changed', groupKey, newest.ts_ms),
      ts: newest.ts, ts_ms: newest.ts_ms,
      type: 'task.status_changed', severity: 'info',
      actor: children[0].actor, subject: children[0].subject,
      summary: `Task status changes (${children.length}): ${statuses.join(' → ')}`,
      group: { kind: 'task_status_sequence', count: children.length, window_minutes: windowMinutes, children },
    }
  }

  if (groupKey.startsWith('presence:')) {
    const agent = children[0].subject?.label || 'agent'
    return {
      id: makeEventId('agent.online', groupKey, newest.ts_ms),
      ts: newest.ts, ts_ms: newest.ts_ms,
      type: 'agent.online', severity: 'info',
      subject: children[0].subject,
      summary: `${agent} connection changes (${children.length}×)`,
      group: { kind: 'presence_changes', count: children.length, window_minutes: windowMinutes, children },
    }
  }

  return newest
}

// ── Main query function ────────────────────────────────────────────────────

export function queryActivity(opts: ActivityQuery = {}): ActivityResponse {
  const db = getDb()
  const now = Date.now()

  // Parse range
  const rangeMs = opts.range === '7d' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const toMs = now
  const fromMs = now - rangeMs

  // Parse cursor (base64url-encoded ts_ms)
  let cursorMs: number | null = null
  if (opts.after) {
    try {
      cursorMs = parseInt(Buffer.from(opts.after, 'base64url').toString('utf8'), 10)
      if (isNaN(cursorMs)) cursorMs = null
    } catch { cursorMs = null }
  }
  const effectiveToMs = cursorMs ?? toMs
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)

  // Type filter — handle both string and string[]
  const typeRaw = opts.type
    ? (Array.isArray(opts.type) ? opts.type : opts.type.split(',').map(t => t.trim()))
    : null
  const typeFilter = typeRaw && typeRaw.length > 0 ? new Set(typeRaw.map(t => t.toLowerCase())) : null

  const sourceForType = (source: ActivitySource): boolean => {
    if (!typeFilter) return true
    const mapping: Record<string, ActivitySource[]> = {
      task: ['tasks'], tasks: ['tasks'],
      review: ['reviews'], reviews: ['reviews'],
      chat: ['chat'], presence: ['presence'],
      reflection: ['reflections'], reflections: ['reflections'],
      insight: ['insights'], insights: ['insights'],
    }
    return [...typeFilter].some(t => {
      // Exact match in mapping
      if ((mapping[t] || []).includes(source)) return true
      // Prefix match: 'task.created' → 'task' → mapping['task']
      const prefix = t.split('.')[0]
      if (prefix && (mapping[prefix] || []).includes(source)) return true
      return false
    })
  }

  // Collect events from each source
  const allRawEvents: RawEvent[] = []
  const missingSources: ActivitySource[] = []

  const collectors: Array<[ActivitySource, () => RawEvent[]]> = [
    ['tasks', () => collectTaskEvents(db, fromMs, effectiveToMs, opts.agent)],
    ['chat', () => collectChatEvents(db, fromMs, effectiveToMs, opts.agent)],
    ['presence', () => collectPresenceEvents(db, fromMs, effectiveToMs, opts.agent)],
    ['reflections', () => collectReflectionEvents(db, fromMs, effectiveToMs, opts.agent)],
    ['insights', () => collectInsightEvents(db, fromMs, effectiveToMs, opts.agent)],
  ]

  for (const [source, collector] of collectors) {
    if (!sourceForType(source)) continue
    try {
      allRawEvents.push(...collector())
    } catch {
      missingSources.push(source)
    }
  }

  // Convert to TimelineEvents
  let events: TimelineEvent[] = allRawEvents.map(raw => ({
    id: makeEventId(raw.type, raw.subject?.id || raw.actor?.label || 'unknown', raw.ts_ms),
    ts: new Date(raw.ts_ms).toISOString(),
    ts_ms: raw.ts_ms,
    type: raw.type,
    severity: raw.severity,
    actor: raw.actor,
    subject: raw.subject,
    summary: raw.summary,
    detail: raw.detail,
    meta: raw.groupKey ? { ...raw.meta, _groupKey: raw.groupKey } : raw.meta,
  }))

  // Sort newest-first
  events.sort((a, b) => b.ts_ms - a.ts_ms)

  // De-dupe by id
  const seen = new Set<string>()
  events = events.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  // Apply type filter at event level
  if (typeFilter) {
    events = events.filter(e => {
      const prefix = e.type.split('.')[0]
      return [...typeFilter].some(t => t === prefix || t === e.type)
    })
  }

  // Group events
  events = groupEvents(events)

  // Clean up internal _groupKey from meta
  for (const e of events) {
    if (e.meta && '_groupKey' in e.meta) {
      const { _groupKey, ...rest } = e.meta as Record<string, unknown>
      e.meta = Object.keys(rest).length > 0 ? rest : undefined
    }
    // Also clean children's _groupKey
    if (e.group?.children) {
      for (const child of e.group.children) {
        if (child.meta && '_groupKey' in child.meta) {
          const { _groupKey, ...rest } = child.meta as Record<string, unknown>
          child.meta = Object.keys(rest).length > 0 ? rest : undefined
        }
      }
    }
  }

  const total = events.length

  // Paginate
  events = events.slice(0, limit)

  // Generate next_cursor
  const hasMore = total > limit
  const nextCursor = hasMore && events.length > 0
    ? Buffer.from(String(events[events.length - 1].ts_ms)).toString('base64url')
    : null

  // Timezone
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const response: ActivityResponse = {
    events,
    total,
    range: {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      from_ms: fromMs,
      to_ms: toMs,
      tz,
    },
    generated_at: new Date(now).toISOString(),
    generated_at_ms: now,
    next_cursor: nextCursor,
  }

  if (missingSources.length > 0) {
    response.partial = { missing: missingSources, reason: 'source_unavailable' }
  }

  return response
}

// ── Helpers ────────────────────────────────────────────────────────────────

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}

function safeJsonParse<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}
