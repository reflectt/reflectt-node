// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// POST /bootstrap/team — returns the TEAM-ROLES.yaml schema, constraints,
// and well-formed examples so the calling agent can compose the team itself.
//
// Design: the agents calling this endpoint are AI — they know what a team
// needs better than any keyword lookup table. This endpoint is scaffolding,
// not brains.

export interface BootstrapTeamRequest {
  /** Optional: agent-provided context about the team's purpose. */
  useCase?: string
  /** Optional: how many agents the caller wants. */
  maxAgents?: number
}

export interface FieldSpec {
  name: string
  type: string
  required: boolean
  description: string
  default?: unknown
  enum?: string[]
}

export interface TeamExample {
  label: string
  description: string
  yaml: string
}

export interface BootstrapTeamResponse {
  schema: {
    description: string
    filePath: string
    hotReload: boolean
    fields: FieldSpec[]
  }
  constraints: {
    maxAgents: number
    wipCapRange: [number, number]
    routingModes: string[]
    reservedNames: string[]
  }
  examples: TeamExample[]
  saveEndpoint: {
    method: string
    path: string
    description: string
  }
  nextSteps: string[]
}

// ── Schema definition ──

const AGENT_FIELDS: FieldSpec[] = [
  { name: 'name', type: 'string', required: true, description: 'Unique agent identifier (lowercase, no spaces). Must match the OpenClaw agent ID.' },
  { name: 'displayName', type: 'string', required: false, description: 'Human-friendly name shown in dashboard and chat (e.g. "Juniper"). If unset, falls back to name.' },
  { name: 'role', type: 'string', required: true, description: 'Human-readable role label (e.g. engineer, designer, ops, content).' },
  { name: 'description', type: 'string', required: true, description: 'One-line description of what this agent does.' },
  { name: 'aliases', type: 'string[]', required: false, description: 'Alternative names this agent responds to (e.g. ["dev", "coder"]).' },
  { name: 'affinityTags', type: 'string[]', required: true, description: 'Keywords that attract tasks to this agent during auto-assignment scoring.' },
  { name: 'wipCap', type: 'number', required: true, description: 'Maximum concurrent "doing" tasks before the agent is deprioritized.', default: 2 },
  { name: 'routingMode', type: 'string', required: false, description: 'How the assignment engine treats this agent.', default: 'default', enum: ['default', 'opt-in'] },
  { name: 'alwaysRoute', type: 'string[]', required: false, description: 'When routingMode=opt-in: keywords that still route to this agent.' },
  { name: 'neverRoute', type: 'string[]', required: false, description: 'Keywords that exclude this agent from assignment, even if affinity matches.' },
  { name: 'neverRouteUnlessLane', type: 'string', required: false, description: 'Exception to neverRoute: allow routing when task.metadata.lane matches this value.' },
  { name: 'protectedDomains', type: 'string[]', required: false, description: 'Hard-enforce: ONLY this agent for tasks matching these keywords (overrides all scoring).' },
]

// ── Examples ──

const EXAMPLES: TeamExample[] = [
  {
    label: 'Dev team (3 agents)',
    description: 'Full-stack development team: engineer builds, designer handles UI, ops manages deployments.',
    yaml: `agents:
  - name: builder
    role: engineer
    description: Full-stack development — ships features and fixes.
    affinityTags: [backend, frontend, api, bug, test, database, typescript]
    wipCap: 2

  - name: pixel
    role: designer
    description: UI/UX design, visual polish, accessibility.
    affinityTags: [design, ui, ux, css, visual, a11y]
    routingMode: opt-in
    alwaysRoute: [design, ui, ux, css, visual]
    neverRoute: [ops, infra, ci, deploy, backend, api, database]
    wipCap: 1

  - name: ops
    role: operations
    description: CI/CD, monitoring, deployments, infrastructure.
    affinityTags: [ci, deploy, ops, docker, monitoring, infra]
    protectedDomains: [deploy, ci]
    wipCap: 2`,
  },
  {
    label: 'Content team (2 agents)',
    description: 'Content creation team: writer creates, strategist plans and measures.',
    yaml: `agents:
  - name: writer
    role: content
    description: Blog posts, docs, social copy, landing page text.
    affinityTags: [content, docs, copy, blog, social, seo]
    wipCap: 2

  - name: strategist
    role: growth
    description: Campaign planning, analytics, funnel optimization.
    affinityTags: [analytics, growth, funnel, campaign, metrics]
    wipCap: 1`,
  },
  {
    label: 'Solo agent (1 agent)',
    description: 'Single generalist agent — handles everything. Good starting point.',
    yaml: `agents:
  - name: agent
    role: generalist
    description: Handles all tasks — engineering, docs, ops.
    affinityTags: [backend, frontend, ops, docs, bug]
    wipCap: 3`,
  },
]

// ── Endpoint handler ──

export function bootstrapTeam(req: BootstrapTeamRequest): BootstrapTeamResponse {
  const maxAgents = req.maxAgents || 10

  return {
    schema: {
      description: 'TEAM-ROLES.yaml defines your agent team — names, roles, routing preferences, and WIP limits. reflectt-node hot-reloads changes (no restart needed).',
      filePath: '$REFLECTT_HOME/TEAM-ROLES.yaml (default: ~/.reflectt/TEAM-ROLES.yaml)',
      hotReload: true,
      fields: AGENT_FIELDS,
    },
    constraints: {
      maxAgents,
      wipCapRange: [1, 10],
      routingModes: ['default', 'opt-in'],
      reservedNames: ['system', 'admin', 'reflectt', 'all'],
    },
    examples: EXAMPLES,
    saveEndpoint: {
      method: 'PUT',
      path: '/config/team-roles',
      description: 'Save the composed TEAM-ROLES.yaml. Accepts { yaml: string } body. reflectt-node validates and hot-reloads.',
    },
    nextSteps: [
      '1. Compose a TEAM-ROLES.yaml based on the schema and examples above.',
      '2. Save it via PUT /config/team-roles or write directly to $REFLECTT_HOME/TEAM-ROLES.yaml.',
      '3. Verify with GET /health/team — checks role coverage and config validity.',
      '4. Create initial tasks via POST /tasks for each agent.',
      '5. Start heartbeat polling: GET /heartbeat/:agent',
    ],
  }
}
