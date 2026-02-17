// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Screen Contract v0 — Types
 *
 * Defines the render primitive and all allowed slot/content types
 * per docs/SCREEN_CONTRACT_V0.md
 */

// ── Allowed slot types (v0) ──────────────────────────────────────────

export const ALLOWED_SLOTS = [
  'objective',
  'narrative',
  'risk',
  'action',
  'evidence',
  'input',
  'status',
] as const

/** Agent lane slots: agent_lane:<agent_id> */
export const AGENT_LANE_PREFIX = 'agent_lane:'

export type SlotType = (typeof ALLOWED_SLOTS)[number] | `agent_lane:${string}`

// ── Allowed content types (v0) ───────────────────────────────────────

export const ALLOWED_CONTENT_TYPES = [
  'text.brief',
  'text.list',
  'metric.single',
  'metric.delta',
  'task.card',
  'chat.message',
  'code.diff.summary',
  'state.badge',
  'cta.button',
  'evidence.link',
  'timeline.event',
] as const

export type ContentType = (typeof ALLOWED_CONTENT_TYPES)[number]

// ── Decision signal ──────────────────────────────────────────────────

export interface DecisionSignal {
  kind: 'status' | 'risk' | 'change' | 'action'
  why_now: string
}

// ── Evidence link ────────────────────────────────────────────────────

export interface EvidenceLink {
  label: string
  href: string
  kind: 'pr' | 'task' | 'metric' | 'message' | 'doc' | 'log'
}

// ── Render payload ───────────────────────────────────────────────────

export interface RenderPayload {
  id: string
  title?: string
  body?: string
  priority: 'p0' | 'p1' | 'p2' | 'p3'
  confidence?: number
  freshness_ms?: number
  agent_id?: string
  decision_signal: DecisionSignal
  evidence: EvidenceLink[]
  updated_at: string

  // Content-type-specific data
  html?: string
  text?: string
  data?: unknown
  target?: string       // for annotations — which slot to overlay on
  items?: string[]       // for text.list
  value?: number         // for metric.single / metric.delta
  delta?: number         // for metric.delta
  label?: string         // for state.badge / cta.button
  action_url?: string    // for cta.button
  diff_summary?: string  // for code.diff.summary
  files_changed?: number
  additions?: number
  deletions?: number
}

// ── Slot event (the render primitive) ────────────────────────────────

export interface SlotEvent {
  slot: SlotType
  content_type: ContentType
  payload: RenderPayload
  priority: 'background' | 'normal' | 'dominant'
  append?: boolean
}

// ── Agent identity (from Pixel's spec) ───────────────────────────────

export const AGENT_COLORS: Record<string, string> = {
  pixel: '#a78bfa',   // violet
  link: '#60a5fa',    // blue
  kai: '#f59e0b',     // amber
  harmony: '#34d399', // green
  sage: '#9eb3ca',    // slate
  echo: '#f87171',    // red
  scout: '#fb923c',   // orange
}

export const AGENT_DEFAULT_EXPRESSION: Record<string, ContentType> = {
  pixel: 'text.brief',       // component / annotation
  link: 'code.diff.summary', // code diff / stream
  kai: 'text.brief',         // narrative / directive
  harmony: 'text.brief',     // audio pulse / ambient
  sage: 'text.brief',        // document / policy
  echo: 'text.brief',        // alert / narration
  scout: 'text.brief',       // intelligence / briefing
}
