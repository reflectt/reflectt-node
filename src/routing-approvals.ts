/**
 * Routing Approvals — explicit queue for router-fed assignment suggestions.
 *
 * Tasks enter this queue ONLY when explicitly marked with
 * metadata.routing_approval=true (set by the routing system).
 *
 * This is NOT derived from "all todo tasks." Only router-suggested
 * assignments appear here.
 *
 * Contract:
 * - metadata.routing_approval: boolean — marks task as needing routing review
 * - metadata.routing_suggestion: { suggestedAssignee, confidence, reason, alternatives? }
 * - Approve: sets assignee, stamps approval metadata, clears routing_approval
 * - Reject: stamps rejection metadata, clears routing_approval, adds rejection state
 */

import type { Task } from './types.js'

// ── Types ────────────────────────────────────────────────────────────

export interface RoutingSuggestion {
  suggestedAssignee: string
  confidence: number  // 0–100
  reason: string
  alternatives?: { agent: string; score: number; reason: string }[]
}

export interface RoutingApprovalMeta {
  routing_approval: true
  routing_suggestion: RoutingSuggestion
}

export interface ApprovalDecision {
  approvedBy: string
  approvedAt: string
  decision: 'approved'
  assignee: string
  note?: string
}

export interface RejectionDecision {
  rejectedBy: string
  rejectedAt: string
  decision: 'rejected'
  note?: string
}

export type RoutingDecision = ApprovalDecision | RejectionDecision

// ── Query ────────────────────────────────────────────────────────────

/**
 * Filter tasks to only those with explicit routing_approval=true.
 * This is the ONLY way tasks enter the approvals queue.
 */
export function getRoutingApprovalQueue(tasks: Task[]): Task[] {
  return tasks.filter(t => {
    const meta = t.metadata as Record<string, unknown> | undefined
    return meta?.routing_approval === true
  })
}

/**
 * Check if a task is a routing approval candidate.
 */
export function isRoutingApproval(task: Task): boolean {
  const meta = task.metadata as Record<string, unknown> | undefined
  return meta?.routing_approval === true
}

/**
 * Extract routing suggestion from task metadata.
 */
export function getRoutingSuggestion(task: Task): RoutingSuggestion | null {
  const meta = task.metadata as Record<string, unknown> | undefined
  const suggestion = meta?.routing_suggestion as RoutingSuggestion | undefined
  if (!suggestion?.suggestedAssignee) return null
  return suggestion
}

// ── Mutations (return metadata patches) ──────────────────────────────

/**
 * Build metadata patch for approving a routing suggestion.
 * Clears routing_approval, stamps auditable approval metadata.
 */
export function buildApprovalPatch(
  actor: string,
  assignee: string,
  note?: string,
): Record<string, unknown> {
  return {
    routing_approval: false,
    routing_decision: {
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
      decision: 'approved',
      assignee,
      note: note || undefined,
    } satisfies ApprovalDecision,
  }
}

/**
 * Build metadata patch for rejecting a routing suggestion.
 * Clears routing_approval, stamps auditable rejection, adds suppression flag.
 */
export function buildRejectionPatch(
  actor: string,
  note?: string,
): Record<string, unknown> {
  return {
    routing_approval: false,
    routing_rejected: true,  // suppression flag — prevents reappearance
    routing_decision: {
      rejectedBy: actor,
      rejectedAt: new Date().toISOString(),
      decision: 'rejected',
      note: note || undefined,
    } satisfies RejectionDecision,
  }
}

/**
 * Build metadata patch for submitting a routing suggestion (creating an approval).
 * Called by the routing system when it wants human review of an assignment.
 */
export function buildRoutingSuggestionPatch(
  suggestion: RoutingSuggestion,
): Record<string, unknown> {
  return {
    routing_approval: true,
    routing_rejected: false,
    routing_suggestion: suggestion,
  }
}
