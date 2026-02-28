// SPDX-License-Identifier: Apache-2.0
// Host keepalive: periodic pings to prevent managed hosts from going idle
// Targets: Cloudflare Workers, load-balanced nodes, any host that hibernates

import { listHosts, getHost, upsertHostHeartbeat } from './host-registry.js'

// ── Types ──

export interface KeepaliveResult {
  hostId: string
  url: string
  status: 'ok' | 'error' | 'timeout'
  latencyMs: number
  statusCode?: number
  error?: string
  ts: number
}

interface KeepaliveState {
  results: Map<string, KeepaliveResult>  // hostId → last result
  timer: ReturnType<typeof setInterval> | null
  intervalMs: number
  enabled: boolean
}

// ── State ──

const state: KeepaliveState = {
  results: new Map(),
  timer: null,
  intervalMs: 4 * 60 * 1000, // 4 minutes (under typical 5min idle threshold)
  enabled: false,
}

// ── Ping a single host ──

async function pingHost(hostId: string, url: string): Promise<KeepaliveResult> {
  const pingUrl = url.replace(/\/+$/, '') + '/health/ping'
  const start = Date.now()

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000) // 10s timeout

    const response = await fetch(pingUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'reflectt-node-keepalive/1.0' },
    })
    clearTimeout(timeout)

    const latencyMs = Date.now() - start
    const result: KeepaliveResult = {
      hostId,
      url: pingUrl,
      status: response.ok ? 'ok' : 'error',
      latencyMs,
      statusCode: response.status,
      ts: Date.now(),
    }

    if (!response.ok) {
      result.error = `HTTP ${response.status}`
    }

    return result
  } catch (err) {
    const latencyMs = Date.now() - start
    const isTimeout = (err as Error).name === 'AbortError'
    return {
      hostId,
      url: pingUrl,
      status: isTimeout ? 'timeout' : 'error',
      latencyMs,
      error: isTimeout ? 'Request timed out (10s)' : (err as Error).message,
      ts: Date.now(),
    }
  }
}

// ── Ping all managed hosts ──

export async function pingAllHosts(): Promise<KeepaliveResult[]> {
  const hosts = listHosts()
  const results: KeepaliveResult[] = []

  for (const host of hosts) {
    const url = (host.metadata?.url as string) || (host.metadata?.base_url as string)
    if (!url) continue // No URL registered — can't ping

    const result = await pingHost(host.id, url)
    state.results.set(host.id, result)
    results.push(result)

    // Log failures for observability
    if (result.status !== 'ok') {
      console.warn(`[Keepalive] ${host.id} (${url}): ${result.status} — ${result.error || `HTTP ${result.statusCode}`}`)
    }
  }

  return results
}

// ── Start/stop keepalive timer ──

export function startKeepalive(intervalMs?: number): void {
  if (state.timer) return // Already running

  if (intervalMs) state.intervalMs = intervalMs
  state.enabled = true

  // Initial ping after 30s (let server boot)
  setTimeout(() => {
    pingAllHosts().catch(err =>
      console.error('[Keepalive] Initial ping failed:', err.message)
    )
  }, 30_000)

  state.timer = setInterval(() => {
    pingAllHosts().catch(err =>
      console.error('[Keepalive] Ping cycle failed:', err.message)
    )
  }, state.intervalMs)

  console.log(`[Keepalive] Started — pinging managed hosts every ${Math.round(state.intervalMs / 1000)}s`)
}

export function stopKeepalive(): void {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.enabled = false
  console.log('[Keepalive] Stopped')
}

// ── Status ──

export function getKeepaliveStatus(): {
  enabled: boolean
  intervalMs: number
  hosts: Array<KeepaliveResult & { hostname?: string; hostStatus?: string }>
} {
  const hosts: Array<KeepaliveResult & { hostname?: string; hostStatus?: string }> = []

  for (const [hostId, result] of state.results) {
    const host = getHost(hostId)
    hosts.push({
      ...result,
      hostname: host?.hostname ?? undefined,
      hostStatus: host?.status ?? undefined,
    })
  }

  return {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    hosts,
  }
}

// ── Manual trigger ──

export async function triggerKeepalivePing(hostId?: string): Promise<KeepaliveResult[]> {
  if (hostId) {
    const host = getHost(hostId)
    if (!host) return []
    const url = (host.metadata?.url as string) || (host.metadata?.base_url as string)
    if (!url) return []

    const result = await pingHost(host.id, url)
    state.results.set(host.id, result)
    return [result]
  }

  return pingAllHosts()
}
