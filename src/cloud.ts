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
import { getDb } from './db.js'
import { readFileSync, existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { REFLECTT_HOME } from './config.js'

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
  heartbeatCount: number
  lastHeartbeat: number | null
  lastTaskSync: number | null
  lastChatSync: number | null
  errors: number
  running: boolean
  startedAt: number
}

const DEFAULT_HEARTBEAT_MS = 30_000
const DEFAULT_TASK_SYNC_MS = 60_000
const DEFAULT_CHAT_SYNC_MS = 5_000

let config: CloudConfig | null = null
let state: CloudState = {
  hostId: null,
  credential: null,
  heartbeatTimer: null,
  taskSyncTimer: null,
  chatSyncTimer: null,
  heartbeatCount: 0,
  lastHeartbeat: null,
  lastTaskSync: null,
  lastChatSync: null,
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
    errors: state.errors,
    uptimeMs: state.running ? Date.now() - state.startedAt : 0,
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
  }, config.heartbeatIntervalMs)

  state.taskSyncTimer = setInterval(() => {
    syncTasks().catch(() => {})
  }, config.taskSyncIntervalMs)

  // Chat sync for remote chat relay
  const chatSyncMs = Number(process.env.REFLECTT_CHAT_SYNC_MS) || DEFAULT_CHAT_SYNC_MS
  syncChat().catch(() => {})
  state.chatSyncTimer = setInterval(() => {
    syncChat().catch(() => {})
  }, chatSyncMs)

  console.log(`   ✅ Heartbeat every ${config.heartbeatIntervalMs / 1000}s, task sync every ${config.taskSyncIntervalMs / 1000}s, chat sync every ${chatSyncMs / 1000}s`)
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
    agents: agents.map(a => ({
      name: a.name,
      status: a.status,
      currentTask: a.currentTask,
      lastSeen: a.lastSeen,
    })),
    activeTasks: doingTasks.map(t => ({
      id: t.id,
      title: t.title,
      assignee: t.assignee,
    })),
  })

  if (result.success || result.data) {
    state.lastHeartbeat = Date.now()
    state.heartbeatCount++
  } else {
    state.errors++
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

async function syncChat(): Promise<void> {
  if (!state.hostId || !config) return

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
    // Don't increment global error count for chat sync failures — it's non-critical
    if (state.errors < 3) {
      // Only log first few errors
      console.warn(`☁️  [Chat] Sync failed: ${result.error}`)
    }
  }
}

// ---- HTTP helper ----

interface CloudApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
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
    state.errors++
    return { success: false, error: err?.message || 'Request failed' }
  }
}
