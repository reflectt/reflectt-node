// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * BYOH Preflight Checks + Guided Recovery
 *
 * Validates host readiness before cloud enrollment:
 *   1. Node.js version compatibility
 *   2. Network connectivity to cloud
 *   3. Auth token/key validity
 *   4. Port availability
 *   5. Disk space / home directory writability
 *
 * Each check returns a PreflightResult with pass/fail + recovery guidance.
 */

import { existsSync, accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import { hostname, homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { REFLECTT_HOME } from './config.js'
import { emitActivationEvent } from './activationEvents.js'

// ── Types ──

export interface PreflightCheck {
  id: string
  name: string
  description: string
  category: 'version' | 'network' | 'auth' | 'system' | 'apple'
}

export type PreflightLevel = 'pass' | 'warn' | 'fail'

export interface PreflightResult {
  check: PreflightCheck
  passed: boolean
  /** Optional display severity. If omitted, inferred from passed boolean. */
  level?: PreflightLevel
  message: string
  /** Actionable recovery steps if failed */
  recovery?: string[]
  /** Additional context (e.g., actual vs expected version) */
  details?: Record<string, unknown>
  /** Duration of check in ms */
  durationMs: number
}

export interface PreflightReport {
  timestamp: number
  allPassed: boolean
  results: PreflightResult[]
  summary: string
  /** If failed, the first blocking failure with recovery */
  firstBlocker?: {
    check: string
    message: string
    recovery: string[]
  }
}

// ── Check Definitions ──

const CHECKS: PreflightCheck[] = [
  {
    id: 'node-version',
    name: 'Node.js Version',
    description: 'Requires Node.js >= 20.0.0',
    category: 'version',
  },
  {
    id: 'home-writable',
    name: 'Home Directory',
    description: 'REFLECTT_HOME must exist and be writable',
    category: 'system',
  },
  {
    id: 'port-available',
    name: 'Port Available',
    description: 'Default port (4445) must not be in use',
    category: 'system',
  },
  {
    id: 'cloud-reachable',
    name: 'Cloud Connectivity',
    description: 'Can reach Reflectt Cloud API',
    category: 'network',
  },
  {
    id: 'auth-valid',
    name: 'Auth Credentials',
    description: 'Join token or API key is valid',
    category: 'auth',
  },
  {
    id: 'macos-screen-recording',
    name: 'macOS Screen Recording Permission',
    description: 'Required to capture screen context on macOS',
    category: 'apple',
  },
  {
    id: 'macos-accessibility',
    name: 'macOS Accessibility Permission',
    description: 'Required for local UI automation on macOS',
    category: 'apple',
  },
  {
    id: 'openclaw-gateway',
    name: 'OpenClaw Gateway',
    description: 'Gateway must be running and reachable for tool execution',
    category: 'system',
  },
]

// ── Helpers ──

function inferLevel(result: PreflightResult): PreflightLevel {
  if (result.level) return result.level
  return result.passed ? 'pass' : 'fail'
}

async function execFileText(
  file: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; stdout: string; stderr: string; code?: number }> {
  const timeoutMs = opts?.timeoutMs ?? 6_000
  return await new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        const anyErr = error as any
        resolve({
          ok: false,
          stdout: String(stdout || ''),
          stderr: String(stderr || anyErr.message || ''),
          code: typeof anyErr.code === 'number' ? anyErr.code : undefined,
        })
        return
      }
      resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

function extractJsonObject(text: string): any | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    const last = text.lastIndexOf('{')
    if (last === -1) return null
    try {
      return JSON.parse(text.slice(last))
    } catch {
      return null
    }
  }
}

// ── Apple layer: macOS checks (best-effort) ──

async function checkMacTccPermission(opts: {
  checkId: 'macos-screen-recording' | 'macos-accessibility'
  service: 'kTCCServiceScreenCapture' | 'kTCCServiceAccessibility'
  systemSettingsName: string
  deepLink: string
  clients: string[]
}): Promise<PreflightResult> {
  const start = Date.now()
  const check = CHECKS.find(c => c.id === opts.checkId)!

  if (process.platform !== 'darwin') {
    return { check, passed: true, level: 'pass', message: 'Not macOS (skipped)', durationMs: Date.now() - start }
  }

  const dbPath = join(homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db')

  if (!existsSync(dbPath)) {
    return {
      check,
      passed: true,
      level: 'warn',
      message: `TCC database not found; cannot verify ${opts.systemSettingsName}`,
      recovery: [
        `Open System Settings → Privacy & Security → ${opts.systemSettingsName}`,
        'Enable permission for the app you run Reflectt/OpenClaw from (often Terminal or iTerm).',
        `Quick open: open "${opts.deepLink}"`,
      ],
      details: { dbPath },
      durationMs: Date.now() - start,
    }
  }

  const quotedClients = opts.clients.map(c => `'${c.replace(/'/g, "''")}'`).join(',')
  const queries = [
    `SELECT client,auth_value FROM access WHERE service='${opts.service}' AND client IN (${quotedClients});`,
    `SELECT client,allowed FROM access WHERE service='${opts.service}' AND client IN (${quotedClients});`,
  ]

  let rows: Array<{ client: string; value: number }> = []
  let lastErr = ''

  for (const q of queries) {
    const res = await execFileText('sqlite3', ['-readonly', '-separator', '|', dbPath, q], { timeoutMs: 2_500 })
    if (!res.ok) {
      lastErr = (res.stderr || res.stdout).trim() || lastErr
      continue
    }

    const lines = res.stdout.split('\n').map(l => l.trim()).filter(Boolean)
    rows = lines.map((line) => {
      const [client, raw] = line.split('|')
      const value = Number.parseInt(String(raw ?? '').trim(), 10)
      return {
        client: String(client || '').trim(),
        value: Number.isFinite(value) ? value : 0,
      }
    }).filter(r => r.client)

    break
  }

  if (rows.length === 0) {
    return {
      check,
      passed: true,
      level: 'warn',
      message: `${opts.systemSettingsName}: no permission record found for ${opts.clients.join(', ')}`,
      recovery: [
        `Open System Settings → Privacy & Security → ${opts.systemSettingsName}`,
        `Enable for: ${opts.clients.join(', ')}`,
        `Quick open: open "${opts.deepLink}"`,
        'Then restart the app (Terminal/iTerm) and re-run preflight.',
      ],
      details: { dbPath, service: opts.service, note: lastErr || 'no rows' },
      durationMs: Date.now() - start,
    }
  }

  // Heuristic: any positive value indicates granted.
  const allowed = rows.some(r => r.value > 0)
  const snapshot = rows.map(r => `${r.client}=${r.value}`).join(', ')

  return {
    check,
    passed: true,
    level: allowed ? 'pass' : 'warn',
    message: allowed
      ? `${opts.systemSettingsName}: granted (${snapshot}) ✓`
      : `${opts.systemSettingsName}: not granted (${snapshot})`,
    recovery: allowed
      ? undefined
      : [
          `Open System Settings → Privacy & Security → ${opts.systemSettingsName}`,
          `Enable for: ${opts.clients.join(', ')}`,
          `Quick open: open "${opts.deepLink}"`,
          'Then restart the app (Terminal/iTerm) and re-run preflight.',
        ],
    details: { dbPath, service: opts.service, rows },
    durationMs: Date.now() - start,
  }
}

async function checkOpenClawGateway(): Promise<PreflightResult> {
  const start = Date.now()
  const check = CHECKS.find(c => c.id === 'openclaw-gateway')!

  if (process.platform !== 'darwin') {
    return { check, passed: true, level: 'pass', message: 'Not macOS (skipped)', durationMs: Date.now() - start }
  }

  const res = await execFileText('openclaw', ['gateway', 'status', '--json', '--timeout', '5000'], { timeoutMs: 7_000 })
  const text = `${res.stdout}\n${res.stderr}`
  const json = extractJsonObject(text)

  if (!json) {
    return {
      check,
      passed: true,
      level: 'warn',
      message: 'Could not parse `openclaw gateway status` output',
      recovery: ['Run: openclaw gateway status', 'If not running: openclaw gateway start'],
      details: { ok: res.ok, stderr: res.stderr.slice(0, 500) },
      durationMs: Date.now() - start,
    }
  }

  const status = json?.service?.runtime?.status
  const rpcOk = json?.rpc?.ok
  const url = json?.rpc?.url || json?.gateway?.probeUrl
  const pid = json?.service?.runtime?.pid
  const bindHost = json?.gateway?.bindHost
  const port = json?.gateway?.port

  const running = status === 'running' && rpcOk === true

  return {
    check,
    passed: true,
    level: running ? 'pass' : 'warn',
    message: running
      ? `Gateway running (pid ${pid}) at ${String(url || `ws://${bindHost}:${port}`)} ✓`
      : `Gateway not reachable (status=${String(status)} rpc.ok=${String(rpcOk)})`,
    recovery: running
      ? undefined
      : ['Start the gateway:', '  openclaw gateway start', 'Then verify:', '  openclaw gateway status'],
    details: { status, rpcOk, url, pid, bindHost, port },
    durationMs: Date.now() - start,
  }
}

// ── Individual Checks ──

function checkNodeVersion(): PreflightResult {
  const start = Date.now()
  const check = CHECKS.find(c => c.id === 'node-version')!
  const [major, minor] = process.versions.node.split('.').map(Number)
  const minMajor = 20

  if (major >= minMajor) {
    return {
      check,
      passed: true,
      message: `Node.js v${process.versions.node} ✓`,
      details: { version: process.versions.node, required: `>=${minMajor}.0.0` },
      durationMs: Date.now() - start,
    }
  }

  return {
    check,
    passed: false,
    message: `Node.js v${process.versions.node} is below minimum v${minMajor}.0.0`,
    recovery: [
      `Upgrade Node.js to v${minMajor} or later:`,
      '  nvm install 22 && nvm use 22',
      '  # or: brew install node@22',
      `Current: v${process.versions.node}`,
    ],
    details: { version: process.versions.node, required: `>=${minMajor}.0.0` },
    durationMs: Date.now() - start,
  }
}

function checkHomeWritable(): PreflightResult {
  const start = Date.now()
  const check = CHECKS.find(c => c.id === 'home-writable')!

  try {
    if (!existsSync(REFLECTT_HOME)) {
      return {
        check,
        passed: false,
        message: `REFLECTT_HOME does not exist: ${REFLECTT_HOME}`,
        recovery: [
          `Create the directory:`,
          `  mkdir -p ${REFLECTT_HOME}`,
          'Or run: npx reflectt-node init',
        ],
        details: { path: REFLECTT_HOME, exists: false },
        durationMs: Date.now() - start,
      }
    }

    accessSync(REFLECTT_HOME, constants.W_OK)

    return {
      check,
      passed: true,
      message: `${REFLECTT_HOME} exists and is writable ✓`,
      details: { path: REFLECTT_HOME, writable: true },
      durationMs: Date.now() - start,
    }
  } catch (err: any) {
    return {
      check,
      passed: false,
      message: `Cannot write to ${REFLECTT_HOME}: ${err.message}`,
      recovery: [
        'Fix permissions:',
        `  chmod 755 ${REFLECTT_HOME}`,
        `  # or: sudo chown $(whoami) ${REFLECTT_HOME}`,
      ],
      details: { path: REFLECTT_HOME, error: err.message },
      durationMs: Date.now() - start,
    }
  }
}

async function checkPortAvailable(port = 4445): Promise<PreflightResult> {
  const start = Date.now()
  const check = CHECKS.find(c => c.id === 'port-available')!

  try {
    const { createServer } = await import('node:net')
    const available = await new Promise<boolean>((resolve) => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => {
        server.close()
        resolve(true)
      })
      server.listen(port, '127.0.0.1')
    })

    if (available) {
      return {
        check,
        passed: true,
        message: `Port ${port} is available ✓`,
        details: { port, available: true },
        durationMs: Date.now() - start,
      }
    }

    return {
      check,
      passed: false,
      message: `Port ${port} is already in use`,
      recovery: [
        `Check what's using port ${port}:`,
        `  lsof -i :${port}`,
        'Options:',
        '  1. Stop the existing process',
        `  2. Use a different port: --port <number>`,
        '  3. If reflectt is already running, use: reflectt host status',
      ],
      details: { port, available: false },
      durationMs: Date.now() - start,
    }
  } catch (err: any) {
    return {
      check,
      passed: true, // Can't check — assume available
      message: `Port check inconclusive (${err.message}), proceeding`,
      details: { port, error: err.message },
      durationMs: Date.now() - start,
    }
  }
}

async function checkCloudReachable(cloudUrl = 'https://app.reflectt.ai'): Promise<PreflightResult> {
  const start = Date.now()
  const check = CHECKS.find(c => c.id === 'cloud-reachable')!
  const timeout = 10_000

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    // Try the health/ping endpoint
    const response = await fetch(`${cloudUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (response.ok || response.status === 404) {
      // 404 is fine — means server is reachable, just no health endpoint
      return {
        check,
        passed: true,
        message: `Cloud reachable at ${cloudUrl} (${response.status}) ✓`,
        details: { url: cloudUrl, status: response.status, latencyMs: Date.now() - start },
        durationMs: Date.now() - start,
      }
    }

    return {
      check,
      passed: false,
      message: `Cloud returned ${response.status} ${response.statusText}`,
      recovery: [
        'Check your network connection',
        `Verify cloud URL: ${cloudUrl}`,
        'If behind a proxy, set HTTP_PROXY / HTTPS_PROXY env vars',
        'Try: curl -I ' + cloudUrl,
      ],
      details: { url: cloudUrl, status: response.status },
      durationMs: Date.now() - start,
    }
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError'
    const isDns = err.code === 'ENOTFOUND'

    return {
      check,
      passed: false,
      message: isTimeout
        ? `Cloud unreachable: connection timed out (${timeout}ms)`
        : isDns
          ? `DNS resolution failed for ${cloudUrl}`
          : `Cloud unreachable: ${err.message}`,
      recovery: isTimeout
        ? [
            'Connection timed out — check your network:',
            '  ping app.reflectt.ai',
            '  curl -I ' + cloudUrl,
            'If behind a firewall, ensure outbound HTTPS is allowed',
          ]
        : isDns
          ? [
              'DNS resolution failed:',
              '  nslookup app.reflectt.ai',
              '  # Check /etc/resolv.conf or DNS settings',
              `  # Verify URL: ${cloudUrl}`,
            ]
          : [
              'Network error:',
              '  ' + err.message,
              '  Check your internet connection',
              '  Try: curl -v ' + cloudUrl,
            ],
      details: { url: cloudUrl, error: err.message, code: err.code },
      durationMs: Date.now() - start,
    }
  }
}

async function checkAuthValid(opts: {
  cloudUrl?: string
  joinToken?: string
  apiKey?: string
}): Promise<PreflightResult> {
  const start = Date.now()
  const check = CHECKS.find(c => c.id === 'auth-valid')!
  const cloudUrl = opts.cloudUrl || 'https://app.reflectt.ai'

  if (!opts.joinToken && !opts.apiKey) {
    return {
      check,
      passed: false,
      message: 'No authentication credentials provided',
      recovery: [
        'Provide either a join token or API key:',
        '  --join-token <token>   (from dashboard → Hosts → Add Host)',
        '  --api-key <key>        (from dashboard → Settings → API Keys)',
      ],
      durationMs: Date.now() - start,
    }
  }

  // Validate format before making network call
  if (opts.joinToken) {
    // Join tokens are typically UUIDs or base64 strings
    if (opts.joinToken.length < 8) {
      return {
        check,
        passed: false,
        message: 'Join token appears malformed (too short)',
        recovery: [
          'Join tokens are generated from the dashboard:',
          '  1. Go to app.reflectt.ai → Hosts → Add Host',
          '  2. Copy the full token (usually 32+ characters)',
          '  3. Make sure no extra spaces or line breaks',
        ],
        durationMs: Date.now() - start,
      }
    }
  }

  if (opts.apiKey) {
    if (opts.apiKey.length < 16) {
      return {
        check,
        passed: false,
        message: 'API key appears malformed (too short)',
        recovery: [
          'API keys are generated from the dashboard:',
          '  1. Go to app.reflectt.ai → Settings → API Keys',
          '  2. Create a new key and copy the full value',
          '  3. Keys are shown only once — generate a new one if lost',
        ],
        durationMs: Date.now() - start,
      }
    }
  }

  // Try to validate with the cloud (non-blocking — network might be down)
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)

    const endpoint = opts.joinToken
      ? `${cloudUrl}/api/connect/validate`
      : `${cloudUrl}/api/auth/validate`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.joinToken
        ? { token: opts.joinToken }
        : { apiKey: opts.apiKey }
      ),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (response.ok) {
      return {
        check,
        passed: true,
        message: `${opts.joinToken ? 'Join token' : 'API key'} validated ✓`,
        details: { method: opts.joinToken ? 'join-token' : 'api-key' },
        durationMs: Date.now() - start,
      }
    }

    const body = await response.json().catch(() => ({})) as Record<string, unknown>

    if (response.status === 401 || response.status === 403) {
      const isExpired = (body.error as string || '').toLowerCase().includes('expired')
      return {
        check,
        passed: false,
        message: isExpired
          ? `${opts.joinToken ? 'Join token' : 'API key'} has expired`
          : `${opts.joinToken ? 'Join token' : 'API key'} is invalid`,
        recovery: isExpired
          ? [
              'Token/key has expired. Generate a new one:',
              '  1. Go to app.reflectt.ai → Hosts → Add Host',
              '  2. Generate a fresh join token',
              '  3. Tokens expire after 24 hours',
            ]
          : [
              `${opts.joinToken ? 'Join token' : 'API key'} was rejected:`,
              `  ${body.error || 'Invalid credentials'}`,
              '  1. Verify you copied the full token/key',
              '  2. Check it hasn\'t been revoked',
              '  3. Generate a new one from the dashboard',
            ],
        details: { status: response.status, error: body.error },
        durationMs: Date.now() - start,
      }
    }

    // Non-auth error (404 = endpoint doesn't exist yet, etc.)
    if (response.status === 404) {
      return {
        check,
        passed: true, // Can't validate — assume OK
        message: `Auth validation endpoint not available (format check passed) ✓`,
        details: { method: opts.joinToken ? 'join-token' : 'api-key', validation: 'format-only' },
        durationMs: Date.now() - start,
      }
    }

    return {
      check,
      passed: false,
      message: `Auth validation returned ${response.status}: ${body.error || 'unknown error'}`,
      recovery: [
        'Unexpected response from cloud:',
        `  Status: ${response.status}`,
        `  Error: ${body.error || 'none'}`,
        'Try again in a few minutes, or contact support',
      ],
      details: { status: response.status, error: body.error },
      durationMs: Date.now() - start,
    }
  } catch (err: any) {
    // Network error — can't validate, but format check passed
    return {
      check,
      passed: true, // Don't block on network failures (cloud-reachable check handles that)
      message: `Auth format valid (network validation skipped: ${err.message})`,
      details: { method: opts.joinToken ? 'join-token' : 'api-key', validation: 'format-only', error: err.message },
      durationMs: Date.now() - start,
    }
  }
}

// ── Main Preflight Runner ──

export interface PreflightOptions {
  cloudUrl?: string
  joinToken?: string
  apiKey?: string
  port?: number
  /** Skip network checks (for offline/air-gapped setups) */
  skipNetwork?: boolean
  /** User/host ID for onboarding drop-off tracking */
  userId?: string
}

/**
 * Run all preflight checks and return a report.
 * Checks run in dependency order: system → network → auth
 */
export async function runPreflight(opts: PreflightOptions = {}): Promise<PreflightReport> {
  const results: PreflightResult[] = []

  // Phase 1: System checks (no network needed)
  results.push(checkNodeVersion())
  results.push(checkHomeWritable())
  results.push(await checkPortAvailable(opts.port || 4445))

  // Phase 1b: Apple layer checks (macOS-only, best-effort; do not block bootstrap)
  if (process.platform === 'darwin') {
    const commonClients = ['com.apple.Terminal', 'com.googlecode.iterm2']

    results.push(await checkMacTccPermission({
      checkId: 'macos-screen-recording',
      service: 'kTCCServiceScreenCapture',
      systemSettingsName: 'Screen Recording',
      deepLink: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      clients: commonClients,
    }))

    results.push(await checkMacTccPermission({
      checkId: 'macos-accessibility',
      service: 'kTCCServiceAccessibility',
      systemSettingsName: 'Accessibility',
      deepLink: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      clients: commonClients,
    }))

    results.push(await checkOpenClawGateway())
  }

  // Phase 2: Network checks
  if (!opts.skipNetwork) {
    results.push(await checkCloudReachable(opts.cloudUrl))

    // Phase 3: Auth checks (depends on network)
    if (opts.joinToken || opts.apiKey) {
      results.push(await checkAuthValid({
        cloudUrl: opts.cloudUrl,
        joinToken: opts.joinToken,
        apiKey: opts.apiKey,
      }))
    }
  }

  const allPassed = results.every(r => r.passed)
  const failures = results.filter(r => !r.passed)
  const firstBlocker = failures[0]

  const summary = allPassed
    ? `All ${results.length} preflight checks passed ✓`
    : `${failures.length}/${results.length} check(s) failed`

  // ── Onboarding drop-off instrumentation ──
  // Emit activation events so the funnel tracks preflight pass/fail.
  // Uses userId (from cloud auth) or a host-level fallback.
  const hostId = `host-${hostname()}`
  const trackingId = opts.userId || hostId
  const failedCheckIds = failures.map(f => f.check.id)
  const passedCheckIds = results.filter(r => r.passed).map(r => r.check.id)

  if (allPassed) {
    emitActivationEvent('host_preflight_passed', trackingId, {
      checks_run: results.length,
      passed_checks: passedCheckIds,
      total_duration_ms: results.reduce((sum, r) => sum + r.durationMs, 0),
      pid: process.pid,
    }).catch(() => {}) // best-effort, never block preflight
  } else {
    emitActivationEvent('host_preflight_failed', trackingId, {
      checks_run: results.length,
      failed_checks: failedCheckIds,
      first_blocker: firstBlocker?.check.id,
      passed_checks: passedCheckIds,
      total_duration_ms: results.reduce((sum, r) => sum + r.durationMs, 0),
      pid: process.pid,
    }).catch(() => {}) // best-effort, never block preflight
  }

  return {
    timestamp: Date.now(),
    allPassed,
    results,
    summary,
    firstBlocker: firstBlocker
      ? {
          check: firstBlocker.check.name,
          message: firstBlocker.message,
          recovery: firstBlocker.recovery || ['No specific recovery steps available'],
        }
      : undefined,
  }
}

/**
 * Format preflight report for CLI output.
 */
export function formatPreflightReport(report: PreflightReport): string {
  const lines: string[] = []
  lines.push('─── Preflight Checks ───')
  lines.push('')

  for (const result of report.results) {
    const level = inferLevel(result)
    const icon = level === 'pass' ? '✅' : level === 'warn' ? '⚠️' : '❌'
    lines.push(`${icon} ${result.check.name}: ${result.message}`)
    if (level !== 'pass' && result.recovery) {
      lines.push('')
      lines.push('   Recovery:')
      for (const step of result.recovery) {
        lines.push(`   ${step}`)
      }
      lines.push('')
    }
  }

  lines.push('────────────────────────')
  lines.push(report.summary)

  return lines.join('\n')
}

// Export individual checks for testing
export {
  checkNodeVersion as _checkNodeVersion,
  checkHomeWritable as _checkHomeWritable,
  checkPortAvailable as _checkPortAvailable,
  checkCloudReachable as _checkCloudReachable,
  checkAuthValid as _checkAuthValid,
}
