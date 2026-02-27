// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest'
import { resolveGitHubTokenForActor } from '../src/github-actor-auth.js'

// Unit tests for env fallback (vault tests live elsewhere)

describe('resolveGitHubTokenForActor (env fallback)', () => {
  it('uses GH_TOKEN_<ACTOR> when present', () => {
    process.env.GH_TOKEN_KAI = 'tok_kai'
    const r = resolveGitHubTokenForActor('kai')
    expect(r?.token).toBe('tok_kai')
    expect(r?.envKey).toBe('GH_TOKEN_KAI')
    delete process.env.GH_TOKEN_KAI
  })

  it('falls back to GH_TOKEN when actor-specific missing', () => {
    process.env.GH_TOKEN = 'tok_default'
    const r = resolveGitHubTokenForActor('someone')
    expect(r?.token).toBe('tok_default')
    expect(r?.envKey).toBe('GH_TOKEN')
    delete process.env.GH_TOKEN
  })
})
