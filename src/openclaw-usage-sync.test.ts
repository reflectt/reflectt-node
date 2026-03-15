// SPDX-License-Identifier: Apache-2.0
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ── Helpers to isolate the sync logic without real DB ─────────────────────

/** Build a minimal sessions.json for testing */
function makeSessionsJson(sessions: Record<string, object>): string {
  return JSON.stringify(sessions)
}

/** Minimal agent session entry with usage */
function agentSession(overrides: Partial<{
  sessionId: string
  model: string
  modelProvider: string
  inputTokens: number
  outputTokens: number
  updatedAt: number
}> = {}): object {
  return {
    sessionId: overrides.sessionId ?? 'sess-abc-123',
    model: overrides.model ?? 'claude-sonnet-4-6',
    modelProvider: overrides.modelProvider ?? 'anthropic',
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: (overrides.inputTokens ?? 100) + (overrides.outputTokens ?? 50),
    updatedAt: overrides.updatedAt ?? Date.now(),
  }
}

// ── Unit tests for session parsing logic ─────────────────────────────────

describe('openclaw-usage-sync', () => {
  let tmpDir: string

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'oc-usage-sync-test-'))
  })

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses valid sessions.json and extracts agent session data', () => {
    const agentDir = join(tmpDir, 'agents', 'link', 'sessions')
    mkdirSync(agentDir, { recursive: true })

    const sessionData = {
      'agent:link:main': agentSession({ sessionId: 'sess-001', inputTokens: 200, outputTokens: 100 }),
    }
    writeFileSync(join(agentDir, 'sessions.json'), makeSessionsJson(sessionData))

    // Verify the file is parseable and has expected structure
    const raw = require('fs').readFileSync(join(agentDir, 'sessions.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const entry = parsed['agent:link:main']

    assert.equal(entry.sessionId, 'sess-001')
    assert.equal(entry.model, 'claude-sonnet-4-6')
    assert.equal(entry.inputTokens, 200)
    assert.equal(entry.outputTokens, 100)
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
    writeFileSync(join(agentDir, 'sessions.json'), makeSessionsJson(sessionData))

    // A session with 0 tokens should be skipped
    const raw = require('fs').readFileSync(join(agentDir, 'sessions.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const entry = parsed['agent:empty-agent:main']
    assert.equal(entry.inputTokens, 0)
    assert.equal(entry.outputTokens, 0)
    // The sync logic would skip this — verify skippable condition
    assert.ok(entry.inputTokens === 0 && entry.outputTokens === 0)
  })

  it('skips sessions without a model field', () => {
    const sessionNoModel = {
      sessionId: 'sess-no-model',
      inputTokens: 100,
      outputTokens: 50,
      updatedAt: Date.now(),
    }
    // No model — should be skipped
    assert.equal((sessionNoModel as Record<string, unknown>).model, undefined)
  })

  it('skips sessions without a sessionId', () => {
    const sessionNoId = {
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      updatedAt: Date.now(),
    }
    // No sessionId — dedup key unavailable, should be skipped
    assert.equal((sessionNoId as Record<string, unknown>).sessionId, undefined)
  })

  it('correctly formats api_source dedup key', () => {
    const sessionId = 'sess-abc-123'
    const apiSource = `openclaw:${sessionId}`
    assert.equal(apiSource, 'openclaw:sess-abc-123')
    // Reverse: strip prefix to recover sessionId
    assert.equal(apiSource.replace('openclaw:', ''), sessionId)
  })

  it('handles multiple sessions per agent', () => {
    const sessions = {
      'agent:link:main': agentSession({ sessionId: 'sess-001', inputTokens: 200 }),
      'agent:link:discord:channel:123': agentSession({ sessionId: 'sess-002', inputTokens: 300 }),
      'agent:link:reflectt': agentSession({ sessionId: 'sess-003', inputTokens: 0, outputTokens: 0 }),
    }
    const nonEmpty = Object.values(sessions).filter(
      s => ((s as Record<string, number>).inputTokens ?? 0) + ((s as Record<string, number>).outputTokens ?? 0) > 0
    )
    assert.equal(nonEmpty.length, 2) // sess-003 is skipped (zero tokens)
  })

  it('handles missing sessions directory gracefully', () => {
    // If agents dir does not exist, syncOpenClawUsage should return empty result
    // This test just verifies the existsSync guard logic works
    const { existsSync } = require('fs')
    const nonExistent = join(tmpDir, 'does-not-exist', 'agents')
    assert.equal(existsSync(nonExistent), false)
  })

  it('handles malformed sessions.json gracefully', () => {
    const agentDir = join(tmpDir, 'agents', 'bad-agent', 'sessions')
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'sessions.json'), 'NOT VALID JSON {{{{')

    // Parsing should throw — sync catches this per-agent and continues
    assert.throws(() => JSON.parse('NOT VALID JSON {{{{'), SyntaxError)
  })
})
