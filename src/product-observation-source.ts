/**
 * product-observation-source.ts
 *
 * ProductObservationSource — Phase 1 cheap HTTP health probes.
 *
 * Triggered by the continuity loop when an agent's queue empties after a
 * recent ship. Runs lightweight health probes against the local node and
 * emits findings as Reflection objects, which flow through the existing
 * intake pipeline (reflection → insight → task).
 *
 * Phase 1 probes (this file):
 *   - HealthProbe: GET /health — checks status + response time
 *   - AgentsProbe: GET /health/agents — stale/unhealthy agent detection
 *   - TasksProbe:  GET /tasks — detects stuck doing/validating tasks
 *   - ChatProbe:   GET /chat/messages — checks message recency (team comms gap)
 *
 * Phase 2 (browser probe) is out-of-scope for this task — opt-in, policy flag.
 *
 * Integration: call runProductObservation(agent) from tickContinuityLoop()
 * after insight promotion misses, gated on:
 *   - queue below floor
 *   - agent shipped something in last 4h
 *   - cooldown not active (30m per agent)
 */

import { createReflection } from './reflections.js'
import { ingestReflection } from './insights.js'
import { getDb } from './db.js'

// ── Config ─────────────────────────────────────────────────────────────────

const NODE_BASE_URL = process.env.REFLECTT_NODE_URL || 'http://127.0.0.1:4445'
const PROBE_TIMEOUT_MS = 5_000          // 5s max per probe
const SLOW_THRESHOLD_MS = 2_000         // emit finding if response >2s
const COOLDOWN_MS = 30 * 60 * 1000     // 30 min cooldown per agent
const RECENT_SHIP_WINDOW_MS = 4 * 60 * 60 * 1000  // 4h ship recency window
const KV_PREFIX = 'product_obs:'       // kv key prefix for cooldown tracking

// ── Interfaces ─────────────────────────────────────────────────────────────

export interface ProbeResult {
  probe: string
  ok: boolean
  latencyMs: number
  finding?: string    // human-readable summary of the issue (only if !ok or slow)
  detail?: string
}

export interface ProductObservationResult {
  agent: string
  probesRun: number
  findings: ProbeResult[]
  reflectionsCreated: number
  skipped?: string    // reason if skipped (cooldown, no recent ship, etc.)
}

// ── KV helpers (reuse sqlite kv table already in db.ts) ───────────────────

function kvGet(key: string): string | null {
  const db = getDb()
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}

function kvSet(key: string, value: string): void {
  const db = getDb()
  try {
    db.prepare(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value)
  } catch { /* kv table may not exist yet */ }
}

// ── Cooldown check ─────────────────────────────────────────────────────────

function isCoolingDown(agent: string, now: number): boolean {
  const key = `${KV_PREFIX}last_run:${agent}`
  const lastRun = kvGet(key)
  if (!lastRun) return false
  return now - Number(lastRun) < COOLDOWN_MS
}

function recordRun(agent: string, now: number): void {
  kvSet(`${KV_PREFIX}last_run:${agent}`, String(now))
}

// ── Recent ship check ──────────────────────────────────────────────────────

async function agentShippedRecently(agent: string, now: number): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(`${NODE_BASE_URL}/health/agents`, { signal: ctrl.signal })
    clearTimeout(timeout)
    if (!res.ok) return false
    const data = await res.json() as { agents?: Array<{ agent: string; last_shipped_at?: number }> }
    const entry = data.agents?.find(a => a.agent === agent)
    if (!entry?.last_shipped_at) return false
    return now - entry.last_shipped_at < RECENT_SHIP_WINDOW_MS
  } catch {
    return false
  }
}

// ── Probe implementations ──────────────────────────────────────────────────

async function runHealthProbe(): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(`${NODE_BASE_URL}/health`, { signal: ctrl.signal })
    clearTimeout(timeout)
    const latencyMs = Date.now() - start
    const data = await res.json() as { status?: string }
    const ok = res.ok && data?.status === 'ok'
    const slow = latencyMs > SLOW_THRESHOLD_MS

    return {
      probe: 'health',
      ok: ok && !slow,
      latencyMs,
      finding: !ok
        ? `Node health check failed: status=${data?.status ?? res.status}`
        : slow ? `Node health endpoint slow: ${latencyMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)` : undefined,
    }
  } catch (err) {
    return {
      probe: 'health',
      ok: false,
      latencyMs: Date.now() - start,
      finding: `Health probe failed: ${(err as Error).message}`,
    }
  }
}

async function runAgentsProbe(): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(`${NODE_BASE_URL}/health/agents`, { signal: ctrl.signal })
    clearTimeout(timeout)
    const latencyMs = Date.now() - start
    if (!res.ok) {
      return { probe: 'agents', ok: false, latencyMs, finding: `/health/agents returned ${res.status}` }
    }

    const data = await res.json() as { agents?: Array<{ agent: string; state?: string; stale_reason?: string }> }
    const agents = data.agents ?? []
    const unhealthy = agents.filter(a => a.state && a.state !== 'healthy')

    if (unhealthy.length > 0) {
      const names = unhealthy.map(a => `${a.agent}(${a.state})`).join(', ')
      return {
        probe: 'agents',
        ok: false,
        latencyMs,
        finding: `${unhealthy.length} agent(s) not healthy: ${names}`,
        detail: unhealthy.map(a => `${a.agent}: ${a.stale_reason ?? a.state}`).join('; '),
      }
    }

    const slow = latencyMs > SLOW_THRESHOLD_MS
    return {
      probe: 'agents',
      ok: !slow,
      latencyMs,
      finding: slow ? `Agents endpoint slow: ${latencyMs}ms` : undefined,
    }
  } catch (err) {
    return {
      probe: 'agents',
      ok: false,
      latencyMs: Date.now() - start,
      finding: `Agents probe failed: ${(err as Error).message}`,
    }
  }
}

async function runTasksProbe(): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(`${NODE_BASE_URL}/tasks?status=doing&compact=true`, { signal: ctrl.signal })
    clearTimeout(timeout)
    const latencyMs = Date.now() - start
    if (!res.ok) {
      return { probe: 'tasks', ok: false, latencyMs, finding: `/tasks returned ${res.status}` }
    }

    const data = await res.json() as { tasks?: Array<{ id: string; assignee?: string; title?: string; updatedAt?: number }> }
    const doingTasks = data.tasks ?? []
    const now = Date.now()
    // Flag tasks doing for >4h with no update
    const stuck = doingTasks.filter(t => t.updatedAt && now - t.updatedAt > 4 * 60 * 60 * 1000)

    if (stuck.length > 0) {
      const summaries = stuck.map(t => `${t.id} (@${t.assignee ?? 'unknown'})`).join(', ')
      return {
        probe: 'tasks',
        ok: false,
        latencyMs,
        finding: `${stuck.length} task(s) stuck in doing for >4h: ${summaries}`,
      }
    }

    const slow = latencyMs > SLOW_THRESHOLD_MS
    return {
      probe: 'tasks',
      ok: !slow,
      latencyMs,
      finding: slow ? `Tasks endpoint slow: ${latencyMs}ms` : undefined,
    }
  } catch (err) {
    return {
      probe: 'tasks',
      ok: false,
      latencyMs: Date.now() - start,
      finding: `Tasks probe failed: ${(err as Error).message}`,
    }
  }
}

async function runChatProbe(): Promise<ProbeResult> {
  const start = Date.now()
  try {
    const ctrl = new AbortController()
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(`${NODE_BASE_URL}/chat/messages?limit=1&compact=true`, { signal: ctrl.signal })
    clearTimeout(timeout)
    const latencyMs = Date.now() - start
    if (!res.ok) {
      return { probe: 'chat', ok: false, latencyMs, finding: `/chat/messages returned ${res.status}` }
    }

    const data = await res.json() as { messages?: Array<{ timestamp?: number }> }
    const msgs = data.messages ?? []
    const lastMsgTs = msgs[0]?.timestamp
    const now = Date.now()
    const commsGapMs = lastMsgTs ? now - lastMsgTs : null

    // Flag team comms gap >6h as a finding
    const COMMS_GAP_THRESHOLD_MS = 6 * 60 * 60 * 1000
    if (commsGapMs !== null && commsGapMs > COMMS_GAP_THRESHOLD_MS) {
      const hoursAgo = Math.floor(commsGapMs / 3_600_000)
      return {
        probe: 'chat',
        ok: false,
        latencyMs,
        finding: `Team comms gap: last message was ${hoursAgo}h ago`,
        detail: `No chat activity in #general for ${hoursAgo}h — team may be siloed or blocked.`,
      }
    }

    const slow = latencyMs > SLOW_THRESHOLD_MS
    return {
      probe: 'chat',
      ok: !slow,
      latencyMs,
      finding: slow ? `Chat endpoint slow: ${latencyMs}ms` : undefined,
    }
  } catch (err) {
    return {
      probe: 'chat',
      ok: false,
      latencyMs: Date.now() - start,
      finding: `Chat probe failed: ${(err as Error).message}`,
    }
  }
}

// ── Reflection injection ───────────────────────────────────────────────────

function findingToReflection(finding: ProbeResult, agent: string): Parameters<typeof createReflection>[0] {
  const severity: 'low' | 'medium' | 'high' = finding.latencyMs > SLOW_THRESHOLD_MS && finding.ok === false ? 'high' : 'medium'
  return {
    pain: finding.finding ?? `Probe ${finding.probe} reported an issue`,
    impact: `Detected automatically by product observation probe — ${finding.probe} check failed or degraded`,
    evidence: [`probe:${finding.probe}:${finding.ok ? 'slow' : 'failed'}`, finding.detail ?? finding.finding ?? 'no detail'].filter(Boolean) as string[],
    went_well: 'Automated monitoring caught this before a human needed to investigate',
    suspected_why: `${finding.probe} endpoint is either degraded or a background condition is unresolved`,
    proposed_fix: `Investigate ${finding.probe} endpoint and resolve the underlying condition`,
    confidence: 6,
    role_type: 'infra',
    author: `product-observation:${agent}`,
    severity,
    tags: [`probe:${finding.probe}`, 'automated', 'product-observation'],
    metadata: {
      probe: finding.probe,
      latency_ms: finding.latencyMs,
      source: 'product-observation-source',
      agent,
    },
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Run product observation probes for an agent.
 *
 * Gating (all must be true to run):
 *   1. Agent shipped something in the last 4h
 *   2. Cooldown not active (30m since last run for this agent)
 *
 * Queue-empty check is the caller's responsibility (tickContinuityLoop).
 */
export async function runProductObservation(
  agent: string,
  opts?: { skipShipCheck?: boolean; skipCooldown?: boolean }
): Promise<ProductObservationResult> {
  const now = Date.now()

  // Cooldown gate
  if (!opts?.skipCooldown && isCoolingDown(agent, now)) {
    const key = `${KV_PREFIX}last_run:${agent}`
    const lastRun = Number(kvGet(key) ?? 0)
    const waitMin = Math.ceil((COOLDOWN_MS - (now - lastRun)) / 60_000)
    return { agent, probesRun: 0, findings: [], reflectionsCreated: 0, skipped: `cooldown active (${waitMin}m remaining)` }
  }

  // Recent ship gate
  if (!opts?.skipShipCheck) {
    const shipped = await agentShippedRecently(agent, now)
    if (!shipped) {
      return { agent, probesRun: 0, findings: [], reflectionsCreated: 0, skipped: 'no recent ship in last 4h' }
    }
  }

  // Record this run for cooldown tracking
  recordRun(agent, now)

  // Run all Phase 1 probes in parallel
  const results = await Promise.allSettled([
    runHealthProbe(),
    runAgentsProbe(),
    runTasksProbe(),
    runChatProbe(),
  ])

  const probeResults: ProbeResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    const names = ['health', 'agents', 'tasks', 'chat']
    return { probe: names[i] ?? String(i), ok: false, latencyMs: 0, finding: `Probe threw: ${(r.reason as Error).message}` }
  })

  // Only emit reflections for probes with findings (failed or slow)
  const withFindings = probeResults.filter(p => p.finding)
  let reflectionsCreated = 0

  for (const finding of withFindings) {
    try {
      const input = findingToReflection(finding, agent)
      const reflection = createReflection(input)
      await ingestReflection(reflection)
      reflectionsCreated++
    } catch (err) {
      console.warn(`[product-observation] failed to ingest reflection for ${finding.probe}:`, (err as Error).message)
    }
  }

  return {
    agent,
    probesRun: probeResults.length,
    findings: withFindings,
    reflectionsCreated,
  }
}
