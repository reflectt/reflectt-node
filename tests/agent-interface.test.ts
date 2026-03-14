/**
 * Agent Interface tests — github_issue_create run lifecycle
 * Covers: success / reject / failure scenarios + approval gate
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createRun, getRun, subscribeRun,
  approveRun, rejectRun,
  executeGithubIssueCreate,
  _clearRunsForTest,
  type RunEvent,
} from '../src/agent-interface.js'

beforeEach(() => {
  _clearRunsForTest()
  delete process.env.GITHUB_TOKEN
})

// ── Helper to collect SSE events from a run ─────────────────────────────────
function collectEvents(runId: string): RunEvent[] {
  const events: RunEvent[] = []
  subscribeRun(runId, (e) => events.push(e))
  return events
}

// ── Run creation ─────────────────────────────────────────────────────────────
describe('createRun', () => {
  it('creates a run in queued state', () => {
    const run = createRun('github_issue_create', { repo: 'test/repo', title: 'T', body: 'B' })
    expect(run.status).toBe('queued')
    expect(run.id).toMatch(/^run-/)
    expect(run.kind).toBe('github_issue_create')
  })

  it('is retrievable by ID', () => {
    const run = createRun('github_issue_create', {})
    expect(getRun(run.id)).toBe(run)
  })

  it('returns null for unknown run', () => {
    expect(getRun('nonexistent')).toBeNull()
  })
})

// ── Dry run — success path ───────────────────────────────────────────────────
describe('executeGithubIssueCreate — dry run (success path)', () => {
  it('runs through full lifecycle: queued→running→awaiting_approval→completed', async () => {
    const run = createRun('github_issue_create', {})
    const events = collectEvents(run.id)

    const execPromise = executeGithubIssueCreate(run.id, {
      repo: 'owner/repo',
      title: 'Test issue',
      body: 'Issue body',
      dryRun: true,
    })

    // Wait for awaiting_approval
    await vi.waitFor(() => expect(getRun(run.id)?.status).toBe('awaiting_approval'), { timeout: 2000 })

    // Approve
    expect(approveRun(run.id)).toBe(true)

    await execPromise

    const run2 = getRun(run.id)!
    expect(run2.status).toBe('completed')
    expect(run2.result?.outcome).toBe('completed')
    expect(run2.result?.issueUrl).toContain('[dry-run]')

    const types = events.map(e => e.type)
    expect(types).toContain('state_changed')
    expect(types).toContain('step_started')
    expect(types).toContain('step_succeeded')
    expect(types).toContain('approval_requested')
    expect(types).toContain('approval_resolved')
  })

  it('approval_requested payload contains repo + title + bodyPreview', async () => {
    const run = createRun('github_issue_create', {})
    const events = collectEvents(run.id)

    const execPromise = executeGithubIssueCreate(run.id, {
      repo: 'owner/repo',
      title: 'My Issue',
      body: 'x'.repeat(300),
      dryRun: true,
    })

    await vi.waitFor(() => events.some(e => e.type === 'approval_requested'), { timeout: 2000 })

    const approvalEvt = events.find(e => e.type === 'approval_requested')!
    expect(approvalEvt.payload.repo).toBe('owner/repo')
    expect(approvalEvt.payload.title).toBe('My Issue')
    expect((approvalEvt.payload.bodyPreview as string).length).toBeLessThanOrEqual(200)
    expect(approvalEvt.payload.dryRun).toBe(true)

    approveRun(run.id)
    await execPromise
  })
})

// ── Reject path ──────────────────────────────────────────────────────────────
describe('executeGithubIssueCreate — reject path', () => {
  it('transitions to rejected when human rejects', async () => {
    const run = createRun('github_issue_create', {})
    const events = collectEvents(run.id)

    const execPromise = executeGithubIssueCreate(run.id, {
      repo: 'owner/repo',
      title: 'Rejected Issue',
      body: 'Should not be created',
      dryRun: true,
    })

    await vi.waitFor(() => getRun(run.id)?.status === 'awaiting_approval', { timeout: 2000 })

    expect(rejectRun(run.id)).toBe(true)
    await execPromise

    const run2 = getRun(run.id)!
    expect(run2.status).toBe('rejected')
    expect(run2.result?.outcome).toBe('rejected')
    expect(run2.result?.recoveryHint).toBeTruthy()

    const resolved = events.find(e => e.type === 'approval_resolved')!
    expect(resolved.payload.approved).toBe(false)
  })

  it('blocks GitHub API call when rejected (no GITHUB_TOKEN call)', async () => {
    process.env.GITHUB_TOKEN = 'should-not-be-called'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const run = createRun('github_issue_create', {})
    const execPromise = executeGithubIssueCreate(run.id, {
      repo: 'owner/repo',
      title: 'T',
      body: 'B',
      dryRun: false,
    })

    await vi.waitFor(() => getRun(run.id)?.status === 'awaiting_approval', { timeout: 2000 })
    rejectRun(run.id)
    await execPromise

    // fetch should NOT have been called with github API
    const githubCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('api.github.com')
    )
    expect(githubCalls).toHaveLength(0)
    fetchSpy.mockRestore()
  })
})

// ── Failure paths ────────────────────────────────────────────────────────────
describe('executeGithubIssueCreate — failure paths', () => {
  it('fails immediately if required fields missing', async () => {
    const run = createRun('github_issue_create', {})
    await executeGithubIssueCreate(run.id, { repo: '', title: '', body: '' })

    const r = getRun(run.id)!
    expect(r.status).toBe('failed')
    expect(r.result?.outcome).toBe('failed')
    expect(r.result?.recoveryHint).toBeTruthy()
  })

  it('fails if GITHUB_TOKEN not set (non-dryRun)', async () => {
    const run = createRun('github_issue_create', {})

    const execPromise = executeGithubIssueCreate(run.id, {
      repo: 'owner/repo',
      title: 'No token test',
      body: 'body',
      dryRun: false,
    })

    await vi.waitFor(() => getRun(run.id)?.status === 'awaiting_approval', { timeout: 2000 })
    approveRun(run.id)
    await execPromise

    const r = getRun(run.id)!
    expect(r.status).toBe('failed')
    expect(r.result?.errorMessage).toContain('GITHUB_TOKEN')
    expect(r.result?.recoveryHint).toBeTruthy()
  })

  it('failure run log has step_failed event', async () => {
    const run = createRun('github_issue_create', {})
    const events = collectEvents(run.id)

    await executeGithubIssueCreate(run.id, { repo: '', title: '', body: '' })

    expect(events.some(e => e.type === 'step_failed')).toBe(true)
  })
})

// ── Approval gate ────────────────────────────────────────────────────────────
describe('approval gate', () => {
  it('approveRun returns false for non-existent run', () => {
    expect(approveRun('nonexistent')).toBe(false)
  })

  it('rejectRun returns false for non-existent run', () => {
    expect(rejectRun('nonexistent')).toBe(false)
  })

  it('double-approve returns false (idempotent gate)', async () => {
    const run = createRun('github_issue_create', {})

    const execPromise = executeGithubIssueCreate(run.id, {
      repo: 'owner/repo',
      title: 'T',
      body: 'B',
      dryRun: true,
    })

    await vi.waitFor(() => getRun(run.id)?.status === 'awaiting_approval', { timeout: 2000 })

    expect(approveRun(run.id)).toBe(true)
    expect(approveRun(run.id)).toBe(false) // second call returns false

    await execPromise
  })
})

// ── Run event log ─────────────────────────────────────────────────────────────
describe('run log completeness', () => {
  it('dry-run success log contains all required event types', async () => {
    const run = createRun('github_issue_create', {})

    const execPromise = executeGithubIssueCreate(run.id, {
      repo: 'owner/repo',
      title: 'T',
      body: 'B',
      dryRun: true,
    })

    await vi.waitFor(() => getRun(run.id)?.status === 'awaiting_approval', { timeout: 2000 })
    approveRun(run.id)
    await execPromise

    const r = getRun(run.id)!
    const types = new Set(r.log.map(e => e.type))
    expect(types.has('state_changed')).toBe(true)
    expect(types.has('step_started')).toBe(true)
    expect(types.has('step_succeeded')).toBe(true)
    expect(types.has('approval_requested')).toBe(true)
    expect(types.has('approval_resolved')).toBe(true)
    // All log entries have timestamps
    for (const e of r.log) expect(e.timestamp).toBeGreaterThan(0)
  })
})
