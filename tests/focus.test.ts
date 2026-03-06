// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect, beforeEach } from 'vitest'
import { getFocus, setFocus, clearFocus, getFocusSummary } from '../src/focus.js'

describe('Team Focus', () => {
  beforeEach(() => {
    clearFocus()
  })

  it('returns null when no focus is set', () => {
    expect(getFocus()).toBeNull()
    expect(getFocusSummary()).toBeNull()
  })

  it('sets and retrieves focus', () => {
    const focus = setFocus('Features over fixes. Activity timeline is P0.', 'kai')
    expect(focus.directive).toBe('Features over fixes. Activity timeline is P0.')
    expect(focus.setBy).toBe('kai')
    expect(focus.setAt).toBeGreaterThan(0)

    const retrieved = getFocus()
    expect(retrieved).not.toBeNull()
    expect(retrieved!.directive).toBe('Features over fixes. Activity timeline is P0.')
  })

  it('returns compact summary for heartbeat', () => {
    setFocus('Ship activity timeline', 'ryan', { tags: ['shipping'] })
    const summary = getFocusSummary()
    expect(summary).not.toBeNull()
    expect(summary!.focus).toBe('Ship activity timeline')
    expect(summary!.setBy).toBe('ryan')
    expect(summary!.setAt).toBeGreaterThan(0)
    // Summary should NOT include tags/expiresAt (minimal tokens)
    expect((summary as any).tags).toBeUndefined()
  })

  it('clears focus', () => {
    setFocus('Test directive', 'kai')
    expect(getFocus()).not.toBeNull()
    clearFocus()
    expect(getFocus()).toBeNull()
  })

  it('expires focus when past expiresAt', () => {
    setFocus('Expired directive', 'kai', { expiresAt: Date.now() - 1000 })
    expect(getFocus()).toBeNull() // Should auto-clear
  })

  it('keeps focus when not yet expired', () => {
    setFocus('Active directive', 'kai', { expiresAt: Date.now() + 60_000 })
    const focus = getFocus()
    expect(focus).not.toBeNull()
    expect(focus!.directive).toBe('Active directive')
  })

  it('overwrites previous focus', () => {
    setFocus('Old focus', 'kai')
    setFocus('New focus', 'ryan')
    const focus = getFocus()
    expect(focus!.directive).toBe('New focus')
    expect(focus!.setBy).toBe('ryan')
  })
})
