// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * StreamMultiplexer — validates render events against Screen Contract v0
 * and broadcasts them as SSE events to canvas subscribers.
 *
 * Gate checks (from contract):
 * 1. Relevance: slot must be in allowed list
 * 2. Content type: must be in allowed list
 * 3. Decision signal: required on all renders
 * 4. Evidence: required for claims/recommendations
 * 5. Actionability: action slots must include next step
 */

import {
  ALLOWED_SLOTS,
  ALLOWED_CONTENT_TYPES,
  AGENT_LANE_PREFIX,
  type SlotEvent,
  type SlotType,
  type ContentType,
} from './canvas-types.js'
import { slotManager } from './canvas-slots.js'

// ── Validation ───────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

function isAllowedSlot(slot: string): slot is SlotType {
  if ((ALLOWED_SLOTS as readonly string[]).includes(slot)) return true
  if (slot.startsWith(AGENT_LANE_PREFIX)) return true
  return false
}

function isAllowedContentType(ct: string): ct is ContentType {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(ct)
}

/** Content types that make claims requiring evidence */
const CLAIM_CONTENT_TYPES = new Set([
  'metric.single', 'metric.delta', 'task.card',
  'code.diff.summary', 'cta.button',
])

/** Decision signal kinds that require actionability */
const ACTIONABLE_KINDS = new Set(['action'])

export function validateSlotEvent(event: SlotEvent): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. Slot type
  if (!event.slot || !isAllowedSlot(event.slot)) {
    errors.push(`Invalid slot: "${event.slot}". Allowed: ${[...ALLOWED_SLOTS, 'agent_lane:<id>'].join(', ')}`)
  }

  // 2. Content type
  if (!event.content_type || !isAllowedContentType(event.content_type)) {
    errors.push(`Invalid content_type: "${event.content_type}". Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`)
  }

  // 3. Payload basics
  if (!event.payload) {
    errors.push('payload is required')
    return { valid: false, errors, warnings }
  }

  if (!event.payload.id) {
    errors.push('payload.id is required')
  }

  if (!event.payload.priority || !['p0', 'p1', 'p2', 'p3'].includes(event.payload.priority)) {
    errors.push('payload.priority must be p0|p1|p2|p3')
  }

  if (!event.payload.updated_at) {
    errors.push('payload.updated_at is required (ISO8601)')
  }

  // 4. Decision signal gate
  if (!event.payload.decision_signal) {
    errors.push('payload.decision_signal is required (contract gate)')
  } else {
    if (!event.payload.decision_signal.kind ||
        !['status', 'risk', 'change', 'action'].includes(event.payload.decision_signal.kind)) {
      errors.push('decision_signal.kind must be status|risk|change|action')
    }
    if (!event.payload.decision_signal.why_now || event.payload.decision_signal.why_now.trim().length === 0) {
      errors.push('decision_signal.why_now is required (explain why this is on screen now)')
    }
  }

  // 5. Evidence gate — required for claims/recommendations
  const evidence = event.payload.evidence || []
  if (CLAIM_CONTENT_TYPES.has(event.content_type) && evidence.length === 0) {
    warnings.push(`Content type "${event.content_type}" should include evidence links for claims`)
  }

  // Validate evidence link shapes
  for (const ev of evidence) {
    if (!ev.label || !ev.href || !ev.kind) {
      errors.push('Each evidence entry requires label, href, and kind')
      break
    }
  }

  // 6. Actionability gate
  if (event.payload.decision_signal?.kind === 'action') {
    if (!event.payload.body && !event.payload.action_url && !event.payload.label) {
      warnings.push('Action signal should include a concrete next step (body, label, or action_url)')
    }
  }

  // 7. Priority field
  if (!event.priority || !['background', 'normal', 'dominant'].includes(event.priority)) {
    errors.push('priority must be background|normal|dominant')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

// ── SSE Broadcasting ─────────────────────────────────────────────────

type CanvasSubscriber = (event: SlotEvent, slot: ReturnType<typeof slotManager.get>) => void

const subscribers = new Set<CanvasSubscriber>()

/**
 * Subscribe to canvas render events (SSE connections call this).
 */
export function subscribeCanvas(callback: CanvasSubscriber): () => void {
  subscribers.add(callback)
  return () => { subscribers.delete(callback) }
}

/**
 * Get current subscriber count.
 */
export function getCanvasSubscriberCount(): number {
  return subscribers.size
}

/**
 * Process a render event: validate → store in slot manager → broadcast.
 * Returns validation result (callers can check .valid).
 */
export function processRender(event: SlotEvent): ValidationResult & { slot?: ReturnType<typeof slotManager.get> } {
  const validation = validateSlotEvent(event)

  if (!validation.valid) {
    return validation
  }

  // Store in slot manager
  const slot = slotManager.upsert(event)

  // Broadcast to all canvas subscribers
  for (const sub of subscribers) {
    try {
      sub(event, slot)
    } catch (err) {
      console.error('[Canvas] Subscriber error:', err)
    }
  }

  return { ...validation, slot }
}

// ── Rejection log (for contract tuning) ──────────────────────────────

interface RejectionEntry {
  event: Partial<SlotEvent>
  errors: string[]
  timestamp: number
}

const rejections: RejectionEntry[] = []
const MAX_REJECTIONS = 50

export function logRejection(event: Partial<SlotEvent>, errors: string[]): void {
  rejections.push({
    event: { slot: event.slot, content_type: event.content_type, priority: event.priority },
    errors,
    timestamp: Date.now(),
  })
  if (rejections.length > MAX_REJECTIONS) {
    rejections.splice(0, rejections.length - MAX_REJECTIONS)
  }
}

export function getRecentRejections(limit = 10): RejectionEntry[] {
  return rejections.slice(-limit)
}
