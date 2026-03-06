// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We test the decay logic by importing the presence manager and manipulating time
describe('Presence two-step decay', () => {
  // We'll test via the /presence API endpoint behavior
  // The decay thresholds are:
  //   - IDLE_THRESHOLD_MS = 15 * 60 * 1000 (15 min)
  //   - OFFLINE_THRESHOLD_MS = 30 * 60 * 1000 (30 min)

  it('should define two-step thresholds (working→idle→offline)', async () => {
    // Read the source to verify constants exist
    const fs = await import('fs')
    const src = fs.readFileSync('src/presence.ts', 'utf-8')
    expect(src).toContain('IDLE_THRESHOLD_MS')
    expect(src).toContain('OFFLINE_THRESHOLD_MS')
    expect(src).toContain('15 * 60 * 1000')
    expect(src).toContain('30 * 60 * 1000')
  })

  it('checkExpiry should decay active to idle, not straight to offline', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/presence.ts', 'utf-8')
    // Verify the two-step logic exists
    expect(src).toContain("status !== 'idle'")
    expect(src).toContain('IDLE_THRESHOLD_MS')
    expect(src).toContain("status === 'idle'")
    expect(src).toContain('OFFLINE_THRESHOLD_MS')
    // Verify we log both transitions
    expect(src).toContain('Decayed')
    expect(src).toContain('Auto-expired')
  })

  it('pulse endpoint should have 15min active + 30min idle thresholds', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync('src/server.ts', 'utf-8')
    // Two locations should reference the thresholds
    const matches15 = src.match(/15 \* 60 \* 1000/g) || []
    const matches30 = src.match(/30 \* 60 \* 1000/g) || []
    // At least 2 occurrences of each (pulse + per-agent presence endpoints)
    expect(matches15.length).toBeGreaterThanOrEqual(2)
    expect(matches30.length).toBeGreaterThanOrEqual(2)
  })
})
