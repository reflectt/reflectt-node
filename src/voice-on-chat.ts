// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * voice-on-chat — outbound voice loop on canvas.
 *
 * Hooks into chatManager.sendMessage so that an outbound agent message in
 * #general triggers /canvas/speak when at least one human is present in
 * the room. Audio plays through the existing voice_output SSE →
 * voice.output Supabase broadcast path that PR #2840 already wired up.
 *
 * No new endpoint, no new event type, no provider rewrite, no push-bridge
 * widening. The browser useVoice path stays as-is — this is a node-side
 * supplement so chat-reply audio fans out to all canvas tabs (asker +
 * peers + big screen) instead of playing per-tab only.
 *
 * Speakability filter ported verbatim from
 * apps/web/src/app/presence/use-voice.ts to keep the "no police scanner"
 * bar consistent across both rails.
 */

import { listRoomParticipants } from './room-presence-store.js'
import { serverConfig } from './config.js'
import type { AgentMessage } from './types.js'

// ── Cooldowns + dedup (matches useVoice module-level state) ──────────────
const TTS_GLOBAL_COOLDOWN_MS = 8_000
const TTS_CONTENT_COOLDOWN_MS = 60_000
const _spokenCache = new Map<string, number>()
let _lastSpokenAt = 0

// ── Speakability filter (verbatim from use-voice.ts L378-405) ────────────
// Goal: only speak things a human cares about. No inter-agent plumbing.
export function isSpeakable(content: string): boolean {
  const raw = (content ?? '').trim()
  if (raw.length < 8) return false
  // Skip @mention-only messages (inter-agent coordination, not for humans)
  if (/^(@\w+[\s,]*){1,6}[^a-zA-Z]{0,30}$/.test(raw)) return false
  // Skip commit hash-dominant messages
  if (/^[0-9a-f]{7,40}(\s|$)/.test(raw) && raw.length < 80) return false
  if (/\b[0-9a-f]{7,40}\b/.test(raw) && raw.replace(/[^a-zA-Z\s]/g, '').trim().length < 10) return false
  // Skip PR/CI status lines
  if (/^(pushed|merged|rebased|force-pushed|CI (green|red|pass|fail)|✅|❌|#\d+\s+(CI|merged|open|closed))/i.test(raw)) return false
  // Skip messages that are mostly code (backtick-heavy)
  if ((raw.match(/`/g) ?? []).length / raw.length > 0.06) return false
  // Skip npm/git/CI terminal output patterns
  if (/^(npm|git |yarn|tsc|next |npx |\$ |error TS\d|warning TS\d)/i.test(raw)) return false
  // Skip messages over 350 chars — agent writing to team, not speaking to humans
  if (raw.length > 350) return false
  // Build cleaned text the same way useVoice does, then check it's still
  // speakable after stripping @mentions/hashes/PR refs/inline code.
  const cleaned = raw
    .replace(/@\w+/g, '')
    .replace(/\b[0-9a-f]{7,40}\b/g, '')
    .replace(/#\d+/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (cleaned.length < 8) return false
  return true
}

// Build the cleaned, length-capped speakable text (same pipeline as
// useVoice). Returns '' if it would not be spoken — callers should
// short-circuit when isSpeakable() rejects, but this stays safe regardless.
export function buildSpeakableText(content: string): string {
  if (!isSpeakable(content)) return ''
  const cleaned = content.trim()
    .replace(/@\w+/g, '')
    .replace(/\b[0-9a-f]{7,40}\b/g, '')
    .replace(/#\d+/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned.slice(0, 200)
}

// ── Sender gate ──────────────────────────────────────────────────────────
// Don't speak system, human, or user messages. Humans speak themselves;
// system bot output is plumbing.
const NON_AGENT_FROMS = new Set(['system', 'user', 'human'])
function isAgentSender(from: string): boolean {
  return !!from && !NON_AGENT_FROMS.has(from.toLowerCase())
}

// Reset module state — used by tests.
export function _resetVoiceOnChatStateForTest(): void {
  _spokenCache.clear()
  _lastSpokenAt = 0
}

export interface VoiceTriggerDecision {
  willSpeak: boolean
  reason?:
    | 'channel-not-general'
    | 'sender-not-agent'
    | 'not-speakable'
    | 'no-humans-in-room'
    | 'global-cooldown'
    | 'content-cooldown'
}

// Decide whether this message should be spoken. Pure — does not fire the
// HTTP call or stamp the cache. The trigger function below makes the
// decision, stamps state, then fires.
export function decideVoiceTrigger(
  message: Pick<AgentMessage, 'from' | 'channel' | 'content'>,
  now: number,
  humansInRoom: number,
): VoiceTriggerDecision {
  if ((message.channel ?? 'general') !== 'general') return { willSpeak: false, reason: 'channel-not-general' }
  if (!isAgentSender(message.from)) return { willSpeak: false, reason: 'sender-not-agent' }
  if (!isSpeakable(message.content)) return { willSpeak: false, reason: 'not-speakable' }
  if (humansInRoom <= 0) return { willSpeak: false, reason: 'no-humans-in-room' }
  // Evict expired content cache
  for (const [k, t] of _spokenCache) { if (now - t > TTS_CONTENT_COOLDOWN_MS) _spokenCache.delete(k) }
  const contentKey = message.content.slice(0, 200)
  if (_spokenCache.has(contentKey)) return { willSpeak: false, reason: 'content-cooldown' }
  if (now - _lastSpokenAt < TTS_GLOBAL_COOLDOWN_MS) return { willSpeak: false, reason: 'global-cooldown' }
  return { willSpeak: true }
}

// Fires-and-forgets a POST to /canvas/speak on the local Fastify port.
// Errors are swallowed — speech failure must never break chat.
async function postCanvasSpeak(text: string, agentId: string, agentName: string): Promise<void> {
  try {
    const port = serverConfig.port
    const url = `http://127.0.0.1:${port}/canvas/speak`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 5_000)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId, agentName }),
        signal: ac.signal,
      }).catch(() => { /* swallow */ })
    } finally {
      clearTimeout(timer)
    }
  } catch {
    /* swallow */
  }
}

// Hook called from chatManager.sendMessage after a message is persisted +
// emitted. Fires speech in the background; never blocks or throws.
export function triggerVoiceOnChat(message: AgentMessage): void {
  const now = Date.now()
  const humansInRoom = listRoomParticipants().length
  const decision = decideVoiceTrigger(message, now, humansInRoom)
  if (!decision.willSpeak) return
  // Stamp dedup + cooldown BEFORE firing so concurrent messages don't double-speak.
  _spokenCache.set(message.content.slice(0, 200), now)
  _lastSpokenAt = now
  const text = buildSpeakableText(message.content)
  const agentName = message.from
  // Fire-and-forget — chat write must not wait on TTS.
  void postCanvasSpeak(text, agentName, agentName)
}
