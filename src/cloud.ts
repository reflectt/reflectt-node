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
import { taskManager } from './tasks.js'
import { chatManager } from './chat.js'
import { slotManager } from './canvas-slots.js'
import { getDb } from './db.js'
import { getUsageSummary, getUsageByAgent, getUsageByModel, listCaps, checkCaps, getRoutingSuggestions } from './usage-tracking.js'
import { readFileSync, existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { REFLECTT_HOME } from './config.js'

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
  status: 'active' | 'idle' | 'offline'
  currentTask?: string
  lastSeen?: number
}

interface TaskStateEntry {
  id: string
  title: string
  status: string
  assignee?: string
  priority?: string
  updatedAt?: number
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
  usageSyncTimer: ReturnType<typeof setInterval> | null
  heartbeatCount: number
  lastHeartbeat: number | null
  lastTaskSync: number | null
  lastChatSync: number | null
  lastCanvasSync: number | null
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
let lastActivityAt = Date.now()

/** Mark recent activity (call from event handlers) */
export function markCloudActivity(): void {
  lastActivityAt = Date.now()
}

/** Check if the system is idle */
function isIdle(): boolean {
  return Date.now() - lastActivityAt > IDLE_THRESHOLD_MS
}

let config: CloudConfig | null = null
let state: CloudState = {
  hostId: null,
  credential: null,
  heartbeatTimer: null,
  taskSyncTimer: null,
  chatSyncTimer: null,
  canvasSyncTimer: null,
  usageSyncTimer: null,
  heartbeatCount: 0,
  lastHeartbeat: null,
  lastTaskSync: null,
  lastChatSync: null,
  lastCanvasSync: null,
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
    console.warn('   To fix:')
    console.warn('     • Use a named volume (docker-compose default) for a clean identity')
    console.warn('     • Or set REFLECTT_INHERIT_IDENTITY=1 to intentionally reuse this identity')
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
  syncCanvas().catch(() => {})
  state.canvasSyncTimer = setInterval(() => {
    const now = Date.now()
    const interval = isIdle() ? IDLE_SYNC_MS : ACTIVE_CANVAS_SYNC_MS
    if (now - lastCanvasSyncAt < interval) return
    lastCanvasSyncAt = now
    syncCanvas().catch(() => {})
  }, ACTIVE_CANVAS_SYNC_MS)

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
  if (state.usageSyncTimer) {
    clearInterval(state.usageSyncTimer)
    state.usageSyncTimer = null
  }
  console.log('☁️  Cloud integration: stopped')
}

// ---- Data providers ----

function getAgents(): AgentInfo[] {
  const presences = presenceManager.getAllPresence()
  return presences.map(p => ({
    name: p.agent,
    status: p.status === 'working' || p.status === 'reviewing' ? 'active' as const
      : p.status === 'offline' ? 'offline' as const
      : 'idle' as const,
    currentTask: p.task,
    lastSeen: p.lastUpdate,
  }))
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
  }))
}

// ---- Cloud communication ----

async function sendHeartbeat(): Promise<void> {
  if (!state.hostId || !config) return

  const agents = getAgents()
  const tasks = getTasks()
  const doingTasks = tasks.filter(t => t.status === 'doing')

  // Cloud API: POST /api/hosts/:hostId/heartbeat
  // Expects: { status, agents?, activeTasks? }
  const hostStatus = agents.some(a => a.status === 'active') ? 'online'
    : agents.length > 0 ? 'degraded'
    : 'online'

  const result = await cloudPost(`/api/hosts/${state.hostId}/heartbeat`, {
    contractVersion: 'host-heartbeat.v1',
    status: hostStatus,
    timestamp: Date.now(),
    agents: agents.map(a => ({
      id: a.name,
      name: a.name,
      status: a.status,
      currentTaskId: a.currentTask || undefined,
      lastSeenAt: a.lastSeen || Date.now(),
    })),
    activeTasks: doingTasks.map(t => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assignee || undefined,
      priority: t.priority || undefined,
      updatedAt: t.updatedAt || Date.now(),
    })),
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
      state.errors = 0
    }
  } else {
    state.errors++
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

  // Enforce minimum sync interval + active backoff window
  const now = Date.now()
  if (now < chatSyncNextAllowedAt) {
    chatSyncInFlight = false
    return
  }

  // Get recent messages since last sync
  const recentMessages = chatManager.getMessages({
    since: chatSyncCursor,
    limit: 50,
  })

  // Send to cloud and get pending outbound messages
  const payload = recentMessages.map(m => ({
    id: m.id,
    from: m.from,
    content: m.content,
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
          await chatManager.sendMessage({
            from: msg.from,
            content: msg.content,
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

  chatSyncInFlight = false
}

// ---- Canvas sync ----

let canvasSyncErrors = 0

async function syncCanvas(): Promise<void> {
  if (!state.hostId || !config) return

  // Get active (non-stale) canvas slots
  const activeSlots = slotManager.getActive()

  // Push to cloud
  const result = await cloudPost<{ ok: boolean; slotCount: number }>(
    `/api/hosts/${state.hostId}/canvas`,
    { slots: activeSlots }
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
  } else {
    console.log(`☁️  [Commands] Unknown command type: ${cmd.type} (${cmd.id}) — skipping`)
    // Ack unknown commands so they don't pile up
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { skipped: true, reason: 'unknown_type' },
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
