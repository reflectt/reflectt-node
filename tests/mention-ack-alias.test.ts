// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Locks Seam 3: when a fresh managed agent renames itself (e.g. main → apex)
// and persists `main` as an alias, live `@main` mentions must record the
// pending ack against the canonical agent (`apex`), NOT the literal `main`
// that no agent will ever ack.
//
// Bug captured by link's fresh-host proof on rn-d62950b0-5agkbn:
//   - team/roles: apex with aliases ["main", "apex"] ✓
//   - posted "@main ping seam3 …"
//   - /health/mention-ack/main → count: 1 (literal stuck)
//   - /health/mention-ack/apex → count: 0 (canonical missed)
// task-1776819531813-j7xstmkuh

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mentionAckTracker } from '../src/mention-ack.js'
import { setTestRoles } from '../src/assignment.js'

describe('mention-ack alias resolution', () => {
  beforeEach(() => {
    setTestRoles([
      {
        name: 'apex',
        role: 'lead',
        aliases: ['main', 'apex'],
        affinityTags: [],
        wipCap: 1,
      },
    ])
  })

  afterEach(() => {
    setTestRoles(null)
  })

  it('resolves @main → apex when apex carries main as an alias', () => {
    const mentioned = mentionAckTracker.recordMessage({
      id: 'msg-test-seam3-1',
      from: 'claude',
      content: '@main ping seam3',
      channel: 'general',
    })

    expect(mentioned).toContain('apex')
    expect(mentioned).not.toContain('main')

    expect(mentionAckTracker.getPending('apex').length).toBeGreaterThan(0)
    expect(mentionAckTracker.getPending('main').length).toBe(0)
  })

  it('apex posting in same channel acks the @main pending entry', () => {
    // Channel-scoped pending is keyed by (agent, channel); use a unique
    // channel per test to dodge tracker singleton state from sibling tests.
    const channel = 'seam3-ack-channel'

    mentionAckTracker.recordMessage({
      id: 'msg-test-seam3-2',
      from: 'claude',
      content: '@main please ack',
      channel,
    })

    expect(
      mentionAckTracker.getPending('apex').filter(e => e.channel === channel).length
    ).toBe(1)

    mentionAckTracker.recordMessage({
      id: 'msg-test-seam3-3',
      from: 'apex',
      content: 'on it',
      channel,
    })

    expect(
      mentionAckTracker.getPending('apex').filter(e => e.channel === channel).length
    ).toBe(0)
  })

  it('falls back to the literal mention when no agent role resolves', () => {
    const channel = 'seam3-ghost-channel'
    const mentioned = mentionAckTracker.recordMessage({
      id: 'msg-test-seam3-4',
      from: 'claude',
      content: '@ghost who are you',
      channel,
    })

    expect(mentioned).toContain('ghost')
    expect(
      mentionAckTracker.getPending('ghost').filter(e => e.channel === channel).length
    ).toBe(1)
  })

  it('@apex (canonical) still resolves to apex (not double-resolved)', () => {
    const mentioned = mentionAckTracker.recordMessage({
      id: 'msg-test-seam3-5',
      from: 'claude',
      content: '@apex direct ping',
      channel: 'general',
    })

    expect(mentioned).toEqual(['apex'])
  })
})
