/**
 * StallDetector — event-driven stall detection for human users.
 *
 * Monitors user inactivity and emits stall events when thresholds are exceeded.
 * Tracks three stall types:
 *   new_user: no interaction for N minutes after first action post-signup
 *   in_session: no response from user for N minutes after agent response
 *   setup: no onboarding progress for N minutes during setup phase
 *
 * Architecture:
 *   - Activity hooks: call recordActivity() when a user takes an action
 *   - Agent response hooks: call recordAgentResponse() when an agent responds
 *   - Per-user state machine stored in data/stall-state.jsonl
 *   - setInterval tick checks each tracked user against thresholds
 *   - Emits stall events via registered callbacks
 *
 * Configuration (via reflectt.config.js):
 *   stallDetector: {
 *     enabled: boolean          // default: false (feature flag)
 *     thresholds: {
 *       newUserMinutes: number  // default: 4
 *       inSessionMinutes: number // default: 6
 *       setupMinutes: number    // default: 5
 *     }
 *   }
 *
 * Stall event shape:
 *   {
 *     type: 'stall',
 *     userId: string,
 *     sessionId: string | null,
 *     stallType: 'new_user' | 'in_session' | 'setup',
 *     context: {
 *       lastAction: string | null,   // ISO timestamp
 *       lastAgent: string | null,     // agent that last responded
 *       lastAgentResponse: string | null, // ISO timestamp
 *     },
 *     firedAt: string, // ISO timestamp
 *     thresholdMinutes: number,
 *   }
 *
 * task-1773980039278-f8ajh6i0j
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { serverConfig, DATA_DIR } from './config.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export type StallType = 'new_user' | 'in_session' | 'setup'

export interface StallContext {
  lastAction: string | null      // ISO timestamp of last user interaction
  lastAgent: string | null       // agentId that last responded
  lastAgentResponse: string | null // ISO timestamp of last agent response
  firstActionAt: string | null   // ISO timestamp of first user action
  signupAt: string | null        // ISO timestamp of signup
}

export interface StallEvent {
  type: 'stall'
  userId: string
  sessionId: string | null
  stallType: StallType
  context: StallContext
  firedAt: string
  thresholdMinutes: number
}

export interface StallDetectorConfig {
  enabled: boolean
  thresholds: {
    newUserMinutes: number
    inSessionMinutes: number
    setupMinutes: number
  }
}

export type StallCallback = (event: StallEvent) => void | Promise<void>

interface UserStallState {
  userId: string
  sessionId: string | null
  phase: 'new_user' | 'in_session' | 'setup' | 'active' | 'resolved'
  context: StallContext
  lastChecked: string // ISO timestamp
  stallFired: Set<StallType> // tracks which stall types have already fired for this user
}

// ─── Config ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: StallDetectorConfig = {
  enabled: false,
  thresholds: {
    newUserMinutes: 4,
    inSessionMinutes: 6,
    setupMinutes: 5,
  },
}

function getStallConfig(): StallDetectorConfig {
  const cfg = (serverConfig as any).stallDetector as Partial<StallDetectorConfig> | undefined
  if (!cfg) return DEFAULT_CONFIG
  return {
    enabled: cfg.enabled ?? DEFAULT_CONFIG.enabled,
    thresholds: {
      newUserMinutes: cfg.thresholds?.newUserMinutes ?? DEFAULT_CONFIG.thresholds.newUserMinutes,
      inSessionMinutes: cfg.thresholds?.inSessionMinutes ?? DEFAULT_CONFIG.thresholds.inSessionMinutes,
      setupMinutes: cfg.thresholds?.setupMinutes ?? DEFAULT_CONFIG.thresholds.setupMinutes,
    },
  }
}

function thresholdMs(minutes: number): number {
  return minutes * 60 * 1000
}

// ─── State persistence ──────────────────────────────────────────────────────

const STALL_STATE_FILE = join(DATA_DIR, 'stall-state.jsonl')

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadStates(): Map<string, UserStallState> {
  const states = new Map<string, UserStallState>()
  if (!existsSync(STALL_STATE_FILE)) return states
  try {
    const lines = readFileSync(STALL_STATE_FILE, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      const state = JSON.parse(line) as UserStallState
      state.stallFired = new Set(state.stallFired) // revive Set from JSON array
      states.set(state.userId, state)
    }
  } catch (err) {
    console.warn('[StallDetector] Failed to load state file, starting fresh:', err)
  }
  return states
}

function appendState(state: UserStallState): void {
  ensureDataDir()
  const serializable = { ...state, stallFired: [...state.stallFired] }
  writeFileSync(STALL_STATE_FILE, JSON.stringify(serializable) + '\n', { flag: 'a' })
}

function updateStateLine(userId: string, updated: UserStallState): void {
  ensureDataDir()
  const lines = existsSync(STALL_STATE_FILE)
    ? readFileSync(STALL_STATE_FILE, 'utf8').split('\n').filter(Boolean)
    : []
  const updatedSerializable = { ...updated, stallFired: [...updated.stallFired] }
  const kept = lines.filter(l => {
    try { return JSON.parse(l).userId !== userId } catch { return true }
  })
  kept.push(JSON.stringify(updatedSerializable))
  writeFileSync(STALL_STATE_FILE, kept.join('\n') + '\n')
}

// ─── StallDetector ─────────────────────────────────────────────────────────

export class StallDetector {
  private states: Map<string, UserStallState> = new Map()
  private callbacks: StallCallback[] = []
  private tickInterval: NodeJS.Timeout | null = null
  private readonly TICK_MS = 30_000 // check every 30 seconds

  /**
   * Constructor. Loads persisted state from disk.
   * Pass `skipLoad: true` for in-memory-only operation (useful in tests).
   */
  constructor(opts?: { skipLoad?: boolean }) {
    if (!opts?.skipLoad) {
      this.states = loadStates()
    }
  }

  /**
   * Register a callback to be called when a stall is detected.
   */
  onStall(cb: StallCallback): void {
    void this.callbacks.push(cb)
  }

  /**
   * Start the periodic stall check interval.
   */
  start(): void {
    if (this.tickInterval) return
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS)
    this.tickInterval.unref()
    console.log('[StallDetector] Started')
  }

  /**
   * Stop the periodic check.
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
      console.log('[StallDetector] Stopped')
    }
  }

  /**
   * Record a user interaction (message, click, task action, etc.)
   * Resets the new_user and in_session timers.
   */
  recordActivity(userId: string, opts?: { sessionId?: string; phase?: UserStallState['phase'] }): void {
    const now = Date.now()
    const existing = this.states.get(userId)
    const sessionId = opts?.sessionId ?? existing?.sessionId ?? null
    const phase = opts?.phase ?? existing?.phase ?? 'new_user'

    if (!existing) {
      const state: UserStallState = {
        userId,
        sessionId,
        phase,
        context: {
          lastAction: new Date(now).toISOString(),
          lastAgent: null,
          lastAgentResponse: null,
          firstActionAt: new Date(now).toISOString(),
          signupAt: null,
        },
        lastChecked: new Date(now).toISOString(),
        stallFired: new Set(),
      }
      this.states.set(userId, state)
      appendState(state)
    } else {
      const updated: UserStallState = {
        ...existing,
        sessionId: sessionId ?? existing.sessionId,
        phase: opts?.phase ?? existing.phase,
        context: {
          ...existing.context,
          lastAction: new Date(now).toISOString(),
          // Set firstActionAt if not yet recorded
          firstActionAt: existing.context.firstActionAt ?? new Date(now).toISOString(),
        },
        lastChecked: new Date(now).toISOString(),
      }
      this.states.set(userId, updated)
      updateStateLine(userId, updated)
    }
  }

  /**
   * Record that an agent responded to this user.
   * Resets the in_session timer (waiting for user to respond).
   */
  recordAgentResponse(userId: string, agentId: string): void {
    const now = Date.now()
    const existing = this.states.get(userId)
    const timestamp = new Date(now).toISOString()

    if (!existing) {
      const state: UserStallState = {
        userId,
        sessionId: null,
        phase: 'in_session',
        context: {
          lastAction: null,
          lastAgent: agentId,
          lastAgentResponse: timestamp,
          firstActionAt: null,
          signupAt: null,
        },
        lastChecked: timestamp,
        stallFired: new Set(),
      }
      this.states.set(userId, state)
      appendState(state)
    } else {
      const updated: UserStallState = {
        ...existing,
        phase: 'in_session',
        context: {
          ...existing.context,
          lastAgent: agentId,
          lastAgentResponse: timestamp,
        },
        lastChecked: timestamp,
      }
      this.states.set(userId, updated)
      updateStateLine(userId, updated)
    }
  }

  /**
   * Mark signup completed for a user — transitions them into the new_user phase.
   */
  recordSignup(userId: string): void {
    const now = Date.now()
    const existing = this.states.get(userId)

    if (!existing) {
      const state: UserStallState = {
        userId,
        sessionId: null,
        phase: 'new_user',
        context: {
          lastAction: null,
          lastAgent: null,
          lastAgentResponse: null,
          firstActionAt: null,
          signupAt: new Date(now).toISOString(),
        },
        lastChecked: new Date(now).toISOString(),
        stallFired: new Set(),
      }
      this.states.set(userId, state)
      appendState(state)
    } else {
      const updated: UserStallState = {
        ...existing,
        context: {
          ...existing.context,
          signupAt: new Date(now).toISOString(),
        },
        lastChecked: new Date(now).toISOString(),
      }
      this.states.set(userId, updated)
      updateStateLine(userId, updated)
    }
  }

  /**
   * Mark setup phase — uses setupMinutes threshold.
   */
  enterSetupPhase(userId: string): void {
    const existing = this.states.get(userId)
    if (!existing) return
    const updated: UserStallState = {
      ...existing,
      phase: 'setup',
      lastChecked: new Date().toISOString(),
    }
    this.states.set(userId, updated)
    updateStateLine(userId, updated)
  }

  /**
   * Mark the user as resolved (re-engaged or churned).
   * Clears stall tracking for this user.
   */
  resolveUser(userId: string): void {
    const existing = this.states.get(userId)
    if (!existing) return
    const updated: UserStallState = {
      ...existing,
      phase: 'resolved',
      lastChecked: new Date().toISOString(),
    }
    this.states.set(userId, updated)
    updateStateLine(userId, updated)
    // Remove from active tracking
    this.states.delete(userId)
  }

  /**
   * Get current state for a user (for debugging/admin).
   */
  getState(userId: string): UserStallState | null {
    return this.states.get(userId) ?? null
  }

  /**
   * Get all tracked users.
   */
  getAllStates(): UserStallState[] {
    return Array.from(this.states.values())
  }

  private tick(): void {
    if (!getStallConfig().enabled) return

    const now = Date.now()
    const config = getStallConfig()

    for (const [userId, state] of this.states) {
      if (state.phase === 'resolved') {
        this.states.delete(userId)
        continue
      }

      const lastActivity = state.context.lastAction
        ? new Date(state.context.lastAction).getTime()
        : state.context.signupAt
          ? new Date(state.context.signupAt).getTime()
          : null

      const lastAgentResp = state.context.lastAgentResponse
        ? new Date(state.context.lastAgentResponse).getTime()
        : null

      // ── new_user stall: no activity after first action ──
      if (state.phase === 'new_user' && lastActivity) {
        const threshold = thresholdMs(config.thresholds.newUserMinutes)
        if (!state.stallFired.has('new_user') && now - lastActivity > threshold) {
          const event: StallEvent = {
            type: 'stall',
            userId,
            sessionId: state.sessionId,
            stallType: 'new_user',
            context: state.context,
            firedAt: new Date(now).toISOString(),
            thresholdMinutes: config.thresholds.newUserMinutes,
          }
          this.fireStall(event, state, 'new_user')
          continue
        }
      }

      // ── in_session stall: no user response after agent response ──
      if (state.phase === 'in_session' && lastAgentResp) {
        const threshold = thresholdMs(config.thresholds.inSessionMinutes)
        if (!state.stallFired.has('in_session') && now - lastAgentResp > threshold) {
          const event: StallEvent = {
            type: 'stall',
            userId,
            sessionId: state.sessionId,
            stallType: 'in_session',
            context: state.context,
            firedAt: new Date(now).toISOString(),
            thresholdMinutes: config.thresholds.inSessionMinutes,
          }
          this.fireStall(event, state, 'in_session')
          continue
        }
      }

      // ── setup stall: no onboarding progress ──
      if (state.phase === 'setup' && lastActivity) {
        const threshold = thresholdMs(config.thresholds.setupMinutes)
        if (!state.stallFired.has('setup') && now - lastActivity > threshold) {
          const event: StallEvent = {
            type: 'stall',
            userId,
            sessionId: state.sessionId,
            stallType: 'setup',
            context: state.context,
            firedAt: new Date(now).toISOString(),
            thresholdMinutes: config.thresholds.setupMinutes,
          }
          this.fireStall(event, state, 'setup')
          continue
        }
      }
    }
  }

  private fireStall(event: StallEvent, state: UserStallState, stallType: StallType): void {
    state.stallFired.add(stallType)
    this.states.set(state.userId, state)
    updateStateLine(state.userId, state)

    console.log(`[StallDetector] STALL: ${stallType} for user ${event.userId} after ${event.thresholdMinutes}m inactivity`)

    for (const cb of this.callbacks) {
      try {
        const result = cb(event)
        if (result instanceof Promise) {
          result.catch((err: any) => {
            console.error('[StallDetector] Callback error:', err)
          })
        }
      } catch (err) {
        console.error('[StallDetector] Callback threw:', err)
      }
    }
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let _instance: StallDetector | null = null

export function getStallDetector(): StallDetector {
  if (!_instance) {
    _instance = new StallDetector({ skipLoad: false })
    if (getStallConfig().enabled) {
      _instance.start()
    }
  }
  return _instance
}
