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
}

interface CloudState {
  hostId: string | null
  credential: string | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  taskSyncTimer: ReturnType<typeof setInterval> | null
  heartbeatCount: number
  lastHeartbeat: number | null
  lastTaskSync: number | null
  errors: number
  running: boolean
  startedAt: number
}

const DEFAULT_HEARTBEAT_MS = 30_000
const DEFAULT_TASK_SYNC_MS = 60_000

let config: CloudConfig | null = null
let state: CloudState = {
  hostId: null,
  credential: null,
  heartbeatTimer: null,
  taskSyncTimer: null,
  heartbeatCount: 0,
  lastHeartbeat: null,
  lastTaskSync: null,
  errors: 0,
  running: false,
  startedAt: Date.now(),
}

/**
 * Check if cloud integration is configured
 */
export function isCloudConfigured(): boolean {
  return Boolean(process.env.REFLECTT_HOST_TOKEN)
}

/**
 * Get current cloud connection status
 */
export function getCloudStatus() {
  return {
    configured: isCloudConfigured(),
    registered: state.hostId !== null,
    hostId: state.hostId,
    running: state.running,
    heartbeatCount: state.heartbeatCount,
    lastHeartbeat: state.lastHeartbeat,
    lastTaskSync: state.lastTaskSync,
    errors: state.errors,
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

  config = {
    cloudUrl: (process.env.REFLECTT_CLOUD_URL || 'https://api.reflectt.ai').replace(/\/+$/, ''),
    token: process.env.REFLECTT_HOST_TOKEN!,
    hostName: process.env.REFLECTT_HOST_NAME || 'unnamed-host',
    hostType: process.env.REFLECTT_HOST_TYPE || 'openclaw',
    heartbeatIntervalMs: Number(process.env.REFLECTT_HEARTBEAT_MS) || DEFAULT_HEARTBEAT_MS,
    taskSyncIntervalMs: Number(process.env.REFLECTT_TASK_SYNC_MS) || DEFAULT_TASK_SYNC_MS,
  }

  console.log(`☁️  Cloud integration: connecting to ${config.cloudUrl}`)
  console.log(`   Host: ${config.hostName} (${config.hostType})`)

  // Register with cloud
  try {
    const result = await cloudPost<{ hostId: string; credential: string }>('/v1/hosts/register', {
      joinToken: config.token,
      hostName: config.hostName,
      hostType: config.hostType,
    })

    if (result.success && result.data) {
      state.hostId = result.data.hostId
      state.credential = result.data.credential
      console.log(`   ✅ Registered (hostId: ${state.hostId})`)
    } else {
      console.warn(`   ⚠ Registration failed: ${result.error || 'unknown error'}`)
      state.errors++
      return
    }
  } catch (err: any) {
    console.warn(`   ⚠ Registration failed: ${err?.message || 'network error'}`)
    state.errors++
    return
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

  console.log(`   ✅ Heartbeat every ${config.heartbeatIntervalMs / 1000}s, task sync every ${config.taskSyncIntervalMs / 1000}s`)
}

/**
 * Stop cloud integration (call on shutdown)
 */
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

  const result = await cloudPost('/v1/hosts/heartbeat', {
    hostId: state.hostId,
    hostName: config.hostName,
    hostType: config.hostType,
    agents,
    activeTasks: tasks.filter(t => t.status === 'doing').length,
    uptime: Date.now() - state.startedAt,
    timestamp: Date.now(),
  })

  if (result.success) {
    state.lastHeartbeat = Date.now()
    state.heartbeatCount++
  } else {
    state.errors++
  }
}

async function syncTasks(): Promise<void> {
  if (!state.hostId || !config) return

  const tasks = getTasks()

  const result = await cloudPost('/v1/hosts/tasks/sync', {
    hostId: state.hostId,
    tasks,
    timestamp: Date.now(),
  })

  if (result.success) {
    state.lastTaskSync = Date.now()
  } else {
    state.errors++
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

    // Use credential if registered, otherwise join token
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

    return await response.json() as CloudApiResponse<T>
  } catch (err: any) {
    state.errors++
    return { success: false, error: err?.message || 'Request failed' }
  }
}
