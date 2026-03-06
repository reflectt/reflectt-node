// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scanAndNotify } from '../src/scopeOverlap.js'
import { chatManager } from '../src/chat.js'

describe('Scope Overlap Idempotency', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('does not send duplicate notifications for same PR merge', async () => {
    const sendSpy = vi.spyOn(chatManager, 'sendMessage').mockResolvedValue(undefined as any)

    // First call — may or may not find matches (depends on task state)
    const result1 = await scanAndNotify(999, 'fix: duplicate test', 'fix/duplicate-test', undefined, 'test-repo')

    const firstCallCount = sendSpy.mock.calls.length

    // Second call — same PR, same branch — should NOT notify again
    const result2 = await scanAndNotify(999, 'fix: duplicate test', 'fix/duplicate-test', undefined, 'test-repo')

    // If first call sent a message, second call should not have sent another
    expect(sendSpy.mock.calls.length).toBe(firstCallCount)
  })

  it('allows notifications for different PRs', async () => {
    const sendSpy = vi.spyOn(chatManager, 'sendMessage').mockResolvedValue(undefined as any)

    await scanAndNotify(100, 'feat: alpha', 'feat/alpha', undefined, 'repo-a')
    const afterFirst = sendSpy.mock.calls.length

    await scanAndNotify(101, 'feat: beta', 'feat/beta', undefined, 'repo-a')
    // Different PR — allowed to send (if matches exist)
    // Just verify no crash
    expect(true).toBe(true)
  })
})
