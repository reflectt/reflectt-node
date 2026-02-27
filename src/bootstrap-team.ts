// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// POST /bootstrap/team — recommend team composition, initial tasks, and heartbeat configs
// based on a short use-case description.

export interface BootstrapTeamRequest {
  useCase: string
  constraints?: {
    maxAgents?: number
    budget?: string
  }
  models?: string[]
  channels?: string[]
}

export interface RecommendedAgent {
  name: string
  role: string
  description: string
  affinityTags: string[]
  wipCap: number
  suggestedModel?: string
}

export interface InitialTask {
  title: string
  assignee: string
  reviewer: string
  priority: string
  eta: string
  done_criteria: string[]
}

export interface HeartbeatSnippet {
  agent: string
  markdown: string
}

export interface BootstrapTeamResponse {
  useCase: string
  agents: RecommendedAgent[]
  initialTasks: InitialTask[]
  heartbeatSnippets: Record<string, string>
  teamRolesYaml: string
  nextSteps: string[]
}

// ── Use-case pattern matching ──
// Simple keyword-based templates. Future: LLM-powered composition.

interface TeamTemplate {
  keywords: string[]
  agents: RecommendedAgent[]
  taskTemplates: Array<{
    title: string
    assigneeRole: string
    reviewerRole: string
    priority: string
    eta: string
    done_criteria: string[]
  }>
}

const TEMPLATES: TeamTemplate[] = [
  {
    keywords: ['support', 'helpdesk', 'managed', 'node', 'monitoring', 'ops', 'infrastructure'],
    agents: [
      { name: 'builder', role: 'engineer', description: 'Builds features, fixes bugs, ships code.', affinityTags: ['backend', 'api', 'bug', 'integration', 'server'], wipCap: 2 },
      { name: 'ops', role: 'operations', description: 'Monitors systems, manages deployments, reviews work.', affinityTags: ['infra', 'ci', 'monitoring', 'deploy', 'ops'], wipCap: 3 },
      { name: 'scout', role: 'analyst', description: 'Tracks metrics, triages issues, prioritizes.', affinityTags: ['analytics', 'metrics', 'research', 'triage'], wipCap: 1 },
    ],
    taskTemplates: [
      { title: 'Set up health monitoring for all nodes', assigneeRole: 'operations', reviewerRole: 'engineer', priority: 'P1', eta: '~2h', done_criteria: ['Health endpoint configured', '/health returns ok for all nodes', 'Alert on failure'] },
      { title: 'Create runbook for common node issues', assigneeRole: 'operations', reviewerRole: 'analyst', priority: 'P2', eta: '~4h', done_criteria: ['Runbook covers top 5 failure modes', 'Each entry has: symptom, cause, fix', 'Posted to team docs'] },
      { title: 'Set up metrics dashboard', assigneeRole: 'analyst', reviewerRole: 'operations', priority: 'P2', eta: '~3h', done_criteria: ['Dashboard shows: uptime, task throughput, error rate', 'Auto-refreshes', 'Accessible via /dashboard'] },
    ],
  },
  {
    keywords: ['content', 'growth', 'marketing', 'launch', 'brand', 'social'],
    agents: [
      { name: 'builder', role: 'engineer', description: 'Builds landing pages, integrations, and tools.', affinityTags: ['frontend', 'api', 'integration', 'landing'], wipCap: 2 },
      { name: 'writer', role: 'content', description: 'Creates copy, docs, blog posts, and social content.', affinityTags: ['content', 'docs', 'copy', 'blog', 'social', 'brand'], wipCap: 2 },
      { name: 'strategist', role: 'growth', description: 'Plans campaigns, tracks metrics, optimizes funnels.', affinityTags: ['analytics', 'growth', 'funnel', 'campaign', 'metrics'], wipCap: 1 },
    ],
    taskTemplates: [
      { title: 'Create landing page for launch', assigneeRole: 'engineer', reviewerRole: 'content', priority: 'P1', eta: '~4h', done_criteria: ['Landing page deployed', 'Hero + CTA + feature list', 'Mobile responsive', 'UTM tracking works'] },
      { title: 'Write launch announcement blog post', assigneeRole: 'content', reviewerRole: 'growth', priority: 'P1', eta: '~3h', done_criteria: ['800+ word post', 'SEO meta tags', 'Published to blog', 'Social sharing configured'] },
      { title: 'Set up analytics and conversion tracking', assigneeRole: 'growth', reviewerRole: 'engineer', priority: 'P2', eta: '~2h', done_criteria: ['Analytics events for: page view, CTA click, signup', 'Funnel dashboard created', 'UTM parameters tracked'] },
    ],
  },
  {
    keywords: ['development', 'coding', 'software', 'app', 'product', 'feature', 'build'],
    agents: [
      { name: 'builder', role: 'engineer', description: 'Full-stack development, ships features and fixes.', affinityTags: ['backend', 'frontend', 'api', 'bug', 'test', 'database'], wipCap: 2 },
      { name: 'reviewer', role: 'qa', description: 'Reviews code, validates quality, manages releases.', affinityTags: ['qa', 'review', 'testing', 'security', 'release'], wipCap: 2 },
      { name: 'designer', role: 'design', description: 'UI/UX design, user research, visual polish.', affinityTags: ['ui', 'ux', 'design', 'visual', 'css', 'layout'], wipCap: 1 },
    ],
    taskTemplates: [
      { title: 'Set up project structure and CI pipeline', assigneeRole: 'engineer', reviewerRole: 'qa', priority: 'P1', eta: '~3h', done_criteria: ['Repository initialized', 'CI runs lint + test on PRs', 'Deploy pipeline configured'] },
      { title: 'Create initial UI mockups / component library', assigneeRole: 'design', reviewerRole: 'engineer', priority: 'P2', eta: '~4h', done_criteria: ['Core components styled', 'Design tokens documented', 'Responsive layout works'] },
      { title: 'Write first integration test suite', assigneeRole: 'qa', reviewerRole: 'engineer', priority: 'P2', eta: '~2h', done_criteria: ['Test framework configured', '5+ smoke tests', 'CI runs tests on each PR'] },
    ],
  },
]

// Default fallback template
const DEFAULT_TEMPLATE: TeamTemplate = {
  keywords: [],
  agents: [
    { name: 'builder', role: 'engineer', description: 'Builds features, fixes bugs, ships code.', affinityTags: ['backend', 'api', 'integration', 'bug'], wipCap: 2 },
    { name: 'ops', role: 'operations', description: 'Monitors systems, reviews work, manages flow.', affinityTags: ['ops', 'ci', 'monitoring', 'review'], wipCap: 2 },
  ],
  taskTemplates: [
    { title: 'Set up reflectt-node and verify health', assigneeRole: 'engineer', reviewerRole: 'operations', priority: 'P1', eta: '~1h', done_criteria: ['reflectt-node running', '/health returns ok', 'TEAM-ROLES.yaml customized'] },
    { title: 'Create first team task and verify workflow', assigneeRole: 'operations', reviewerRole: 'engineer', priority: 'P1', eta: '~1h', done_criteria: ['Task created via API', 'Task moves through todo → doing → validating → done', 'Comment added'] },
  ],
}

function matchTemplate(useCase: string): TeamTemplate {
  const lower = useCase.toLowerCase()
  let bestMatch: TeamTemplate | null = null
  let bestScore = 0

  for (const template of TEMPLATES) {
    const score = template.keywords.filter(kw => lower.includes(kw)).length
    if (score > bestScore) {
      bestScore = score
      bestMatch = template
    }
  }

  return bestMatch || DEFAULT_TEMPLATE
}

function generateHeartbeatSnippet(agent: RecommendedAgent, port = 4445): string {
  return `# HEARTBEAT.md — ${agent.name}

## Priority Order
1. Single heartbeat call:
   - \`curl -s "http://127.0.0.1:${port}/heartbeat/${agent.name}"\`
   - Returns: active task, next task, slim inbox, queue counts, suggested action
2. If any task exists, **do real work first** (ship code/docs/artifacts).
3. Respond to direct mentions.
4. **Never report task status from memory alone** — always query the API first.

## Rules
- Do not load full chat history.
- Do not post plan-only updates.
- If nothing changed and no direct action is required, reply \`HEARTBEAT_OK\`.
`
}

function generateTeamRolesYaml(agents: RecommendedAgent[]): string {
  let yaml = `# TEAM-ROLES.yaml — Generated by /bootstrap/team\n# Customize agent names, roles, and routing tags for your team.\n\nagents:\n`
  for (const agent of agents) {
    yaml += `  - name: ${agent.name}\n`
    yaml += `    role: ${agent.role}\n`
    yaml += `    description: ${agent.description}\n`
    yaml += `    affinityTags:\n`
    for (const tag of agent.affinityTags) {
      yaml += `      - ${tag}\n`
    }
    yaml += `    wipCap: ${agent.wipCap}\n\n`
  }
  return yaml
}

export function bootstrapTeam(req: BootstrapTeamRequest): BootstrapTeamResponse {
  const template = matchTemplate(req.useCase)
  const maxAgents = req.constraints?.maxAgents || template.agents.length

  // Apply agent limit
  const agents = template.agents.slice(0, maxAgents).map(a => ({
    ...a,
    suggestedModel: req.models?.[0],
  }))

  // Build agent name→role map for task resolution
  const roleToAgent = new Map<string, string>()
  for (const a of agents) {
    roleToAgent.set(a.role, a.name)
  }

  // Generate initial tasks
  const initialTasks: InitialTask[] = template.taskTemplates
    .filter(tt => roleToAgent.has(tt.assigneeRole))
    .map(tt => ({
      title: tt.title,
      assignee: roleToAgent.get(tt.assigneeRole) || agents[0]!.name,
      reviewer: roleToAgent.get(tt.reviewerRole) || agents[agents.length > 1 ? 1 : 0]!.name,
      priority: tt.priority,
      eta: tt.eta,
      done_criteria: tt.done_criteria,
    }))

  // Generate heartbeat snippets
  const heartbeatSnippets: Record<string, string> = {}
  for (const a of agents) {
    heartbeatSnippets[a.name] = generateHeartbeatSnippet(a)
  }

  return {
    useCase: req.useCase,
    agents,
    initialTasks,
    heartbeatSnippets,
    teamRolesYaml: generateTeamRolesYaml(agents),
    nextSteps: [
      '1. Save the TEAM-ROLES.yaml to ~/.reflectt/TEAM-ROLES.yaml',
      '2. Create the initial tasks via POST /tasks',
      '3. Configure each agent with its HEARTBEAT.md',
      '4. Start agents and verify with GET /heartbeat/:agent',
      ...(req.channels?.length ? [`5. Set up channels: ${req.channels.join(', ')}`] : []),
    ],
  }
}
