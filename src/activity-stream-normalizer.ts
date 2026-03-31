// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Activity Stream Event Normalizer
 *
 * Transforms raw eventBus events into a consistent shape:
 * { id, type, agent, title, detail, taskId, prUrl, timestamp }
 *
 * This ensures all activity-stream SSE consumers receive events
 * in a predictable format regardless of the source event type.
 */

export interface NormalizedActivityEvent {
  id: string
  type: string
  agent: string | null
  title: string
  detail: string | null
  taskId: string | null
  prUrl: string | null
  timestamp: number
  /** Original raw data preserved for consumers that need full detail */
  _raw?: unknown
}

interface RawEvent {
  id: string
  type: string
  timestamp: number
  data: Record<string, unknown>
}

/**
 * Normalize a raw eventBus event into the standard activity-stream shape.
 */
export function normalizeActivityEvent(event: RawEvent): NormalizedActivityEvent {
  const data = (event.data ?? {}) as Record<string, unknown>

  // Extract agent from various field names
  const agent = extractString(data, 'agentId')
    ?? extractString(data, 'agent')
    ?? extractString(data, 'name')
    ?? extractNestedString(data, 'presence', 'name')
    ?? null

  // Extract title based on event type
  const title = deriveTitle(event.type, data)

  // Extract detail
  const detail = extractString(data, 'transcript')
    ?? extractString(data, 'text')
    ?? extractNestedString(data, 'data', 'text')
    ?? extractString(data, 'query')
    ?? null

  // Extract task reference
  const taskId = extractString(data, 'taskId')
    ?? extractString(data, 'task_id')
    ?? extractNestedString(data, 'activeTask', 'id')
    ?? extractNestedString(data, 'payload', 'activeTask', 'id' as any)
    ?? null

  // Extract PR URL
  const prUrl = extractString(data, 'prUrl')
    ?? extractString(data, 'pr_url')
    ?? null

  return {
    id: event.id,
    type: event.type,
    agent,
    title,
    detail,
    taskId,
    prUrl,
    timestamp: event.timestamp,
    _raw: data,
  }
}

/**
 * Strip the _raw field for lightweight payloads.
 */
export function normalizeActivityEventSlim(event: RawEvent): Omit<NormalizedActivityEvent, '_raw'> {
  const normalized = normalizeActivityEvent(event)
  const { _raw, ...slim } = normalized
  return slim
}

// ── Helpers ──

function extractString(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key]
  return typeof val === 'string' && val.length > 0 ? val : null
}

function extractNestedString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  let current: unknown = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.length > 0 ? current : null
}

function deriveTitle(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'canvas_message': {
      const subType = extractString(data, 'type')
      if (subType === 'voice_transcript') return 'Voice transcript'
      if (subType === 'info') return 'Info'
      if (data.isResponse) return 'Agent response'
      if (data.query) return 'Canvas query'
      return 'Message'
    }
    case 'canvas_render': {
      const state = extractString(data, 'state')
      const agent = extractString(data, 'agentId') ?? 'Agent'
      if (state === 'thinking') return `${agent} thinking`
      if (state === 'handoff') return `${agent} handing off`
      if (state === 'decision') return `${agent} needs attention`
      if (state === 'ambient') return `${agent} idle`
      return `${agent} state: ${state ?? 'unknown'}`
    }
    case 'canvas_expression':
      return extractString(data, 'expression') ?? 'Expression'
    case 'canvas_burst':
      return extractString(data, 'reason') ?? 'Activity burst'
    default:
      return type.replace(/_/g, ' ')
  }
}
