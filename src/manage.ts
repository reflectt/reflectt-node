// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Remote node management API — safe, auth-gated endpoints for
// version/status, logs tail, restart, and config introspection.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { serverConfig, openclawConfig, isDev, REFLECTT_HOME, DATA_DIR } from './config.js'
import { readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'

// ── Auth helper ──────────────────────────────────────────────────────
// Uses REFLECTT_MANAGE_TOKEN or falls back to REFLECTT_INSIGHT_MUTATION_TOKEN.
// Requests from loopback (127.0.0.1/::1) skip auth if no token is configured.

function extractToken(request: FastifyRequest): string | undefined {
  const raw = (request.headers as any)['x-manage-token']
  if (typeof raw === 'string' && raw.length > 0) return raw

  const auth = request.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim()
  }
  return undefined
}

function isLoopback(request: FastifyRequest): boolean {
  const ip = request.ip || ''
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

function checkManageAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const requiredToken = process.env.REFLECTT_MANAGE_TOKEN || process.env.REFLECTT_INSIGHT_MUTATION_TOKEN
  if (!requiredToken) {
    // No token configured — allow loopback only
    if (isLoopback(request)) return true
    reply.code(403)
    reply.send({
      error: 'Forbidden: manage endpoints require REFLECTT_MANAGE_TOKEN or loopback access',
      hint: 'Set REFLECTT_MANAGE_TOKEN env var, or access from localhost.',
    })
    return false
  }

  const provided = extractToken(request)
  if (provided === requiredToken) return true

  // Allow loopback even with token configured (convenient for local dev)
  if (isLoopback(request)) return true

  reply.code(403)
  reply.send({
    error: 'Forbidden: invalid manage token',
    hint: 'Provide x-manage-token header or Authorization: Bearer <token> matching REFLECTT_MANAGE_TOKEN.',
  })
  return false
}

// ── Redact sensitive values ──────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'credential', 'token', 'apiKey', 'api_key', 'secret', 'password',
  'gatewayToken', 'REFLECTT_MANAGE_TOKEN', 'REFLECTT_INSIGHT_MUTATION_TOKEN',
  'REFLECTT_HOST_HEARTBEAT_TOKEN', 'OPENCLAW_GATEWAY_TOKEN',
])

function redactValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value
  const keyLower = key.toLowerCase()
  for (const sensitive of SENSITIVE_KEYS) {
    if (keyLower.includes(sensitive.toLowerCase())) {
      return value.length > 0 ? `***${value.slice(-4)}` : '***'
    }
  }
  return value
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>)
    } else {
      result[key] = redactValue(key, value)
    }
  }
  return result
}

// ── Register manage routes ───────────────────────────────────────────

export function registerManageRoutes(app: FastifyInstance, deps: {
  getBuildInfo: () => Record<string, unknown>
  getHealthStats: () => Promise<Record<string, unknown>>
  readStoredLogs: (opts: { since: number; level: string; limit: number }) => Promise<any[]>
  getStoredLogPath: () => string
}): void {

  // GET /manage/status — unified status (version + health + uptime)
  app.get('/manage/status', async (request, reply) => {
    if (!checkManageAuth(request, reply)) return
    const build = deps.getBuildInfo()
    const health = await deps.getHealthStats()
    return {
      status: 'ok',
      build,
      health,
      env: isDev ? 'development' : 'production',
      reflecttHome: REFLECTT_HOME,
      dataDir: DATA_DIR,
      timestamp: Date.now(),
    }
  })

  // GET /manage/config — config introspection (secrets redacted)
  app.get('/manage/config', async (request, reply) => {
    if (!checkManageAuth(request, reply)) return

    // Load config.json if it exists
    const configPath = join(REFLECTT_HOME, 'config.json')
    let fileConfig: Record<string, unknown> = {}
    try {
      fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch { /* no config file */ }

    // Env-based config
    const envConfig: Record<string, unknown> = {
      PORT: serverConfig.port,
      HOST: serverConfig.host,
      CORS_ENABLED: serverConfig.corsEnabled,
      NODE_ENV: process.env.NODE_ENV || 'undefined',
      REFLECTT_HOME,
      OPENCLAW_GATEWAY_URL: openclawConfig.gatewayUrl,
      OPENCLAW_AGENT_ID: openclawConfig.agentId,
    }

    // Auth tokens (present/absent, never values)
    // Uses indirect lookup to avoid gitleaks env-dump false positives
    const tokenKeys = [
      'REFLECTT_MANAGE_TOKEN',
      'REFLECTT_INSIGHT_MUTATION_TOKEN',
      'REFLECTT_HOST_HEARTBEAT_TOKEN',
      'OPENCLAW_GATEWAY_TOKEN',
    ]
    const authTokens: Record<string, string> = {}
    for (const key of tokenKeys) {
      authTokens[key] = process.env[key] ? 'set' : 'not set'
    }

    // Team files
    const teamFiles: Record<string, boolean> = {}
    for (const name of ['TEAM.md', 'TEAM-ROLES.yaml', 'TEAM-STANDARDS.md']) {
      teamFiles[name] = existsSync(join(REFLECTT_HOME, name))
    }

    return {
      server: envConfig,
      file: redactObject(fileConfig),
      authTokens,
      teamFiles,
      configPath,
      timestamp: Date.now(),
    }
  })

  // GET /manage/logs — bounded log tail
  app.get('/manage/logs', async (request, reply) => {
    if (!checkManageAuth(request, reply)) return

    const query = request.query as Record<string, string>
    const level = query.level || 'error'
    const since = query.since ? parseInt(query.since, 10) : Date.now() - (60 * 60 * 1000) // 1h default
    const limit = Math.min(parseInt(query.limit || '50', 10), 200)

    try {
      const logs = await deps.readStoredLogs({ since, level, limit })
      const logPath = deps.getStoredLogPath()

      // Optional text format for curl-friendly output
      if (query.format === 'text') {
        reply.type('text/plain')
        if (logs.length === 0) return 'No logs found.\n'
        return logs.map((l: any) => {
          const ts = new Date(l.timestamp || l.ts).toISOString()
          return `[${ts}] ${l.level || level} ${l.message || l.msg || JSON.stringify(l)}`
        }).join('\n') + '\n'
      }

      return {
        logs,
        count: logs.length,
        level,
        since,
        limit,
        logPath,
      }
    } catch (err: any) {
      reply.code(500)
      return { error: 'Failed to read logs', details: String(err?.message || err) }
    }
  })

  // POST /manage/restart — graceful restart (if running as child process / systemd / docker)
  app.post('/manage/restart', async (request, reply) => {
    if (!checkManageAuth(request, reply)) return

    // Schedule restart after response is sent
    const method = detectRestartMethod()
    if (!method) {
      reply.code(501)
      return {
        error: 'Restart not supported in this environment',
        hint: 'Restart is supported when running via: Docker (SIGTERM), systemd, or reflectt CLI (PID file).',
        pid: process.pid,
      }
    }

    // Respond first, then restart
    reply.send({
      status: 'restarting',
      method,
      pid: process.pid,
      message: `Server will restart via ${method}. Reconnect in a few seconds.`,
    })

    // Give response time to flush
    setTimeout(() => {
      if (method === 'exit') {
        // Docker/systemd will auto-restart on exit code 0
        process.exit(0)
      } else if (method === 'sigterm') {
        process.kill(process.pid, 'SIGTERM')
      }
    }, 500)
  })

  // GET /manage/disk — data directory sizes (for capacity monitoring)
  app.get('/manage/disk', async (request, reply) => {
    if (!checkManageAuth(request, reply)) return

    const dirs: Record<string, { exists: boolean; sizeBytes?: number }> = {}
    const checkPaths = [
      { name: 'reflecttHome', path: REFLECTT_HOME },
      { name: 'data', path: DATA_DIR },
      { name: 'db', path: join(DATA_DIR, 'reflectt.db') },
      { name: 'logs', path: join(DATA_DIR, 'logs') },
    ]

    for (const { name, path } of checkPaths) {
      try {
        const stat = statSync(path)
        dirs[name] = { exists: true, sizeBytes: stat.size }
      } catch {
        dirs[name] = { exists: false }
      }
    }

    return { dirs, timestamp: Date.now() }
  })
}

// ── Restart method detection ─────────────────────────────────────────

function detectRestartMethod(): string | null {
  // Docker: check for /.dockerenv or cgroup
  if (existsSync('/.dockerenv')) return 'exit'

  // systemd: check for INVOCATION_ID
  if (process.env.INVOCATION_ID) return 'exit'

  // reflectt CLI with PID file: use SIGTERM
  const pidFile = join(REFLECTT_HOME, 'server.pid')
  if (existsSync(pidFile)) return 'sigterm'

  // Dev mode: allow exit (npm run dev will re-run with tsx watch)
  if (isDev) return 'exit'

  return null
}
