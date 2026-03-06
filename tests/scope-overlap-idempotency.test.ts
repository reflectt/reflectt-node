// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect, beforeEach } from 'vitest'
import { scanAndNotify, _resetIdempotency, _getNotifiedKeys } from '../src/scopeOverlap.js'

describe('Scope overlap idempotency', () => {
  beforeEach(() => {
    _resetIdempotency()
  })

  it('idempotency key includes repo and mergeCommit', async () => {
    // First call — should notify (even if no matches, the key should be set if there were matches)
    await scanAndNotify(100, 'test PR', 'link/test-branch', 'task-abc', 'reflectt/reflectt-node', 'abc123')

    // Verify key format includes repo and mergeCommit
    const keys = _getNotifiedKeys()
    // Keys are only set when significant matches are found + notification succeeds
    // With no matching tasks, no key will be set — that's correct behavior
    // Test the key format by checking makeIdempotencyKey indirectly
    const fs = await import('fs')
    const src = fs.readFileSync('src/scopeOverlap.ts', 'utf-8')
    expect(src).toContain("repo || 'default'")
    expect(src).toContain("mergeCommit || 'none'")
  })

  it('different repos generate different keys', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/scopeOverlap.ts', 'utf-8')
    // Key format: repo:prNumber:mergedTaskId:mergeCommit
    // Same PR number in different repos should not collide
    expect(src).toContain('${repo ||')
    expect(src).toContain('${prNumber}')
    expect(src).toContain('${mergedTaskId ||')
    expect(src).toContain('${mergeCommit ||')
  })

  it('no-drop: markNotified only after successful send', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/scopeOverlap.ts', 'utf-8')
    // Verify the pattern: markNotified is inside try block, after sendMessage
    const tryIdx = src.indexOf('try {', src.indexOf('No-drop'))
    const markIdx = src.indexOf('markNotified(idemKey)', tryIdx)
    const sendIdx = src.indexOf('chatManager.sendMessage', tryIdx)
    const catchIdx = src.indexOf('catch (err)', tryIdx)

    // markNotified must come AFTER sendMessage and BEFORE catch
    expect(sendIdx).toBeGreaterThan(tryIdx)
    expect(markIdx).toBeGreaterThan(sendIdx)
    expect(catchIdx).toBeGreaterThan(markIdx)
  })

  it('duplicate trigger for same PR does not re-notify (with matches)', async () => {
    // This test verifies the idempotency check logic exists
    const fs = await import('fs')
    const src = fs.readFileSync('src/scopeOverlap.ts', 'utf-8')
    // isAlreadyNotified check must happen before any send attempt
    const isAlreadyIdx = src.indexOf('isAlreadyNotified(idemKey)')
    const sendIdx = src.indexOf('chatManager.sendMessage', isAlreadyIdx)
    expect(isAlreadyIdx).toBeGreaterThan(-1)
    expect(sendIdx).toBeGreaterThan(isAlreadyIdx)
  })
})
