// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Build Info — captures git SHA, branch, and build metadata at startup.
 * Exposed via GET /health/build so the team knows what code is live.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

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

// Use the source directory for git commands, not process.cwd().
// When running from a global install or launchd plist, cwd may point
// to an unrelated directory (or a different git repo entirely).
import { fileURLToPath } from 'node:url'
const __dirname = dirname(fileURLToPath(import.meta.url))

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', timeout: 5000, cwd: __dirname, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return 'unknown'
  }
}

function readPackageVersion(): string {
  try {
    const pkgPath = resolve(process.cwd(), 'package.json')
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
