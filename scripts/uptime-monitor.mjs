#!/usr/bin/env node
/**
 * uptime-monitor.mjs — Production health monitor
 *
 * Checks every 5 minutes:
 *   1. app.reflectt.ai/overview — returns 200 (Vercel frontend)
 *   2. api.reflectt.ai health — returns 200 (Fly API)
 *   3. Canvas stream — returns agent data with count > 0
 *
 * Alerts #ops via node chat API when anything fails.
 * Run: node scripts/uptime-monitor.mjs
 * Cron: every 5 min — see launchd plist or crontab
 *
 * Env:
 *   NODE_API — node API base (default: http://127.0.0.1:4445)
 *   HOST_ID — Fly host ID for canvas check
 *   FLY_API — Fly API base (default: https://api.reflectt.ai)
 *   APP_URL — Frontend URL (default: https://app.reflectt.ai)
 *   DRY_RUN — if "1", print alerts instead of posting
 */

const NODE_API = process.env.NODE_API || 'http://127.0.0.1:4445'
const HOST_ID = process.env.HOST_ID || 'b8465d7e-e641-4301-8537-cb3b9f5d7d0d'
const FLY_API = process.env.FLY_API || 'https://api.reflectt.ai'
const APP_URL = process.env.APP_URL || 'https://app.reflectt.ai'
const DRY_RUN = process.env.DRY_RUN === '1'
const TIMEOUT_MS = 15_000

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal })
    clearTimeout(timer)
    return res
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

async function alertOps(message) {
  const line = `🚨 **UPTIME ALERT** — ${message}`
  if (DRY_RUN) {
    console.error(`[DRY_RUN] ${line}`)
    return
  }
  try {
    await fetch(`${NODE_API}/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'uptime-monitor', content: line, channel: 'ops' }),
    })
  } catch (err) {
    console.error(`Failed to post alert to #ops: ${err.message}`)
  }
}

async function checkOverview() {
  try {
    const res = await fetchWithTimeout(`${APP_URL}/overview`)
    if (res.status >= 500) {
      return { ok: false, msg: `Overview returned ${res.status}` }
    }
    // 200 or 3xx (redirect to auth) are both acceptable — means Vercel is up
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: `Overview unreachable: ${err.message}` }
  }
}

async function checkFlyHealth() {
  try {
    const res = await fetchWithTimeout(`${FLY_API}/api/hosts/${HOST_ID}/health`)
    if (!res.ok && res.status !== 401) {
      // 401 = auth required but server is up. 5xx = server down.
      return { ok: false, msg: `Fly API returned ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: `Fly API unreachable: ${err.message}` }
  }
}

async function checkCanvasData() {
  try {
    // Use the node's local canvas data (already synced from cloud)
    const res = await fetchWithTimeout(`${NODE_API}/health`)
    if (!res.ok) {
      return { ok: false, msg: `Node health returned ${res.status}` }
    }
    const data = await res.json()
    // Check canvas sync freshness
    if (data.canvas?.lastSync) {
      const age = Date.now() - data.canvas.lastSync
      if (age > 10 * 60 * 1000) { // 10 min stale
        return { ok: false, msg: `Canvas data stale (${Math.round(age / 60000)}m old)` }
      }
    }
    // Check agent count
    const agentRes = await fetchWithTimeout(`${NODE_API}/pulse?compact=true`)
    if (agentRes.ok) {
      const pulse = await agentRes.json()
      const agentCount = pulse.agents?.length || pulse.doing?.length || 0
      if (agentCount === 0) {
        return { ok: false, msg: 'No agents active on node' }
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: `Node unreachable: ${err.message}` }
  }
}

async function checkFlyCanvasEndpoint() {
  try {
    // Hit the canvas endpoint on Fly (without auth — expect 401 but server should respond)
    const res = await fetchWithTimeout(`${FLY_API}/api/hosts/${HOST_ID}/canvas`)
    // 401 = server up, auth required. 200 = server up with data. 5xx = problem.
    if (res.status >= 500) {
      return { ok: false, msg: `Fly canvas endpoint returned ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: `Fly canvas endpoint unreachable: ${err.message}` }
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function run() {
  const checks = [
    { name: 'Overview (Vercel)', fn: checkOverview },
    { name: 'Fly API health', fn: checkFlyHealth },
    { name: 'Fly canvas endpoint', fn: checkFlyCanvasEndpoint },
    { name: 'Node + canvas data', fn: checkCanvasData },
  ]

  const results = await Promise.all(checks.map(async (c) => {
    const result = await c.fn()
    return { ...c, ...result }
  }))

  const failures = results.filter(r => !r.ok)

  if (failures.length === 0) {
    console.log(`✅ All ${checks.length} checks passed — ${new Date().toISOString()}`)
  } else {
    const summary = failures.map(f => `❌ ${f.name}: ${f.msg}`).join('\n')
    console.error(summary)
    await alertOps(`${failures.length}/${checks.length} checks failed:\n${summary}`)
  }

  // Always log for cron audit trail
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.msg ? ': ' + r.msg : ''}`)
  }
}

run().catch(err => {
  console.error(`Monitor crashed: ${err.message}`)
  alertOps(`Monitor script crashed: ${err.message}`)
})
