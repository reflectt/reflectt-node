// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Cloud Integration Module
 *
 * Connects reflectt-node to Reflectt Cloud via @reflectt/host-agent SDK.
 * When REFLECTT_HOST_TOKEN is set, this module:
 *   1. Registers with the cloud on startup
 *   2. Sends periodic heartbeats with agent presence + task counts
 *   3. Syncs local task state to the cloud
 *
 * When env vars are not set, this module does nothing (graceful skip).
 */

import { presenceManager } from './presence.js'
import { getAgentRoles } from './assignment.js'
import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import { remapGitHubMentions } from './github-webhook-attribution.js'
import { slotManager } from './canvas-slots.js'
import { getDb } from './db.js'
import { getUsageSummary, getUsageByAgent, getUsageByModel, listCaps, checkCaps, getRoutingSuggestions, getCostForTaskId } from './usage-tracking.js'
import { listReflections } from './reflections.js'
import { listInsights } from './insights.js'
import { readFileSync, existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { REFLECTT_HOME } from './config.js'
import { getRequestMetrics } from './request-tracker.js'
import { listApprovalQueue, listAgentEvents, listAgentRuns, type AgentRun } from './agent-runs.js'
import { getUnpushedTrustEvents, markTrustEventsPushed } from './trust-events.js'

/**
 * Docker identity guard: detect when a container has inherited cloud
 * credentials from a host volume mount. Without explicit opt-in, skip
 * cloud integration to prevent the container from silently appearing
 * as the host team.
 */
function isDockerIdentityInherited(fileConfig: ReturnType<typeof loadCloudConfigFromFile>): boolean {
  // Only applies inside Docker
  const isDocker = existsSync('/.dockerenv') || process.env.REFLECTT_HOME === '/data'
  if (!isDocker) return false

  // If credentials come from env vars (not config.json), the user explicitly set them — allow
  if (process.env.REFLECTT_HOST_TOKEN || process.env.REFLECTT_HOST_ID) return false

  // If config.json has cloud credentials and user didn't opt in, flag it
  if (fileConfig?.hostId && fileConfig?.credential) {
    if (process.env.REFLECTT_INHERIT_IDENTITY === '1' || process.env.REFLECTT_INHERIT_IDENTITY === 'true') {
      console.log(`☁️  Docker identity guard: inheriting identity from config.json (REFLECTT_INHERIT_IDENTITY=1)`)
      console.log(`   Host: ${fileConfig.hostName || 'unnamed'} (hostId: ${fileConfig.hostId})`)
      return false
    }
    return true
  }

  return false
}

// ---- Types matching @reflectt/host-agent ----
// We inline the types to avoid a build-time dependency on the monorepo package.
// The cloud API contract is the source of truth.

interface AgentInfo {
  name: string
  status: 'active' | 'idle' | 'offline' | 'waiting'
  currentTask?: string
  lastSeen?: number
  waitingFor?: string   // populated when status === 'waiting'
  waitingTaskId?: string
  thought?: string      // agent's current thought/expression — shown on canvas as AI-native content
}

interface TaskStateEntry {
  id: string
  title: string
  status: string
  assignee?: string
  priority?: string
  updatedAt?: number
  createdAt?: number
}

interface CloudConfig {
  cloudUrl: string
  token: string
  hostName: string
  hostType: string
  heartbeatIntervalMs: number
  taskSyncIntervalMs: number
  capabilities: string[]
}

interface CloudState {
  hostId: string | null
  credential: string | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  taskSyncTimer: ReturnType<typeof setInterval> | null
  chatSyncTimer: ReturnType<typeof setInterval> | null
  canvasSyncTimer: ReturnType<typeof setInterval> | null
  approvalSyncTimer: ReturnType<typeof setInterval> | null
  runEventSyncTimer: ReturnType<typeof setInterval> | null
  usageSyncTimer: ReturnType<typeof setInterval> | null
  reflectionSyncTimer: ReturnType<typeof setInterval> | null
  contextSyncTimer: ReturnType<typeof setInterval> | null
  heartbeatCount: number
  lastHeartbeat: number | null
  lastTaskSync: number | null
  lastChatSync: number | null
  lastCanvasSync: number | null
  lastUsageSync: number | null
  errors: number
  running: boolean
  startedAt: number
}

const DEFAULT_HEARTBEAT_MS = 30_000
const DEFAULT_TASK_SYNC_MS = 60_000
const DEFAULT_CHAT_SYNC_MS = 5_000
const DEFAULT_CHAT_SYNC_MIN_INTERVAL_MS = 1_500
const DEFAULT_CHAT_SYNC_MAX_BACKOFF_MS = 30_000

// Adaptive sync: idle detection + interval scaling
const IDLE_THRESHOLD_MS = 2 * 60_000 // 2 min without activity → idle mode
const IDLE_SYNC_MS = 60_000           // Slow sync when idle (60s)
const ACTIVE_CANVAS_SYNC_MS = 5_000   // Fast canvas sync when active
const ACTIVE_USAGE_SYNC_MS = 15_000   // Fast usage sync when active
const ACTIVE_CONTEXT_SYNC_MS = 30 * 60_000  // 30 min proactive context sync when active
const IDLE_CONTEXT_SYNC_MS = 60 * 60_000    // 60 min proactive context sync when idle
let lastActivityAt = Date.now()

/** Mark recent activity (call from event handlers) */
export function markCloudActivity(): void {
  lastActivityAt = Date.now()
}

/** Request immediate canvas sync to cloud (called on canvas_render events) */
export function requestImmediateCanvasSync(): void {
  markCloudActivity()
  // syncCanvas is module-scoped; we use a deferred call pattern
  if (immediateSyncFn) immediateSyncFn()
}

let immediateSyncFn: (() => void) | null = null
export function _registerImmediateSync(fn: () => void): void {
  immediateSyncFn = fn
}

// ── canvas_push relay buffer ─────────────────────────────────────────────────
// canvas_push events (utterance, work_released, approval_requested) are emitted
// on the node event bus but never reached the cloud SSE stream. This buffer
// collects them and flushes them in the next syncCanvas POST as push_events[].
// The cloud then broadcasts each as a `canvas_push` SSE event to all subscribers.
const MAX_PENDING_PUSH_EVENTS = 20
const pendingPushEvents: Array<Record<string, unknown>> = []

/** Queue a canvas_push event for relay to cloud in the next sync cycle. */
export function queueCanvasPushEvent(event: Record<string, unknown>): void {
  pendingPushEvents.push({ ...event, _queuedAt: Date.now() })
  // Cap buffer to prevent unbounded growth between syncs
  while (pendingPushEvents.length > MAX_PENDING_PUSH_EVENTS) pendingPushEvents.shift()
  // Trigger immediate sync so the event reaches browsers quickly
  requestImmediateCanvasSync()
}

/** Check if the system is idle */
function isIdle(): boolean {
  return Date.now() - lastActivityAt > IDLE_THRESHOLD_MS
}

// ── Connection lifecycle tracking ──────────────────────────────────
interface ConnectionEvent {
  type: 'connected' | 'disconnected' | 'reconnected' | 'error' | 'heartbeat_failed' | 'heartbeat_recovered'
  timestamp: number
  reason?: string
  errorCount?: number
}

const MAX_CONNECTION_EVENTS = 100
const connectionEvents: ConnectionEvent[] = []

function logConnectionEvent(event: ConnectionEvent): void {
  connectionEvents.push(event)
  if (connectionEvents.length > MAX_CONNECTION_EVENTS) {
    connectionEvents.splice(0, connectionEvents.length - MAX_CONNECTION_EVENTS)
  }
}

/** Get connection lifecycle events (most recent first) */
export function getConnectionEvents(limit = 50): ConnectionEvent[] {
  return connectionEvents.slice(-limit).reverse()
}

/** Get connection health summary */
export function getConnectionHealth() {
  const now = Date.now()
  const last60m = connectionEvents.filter(e => now - e.timestamp < 60 * 60_000)
  const disconnects = last60m.filter(e => e.type === 'disconnected')
  const errors = last60m.filter(e => e.type === 'error' || e.type === 'heartbeat_failed')
  const reconnects = last60m.filter(e => e.type === 'reconnected' || e.type === 'heartbeat_recovered')

  const lastDisconnect = disconnects[disconnects.length - 1] || null
  const lastError = errors[errors.length - 1] || null
  const lastConnect = connectionEvents.filter(e => e.type === 'connected' || e.type === 'reconnected').pop() || null

  return {
    status: state.running && state.heartbeatCount > 0 ? 'connected' : state.errors > 0 ? 'degraded' : 'disconnected',
    uptimeMs: state.running ? now - state.startedAt : 0,
    heartbeatCount: state.heartbeatCount,
    consecutiveErrors: state.errors,
    rolling60m: {
      disconnects: disconnects.length,
      errors: errors.length,
      reconnects: reconnects.length,
    },
    lastConnect: lastConnect?.timestamp || null,
    lastDisconnect: lastDisconnect?.timestamp || null,
    lastDisconnectReason: lastDisconnect?.reason || null,
    lastError: lastError?.timestamp || null,
    lastErrorReason: lastError?.reason || null,
    totalEventsLogged: connectionEvents.length,
  }
}

let config: CloudConfig | null = null
let state: CloudState = {
  hostId: null,
  credential: null,
  heartbeatTimer: null,
  taskSyncTimer: null,
  chatSyncTimer: null,
  canvasSyncTimer: null,
  approvalSyncTimer: null,
  runEventSyncTimer: null,
  usageSyncTimer: null,
  reflectionSyncTimer: null,
  contextSyncTimer: null,
  heartbeatCount: 0,
  lastHeartbeat: null,
  lastTaskSync: null,
  lastChatSync: null,
  lastCanvasSync: null,
  lastUsageSync: null,
  errors: 0,
  running: false,
  startedAt: Date.now(),
}
let configWatcher: FSWatcher | null = null

/**
 * Load cloud config from ~/.reflectt/config.json (written by `reflectt host connect`)
 */
function loadCloudConfigFromFile(): { cloudUrl?: string; hostId?: string; credential?: string; hostName?: string; hostType?: string } | null {
  try {
    const configPath = join(REFLECTT_HOME, 'config.json')
    if (!existsSync(configPath)) return null
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!config?.cloud) return null
    return {
      cloudUrl: config.cloud.cloudUrl,
      hostId: config.cloud.hostId,
      credential: config.cloud.credential,
      hostName: config.cloud.hostName,
      hostType: config.cloud.hostType,
    }
  } catch {
    return null
  }
}

/**
 * Check if cloud integration is configured
 */
export function isCloudConfigured(): boolean {
  // Check env vars first
  if (process.env.REFLECTT_HOST_TOKEN) return true
  if (process.env.REFLECTT_HOST_ID && process.env.REFLECTT_HOST_CREDENTIAL) return true
  // Check config.json (written by `reflectt host connect`)
  const fileConfig = loadCloudConfigFromFile()
  return Boolean(fileConfig?.hostId && fileConfig?.credential)
}

/**
 * Get current cloud connection status
 */
export function getCloudStatus() {
  const configured = isCloudConfigured()
  const registered = state.hostId !== null
  const connected = registered && state.running && state.heartbeatCount > 0

  // Derive a user-friendly connection phase for the UI
  let phase: 'unconfigured' | 'configured' | 'registering' | 'connected' | 'error'
  if (!configured) phase = 'unconfigured'
  else if (state.errors > 0 && !connected) phase = 'error'
  else if (!registered) phase = 'registering'
  else if (!connected) phase = 'configured'
  else phase = 'connected'

  // Sync health: count dirty/pending records
  let dirtyTaskCount = 0
  try {
    const db = getDb()
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM sync_ledger WHERE record_type='task' AND (cloud_synced_at IS NULL OR cloud_synced_at < local_updated_at OR sync_status != 'synced')",
    ).get() as { cnt: number }
    dirtyTaskCount = row.cnt
  } catch { /* DB may not be ready */ }

  return {
    configured,
    registered,
    connected,
    phase,
    hostId: state.hostId,
    running: state.running,
    heartbeatCount: state.heartbeatCount,
    lastHeartbeat: state.lastHeartbeat,
    lastTaskSync: state.lastTaskSync,
    lastChatSync: state.lastChatSync,
    lastCanvasSync: state.lastCanvasSync,
    lastUsageSync: state.lastUsageSync,
    usageSyncErrors,
    errors: state.errors,
    uptimeMs: state.running ? Date.now() - state.startedAt : 0,
    syncHealth: {
      dirtyTaskCount,
      healthy: dirtyTaskCount < 50,
    },
  }
}

/**
 * Initialize and start cloud integration.
 * Call this after the server is listening.
 */
export async function startCloudIntegration(): Promise<void> {
  if (!isCloudConfigured()) {
    console.log('☁️  Cloud integration: skipped (REFLECTT_HOST_TOKEN not set)')
    return
  }

  // Load from env vars first, then fall back to config.json
  const fileConfig = loadCloudConfigFromFile()

  // Docker identity guard: refuse to connect with inherited credentials
  if (isDockerIdentityInherited(fileConfig)) {
    console.warn('')
    console.warn('⚠️  Docker identity guard: found cloud credentials in config.json')
    console.warn(`   This container would connect as "${fileConfig?.hostName || 'unknown'}" (hostId: ${fileConfig?.hostId})`)
    console.warn('   This likely means you mounted a host directory containing existing team data.')
    console.warn('')
    console.warn('   To fix (pick one):')
    console.warn('     • Set REFLECTT_HOST_ID and REFLECTT_HOST_CREDENTIAL env vars (recommended for Docker)')
    console.warn('     • Set REFLECTT_INHERIT_IDENTITY=1 to trust config.json credentials')
    console.warn('     • Use a fresh named volume for a clean identity')
    console.warn('')
    console.warn('   Cloud integration skipped to prevent identity collision.')
    console.warn('')
    return
  }

  config = {
    cloudUrl: (process.env.REFLECTT_CLOUD_URL || fileConfig?.cloudUrl || 'https://api.reflectt.ai').replace(/\/+$/, ''),
    token: process.env.REFLECTT_HOST_TOKEN || '',
    hostName: process.env.REFLECTT_HOST_NAME || fileConfig?.hostName || 'unnamed-host',
    hostType: process.env.REFLECTT_HOST_TYPE || fileConfig?.hostType || 'openclaw',
    heartbeatIntervalMs: Number(process.env.REFLECTT_HEARTBEAT_MS) || DEFAULT_HEARTBEAT_MS,
    taskSyncIntervalMs: Number(process.env.REFLECTT_TASK_SYNC_MS) || DEFAULT_TASK_SYNC_MS,
    capabilities: (process.env.REFLECTT_HOST_CAPABILITIES || 'tasks,chat,presence').split(',').map(s => s.trim()),
  }

  console.log(`☁️  Cloud integration: connecting to ${config.cloudUrl}`)
  console.log(`   Host: ${config.hostName} (${config.hostType})`)
  if (fileConfig?.hostId) console.log(`   Source: config.json (auto-connect from host connect)`)

  // Check if we already have a persisted host ID + credential (env or config.json)
  const persistedHostId = process.env.REFLECTT_HOST_ID || fileConfig?.hostId
  const persistedCredential = process.env.REFLECTT_HOST_CREDENTIAL || fileConfig?.credential

  if (persistedHostId && persistedCredential) {
    state.hostId = persistedHostId
    state.credential = persistedCredential
    console.log(`   ✅ Using persisted credential (hostId: ${state.hostId})`)
  } else {
    // Register with cloud via /api/hosts/claim
    // Cloud API expects: { joinToken, name, capabilities? }
    // Cloud API returns: { host: { id, ... }, credential: { token, revealPolicy } }
    try {
      const result = await cloudPost<{ host: { id: string }; credential: { token: string } }>('/api/hosts/claim', {
        joinToken: config.token,
        name: config.hostName,
        capabilities: config.capabilities,
      })

      if (result.data?.host?.id && result.data?.credential?.token) {
        state.hostId = result.data.host.id
        state.credential = result.data.credential.token
        console.log(`   ✅ Registered (hostId: ${state.hostId})`)
      } else {
        console.warn(`   ⚠ Registration failed: ${result.error || 'unexpected response shape'}`)
        state.errors++
        return
      }
    } catch (err: any) {
      console.warn(`   ⚠ Registration failed: ${err?.message || 'network error'}`)
      state.errors++
      return
    }
  }

  // Start loops
  state.running = true
  state.startedAt = Date.now()
  logConnectionEvent({ type: 'connected', timestamp: Date.now(), reason: `host ${config.hostName} → ${config.cloudUrl}` })

  // Immediate first heartbeat
  sendHeartbeat().catch(() => {})

  state.heartbeatTimer = setInterval(() => {
    sendHeartbeat().catch(() => {})
    pollAndProcessCommands().catch(() => {}) // Piggyback on heartbeat tick
  }, config.heartbeatIntervalMs)

  state.taskSyncTimer = setInterval(() => {
    syncTasks().catch(() => {})
  }, config.taskSyncIntervalMs)

  // Chat sync — event-driven with adaptive polling fallback
  // When active: 5s poll. When idle: 60s poll. Events always trigger immediate sync.
  const chatSyncActiveMs = Number(process.env.REFLECTT_CHAT_SYNC_MS) || DEFAULT_CHAT_SYNC_MS
  let lastChatPollAt = 0
  requestChatSync('startup').catch(() => {})
  state.chatSyncTimer = setInterval(() => {
    const now = Date.now()
    const interval = isIdle() ? IDLE_SYNC_MS : chatSyncActiveMs
    if (now - lastChatPollAt < interval) return
    lastChatPollAt = now
    requestChatSync('interval').catch(() => {})
  }, chatSyncActiveMs)

  // Event-driven: sync immediately when new messages arrive (debounced 500ms)
  let chatSyncDebounce: ReturnType<typeof setTimeout> | null = null
  chatManager.subscribe(() => {
    if (!state.running) return
    markCloudActivity() // Mark as active on new chat
    if (chatSyncDebounce) clearTimeout(chatSyncDebounce)
    chatSyncDebounce = setTimeout(() => {
      requestChatSync('event').catch(() => {})
    }, 500)
  })

  // Task changes also mark activity (ensures burst mode on task updates)
  taskManager.subscribe(() => {
    if (!state.running) return
    markCloudActivity()
  })

  // Canvas slot updates mark activity (ensures burst mode on canvas changes)
  slotManager.subscribe(() => {
    if (!state.running) return
    markCloudActivity()
  })

  // Canvas sync — adaptive: 5s when active, 60s when idle
  // Uses a single 5s tick that skips when idle (unless enough time has passed)
  let lastCanvasSyncAt = 0
  _registerImmediateSync(() => {
    syncCanvas().catch(() => {})
    lastCanvasSyncAt = Date.now()
  })
  syncCanvas().catch(() => {})
  state.canvasSyncTimer = setInterval(() => {
    const now = Date.now()
    const interval = isIdle() ? IDLE_SYNC_MS : ACTIVE_CANVAS_SYNC_MS
    if (now - lastCanvasSyncAt < interval) return
    lastCanvasSyncAt = now
    syncCanvas().catch(() => {})
  }, ACTIVE_CANVAS_SYNC_MS)

  // Run approval sync — every 10s
  syncRunApprovals().catch(() => {})
  state.approvalSyncTimer = setInterval(() => {
    syncRunApprovals().catch(() => {})
    pollAgentDecisions().catch(() => {}) // poll queued relay decisions (NAT-behind hosts)
    pollCanvasQueryRelay().catch(() => {}) // poll canvas/query relay queue (NAT-behind hosts)
  }, APPROVAL_SYNC_INTERVAL_MS)

  // Run event sync — every 5s
  syncRunEvents().catch(() => {})
  state.runEventSyncTimer = setInterval(() => {
    syncRunEvents().catch(() => {})
  }, RUN_EVENT_SYNC_INTERVAL_MS)

  // Agent runs sync — every 30s (pushes run records to cloud action_runs table)
  syncAgentRuns().catch(() => {})
  setInterval(() => {
    syncAgentRuns().catch(() => {})
  }, 30_000)

  // Trust event sync — every 60s (pushes unpushed trust signals to cloud)
  syncTrustEvents().catch(() => {})
  setInterval(() => {
    syncTrustEvents().catch(() => {})
  }, 60_000)

  // Usage sync — adaptive: 15s when active, 60s when idle
  let lastUsageSyncAt = 0
  syncUsage().catch(() => {})
  state.usageSyncTimer = setInterval(() => {
    const now = Date.now()
    const interval = isIdle() ? IDLE_SYNC_MS : ACTIVE_USAGE_SYNC_MS
    if (now - lastUsageSyncAt < interval) return
    lastUsageSyncAt = now
    syncUsage().catch(() => {})
  }, ACTIVE_USAGE_SYNC_MS)

  // Reflection + Insight sync — 60s interval (less frequent than tasks)
  let lastReflectionSyncAt = 0
  syncReflectionsToCloud().catch(() => {})
  syncInsightsToCloud().catch(() => {})
  state.reflectionSyncTimer = setInterval(() => {
    const now = Date.now()
    if (now - lastReflectionSyncAt < REFLECTION_SYNC_INTERVAL_MS) return
    lastReflectionSyncAt = now
    syncReflectionsToCloud().catch(() => {})
    syncInsightsToCloud().catch(() => {})
  }, REFLECTION_SYNC_INTERVAL_MS)

  // Proactive context sync — push context for all agents periodically.
  // Prevents stale context page when cloud stops issuing context_sync commands.
  // 30 min when active, 60 min when idle.
  let lastContextSyncAt = 0
  proactiveContextSync().catch(() => {})
  state.contextSyncTimer = setInterval(() => {
    const now = Date.now()
    const interval = isIdle() ? IDLE_CONTEXT_SYNC_MS : ACTIVE_CONTEXT_SYNC_MS
    if (now - lastContextSyncAt < interval) return
    lastContextSyncAt = now
    proactiveContextSync().catch(() => {})
  }, ACTIVE_CONTEXT_SYNC_MS)

  // Command polling — adaptive: 10s active, 60s idle
  // Uses the same tick as canvas (5s) with interval gate
  pollAndProcessCommands().catch(() => {})

  console.log(`   ✅ Heartbeat every ${config.heartbeatIntervalMs / 1000}s, task sync every ${config.taskSyncIntervalMs / 1000}s`)
  console.log(`   📊 Adaptive sync: chat/canvas/usage ${chatSyncActiveMs / 1000}s active → ${IDLE_SYNC_MS / 1000}s idle (idle after ${IDLE_THRESHOLD_MS / 1000}s)`)
  console.log(`   📬 Command polling: ${COMMAND_POLL_ACTIVE_MS / 1000}s active → ${COMMAND_POLL_IDLE_MS / 1000}s idle`)
}

/**
 * Stop cloud integration (call on shutdown)
 */
/**
 * Watch config.json for changes and auto-start cloud integration.
 * Enables zero-restart enrollment: agent writes config.json via
 * `reflectt host connect`, running server auto-detects and connects.
 */
export function watchConfigForCloudChanges(): void {
  if (configWatcher) return

  try {
    let debounce: ReturnType<typeof setTimeout> | null = null

    configWatcher = watch(join(REFLECTT_HOME), { persistent: false }, (_event, filename) => {
      if (filename !== 'config.json') return
      if (debounce) clearTimeout(debounce)

      debounce = setTimeout(async () => {
        debounce = null
        if (state.running) return // already connected, skip

        const fileConfig = loadCloudConfigFromFile()
        if (!fileConfig?.hostId || !fileConfig?.credential) return

        console.log('☁️  Config change detected — auto-starting cloud integration...')
        try {
          await startCloudIntegration()
        } catch (err: any) {
          console.warn(`☁️  Cloud auto-start failed: ${err?.message || err}`)
        }
      }, 1000)
    })

    console.log(`☁️  Watching ${REFLECTT_HOME}/config.json for cloud config changes`)
  } catch (err: any) {
    console.warn(`☁️  Config watcher setup failed: ${err?.message || err}`)
  }
}

export function stopConfigWatcher(): void {
  if (configWatcher) {
    configWatcher.close()
    configWatcher = null
  }
}

/**
 * Proactively push context snapshots for all known agents to the cloud.
 * Runs on a timer so the context page stays fresh even if the cloud never
 * issues a context_sync command (e.g., new agents, post-restart, cloud lag).
 */
async function proactiveContextSync(): Promise<void> {
  if (!state.hostId || !config || !state.running) return

  const agents = getAgents()
  if (agents.length === 0) return

  const port = process.env.REFLECTT_NODE_PORT || '4445'

  for (const agentInfo of agents) {
    const agent = agentInfo.name
    try {
      const localRes = await fetch(`http://127.0.0.1:${port}/context/inject/${encodeURIComponent(agent)}`)
      if (!localRes.ok) {
        console.warn(`☁️  [ContextSync] Local context fetch failed for ${agent}: ${localRes.status}`)
        continue
      }
      const contextData = await localRes.json() as Record<string, unknown>
      const computedAt = (typeof contextData.computed_at === 'number' && contextData.computed_at > 0)
        ? contextData.computed_at
        : Date.now()

      const result = await cloudPost(`/api/hosts/${state.hostId}/context/sync`, {
        agent,
        computed_at: computedAt,
        budgets: contextData.budgets || { totalTokens: 0, layers: {} },
        autosummary_enabled: Boolean(contextData.autosummary_enabled),
        layers: contextData.layers || {},
      })

      if (result.success) {
        console.log(`☁️  [ContextSync] Proactive sync OK for ${agent}`)
      } else {
        console.warn(`☁️  [ContextSync] Proactive sync failed for ${agent}: ${result.error}`)
      }
    } catch (err: any) {
      console.warn(`☁️  [ContextSync] Proactive sync error for ${agent}: ${err?.message}`)
    }
  }
}

export function stopCloudIntegration(): void {
  state.running = false
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer)
    state.heartbeatTimer = null
  }
  if (state.taskSyncTimer) {
    clearInterval(state.taskSyncTimer)
    state.taskSyncTimer = null
  }
  if (state.chatSyncTimer) {
    clearInterval(state.chatSyncTimer)
    state.chatSyncTimer = null
  }
  if (state.canvasSyncTimer) {
    clearInterval(state.canvasSyncTimer)
    state.canvasSyncTimer = null
  }
  if (state.approvalSyncTimer) {
    clearInterval(state.approvalSyncTimer)
    state.approvalSyncTimer = null
  }
  if (state.runEventSyncTimer) {
    clearInterval(state.runEventSyncTimer)
    state.runEventSyncTimer = null
  }
  if (state.usageSyncTimer) {
    clearInterval(state.usageSyncTimer)
    state.usageSyncTimer = null
  }
  if (state.reflectionSyncTimer) {
    clearInterval(state.reflectionSyncTimer)
    state.reflectionSyncTimer = null
  }
  if (state.contextSyncTimer) {
    clearInterval(state.contextSyncTimer)
    state.contextSyncTimer = null
  }
  logConnectionEvent({ type: 'disconnected', timestamp: Date.now(), reason: 'shutdown' })
  console.log('☁️  Cloud integration: stopped')

  // Clear canvas state on Fly so subscribers see an empty room, not ghost agents
  if (state.hostId && state.credential && config) {
    const clearUrl = `${config.cloudUrl}/api/hosts/${state.hostId}/canvas/clear`
    fetch(clearUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.credential}`,
      },
    }).catch(() => { /* best-effort; already shutting down */ })
  }
}

// ---- Data providers ----

function getAgents(): AgentInfo[] {
  const presences = presenceManager.getAllPresence()
  const presenceMap = new Map(presences.map(p => [p.agent, p]))

  // Include ALL registered agents (from TEAM-ROLES.yaml), not just those with presence
  const roles = getAgentRoles()
  const agents: AgentInfo[] = []
  const seen = new Set<string>()

  for (const role of roles) {
    seen.add(role.name)
    const p = presenceMap.get(role.name)
    agents.push({
      name: role.name,
      status: p
        ? (p.status === 'working' || p.status === 'reviewing' ? 'active' as const
          : p.status === 'waiting' ? 'waiting' as const
          : p.status === 'offline' ? 'offline' as const
          : 'idle' as const)
        : 'offline' as const,
      currentTask: p?.task,
      lastSeen: p?.lastUpdate,
      ...(p?.status === 'waiting' && p.waiting ? {
        waitingFor: p.waiting.waitingFor,
        waitingTaskId: p.waiting.taskId,
      } : {}),
      ...(p?.thought ? { thought: p.thought } : {}),
    })
  }

  // Also include any presence entries not in TEAM-ROLES (shouldn't happen, but defensive)
  for (const p of presences) {
    if (!seen.has(p.agent)) {
      agents.push({
        name: p.agent,
        status: p.status === 'working' || p.status === 'reviewing' ? 'active' as const
          : p.status === 'waiting' ? 'waiting' as const
          : p.status === 'offline' ? 'offline' as const
          : 'idle' as const,
        currentTask: p.task,
        lastSeen: p.lastUpdate,
        ...(p.status === 'waiting' && p.waiting ? {
          waitingFor: p.waiting.waitingFor,
          waitingTaskId: p.waiting.taskId,
        } : {}),
      })
    }
  }

  return agents
}

function getTasks(): TaskStateEntry[] {
  const tasks = taskManager.listTasks({})
  return tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    assignee: t.assignee,
    priority: t.priority,
    updatedAt: t.updatedAt || t.createdAt,
    createdAt: t.createdAt,
  }))
}

// ---- Cloud communication ----

async function sendHeartbeat(): Promise<void> {
  if (!state.hostId || !config) return

  const agents = getAgents()
  const tasks = getTasks()
  const doingTasks = tasks.filter(t => t.status === 'doing')

  // ── Slow task detection ───────────────────────────────────────────────
  // Include tasks that have been doing >4h with no activity (slow-flagged).
  // These are NOT explicitly blocked — they're just stale.
  const SLOW_HEARTBEAT_MS = 4 * 60 * 60 * 1000
  const nowTs = Date.now()
  const slowTasks = doingTasks.reduce<Array<{
    id: string; title: string; assignee?: string; priority?: string;
    slowSinceMs: number; slowSinceHours: number; lastActivityAt: number
  }>>((acc, t) => {
    const comments = taskManager.getTaskComments(t.id)
    const lastComment = comments.length > 0 ? comments[comments.length - 1] : null
    const lastActivityAt = lastComment?.timestamp ?? t.updatedAt ?? t.createdAt ?? nowTs
    const age = nowTs - lastActivityAt
    if (age > SLOW_HEARTBEAT_MS) {
      acc.push({
        id: t.id,
        title: t.title,
        assignee: t.assignee || undefined,
        priority: t.priority || undefined,
        slowSinceMs: age,
        slowSinceHours: Math.round(age / 36_000) / 100,
        lastActivityAt: lastActivityAt,
      })
    }
    return acc
  }, [])

  // Cloud API: POST /api/hosts/:hostId/heartbeat
  // Expects: { status, agents?, activeTasks? }
  // Host is "online" if the server is running and responding.
  // "degraded" only if there are actual health issues (e.g., DB errors, high error rate).
  // Idle agents are normal — not a degraded state.
  const hostStatus = 'online' as const

  const result = await cloudPost(`/api/hosts/${state.hostId}/heartbeat`, {
    contractVersion: 'host-heartbeat.v1',
    status: hostStatus,
    timestamp: Date.now(),
    agents: agents.map(a => {
      const agentAliases = [a.name]
      const todoCount = tasks.filter(t => t.status === 'todo' && agentAliases.includes(t.assignee || '')).length
      const doingCount = tasks.filter(t => t.status === 'doing' && agentAliases.includes(t.assignee || '')).length
      const blockedCount = tasks.filter(t => t.status === 'blocked' && agentAliases.includes(t.assignee || '')).length
      return {
        id: a.name,
        name: a.name,
        status: a.status,
        currentTaskId: a.currentTask || undefined,
        lastSeenAt: a.lastSeen || Date.now(),
        taskCounts: { todo: todoCount, doing: doingCount, blocked: blockedCount },
        ...(a.status === 'waiting' ? {
          waitingFor: a.waitingFor,
          waitingTaskId: a.waitingTaskId,
        } : {}),
      }
    }),
    activeTasks: doingTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assignee || undefined,
      priority: t.priority || undefined,
      updatedAt: t.updatedAt || Date.now(),
    })),
    slowTasks: slowTasks.length > 0 ? slowTasks : undefined,
    metrics: (() => {
      const m = getRequestMetrics()
      return {
        totalRequests: m.total,
        totalErrors: m.errors,
        rps: m.rps,
        rolling: {
          requests: m.rolling.requests,
          errors: m.rolling.errors,
          errorRate: m.rolling.errorRate,
          windowMinutes: m.rolling.windowMinutes,
        },
      }
    })(),
    // requestCounts maps to HostRequestCountsV1 contract (PR #716, reflectt-cloud)
    requestCounts: (() => {
      const m = getRequestMetrics()
      const windowMs = m.rolling.windowMinutes * 60 * 1000
      const errorRatePct = m.rolling.requests > 0
        ? (m.rolling.errors / m.rolling.requests) * 100
        : 0
      return {
        total: m.rolling.requests,
        errors: m.rolling.errors,
        windowMs,
        errorRatePct: Math.round(errorRatePct * 100) / 100,
      }
    })(),
    source: {
      hostId: state.hostId,
      hostName: config.hostName,
      hostType: config.hostType,
      uptimeMs: Date.now() - state.startedAt,
    },
  })

  if (result.success || result.data) {
    state.lastHeartbeat = Date.now()
    state.heartbeatCount++
    // Reset consecutive error count on success
    if (state.errors > 0) {
      console.log(`☁️  Heartbeat recovered after ${state.errors} errors`)
      logConnectionEvent({ type: 'heartbeat_recovered', timestamp: Date.now(), errorCount: state.errors })
      state.errors = 0
    }
  } else {
    state.errors++
    logConnectionEvent({ type: 'heartbeat_failed', timestamp: Date.now(), reason: result.error || 'unknown', errorCount: state.errors })
    if (state.errors <= 5 || state.errors % 20 === 0) {
      console.warn(`☁️  Heartbeat failed (${state.errors} consecutive): ${result.error}`)
    }
  }
}

interface DirtyTaskRow {
  id: string
  title: string
  status: string
  assignee: string | undefined
  priority: string | undefined
  local_updated_at: number
}

interface LedgerTaskRow {
  record_id: string
  local_updated_at: number
}

function refreshTaskLedger(tasks: TaskStateEntry[]): void {
  const db = getDb()
  const snapshotIds = new Set(tasks.map((task) => task.id))

  const upsert = db.prepare(`
    INSERT INTO sync_ledger (
      record_type,
      record_id,
      local_updated_at,
      cloud_synced_at,
      sync_status,
      attempt_count,
      last_error
    ) VALUES ('task', ?, ?, NULL, 'pending', 0, NULL)
    ON CONFLICT(record_type, record_id) DO UPDATE SET
      local_updated_at = excluded.local_updated_at,
      sync_status = CASE
        WHEN sync_ledger.local_updated_at = excluded.local_updated_at THEN sync_ledger.sync_status
        ELSE 'pending'
      END,
      last_error = CASE
        WHEN sync_ledger.local_updated_at = excluded.local_updated_at THEN sync_ledger.last_error
        ELSE NULL
      END
  `)

  const listTaskLedgerIds = db.prepare(`
    SELECT record_id
    FROM sync_ledger
    WHERE record_type = 'task'
  `)

  const deleteLedgerRow = db.prepare(`
    DELETE FROM sync_ledger
    WHERE record_type = 'task' AND record_id = ?
  `)

  const tx = db.transaction((snapshot: TaskStateEntry[]) => {
    for (const task of snapshot) {
      const updatedAt = Number(task.updatedAt || Date.now())
      upsert.run(task.id, updatedAt)
    }

    const ledgerIds = listTaskLedgerIds.all() as Array<{ record_id: string }>
    for (const row of ledgerIds) {
      if (!snapshotIds.has(row.record_id)) {
        deleteLedgerRow.run(row.record_id)
      }
    }
  })

  tx(tasks)
}

function getDirtyTaskLedgerRows(limit = 200): LedgerTaskRow[] {
  const db = getDb()
  return db.prepare(`
    SELECT record_id, local_updated_at
    FROM sync_ledger
    WHERE record_type = 'task'
      AND (
        cloud_synced_at IS NULL
        OR cloud_synced_at < local_updated_at
        OR sync_status != 'synced'
      )
    ORDER BY local_updated_at ASC
    LIMIT ?
  `).all(limit) as LedgerTaskRow[]
}

function markTaskRowsSynced(rows: DirtyTaskRow[], syncedAt: number): void {
  if (rows.length === 0) return
  const db = getDb()
  const markSynced = db.prepare(`
    UPDATE sync_ledger
    SET cloud_synced_at = ?,
        sync_status = 'synced',
        attempt_count = attempt_count + 1,
        last_error = NULL
    WHERE record_type = 'task'
      AND record_id = ?
      AND local_updated_at = ?
  `)

  const tx = db.transaction((items: DirtyTaskRow[]) => {
    for (const row of items) {
      markSynced.run(syncedAt, row.id, row.local_updated_at)
    }
  })

  tx(rows)
}

function markTaskRowsErrored(rows: DirtyTaskRow[], errorMessage: string): void {
  if (rows.length === 0) return
  const db = getDb()
  const markError = db.prepare(`
    UPDATE sync_ledger
    SET sync_status = 'error',
        attempt_count = attempt_count + 1,
        last_error = ?
    WHERE record_type = 'task'
      AND record_id = ?
      AND local_updated_at = ?
  `)

  const tx = db.transaction((items: DirtyTaskRow[]) => {
    for (const row of items) {
      markError.run(errorMessage, row.id, row.local_updated_at)
    }
  })

  tx(rows)
}

async function syncTasks(): Promise<void> {
  if (!state.hostId || !config) return

  const tasksSnapshot = getTasks()
  refreshTaskLedger(tasksSnapshot)

  const taskById = new Map(tasksSnapshot.map((task) => [task.id, task]))
  const dirtyLedgerRows = getDirtyTaskLedgerRows()

  const dirtyRows: DirtyTaskRow[] = dirtyLedgerRows
    .map((ledgerRow) => {
      const task = taskById.get(ledgerRow.record_id)
      if (!task) return null
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        assignee: task.assignee,
        priority: task.priority,
        local_updated_at: ledgerRow.local_updated_at,
      }
    })
    .filter((row): row is DirtyTaskRow => row !== null)

  if (dirtyRows.length === 0) {
    state.lastTaskSync = Date.now()
    return
  }

  // Alert when dirty count is high (potential sync backlog)
  const DIRTY_ALERT_THRESHOLD = 50
  if (dirtyRows.length >= DIRTY_ALERT_THRESHOLD) {
    console.warn(`[cloud-sync] High dirty task count: ${dirtyRows.length} records pending sync (threshold: ${DIRTY_ALERT_THRESHOLD})`)
  }

  const tasksPayload = dirtyRows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    assignee: row.assignee ?? undefined,
    priority: row.priority ?? undefined,
    updatedAt: new Date(row.local_updated_at).toISOString(),
  }))

  const result = await cloudPost(`/api/hosts/${state.hostId}/tasks/sync`, {
    tasks: tasksPayload,
  })

  if (result.success || result.data) {
    const syncedAt = Date.now()
    markTaskRowsSynced(dirtyRows, syncedAt)
    state.lastTaskSync = syncedAt
  } else {
    const errorMessage = result.error || 'task sync failed'
    markTaskRowsErrored(dirtyRows, errorMessage)
    state.errors++
  }
}

// ---- Chat sync ----

/** Timestamp of last chat sync — only send messages newer than this */
let chatSyncCursor: number = Date.now() - 60_000 // Start with last minute of history
let chatSyncErrors = 0
let chatSyncInFlight = false
let chatSyncQueued = false
let chatSyncTimerRef: ReturnType<typeof setTimeout> | null = null
let chatSyncBackoffMs = 0
let chatSyncNextAllowedAt = 0

const chatSyncMinIntervalMs = Number(process.env.REFLECTT_CHAT_SYNC_MIN_INTERVAL_MS) || DEFAULT_CHAT_SYNC_MIN_INTERVAL_MS
const chatSyncMaxBackoffMs = Number(process.env.REFLECTT_CHAT_SYNC_MAX_BACKOFF_MS) || DEFAULT_CHAT_SYNC_MAX_BACKOFF_MS

function computeBackoffWithJitter(currentMs: number): number {
  const base = currentMs > 0 ? Math.min(currentMs * 2, chatSyncMaxBackoffMs) : 1_000
  const jitter = Math.floor(Math.random() * 500)
  return Math.min(base + jitter, chatSyncMaxBackoffMs)
}

async function requestChatSync(_reason: 'startup' | 'interval' | 'event'): Promise<void> {
  if (!state.running) return

  if (chatSyncInFlight) {
    chatSyncQueued = true
    return
  }

  const now = Date.now()
  if (now < chatSyncNextAllowedAt) {
    const waitMs = Math.max(0, chatSyncNextAllowedAt - now)
    if (!chatSyncTimerRef) {
      chatSyncTimerRef = setTimeout(() => {
        chatSyncTimerRef = null
        requestChatSync('event').catch(() => {})
      }, waitMs)
    }
    return
  }

  await syncChat()

  if (chatSyncQueued) {
    chatSyncQueued = false
    await requestChatSync('event')
  }
}

async function syncChat(): Promise<void> {
  if (!state.hostId || !config) return
  if (chatSyncInFlight) return

  chatSyncInFlight = true

  try {
    // Enforce minimum sync interval + active backoff window
    const now = Date.now()
    if (now < chatSyncNextAllowedAt) {
      return
    }

  // Get recent messages since last sync, excluding cloud-relayed messages
  // to prevent echo: cloud→node→cloud sync loop.
  //
  // CRITICAL: use oldestFirst=true so the cursor walks forward through ALL
  // messages without skipping. Default getMessages returns newest-N (DESC
  // then reversed), which drops older messages in high-traffic windows.
  // This was the root cause of cloud chat sync gaps reported.
  const recentMessages = chatManager.getMessages({
    after: chatSyncCursor,
    limit: 100,
    oldestFirst: true,
  }).filter(m => (m.metadata as any)?.source !== 'cloud-relay')

  // Send to cloud and get pending outbound messages
  const payload = recentMessages.map(m => ({
    id: m.id,
    from: m.from,
    content: m.channel === 'github' || m.from === 'github'
      ? remapGitHubMentions(m.content)
      : m.content,
    timestamp: m.timestamp,
    channel: m.channel || 'general',
  }))

  const result = await cloudPost<{
    synced: number
    pending: Array<{
      id: string
      from: string
      content: string
      timestamp: number
      channel?: string
    }>
  }>(`/api/hosts/${state.hostId}/chat/sync`, { messages: payload })

  if (result.success && result.data) {
    state.lastChatSync = Date.now()
    if (chatSyncErrors > 0) {
      console.log(`☁️  [Chat] Sync recovered after ${chatSyncErrors} errors`)
      chatSyncErrors = 0
    }

    // Reset backoff window on success, enforce minimum interval
    chatSyncBackoffMs = 0
    chatSyncNextAllowedAt = Date.now() + chatSyncMinIntervalMs

    // Update cursor to now
    if (recentMessages.length > 0) {
      chatSyncCursor = Math.max(...recentMessages.map(m => m.timestamp))
    }

    // Process pending outbound messages from cloud (dashboard user messages)
    if (result.data.pending && result.data.pending.length > 0) {
      for (const msg of result.data.pending) {
        // Inject into local chat as if the user posted it
        try {
          // GitHub relay messages from the cloud use raw GitHub sender logins (e.g. @itskaidev)
          // instead of agent names. Remap shared GitHub accounts to their agent equivalents
          // before injecting so @mentions resolve correctly.
          const content = msg.from === 'github'
            ? remapGitHubMentions(msg.content)
            : msg.content

          await chatManager.sendMessage({
            from: msg.from,
            content,
            channel: msg.channel || 'general',
            metadata: { source: 'cloud-relay', cloudMessageId: msg.id },
          })
          console.log(`☁️  [Chat] Relayed message from ${msg.from}: "${msg.content.slice(0, 50)}..."`)
        } catch (err: any) {
          console.warn(`☁️  [Chat] Failed to relay message: ${err?.message}`)
        }
      }
    }
  } else {
    chatSyncErrors++

    // Exponential backoff + jitter on repeated failures
    chatSyncBackoffMs = computeBackoffWithJitter(chatSyncBackoffMs)
    chatSyncNextAllowedAt = Date.now() + Math.max(chatSyncBackoffMs, chatSyncMinIntervalMs)

    // Log first few, then every 20th to avoid spam
    if (chatSyncErrors <= 3 || chatSyncErrors % 20 === 0) {
      console.warn(`☁️  [Chat] Sync failed (${chatSyncErrors}): ${result.error}; next attempt in ~${chatSyncBackoffMs}ms`)
    }
  }
  } catch (err: any) {
    // Ensure token expiry / network errors never wedge the sync loop
    chatSyncErrors++
    chatSyncBackoffMs = computeBackoffWithJitter(chatSyncBackoffMs)
    chatSyncNextAllowedAt = Date.now() + Math.max(chatSyncBackoffMs, chatSyncMinIntervalMs)
    if (chatSyncErrors <= 3 || chatSyncErrors % 20 === 0) {
      console.warn(`☁️  [Chat] Sync threw (${chatSyncErrors}): ${err?.message || err}; next attempt in ~${chatSyncBackoffMs}ms`)
    }
  } finally {
    chatSyncInFlight = false
  }
}

// ---- Canvas sync ----

let canvasSyncErrors = 0

// ── Needs-attention call hook ─────────────────────────────────────────────
// Track previous agent states to detect needs-attention transitions.
// When an agent newly enters needs-attention/urgent, fire POST /call on the
// Fly API for org members who have call_on_needs_attention=true.
// The Fly API resolves phone numbers from team_members.notification_phone.
const prevAgentStates = new Map<string, string>() // agentId → state

function checkNeedsAttentionTransitions(
  agents: Record<string, unknown>,
  hostId: string,
  cloudUrl: string,
  credential: string,
): void {
  for (const [agentId, agentData] of Object.entries(agents)) {
    const agentState = (agentData as Record<string, unknown>)?.state as string | undefined
    if (!agentState) continue

    const prev = prevAgentStates.get(agentId)
    const isAlert = agentState === 'needs-attention' || agentState === 'urgent'
    const wasAlert = prev === 'needs-attention' || prev === 'urgent'

    prevAgentStates.set(agentId, agentState)

    // Only fire on NEW transitions into alert state
    if (!isAlert || wasAlert) continue

    const taskData = (agentData as Record<string, unknown>)?.payload as Record<string, unknown> | undefined
    const taskTitle = (taskData?.task as string) || (taskData?.title as string) || undefined

    console.log(`☁️  [Canvas] needs-attention: @${agentId} → auto-call hook`)

    // POST /call to Fly — Fly resolves phones for members with call_on_needs_attention=true
    // If no members have that preference set, the call is a no-op (400 with no phone).
    const callUrl = `${cloudUrl}/api/hosts/${hostId}/call`
    fetch(callUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({
        agentId,
        agentName: agentId,
        taskTitle,
        // No `to` — Fly resolves phone from team_members.notification_phone
        // for members with call_on_needs_attention=true
      }),
    }).then(r => {
      if (!r.ok && r.status !== 400) {
        console.warn(`☁️  [Canvas] auto-call failed: ${r.status}`)
      }
    }).catch(err => {
      // Non-fatal: call is best-effort
      console.warn(`☁️  [Canvas] auto-call error: ${err instanceof Error ? err.message : err}`)
    })
  }
}

async function syncCanvas(): Promise<void> {
  if (!state.hostId || !config) return

  // Get active (non-stale) canvas slots
  const activeSlots = slotManager.getActive()

  // Also fetch agent canvas states from local API
  let agents: Record<string, unknown> = {}
  try {
    const res = await fetch('http://127.0.0.1:4445/canvas/state')
    if (res.ok) {
      const data = await res.json() as { agents?: Record<string, unknown> }
      agents = data.agents ?? {}
    }
  } catch { /* local API not ready */ }

  // ── Task-derived agent presence ─────────────────────────────────────────
  // Agents that have open tasks are present even if they haven't pushed native
  // canvas state. Any agent with a doing/validating task → "working".
  // Any agent with a todo task (but no doing) → "working" (queued work).
  // Native canvas state takes precedence when present — only fill gaps.
  try {
    const ACTIVE_STATUSES = ['doing', 'validating', 'todo']
    const byAgent: Record<string, { bestStatus: string; taskTitle?: string }> = {}

    for (const status of ACTIVE_STATUSES) {
      const res = await fetch(`http://127.0.0.1:4445/tasks?status=${status}&limit=100`)
      if (!res.ok) continue
      const data = await res.json() as { tasks?: Array<{ assignee?: string; title?: string; status: string }> }
      const tasks = data.tasks ?? []
      for (const task of tasks) {
        const assignee = task.assignee
        if (!assignee || assignee === 'unassigned') continue
        // Higher-priority status wins: doing > validating > todo
        const existing = byAgent[assignee]
        const priority = { doing: 0, validating: 1, todo: 2 }
        const newPriority = priority[status as keyof typeof priority] ?? 99
        const existingPriority = existing ? (priority[existing.bestStatus as keyof typeof priority] ?? 99) : 99
        if (!existing || newPriority < existingPriority) {
          byAgent[assignee] = { bestStatus: status, taskTitle: task.title }
        }
      }
    }

    // Merge derived states into agents — native canvas state takes precedence
    const now = Date.now()
    for (const [agentId, info] of Object.entries(byAgent)) {
      if (agents[agentId]) continue // native state present — don't override
      const derivedState = info.bestStatus === 'doing' ? 'working'
        : info.bestStatus === 'validating' ? 'working'
        : 'working' // todo → working (has queued work)
      agents[agentId] = {
        state: derivedState,
        currentTask: info.taskTitle,
        updatedAt: now,
        source: 'task-derived',
      }
    }

    // ── Waiting state overlay ───────────────────────────────────────────
    // Agents in waiting status get state='needs-attention' (amber pulse) on canvas.
    // This runs AFTER task-derived but BEFORE thinking inference — waiting overrides working.
    // Native canvas state still wins if explicitly set.
    const allAgentInfos = getAgents()
    for (const agent of allAgentInfos) {
      if (agent.status !== 'waiting') continue
      if (agents[agent.name]) continue // native state — don't override
      agents[agent.name] = {
        state: 'waiting',        // soft amber drift — distinct from needs-attention (bright pulse)
        updatedAt: now,
        source: 'waiting-derived',
        waitingFor: agent.waitingFor ?? null,
        waitingTaskId: agent.waitingTaskId ?? null,
      }
    }
  } catch { /* task API not ready — not fatal */ }

  // ── Thinking state inference ────────────────────────────────────────────
  // Agent has an active (running, non-completed) run AND hasn't sent a message
  // in >2min → auto-derive state = 'thinking'. Explicit native canvas state always
  // wins; this only fills gaps left after task-derived and native state passes.
  // @swift @kotlin: once this ships, local heuristics for thinking can be removed.
  try {
    const THINKING_SILENCE_MS = 2 * 60 * 1000 // 2 minutes
    const now2 = Date.now()
    const presences = presenceManager.getAllPresence()
    const presenceByAgent = new Map(presences.map(p => [p.agent, p]))
    const allAgents = getAgents()
    for (const agent of allAgents) {
      // Skip if already has an explicit state (native or task-derived)
      if (agents[agent.name]) continue
      // Check for an active (incomplete) run
      const runs = listAgentRuns(agent.name, 'default', { limit: 5 })
      const hasActiveRun = runs.some(r => r.status === 'working' && r.completedAt === null)
      if (!hasActiveRun) continue
      // Check message silence window
      const presence = presenceByAgent.get(agent.name)
      const lastMsgTs = presence?.lastUpdate ?? 0
      if (now2 - lastMsgTs > THINKING_SILENCE_MS) {
        agents[agent.name] = {
          state: 'thinking',
          updatedAt: now2,
          source: 'thinking-inferred',
        }
      }
    }
  } catch { /* non-fatal */ }

  // ── Needs-attention call hook ───────────────────────────────────────────
  // Check for new needs-attention transitions BEFORE pushing to cloud.
  // The Fly canvas handler also triggers auto-calls, but this node-side hook
  // fires immediately on state detection — no waiting for Fly SSE round-trip.
  if (Object.keys(agents).length > 0 && state.hostId && state.credential && config.cloudUrl) {
    checkNeedsAttentionTransitions(agents, state.hostId, config.cloudUrl, state.credential)
  }

  // Inject agent avatars into sync payload — browsers on app.reflectt.ai read avatar
  // from agent state (canvasStore), not from a separate API call. We merge avatar
  // into each agent entry here so cloud browsers render custom orbs instead of circles.
  // Agents with avatars who haven't posted a canvas state get a floor stub so their
  // custom orb always reaches the cloud (not just when canvas/state is called).
  // task-1773690756100
  try {
    const db = getDb()
    const avatarRows = db.prepare("SELECT agent_id, settings FROM agent_config WHERE settings LIKE '%avatar%'").all() as Array<{ agent_id: string; settings: string }>
    for (const row of avatarRows) {
      try {
        const s = JSON.parse(row.settings)
        if (s.avatar?.content) {
          if (agents[row.agent_id]) {
            // Agent already has a canvas state — just inject the avatar string
            (agents[row.agent_id] as Record<string, unknown>).avatar = s.avatar.content
          }
          // No floor stub for agents without canvas state — this was causing extra
          // agents to appear in the canvas constellation and fighting SSE presence updates.
          // Avatars only render when the agent has an active canvas state.
        }
      } catch { /* skip */ }
    }
  } catch { /* non-blocking */ }

  // Push to cloud — include slots, agent states, and any buffered canvas_push events
  const pushEventsToSend = pendingPushEvents.splice(0, pendingPushEvents.length)
  const result = await cloudPost<{ ok: boolean; slotCount: number }>(
    `/api/hosts/${state.hostId}/canvas`,
    { slots: activeSlots, agents, push_events: pushEventsToSend.length > 0 ? pushEventsToSend : undefined }
  )

  if (result.success && result.data) {
    state.lastCanvasSync = Date.now()
    if (canvasSyncErrors > 0) {
      console.log(`☁️  [Canvas] Sync recovered after ${canvasSyncErrors} errors`)
      canvasSyncErrors = 0
    }
  } else {
    canvasSyncErrors++
    if (canvasSyncErrors <= 3 || canvasSyncErrors % 20 === 0) {
      console.warn(`☁️  [Canvas] Sync failed (${canvasSyncErrors}): ${result.error}`)
    }
    // Re-queue events that failed to send (up to cap)
    if (pushEventsToSend.length > 0) {
      pendingPushEvents.unshift(...pushEventsToSend.slice(-MAX_PENDING_PUSH_EVENTS))
    }
  }
}

// ---- Run Approval Sync ----

let approvalSyncErrors = 0
let lastApprovalSyncAt = 0
const APPROVAL_SYNC_INTERVAL_MS = 10_000

async function syncRunApprovals(): Promise<void> {
  if (!state.hostId || !config) return

  const now = Date.now()
  if (now - lastApprovalSyncAt < APPROVAL_SYNC_INTERVAL_MS) return
  lastApprovalSyncAt = now

  try {
    const KNOWN_AGENTS_SYNC = new Set([
      'link', 'kai', 'pixel', 'sage', 'scout', 'echo',
      'rhythm', 'spark', 'swift', 'kotlin', 'harmony',
      'artdirector', 'uipolish', 'coo', 'cos', 'pm', 'qa',
      'shield', 'kindling', 'quill', 'funnel', 'attribution',
      'bookkeeper', 'legal-counsel', 'evi-scout',
    ])
    const rawItems = listApprovalQueue({ category: 'review', limit: 20 })
    // Filter out agent-to-agent reviews — only sync human-required approvals to cloud
    const items = rawItems.filter(item => {
      const reviewer = (item.agentId ?? '').toLowerCase().trim()
      return !reviewer || !KNOWN_AGENTS_SYNC.has(reviewer)
    })
    if (items.length === 0 && approvalSyncErrors === 0) return // Skip push when empty and no prior errors

    const payload = items.map(item => ({
      eventId: item.id,
      agentId: item.agentId,
      runId: item.runId,
      title: item.title,
      description: item.description,
      urgency: item.urgency,
      payload: item.event.payload,
    }))

    const result = await cloudPost(
      `/api/hosts/${state.hostId}/run-approvals`,
      { items: payload }
    )

    if (result.success) {
      if (approvalSyncErrors > 0) {
        console.log(`☁️  [RunApprovals] Sync recovered after ${approvalSyncErrors} errors`)
        approvalSyncErrors = 0
      }
    } else {
      approvalSyncErrors++
      if (approvalSyncErrors <= 3 || approvalSyncErrors % 20 === 0) {
        console.warn(`☁️  [RunApprovals] Sync failed (${approvalSyncErrors}): ${result.error}`)
      }
    }
  } catch (err: any) {
    approvalSyncErrors++
    if (approvalSyncErrors <= 3) {
      console.warn(`☁️  [RunApprovals] Sync error: ${err?.message}`)
    }
  }
}

// ---- Agent Decision Relay Poll ----
// When decisions are made via the cloud canvas while the node is behind NAT,
// they are queued at GET /api/hosts/:id/agent-interface/decisions.
// This function polls that queue and processes each decision locally.

let lastDecisionPollAt = 0
const DECISION_POLL_INTERVAL_MS = 10_000 // 10s — same cadence as approval sync

async function pollAgentDecisions(): Promise<void> {
  if (!state.hostId || !config) return

  const now = Date.now()
  if (now - lastDecisionPollAt < DECISION_POLL_INTERVAL_MS) return
  lastDecisionPollAt = now

  try {
    const result = await cloudGet<{ decisions: Array<{ eventId: string; decision: 'approve' | 'reject'; decidedAt: number }> }>(
      `/api/hosts/${state.hostId}/agent-interface/decisions`
    )
    if (!result.success) return

    const decisions = Array.isArray(result.data?.decisions) ? result.data.decisions : []
    if (decisions.length === 0) return

    const acked: string[] = []

    for (const d of decisions) {
      try {
        const endpoint = `/agent-interface/runs/${d.eventId}/${d.decision === 'approve' ? 'approve' : 'reject'}`
        const res = await fetch(`http://127.0.0.1:4445${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(3000),
        })
        // ACK on success OR 404/409 (run already decided / not found — still remove from queue)
        if (res.ok || res.status === 404 || res.status === 409) {
          acked.push(d.eventId)
        }
      } catch {
        // Individual failure — leave in queue, retry next cycle
      }
    }

    if (acked.length > 0) {
      await cloudPost(`/api/hosts/${state.hostId}/agent-interface/decisions/ack`, { eventIds: acked })
      console.log(`☁️  [DecisionRelay] Processed ${acked.length}/${decisions.length} queued decisions`)
    }
  } catch {
    // Non-critical — decisions will be retried next cycle
  }
}

// ── Canvas query relay polling ────────────────────────────────────────────────
// When canvas/query is called from a NAT-behind node, the cloud queues the query
// at GET /api/hosts/:id/canvas/query/pending. We poll here, POST each query to
// the local node, and ACK. The node emits canvas_message via eventBus → canvas_push
// relay → cloud → browser pulse subscribers.

let lastCanvasQueryPollAt = 0
const CANVAS_QUERY_POLL_INTERVAL_MS = 8_000 // 8s — faster than decisions (user-facing)

async function pollCanvasQueryRelay(): Promise<void> {
  if (!state.hostId || !config) return

  const now = Date.now()
  if (now - lastCanvasQueryPollAt < CANVAS_QUERY_POLL_INTERVAL_MS) return
  lastCanvasQueryPollAt = now

  try {
    const result = await cloudGet<{ queries: Array<{ queryId: string; query: string; sessionId?: string; enqueuedAt: number }> }>(
      `/api/hosts/${state.hostId}/canvas/query/pending`
    )
    if (!result.success) return

    const queries = Array.isArray(result.data?.queries) ? result.data.queries : []
    if (queries.length === 0) return

    const acked: string[] = []

    for (const q of queries) {
      try {
        // POST to local node — canvas/query processes it and emits canvas_message via eventBus.
        // Process query locally and capture card for relay back to the browser.
        // The card is included in the ACK payload → cloud broadcasts canvas_message to pulse SSE.
        const res = await fetch('http://127.0.0.1:4445/canvas/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q.query, sessionId: q.sessionId ?? undefined }),
          signal: AbortSignal.timeout(12000), // LLM calls can take ~10s
        })
        if (res.ok) {
          try {
            const data = await res.json() as { success?: boolean; card?: Record<string, unknown> }
            if (data.card) {
              // Include card in acked payload so cloud can broadcast it to browser subscribers
              ;(q as Record<string, unknown>)._card = data.card
            }
          } catch { /* card extraction optional — still ACK */ }
          acked.push(q.queryId)
        } else if (res.status === 400) {
          // Invalid query — still ACK to remove from queue
          acked.push(q.queryId)
        }
      } catch {
        // Individual failure — leave in queue, retry next cycle
      }
    }

    if (acked.length > 0) {
      // Collect response cards for broadcast: cloud will emit canvas_message to pulse SSE
      const cards = queries
        .filter(q => acked.includes(q.queryId) && (q as Record<string, unknown>)._card)
        .map(q => (q as Record<string, unknown>)._card as Record<string, unknown>)
      await cloudPost(`/api/hosts/${state.hostId}/canvas/query/ack`, { queryIds: acked, cards })
      console.log(`☁️  [CanvasQueryRelay] Processed ${acked.length}/${queries.length} relay queries, ${cards.length} cards broadcast`)
    }
  } catch {
    // Non-critical — queries will be retried next cycle
  }
}

// ---- Agent Runs Sync ----
// Push agent run records to cloud action_runs table (used by cloud Runs screen)

let agentRunSyncErrors = 0

async function syncAgentRuns(): Promise<void> {
  if (!state.hostId || !config) return
  try {
    const agents = getAgents()
    if (agents.length === 0) return

    const allRuns: AgentRun[] = []
    for (const agent of agents) {
      const runs = listAgentRuns(agent.name, 'default', { limit: 20 })
      allRuns.push(...runs)
    }
    if (allRuns.length === 0) return

    // Enrich runs with cost attribution from local model_usage table.
    // task_id lives in contextSnapshot.taskId — only attributed when present.
    // No time-window fallback (too error-prone for financial metrics).
    const enrichedRuns = allRuns.map(run => {
      const taskId = typeof run.contextSnapshot?.taskId === 'string' ? run.contextSnapshot.taskId : null
      return {
        ...run,
        taskId,
        costUsd: taskId ? getCostForTaskId(taskId) : null,
      }
    })

    const result = await cloudPost(`/api/hosts/${state.hostId}/runs/sync`, { runs: enrichedRuns })
    if (result.success || result.data) {
      if (agentRunSyncErrors > 0) {
        console.log('☁️  [RunSync] Recovered after errors')
        agentRunSyncErrors = 0
      }
    }
  } catch (err: any) {
    agentRunSyncErrors++
    if (agentRunSyncErrors <= 3) {
      console.warn(`☁️  [RunSync] Error: ${err?.message}`)
    }
  }
}

// ---- Trust Event Sync ----
// Push unpushed trust-collapse signals to cloud agent_trust_events table.

async function syncTrustEvents(): Promise<void> {
  const { hostId } = state
  if (!hostId) return
  const events = getUnpushedTrustEvents(50)
  if (events.length === 0) return
  try {
    const result = await cloudPost<{ ok: boolean; inserted: number }>(
      `/api/hosts/${hostId}/trust-events/sync`,
      { events: events.map(e => ({ id: e.id, agentId: e.agentId, type: e.eventType, severity: e.severity, taskId: e.taskId ?? null, summary: e.summary, metadata: e.context, emittedAt: e.occurredAt })) }
    )
    if (result.success || result.data?.ok) {
      markTrustEventsPushed(events.map(e => e.id))
    }
  } catch { /* non-fatal */ }
}

// ---- Run Event Sync ----
// Push recent run events to cloud so Presence SSE relay has data

let lastRunEventSyncAt = 0
let runEventSyncErrors = 0
const RUN_EVENT_SYNC_INTERVAL_MS = 5_000

async function syncRunEvents(): Promise<void> {
  if (!state.hostId || !config) return

  const now = Date.now()
  if (now - lastRunEventSyncAt < RUN_EVENT_SYNC_INTERVAL_MS) return
  lastRunEventSyncAt = now

  try {
    // Get events from the last 30 seconds
    const recentEvents = listAgentEvents({ since: now - 30_000, limit: 20 })
    if (recentEvents.length === 0) return

    // Group by runId and push to cloud
    const byRun = new Map<string, typeof recentEvents>()
    for (const event of recentEvents) {
      const runId = event.runId || 'no-run'
      if (!byRun.has(runId)) byRun.set(runId, [])
      byRun.get(runId)!.push(event)
    }

    for (const [runId, events] of byRun) {
      if (runId === 'no-run') continue
      const payload = events.map(e => ({
        id: e.id,
        type: e.eventType,
        agentId: e.agentId,
        runId: e.runId,
        payload: e.payload,
        createdAt: e.createdAt,
      }))

      await cloudPost(
        `/api/hosts/${state.hostId}/runs/${runId}/stream`,
        { events: payload }
      )
    }

    if (runEventSyncErrors > 0) {
      console.log(`☁️  [RunEvents] Sync recovered after ${runEventSyncErrors} errors`)
      runEventSyncErrors = 0
    }
  } catch (err: any) {
    runEventSyncErrors++
    if (runEventSyncErrors <= 3) {
      console.warn(`☁️  [RunEvents] Sync error: ${err?.message}`)
    }
  }
}

// ---- Usage Sync ----

let usageSyncErrors = 0

async function syncUsage(): Promise<void> {
  if (!state.hostId || !config) return

  try {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000 // last 30 days
    const summaries = getUsageSummary({ since, group_by: 'month' })
    const summary = summaries.length > 0 ? summaries[0] : { period: 'monthly', total_cost_usd: 0, total_input_tokens: 0, total_output_tokens: 0, event_count: 0 }
    const byAgent = getUsageByAgent({ since })
    const byModel = getUsageByModel({ since })
    const caps = listCaps()
    const capStatuses = checkCaps()
    const routingSuggestions = getRoutingSuggestions({ since })

    const result = await cloudPost<{ ok: boolean }>(
      `/api/hosts/${state.hostId}/usage/sync`,
      { summary, byAgent, byModel, caps, capStatuses, routingSuggestions }
    )

    if (result.success) {
      state.lastUsageSync = Date.now()
      if (usageSyncErrors > 0) {
        console.log(`☁️  [Usage] Sync recovered after ${usageSyncErrors} errors`)
        usageSyncErrors = 0
      }
    } else {
      usageSyncErrors++
      if (usageSyncErrors <= 3 || usageSyncErrors % 20 === 0) {
        console.warn(`☁️  [Usage] Sync failed (${usageSyncErrors}): ${result.error}`)
      }
    }
  } catch (err) {
    usageSyncErrors++
    if (usageSyncErrors <= 3) {
      console.warn(`☁️  [Usage] Sync error: ${(err as Error).message}`)
    }
  }
}

// ---- Reflection + Insight sync ----

const REFLECTION_SYNC_INTERVAL_MS = 60_000  // 60s — reflections change less frequently
let reflectionSyncErrors = 0

async function syncReflectionsToCloud(): Promise<void> {
  if (!state.hostId || !config) return

  try {
    // Always send all reflections — the cloud relay is in-memory and may
    // lose state on restart.  Sending the full set (max 200 rows) every 60s
    // is cheap and guarantees the cloud stays populated.  The relay upserts
    // by id, so duplicates are harmless.
    const allRefs = listReflections({ limit: 200 })

    if (allRefs.length === 0) return

    // Map to cloud shape (strip metadata, keep core fields)
    const payload = allRefs.map(r => ({
      id: r.id,
      pain: r.pain,
      impact: r.impact,
      evidence: r.evidence || [],
      went_well: r.went_well || '',
      suspected_why: r.suspected_why || '',
      proposed_fix: r.proposed_fix || '',
      confidence: r.confidence ?? 5,
      role_type: r.role_type || 'agent',
      severity: r.severity,
      author: r.author || 'unknown',
      task_id: r.task_id,
      tags: r.tags || [],
      created_at: r.created_at,
      updated_at: r.updated_at || r.created_at,
    }))

    const result = await cloudPost(
      `/api/hosts/${state.hostId}/reflections/sync`,
      { reflections: payload },
    )

    if (result.success) {
      if (reflectionSyncErrors > 0) {
        console.log(`☁️  [Reflections] Sync recovered after ${reflectionSyncErrors} errors`)
        reflectionSyncErrors = 0
      }
    } else {
      reflectionSyncErrors++
      if (reflectionSyncErrors <= 3 || reflectionSyncErrors % 20 === 0) {
        console.warn(`☁️  [Reflections] Sync failed (${reflectionSyncErrors}): ${result.error}`)
      }
    }
  } catch (err) {
    reflectionSyncErrors++
    if (reflectionSyncErrors <= 3) {
      console.warn(`☁️  [Reflections] Sync error: ${(err as Error).message}`)
    }
  }
}

let insightSyncErrors = 0

async function syncInsightsToCloud(): Promise<void> {
  if (!state.hostId || !config) return

  try {
    // Always send all insights — same rationale as reflections: the cloud
    // relay is in-memory so we need full re-sync to survive restarts.
    const { insights: allInsights } = listInsights({ limit: 200 })

    if (allInsights.length === 0) return

    const payload = allInsights.map(i => ({
      id: i.id,
      cluster_key: i.cluster_key,
      workflow_stage: i.workflow_stage,
      failure_family: i.failure_family,
      impacted_unit: i.impacted_unit,
      title: i.title,
      status: i.status,
      score: i.score,
      priority: i.priority,
      reflection_ids: i.reflection_ids || [],
      independent_count: i.independent_count ?? 1,
      evidence_refs: i.evidence_refs || [],
      authors: i.authors || [],
      promotion_readiness: i.promotion_readiness || 'pending',
      recurring_candidate: i.recurring_candidate ?? false,
      severity_max: i.severity_max ?? null,
      task_id: i.task_id ?? null,
      created_at: i.created_at,
      updated_at: i.updated_at || i.created_at,
    }))

    const result = await cloudPost(
      `/api/hosts/${state.hostId}/insights/sync`,
      { insights: payload },
    )

    if (result.success) {
      if (insightSyncErrors > 0) {
        console.log(`☁️  [Insights] Sync recovered after ${insightSyncErrors} errors`)
        insightSyncErrors = 0
      }
    } else {
      insightSyncErrors++
      if (insightSyncErrors <= 3 || insightSyncErrors % 20 === 0) {
        console.warn(`☁️  [Insights] Sync failed (${insightSyncErrors}): ${result.error}`)
      }
    }
  } catch (err) {
    insightSyncErrors++
    if (insightSyncErrors <= 3) {
      console.warn(`☁️  [Insights] Sync error: ${(err as Error).message}`)
    }
  }
}

// ---- Command polling + context_sync handler ----

const COMMAND_POLL_ACTIVE_MS = 10_000   // 10s when active
const COMMAND_POLL_IDLE_MS = 60_000     // 60s when idle
let commandPollErrors = 0
let lastCommandPollAt = 0

interface PendingCommand {
  id: string
  type: string
  payload: Record<string, unknown>
  status: string
}

async function pollAndProcessCommands(): Promise<void> {
  if (!state.hostId || !config || !state.running) return

  const now = Date.now()
  const interval = isIdle() ? COMMAND_POLL_IDLE_MS : COMMAND_POLL_ACTIVE_MS
  if (now - lastCommandPollAt < interval) return
  lastCommandPollAt = now

  const result = await cloudGet<{ commands: PendingCommand[] }>(
    `/api/hosts/${state.hostId}/commands?status=pending`
  )

  if (!result.success || !result.data?.commands) {
    commandPollErrors++
    if (commandPollErrors <= 3 || commandPollErrors % 20 === 0) {
      console.warn(`☁️  [Commands] Poll failed (${commandPollErrors}): ${result.error}`)
    }
    return
  }

  if (commandPollErrors > 0) {
    console.log(`☁️  [Commands] Poll recovered after ${commandPollErrors} errors`)
    commandPollErrors = 0
  }

  for (const cmd of result.data.commands) {
    try {
      await handleCommand(cmd)
    } catch (err: any) {
      console.warn(`☁️  [Commands] Failed to handle ${cmd.type} (${cmd.id}): ${err?.message}`)
      // Ack as failed so it doesn't re-run
      await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
        action: 'fail',
        error: err?.message || 'Handler error',
      }).catch(() => {})
    }
  }
}

async function handleCommand(cmd: PendingCommand): Promise<void> {
  if (cmd.type === 'context_sync') {
    await handleContextSync(cmd)
  } else if (cmd.type === 'run_approve') {
    await handleRunApprove(cmd)
  } else {
    console.log(`☁️  [Commands] Unknown command type: ${cmd.type} (${cmd.id}) — skipping`)
    // Ack unknown commands so they don't pile up
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { skipped: true, reason: 'unknown_type' },
    })
  }
}

async function handleRunApprove(cmd: PendingCommand): Promise<void> {
  if (!state.hostId) return

  const eventId = cmd.payload?.eventId as string
  const decision = cmd.payload?.decision as string
  const actor = cmd.payload?.actor as string || 'cloud-dashboard'
  const rationale = cmd.payload?.rationale as string || ''

  if (!eventId || !decision) {
    console.warn(`☁️  [Commands] run_approve missing eventId/decision (${cmd.id}) — failing`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: 'eventId and decision are required',
    })
    return
  }

  console.log(`☁️  [Commands] Processing run_approve: ${decision} for ${eventId} (${cmd.id})`)

  // Ack immediately
  await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
    action: 'ack',
  })

  // Execute locally against the approval queue
  const port = process.env.REFLECTT_NODE_PORT || '4445'
  try {
    const res = await fetch(`http://127.0.0.1:${port}/approval-queue/${encodeURIComponent(eventId)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, actor, rationale }),
    })

    const result = await res.json().catch(() => ({ success: false }))

    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { eventId, decision, status: res.status, ...(result as Record<string, unknown>) },
    })

    console.log(`☁️  [Commands] run_approve ${decision} for ${eventId} — ${res.status}`)
  } catch (err: any) {
    console.warn(`☁️  [Commands] run_approve failed for ${eventId}: ${err?.message}`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: err?.message || 'Local approval-queue call failed',
    })
  }
}

async function handleContextSync(cmd: PendingCommand): Promise<void> {
  if (!state.hostId) return

  // Require explicit agent — no hardcoded fallback
  const agent = (cmd.payload?.agent as string)?.trim()
  if (!agent) {
    console.warn(`☁️  [Commands] context_sync missing payload.agent (${cmd.id}) — failing`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: 'payload.agent is required',
    })
    return
  }

  console.log(`☁️  [Commands] Processing context_sync for agent=${agent} (${cmd.id})`)

  // Ack immediately (in-progress)
  await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
    action: 'ack',
  })

  // Fetch context snapshot from local node
  const port = process.env.REFLECTT_NODE_PORT || '4445'
  let contextData: Record<string, unknown>
  try {
    const localRes = await fetch(`http://127.0.0.1:${port}/context/inject/${encodeURIComponent(agent)}`)
    if (!localRes.ok) throw new Error(`Local context fetch failed: ${localRes.status}`)
    contextData = await localRes.json() as Record<string, unknown>
  } catch (err: any) {
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: `Failed to fetch local context: ${err?.message}`,
    })
    throw err
  }

  // Push to cloud — use computed_at from injection payload when available
  const computedAt = (typeof contextData.computed_at === 'number' && contextData.computed_at > 0)
    ? contextData.computed_at
    : Date.now()

  const syncResult = await cloudPost(`/api/hosts/${state.hostId}/context/sync`, {
    agent,
    computed_at: computedAt,
    budgets: contextData.budgets || { totalTokens: 0, layers: {} },
    autosummary_enabled: Boolean(contextData.autosummary_enabled),
    layers: contextData.layers || {},
  })

  if (syncResult.success) {
    console.log(`☁️  [Commands] context_sync completed for ${agent} (${cmd.id})`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { syncedAt: Date.now(), agent },
    })
    markCloudActivity() // Mark as active
  } else {
    console.warn(`☁️  [Commands] context_sync failed for ${agent}: ${syncResult.error}`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: syncResult.error,
    })
  }
}

// ---- HTTP helper ----

interface CloudApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

async function cloudGet<T = unknown>(path: string): Promise<CloudApiResponse<T>> {
  if (!config) return { success: false, error: 'Not configured' }

  try {
    const url = `${config.cloudUrl}${path}`
    const headers: Record<string, string> = {}

    if (state.credential) {
      headers['Authorization'] = `Bearer ${state.credential}`
    } else {
      headers['Authorization'] = `Bearer ${config.token}`
    }

    const response = await fetch(url, { method: 'GET', headers })

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>
      return { success: false, error: (errBody.error as string) || `HTTP ${response.status}` }
    }

    const payload = await response.json() as T
    return { success: true, data: payload }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Request failed' }
  }
}

async function cloudPost<T = unknown>(path: string, body: unknown): Promise<CloudApiResponse<T>> {
  if (!config) return { success: false, error: 'Not configured' }

  try {
    const url = `${config.cloudUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Use credential if registered, otherwise join token for enrollment
    if (state.credential) {
      headers['Authorization'] = `Bearer ${state.credential}`
    } else {
      headers['Authorization'] = `Bearer ${config.token}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({})) as Record<string, unknown>
      return { success: false, error: (errBody.error as string) || `HTTP ${response.status}` }
    }

    const payload = await response.json() as T
    return { success: true, data: payload }
  } catch (err: any) {
    // Don't increment errors here — callers handle error counting
    return { success: false, error: err?.message || 'Request failed' }
  }
}
