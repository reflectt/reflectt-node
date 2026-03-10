// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '../src/db.js'
import { PresenceManager } from '../src/presence.js'

const db = getDb()

describe('Presence restart continuity', () => {
  let manager: PresenceManager | null = null

  beforeEach(() => {
    db.prepare("DELETE FROM tasks WHERE assignee IN ('link', 'sage', 'pixel')").run()
  })

  afterEach(() => {
    manager?.destroy()
    manager = null
    db.prepare("DELETE FROM tasks WHERE assignee IN ('link', 'sage', 'pixel')").run()
  })

  it('hydrates doing-task continuity from SQLite on cold start', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO tasks (id, title, status, assignee, reviewer, done_criteria, created_at, updated_at, priority, created_by, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'task-restart-continuity',
      'Restart continuity task',
      'doing',
      'link',
      'reviewer',
      JSON.stringify(['survives restart']),
      now - 60_000,
      now - 30_000,
      'P2',
      'test',
      JSON.stringify({ eta: '30m' }),
    )

    manager = new PresenceManager()
    const presence = manager.getPresence('link')

    expect(presence).toBeTruthy()
    expect(presence?.status).toBe('working')
    expect(presence?.task).toBe('task-restart-continuity')
  })

  it('does not let routine wake/update calls wipe an active doing-task pointer', () => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO tasks (id, title, status, assignee, reviewer, done_criteria, created_at, updated_at, priority, created_by, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'task-wake-continuity',
      'Wake continuity task',
      'doing',
      'sage',
      'reviewer',
      JSON.stringify(['pointer survives auto-wake']),
      now - 60_000,
      now - 30_000,
      'P2',
      'test',
      JSON.stringify({ eta: '30m' }),
    )

    manager = new PresenceManager()
    manager.clearAll()

    const presence = manager.updatePresence('sage', 'working')

    expect(presence.task).toBe('task-wake-continuity')
    expect(manager.getPresence('sage')?.task).toBe('task-wake-continuity')
  })

  it('allows explicit task clearing when active work is actually done', () => {
    manager = new PresenceManager()
    manager.updatePresence('pixel', 'working', 'task-finished')

    const cleared = manager.updatePresence('pixel', 'working', null)

    expect(cleared.task).toBeUndefined()
    expect(manager.getPresence('pixel')?.task).toBeUndefined()
  })
})
