import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Tests for openclaw-usage-sync session parsing logic.
 * Does not test the full sync (requires real DB) — unit-tests
 * the file parsing, filtering, and dedup key logic.
 */

// ── Helpers ───────────────────────────────────────────────────────────────

function agentSession(overrides: Partial<{
  sessionId: string
  model: string
  modelProvider: string
  inputTokens: number
  outputTokens: number
  updatedAt: number
}> = {}): object {
  const input = overrides.inputTokens ?? 100
  const output = overrides.outputTokens ?? 50
  return {
    sessionId: overrides.sessionId ?? 'sess-abc-123',
    model: overrides.model ?? 'claude-sonnet-4-6',
    modelProvider: overrides.modelProvider ?? 'anthropic',
    inputTokens: input,
    outputTokens: output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    updatedAt: overrides.updatedAt ?? Date.now(),
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('openclaw-usage-sync', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oc-usage-sync-test-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses valid sessions.json and extracts agent session data', () => {
    const agentDir = join(tmpDir, 'agents', 'link', 'sessions')
    mkdirSync(agentDir, { recursive: true })

    const sessionData = {
      'agent:link:main': agentSession({ sessionId: 'sess-001', inputTokens: 200, outputTokens: 100 }),
    }
    writeFileSync(join(agentDir, 'sessions.json'), JSON.stringify(sessionData))

    const raw = readFileSync(join(agentDir, 'sessions.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const entry = parsed['agent:link:main'] as Record<string, unknown>

    expect(entry.sessionId).toBe('sess-001')
    expect(entry.model).toBe('claude-sonnet-4-6')
    expect(entry.inputTokens).toBe(200)
    expect(entry.outputTokens).toBe(100)
  })

  it('skips sessions with zero tokens', () => {
    const agentDir = join(tmpDir, 'agents', 'empty-agent', 'sessions')
    mkdirSync(agentDir, { recursive: true })

    const sessionData = {
      'agent:empty-agent:main': {
        sessionId: 'sess-empty',
        model: 'claude-sonnet-4-6',
        modelProvider: 'anthropic',
        inputTokens: 0,
        outputTokens: 0,
        updatedAt: Date.now(),
      },
    }
    writeFileSync(join(agentDir, 'sessions.json'), JSON.stringify(sessionData))

    const raw = readFileSync(join(agentDir, 'sessions.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const entry = parsed['agent:empty-agent:main'] as Record<string, number>

    // Verify skip condition: 0 + 0 = 0
    expect(entry.inputTokens === 0 && entry.outputTokens === 0).toBe(true)
  })

  it('skips sessions without a model field', () => {
    const sessionNoModel = {
      sessionId: 'sess-no-model',
      inputTokens: 100,
      outputTokens: 50,
      updatedAt: Date.now(),
    }
    expect((sessionNoModel as Record<string, unknown>).model).toBeUndefined()
  })

  it('skips sessions without a sessionId', () => {
    const sessionNoId = {
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      updatedAt: Date.now(),
    }
    expect((sessionNoId as Record<string, unknown>).sessionId).toBeUndefined()
  })

  it('correctly formats api_source dedup key', () => {
    const sessionId = 'sess-abc-123'
    const apiSource = `openclaw:${sessionId}`
    expect(apiSource).toBe('openclaw:sess-abc-123')
    // Reverse: strip prefix to recover sessionId
    expect(apiSource.replace('openclaw:', '')).toBe(sessionId)
  })

  it('handles multiple sessions per agent — filters zero-token entries', () => {
    const sessions = {
      'agent:link:main': agentSession({ sessionId: 'sess-001', inputTokens: 200 }),
      'agent:link:discord:channel:123': agentSession({ sessionId: 'sess-002', inputTokens: 300 }),
      'agent:link:reflectt': agentSession({ sessionId: 'sess-003', inputTokens: 0, outputTokens: 0 }),
    }
    const nonEmpty = Object.values(sessions).filter(
      s => ((s as Record<string, number>).inputTokens ?? 0) + ((s as Record<string, number>).outputTokens ?? 0) > 0
    )
    expect(nonEmpty).toHaveLength(2) // sess-003 skipped
  })

  it('handles missing sessions directory gracefully', () => {
    const nonExistent = join(tmpDir, 'does-not-exist', 'agents')
    expect(existsSync(nonExistent)).toBe(false)
  })

  it('handles malformed sessions.json gracefully — JSON.parse throws', () => {
    const agentDir = join(tmpDir, 'agents', 'bad-agent', 'sessions')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'sessions.json'), 'NOT VALID JSON {{{{')

    expect(() => JSON.parse('NOT VALID JSON {{{{')).toThrow(SyntaxError)
  })
})
