// SPDX-License-Identifier: Apache-2.0
/**
 * Voice session manager — in-memory store + SSE event bus.
 *
 * Supports POST /voice/input (create session + process transcript)
 * and GET /voice/session/:id/events (SSE stream).
 *
 * Event schema (matches use-voice-input.ts contract):
 *   { type: 'transcript.final',  text: string }
 *   { type: 'agent.thinking' }
 *   { type: 'agent.done',        text: string }
 *   { type: 'tts.ready',         url: string }
 *   { type: 'error',             stage: 'stt'|'agent'|'tts', message: string }
 *
 * task-1773448069113-5mlkqadzh
 */

import { randomUUID } from 'node:crypto'

// ── Types ───────────────────────────────────────────────────────────────────

export type VoiceEventType =
  | 'transcript.partial'
  | 'transcript.final'
  | 'agent.thinking'
  | 'agent.done'
  | 'tts.ready'
  | 'error'
  | 'session.end'

export interface VoiceEvent {
  type: VoiceEventType
  timestamp: number
  text?: string
  url?: string
  stage?: 'stt' | 'agent' | 'tts'
  message?: string
}

export type VoiceSessionStatus = 'pending' | 'processing' | 'done' | 'error'

export interface VoiceSession {
  id: string
  agentId: string
  transcript: string | null
  status: VoiceSessionStatus
  createdAt: number
  updatedAt: number
  events: VoiceEvent[]
}

export type VoiceEventListener = (event: VoiceEvent) => void

// ── In-memory store ─────────────────────────────────────────────────────────

const sessions = new Map<string, VoiceSession>()
const listeners = new Map<string, Set<VoiceEventListener>>()

// TTL: expire sessions after 10 minutes
const SESSION_TTL_MS = 10 * 60 * 1000

function pruneExpired(): void {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id)
      listeners.delete(id)
    }
  }
}

// ── Session lifecycle ────────────────────────────────────────────────────────

export function createVoiceSession(agentId: string): VoiceSession {
  pruneExpired()
  const id = `vs-${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const session: VoiceSession = {
    id,
    agentId,
    transcript: null,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [],
  }
  sessions.set(id, session)
  return session
}

export function getVoiceSession(id: string): VoiceSession | undefined {
  return sessions.get(id)
}

// ── Event emission ────────────────────────────────────────────────────────────

export function emitVoiceEvent(sessionId: string, event: Omit<VoiceEvent, 'timestamp'>): void {
  const session = sessions.get(sessionId)
  if (!session) return

  const fullEvent: VoiceEvent = { ...event, timestamp: Date.now() }
  session.events.push(fullEvent)
  session.updatedAt = Date.now()

  // Notify all active SSE listeners
  const sessionListeners = listeners.get(sessionId)
  if (sessionListeners) {
    for (const fn of sessionListeners) {
      try { fn(fullEvent) } catch { /* connection closed */ }
    }
  }
}

export function subscribeVoiceSession(
  sessionId: string,
  listener: VoiceEventListener,
): () => void {
  if (!listeners.has(sessionId)) {
    listeners.set(sessionId, new Set())
  }
  listeners.get(sessionId)!.add(listener)
  return () => {
    listeners.get(sessionId)?.delete(listener)
  }
}

// ── Processing pipeline ───────────────────────────────────────────────────────

/**
 * Process a text transcript for a voice session.
 * Emits the full event sequence: transcript.final → agent.thinking → agent.done
 * Optionally synthesizes TTS if ELEVEN_LABS_API_KEY is configured.
 *
 * `agentResponder` is injected to avoid circular deps with the main agent loop.
 * It should return the agent's text response (or null on failure).
 */
export async function processVoiceTranscript(
  sessionId: string,
  transcript: string,
  agentResponder: (agentId: string, text: string, sessionId: string) => Promise<string | null>,
  synthesizeTts?: (text: string, agentId: string) => Promise<string | null>,
): Promise<void> {
  const session = sessions.get(sessionId)
  if (!session) return

  session.transcript = transcript
  session.status = 'processing'

  try {
    // 1. Confirm transcript received
    emitVoiceEvent(sessionId, { type: 'transcript.final', text: transcript })

    // 2. Signal agent is thinking
    emitVoiceEvent(sessionId, { type: 'agent.thinking' })

    // 3. Get agent response
    const response = await agentResponder(session.agentId, transcript, sessionId)

    if (!response) {
      emitVoiceEvent(sessionId, {
        type: 'error',
        stage: 'agent',
        message: 'Agent did not respond.',
      })
      session.status = 'error'
      return
    }

    // 4. Agent response ready
    emitVoiceEvent(sessionId, { type: 'agent.done', text: response })
    session.status = 'done'

    // 5. Optionally synthesize TTS
    if (synthesizeTts) {
      try {
        const audioUrl = await synthesizeTts(response, session.agentId)
        if (audioUrl) {
          emitVoiceEvent(sessionId, { type: 'tts.ready', url: audioUrl })
        }
      } catch {
        // TTS failure is non-fatal — agent.done already emitted
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    emitVoiceEvent(sessionId, { type: 'error', stage: 'agent', message })
    session.status = 'error'
  } finally {
    emitVoiceEvent(sessionId, { type: 'session.end' })
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

export function _clearVoiceSessions(): void {
  sessions.clear()
  listeners.clear()
}

export function _getSessionCount(): number {
  return sessions.size
}
