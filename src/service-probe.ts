// SPDX-License-Identifier: Apache-2.0
// Synthetic health probe for reflectt-node service.
//
// Periodically validates critical endpoints and triggers auto-restart
// on sustained failure. Runs as a standalone process (not inside the server).
//
// Usage: node dist/service-probe.js [--interval 30] [--max-retries 3] [--dry-run]

import { execSync } from 'node:child_process'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

// ── Configuration ──

interface ProbeConfig {
  /** Base URL of the reflectt-node service */
  baseUrl: string
  /** Probe interval in seconds */
  intervalSec: number
  /** Timeout per endpoint check in ms */
  timeoutMs: number
  /** Consecutive failures before restart */
  maxRetries: number
  /** Backoff multiplier for restart attempts */
  backoffMultiplier: number
  /** Maximum restarts before giving up (per hour) */
  maxRestartsPerHour: number
  /** Dry run: log but don't restart */
  dryRun: boolean
  /** Log file path */
  logPath: string
  /** LaunchAgent label for restart */
  launchAgentLabel: string
}

const DEFAULT_CONFIG: ProbeConfig = {
  baseUrl: 'http://127.0.0.1:4445',
  intervalSec: 30,
  timeoutMs: 5000,
  maxRetries: 3,
  backoffMultiplier: 2,
  maxRestartsPerHour: 5,
  dryRun: false,
  logPath: 'logs/service-probe.log',
  launchAgentLabel: 'com.reflectt.node',
}

// ── Probe Endpoints ──

interface EndpointCheck {
  name: string
  path: string
  /** Validate the response body */
  validate: (body: unknown) => boolean
  /** If true, failure of this endpoint alone triggers restart */
  critical: boolean
}

const ENDPOINTS: EndpointCheck[] = [
  {
    name: 'health',
    path: '/health',
    validate: (body: unknown) => {
      const b = body as Record<string, unknown>
      return b?.status === 'ok'
    },
    critical: true,
  },
  {
    name: 'tasks-list',
    path: '/tasks?limit=1',
    validate: (body: unknown) => {
      const b = body as Record<string, unknown>
      return b?.success === true || Array.isArray(b?.tasks)
    },
    critical: true,
  },
  {
    name: 'noise-budget',
    path: '/chat/noise-budget',
    validate: (body: unknown) => {
      const b = body as Record<string, unknown>
      return b?.success === true
    },
    critical: false,
  },
]

// ── State ──

interface ProbeState {
  consecutiveFailures: number
  restartTimestamps: number[]
  lastCheckAt: number | null
  lastSuccessAt: number | null
  totalChecks: number
  totalFailures: number
  totalRestarts: number
}

const state: ProbeState = {
  consecutiveFailures: 0,
  restartTimestamps: [],
  lastCheckAt: null,
  lastSuccessAt: null,
  totalChecks: 0,
  totalFailures: 0,
  totalRestarts: 0,
}

// ── Logging ──

async function log(level: 'INFO' | 'WARN' | 'ERROR' | 'ALERT', message: string, extra?: Record<string, unknown>): Promise<void> {
  const ts = new Date().toISOString()
  const line = JSON.stringify({ ts, level, message, ...extra })
  console.log(`[${level}] ${message}`)

  try {
    await mkdir(dirname(DEFAULT_CONFIG.logPath), { recursive: true })
    await appendFile(DEFAULT_CONFIG.logPath, line + '\n')
  } catch { /* ignore log write failures */ }
}

// ── HTTP Check ──

async function checkEndpoint(config: ProbeConfig, endpoint: EndpointCheck): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const url = `${config.baseUrl}${endpoint.path}`
  const start = Date.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    const latencyMs = Date.now() - start

    if (!res.ok) {
      return { ok: false, latencyMs, error: `HTTP ${res.status}` }
    }

    const body = await res.json()
    const valid = endpoint.validate(body)

    return { ok: valid, latencyMs, error: valid ? undefined : 'validation failed' }
  } catch (err: unknown) {
    const latencyMs = Date.now() - start
    const error = err instanceof Error ? err.message : String(err)
    return { ok: false, latencyMs, error }
  }
}

// ── Restart Logic ──

function canRestart(config: ProbeConfig): { allowed: boolean; reason?: string } {
  const now = Date.now()
  const hourAgo = now - 3600_000

  // Prune old timestamps
  state.restartTimestamps = state.restartTimestamps.filter(ts => ts > hourAgo)

  if (state.restartTimestamps.length >= config.maxRestartsPerHour) {
    return { allowed: false, reason: `Max restarts/hour (${config.maxRestartsPerHour}) reached` }
  }

  return { allowed: true }
}

function triggerRestart(config: ProbeConfig, reason: string): boolean {
  const { allowed, reason: denyReason } = canRestart(config)

  if (!allowed) {
    log('ERROR', `Restart denied: ${denyReason}`, { reason, restartCount: state.totalRestarts })
    return false
  }

  if (config.dryRun) {
    log('WARN', `[DRY-RUN] Would restart: ${reason}`)
    return false
  }

  try {
    log('ALERT', `Restarting service: ${reason}`, {
      consecutiveFailures: state.consecutiveFailures,
      restartCount: state.totalRestarts + 1,
    })

    const uid = execSync('id -u').toString().trim()
    execSync(`launchctl kickstart -k gui/${uid}/${config.launchAgentLabel}`, { timeout: 10000 })

    state.restartTimestamps.push(Date.now())
    state.totalRestarts++
    state.consecutiveFailures = 0

    return true
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    log('ERROR', `Restart failed: ${error}`, { reason })
    return false
  }
}

// ── Probe Cycle ──

async function runProbe(config: ProbeConfig): Promise<void> {
  state.totalChecks++
  state.lastCheckAt = Date.now()

  const results: Array<{ endpoint: string; ok: boolean; latencyMs: number; error?: string; critical: boolean }> = []

  for (const endpoint of ENDPOINTS) {
    const result = await checkEndpoint(config, endpoint)
    results.push({ endpoint: endpoint.name, ...result, critical: endpoint.critical })
  }

  const criticalFailures = results.filter(r => !r.ok && r.critical)
  const allOk = results.every(r => r.ok)

  if (allOk) {
    state.consecutiveFailures = 0
    state.lastSuccessAt = Date.now()

    // Only log every 10th success to reduce noise
    if (state.totalChecks % 10 === 0) {
      await log('INFO', 'Probe OK', {
        latencies: Object.fromEntries(results.map(r => [r.endpoint, r.latencyMs])),
        totalChecks: state.totalChecks,
      })
    }
  } else {
    state.consecutiveFailures++
    state.totalFailures++

    await log('WARN', `Probe failed (${state.consecutiveFailures}/${config.maxRetries})`, {
      failures: results.filter(r => !r.ok).map(r => ({ endpoint: r.endpoint, error: r.error, latencyMs: r.latencyMs })),
      critical: criticalFailures.length > 0,
    })

    if (criticalFailures.length > 0 && state.consecutiveFailures >= config.maxRetries) {
      const failedNames = criticalFailures.map(f => f.endpoint).join(', ')
      const errors = criticalFailures.map(f => `${f.endpoint}: ${f.error}`).join('; ')
      triggerRestart(config, `${state.consecutiveFailures} consecutive critical failures on [${failedNames}]: ${errors}`)
    }
  }
}

// ── Main ──

function parseArgs(): Partial<ProbeConfig> {
  const args = process.argv.slice(2)
  const config: Partial<ProbeConfig> = {}

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--interval':
        config.intervalSec = Number(args[++i])
        break
      case '--max-retries':
        config.maxRetries = Number(args[++i])
        break
      case '--timeout':
        config.timeoutMs = Number(args[++i])
        break
      case '--dry-run':
        config.dryRun = true
        break
      case '--base-url':
        config.baseUrl = args[++i]
        break
      case '--log':
        config.logPath = args[++i]
        break
    }
  }

  return config
}

async function main(): Promise<void> {
  const overrides = parseArgs()
  const config: ProbeConfig = { ...DEFAULT_CONFIG, ...overrides }

  await log('INFO', 'Service probe starting', {
    interval: config.intervalSec,
    maxRetries: config.maxRetries,
    timeout: config.timeoutMs,
    dryRun: config.dryRun,
    endpoints: ENDPOINTS.map(e => e.name),
  })

  // Run immediately, then on interval
  await runProbe(config)

  setInterval(() => {
    runProbe(config).catch(err => {
      console.error('[ServiceProbe] Unexpected error:', err)
    })
  }, config.intervalSec * 1000)
}

// ── Exported for testing ──

export {
  checkEndpoint,
  runProbe,
  triggerRestart,
  canRestart,
  state as _probeState,
  ENDPOINTS,
  DEFAULT_CONFIG,
  type ProbeConfig,
  type ProbeState,
  type EndpointCheck,
}

// Run if executed directly
const isMain = process.argv[1]?.endsWith('service-probe.js') || process.argv[1]?.endsWith('service-probe.ts')
if (isMain) {
  main().catch(err => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
