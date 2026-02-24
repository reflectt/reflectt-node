// SPDX-License-Identifier: Apache-2.0
// Starter Team Template — scaffolds a default team configuration.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './config.js'

export interface StarterAgent {
  name: string
  role: string
  description: string
  soulMd: string
}

const STARTER_AGENTS: StarterAgent[] = [
  {
    name: 'builder',
    role: 'engineer',
    description: 'Builds features, fixes bugs, ships code.',
    soulMd: `# Builder

*I turn ideas into working code.*

## What I Do
- Full-stack development (frontend, backend, APIs)
- Code review and quality
- Testing and debugging

## How I Work
1. Read existing code first
2. Make small, focused changes
3. Test before shipping
4. Document what I learn

## Rules
- Ship working code, not demos
- Quality over quantity
- Read before writing
`,
  },
  {
    name: 'ops',
    role: 'operations',
    description: 'Monitors systems, manages deployments, keeps things running.',
    soulMd: `# Ops

*I keep the systems running and the team productive.*

## What I Do
- Monitor health and performance
- Review and validate work
- Manage task flow and priorities
- Spot blockers before they block

## How I Work
1. Check system health regularly
2. Review PRs and task quality
3. Escalate issues early
4. Keep the board clean

## Rules
- Proactive, not reactive
- Evidence over assumptions
- Clear communication
`,
  },
]

export interface StarterTeamResult {
  created: string[]
  skipped: string[]
  teamDir: string
}

/**
 * Scaffold a starter team with default agents.
 * Creates workspace directories + SOUL.md files.
 * Idempotent: skips agents that already exist.
 */
export async function createStarterTeam(opts?: {
  baseDir?: string
  agents?: StarterAgent[]
}): Promise<StarterTeamResult> {
  const baseDir = opts?.baseDir || join(DATA_DIR, 'agents')
  const agents = opts?.agents || STARTER_AGENTS

  await fs.mkdir(baseDir, { recursive: true })

  const created: string[] = []
  const skipped: string[] = []

  for (const agent of agents) {
    const agentDir = join(baseDir, agent.name)

    try {
      await fs.access(agentDir)
      skipped.push(agent.name)
      continue
    } catch {
      // Directory doesn't exist — create it
    }

    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(join(agentDir, 'SOUL.md'), agent.soulMd.trim() + '\n', 'utf-8')
    await fs.writeFile(
      join(agentDir, 'AGENTS.md'),
      `# ${agent.name}\n\nRole: ${agent.role}\n\n${agent.description}\n`,
      'utf-8',
    )

    created.push(agent.name)
  }

  return { created, skipped, teamDir: baseDir }
}

export { STARTER_AGENTS }
