import { execSync } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { DATA_DIR } from './config.js'
import { taskManager } from './tasks.js'
import type { Task } from './types.js'

type RepoSnapshot = {
  commit: string | null
  dirty: boolean
  branch: string | null
  capturedAt: number
}

type DeployMarker = {
  deployedAt: number
  deployedBy?: string
  note?: string
}

const DEPLOY_MARKER_FILE = join(DATA_DIR, 'release.deploy.json')

function runGit(command: string): string | null {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
}

function captureRepoSnapshot(): RepoSnapshot {
  const commit = runGit('git rev-parse HEAD')
  const branch = runGit('git rev-parse --abbrev-ref HEAD')
  const dirtyOutput = runGit('git status --porcelain')
  const dirty = Boolean(dirtyOutput && dirtyOutput.length > 0)

  return {
    commit,
    dirty,
    branch,
    capturedAt: Date.now(),
  }
}

const startupSnapshot = captureRepoSnapshot()

function extractEndpointMentions(task: Task): string[] {
  const haystack = [task.title, task.description || '', ...(task.done_criteria || [])].join('\n')
  const endpointRegex = /\b(?:GET|POST|PATCH|PUT|DELETE)\s+(\/[A-Za-z0-9_:\/\-.?=&]+)\b/g
  const found = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = endpointRegex.exec(haystack)) !== null) {
    found.add(match[1])
  }

  return Array.from(found)
}

async function readDeployMarker(): Promise<DeployMarker | null> {
  try {
    const raw = await fs.readFile(DEPLOY_MARKER_FILE, 'utf-8')
    return JSON.parse(raw) as DeployMarker
  } catch {
    return null
  }
}

async function writeDeployMarker(marker: DeployMarker): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DEPLOY_MARKER_FILE, JSON.stringify(marker, null, 2), 'utf-8')
}

export const releaseManager = {
  getStartupSnapshot(): RepoSnapshot {
    return startupSnapshot
  },

  getCurrentSnapshot(): RepoSnapshot {
    return captureRepoSnapshot()
  },

  async getDeployStatus() {
    const current = captureRepoSnapshot()
    const deployMarker = await readDeployMarker()

    const reasons: string[] = []
    if (startupSnapshot.commit !== current.commit) {
      reasons.push('commit changed since server start')
    }
    if (!startupSnapshot.dirty && current.dirty) {
      reasons.push('working tree became dirty after server start')
    }
    if (startupSnapshot.branch !== current.branch) {
      reasons.push('branch changed since server start')
    }

    return {
      stale: reasons.length > 0,
      reasons,
      startup: startupSnapshot,
      current,
      lastDeploy: deployMarker,
      timestamp: Date.now(),
    }
  },

  async markDeploy(deployedBy?: string, note?: string) {
    const marker: DeployMarker = {
      deployedAt: Date.now(),
      deployedBy,
      note,
    }

    await writeDeployMarker(marker)
    return marker
  },

  async getReleaseNotes(options?: { since?: number; limit?: number }) {
    const deployMarker = await readDeployMarker()
    const fallbackSince = Date.now() - 24 * 60 * 60 * 1000
    const since = options?.since ?? deployMarker?.deployedAt ?? fallbackSince
    const limit = Math.max(1, Math.min(options?.limit ?? 25, 200))

    const doneTasks = taskManager
      .listTasks({ status: 'done' })
      .filter(task => (task.updatedAt || task.createdAt) >= since)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, limit)

    const endpointChanges = new Set<string>()
    for (const task of doneTasks) {
      for (const endpoint of extractEndpointMentions(task)) {
        endpointChanges.add(endpoint)
      }
    }

    const markdownLines: string[] = []
    markdownLines.push('# Release Notes')
    markdownLines.push('')
    markdownLines.push(`Generated: ${new Date().toISOString()}`)
    markdownLines.push(`Window start: ${new Date(since).toISOString()}`)
    if (deployMarker?.deployedAt) {
      markdownLines.push(`Last deploy marker: ${new Date(deployMarker.deployedAt).toISOString()}`)
    }
    markdownLines.push('')

    markdownLines.push('## Merged Tasks')
    markdownLines.push('')
    if (doneTasks.length === 0) {
      markdownLines.push('- No completed tasks in this window.')
    } else {
      for (const task of doneTasks) {
        const owner = task.assignee || task.createdBy
        const priority = task.priority || 'P3'
        markdownLines.push(`- ${task.id} [${priority}] ${task.title} (owner: ${owner})`)
      }
    }

    markdownLines.push('')
    markdownLines.push('## Endpoint Changes (inferred)')
    markdownLines.push('')
    const endpoints = Array.from(endpointChanges).sort()
    if (endpoints.length === 0) {
      markdownLines.push('- None inferred from task metadata.')
    } else {
      for (const endpoint of endpoints) {
        markdownLines.push(`- ${endpoint}`)
      }
    }

    return {
      since,
      generatedAt: Date.now(),
      mergedTasks: doneTasks.map(task => ({
        id: task.id,
        title: task.title,
        assignee: task.assignee,
        createdBy: task.createdBy,
        priority: task.priority,
        tags: task.tags,
        updatedAt: task.updatedAt,
      })),
      endpointChanges: endpoints,
      markdown: markdownLines.join('\n'),
    }
  },
}
