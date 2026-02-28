// SPDX-License-Identifier: Apache-2.0
// Self-keepalive: prevents Cloudflare Workers / serverless containers from going cold.
// Pings localhost on a timer to keep the process active.
// Enable via REFLECTT_KEEPALIVE=true or auto-detects Cloudflare environment.

// ── Types ──

export interface SelfKeepaliveState {
  enabled: boolean
  intervalMs: number
  lastPingAt: number | null
  lastPingOk: boolean | null
  coldStarts: number
  timer: ReturnType<typeof setInterval> | null
}

export interface WarmBootInfo {
  isColdStart: boolean
  isWarmBoot: boolean
  lastActivityAge: number | null // ms since last DB activity, null if no prior data
  recoveredState: {
    tasks: number
    chatMessages: number
    hosts: number
    reflections: number
  } | null
}

// ── State ──

const state: SelfKeepaliveState = {
  enabled: false,
  intervalMs: 4 * 60 * 1000, // 4 min default (under 5min CF idle threshold)
  lastPingAt: null,
  lastPingOk: null,
  coldStarts: 0,
  timer: null,
}

let _bootInfo: WarmBootInfo | null = null

// ── Environment detection ──

function isCloudflareEnv(): boolean {
  // CF Workers set CF_PAGES, CF_WORKER, CLOUDFLARE_* or run under workerd
  return !!(
    process.env['CF_PAGES'] ||
    process.env['CF_WORKER'] ||
    process.env['CLOUDFLARE_ACCOUNT_ID'] ||
    process.env['WORKERS_RS_VERSION']
  )
}

function shouldAutoEnable(): boolean {
  const explicit = process.env['REFLECTT_KEEPALIVE']
  if (explicit === 'true' || explicit === '1') return true
  if (explicit === 'false' || explicit === '0') return false
  // Auto-enable in Cloudflare environments
  return isCloudflareEnv()
}

// ── Self-ping ──

async function selfPing(port: number): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5_000)
    const resp = await fetch(`http://127.0.0.1:${port}/health/ping`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'reflectt-self-keepalive/1.0' },
    })
    clearTimeout(timeout)
    state.lastPingAt = Date.now()
    state.lastPingOk = resp.ok
    return resp.ok
  } catch {
    state.lastPingAt = Date.now()
    state.lastPingOk = false
    return false
  }
}

// ── Warm boot detection ──

export function detectWarmBoot(db: { prepare: (sql: string) => { get: () => Record<string, unknown> | undefined } }): WarmBootInfo {
  try {
    const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get() as { c: number } | undefined
    const chatCount = db.prepare('SELECT COUNT(*) as c FROM chat_messages').get() as { c: number } | undefined
    const hostCount = db.prepare('SELECT COUNT(*) as c FROM hosts').get() as { c: number } | undefined

    let reflectionCount = 0
    try {
      const r = db.prepare('SELECT COUNT(*) as c FROM reflections').get() as { c: number } | undefined
      reflectionCount = r?.c ?? 0
    } catch { /* table may not exist */ }

    const tasks = taskCount?.c ?? 0
    const chat = chatCount?.c ?? 0
    const hosts = hostCount?.c ?? 0

    // Check last activity timestamp
    const lastTask = db.prepare('SELECT MAX(updated_at) as ts FROM tasks').get() as { ts: number | null } | undefined
    const lastChat = db.prepare('SELECT MAX(timestamp) as ts FROM chat_messages').get() as { ts: number | null } | undefined
    const lastActivity = Math.max(lastTask?.ts ?? 0, lastChat?.ts ?? 0)

    const hasExistingData = tasks > 0 || chat > 0
    const lastActivityAge = lastActivity > 0 ? Date.now() - lastActivity : null

    const info: WarmBootInfo = {
      isColdStart: !hasExistingData,
      isWarmBoot: hasExistingData,
      lastActivityAge,
      recoveredState: hasExistingData ? {
        tasks,
        chatMessages: chat,
        hosts,
        reflections: reflectionCount,
      } : null,
    }

    _bootInfo = info

    if (hasExistingData) {
      const ageSec = lastActivityAge ? Math.round(lastActivityAge / 1000) : '?'
      console.log(
        `[Keepalive] Warm boot detected — recovered ${tasks} tasks, ${chat} messages, ${hosts} hosts ` +
        `(last activity ${ageSec}s ago)`
      )
      state.coldStarts++ // Track that we had to restart
    } else {
      console.log('[Keepalive] Cold start — fresh instance, no existing data')
    }

    return info
  } catch (err) {
    const info: WarmBootInfo = {
      isColdStart: true,
      isWarmBoot: false,
      lastActivityAge: null,
      recoveredState: null,
    }
    _bootInfo = info
    console.warn('[Keepalive] Could not detect boot state:', (err as Error).message)
    return info
  }
}

// ── Start / Stop ──

export function startSelfKeepalive(port: number, intervalMs?: number): void {
  if (!shouldAutoEnable()) {
    console.log('[Keepalive] Self-keepalive disabled (set REFLECTT_KEEPALIVE=true to enable)')
    return
  }

  if (state.timer) return // Already running

  if (intervalMs) state.intervalMs = intervalMs
  state.enabled = true

  // First ping after 30s (let server fully boot)
  setTimeout(() => {
    selfPing(port).catch(() => {})
  }, 30_000)

  state.timer = setInterval(() => {
    selfPing(port).catch(() => {})
  }, state.intervalMs)

  console.log(
    `[Keepalive] Self-keepalive started — pinging localhost:${port} every ${Math.round(state.intervalMs / 1000)}s`
  )
}

export function stopSelfKeepalive(): void {
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
  state.enabled = false
}

// ── Status ──

export function getSelfKeepaliveStatus(): {
  enabled: boolean
  intervalMs: number
  lastPingAt: number | null
  lastPingOk: boolean | null
  coldStarts: number
  bootInfo: WarmBootInfo | null
  environment: {
    cloudflare: boolean
    keepaliveEnv: string | undefined
  }
} {
  return {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    lastPingAt: state.lastPingAt,
    lastPingOk: state.lastPingOk,
    coldStarts: state.coldStarts,
    bootInfo: _bootInfo,
    environment: {
      cloudflare: isCloudflareEnv(),
      keepaliveEnv: process.env['REFLECTT_KEEPALIVE'],
    },
  }
}

export function getBootInfo(): WarmBootInfo | null {
  return _bootInfo
}
