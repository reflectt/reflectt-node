// SPDX-License-Identifier: Apache-2.0
/**
 * StallDetector — event-driven stall detection
 * 
 * Detects when users go inactive during key lifecycle moments:
 * - New user stall: 4 min inactivity post-first-action
 * - In-session stall: 6 min inactivity post-agent-response  
 * - Setup stall: 5 min onboarding inactivity
 * 
 * Emits stall events that the InterventionTemplateEngine can consume.
 */

export type StallType = 'new_user_stall' | 'in_session_stall' | 'setup_stall'
export type SessionPhase = 'new_user' | 'in_session' | 'setup'

export interface StallContext {
  userId: string
  sessionId: string
  lastAction?: string
  lastAgent?: string
  lastActionAt?: number
}

export interface StallEvent {
  stallId: string
  userId: string
  sessionId: string
  stallType: StallType
  context: StallContext
  timestamp: number
  thresholdMinutes: number
  inactivityMinutes: number
}

export interface StallThresholds {
  newUserStallMinutes: number  // Default: 4
  inSessionStallMinutes: number // Default: 6
  setupStallMinutes: number     // Default: 5
}

export interface StallDetectorConfig {
  thresholds: StallThresholds
  enabled: boolean
}

export const DEFAULT_THRESHOLDS: StallThresholds = {
  newUserStallMinutes: 4,
  inSessionStallMinutes: 6,
  setupStallMinutes: 5,
}

export const DEFAULT_CONFIG: StallDetectorConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  enabled: false, // Defaults to false until validated
}

// EventBus for stall events
type StallEventHandler = (event: StallEvent) => void
const stallHandlers: Set<StallEventHandler> = new Set()

export function onStallEvent(handler: StallEventHandler): () => void {
  stallHandlers.add(handler)
  return () => stallHandlers.delete(handler)
}

function emitStallEvent(event: StallEvent): void {
  for (const handler of stallHandlers) {
    try {
      handler(event)
    } catch (err) {
      console.error('[StallDetector] Handler error:', err)
    }
  }
}

// In-memory state tracking
interface UserSessionState {
  userId: string
  sessionId: string
  phase: SessionPhase
  lastActionAt: number
  lastAgentResponseAt?: number
  firstActionAt?: number
  stallFired: Set<string>
  context?: StallContext
}

const sessionStates = new Map<string, UserSessionState>() // Key: `${userId}:${sessionId}`

// Track last check time to avoid duplicate stalls
const lastCheckTimes = new Map<string, number>()

/**
 * Record a user action (message sent, button clicked, etc.)
 */
export function recordUserAction(
  userId: string,
  sessionId: string,
  action: string,
  timestamp: number = Date.now()
): void {
  const key = `${userId}:${sessionId}`
  let state = sessionStates.get(key)
  
  if (!state) {
    state = {
      userId,
      sessionId,
      phase: 'new_user',
      lastActionAt: timestamp,
      stallFired: new Set(),
    }
    sessionStates.set(key, state)
  }
  
  state.lastActionAt = timestamp
  if (!state.firstActionAt) {
    state.firstActionAt = timestamp
  }
}

/**
 * Record an agent response
 */
export function recordAgentResponse(
  userId: string,
  sessionId: string,
  agentName: string,
  timestamp: number = Date.now()
): void {
  const key = `${userId}:${sessionId}`
  let state = sessionStates.get(key)
  
  if (!state) {
    // Agent responded but we have no user state - create it
    state = {
      userId,
      sessionId,
      phase: 'setup',
      lastActionAt: timestamp,
      stallFired: new Set(),
    }
    sessionStates.set(key, state)
  }
  
  state.lastAgentResponseAt = timestamp
}

/**
 * Check all sessions for stalls and emit events
 */
export function checkForStalls(config: StallDetectorConfig = DEFAULT_CONFIG): StallEvent[] {
  if (!config.enabled) return []
  
  const now = Date.now()
  const emitted: StallEvent[] = []
  
  for (const [key, state] of sessionStates) {
    // Skip if stall already fired for this session
    if (state.stallFired.size > 0) continue
    
    // Skip if checked recently (within 30 seconds)
    const lastCheck = lastCheckTimes.get(key) ?? 0
    if (now - lastCheck < 30_000) continue
    
    lastCheckTimes.set(key, now)
    
    let thresholdMinutes: number
    let stallType: StallType
    let inactivityMs: number
    
    if (state.phase === 'new_user') {
      thresholdMinutes = config.thresholds.newUserStallMinutes
      stallType = 'new_user_stall'
      inactivityMs = state.lastAgentResponseAt
        ? now - state.lastAgentResponseAt
        : now - state.lastActionAt
    } else if (state.phase === 'in_session') {
      thresholdMinutes = config.thresholds.inSessionStallMinutes
      stallType = 'in_session_stall'
      inactivityMs = state.lastAgentResponseAt
        ? now - state.lastAgentResponseAt
        : now - state.lastActionAt
    } else {
      thresholdMinutes = config.thresholds.setupStallMinutes
      stallType = 'setup_stall'
      inactivityMs = now - state.lastActionAt
    }
    
    const thresholdMs = thresholdMinutes * 60_000
    
    if (inactivityMs >= thresholdMs) {
      // Stall detected!
      state.stallFired.add(stallType)
      
      const event: StallEvent = {
        stallId: `stall-${key}-${now}`,
        userId: state.userId,
        sessionId: state.sessionId,
        stallType,
        context: {
          userId: state.userId,
          sessionId: state.sessionId,
          lastAction: 'user_action',
          lastAgent: 'agent',
          lastActionAt: state.lastActionAt,
        },
        timestamp: now,
        thresholdMinutes,
        inactivityMinutes: Math.round(inactivityMs / 60_000),
      }
      
      emitStallEvent(event)
      emitted.push(event)
    }
  }
  
  return emitted
}

/**
 * Transition a session's phase
 */
export function transitionSessionPhase(
  userId: string,
  sessionId: string,
  newPhase: SessionPhase
): void {
  const key = `${userId}:${sessionId}`
  const state = sessionStates.get(key)
  if (state) {
    state.phase = newPhase
    // Reset stall fired when transitioning phases
    state.stallFired.clear()
  }
}

/**
 * Clear a session (user completed the flow)
 */
export function clearSession(userId: string, sessionId: string): void {
  const key = `${userId}:${sessionId}`
  sessionStates.delete(key)
  lastCheckTimes.delete(key)
}

/**
 * Get current state for a session
 */
export function getSessionState(userId: string, sessionId: string): UserSessionState | undefined {
  return sessionStates.get(`${userId}:${sessionId}`)
}

/**
 * Get all active sessions
 */
export function getActiveSessions(): UserSessionState[] {
  return [...sessionStates.values()]
}

/**
 * Cleanup old sessions (call periodically)
 */
export function cleanupStaleSessions(maxAgeMs: number = 30 * 60 * 1000): number {
  const now = Date.now()
  let cleaned = 0
  
  for (const [key, state] of sessionStates) {
    const lastActivity = state.lastAgentResponseAt ?? state.lastActionAt
    if (now - lastActivity > maxAgeMs) {
      sessionStates.delete(key)
      lastCheckTimes.delete(key)
      cleaned++
    }
  }
  
  return cleaned
}

// For testing: reset all state
export function _resetStallDetectorState(): void {
  sessionStates.clear()
  lastCheckTimes.clear()
}

// ── StallDetector class (for test compatibility) ─────────────────────────────────

let _stallDetectorInstance: StallDetector | null = null

export class StallDetector {
  private config: StallDetectorConfig

  constructor(config: Partial<StallDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  getAllStates(): UserSessionState[] {
    return [...sessionStates.values()]
  }

  getState(userId: string): UserSessionState | undefined {
    for (const state of sessionStates.values()) {
      if (state.userId === userId) return state
    }
    return undefined
  }

  recordActivity(userId: string, options?: { phase?: SessionPhase; sessionId?: string }): void {
    const now = Date.now()
    let state = this.getState(userId)
    const sessionId = options?.sessionId ?? `session-${userId}`
    const key = `${userId}:${sessionId}`

    if (!state) {
      state = { userId, sessionId, phase: options?.phase ?? 'new_user', lastActionAt: now, stallFired: new Set() }
      sessionStates.set(key, state)
    } else {
      if (options?.phase) state.phase = options.phase
      state.lastActionAt = now
    }
  }

  recordAgentResponse(userId: string, agentId: string): void {
    const now = Date.now()
    for (const state of sessionStates.values()) {
      if (state.userId === userId) {
        state.lastAgentResponseAt = now
        break
      }
    }
  }

  start(): void {
    // Periodic stall check — run every 60s when enabled
    if (this.config.enabled) return // already running
    this.config.enabled = true
    setInterval(() => {
      if (!this.config.enabled) return
      try {
        checkForStalls(this.config)
      } catch (err) {
        console.error('[StallDetector] Check error:', err)
      }
    }, 60_000)
  }
}

// Singleton accessor
export function getStallDetector(): StallDetector {
  if (!_stallDetectorInstance) {
    _stallDetectorInstance = new StallDetector()
  }
  return _stallDetectorInstance
}
