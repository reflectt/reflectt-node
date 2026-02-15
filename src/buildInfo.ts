// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Build Info — captures git SHA, branch, and build metadata at startup.
 * Exposed via GET /health/build so the team knows what code is live.
 */

import { execSync } from 'node:child_process'

export interface BuildInfo {
  gitSha: string
  gitShortSha: string
  gitBranch: string
  gitMessage: string
  gitAuthor: string
  gitTimestamp: string
  pid: number
  nodeVersion: string
  startedAt: string
  startedAtMs: number
  uptime: number
}

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return 'unknown'
  }
}

// Capture at module load (startup) time
const startedAtMs = Date.now()
const gitSha = git('rev-parse HEAD')
const gitShortSha = git('rev-parse --short HEAD')
const gitBranch = git('rev-parse --abbrev-ref HEAD')
const gitMessage = git('log -1 --pretty=%s')
const gitAuthor = git('log -1 --pretty=%an')
const gitTimestamp = git('log -1 --pretty=%ci')

export function getBuildInfo(): BuildInfo {
  return {
    gitSha,
    gitShortSha,
    gitBranch,
    gitMessage,
    gitAuthor,
    gitTimestamp,
    pid: process.pid,
    nodeVersion: process.version,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    uptime: Math.round((Date.now() - startedAtMs) / 1000),
  }
}
