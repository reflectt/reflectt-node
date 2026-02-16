// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Telemetry Module — Opt-in usage metrics + error reporting
 *
 * Privacy-first design:
 * - Explicit opt-in via REFLECTT_TELEMETRY=true or config.json
 * - No PII collected — all metrics are anonymous/aggregatable
 * - Clear documentation of what is collected
 * - Can be disabled at any time
 *
 * Collects:
 * - Endpoint usage (hit counts, response times)
 * - Team size (agent count)
 * - Feature adoption (which endpoints are used)
 * - Task throughput (tasks created/completed per period)
 * - Error reporting (crashes, failed API calls, timeouts — no PII)
 * - Health metrics (uptime, response times)
 */

import { taskManager } from './tasks.js'
import { presenceManager } from './presence.js'

// ── Types ──

export interface TelemetryConfig {
  enabled: boolean
  cloudUrl: string
  hostId: string
  reportIntervalMs: number
}

interface EndpointMetric {
  path: string
  method: string
  hits: number
  errors: number
  totalDurationMs: number
  avgDurationMs: number
  p95DurationMs: number
  lastHit: number
}

interface ErrorEntry {
  type: string      // error class/name (no stack traces with PII)
  endpoint?: string
  count: number
  lastSeen: number
}

export interface TelemetrySnapshot {
  version: string
  hostId: string
  timestamp: number
  uptime: number
  period: {
    startMs: number
    endMs: number
  }
  team: {
    agentCount: number
    activeAgentCount: number
  }
  tasks: {
    total: number
    created: number
    completed: number
    avgCycleTimeMs: number
    byStatus: Record<string, number>
  }
  endpoints: EndpointMetric[]
  features: Record<string, number>   // feature name → adoption count
  errors: ErrorEntry[]
  health: {
    uptimeMs: number
    avgResponseTimeMs: number
    errorRate: number
    requestsTotal: number
  }
}

// ── State ──

const startedAt = Date.now()
let config: TelemetryConfig = {
  enabled: false,
  cloudUrl: '',
  hostId: 'unknown',
  reportIntervalMs: 5 * 60 * 1000, // 5 minutes
}

// Rolling metrics (reset each reporting period)
let periodStart = Date.now()
const endpointHits = new Map<string, { hits: number; errors: number; durations: number[] }>()
const errorLog = new Map<string, { count: number; lastSeen: number }>()
const featureUsage = new Map<string, number>()
let tasksCreatedInPeriod = 0
let tasksCompletedInPeriod = 0
let totalRequests = 0
let totalErrors = 0
let totalDurationMs = 0

let reportTimer: ReturnType<typeof setInterval> | null = null

// ── Public API ──

/** Initialize telemetry with config */
export function initTelemetry(cfg: Partial<TelemetryConfig>): void {
  config = { ...config, ...cfg }

  if (!config.enabled) {
    console.log('[Telemetry] Disabled (opt-in via REFLECTT_TELEMETRY=true)')
    return
  }

  console.log(`[Telemetry] Enabled — reporting to ${config.cloudUrl || 'local only'} every ${config.reportIntervalMs / 1000}s`)

  // Start periodic reporting
  if (reportTimer) clearInterval(reportTimer)
  reportTimer = setInterval(() => {
    if (config.cloudUrl) {
      reportToCloud().catch(err => {
        console.error('[Telemetry] Report failed:', (err as Error).message)
      })
    }
  }, config.reportIntervalMs)
}

/** Stop telemetry reporting */
export function stopTelemetry(): void {
  if (reportTimer) {
    clearInterval(reportTimer)
    reportTimer = null
  }
}

/** Track an HTTP request (call from onResponse hook) */
export function trackRequest(method: string, path: string, statusCode: number, durationMs: number): void {
  if (!config.enabled) return

  // Normalize path (strip IDs to group endpoints)
  const normalizedPath = normalizePath(path)
  const key = `${method} ${normalizedPath}`

  const existing = endpointHits.get(key) || { hits: 0, errors: 0, durations: [] }
  existing.hits++
  existing.durations.push(durationMs)
  if (statusCode >= 400) existing.errors++
  endpointHits.set(key, existing)

  totalRequests++
  totalDurationMs += durationMs
  if (statusCode >= 400) totalErrors++

  // Track feature adoption
  trackFeatureFromPath(method, normalizedPath)
}

/** Track an error (no PII — just type + endpoint) */
export function trackError(type: string, endpoint?: string): void {
  if (!config.enabled) return

  const sanitized = endpoint ? normalizePath(endpoint) : 'unknown'
  const key = `${type}:${sanitized}`
  const existing = errorLog.get(key) || { count: 0, lastSeen: 0 }
  existing.count++
  existing.lastSeen = Date.now()
  errorLog.set(key, existing)
}

/** Track a task event */
export function trackTaskEvent(event: 'created' | 'completed'): void {
  if (!config.enabled) return
  if (event === 'created') tasksCreatedInPeriod++
  if (event === 'completed') tasksCompletedInPeriod++
}

/** Get current telemetry snapshot (also used by GET /telemetry endpoint) */
export function getSnapshot(): TelemetrySnapshot {
  const now = Date.now()
  const allTasks = taskManager.listTasks()
  const agents = presenceManager.getAllPresence()

  const byStatus: Record<string, number> = {}
  for (const t of allTasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1
  }

  const completedTasks = allTasks.filter(t => t.status === 'done')
  const cycleTimes = completedTasks
    .map(t => t.updatedAt - t.createdAt)
    .filter(ct => ct > 0)
  const avgCycleTimeMs = cycleTimes.length > 0
    ? Math.round(cycleTimes.reduce((s, v) => s + v, 0) / cycleTimes.length)
    : 0

  // Build endpoint metrics
  const endpoints: EndpointMetric[] = []
  for (const [key, data] of endpointHits) {
    const [method, path] = key.split(' ', 2)
    const sorted = data.durations.slice().sort((a, b) => a - b)
    const p95Index = Math.floor(sorted.length * 0.95)
    endpoints.push({
      path,
      method,
      hits: data.hits,
      errors: data.errors,
      totalDurationMs: sorted.reduce((s, v) => s + v, 0),
      avgDurationMs: sorted.length > 0 ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : 0,
      p95DurationMs: sorted[p95Index] || 0,
      lastHit: now,
    })
  }
  endpoints.sort((a, b) => b.hits - a.hits)

  // Build error entries
  const errors: ErrorEntry[] = []
  for (const [key, data] of errorLog) {
    const [type, endpoint] = key.split(':', 2)
    errors.push({ type, endpoint, count: data.count, lastSeen: data.lastSeen })
  }

  // Features
  const features: Record<string, number> = {}
  for (const [feat, count] of featureUsage) {
    features[feat] = count
  }

  return {
    version: '1.0.0',
    hostId: config.hostId,
    timestamp: now,
    uptime: now - startedAt,
    period: { startMs: periodStart, endMs: now },
    team: {
      agentCount: agents.length,
      activeAgentCount: agents.filter(a => a.status === 'working' || a.status === 'reviewing').length,
    },
    tasks: {
      total: allTasks.length,
      created: tasksCreatedInPeriod,
      completed: tasksCompletedInPeriod,
      avgCycleTimeMs,
      byStatus,
    },
    endpoints: endpoints.slice(0, 50), // Top 50 endpoints
    features,
    errors: errors.slice(0, 50),
    health: {
      uptimeMs: now - startedAt,
      avgResponseTimeMs: totalRequests > 0 ? Math.round(totalDurationMs / totalRequests) : 0,
      errorRate: totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 10000) / 10000 : 0,
      requestsTotal: totalRequests,
    },
  }
}

/** Check if telemetry is enabled */
export function isTelemetryEnabled(): boolean {
  return config.enabled
}

/** Get telemetry config (safe — no secrets) */
export function getTelemetryConfig(): { enabled: boolean; cloudUrl: string; reportIntervalMs: number } {
  return {
    enabled: config.enabled,
    cloudUrl: config.cloudUrl ? config.cloudUrl.replace(/\/\/[^@]+@/, '//***@') : '', // mask credentials
    reportIntervalMs: config.reportIntervalMs,
  }
}

// ── Internals ──

function normalizePath(path: string): string {
  // Strip query params
  const base = path.split('?')[0]
  // Replace UUIDs and task IDs with :id
  return base
    .replace(/\/task-\d+-[a-z0-9]+/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/:uuid')
    .replace(/\/msg-\d+-[a-z0-9]+/g, '/:msgId')
    .replace(/\/\d{10,}/g, '/:timestamp')
}

function trackFeatureFromPath(method: string, path: string): void {
  // Map endpoints to feature names
  const featureMap: Record<string, string> = {
    'GET /tasks': 'task-management',
    'POST /tasks': 'task-creation',
    'PATCH /tasks/:id': 'task-updates',
    'GET /analytics': 'analytics',
    'GET /presence': 'presence',
    'GET /chat': 'chat',
    'POST /chat': 'chat',
    'GET /dashboard': 'dashboard',
    'GET /agents': 'agent-roles',
    'POST /tasks/suggest-assignee': 'auto-assignment',
    'GET /inbox': 'inbox',
    'GET /health': 'health-monitoring',
  }

  for (const [pattern, feature] of Object.entries(featureMap)) {
    const [m, p] = pattern.split(' ', 2)
    if (method === m && path.startsWith(p)) {
      featureUsage.set(feature, (featureUsage.get(feature) || 0) + 1)
      return
    }
  }
}

async function reportToCloud(): Promise<void> {
  const snapshot = getSnapshot()

  try {
    const url = `${config.cloudUrl.replace(/\/+$/, '')}/api/telemetry/ingest`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      console.error(`[Telemetry] Cloud report failed: ${res.status} ${res.statusText}`)
    }
  } catch (err) {
    // Silent fail — telemetry should never break the app
  }

  // Reset period counters
  periodStart = Date.now()
  endpointHits.clear()
  errorLog.clear()
  featureUsage.clear()
  tasksCreatedInPeriod = 0
  tasksCompletedInPeriod = 0
  totalRequests = 0
  totalErrors = 0
  totalDurationMs = 0
}
