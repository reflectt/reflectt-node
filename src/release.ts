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
  commit?: string | null
  previousCommit?: string | null
}

type ReleaseDiffCommit = {
  sha: string
  subject: string
}

const DEPLOY_MARKER_FILE = join(DATA_DIR, 'release.deploy.json')
const SHA_RE = /^[a-fA-F0-9]{7,40}$/

function runGit(command: string): string | null {
  try {
    return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
}

function normalizeSha(input?: string | null): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  return SHA_RE.test(raw) ? raw : null
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

function extractEndpointsFromGitDiff(fromSha: string, toSha: string): string[] {
  const diff = runGit(`git diff --unified=0 ${fromSha} ${toSha} -- src`)
  if (!diff) return []

  const found = new Set<string>()
  const routeRegex = /^\+\s*app\.(get|post|patch|put|delete)\s*(?:<[^>]+>)?\(\s*['"`]([^'"`]+)['"`]/i

  for (const line of diff.split('\n')) {
    const match = line.match(routeRegex)
    if (!match) continue
    found.add(`${match[1].toUpperCase()} ${match[2]}`)
  }

  return Array.from(found).sort()
}

function githubRepoBase(): string | null {
  const remote = runGit('git remote get-url origin')
  if (!remote) return null

  const trimmed = remote.trim().replace(/\.git$/i, '')

  if (trimmed.startsWith('https://github.com/')) {
    return trimmed
  }

  const sshMatch = trimmed.match(/^git@github\.com:(.+)$/i)
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`
  }

  return null
}

function extractPullRequestLinks(commits: ReleaseDiffCommit[]): string[] {
  const repoBase = githubRepoBase()
  if (!repoBase) return []

  const prs = new Set<number>()
  for (const commit of commits) {
    const matches = commit.subject.match(/#(\d+)/g) || []
    for (const token of matches) {
      const num = parseInt(token.slice(1), 10)
      if (Number.isFinite(num) && num > 0) prs.add(num)
    }
  }

  return Array.from(prs)
    .sort((a, b) => a - b)
    .map(num => `${repoBase}/pull/${num}`)
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
    const current = captureRepoSnapshot()
    const previousMarker = await readDeployMarker()

    const marker: DeployMarker = {
      deployedAt: Date.now(),
      deployedBy,
      note,
      commit: current.commit,
      previousCommit: previousMarker?.commit ?? previousMarker?.previousCommit ?? null,
    }

    await writeDeployMarker(marker)
    return marker
  },

  async getReleaseDiff(options?: { from?: string; to?: string; commitLimit?: number }) {
    const current = captureRepoSnapshot()
    const deployMarker = await readDeployMarker()

    const toSha = normalizeSha(options?.to) || normalizeSha(current.commit)
    const trackedPreviousDeploySha = normalizeSha(deployMarker?.previousCommit)
    const fallbackTracked = normalizeSha(deployMarker?.commit)
    const fallbackGitPrev = runGit('git rev-parse HEAD~1')
    const fromSha = normalizeSha(options?.from) || trackedPreviousDeploySha || fallbackTracked || normalizeSha(fallbackGitPrev)

    if (!fromSha || !toSha) {
      return {
        ok: false,
        error: 'Unable to resolve release diff SHAs',
        fromSha,
        toSha,
        trackedPreviousDeploySha,
      }
    }

    const filesRaw = runGit(`git diff --name-only ${fromSha} ${toSha}`) || ''
    const changedFiles = filesRaw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)

    const changedTests = changedFiles.filter(path => path.startsWith('tests/') || path.includes('.test.'))
    const changedEndpoints = extractEndpointsFromGitDiff(fromSha, toSha)

    const commitLimit = Math.max(1, Math.min(options?.commitLimit ?? 100, 500))
    const commitsRaw = runGit(`git log --pretty=format:%H%x09%s -n ${commitLimit} ${fromSha}..${toSha}`) || ''
    const commits: ReleaseDiffCommit[] = commitsRaw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [sha, ...rest] = line.split('\t')
        return { sha, subject: rest.join('\t') }
      })
      .filter(c => Boolean(c.sha) && Boolean(c.subject))

    const pullRequestLinks = extractPullRequestLinks(commits)

    return {
      ok: true,
      generatedAt: Date.now(),
      liveSha: toSha,
      previousDeploySha: fromSha,
      trackedPreviousDeploySha,
      trackedCurrentDeploySha: normalizeSha(deployMarker?.commit),
      changedFiles,
      changedEndpoints,
      changedTests,
      commits,
      pullRequestLinks,
    }
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
