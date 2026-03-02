// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Lightweight request tracking for launch-day visibility.
 * Tracks request counts per endpoint group and last N errors.
 * Includes rolling-window metrics to distinguish historical from ongoing errors.
 * No external dependencies — pure in-memory counters.
 */

// ── Types ──────────────────────────────────────────────────────────────────

interface ErrorEntry {
  ts: number
  method: string
  url: string
  status: number
  message: string
  userAgent?: string
}

interface EndpointGroup {
  pattern: RegExp
  name: string
}

interface RollingBucket {
  requests: number
  errors: number
  /** Start of this bucket (ms since epoch) */
  startedAt: number
}

// ── Configuration ──────────────────────────────────────────────────────────

const MAX_ERRORS = 20

/** Rolling window: 5-minute buckets, keep last 1 hour */
const BUCKET_DURATION_MS = 5 * 60 * 1000
const MAX_BUCKETS = 12 // 12 × 5 min = 1 hour

const TRACKED_GROUPS: EndpointGroup[] = [
  { pattern: /^\/health/, name: 'health' },
  { pattern: /^\/bootstrap/, name: 'bootstrap' },
  { pattern: /^\/tasks/, name: 'tasks' },
  { pattern: /^\/api\/hosts/, name: 'cloud_hosts' },
  { pattern: /^\/openclaw/, name: 'openclaw' },
  { pattern: /^\/chat/, name: 'chat' },
  { pattern: /^\/mcp/, name: 'mcp' },
  // Additional groups to reduce "other" noise
  { pattern: /^\/heartbeat/, name: 'heartbeat' },
  { pattern: /^\/inbox/, name: 'inbox' },
  { pattern: /^\/reflections/, name: 'reflections' },
  { pattern: /^\/insights/, name: 'insights' },
  { pattern: /^\/hosts/, name: 'hosts' },
  { pattern: /^\/presence/, name: 'presence' },
  { pattern: /^\/shared/, name: 'shared' },
  { pattern: /^\/avatars/, name: 'avatars' },
  { pattern: /^\/dashboard/, name: 'dashboard' },
  { pattern: /^\/memory/, name: 'memory' },
  { pattern: /^\/preflight/, name: 'preflight' },
  { pattern: /^\/policy/, name: 'policy' },
]

// ── State ──────────────────────────────────────────────────────────────────

const requestCounts: Record<string, number> = {}
const errorCounts: Record<string, number> = {}
const recentErrors: ErrorEntry[] = []
let totalRequests = 0
let totalErrors = 0
const startedAt = Date.now()

// Rolling window state
const rollingBuckets: RollingBucket[] = []
let currentBucket: RollingBucket = { requests: 0, errors: 0, startedAt: Date.now() }

// ── Core ───────────────────────────────────────────────────────────────────

function classifyUrl(url: string): string {
  for (const group of TRACKED_GROUPS) {
    if (group.pattern.test(url)) return group.name
  }
  return 'other'
}

/** Rotate rolling buckets if the current one has expired */
function rotateBuckets(now: number): void {
  if (now - currentBucket.startedAt >= BUCKET_DURATION_MS) {
    rollingBuckets.push(currentBucket)
    if (rollingBuckets.length > MAX_BUCKETS) {
      rollingBuckets.shift()
    }
    currentBucket = { requests: 0, errors: 0, startedAt: now }
  }
}

/**
 * Record a request. Call from Fastify onResponse hook.
 */
export function trackRequest(method: string, url: string, statusCode: number, userAgent?: string): void {
  const now = Date.now()
  totalRequests++
  const group = classifyUrl(url)
  requestCounts[group] = (requestCounts[group] || 0) + 1

  // Rolling window
  rotateBuckets(now)
  currentBucket.requests++

  if (statusCode >= 400) {
    totalErrors++
    errorCounts[group] = (errorCounts[group] || 0) + 1
    currentBucket.errors++
  }

  if (statusCode >= 500) {
    recentErrors.push({
      ts: now,
      method,
      url: url.length > 200 ? url.slice(0, 200) + '…' : url,
      status: statusCode,
      message: `${method} ${url} → ${statusCode}`,
      userAgent: userAgent?.slice(0, 100),
    })
    if (recentErrors.length > MAX_ERRORS) {
      recentErrors.shift()
    }
  }
}

/**
 * Record a caught error (for non-HTTP errors like unhandled promise rejections).
 */
export function trackError(context: string, error: unknown): void {
  totalErrors++
  const msg = error instanceof Error ? error.message : String(error)
  recentErrors.push({
    ts: Date.now(),
    method: 'INTERNAL',
    url: context,
    status: 0,
    message: msg.slice(0, 500),
  })
  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.shift()
  }
}

// ── Metrics ────────────────────────────────────────────────────────────────

/** Compute rolling-window stats from recent buckets */
function getRollingMetrics(): { requests: number; errors: number; errorRate: number; windowMinutes: number } {
  const now = Date.now()
  rotateBuckets(now)

  let requests = currentBucket.requests
  let errors = currentBucket.errors
  const windowStart = now - (MAX_BUCKETS * BUCKET_DURATION_MS)

  for (const bucket of rollingBuckets) {
    if (bucket.startedAt >= windowStart) {
      requests += bucket.requests
      errors += bucket.errors
    }
  }

  const errorRate = requests > 0 ? Math.round((errors / requests) * 10000) / 100 : 0
  return {
    requests,
    errors,
    errorRate,
    windowMinutes: MAX_BUCKETS * (BUCKET_DURATION_MS / 60000),
  }
}

export function getRequestMetrics(): {
  total: number
  errors: number
  uptimeMs: number
  byGroup: Record<string, { requests: number; errors: number }>
  recentErrors: ErrorEntry[]
  rps: number
  rolling: { requests: number; errors: number; errorRate: number; windowMinutes: number }
} {
  const uptimeMs = Date.now() - startedAt
  const uptimeSec = uptimeMs / 1000
  const rps = uptimeSec > 0 ? Math.round((totalRequests / uptimeSec) * 100) / 100 : 0

  const byGroup: Record<string, { requests: number; errors: number }> = {}
  for (const group of TRACKED_GROUPS) {
    const name = group.name
    const reqs = requestCounts[name] || 0
    const errs = errorCounts[name] || 0
    // Only include groups that have traffic
    if (reqs > 0 || errs > 0) {
      byGroup[name] = { requests: reqs, errors: errs }
    }
  }
  if (requestCounts['other']) {
    byGroup['other'] = {
      requests: requestCounts['other'] || 0,
      errors: errorCounts['other'] || 0,
    }
  }

  return {
    total: totalRequests,
    errors: totalErrors,
    uptimeMs,
    byGroup,
    recentErrors: [...recentErrors].reverse(), // Most recent first
    rps,
    rolling: getRollingMetrics(),
  }
}

/** Reset (for testing) */
export function resetRequestMetrics(): void {
  totalRequests = 0
  totalErrors = 0
  for (const key of Object.keys(requestCounts)) delete requestCounts[key]
  for (const key of Object.keys(errorCounts)) delete errorCounts[key]
  recentErrors.length = 0
  rollingBuckets.length = 0
  currentBucket = { requests: 0, errors: 0, startedAt: Date.now() }
}
