// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * voice-ack-on-handoff — audible acknowledgment when an inbound /handoff
 * names an agent on this host.
 *
 * Locked behavior (per kai msg-1777921934933):
 *   - real `/handoff to=<name>` only (strict prefix; no typo set)
 *   - voiceCapable recipient only (agent_config.settings.voice non-empty)
 *   - human present in room only (≥1)
 *   - recipient not already mid-TTS (gate on activeSpeaker)
 *   - 1–4 word recipient-authored audible ack via Anthropic
 *   - no chat duplication, no extra canvas UI
 *   - turn-local dedup: ack IS the vocal artifact for this turn; the
 *     existing voice-on-chat path keys on message content so the
 *     /handoff line itself won't speak again, and the recipient's later
 *     turns are unaffected
 *
 * Hooks into chatManager.sendMessage right after triggerVoiceOnChat so
 * that the same envelope drives both paths. Fires-and-forgets a POST to
 * the local /canvas/speak endpoint just like voice-on-chat does — same
 * voice_output SSE → activeSpeaker rail.
 */

import { listRoomParticipants } from './room-presence-store.js'
import { getAgentConfig } from './agent-config.js'
import { isAgentActiveSpeaker } from './active-speakers.js'
import { serverConfig } from './config.js'
import type { AgentMessage } from './types.js'

// Strict prefix — cloud SDK accepts a typo set ('/handof', '/andoff',
// '/andof') but the audible ack stays narrow on real `/handoff`.
const HANDOFF_PREFIX = '/handoff'

// Non-agent senders. Mirrors voice-on-chat's NON_AGENT_FROMS so a human
// posting `/handoff to=B` still triggers the ack on B's behalf.
const NON_AGENT_FROMS = new Set(['system'])

export type HandoffAckReason =
  | 'not-handoff'
  | 'channel-not-general'
  | 'sender-system'
  | 'no-target'
  | 'self-handoff'
  | 'recipient-not-voicecapable'
  | 'no-humans-in-room'
  | 'recipient-already-speaking'

export interface HandoffAckDecision {
  willAck: boolean
  recipient?: string
  reason?: HandoffAckReason
}

/**
 * Parse the `to=<name>` token out of a `/handoff` message. Returns the
 * lowercased recipient name or null if the message isn't a real handoff.
 *
 * Strict: requires the message to START with `/handoff` followed by
 * whitespace — anything else (typos, embedded mentions, follow-up
 * sentences) is ignored on this path.
 */
export function parseHandoffTarget(content: string): string | null {
  const raw = (content ?? '').trim()
  if (!raw.toLowerCase().startsWith(HANDOFF_PREFIX)) return null
  const rest = raw.slice(HANDOFF_PREFIX.length)
  if (rest.length === 0) return null
  // Must have a whitespace boundary after `/handoff` so `/handoffsomething`
  // doesn't match.
  if (!/^\s/.test(rest)) return null
  // Find `to=<name>` — first occurrence wins. Recipient must be a single
  // word matching agent-id shape (lowercase letter, then word chars/hyphens).
  const m = rest.match(/(?:^|\s)to=([^\s]+)/i)
  if (!m) return null
  const target = m[1]!.toLowerCase()
  if (!/^[a-z][\w-]*$/.test(target)) return null
  return target
}

export interface DecideHandoffAckInput {
  message: Pick<AgentMessage, 'from' | 'channel' | 'content'>
  humansInRoom: number
  recipientVoiceCapable: boolean
  recipientActiveSpeaker: boolean
}

export function decideHandoffAck(input: DecideHandoffAckInput): HandoffAckDecision {
  const { message, humansInRoom, recipientVoiceCapable, recipientActiveSpeaker } = input
  if ((message.channel ?? 'general') !== 'general') return { willAck: false, reason: 'channel-not-general' }
  if (NON_AGENT_FROMS.has((message.from ?? '').toLowerCase())) return { willAck: false, reason: 'sender-system' }
  const recipient = parseHandoffTarget(message.content ?? '')
  if (!recipient) return { willAck: false, reason: 'not-handoff' }
  if (recipient === (message.from ?? '').toLowerCase().trim()) {
    return { willAck: false, recipient, reason: 'self-handoff' }
  }
  if (!recipientVoiceCapable) return { willAck: false, recipient, reason: 'recipient-not-voicecapable' }
  if (humansInRoom <= 0) return { willAck: false, recipient, reason: 'no-humans-in-room' }
  if (recipientActiveSpeaker) return { willAck: false, recipient, reason: 'recipient-already-speaking' }
  return { willAck: true, recipient }
}

// Resolve voiceCapable from agent_config.settings.voice. A non-empty
// string (after trim) means the agent has a Kokoro/ElevenLabs voice
// assignment and can be vocalized.
function defaultVoiceCapable(agentId: string): boolean {
  try {
    const cfg = getAgentConfig(agentId)
    const voice = cfg?.settings && typeof (cfg.settings as Record<string, unknown>).voice === 'string'
      ? ((cfg.settings as Record<string, unknown>).voice as string).trim()
      : ''
    return voice.length > 0
  } catch {
    return false
  }
}

const ACK_FALLBACKS = ['on it', 'got it', 'taking it', 'on this one', 'yep, on it']

/**
 * Tighten the LLM output into a 1–4 word ack: drop wrapping quotes,
 * trailing punctuation, and any extra lines/words past the cap.
 */
export function clampAckLine(raw: string): string {
  const firstLine = (raw ?? '').split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0) ?? ''
  // Strip wrapping quotes (single, double, smart) once.
  let s = firstLine.replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '').trim()
  // Drop terminal punctuation — kai's lock asks for clean spoken cadence.
  s = s.replace(/[.!?…,;:]+$/g, '').trim()
  if (!s) return ''
  const words = s.split(/\s+/).slice(0, 4)
  s = words.join(' ').slice(0, 30).trim()
  return s
}

/**
 * Generate the recipient-authored ack via Anthropic. Returns a clamped
 * 1–4 word string, or '' if the call fails / output is unusable.
 *
 * Caller decides on fallback behavior. We never fall back to canned
 * chrome inside this function — the spec is "recipient-authored", and
 * silence is preferable to a generic line in cases where the LLM call
 * fails. The triggerHandoffAck path uses a single hardcoded fallback
 * pool only when the API key is unset (dev convenience).
 */
export async function generateAckLine(recipient: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return ''
  const prompt = `You are ${recipient}, an AI agent on Team Reflectt. Someone just handed a task off to you in a room conversation. Speak ONE brief verbal acknowledgment in your voice (1 to 4 words only). Examples: got it; on it; taking that; on this one; noted, on it. No punctuation at the end, no quotes, no preamble — output the words only.`
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 30, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(6000),
    })
    if (!resp.ok) return ''
    const data = await resp.json() as { content?: Array<{ text?: string }> }
    const text = data.content?.[0]?.text ?? ''
    return clampAckLine(text)
  } catch {
    return ''
  }
}

async function postCanvasSpeak(text: string, agentId: string): Promise<void> {
  try {
    const port = serverConfig.port
    const url = `http://127.0.0.1:${port}/canvas/speak`
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 5_000)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, agentId, agentName: agentId }),
        signal: ac.signal,
      }).catch(() => { /* swallow */ })
    } finally {
      clearTimeout(timer)
    }
  } catch {
    /* swallow */
  }
}

const NOISY_FALSE_REASONS = new Set<HandoffAckReason>([
  'not-handoff',
  'channel-not-general',
  'sender-system',
])

export interface HandoffAckDeps {
  humansInRoom?: () => number
  voiceCapable?: (agentId: string) => boolean
  activeSpeaker?: (agentId: string) => boolean
  ackLine?: (recipient: string) => Promise<string>
  speak?: (text: string, agentId: string) => Promise<void>
}

/**
 * Hook called from chatManager.sendMessage after a message is persisted.
 * Fires the recipient-authored ack in the background; never blocks or
 * throws. Deps are injectable for tests.
 */
export function triggerHandoffAck(message: AgentMessage, deps: HandoffAckDeps = {}): void {
  const humansInRoomFn = deps.humansInRoom ?? (() => listRoomParticipants().length)
  const voiceCapableFn = deps.voiceCapable ?? defaultVoiceCapable
  const activeSpeakerFn = deps.activeSpeaker ?? isAgentActiveSpeaker
  const ackLineFn = deps.ackLine ?? generateAckLine
  const speakFn = deps.speak ?? postCanvasSpeak

  // Fast-path parse to avoid touching DB / presence on every message.
  const recipient = parseHandoffTarget(message.content ?? '')
  if (!recipient) return

  const decision = decideHandoffAck({
    message,
    humansInRoom: humansInRoomFn(),
    recipientVoiceCapable: voiceCapableFn(recipient),
    recipientActiveSpeaker: activeSpeakerFn(recipient),
  })

  if (!decision.willAck) {
    if (decision.reason && !NOISY_FALSE_REASONS.has(decision.reason)) {
      console.log(`[voice-ack-on-handoff] gated: reason=${decision.reason} from=${message.from} to=${decision.recipient ?? '?'}`)
    }
    return
  }

  // Fire ack generation + speak fully async — chat write must not wait.
  void (async () => {
    let line = await ackLineFn(recipient)
    if (!line) {
      // Anthropic key missing or call failed. Per spec, silence is
      // preferable to canned chrome — but if the API key is simply not
      // configured, fall back to a tiny pool so dev environments aren't
      // mute. Production has the key set, so this branch is dev-only.
      if (!process.env.ANTHROPIC_API_KEY) {
        line = ACK_FALLBACKS[Math.floor(Math.random() * ACK_FALLBACKS.length)]!
      } else {
        return
      }
    }
    console.log(`[voice-ack-on-handoff] ack: from=${message.from} to=${recipient} line="${line}"`)
    await speakFn(line, recipient)
  })()
}

// Test helper — no module-level mutable state to reset, but keep the
// symbol for parity with voice-on-chat.
export function _resetVoiceAckOnHandoffStateForTest(): void {
  /* no-op */
}
