// SPDX-License-Identifier: Apache-2.0
// Team polls: create, vote, view results — agents and humans

import { getDb, safeJsonStringify, safeJsonParse } from './db.js'

// ── Types ──

export interface Poll {
  id: string
  question: string
  options: string[]
  created_by: string
  created_at: number
  expires_at: number | null
  status: 'active' | 'closed'
  anonymous: boolean
}

export interface PollVote {
  poll_id: string
  voter: string
  choice: number
  voted_at: number
}

export interface PollWithResults extends Poll {
  votes: PollVote[]
  tally: Array<{ option: string; count: number; voters: string[] }>
  total_votes: number
}

// ── Schema ──

function ensurePollTables(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      anonymous INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status);
    CREATE INDEX IF NOT EXISTS idx_polls_created ON polls(created_at);

    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id TEXT NOT NULL,
      voter TEXT NOT NULL,
      choice INTEGER NOT NULL,
      voted_at INTEGER NOT NULL,
      PRIMARY KEY (poll_id, voter),
      FOREIGN KEY (poll_id) REFERENCES polls(id)
    );
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
  `)
}

// ── CRUD ──

export function createPoll(opts: {
  question: string
  options: string[]
  createdBy: string
  expiresAt?: number
  expiresInMinutes?: number
  anonymous?: boolean
}): PollWithResults {
  ensurePollTables()
  const db = getDb()
  const now = Date.now()
  const id = `poll-${now}-${Math.random().toString(36).slice(2, 10)}`

  if (!opts.question?.trim()) throw new Error('Question is required')
  if (!opts.options || opts.options.length < 2) throw new Error('At least 2 options required')
  if (opts.options.length > 10) throw new Error('Maximum 10 options')

  let expiresAt: number | null = null
  if (opts.expiresAt) {
    expiresAt = opts.expiresAt
  } else if (opts.expiresInMinutes && opts.expiresInMinutes > 0) {
    expiresAt = now + opts.expiresInMinutes * 60 * 1000
  }

  db.prepare(`
    INSERT INTO polls (id, question, options, created_by, created_at, expires_at, status, anonymous)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(
    id,
    opts.question.trim(),
    safeJsonStringify(opts.options.map(o => String(o).trim())),
    (opts.createdBy || 'unknown').trim(),
    now,
    expiresAt,
    opts.anonymous ? 1 : 0,
  )

  return getPoll(id)!
}

export function vote(pollId: string, voter: string, choice: number): { success: boolean; error?: string } {
  ensurePollTables()
  const db = getDb()

  const poll = getPollRaw(pollId)
  if (!poll) return { success: false, error: 'Poll not found' }
  if (poll.status !== 'active') return { success: false, error: 'Poll is closed' }
  if (poll.expires_at && Date.now() > poll.expires_at) {
    closePoll(pollId)
    return { success: false, error: 'Poll has expired' }
  }
  if (choice < 0 || choice >= poll.options.length) {
    return { success: false, error: `Invalid choice: must be 0-${poll.options.length - 1}` }
  }

  // Upsert: allows changing vote
  db.prepare(`
    INSERT INTO poll_votes (poll_id, voter, choice, voted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(poll_id, voter) DO UPDATE SET choice = excluded.choice, voted_at = excluded.voted_at
  `).run(pollId, voter.trim().toLowerCase(), choice, Date.now())

  return { success: true }
}

export function getPoll(id: string): PollWithResults | null {
  ensurePollTables()
  const poll = getPollRaw(id)
  if (!poll) return null

  // Auto-close expired
  if (poll.status === 'active' && poll.expires_at && Date.now() > poll.expires_at) {
    closePoll(id)
    poll.status = 'closed'
  }

  const db = getDb()
  const votes = (db.prepare('SELECT * FROM poll_votes WHERE poll_id = ? ORDER BY voted_at')
    .all(id) as Array<Record<string, unknown>>).map(r => ({
    poll_id: String(r.poll_id),
    voter: String(r.voter),
    choice: Number(r.choice),
    voted_at: Number(r.voted_at),
  }))

  const tally = poll.options.map((option, i) => {
    const optionVotes = votes.filter(v => v.choice === i)
    return {
      option,
      count: optionVotes.length,
      voters: poll.anonymous ? [] : optionVotes.map(v => v.voter),
    }
  })

  return {
    ...poll,
    votes: poll.anonymous ? [] : votes,
    tally,
    total_votes: votes.length,
  }
}

export function listPolls(opts?: { status?: 'active' | 'closed' | 'all'; limit?: number }): PollWithResults[] {
  ensurePollTables()
  const db = getDb()
  const limit = Math.min(opts?.limit ?? 20, 100)

  // Auto-close expired polls
  const now = Date.now()
  db.prepare("UPDATE polls SET status = 'closed' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?").run(now)

  let rows: Array<Record<string, unknown>>
  if (opts?.status && opts.status !== 'all') {
    rows = db.prepare('SELECT * FROM polls WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(opts.status, limit) as Array<Record<string, unknown>>
  } else {
    rows = db.prepare('SELECT * FROM polls ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>
  }

  return rows.map(r => {
    const poll = rowToPoll(r)
    return getPoll(poll.id)!
  }).filter(Boolean)
}

export function closePoll(id: string): { success: boolean; error?: string } {
  ensurePollTables()
  const db = getDb()
  const result = db.prepare("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'active'").run(id)
  if (result.changes === 0) return { success: false, error: 'Poll not found or already closed' }
  return { success: true }
}

// ── Helpers ──

function getPollRaw(id: string): Poll | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM polls WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return rowToPoll(row)
}

function rowToPoll(row: Record<string, unknown>): Poll {
  return {
    id: String(row.id),
    question: String(row.question),
    options: safeJsonParse<string[]>(row.options as string) ?? [],
    created_by: String(row.created_by),
    created_at: Number(row.created_at),
    expires_at: row.expires_at ? Number(row.expires_at) : null,
    status: String(row.status) as Poll['status'],
    anonymous: Boolean(row.anonymous),
  }
}
