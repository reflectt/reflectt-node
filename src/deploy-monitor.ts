// SPDX-License-Identifier: Apache-2.0

/**
 * Deploy monitor (v1): alert when production deploys fail.
 *
 * Motivation: we merged many PRs without noticing production deploys failing.
 * This monitor runs inside reflectt-node so it can alert even when cloud deploys are unhealthy.
 *
 * v1 checks:
 * - Vercel Deployments API (latest production deploy state)
 * - HTTP health URL (optional)
 *
 * Config (env):
 * - REFLECTT_DEPLOY_MONITOR_ENABLED=1|true
 * - REFLECTT_VERCEL_TOKEN (fallback: VERCEL_TOKEN)
 * - REFLECTT_VERCEL_PROJECT_ID (fallback: VERCEL_PROJECT_ID)
 * - REFLECTT_VERCEL_TEAM_ID (optional; fallback: VERCEL_TEAM_ID)
 * - REFLECTT_DEPLOY_MONITOR_HEALTH_URL (optional)
 * - REFLECTT_DEPLOY_MONITOR_INTERVAL_SEC (default 300)
 */

import { chatManager } from './chat.js'
import { recordSystemLoopTick } from './system-loop-state.js'

type VercelDeploymentState = 'READY' | 'ERROR' | 'CANCELED' | 'BUILDING' | 'QUEUED' | 'INITIALIZING' | string

interface VercelDeployment {
  uid?: string
  url?: string
  name?: string
  state?: VercelDeploymentState
  created?: number
}

let timer: NodeJS.Timeout | null = null
let lastAlertKey = ''
let lastAlertAt = 0

function envBool(value: unknown): boolean {
  const v = String(value || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function parseIntSafe(v: unknown): number | undefined {
  const n = Number.parseInt(String(v || ''), 10)
  return Number.isFinite(n) ? n : undefined
}

function getConfig() {
  const enabled = envBool(process.env.REFLECTT_DEPLOY_MONITOR_ENABLED)
  const token = process.env.REFLECTT_VERCEL_TOKEN || process.env.VERCEL_TOKEN || ''
  const projectId = process.env.REFLECTT_VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_ID || ''
  const teamId = process.env.REFLECTT_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID || ''
  const healthUrl = process.env.REFLECTT_DEPLOY_MONITOR_HEALTH_URL || ''
  const intervalSec = parseIntSafe(process.env.REFLECTT_DEPLOY_MONITOR_INTERVAL_SEC) ?? 300

  return { enabled, token, projectId, teamId, healthUrl, intervalSec }
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ ok: boolean; status: number; body?: any; error?: string }> {
  const timeoutMs = init.timeoutMs ?? 8_000
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const status = res.status
    const text = await res.text().catch(() => '')
    let body: any
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      body = { raw: text }
    }
    return { ok: res.ok, status, body }
  } catch (err: any) {
    return { ok: false, status: 0, error: err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err)) }
  } finally {
    clearTimeout(t)
  }
}

async function checkHealthUrl(healthUrl: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetchJson(healthUrl, { timeoutMs: 6_000 })
  if (!res.ok) return { ok: false, status: res.status, error: res.error || `HTTP ${res.status}` }
  return { ok: true, status: res.status }
}

async function getLatestVercelProdDeployment(opts: { token: string; projectId: string; teamId?: string }): Promise<{ ok: boolean; status: number; deployment?: VercelDeployment; error?: string }> {
  if (!opts.token || !opts.projectId) {
    return { ok: false, status: 0, error: 'vercel_not_configured' }
  }

  const teamQuery = opts.teamId ? `&teamId=${encodeURIComponent(opts.teamId)}` : ''
  const url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(opts.projectId)}&target=production&limit=1${teamQuery}`

  const res = await fetchJson(url, {
    timeoutMs: 8_000,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error || `vercel_http_${res.status}` }
  }

  const dep = (res.body?.deployments?.[0] || null) as VercelDeployment | null
  if (!dep) return { ok: true, status: res.status, deployment: undefined }

  return { ok: true, status: res.status, deployment: dep }
}

function isFailureState(state: VercelDeploymentState | undefined): boolean {
  const s = String(state || '').toUpperCase()
  return s === 'ERROR' || s === 'CANCELED'
}

async function maybeAlert(key: string, content: string): Promise<void> {
  const now = Date.now()
  const cooldownMs = 30 * 60_000

  if (key === lastAlertKey && now - lastAlertAt < cooldownMs) return
  lastAlertKey = key
  lastAlertAt = now

  await chatManager.sendMessage({
    from: 'system',
    channel: 'ops',
    content,
    metadata: {
      dedup_key: key,
      bypass_budget: true,
      category: 'deploy-monitor',
    },
  })
}

async function tick(): Promise<void> {
  const cfg = getConfig()
  if (!cfg.enabled) return

  recordSystemLoopTick('deploy_monitor')

  // 1) Vercel deploy status
  const latest = await getLatestVercelProdDeployment({ token: cfg.token, projectId: cfg.projectId, teamId: cfg.teamId || undefined })
  if (!latest.ok) {
    // Only alert if configured but failing to query.
    if (cfg.token && cfg.projectId) {
      await maybeAlert(
        `deploy_monitor:vercel:api_error:${latest.error || latest.status}`,
        `🚨 Deploy monitor: failed to query Vercel deployments (${latest.error || `HTTP ${latest.status}`}). This can mask failed prod deploys.`,
      )
    }
  } else {
    const dep = latest.deployment
    const state = String(dep?.state || 'unknown')
    if (dep && isFailureState(dep.state)) {
      const id = dep.uid || dep.url || dep.name || 'unknown'
      await maybeAlert(
        `deploy_monitor:vercel:failed:${id}:${state}`,
        `🚨 Production deploy failed on Vercel (state=${state}, id=${id}). Investigate Vercel build logs + env vars immediately.`,
      )
    }
  }

  // 2) Health URL (optional)
  if (cfg.healthUrl) {
    const health = await checkHealthUrl(cfg.healthUrl)
    if (!health.ok) {
      await maybeAlert(
        `deploy_monitor:health:down:${cfg.healthUrl}:${health.status}`,
        `🚨 Cloud health check failed (${cfg.healthUrl} → ${health.error || `HTTP ${health.status}`}). Production may be down or misconfigured.`,
      )
    }
  }
}

export function startDeployMonitor(): void {
  const cfg = getConfig()
  if (!cfg.enabled) return
  if (timer) return

  // Run once immediately then on interval.
  tick().catch(() => {})
  timer = setInterval(() => {
    tick().catch(() => {})
  }, Math.max(30, cfg.intervalSec) * 1000)
  timer.unref()
}

export function stopDeployMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function _internal() {
  return { getConfig, isFailureState }
}
