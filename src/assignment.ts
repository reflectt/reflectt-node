// SPDX-License-Identifier: Apache-2.0
// Role-based assignment engine: config-driven from TEAM-ROLES.yaml

import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile, statSync, mkdirSync } from 'fs'
import { join } from 'path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { homedir } from 'os'

export interface AgentRole {
  name: string
  role: string
  description?: string
  affinityTags: string[]
  alwaysRoute?: string[]       // soft routing preference for assignment suggestions
  neverRoute?: string[]        // explicit routing exclusions
  protectedDomains?: string[]  // hard-enforce: only this agent for these tags
  wipCap: number               // max doing tasks (default 1)
}

// ── YAML config paths (checked in order) ──
const CONFIG_PATHS = [
  join(homedir(), '.reflectt', 'TEAM-ROLES.yaml'),
  join(homedir(), '.reflectt', 'TEAM-ROLES.yml'),
]

// ── Built-in fallback (matches defaults/TEAM-ROLES.yaml) ──
// These are generic starter agents. Users should customize TEAM-ROLES.yaml
// with their actual team members.
const BUILTIN_ROLES: AgentRole[] = [
  {
    name: 'agent-1',
    role: 'builder',
    description: 'Example builder agent. Replace with your team\'s agents.',
    affinityTags: ['backend', 'api', 'integration'],
    wipCap: 2,
  },
  {
    name: 'agent-2',
    role: 'designer',
    description: 'Example designer agent. Replace with your team\'s agents.',
    affinityTags: ['design', 'ui', 'brand'],
    wipCap: 2,
  },
  {
    name: 'agent-3',
    role: 'ops',
    description: 'Example ops agent. Replace with your team\'s agents.',
    affinityTags: ['infra', 'ci', 'monitoring'],
    wipCap: 3,
  },
]

// ── Test-only role override ──
// Tests that depend on specific agent names can call setTestRoles() before
// server creation. In production, BUILTIN_ROLES is the last-resort fallback.
let testRolesOverride: AgentRole[] | null = null

/** Override built-in roles for tests. Call with null to reset. */
export function setTestRoles(roles: AgentRole[] | null): void {
  testRolesOverride = roles
}

// ── Loaded state ──
let loadedRoles: AgentRole[] = BUILTIN_ROLES
let loadedFromPath: string | null = null
let lastMtime: number = 0
let watchActive = false

function parseRolesYaml(content: string): AgentRole[] {
  const data = parseYaml(content)
  if (!data?.agents || !Array.isArray(data.agents)) {
    throw new Error('TEAM-ROLES.yaml: missing or invalid "agents" array')
  }
  return data.agents.map((a: any, i: number) => {
    if (!a.name || typeof a.name !== 'string') {
      throw new Error(`TEAM-ROLES.yaml: agent[${i}] missing "name"`)
    }
    if (!a.role || typeof a.role !== 'string') {
      throw new Error(`TEAM-ROLES.yaml: agent[${i}] (${a.name}) missing "role"`)
    }
    return {
      name: a.name,
      role: a.role,
      description: typeof a.description === 'string' ? a.description : undefined,
      affinityTags: Array.isArray(a.affinityTags) ? a.affinityTags.map(String) : [],
      alwaysRoute: Array.isArray(a.alwaysRoute) ? a.alwaysRoute.map(String) : undefined,
      neverRoute: Array.isArray(a.neverRoute) ? a.neverRoute.map(String) : undefined,
      protectedDomains: Array.isArray(a.protectedDomains) ? a.protectedDomains.map(String) : undefined,
      wipCap: typeof a.wipCap === 'number' && a.wipCap > 0 ? a.wipCap : 1,
    }
  })
}

function loadFromFile(path: string): AgentRole[] | null {
  try {
    if (!existsSync(path)) return null
    const content = readFileSync(path, 'utf-8')
    const roles = parseRolesYaml(content)
    if (roles.length === 0) return null
    return roles
  } catch (err) {
    console.error(`[Assignment] Failed to parse ${path}:`, (err as Error).message)
    return null
  }
}

/** Load roles from YAML config or fall back to built-in defaults */
export function loadAgentRoles(): { roles: AgentRole[]; source: string } {
  const isTest = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test'

  // Try user config paths first (but never during tests; tests must be hermetic)
  if (!isTest) {
    for (const configPath of CONFIG_PATHS) {
      const roles = loadFromFile(configPath)
      if (roles) {
        loadedRoles = roles
        loadedFromPath = configPath
        try {
          lastMtime = statSync(configPath).mtimeMs
        } catch { /* ignore */ }
        console.log(`[Assignment] Loaded ${roles.length} agent roles from ${configPath}`)
        return { roles, source: configPath }
      }
    }
  }

  // Try defaults shipped with repo
  try {
    const defaultsPath = new URL('../defaults/TEAM-ROLES.yaml', import.meta.url)
    const content = readFileSync(defaultsPath, 'utf-8')
    const roles = parseRolesYaml(content)
    if (roles.length > 0) {
      loadedRoles = roles
      loadedFromPath = 'defaults/TEAM-ROLES.yaml'
      console.log(`[Assignment] Loaded ${roles.length} agent roles from defaults/TEAM-ROLES.yaml`)
      console.log(`[Assignment] ⚠️  Using default placeholder agents. Customize your team:`)
      console.log(`[Assignment]    cp defaults/TEAM-ROLES.yaml ~/.reflectt/TEAM-ROLES.yaml`)
      console.log(`[Assignment]    # Then edit with your agent names and roles`)
      return { roles, source: 'defaults/TEAM-ROLES.yaml' }
    }
  } catch { /* ignore */ }

  // Fall back to test override or built-in
  const fallbackRoles = testRolesOverride || BUILTIN_ROLES
  const source = testRolesOverride ? 'test-override' : 'builtin'
  loadedRoles = fallbackRoles
  loadedFromPath = null
  console.log(`[Assignment] Using ${fallbackRoles.length} ${source} agent roles (no YAML found)`)
  return { roles: fallbackRoles, source }
}

/** Start watching the config file for changes (hot-reload) */
export function startConfigWatch(): void {
  if (watchActive) return
  
  // Watch user config paths
  for (const configPath of CONFIG_PATHS) {
    if (existsSync(configPath)) {
      try {
        watchFile(configPath, { interval: 5000 }, () => {
          try {
            const stat = statSync(configPath)
            if (stat.mtimeMs !== lastMtime) {
              console.log(`[Assignment] TEAM-ROLES.yaml changed, reloading...`)
              loadAgentRoles()
            }
          } catch { /* file removed */ }
        })
        watchActive = true
        console.log(`[Assignment] Watching ${configPath} for changes`)
      } catch { /* ignore */ }
    }
  }
}

/** Stop watching config files */
export function stopConfigWatch(): void {
  if (!watchActive) return
  for (const configPath of CONFIG_PATHS) {
    try { unwatchFile(configPath) } catch { /* ignore */ }
  }
  watchActive = false
}

/** Get the current loaded roles */
export function getAgentRoles(): AgentRole[] {
  return loadedRoles
}

/** Get info about where roles were loaded from */
export function getAgentRolesSource(): { source: string; count: number } {
  return {
    source: loadedFromPath || 'builtin',
    count: loadedRoles.length,
  }
}

export function getAgentRole(name: string): AgentRole | undefined {
  return loadedRoles.find(a => a.name.toLowerCase() === name.toLowerCase())
}

/** Save updated agent roles to YAML config file */
export function saveAgentRoles(roles: AgentRole[]): { saved: boolean; path: string; version: number } {
  const targetPath = CONFIG_PATHS[0] // ~/.reflectt/TEAM-ROLES.yaml
  const dir = targetPath.substring(0, targetPath.lastIndexOf('/'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const data = {
    agents: roles.map(r => ({
      name: r.name,
      role: r.role,
      ...(r.description ? { description: r.description } : {}),
      affinityTags: r.affinityTags,
      ...(r.alwaysRoute?.length ? { alwaysRoute: r.alwaysRoute } : {}),
      ...(r.neverRoute?.length ? { neverRoute: r.neverRoute } : {}),
      ...(r.protectedDomains?.length ? { protectedDomains: r.protectedDomains } : {}),
      wipCap: r.wipCap,
    })),
  }

  writeFileSync(targetPath, stringifyYaml(data), 'utf-8')
  loadedRoles = roles
  loadedFromPath = targetPath
  lastMtime = statSync(targetPath).mtimeMs

  return { saved: true, path: targetPath, version: Date.now() }
}

interface TaskForScoring {
  id: string
  title: string
  status: string
  assignee?: string
  reviewer?: string
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

// ── Designer routing guardrail ────────────────────────────────────────────

function normalizeTagList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)
}

function getTaskMeta(task: any): Record<string, unknown> {
  const meta = task?.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) return meta as Record<string, unknown>
  return {}
}

/**
 * Hard default: agents with role=designer are excluded unless the task explicitly opts in.
 * Opt-in signals (any):
 * - metadata.lane = design
 * - metadata.surface = user-facing OR known user-facing surfaces
 * - tags include UI/design or copy/brand/marketing
 *
 * Hard exclusion: onboarding plumbing families (ws-pairing/auth/preflight/etc)
 * exclude designers unless lane=design is explicitly set.
 */
function designerEligibleForTask(task: { tags?: string[]; metadata?: Record<string, unknown> }): boolean {
  const meta = getTaskMeta(task)

  const lane = String((meta as any).lane ?? '').trim().toLowerCase()
  const surfaceRaw = String((meta as any).surface ?? '').trim().toLowerCase()

  const explicitDesign = lane === 'design'

  // Cluster-based routing guardrail (prefer metadata.cluster_key; tolerate cluster_key in tags)
  const clusterKey = String((meta as any).cluster_key ?? (meta as any).cluster ?? '').trim().toLowerCase()
  const onboardingPlumbing = /ws[-_ ]?pair|pairing|preflight|auth|provision|provisioning|gateway|join[-_ ]?token|token|ssh|deploy|docker|ci|infra/.test(clusterKey)
  if (onboardingPlumbing && !explicitDesign) return false

  const userFacingSurfaces = new Set([
    'user-facing',
    'reflectt-node',
    'reflectt-cloud-app',
    'reflectt.ai',
    'app.reflectt.ai',
  ])
  const explicitUserFacing = userFacingSurfaces.has(surfaceRaw)

  const tags = normalizeTagList(task.tags).concat(normalizeTagList((meta as any).tags))
  const allowTags = [
    'design', 'ui', 'ux', 'a11y', 'css', 'visual', 'dashboard',
    // copy/visual polish tasks
    'copy', 'brand', 'marketing',
  ]
  const hasAllowTag = tags.some(t => allowTags.some(a => t === a || t.includes(a)))

  return explicitDesign || explicitUserFacing || hasAllowTag
}

// Score how well an agent matches a task
export function scoreAssignment(
  agent: AgentRole,
  task: { title: string; tags?: string[]; done_criteria?: string[]; metadata?: Record<string, unknown> },
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
  task: { title: string; tags?: string[]; done_criteria?: string[]; metadata?: Record<string, unknown> },
  allTasks: TaskForScoring[],
  recentCompletionsPerAgent?: Map<string, number>,
): { suggested: string | null; scores: AssignmentScore[]; protectedMatch?: string } {
  const roles = getAgentRoles().filter(r => r.role !== 'designer' || designerEligibleForTask(task))

  // Check protected domains first (but still return full scoring for transparency)
  let protectedDecision: { agent: string; match: string } | null = null
  const keywords = extractTaskKeywords(task)
  for (const agent of roles) {
    if (agent.protectedDomains) {
      const protectedMatch = agent.protectedDomains.find(domain =>
        keywords.some(kw => kw.includes(domain) || domain.includes(kw))
      )
      if (protectedMatch) {
        protectedDecision = { agent: agent.name, match: protectedMatch }
        break
      }
    }
  }

  // Score all agents
  const scores = roles.map(agent => {
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

  if (protectedDecision) {
    return {
      suggested: protectedDecision.agent,
      scores,
      protectedMatch: `Protected domain "${protectedDecision.match}" → ${protectedDecision.agent}`,
    }
  }

  return { suggested, scores }
}

// Suggest best reviewer for a task (load-balanced)
export function suggestReviewer(
  task: { title: string; assignee?: string; tags?: string[]; done_criteria?: string[]; metadata?: Record<string, unknown> },
  allTasks: TaskForScoring[],
): { suggested: string | null; scores: Array<{ agent: string; score: number; validatingLoad: number; role: string }> } {
  const roles = getAgentRoles().filter(r => r.role !== 'designer' || designerEligibleForTask(task))

  // Exclude the assignee from reviewer candidates
  const candidates = roles.filter(r => 
    r.name.toLowerCase() !== (task.assignee || '').toLowerCase()
  )

  if (candidates.length === 0) {
    return { suggested: null, scores: [] }
  }

  // Score each candidate
  const scored = candidates.map(agent => {
    const getReviewer = (t: TaskForScoring) => (t.reviewer || (t.metadata?.reviewer as string) || '').toLowerCase()

    // Count tasks currently in validating where this agent is reviewer
    const validatingLoad = allTasks.filter(t =>
      t.status === 'validating' && getReviewer(t) === agent.name.toLowerCase()
    ).length

    // Also count doing tasks where this agent is reviewer (upcoming review load)
    const pendingLoad = allTasks.filter(t =>
      t.status === 'doing' && getReviewer(t) === agent.name.toLowerCase()
    ).length

    // Role bonus: reviewers/ops get priority
    const roleBonus = agent.role === 'reviewer' ? 0.5
      : agent.role === 'ops' ? 0.3
      : 0.1

    // Affinity: does this agent have relevant domain knowledge?
    const keywords = extractTaskKeywords(task)
    const matchedTags = agent.affinityTags.filter(tag =>
      keywords.some(kw => kw.includes(tag) || tag.includes(kw))
    )
    const affinityBonus = Math.min(matchedTags.length * 0.1, 0.3)

    // Load penalty: more validating work = lower score
    const loadPenalty = (validatingLoad * 0.3) + (pendingLoad * 0.1)

    // SLA risk: penalize if agent has high-priority tasks in review queue
    const highPriorityReviewLoad = allTasks.filter(t =>
      (t.status === 'validating' || t.status === 'doing') &&
      getReviewer(t) === agent.name.toLowerCase() &&
      (t.metadata?.priority === 'P0' || t.metadata?.priority === 'P1')
    ).length
    const slaRiskPenalty = highPriorityReviewLoad * 0.2

    const score = Math.round((roleBonus + affinityBonus - loadPenalty - slaRiskPenalty) * 100) / 100

    return { agent: agent.name, score, validatingLoad, role: agent.role }
  })

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  return { suggested: scored[0]?.agent || null, scores: scored }
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

// Export for testing
export { parseRolesYaml as _parseRolesYaml, CONFIG_PATHS as _CONFIG_PATHS }
