// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Regression for the managed-host cloud-delivery seam:
//   Before this fix, when the cloud started rejecting a host's credential
//   ("Invalid or expired token"), the node kept sending the same dead bearer
//   forever. heartbeat/chat sync stopped, every cloudPost piled into the
//   error counter, and canvas messages sitting in the cloud's outbound queue
//   never reached the host (delivered=false).
//
// task-1776807913205-71z35p70j (managed-host canvas chat delivery)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { _testInternals, startCloudIntegration, stopCloudIntegration } from '../src/cloud.js'

const realFetch = globalThis.fetch

beforeEach(() => {
  _testInternals.reset()
  _testInternals.configure({
    cloudUrl: 'https://cloud.test',
    token: 'join-tok-XXXX',
    hostName: 'rn-test-host',
  })
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('cloud credential auto-reclaim', () => {
  it('on "Invalid or expired token", drops the bad credential, re-claims, and retries the original request', async () => {
    _testInternals.setHostId('host-old')
    _testInternals.setCredential('cred-stale')

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization

      if (url.endsWith('/api/hosts/test/heartbeat') && auth === 'Bearer cred-stale') {
        return jsonResponse(401, { error: 'Invalid or expired token' })
      }
      if (url.endsWith('/api/hosts/claim') && auth === 'Bearer join-tok-XXXX') {
        return jsonResponse(200, {
          host: { id: 'host-new' },
          credential: { token: 'cred-fresh' },
        })
      }
      if (url.endsWith('/api/hosts/test/heartbeat') && auth === 'Bearer cred-fresh') {
        return jsonResponse(200, { ok: true })
      }
      throw new Error(`Unexpected fetch: ${url} (auth=${auth})`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const result = await _testInternals.cloudPost<{ ok: boolean }>('/api/hosts/test/heartbeat', { tick: 1 })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ ok: true })
    expect(_testInternals.getCredential()).toBe('cred-fresh')
    expect(_testInternals.getHostId()).toBe('host-new')

    const events = _testInternals.getConnectionEvents().map(e => e.type)
    expect(events).toContain('credential_reclaim_attempt')
    expect(events).toContain('credential_reclaim_success')

    // 3 calls: original (rejected) → claim → retry (succeeds)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry indefinitely if reclaim itself is rejected', async () => {
    _testInternals.setHostId('host-old')
    _testInternals.setCredential('cred-stale')

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/api/hosts/claim')) {
        return jsonResponse(401, { error: 'Invalid or expired token' })
      }
      return jsonResponse(401, { error: 'Invalid or expired token' })
    })
    globalThis.fetch = fetchMock as typeof fetch

    const result = await _testInternals.cloudPost('/api/hosts/test/heartbeat', { tick: 1 })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/invalid or expired token/i)
    // Original credential preserved so the next operator-driven recovery can see what cloud rejected
    expect(_testInternals.getCredential()).toBe('cred-stale')

    const failures = _testInternals.getConnectionEvents().filter(e => e.type === 'credential_reclaim_failed')
    expect(failures.length).toBe(1)

    // 2 calls: original (rejected) → claim (also rejected). No infinite retry.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('skips reclaim when no join token is configured (managed-only host without REFLECTT_HOST_TOKEN)', async () => {
    _testInternals.configure({
      cloudUrl: 'https://cloud.test',
      token: '', // no join token — operator-only recovery path
      hostName: 'rn-managed-no-jointoken',
    })
    _testInternals.setHostId('host-mgd')
    _testInternals.setCredential('cred-stale')

    const fetchMock = vi.fn(async () => jsonResponse(401, { error: 'Invalid or expired token' }))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await _testInternals.cloudPost('/api/hosts/test/heartbeat', {})

    expect(result.success).toBe(false)
    // Single call — no reclaim attempted because there's no join token to use
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const failures = _testInternals.getConnectionEvents().filter(e => e.type === 'credential_reclaim_failed')
    expect(failures.length).toBe(1)
    expect(failures[0].reason).toMatch(/no join token/i)
  })

  it('coalesces concurrent rejections into a single reclaim (single-flight)', async () => {
    _testInternals.setHostId('host-old')
    _testInternals.setCredential('cred-stale')

    let claimCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization

      if (url.endsWith('/api/hosts/claim')) {
        claimCallCount++
        // Slow response so concurrent callers actually overlap
        await new Promise(r => setTimeout(r, 20))
        return jsonResponse(200, {
          host: { id: 'host-new' },
          credential: { token: 'cred-fresh' },
        })
      }
      if (auth === 'Bearer cred-stale') {
        return jsonResponse(401, { error: 'Invalid or expired token' })
      }
      if (auth === 'Bearer cred-fresh') {
        return jsonResponse(200, { ok: true })
      }
      throw new Error(`Unexpected: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const [a, b, c] = await Promise.all([
      _testInternals.cloudPost('/api/hosts/test/a', {}),
      _testInternals.cloudPost('/api/hosts/test/b', {}),
      _testInternals.cloudPost('/api/hosts/test/c', {}),
    ])

    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
    expect(c.success).toBe(true)
    expect(claimCallCount).toBe(1) // single-flight: one claim covers all three
  })

  // Regression: live managed host rn-fb6f9131-dx35x7.fly.dev (PR #1277 follow-up).
  // After the auto-reclaim shipped, fresh managed hosts still wedged on
  // "Invalid or expired token" — every heartbeat tick logged
  //   credential_reclaim_failed: no join token configured
  // because managed-host bootstrap sets REFLECTT_HOST_ID + REFLECTT_HOST_CREDENTIAL
  // but never sets REFLECTT_HOST_TOKEN. The cli.ts startup path already mirrors
  // credential→token (cli.ts:132); the env-var path in cloud.ts did not. Without
  // this fallback, the join-token branch in attemptCredentialReclaim() bails
  // before even calling /api/hosts/claim, so heartbeat/chat sync never resumes.
  it('falls back to REFLECTT_HOST_CREDENTIAL as the reclaim join token when REFLECTT_HOST_TOKEN is unset (managed-host startup)', async () => {
    const prevToken = process.env.REFLECTT_HOST_TOKEN
    const prevId = process.env.REFLECTT_HOST_ID
    const prevCred = process.env.REFLECTT_HOST_CREDENTIAL
    const prevUrl = process.env.REFLECTT_CLOUD_URL
    const prevName = process.env.REFLECTT_HOST_NAME
    delete process.env.REFLECTT_HOST_TOKEN
    process.env.REFLECTT_HOST_ID = 'host-mgd'
    process.env.REFLECTT_HOST_CREDENTIAL = 'cred-mgd-bootstrap'
    process.env.REFLECTT_CLOUD_URL = 'https://cloud.test'
    process.env.REFLECTT_HOST_NAME = 'rn-managed-test'

    _testInternals.reset()

    // Mock fetch so startCloudIntegration's first heartbeat 401s and the reclaim
    // path is actually exercised end-to-end through the env-resolved config.
    globalThis.fetch = vi.fn(async () => jsonResponse(401, { error: 'Invalid or expired token' })) as typeof fetch

    try {
      await startCloudIntegration()
      // Token must resolve to the credential value, not '' — otherwise reclaim
      // bails on "no join token configured".
      expect(_testInternals.getConfigToken()).toBe('cred-mgd-bootstrap')
    } finally {
      stopCloudIntegration()
      if (prevToken === undefined) delete process.env.REFLECTT_HOST_TOKEN; else process.env.REFLECTT_HOST_TOKEN = prevToken
      if (prevId === undefined) delete process.env.REFLECTT_HOST_ID; else process.env.REFLECTT_HOST_ID = prevId
      if (prevCred === undefined) delete process.env.REFLECTT_HOST_CREDENTIAL; else process.env.REFLECTT_HOST_CREDENTIAL = prevCred
      if (prevUrl === undefined) delete process.env.REFLECTT_CLOUD_URL; else process.env.REFLECTT_CLOUD_URL = prevUrl
      if (prevName === undefined) delete process.env.REFLECTT_HOST_NAME; else process.env.REFLECTT_HOST_NAME = prevName
    }
  })

  it('does not reclaim for the claim endpoint itself (no recursion)', async () => {
    _testInternals.setHostId('host-old')
    _testInternals.setCredential('cred-stale')

    const fetchMock = vi.fn(async () => jsonResponse(401, { error: 'Invalid or expired token' }))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await _testInternals.cloudPost('/api/hosts/claim', { joinToken: 'join-tok-XXXX' })

    expect(result.success).toBe(false)
    // Exactly one call — claim endpoint must not trigger reclaim of itself
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
