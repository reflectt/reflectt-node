// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Lightweight request tracking for launch-day visibility.
 * Tracks request counts per endpoint group and last N errors.
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

// ── Configuration ──────────────────────────────────────────────────────────

const MAX_ERRORS = 20
const TRACKED_GROUPS: EndpointGroup[] = [
  { pattern: /^\/health/, name: 'health' },
  { pattern: /^\/bootstrap/, name: 'bootstrap' },
  { pattern: /^\/tasks/, name: 'tasks' },
  { pattern: /^\/api\/hosts/, name: 'cloud_hosts' },
  { pattern: /^\/openclaw/, name: 'openclaw' },
  { pattern: /^\/chat/, name: 'chat' },
  { pattern: /^\/mcp/, name: 'mcp' },
]

// ── State ──────────────────────────────────────────────────────────────────

const requestCounts: Record<string, number> = {}
const errorCounts: Record<string, number> = {}
const recentErrors: ErrorEntry[] = []
let totalRequests = 0
let totalErrors = 0
const startedAt = Date.now()

// ── Core ───────────────────────────────────────────────────────────────────

function classifyUrl(url: string): string {
  for (const group of TRACKED_GROUPS) {
    if (group.pattern.test(url)) return group.name
  }
  return 'other'
}

/**
 * Record a request. Call from Fastify onResponse hook.
 */
export function trackRequest(method: string, url: string, statusCode: number, userAgent?: string): void {
  totalRequests++
  const group = classifyUrl(url)
  requestCounts[group] = (requestCounts[group] || 0) + 1

  if (statusCode >= 400) {
    totalErrors++
    errorCounts[group] = (errorCounts[group] || 0) + 1
  }

  if (statusCode >= 500) {
    recentErrors.push({
      ts: Date.now(),
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

export function getRequestMetrics(): {
  total: number
  errors: number
  uptimeMs: number
  byGroup: Record<string, { requests: number; errors: number }>
  recentErrors: ErrorEntry[]
  rps: number
} {
  const uptimeMs = Date.now() - startedAt
  const uptimeSec = uptimeMs / 1000
  const rps = uptimeSec > 0 ? Math.round((totalRequests / uptimeSec) * 100) / 100 : 0

  const byGroup: Record<string, { requests: number; errors: number }> = {}
  for (const group of TRACKED_GROUPS) {
    const name = group.name
    byGroup[name] = {
      requests: requestCounts[name] || 0,
      errors: errorCounts[name] || 0,
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
  }
}

/** Reset (for testing) */
export function resetRequestMetrics(): void {
  totalRequests = 0
  totalErrors = 0
  for (const key of Object.keys(requestCounts)) delete requestCounts[key]
  for (const key of Object.keys(errorCounts)) delete errorCounts[key]
  recentErrors.length = 0
}
