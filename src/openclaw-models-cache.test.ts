// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  putEnvelope,
  getCachedEnvelope,
  clearEnvelope,
  isStale,
} from './openclaw-models-cache.js'
import type { ModelsEnvelope } from './openclaw-models-types.js'

function makeEnvelope(overrides: Partial<ModelsEnvelope> = {}): ModelsEnvelope {
  return {
    evaluatedAt: 1_000,
    publishedAt: 2_000,
    ok: true,
    errors: [],
    cliVersion: '0.42.0',
    catalog: {
      models: [{ key: 'openai/gpt-4.1', provider: 'openai', displayName: 'GPT-4.1', available: true }],
      providers: [{ id: 'openai', authState: 'authenticated' }],
    },
    ...overrides,
  }
}

describe('openclaw-models-cache', () => {
  beforeEach(() => clearEnvelope())

  it('returns null before any publish', () => {
    assert.equal(getCachedEnvelope(), null)
  })

  it('stores last-write-wins on put', () => {
    putEnvelope(makeEnvelope({ publishedAt: 100 }))
    putEnvelope(makeEnvelope({ publishedAt: 200 }))
    const cached = getCachedEnvelope()
    assert.equal(cached?.envelope.publishedAt, 200)
  })

  it('preserves last-known across multiple reads (no eviction)', () => {
    putEnvelope(makeEnvelope())
    const a = getCachedEnvelope()
    const b = getCachedEnvelope()
    assert.equal(a, b)
    assert.ok(a !== null)
  })

  it('stamps receivedAt at put time', () => {
    const before = Date.now()
    const cached = putEnvelope(makeEnvelope())
    const after = Date.now()
    assert.ok(cached.receivedAt >= before && cached.receivedAt <= after)
  })

  it('isStale returns false when maxAgeMs is undefined', () => {
    const cached = putEnvelope(makeEnvelope({ publishedAt: 0 }))
    assert.equal(isStale(cached, 999_999), false)
  })

  it('isStale returns false within maxAgeMs window', () => {
    const cached = putEnvelope(makeEnvelope({ publishedAt: 1_000, maxAgeMs: 5_000 }))
    assert.equal(isStale(cached, 4_000), false)
  })

  it('isStale returns true past maxAgeMs window', () => {
    const cached = putEnvelope(makeEnvelope({ publishedAt: 1_000, maxAgeMs: 5_000 }))
    assert.equal(isStale(cached, 7_000), true)
  })

  it('preserves degraded envelopes (ok:false) the same as healthy ones', () => {
    putEnvelope(makeEnvelope({ ok: false, errors: ['cli not found'], catalog: null }))
    const cached = getCachedEnvelope()
    assert.equal(cached?.envelope.ok, false)
    assert.deepEqual(cached?.envelope.errors, ['cli not found'])
    assert.equal(cached?.envelope.catalog, null)
  })
})
