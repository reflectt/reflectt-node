import { describe, it, expect, beforeEach } from 'vitest'
import {
  isSpeakable,
  buildSpeakableText,
  decideVoiceTrigger,
  _resetVoiceOnChatStateForTest,
} from '../src/voice-on-chat.js'

describe('voice-on-chat: speakability filter', () => {
  it('accepts a normal sentence', () => {
    expect(isSpeakable('I just finished reviewing the new design proposal.')).toBe(true)
  })

  it('rejects messages under 8 chars', () => {
    expect(isSpeakable('hi')).toBe(false)
    expect(isSpeakable('       ')).toBe(false)
  })

  it('rejects mention-only inter-agent pings', () => {
    expect(isSpeakable('@kai @link')).toBe(false)
    expect(isSpeakable('@pixel ack')).toBe(false)
  })

  it('rejects standalone commit hash strings', () => {
    expect(isSpeakable('a1b2c3d4 shipped')).toBe(false)
    expect(isSpeakable('1ac8938f')).toBe(false)
  })

  it('rejects PR/CI status lines', () => {
    expect(isSpeakable('merged PR #1234 into main')).toBe(false)
    expect(isSpeakable('CI green for build 4582')).toBe(false)
    expect(isSpeakable('pushed branch to origin')).toBe(false)
  })

  it('rejects code-heavy messages', () => {
    expect(isSpeakable('use `foo()` and `bar()` together')).toBe(false)
  })

  it('rejects npm/git/CI terminal output', () => {
    expect(isSpeakable('npm install failed because of peer deps')).toBe(false)
    expect(isSpeakable('git push origin main')).toBe(false)
    expect(isSpeakable('error TS2345 at line 42')).toBe(false)
  })

  it('rejects messages over 350 chars', () => {
    expect(isSpeakable('x'.repeat(351))).toBe(false)
  })

  it('rejects messages that become empty after cleaning', () => {
    expect(isSpeakable('@kai @link @pixel #1234 @sage')).toBe(false)
  })
})

describe('voice-on-chat: buildSpeakableText', () => {
  it('strips mentions, hashes, refs, code, collapses whitespace', () => {
    const out = buildSpeakableText('@kai I just shipped abc1234 with `useThing` for #1290 — all green!')
    expect(out).not.toContain('@kai')
    expect(out).not.toContain('abc1234')
    expect(out).not.toContain('#1290')
    expect(out).not.toContain('`useThing`')
    expect(out).not.toMatch(/\s{2,}/)
    expect(out.length).toBeGreaterThan(8)
    expect(out.length).toBeLessThanOrEqual(200)
  })

  it('returns empty string when input is not speakable', () => {
    expect(buildSpeakableText('@kai @link')).toBe('')
  })

  it('caps at 200 chars', () => {
    const long = 'This is a thoughtful agent reply ' + 'extending '.repeat(40)
    const out = buildSpeakableText(long.slice(0, 350))
    expect(out.length).toBeLessThanOrEqual(200)
  })
})

describe('voice-on-chat: decideVoiceTrigger', () => {
  beforeEach(() => {
    _resetVoiceOnChatStateForTest()
  })

  const baseMsg = {
    from: 'compass',
    channel: 'general',
    content: 'I just finished reviewing the new design proposal.',
  }
  const now = 1_700_000_000_000

  it('willSpeak when all gates pass', () => {
    expect(decideVoiceTrigger(baseMsg, now, 1).willSpeak).toBe(true)
  })

  it('rejects non-general channels', () => {
    const d = decideVoiceTrigger({ ...baseMsg, channel: 'devops' }, now, 1)
    expect(d.willSpeak).toBe(false)
    expect(d.reason).toBe('channel-not-general')
  })

  it('treats undefined channel as general', () => {
    const d = decideVoiceTrigger({ ...baseMsg, channel: undefined }, now, 1)
    expect(d.willSpeak).toBe(true)
  })

  it('rejects system / human / user senders', () => {
    expect(decideVoiceTrigger({ ...baseMsg, from: 'system' }, now, 1).reason).toBe('sender-not-agent')
    expect(decideVoiceTrigger({ ...baseMsg, from: 'human' }, now, 1).reason).toBe('sender-not-agent')
    expect(decideVoiceTrigger({ ...baseMsg, from: 'user' }, now, 1).reason).toBe('sender-not-agent')
    expect(decideVoiceTrigger({ ...baseMsg, from: 'HUMAN' }, now, 1).reason).toBe('sender-not-agent')
  })

  it('rejects when no humans in room', () => {
    const d = decideVoiceTrigger(baseMsg, now, 0)
    expect(d.willSpeak).toBe(false)
    expect(d.reason).toBe('no-humans-in-room')
  })

  it('rejects unspeakable content', () => {
    const d = decideVoiceTrigger({ ...baseMsg, content: '@kai ack' }, now, 1)
    expect(d.willSpeak).toBe(false)
    expect(d.reason).toBe('not-speakable')
  })

  // Cooldown + content-dedup state lives in module-level vars stamped by
  // triggerVoiceOnChat (not by decideVoiceTrigger). Verified end-to-end on
  // canonical staging — pure-function unit cover is intentionally limited
  // to the gate branches above.
})
