// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'

// Inline DB setup — avoids importing db.ts which reads config
function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      team_id         TEXT NOT NULL,
      objective       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'idle',
      parent_run_id   TEXT,
      context_snapshot TEXT DEFAULT '{}',
      artifacts       TEXT DEFAULT '[]',
      started_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      completed_at    INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_team ON agent_runs(agent_id, team_id);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

    CREATE TABLE IF NOT EXISTS agent_events (
      id          TEXT PRIMARY KEY,
      run_id      TEXT,
      agent_id    TEXT NOT NULL,
      event_type  TEXT NOT NULL,
      payload     TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_run ON agent_events(run_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events(agent_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(event_type, created_at);
  `)

  return db
}

// Direct DB operations for testing without importing the full module
// This tests the schema + SQL logic directly

describe('agent_runs schema', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('creates a run with all required fields', () => {
    const now = Date.now()
    db.prepare(`
      INSERT INTO agent_runs (id, agent_id, team_id, objective, status, context_snapshot, artifacts, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'idle', '{}', '[]', ?, ?)
    `).run('arun-1', 'link', 'team-1', 'Push coverage to 85%', now, now)

    const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('arun-1') as any
    assert.equal(row.id, 'arun-1')
    assert.equal(row.agent_id, 'link')
    assert.equal(row.team_id, 'team-1')
    assert.equal(row.objective, 'Push coverage to 85%')
    assert.equal(row.status, 'idle')
    assert.equal(row.parent_run_id, null)
    assert.equal(row.completed_at, null)
  })

  it('enforces primary key uniqueness', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at) VALUES (?, ?, ?, ?, 'idle', ?, ?)`).run('arun-1', 'link', 'team-1', 'test', now, now)

    assert.throws(() => {
      db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at) VALUES (?, ?, ?, ?, 'idle', ?, ?)`).run('arun-1', 'kai', 'team-1', 'duplicate', now, now)
    })
  })

  it('supports parent_run_id for sub-tasks', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at) VALUES (?, ?, ?, ?, 'working', ?, ?)`).run('arun-parent', 'link', 'team-1', 'parent task', now, now)
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, parent_run_id, started_at, updated_at) VALUES (?, ?, ?, ?, 'idle', ?, ?, ?)`).run('arun-child', 'link', 'team-1', 'sub task', 'arun-parent', now, now)

    const child = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('arun-child') as any
    assert.equal(child.parent_run_id, 'arun-parent')
  })

  it('updates status and completed_at', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at) VALUES (?, ?, ?, ?, 'working', ?, ?)`).run('arun-1', 'link', 'team-1', 'test', now, now)

    db.prepare('UPDATE agent_runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run('completed', now + 1000, now + 1000, 'arun-1')

    const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('arun-1') as any
    assert.equal(row.status, 'completed')
    assert.equal(row.completed_at, now + 1000)
  })

  it('filters by status and agent', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at) VALUES (?, ?, ?, ?, 'working', ?, ?)`).run('arun-1', 'link', 'team-1', 'active', now, now)
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at, completed_at) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)`).run('arun-2', 'link', 'team-1', 'done', now, now, now)
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at) VALUES (?, ?, ?, ?, 'working', ?, ?)`).run('arun-3', 'kai', 'team-1', 'other agent', now, now)

    const linkActive = db.prepare(
      `SELECT * FROM agent_runs WHERE agent_id = ? AND team_id = ? AND status NOT IN ('completed', 'failed', 'cancelled') ORDER BY started_at DESC LIMIT 1`,
    ).get('link', 'team-1') as any
    assert.equal(linkActive.id, 'arun-1')

    const allLink = db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? AND team_id = ?').all('link', 'team-1') as any[]
    assert.equal(allLink.length, 2)
  })

  it('stores and retrieves JSON context_snapshot and artifacts', () => {
    const now = Date.now()
    const ctx = JSON.stringify({ taskId: 'task-123', branch: 'link/test' })
    const arts = JSON.stringify([{ type: 'pr', url: 'https://github.com/test/pr/1' }])

    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, context_snapshot, artifacts, started_at, updated_at) VALUES (?, ?, ?, ?, 'working', ?, ?, ?, ?)`).run('arun-1', 'link', 'team-1', 'test', ctx, arts, now, now)

    const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('arun-1') as any
    const parsed = JSON.parse(row.context_snapshot)
    assert.equal(parsed.taskId, 'task-123')

    const artsParsed = JSON.parse(row.artifacts)
    assert.equal(artsParsed[0].type, 'pr')
  })
})

describe('agent_events schema (append-only)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('appends an event', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-1', 'arun-1', 'link', 'run_created', '{"objective":"test"}', now)

    const row = db.prepare('SELECT * FROM agent_events WHERE id = ?').get('aevt-1') as any
    assert.equal(row.event_type, 'run_created')
    assert.equal(row.agent_id, 'link')
    assert.equal(row.run_id, 'arun-1')
  })

  it('stores events without run_id', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-1', null, 'link', 'tool_invoked', '{"tool":"browser"}', now)

    const row = db.prepare('SELECT * FROM agent_events WHERE id = ?').get('aevt-1') as any
    assert.equal(row.run_id, null)
    assert.equal(row.event_type, 'tool_invoked')
  })

  it('lists events by agent ordered by created_at DESC', () => {
    const base = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-1', 'arun-1', 'link', 'run_created', '{}', base)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-2', 'arun-1', 'link', 'task_attached', '{}', base + 100)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-3', 'arun-1', 'link', 'completed', '{}', base + 200)

    const rows = db.prepare('SELECT * FROM agent_events WHERE agent_id = ? ORDER BY created_at DESC').all('link') as any[]
    assert.equal(rows.length, 3)
    assert.equal(rows[0].id, 'aevt-3') // newest first
    assert.equal(rows[2].id, 'aevt-1') // oldest last
  })

  it('filters events by run_id', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-1', 'arun-1', 'link', 'run_created', '{}', now)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-2', 'arun-2', 'link', 'run_created', '{}', now)

    const rows = db.prepare('SELECT * FROM agent_events WHERE run_id = ?').all('arun-1') as any[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0].run_id, 'arun-1')
  })

  it('filters events by type', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-1', null, 'link', 'artifact_produced', '{}', now)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-2', null, 'link', 'review_requested', '{}', now)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-3', null, 'link', 'artifact_produced', '{}', now + 100)

    const rows = db.prepare('SELECT * FROM agent_events WHERE event_type = ? ORDER BY created_at DESC').all('artifact_produced') as any[]
    assert.equal(rows.length, 2)
  })

  it('filters events by since timestamp', () => {
    const base = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-old', null, 'link', 'run_created', '{}', base)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-new', null, 'link', 'completed', '{}', base + 5000)

    const rows = db.prepare('SELECT * FROM agent_events WHERE created_at >= ?').all(base + 1000) as any[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, 'aevt-new')
  })

  it('supports all event types from spec', () => {
    const types = [
      'run_created', 'task_attached', 'tool_invoked', 'artifact_produced',
      'review_requested', 'review_approved', 'review_rejected',
      'blocked', 'handed_off', 'completed', 'failed',
    ]
    const now = Date.now()
    for (let i = 0; i < types.length; i++) {
      db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(`aevt-${i}`, null, 'link', types[i], '{}', now + i)
    }

    const all = db.prepare('SELECT * FROM agent_events WHERE agent_id = ?').all('link') as any[]
    assert.equal(all.length, 11)
  })

  it('preserves complex payload JSON', () => {
    const payload = JSON.stringify({
      from_agent: 'link',
      to_agent: 'sage',
      task_id: 'task-123',
      decision: 'approved',
      next_action: 'merge and deploy',
    })
    const now = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run('aevt-1', 'arun-1', 'link', 'handed_off', payload, now)

    const row = db.prepare('SELECT * FROM agent_events WHERE id = ?').get('aevt-1') as any
    const parsed = JSON.parse(row.payload)
    assert.equal(parsed.to_agent, 'sage')
    assert.equal(parsed.decision, 'approved')
  })
})

describe('PR review handoff workflow (release gate)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('supports the full PR review lifecycle', () => {
    const now = Date.now()

    // 1. Run created automatically
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, context_snapshot, started_at, updated_at) VALUES (?, ?, ?, ?, 'working', ?, ?, ?)`)
      .run('arun-pr', 'link', 'team-1', 'Implement agent runs schema', JSON.stringify({ taskId: 'task-qxwos0ffp' }), now, now)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('aevt-1', 'arun-pr', 'link', 'run_created', JSON.stringify({ objective: 'Implement agent runs schema', taskId: 'task-qxwos0ffp' }), now)

    // 2. Events accumulate: task attached, artifact produced
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('aevt-2', 'arun-pr', 'link', 'task_attached', JSON.stringify({ task_id: 'task-qxwos0ffp', title: 'Persistent memory API' }), now + 100)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('aevt-3', 'arun-pr', 'link', 'artifact_produced', JSON.stringify({ type: 'pr', url: 'https://github.com/reflectt/reflectt-node/pull/830' }), now + 200)

    // 3. Review requested
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('aevt-4', 'arun-pr', 'link', 'review_requested', JSON.stringify({ pr_url: 'https://github.com/reflectt/reflectt-node/pull/830', target_agent: 'sage' }), now + 300)

    // Update run to waiting_review
    db.prepare('UPDATE agent_runs SET status = ?, updated_at = ? WHERE id = ?').run('waiting_review', now + 300, 'arun-pr')

    // 4. Review approved (by second agent)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('aevt-5', 'arun-pr', 'sage', 'review_approved', JSON.stringify({ pr_url: 'https://github.com/reflectt/reflectt-node/pull/830', reviewer: 'sage', comment: 'LGTM' }), now + 500)

    // 5. Handoff + completion
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('aevt-6', 'arun-pr', 'link', 'completed', JSON.stringify({ summary: 'PR merged', artifacts: [{ type: 'pr', url: 'https://github.com/reflectt/reflectt-node/pull/830' }] }), now + 600)

    db.prepare('UPDATE agent_runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run('completed', now + 600, now + 600, 'arun-pr')

    // Verify release gate checks:
    // Check 1: Run exists
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('arun-pr') as any
    assert.equal(run.status, 'completed')

    // Check 2: Events accumulated
    const events = db.prepare('SELECT * FROM agent_events WHERE run_id = ? ORDER BY created_at').all('arun-pr') as any[]
    assert.equal(events.length, 6)

    // Check 3: Second agent (sage) has context via events — no chat archaeology needed
    const sageEvents = db.prepare('SELECT * FROM agent_events WHERE run_id = ? AND agent_id = ?').all('arun-pr', 'sage') as any[]
    assert.equal(sageEvents.length, 1)
    assert.equal(sageEvents[0].event_type, 'review_approved')

    // Check 4: Artifact/review state visible
    const artifactEvents = db.prepare('SELECT * FROM agent_events WHERE run_id = ? AND event_type IN (?, ?)').all('arun-pr', 'artifact_produced', 'review_approved') as any[]
    assert.equal(artifactEvents.length, 2)

    // Check 5: Completion is durable and queryable
    const completedRuns = db.prepare(`SELECT * FROM agent_runs WHERE agent_id = ? AND status = 'completed'`).all('link') as any[]
    assert.equal(completedRuns.length, 1)
    assert.ok(completedRuns[0].completed_at)
  })
})

describe('approval routing', () => {
  let db: Database.Database

  beforeEach(() => {
    db = createTestDb()
  })

  it('pending approvals: finds review_requested with action_required', () => {
    const now = Date.now()
    // Create a review_requested event with action_required
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-req-1', 'arun-1', 'link', 'review_requested',
      JSON.stringify({ action_required: 'approve', urgency: 'high', owner: 'ryan' }), now,
    )
    // Create a regular event (should NOT appear)
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-other', 'arun-1', 'link', 'tool_invoked', '{}', now + 1,
    )

    const pending = db.prepare(`
      SELECT e.* FROM agent_events e
      WHERE e.event_type = 'review_requested'
      AND json_extract(e.payload, '$.action_required') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM agent_events r
        WHERE r.run_id = e.run_id
        AND r.event_type IN ('review_approved', 'review_rejected')
        AND r.created_at > e.created_at
      )
      ORDER BY e.created_at DESC
    `).all() as any[]

    assert.equal(pending.length, 1)
    assert.equal(pending[0].id, 'aevt-req-1')
    const payload = JSON.parse(pending[0].payload)
    assert.equal(payload.action_required, 'approve')
    assert.equal(payload.urgency, 'high')
  })

  it('resolved approvals are excluded from pending', () => {
    const now = Date.now()
    // Create request
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-req-2', 'arun-2', 'link', 'review_requested',
      JSON.stringify({ action_required: 'approve' }), now,
    )
    // Approve it
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-approve-2', 'arun-2', 'ryan', 'review_approved',
      JSON.stringify({ original_event_id: 'aevt-req-2', reviewer: 'ryan' }), now + 1,
    )

    const pending = db.prepare(`
      SELECT e.* FROM agent_events e
      WHERE e.event_type = 'review_requested'
      AND json_extract(e.payload, '$.action_required') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM agent_events r
        WHERE r.run_id = e.run_id
        AND r.event_type IN ('review_approved', 'review_rejected')
        AND r.created_at > e.created_at
      )
    `).all() as any[]

    assert.equal(pending.length, 0)
  })

  it('approval decision records event and can unblock run', () => {
    const now = Date.now()
    // Create a run in waiting_review
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'arun-3', 'link', 'default', 'PR review', 'waiting_review', now, now,
    )
    // Create review_requested
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-req-3', 'arun-3', 'link', 'review_requested',
      JSON.stringify({ action_required: 'approve' }), now,
    )

    // Simulate approval: record event + update run
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-approve-3', 'arun-3', 'link', 'review_approved',
      JSON.stringify({ original_event_id: 'aevt-req-3', reviewer: 'ryan' }), now + 1,
    )
    db.prepare(`UPDATE agent_runs SET status = 'working', updated_at = ? WHERE id = ? AND status = 'waiting_review'`).run(now + 1, 'arun-3')

    // Verify run is unblocked
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('arun-3') as any
    assert.equal(run.status, 'working')

    // Verify approval event recorded
    const events = db.prepare(`SELECT * FROM agent_events WHERE event_type = 'review_approved' AND run_id = ?`).all('arun-3') as any[]
    assert.equal(events.length, 1)
    const payload = JSON.parse(events[0].payload)
    assert.equal(payload.reviewer, 'ryan')
  })

  it('rejection does not unblock run', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_runs (id, agent_id, team_id, objective, status, started_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'arun-4', 'link', 'default', 'Feature PR', 'waiting_review', now, now,
    )
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-req-4', 'arun-4', 'link', 'review_requested',
      JSON.stringify({ action_required: 'approve' }), now,
    )

    // Reject
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-reject-4', 'arun-4', 'link', 'review_rejected',
      JSON.stringify({ original_event_id: 'aevt-req-4', reviewer: 'ryan', comment: 'needs changes' }), now + 1,
    )
    // Don't update run status for rejection

    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get('arun-4') as any
    assert.equal(run.status, 'waiting_review') // Still blocked
  })

  it('multiple agents can have independent pending approvals', () => {
    const now = Date.now()
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-req-5', 'arun-5', 'link', 'review_requested',
      JSON.stringify({ action_required: 'approve' }), now,
    )
    db.prepare(`INSERT INTO agent_events (id, run_id, agent_id, event_type, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      'aevt-req-6', 'arun-6', 'rhythm', 'review_requested',
      JSON.stringify({ action_required: 'approve' }), now + 1,
    )

    // All pending
    const allPending = db.prepare(`
      SELECT e.* FROM agent_events e
      WHERE e.event_type = 'review_requested'
      AND json_extract(e.payload, '$.action_required') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM agent_events r
        WHERE r.run_id = e.run_id
        AND r.event_type IN ('review_approved', 'review_rejected')
        AND r.created_at > e.created_at
      )
    `).all() as any[]
    assert.equal(allPending.length, 2)

    // Filter by agent
    const linkOnly = db.prepare(`
      SELECT e.* FROM agent_events e
      WHERE e.event_type = 'review_requested'
      AND e.agent_id = 'link'
      AND json_extract(e.payload, '$.action_required') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM agent_events r
        WHERE r.run_id = e.run_id
        AND r.event_type IN ('review_approved', 'review_rejected')
        AND r.created_at > e.created_at
      )
    `).all() as any[]
    assert.equal(linkOnly.length, 1)
    assert.equal(linkOnly[0].agent_id, 'link')
  })
})
