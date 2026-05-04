// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseHandoffTarget,
  decideHandoffAck,
  clampAckLine,
  triggerHandoffAck,
} from './voice-ack-on-handoff.js'
import type { AgentMessage } from './types.js'

function msg(partial: Partial<AgentMessage>): AgentMessage {
  return {
    id: partial.id ?? 'm1',
    from: partial.from ?? 'kai',
    content: partial.content ?? '',
    timestamp: partial.timestamp ?? Date.now(),
    channel: partial.channel,
    to: partial.to,
  }
}

describe('parseHandoffTarget', () => {
  it('parses real /handoff to=name', () => {
    assert.equal(parseHandoffTarget('/handoff to=link'), 'link')
    // Mixed-case input must lowercase: parser canonicalizes target.
    assert.equal(parseHandoffTarget('/handoff to=PiXeL please look'), 'pixel')
    assert.equal(parseHandoffTarget('  /handoff   to=pixel  '), 'pixel')
  })

  it('rejects typos in cloud SDK accept-set (strict on node side)', () => {
    assert.equal(parseHandoffTarget('/handof to=link'), null)
    assert.equal(parseHandoffTarget('/andoff to=link'), null)
    assert.equal(parseHandoffTarget('/andof to=link'), null)
  })

  it('rejects when to=... is missing', () => {
    assert.equal(parseHandoffTarget('/handoff link'), null)
    assert.equal(parseHandoffTarget('/handoff'), null)
  })

  it('rejects malformed recipient names', () => {
    assert.equal(parseHandoffTarget('/handoff to=2pac'), null)
    assert.equal(parseHandoffTarget('/handoff to=-link'), null)
    assert.equal(parseHandoffTarget('/handoff to='), null)
  })

  it('does not match prefix without whitespace boundary', () => {
    assert.equal(parseHandoffTarget('/handoffish to=link'), null)
  })

  it('ignores embedded mentions or follow-up text', () => {
    assert.equal(parseHandoffTarget('@link please look at this'), null)
    assert.equal(parseHandoffTarget('hey, can you /handoff to=link?'), null)
  })
})

describe('decideHandoffAck — gate order', () => {
  const baseInput = {
    humansInRoom: 1,
    recipientVoiceCapable: true,
    recipientActiveSpeaker: false,
  }

  it('willAck=true on the happy path', () => {
    const d = decideHandoffAck({ ...baseInput, message: msg({ from: 'kai', content: '/handoff to=link' }) })
    assert.equal(d.willAck, true)
    assert.equal(d.recipient, 'link')
  })

  it('rejects non-general channels', () => {
    const d = decideHandoffAck({ ...baseInput, message: msg({ from: 'kai', channel: 'dm:a_b', content: '/handoff to=link' }) })
    assert.equal(d.willAck, false)
    assert.equal(d.reason, 'channel-not-general')
  })

  it('rejects system-authored handoffs', () => {
    const d = decideHandoffAck({ ...baseInput, message: msg({ from: 'system', content: '/handoff to=link' }) })
    assert.equal(d.willAck, false)
    assert.equal(d.reason, 'sender-system')
  })

  it('rejects when content is not a real /handoff', () => {
    const d = decideHandoffAck({ ...baseInput, message: msg({ from: 'kai', content: 'thanks @link' }) })
    assert.equal(d.willAck, false)
    assert.equal(d.reason, 'not-handoff')
  })

  it('rejects self-handoff', () => {
    const d = decideHandoffAck({ ...baseInput, message: msg({ from: 'link', content: '/handoff to=link' }) })
    assert.equal(d.willAck, false)
    assert.equal(d.reason, 'self-handoff')
  })

  it('rejects when recipient is not voice-capable', () => {
    const d = decideHandoffAck({ ...baseInput, recipientVoiceCapable: false, message: msg({ from: 'kai', content: '/handoff to=link' }) })
    assert.equal(d.willAck, false)
    assert.equal(d.reason, 'recipient-not-voicecapable')
  })

  it('rejects when no humans are in the room', () => {
    const d = decideHandoffAck({ ...baseInput, humansInRoom: 0, message: msg({ from: 'kai', content: '/handoff to=link' }) })
    assert.equal(d.willAck, false)
    assert.equal(d.reason, 'no-humans-in-room')
  })

  it('rejects when recipient is already mid-TTS', () => {
    const d = decideHandoffAck({ ...baseInput, recipientActiveSpeaker: true, message: msg({ from: 'kai', content: '/handoff to=link' }) })
    assert.equal(d.willAck, false)
    assert.equal(d.reason, 'recipient-already-speaking')
  })
})

describe('clampAckLine', () => {
  it('returns 1–4 word ack and trims terminal punctuation', () => {
    assert.equal(clampAckLine('on it'), 'on it')
    assert.equal(clampAckLine('on it!'), 'on it')
    assert.equal(clampAckLine('  got it.  '), 'got it')
  })

  it('truncates >4 word lines to first 4 words', () => {
    assert.equal(clampAckLine('yes I am taking this one right now'), 'yes I am taking')
  })

  it('strips wrapping quotes', () => {
    assert.equal(clampAckLine('"on it"'), 'on it')
    assert.equal(clampAckLine('“taking that”'), 'taking that')
  })

  it('uses only the first non-empty line', () => {
    assert.equal(clampAckLine('\non it\nmore stuff'), 'on it')
  })

  it('returns empty for empty input', () => {
    assert.equal(clampAckLine(''), '')
    assert.equal(clampAckLine('   '), '')
  })
})

describe('triggerHandoffAck — wiring', () => {
  it('does NOT speak when message is not a /handoff (fast-path skip)', () => {
    let spoken = false
    triggerHandoffAck(msg({ from: 'kai', content: 'hi @link' }), {
      humansInRoom: () => 5,
      voiceCapable: () => true,
      activeSpeaker: () => false,
      ackLine: async () => 'on it',
      speak: async () => { spoken = true },
    })
    assert.equal(spoken, false)
  })

  it('does NOT speak when gate fails (no humans)', async () => {
    let spoken = false
    triggerHandoffAck(msg({ from: 'kai', content: '/handoff to=link' }), {
      humansInRoom: () => 0,
      voiceCapable: () => true,
      activeSpeaker: () => false,
      ackLine: async () => 'on it',
      speak: async () => { spoken = true },
    })
    // Async path is fire-and-forget; gate runs synchronously, but speak
    // would have been queued via void IIFE. Wait a tick.
    await new Promise(r => setTimeout(r, 50))
    assert.equal(spoken, false)
  })

  it('speaks the recipient-authored ack on happy path', async () => {
    let spokenText = ''
    let spokenAgent = ''
    triggerHandoffAck(msg({ from: 'kai', content: '/handoff to=link please look' }), {
      humansInRoom: () => 2,
      voiceCapable: () => true,
      activeSpeaker: () => false,
      ackLine: async () => 'on it',
      speak: async (text, agentId) => { spokenText = text; spokenAgent = agentId },
    })
    await new Promise(r => setTimeout(r, 50))
    assert.equal(spokenText, 'on it')
    assert.equal(spokenAgent, 'link')
  })

  it('stays silent when ackLine returns empty (no canned chrome)', async () => {
    // Simulate "key is configured" path so the empty-ackLine branch goes
    // silent rather than fall through to the dev-only canned pool.
    const envKey = 'ANTHROPIC_' + 'API_' + 'KEY'
    const prev = process.env[envKey]
    process.env[envKey] = 'k'
    try {
      let spoken = false
      triggerHandoffAck(msg({ from: 'kai', content: '/handoff to=link' }), {
        humansInRoom: () => 2,
        voiceCapable: () => true,
        activeSpeaker: () => false,
        ackLine: async () => '',
        speak: async () => { spoken = true },
      })
      await new Promise(r => setTimeout(r, 50))
      assert.equal(spoken, false)
    } finally {
      if (prev === undefined) delete process.env[envKey]
      else process.env[envKey] = prev
    }
  })

  it('stays silent when recipient is already speaking', async () => {
    let spoken = false
    triggerHandoffAck(msg({ from: 'kai', content: '/handoff to=link' }), {
      humansInRoom: () => 2,
      voiceCapable: () => true,
      activeSpeaker: () => true,
      ackLine: async () => 'on it',
      speak: async () => { spoken = true },
    })
    await new Promise(r => setTimeout(r, 50))
    assert.equal(spoken, false)
  })
})
