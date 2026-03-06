// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect } from 'vitest'
import { generatePulse, generateCompactPulse } from '../src/pulse.js'

describe('Team Pulse', () => {
  it('returns a valid pulse snapshot', () => {
    const pulse = generatePulse()
    expect(pulse.ts).toBeGreaterThan(0)
    expect(pulse.board).toBeDefined()
    expect(typeof pulse.board.todo).toBe('number')
    expect(typeof pulse.board.doing).toBe('number')
    expect(typeof pulse.board.validating).toBe('number')
    expect(typeof pulse.board.done).toBe('number')
    expect(typeof pulse.board.blocked).toBe('number')
    expect(Array.isArray(pulse.agents)).toBe(true)
    expect(Array.isArray(pulse.pendingReviews)).toBe(true)
    expect(pulse.deploy).toBeDefined()
    expect(typeof pulse.deploy!.pid).toBe('number')
  })

  it('returns recentActivity with message and task counts', () => {
    const pulse = generatePulse()
    expect(pulse.recentActivity).toBeDefined()
    expect(typeof pulse.recentActivity!.messagesLastHour).toBe('number')
    expect(typeof pulse.recentActivity!.tasksCompletedToday).toBe('number')
  })

  it('compact pulse is under 2000 chars', () => {
    const compact = generateCompactPulse()
    const serialized = JSON.stringify(compact)
    expect(serialized.length).toBeLessThan(2000)
    expect(compact.ts).toBeGreaterThan(0)
    expect(typeof compact.board).toBe('string')
    expect(compact.board).toMatch(/T:\d+ D:\d+ V:\d+ ✓:\d+ B:\d+/)
    expect(Array.isArray(compact.agents)).toBe(true)
    expect(Array.isArray(compact.reviews)).toBe(true)
  })

  it('compact pulse includes focus when set', () => {
    // Focus may or may not be set in test environment
    const compact = generateCompactPulse()
    expect('focus' in compact).toBe(true)
    // focus is either a string or null
    expect(compact.focus === null || typeof compact.focus === 'string').toBe(true)
  })

  it('agents array includes status and optional doingTask', () => {
    const pulse = generatePulse()
    for (const agent of pulse.agents) {
      expect(agent.agent).toBeDefined()
      expect(typeof agent.status).toBe('string')
      // doingTask is either null or has id+title
      if (agent.doingTask) {
        expect(agent.doingTask.id).toBeDefined()
        expect(agent.doingTask.title).toBeDefined()
      }
    }
  })

  it('pendingReviews includes taskId, title, and reviewer', () => {
    const pulse = generatePulse()
    for (const review of pulse.pendingReviews) {
      expect(review.taskId).toBeDefined()
      expect(review.title).toBeDefined()
      expect(review.reviewer).toBeDefined()
    }
  })

  it('full pulse includes deploy with uptimeS', () => {
    const pulse = generatePulse()
    expect(pulse.deploy).toBeDefined()
    expect(typeof pulse.deploy!.pid).toBe('number')
    // uptimeS may be undefined if startedAtMs is not set, but the field should exist
    if (pulse.deploy!.startedAt) {
      expect(typeof pulse.deploy!.uptimeS).toBe('number')
      expect(pulse.deploy!.uptimeS).toBeGreaterThanOrEqual(0)
    }
  })

  it('full pulse includes alertPreflight summary', () => {
    const pulse = generatePulse()
    expect(pulse.alertPreflight).toBeDefined()
    expect(typeof pulse.alertPreflight!.mode).toBe('string')
    expect(['canary', 'enforce', 'off']).toContain(pulse.alertPreflight!.mode)
    expect(typeof pulse.alertPreflight!.totalChecked).toBe('number')
    expect(typeof pulse.alertPreflight!.suppressed).toBe('number')
  })

  it('compact pulse includes deploy and alertPreflight strings', () => {
    const compact = generateCompactPulse()
    // deploy string format: "commit up:XhYm vZ.Z.Z"
    if (compact.deploy) {
      expect(typeof compact.deploy).toBe('string')
      expect(compact.deploy).toContain('up:')
    }
    // alertPreflight string format: "mode checked:N suppressed:N"
    if (compact.alertPreflight) {
      expect(typeof compact.alertPreflight).toBe('string')
      expect(compact.alertPreflight).toContain('checked:')
    }
  })

  it('compact pulse with deploy+alertPreflight still under 2000 chars', () => {
    const compact = generateCompactPulse()
    const serialized = JSON.stringify(compact)
    expect(serialized.length).toBeLessThan(2000)
  })
})
