// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Unified Policy Config
 *
 * Single canonical policy file in ~/.reflectt/policy.json consumed by:
 * - Watchdog (idle nudge, cadence alerts, mention rescue)
 * - Board health worker (auto-block, suggest-close, digest)
 * - Quiet hours
 *
 * Replaces scattered env vars with one editable config file.
 * Env vars still override for backwards compat / CI.
 * Runtime PATCH updates the in-memory config + persists to disk.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'

// ── Schema ─────────────────────────────────────────────────────────────────

export interface PolicyConfig {
  /** Global quiet hours — suppresses all watchdog/board-health actions */
  quietHours: {
    enabled: boolean
    startHour: number   // 0-23
    endHour: number     // 0-23
    timezone: string
  }

  /** Idle nudge: warn/escalate agents with no activity */
  idleNudge: {
    enabled: boolean
    warnMin: number
    escalateMin: number
    cooldownMin: number
    suppressRecentMin: number
    shipCooldownMin: number
    activeTaskMaxAgeMin: number
    excluded: string[]
  }

  /** Cadence watchdog: trio silence + stale working alerts */
  cadenceWatchdog: {
    enabled: boolean
    silenceMin: number
    workingStaleMin: number
    workingTaskMaxAgeMin: number
    alertCooldownMin: number
  }

  /** Stale doing threshold (for health endpoint) */
  staleDoingThresholdMin: number

  /** Mention rescue: nudge trio when Ryan mentions them and nobody responds */
  mentionRescue: {
    enabled: boolean
    delayMin: number
    cooldownMin: number
    globalCooldownMin: number
  }

  /** Board health worker: automated board hygiene */
  boardHealth: {
    enabled: boolean
    intervalMs: number
    staleDoingThresholdMin: number
    suggestCloseThresholdMin: number
    rollbackWindowMs: number
    digestIntervalMs: number
    digestChannel: string
    dryRun: boolean
    maxActionsPerTick: number
  }

  /** Ready-queue floor: ensure engineering agents always have specced tasks */
  readyQueueFloor: {
    enabled: boolean
    minReady: number           // minimum unblocked todo tasks per agent
    agents: string[]           // agents to monitor
    escalateAfterMin: number   // idle+empty-queue → escalation timer
    cooldownMin: number        // don't re-alert within this window
    channel: string            // where to post warnings
    enforceBlock?: boolean     // if true (default), block validating/done transitions when queue drops below floor
  }

  /** Reflection automation nudges */
  reflectionNudge: {
    enabled: boolean
    postTaskDelayMin: number     // minutes to wait after task done before nudging
    idleReflectionHours: number  // nudge if no reflection in this many hours
    cooldownMin: number          // minimum minutes between nudges to same agent
    agents: string[]             // agents to monitor (empty = all active)
    channel: string              // delivery channel
    roleCadenceHours: Record<string, number>  // per-agent cadence overrides
    excludeAgents?: string[]     // agent names to exclude from auto-discovery
    nudgeNeverReflected?: boolean // nudge agents who have never reflected (default: true)
  }

  /** Insight:promoted listener — auto-create tasks from promoted insights */
  insightListener: {
    enabled: boolean
    autoCreateSeverities: string[]   // severities that auto-create tasks (default: ['critical', 'high'])
    defaultReviewer: string
    defaultEta: string
    clusterCooldownMs: number        // cooldown between auto-creates for same cluster
  }

  /** Escalation channels for different severity levels */
  escalation: {
    defaultChannel: string
    criticalChannel: string
    digestChannel: string
  }
}

// ── Defaults ───────────────────────────────────────────────────────────────

export const DEFAULT_POLICY: PolicyConfig = {
  quietHours: {
    enabled: true,
    startHour: 23,
    endHour: 8,
    timezone: 'America/Vancouver',
  },
  idleNudge: {
    enabled: true,
    warnMin: 45,
    escalateMin: 60,
    cooldownMin: 20,
    suppressRecentMin: 20,
    shipCooldownMin: 30,
    activeTaskMaxAgeMin: 180,
    excluded: ['ryan', 'diag'],
  },
  cadenceWatchdog: {
    enabled: true,
    silenceMin: 60,
    workingStaleMin: 45,
    workingTaskMaxAgeMin: 240,
    alertCooldownMin: 30,
  },
  staleDoingThresholdMin: 240,
  mentionRescue: {
    enabled: true,
    delayMin: 0,
    cooldownMin: 10,
    globalCooldownMin: 5,
  },
  boardHealth: {
    enabled: true,
    intervalMs: 5 * 60 * 1000,
    staleDoingThresholdMin: 240,
    suggestCloseThresholdMin: 1440,
    rollbackWindowMs: 60 * 60 * 1000,
    digestIntervalMs: 4 * 60 * 60 * 1000,
    digestChannel: 'ops',
    dryRun: false,
    maxActionsPerTick: 5,
  },
  readyQueueFloor: {
    enabled: true,
    minReady: 2,
    agents: ['link'],
    escalateAfterMin: 60,
    cooldownMin: 30,
    channel: 'general',
  },
  reflectionNudge: {
    enabled: true,
    postTaskDelayMin: 5,
    idleReflectionHours: 8,
    cooldownMin: 60,
    agents: [],
    channel: 'general',
    roleCadenceHours: {},
    excludeAgents: [],
    nudgeNeverReflected: true,
  },
  insightListener: {
    enabled: true,
    autoCreateSeverities: ['critical', 'high'],
    defaultReviewer: 'sage',
    defaultEta: '4h',
    clusterCooldownMs: 30 * 60_000,
  },
  escalation: {
    defaultChannel: 'general',
    criticalChannel: 'general',
    digestChannel: 'ops',
  },
}

// ── Policy Manager ─────────────────────────────────────────────────────────

class PolicyManager {
  private config: PolicyConfig
  private filePath: string
  private loaded = false

  constructor() {
    this.filePath = resolve(
      process.env.REFLECTT_POLICY_PATH || `${homedir()}/.reflectt/policy.json`,
    )
    this.config = structuredClone(DEFAULT_POLICY)
  }

  /** Load policy from disk, then overlay env vars. Call once at startup. */
  load(): PolicyConfig {
    // 1. Load from file
    try {
      const raw = readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<PolicyConfig>
      this.config = this.merge(DEFAULT_POLICY, parsed)
    } catch {
      // File doesn't exist or invalid — use defaults
    }

    // 2. Overlay env vars (backwards compat)
    this.applyEnvOverrides()

    this.loaded = true
    return this.get()
  }

  /** Get current policy (immutable copy) */
  get(): PolicyConfig {
    if (!this.loaded) this.load()
    return structuredClone(this.config)
  }

  /** Patch policy at runtime — merges, validates, persists */
  patch(update: DeepPartial<PolicyConfig>): PolicyConfig {
    this.config = this.merge(this.config, update)
    this.persist()
    return this.get()
  }

  /** Reset to defaults + re-apply env */
  reset(): PolicyConfig {
    this.config = structuredClone(DEFAULT_POLICY)
    this.applyEnvOverrides()
    this.persist()
    return this.get()
  }

  /** Get file path for display */
  getFilePath(): string {
    return this.filePath
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.config, null, 2) + '\n', 'utf8')
    } catch {
      // Non-fatal: config still works in-memory
    }
  }

  // ── Merge ──────────────────────────────────────────────────────────────

  private merge(base: any, overlay: any): any {
    const result = structuredClone(base)

    for (const key of Object.keys(overlay)) {
      const value = overlay[key]
      if (value === undefined) continue

      if (
        value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && typeof result[key] === 'object'
        && result[key] !== null
        && !Array.isArray(result[key])
      ) {
        result[key] = this.merge(result[key], value)
      } else {
        result[key] = structuredClone(value)
      }
    }

    return result
  }

  // ── Env Overrides ──────────────────────────────────────────────────────

  private applyEnvOverrides(): void {
    const env = process.env

    // Quiet hours
    if (env.WATCHDOG_QUIET_HOURS_ENABLED !== undefined)
      this.config.quietHours.enabled = env.WATCHDOG_QUIET_HOURS_ENABLED !== 'false'
    if (env.WATCHDOG_QUIET_HOURS_START_HOUR)
      this.config.quietHours.startHour = Number(env.WATCHDOG_QUIET_HOURS_START_HOUR)
    if (env.WATCHDOG_QUIET_HOURS_END_HOUR)
      this.config.quietHours.endHour = Number(env.WATCHDOG_QUIET_HOURS_END_HOUR)
    if (env.WATCHDOG_QUIET_HOURS_TZ)
      this.config.quietHours.timezone = env.WATCHDOG_QUIET_HOURS_TZ

    // Idle nudge
    if (env.IDLE_NUDGE_ENABLED !== undefined)
      this.config.idleNudge.enabled = env.IDLE_NUDGE_ENABLED !== 'false'
    if (env.IDLE_NUDGE_WARN_MIN)
      this.config.idleNudge.warnMin = Number(env.IDLE_NUDGE_WARN_MIN)
    if (env.IDLE_NUDGE_ESCALATE_MIN)
      this.config.idleNudge.escalateMin = Number(env.IDLE_NUDGE_ESCALATE_MIN)
    if (env.IDLE_NUDGE_COOLDOWN_MIN)
      this.config.idleNudge.cooldownMin = Number(env.IDLE_NUDGE_COOLDOWN_MIN)
    if (env.IDLE_NUDGE_SUPPRESS_RECENT_MIN)
      this.config.idleNudge.suppressRecentMin = Number(env.IDLE_NUDGE_SUPPRESS_RECENT_MIN)
    if (env.IDLE_NUDGE_SHIP_COOLDOWN_MIN)
      this.config.idleNudge.shipCooldownMin = Number(env.IDLE_NUDGE_SHIP_COOLDOWN_MIN)
    if (env.IDLE_NUDGE_ACTIVE_TASK_MAX_AGE_MIN)
      this.config.idleNudge.activeTaskMaxAgeMin = Number(env.IDLE_NUDGE_ACTIVE_TASK_MAX_AGE_MIN)
    if (env.IDLE_NUDGE_EXCLUDE)
      this.config.idleNudge.excluded = env.IDLE_NUDGE_EXCLUDE.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

    // Cadence watchdog
    if (env.CADENCE_WATCHDOG_ENABLED !== undefined)
      this.config.cadenceWatchdog.enabled = env.CADENCE_WATCHDOG_ENABLED !== 'false'
    if (env.CADENCE_SILENCE_MIN)
      this.config.cadenceWatchdog.silenceMin = Number(env.CADENCE_SILENCE_MIN)
    if (env.CADENCE_WORKING_STALE_MIN)
      this.config.cadenceWatchdog.workingStaleMin = Number(env.CADENCE_WORKING_STALE_MIN)
    if (env.CADENCE_WORKING_TASK_MAX_AGE_MIN)
      this.config.cadenceWatchdog.workingTaskMaxAgeMin = Number(env.CADENCE_WORKING_TASK_MAX_AGE_MIN)
    if (env.CADENCE_ALERT_COOLDOWN_MIN)
      this.config.cadenceWatchdog.alertCooldownMin = Number(env.CADENCE_ALERT_COOLDOWN_MIN)

    // Stale doing
    if (env.STALE_DOING_THRESHOLD_MIN)
      this.config.staleDoingThresholdMin = Number(env.STALE_DOING_THRESHOLD_MIN)

    // Mention rescue
    if (env.MENTION_RESCUE_ENABLED !== undefined)
      this.config.mentionRescue.enabled = env.MENTION_RESCUE_ENABLED !== 'false'
    if (env.MENTION_RESCUE_DELAY_MIN)
      this.config.mentionRescue.delayMin = Number(env.MENTION_RESCUE_DELAY_MIN)
    if (env.MENTION_RESCUE_COOLDOWN_MIN)
      this.config.mentionRescue.cooldownMin = Number(env.MENTION_RESCUE_COOLDOWN_MIN)
    if (env.MENTION_RESCUE_GLOBAL_COOLDOWN_MIN)
      this.config.mentionRescue.globalCooldownMin = Number(env.MENTION_RESCUE_GLOBAL_COOLDOWN_MIN)

    // Board health
    if (env.BOARD_HEALTH_ENABLED !== undefined)
      this.config.boardHealth.enabled = env.BOARD_HEALTH_ENABLED !== 'false'
    if (env.BOARD_HEALTH_INTERVAL_MS)
      this.config.boardHealth.intervalMs = Number(env.BOARD_HEALTH_INTERVAL_MS)
    if (env.BOARD_HEALTH_STALE_DOING_MIN)
      this.config.boardHealth.staleDoingThresholdMin = Number(env.BOARD_HEALTH_STALE_DOING_MIN)
    if (env.BOARD_HEALTH_SUGGEST_CLOSE_MIN)
      this.config.boardHealth.suggestCloseThresholdMin = Number(env.BOARD_HEALTH_SUGGEST_CLOSE_MIN)
    if (env.BOARD_HEALTH_ROLLBACK_WINDOW_MS)
      this.config.boardHealth.rollbackWindowMs = Number(env.BOARD_HEALTH_ROLLBACK_WINDOW_MS)
    if (env.BOARD_HEALTH_DIGEST_INTERVAL_MS)
      this.config.boardHealth.digestIntervalMs = Number(env.BOARD_HEALTH_DIGEST_INTERVAL_MS)
    if (env.BOARD_HEALTH_DIGEST_CHANNEL)
      this.config.boardHealth.digestChannel = env.BOARD_HEALTH_DIGEST_CHANNEL
    if (env.BOARD_HEALTH_DRY_RUN !== undefined)
      this.config.boardHealth.dryRun = env.BOARD_HEALTH_DRY_RUN === 'true'
    if (env.BOARD_HEALTH_MAX_ACTIONS)
      this.config.boardHealth.maxActionsPerTick = Number(env.BOARD_HEALTH_MAX_ACTIONS)
  }
}

// ── DeepPartial helper ─────────────────────────────────────────────────────

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Record<string, unknown> ? DeepPartial<T[P]> : T[P]
}

// ── Singleton ──────────────────────────────────────────────────────────────

export const policyManager = new PolicyManager()
