// SPDX-License-Identifier: Apache-2.0
// Role-based assignment engine: affinity scoring + WIP caps

export interface AgentRole {
  name: string
  role: string
  affinityTags: string[]
  protectedDomains?: string[]  // hard-enforce: only this agent for these tags
  wipCap: number               // max doing tasks (default 1)
}

// Agent registry — codifies team routing rules
const AGENT_ROLES: AgentRole[] = [
  {
    name: 'link',
    role: 'builder',
    affinityTags: ['backend', 'api', 'integration', 'bug', 'test', 'webhook', 'server', 'fastify', 'typescript', 'task-lifecycle', 'watchdog', 'database'],
    wipCap: 2,
  },
  {
    name: 'pixel',
    role: 'designer',
    affinityTags: ['dashboard', 'ui', 'css', 'visual', 'animation', 'frontend', 'layout', 'ux', 'modal', 'chart'],
    wipCap: 1,
  },
  {
    name: 'sage',
    role: 'ops',
    affinityTags: ['ci', 'deploy', 'ops', 'merge', 'infra', 'github-actions', 'docker', 'pipeline', 'release', 'codeowners'],
    protectedDomains: ['deploy', 'ci', 'release'],
    wipCap: 1,
  },
  {
    name: 'echo',
    role: 'voice',
    affinityTags: ['content', 'docs', 'landing', 'copy', 'brand', 'marketing', 'social', 'blog', 'readme', 'onboarding'],
    wipCap: 1,
  },
  {
    name: 'harmony',
    role: 'reviewer',
    affinityTags: ['qa', 'review', 'validation', 'audit', 'security', 'compliance', 'testing', 'quality'],
    protectedDomains: ['security', 'audit'],
    wipCap: 2,
  },
  {
    name: 'scout',
    role: 'analyst',
    affinityTags: ['research', 'analysis', 'metrics', 'monitoring', 'analytics', 'data', 'reporting', 'benchmark'],
    wipCap: 1,
  },
]

export function getAgentRoles(): AgentRole[] {
  return AGENT_ROLES
}

export function getAgentRole(name: string): AgentRole | undefined {
  return AGENT_ROLES.find(a => a.name.toLowerCase() === name.toLowerCase())
}

interface TaskForScoring {
  id: string
  title: string
  status: string
  assignee?: string
  tags?: string[]
  done_criteria?: string[]
  metadata?: Record<string, unknown>
}

interface AssignmentScore {
  agent: string
  score: number
  breakdown: {
    affinity: number
    wipPenalty: number
    throughput: number
  }
  wipCount: number
  wipCap: number
  overCap: boolean
}

// Extract scoring keywords from task title + tags + done_criteria
function extractTaskKeywords(task: { title: string; tags?: string[]; done_criteria?: string[] }): string[] {
  const text = [
    task.title,
    ...(task.tags || []),
    ...(task.done_criteria || []),
  ].join(' ').toLowerCase()

  return text.split(/[\s/\-_:,.()+]+/).filter(w => w.length > 2)
}

// Score how well an agent matches a task
export function scoreAssignment(
  agent: AgentRole,
  task: { title: string; tags?: string[]; done_criteria?: string[] },
  currentWip: number,
  recentCompletions: number = 0,
): AssignmentScore {
  const keywords = extractTaskKeywords(task)
  
  // Affinity: how many task keywords match agent tags
  const matchedTags = agent.affinityTags.filter(tag =>
    keywords.some(kw => kw.includes(tag) || tag.includes(kw))
  )
  const affinity = matchedTags.length > 0
    ? Math.min(matchedTags.length / Math.max(keywords.length * 0.3, 1), 1.0)
    : 0

  // WIP penalty: agents at/over cap get penalized
  const wipPenalty = currentWip >= agent.wipCap
    ? -0.5
    : currentWip > 0
      ? -0.1 * currentWip
      : 0

  // Throughput bonus: agents who've shipped recently get a small boost
  const throughput = Math.min(recentCompletions * 0.05, 0.2)

  const score = Math.round((affinity + wipPenalty + throughput) * 100) / 100

  return {
    agent: agent.name,
    score,
    breakdown: { affinity: Math.round(affinity * 100) / 100, wipPenalty, throughput },
    wipCount: currentWip,
    wipCap: agent.wipCap,
    overCap: currentWip >= agent.wipCap,
  }
}

// Suggest best assignee for a task
export function suggestAssignee(
  task: { title: string; tags?: string[]; done_criteria?: string[] },
  allTasks: TaskForScoring[],
  recentCompletionsPerAgent?: Map<string, number>,
): { suggested: string | null; scores: AssignmentScore[]; protectedMatch?: string } {
  // Check protected domains first
  const keywords = extractTaskKeywords(task)
  for (const agent of AGENT_ROLES) {
    if (agent.protectedDomains) {
      const protectedMatch = agent.protectedDomains.find(domain =>
        keywords.some(kw => kw.includes(domain) || domain.includes(kw))
      )
      if (protectedMatch) {
        return {
          suggested: agent.name,
          scores: [],
          protectedMatch: `Protected domain "${protectedMatch}" → ${agent.name}`,
        }
      }
    }
  }

  // Score all agents
  const scores = AGENT_ROLES.map(agent => {
    const currentWip = allTasks.filter(t =>
      t.status === 'doing' && (t.assignee || '').toLowerCase() === agent.name
    ).length
    const completions = recentCompletionsPerAgent?.get(agent.name) || 0
    return scoreAssignment(agent, task, currentWip, completions)
  })

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score)

  // Suggest top scorer if they have positive affinity
  const top = scores[0]
  const suggested = top && top.score > 0 && !top.overCap ? top.agent : null

  return { suggested, scores }
}

// Check WIP cap for an agent
export function checkWipCap(
  agentName: string,
  allTasks: TaskForScoring[],
  override?: string,
): { allowed: boolean; wipCount: number; wipCap: number; message?: string } {
  const agent = getAgentRole(agentName)
  if (!agent) return { allowed: true, wipCount: 0, wipCap: 999 } // unknown agents: no cap

  const wipCount = allTasks.filter(t =>
    t.status === 'doing' && (t.assignee || '').toLowerCase() === agent.name
  ).length

  if (wipCount >= agent.wipCap) {
    if (override) {
      return {
        allowed: true,
        wipCount,
        wipCap: agent.wipCap,
        message: `WIP cap (${agent.wipCap}) exceeded with override: ${override}`,
      }
    }
    return {
      allowed: false,
      wipCount,
      wipCap: agent.wipCap,
      message: `WIP cap reached: ${agentName} has ${wipCount}/${agent.wipCap} doing tasks. Include metadata.wip_override with reason to proceed.`,
    }
  }

  return { allowed: true, wipCount, wipCap: agent.wipCap }
}
