import { describe, it, beforeEach } from 'vitest'
import {
  checkForStalls,
  recordUserAction,
  recordAgentResponse,
  transitionSessionPhase,
  clearSession,
  getSessionState,
  getActiveSessions,
  cleanupStaleSessions,
  onStallEvent,
  _resetStallDetectorState,
  DEFAULT_CONFIG,
  SessionPhase,
} from '../src/stall-detector.js'

const uid = () => `u-${Date.now()}-${Math.random().toString(36).slice(2)}`

describe('StallDetector', () => {
  beforeEach(() => {
    _resetStallDetectorState()
  })

  it('emits stall event when threshold exceeded', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'test_action', now)
    recordAgentResponse(userId, sessionId, 'kai', now)
    
    // Check immediately - should not stall
    const emitted1 = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true })
    if (emitted1.length !== 0) throw new Error('Should not emit immediately')
    
    // Advance time by 5 minutes
    const emitted2 = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true }, now + 5 * 60 * 1000)
    if (emitted2.length !== 1) throw new Error('Should emit after 4 min inactivity')
    if (emitted2[0]!.stallType !== 'new_user_stall') throw new Error('Wrong stall type')
  })

  it('respects configurable thresholds', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'test', now)
    recordAgentResponse(userId, sessionId, 'kai', now)
    
    // With 10 min threshold, 5 min should not trigger
    const emitted1 = checkForStalls({ thresholds: { newUserStallMinutes: 10, inSessionStallMinutes: 10, setupStallMinutes: 10 }, enabled: true }, now + 5 * 60 * 1000)
    if (emitted1.length !== 0) throw new Error('Should not emit with higher threshold')
    
    // With 3 min threshold, 5 min should trigger
    const emitted2 = checkForStalls({ thresholds: { newUserStallMinutes: 3, inSessionStallMinutes: 3, setupStallMinutes: 3 }, enabled: true }, now + 5 * 60 * 1000 + 31_000)
    if (emitted2.length !== 1) throw new Error('Should emit with lower threshold')
  })

  it('does not emit when disabled', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'test', now)
    recordAgentResponse(userId, sessionId, 'kai', now)
    
    const emitted = checkForStalls(DEFAULT_CONFIG, now + 10 * 60 * 1000)
    if (emitted.length !== 0) throw new Error('Should not emit when disabled')
  })

  it('fires new_user_stall after 4 min inactivity', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'first_action', now)
    
    const emitted = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true }, now + 5 * 60 * 1000)
    if (emitted.length !== 1) throw new Error('Should emit new_user_stall')
    if (emitted[0]!.stallType !== 'new_user_stall') throw new Error('Wrong type')
    if (emitted[0]!.thresholdMinutes !== 4) throw new Error('Wrong threshold')
  })

  it('fires in_session_stall after 6 min inactivity', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'action1', now)
    recordAgentResponse(userId, sessionId, 'kai', now)
    transitionSessionPhase(userId, sessionId, 'in_session' as SessionPhase)
    
    const emitted = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true }, now + 7 * 60 * 1000)
    if (emitted.length !== 1) throw new Error('Should emit in_session_stall')
    if (emitted[0]!.stallType !== 'in_session_stall') throw new Error('Wrong type')
  })

  it('fires setup_stall after 5 min inactivity', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'setup_action', now)
    transitionSessionPhase(userId, sessionId, 'setup' as SessionPhase)
    
    const emitted = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true }, now + 6 * 60 * 1000)
    if (emitted.length !== 1) throw new Error('Should emit setup_stall')
    if (emitted[0]!.stallType !== 'setup_stall') throw new Error('Wrong type')
  })

  it('only fires once per session', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'test', now)
    recordAgentResponse(userId, sessionId, 'kai', now)
    
    const emitted1 = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true }, now + 5 * 60 * 1000)
    if (emitted1.length !== 1) throw new Error('First check should emit')
    
    const emitted2 = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true }, now + 10 * 60 * 1000)
    if (emitted2.length !== 0) throw new Error('Second check should not emit')
  })

  it('stall event includes required fields', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'my_action', now)
    recordAgentResponse(userId, sessionId, 'my_agent', now)
    
    const emitted = checkForStalls({ thresholds: { newUserStallMinutes: 4, inSessionStallMinutes: 6, setupStallMinutes: 5 }, enabled: true }, now + 5 * 60 * 1000)
    if (emitted.length !== 1) throw new Error('Should emit')
    
    const event = emitted[0]!
    if (!event.stallId) throw new Error('Missing stallId')
    if (event.userId !== userId) throw new Error('Wrong userId')
    if (event.sessionId !== sessionId) throw new Error('Wrong sessionId')
    if (!event.stallType) throw new Error('Missing stallType')
    if (!event.context) throw new Error('Missing context')
    if (!event.timestamp) throw new Error('Missing timestamp')
  })

  it('clearSession removes state', () => {
    const userId = uid()
    const sessionId = uid()
    const now = Date.now()
    
    recordUserAction(userId, sessionId, 'test', now)
    if (!getSessionState(userId, sessionId)) throw new Error('Session should exist')
    
    clearSession(userId, sessionId)
    if (getSessionState(userId, sessionId)) throw new Error('Session should be cleared')
  })

  it('cleanupStaleSessions removes old sessions', () => {
    const userId = uid()
    const sessionId = uid()
    const past = Date.now() - 60 * 60 * 1000 // 1 hour ago
    
    recordUserAction(userId, sessionId, 'test', past)
    if (getActiveSessions().length !== 1) throw new Error('Should have 1 session')
    
    // With 30 min max age, session (1 hour old) should be cleaned
    const cleaned = cleanupStaleSessions(30 * 60 * 1000)
    if (cleaned !== 1) throw new Error('Should clean 1 session, got: ' + cleaned)
    if (getActiveSessions().length !== 0) throw new Error('Should have 0 sessions')
  })
})
