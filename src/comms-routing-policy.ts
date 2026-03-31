// SPDX-License-Identifier: Apache-2.0

export type CommsChannel = 'email' | 'sms'

export type RoutingReasonCode =
  | 'ALIAS_OWNER_MATCH'
  | 'SHARED_INBOX_ASSIGNMENT'
  | 'NUMBER_OWNER_MATCH'
  | 'CONFLICT_ALIAS_SHARED_INBOX'
  | 'CONFLICT_NUMBER_SHARED_INBOX'
  | 'OWNER_UNAVAILABLE_FALLBACK'
  | 'UNKNOWN_RECIPIENT_FALLBACK'

export interface SharedInboxPolicy {
  owner: string
  assignees: string[]
}

export interface CommsRoutingPolicy {
  aliasOwners: Record<string, string>
  sharedInboxes: Record<string, SharedInboxPolicy>
  numberOwners: Record<string, string>
  defaultOwner: string
  fallbackAssignee: string
  availableAgents?: string[]
}

export interface RoutingScenario {
  id: string
  channel: CommsChannel
  recipient: string
}

export interface CommsRouteResult {
  scenarioId: string
  owner: string
  assignee: string
  fallback: boolean
  escalate: boolean
  reasonCode: RoutingReasonCode
  rationale: string
}

function norm(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function isAvailable(agent: string, availableAgents?: string[]): boolean {
  if (!availableAgents || availableAgents.length === 0) return true
  return availableAgents.map(norm).includes(norm(agent))
}

function pickSharedAssignee(policy: SharedInboxPolicy, availableAgents?: string[]): string {
  const list = policy.assignees || []
  const available = list.find(agent => isAvailable(agent, availableAgents))
  return available || policy.owner
}

export function resolveCommsRoute(
  scenario: RoutingScenario,
  policy: CommsRoutingPolicy,
): CommsRouteResult {
  const recipient = norm(scenario.recipient)
  const aliasOwner = policy.aliasOwners[recipient]
  const shared = policy.sharedInboxes[recipient]
  const numberOwner = policy.numberOwners[recipient]

  // Conflict: alias points to one owner, shared inbox config points to another.
  if (aliasOwner && shared && norm(aliasOwner) !== norm(shared.owner)) {
    return {
      scenarioId: scenario.id,
      owner: policy.defaultOwner,
      assignee: policy.fallbackAssignee,
      fallback: true,
      escalate: true,
      reasonCode: 'CONFLICT_ALIAS_SHARED_INBOX',
      rationale: `alias owner (${aliasOwner}) and shared inbox owner (${shared.owner}) conflict`,
    }
  }

  // Conflict: number ownership disagrees with shared inbox owner.
  if (numberOwner && shared && norm(numberOwner) !== norm(shared.owner)) {
    return {
      scenarioId: scenario.id,
      owner: policy.defaultOwner,
      assignee: policy.fallbackAssignee,
      fallback: true,
      escalate: true,
      reasonCode: 'CONFLICT_NUMBER_SHARED_INBOX',
      rationale: `number owner (${numberOwner}) and shared inbox owner (${shared.owner}) conflict`,
    }
  }

  // Alias ownership (email)
  if (scenario.channel === 'email' && aliasOwner) {
    if (isAvailable(aliasOwner, policy.availableAgents)) {
      return {
        scenarioId: scenario.id,
        owner: aliasOwner,
        assignee: aliasOwner,
        fallback: false,
        escalate: false,
        reasonCode: 'ALIAS_OWNER_MATCH',
        rationale: `recipient alias is directly owned by ${aliasOwner}`,
      }
    }

    return {
      scenarioId: scenario.id,
      owner: aliasOwner,
      assignee: policy.fallbackAssignee,
      fallback: true,
      escalate: false,
      reasonCode: 'OWNER_UNAVAILABLE_FALLBACK',
      rationale: `alias owner ${aliasOwner} unavailable; routed to fallback assignee`,
    }
  }

  // Shared inbox assignment (email/sms)
  if (shared) {
    const assignee = pickSharedAssignee(shared, policy.availableAgents)
    if (!isAvailable(assignee, policy.availableAgents)) {
      return {
        scenarioId: scenario.id,
        owner: shared.owner,
        assignee: policy.fallbackAssignee,
        fallback: true,
        escalate: false,
        reasonCode: 'OWNER_UNAVAILABLE_FALLBACK',
        rationale: `shared inbox assignees unavailable; fallback assignee used`,
      }
    }

    return {
      scenarioId: scenario.id,
      owner: shared.owner,
      assignee,
      fallback: false,
      escalate: false,
      reasonCode: 'SHARED_INBOX_ASSIGNMENT',
      rationale: `shared inbox routed with owner ${shared.owner} and assignee ${assignee}`,
    }
  }

  // Number ownership (sms)
  if (scenario.channel === 'sms' && numberOwner) {
    if (isAvailable(numberOwner, policy.availableAgents)) {
      return {
        scenarioId: scenario.id,
        owner: numberOwner,
        assignee: numberOwner,
        fallback: false,
        escalate: false,
        reasonCode: 'NUMBER_OWNER_MATCH',
        rationale: `number is directly owned by ${numberOwner}`,
      }
    }

    return {
      scenarioId: scenario.id,
      owner: numberOwner,
      assignee: policy.fallbackAssignee,
      fallback: true,
      escalate: false,
      reasonCode: 'OWNER_UNAVAILABLE_FALLBACK',
      rationale: `number owner ${numberOwner} unavailable; routed to fallback assignee`,
    }
  }

  // Unknown recipient
  return {
    scenarioId: scenario.id,
    owner: policy.defaultOwner,
    assignee: policy.fallbackAssignee,
    fallback: true,
    escalate: true,
    reasonCode: 'UNKNOWN_RECIPIENT_FALLBACK',
    rationale: 'recipient did not match alias/shared inbox/number ownership maps',
  }
}

export function simulateRoutingScenarios(
  scenarios: RoutingScenario[],
  policy: CommsRoutingPolicy,
): CommsRouteResult[] {
  return scenarios.map(s => resolveCommsRoute(s, policy))
}
