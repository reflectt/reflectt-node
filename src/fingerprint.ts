// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Fingerprint Emitter — normalized error fingerprinting + deploy transition tracking
 * Contract: process/TASK-2k0iha2hp-payload-contract.md | Reviewer: @sage
 */

import { createHash } from 'node:crypto'
// execSync removed — use buildInfo instead of shelling out (PR #836 pattern)

const STARTED_AT = Date.now()
const WINDOW_MS = 5 * 60 * 1000 // 5 minutes

// ── Types ────────────────────────────────────────────────────────────────────

export interface DeployInfo {
  commit: string
  version: string
  deployed_at: number
}

export interface FingerprintEvent {
  event_type: 'error_fingerprint'
  host_id: string
  deploy: DeployInfo
  fingerprint: string
  subsystem: string
  sample_message: string
  timestamp: number
  window_count: number
}

export interface DeployTransitionEvent {
  event_type: 'deploy_transition'
  host_id: string
  previous_commit: string | null
  current_commit: string
  version: string
  transitioned_at: number
}

interface FingerprintWindow {
  fingerprint: string
  subsystem: string
  sample_message: string
  firstSeen: number
  window_count: number
}

// ── Internal state ───────────────────────────────────────────────────────────

const windows = new Map<string, FingerprintWindow>()
let previousCommit: string | null = null
let transitionSent = false

// ── Normalization ────────────────────────────────────────────────────────────

export function normalizeErrorMessage(raw: string): string {
  let s = raw.toLowerCase()
  // Strip absolute paths — keep filename:line only
  s = s.replace(/(?:\/[^\s/:]+)+\/([^\s/]+(?::\d+)?)/g, '$1')
  // Strip unix timestamps (10-13 digit numbers)
  s = s.replace(/\b\d{10,13}\b/g, '')
  // Strip UUIDs
  s = s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '')
  // Strip memory addresses
  s = s.replace(/0x[0-9a-f]+/g, '')
  // Strip port numbers
  s = s.replace(/:\d{2,5}\b/g, '')
  // Trim stack trace to top 2 "at " lines
  const lines = s.split('\n')
  let atCount = 0
  const trimmed = lines.filter(l => {
    if (l.trimStart().startsWith('at ')) {
      atCount++
      return atCount <= 2
    }
    return true
  })
  // Collapse whitespace
  return trimmed.join(' ').replace(/\s+/g, ' ').trim()
}

export function fingerprintError(raw: string): string {
  const normalized = normalizeErrorMessage(raw)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12)
}

// ── Recording ─────────────────────────────────────────────────────────────────

export function recordError(hostId: string, subsystem: string, rawMessage: string): void {
  const fp = fingerprintError(rawMessage)
  const now = Date.now()
  const existing = windows.get(fp)
  if (existing && now - existing.firstSeen < WINDOW_MS) {
    existing.window_count++
  } else {
    windows.set(fp, {
      fingerprint: fp,
      subsystem,
      sample_message: rawMessage.slice(0, 200),
      firstSeen: now,
      window_count: 1,
    })
  }
}

// ── Emission ──────────────────────────────────────────────────────────────────

export function getPendingFingerprints(hostId: string, deploy: DeployInfo): FingerprintEvent[] {
  const events: FingerprintEvent[] = []
  for (const w of windows.values()) {
    events.push({
      event_type: 'error_fingerprint',
      host_id: hostId,
      deploy,
      fingerprint: w.fingerprint,
      subsystem: w.subsystem,
      sample_message: w.sample_message,
      timestamp: w.firstSeen,
      window_count: w.window_count,
    })
  }
  windows.clear()
  return events
}

export function getDeployTransition(hostId: string, deploy: DeployInfo): DeployTransitionEvent | null {
  if (!transitionSent) {
    transitionSent = true
    previousCommit = deploy.commit
    return {
      event_type: 'deploy_transition',
      host_id: hostId,
      previous_commit: null,
      current_commit: deploy.commit,
      version: deploy.version,
      transitioned_at: STARTED_AT,
    }
  }
  if (previousCommit !== deploy.commit) {
    const prev = previousCommit
    previousCommit = deploy.commit
    return {
      event_type: 'deploy_transition',
      host_id: hostId,
      previous_commit: prev,
      current_commit: deploy.commit,
      version: deploy.version,
      transitioned_at: Date.now(),
    }
  }
  return null
}

export function getDeployInfo(): DeployInfo {
  // Use baked buildInfo instead of shelling out to git (fixes ambient-repo bug, same as PR #836)
  const { buildInfo } = require('./buildInfo.js') as { buildInfo: { shortSha: string; version: string } }
  return {
    commit: buildInfo.shortSha || 'unknown',
    version: buildInfo.version || process.env.npm_package_version || '0.0.0',
    deployed_at: STARTED_AT,
  }
}
