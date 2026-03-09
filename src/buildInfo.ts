// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Build Info — captures git SHA, branch, and build metadata at startup.
 * Exposed via GET /health/build so the team knows what code is live.
 *
 * IMPORTANT: git commands MUST only run when the package root contains
 * its own .git directory.  When installed globally (e.g. under
 * /opt/homebrew/lib/node_modules), `git rev-parse` would otherwise
 * traverse parent directories and pick up an unrelated repo (Homebrew,
 * nvm, etc.), causing the branch guard to kill the server.
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface BuildInfo {
  appVersion: string
  gitSha: string
  gitShortSha: string
  gitBranch: string
  gitMessage: string
  gitAuthor: string
  gitTimestamp: string
  buildTimestamp: string
  pid: number
  nodeVersion: string
  startedAt: string
  startedAtMs: number
  uptime: number
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkgRoot = resolve(__dirname, '..')

// Only run git when the package itself is a git repo.
// Without this check, git traverses parent directories and may find
// an unrelated .git (e.g. Homebrew at /opt/homebrew).
const hasOwnGit = existsSync(resolve(pkgRoot, '.git'))

function git(cmd: string): string {
  if (!hasOwnGit) return ''
  try {
    return execSync(`git ${cmd}`, {
      encoding: 'utf8',
      timeout: 5000,
      cwd: pkgRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return ''
  }
}

function readPackageVersion(): string {
  try {
    // Read from package root, not cwd — works for both dev and global install
    const pkgPath = resolve(pkgRoot, 'package.json')
    const raw = readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(raw)
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

// Capture at module load (startup) time
const startedAtMs = Date.now()
const appVersion = readPackageVersion()
const gitSha = git('rev-parse HEAD')
const gitShortSha = git('rev-parse --short HEAD')
const gitBranch = git('rev-parse --abbrev-ref HEAD')
const gitMessage = git('log -1 --pretty=%s')
const gitAuthor = git('log -1 --pretty=%an')
const gitTimestamp = git('log -1 --pretty=%ci')
const buildTimestamp = gitTimestamp !== 'unknown' ? gitTimestamp : new Date(startedAtMs).toISOString()

export function getBuildInfo(): BuildInfo {
  return {
    appVersion,
    gitSha,
    gitShortSha,
    gitBranch,
    gitMessage,
    gitAuthor,
    gitTimestamp,
    buildTimestamp,
    pid: process.pid,
    nodeVersion: process.version,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    uptime: Math.round((Date.now() - startedAtMs) / 1000),
  }
}
