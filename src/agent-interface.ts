/**
 * Agent Interface — browser-driven software actions on behalf of the human.
 *
 * v1 scope: GitHub issue creation with full approval gate + run log.
 *
 * Run lifecycle: queued → running → awaiting_approval → completed | failed
 *
 * Spec: process/agent-interface-mvp-execution-v1.md
 * Task: task-1773257734617-6fvzfl52z
 */

import { checkActionAllowed } from "./agent-exec-guardrail.js";

export type RunKind = 'github_issue_create'
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'rejected'

export interface RunEvent {
  type:
    | 'state_changed'
    | 'step_started'
    | 'step_succeeded'
    | 'step_failed'
    | 'approval_requested'
    | 'approval_resolved'
  timestamp: number
  payload: Record<string, unknown>
}

export interface AgentInterfaceRun {
  id: string
  kind: RunKind
  status: RunStatus
  createdAt: number
  updatedAt: number
  input: Record<string, unknown>
  log: RunEvent[]
  result?: {
    outcome: 'completed' | 'failed' | 'rejected'
    issueUrl?: string
    errorMessage?: string
    recoveryHint?: string
  }
}

// ── In-memory run store ───────────────────────────────────────────────────────

const runs = new Map<string, AgentInterfaceRun>()
const subscribers = new Map<string, Set<(event: RunEvent) => void>>()

function genRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createRun(kind: RunKind, input: Record<string, unknown>): AgentInterfaceRun {
  const run: AgentInterfaceRun = {
    id: genRunId(),
    kind,
    status: 'queued',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input,
    log: [],
  }
  runs.set(run.id, run)

  // Guardrail check: deny non-approved actions or out-of-scope domains immediately
  const target = typeof input.repo === 'string' ? input.repo : undefined
  const guard = checkActionAllowed(kind, target)
  if (!guard.allowed) {
    run.status = 'failed'
    run.result = { outcome: 'failed', errorMessage: guard.reason, recoveryHint: 'Only approved actions and domains are permitted.' }
    run.log.push({
      type: 'step_failed',
      timestamp: Date.now(),
      payload: { step: 'guardrail', reason: guard.reason },
    })
    run.updatedAt = Date.now()
  }

  return run
}

export function getRun(runId: string): AgentInterfaceRun | null {
  return runs.get(runId) ?? null
}

export function subscribeRun(runId: string, cb: (event: RunEvent) => void): () => void {
  if (!subscribers.has(runId)) subscribers.set(runId, new Set())
  subscribers.get(runId)!.add(cb)
  return () => subscribers.get(runId)?.delete(cb)
}

function emit(runId: string, event: RunEvent): void {
  const run = runs.get(runId)
  if (run) {
    run.log.push(event)
    run.updatedAt = Date.now()
  }
  for (const cb of subscribers.get(runId) ?? []) {
    try { cb(event) } catch { /* non-fatal */ }
  }
}

function transition(runId: string, status: RunStatus, payload: Record<string, unknown> = {}): void {
  const run = runs.get(runId)
  if (!run) return
  const prev = run.status
  run.status = status
  run.updatedAt = Date.now()
  emit(runId, { type: 'state_changed', timestamp: Date.now(), payload: { from: prev, to: status, ...payload } })
}

// ── GitHub issue creation executor ───────────────────────────────────────────

export interface GithubIssueInput {
  repo: string    // owner/repo
  title: string
  body: string
  dryRun?: boolean
}

export interface PendingApproval {
  runId: string
  resolve: (approved: boolean) => void
}

const pendingApprovals = new Map<string, PendingApproval>()

/**
 * Execute a github_issue_create run.
 * Flow: validate → step:draft → request_approval → (approved) → step:submit → complete
 *       or       → (rejected) → rejected
 */
export async function executeGithubIssueCreate(runId: string, input: GithubIssueInput): Promise<void> {
  const run = runs.get(runId)
  if (!run) return

  transition(runId, 'running')

  // Step 1: Draft the issue content
  emit(runId, {
    type: 'step_started',
    timestamp: Date.now(),
    payload: { step: 'draft', repo: input.repo, title: input.title },
  })

  if (!input.repo || !input.title || !input.body) {
    emit(runId, {
      type: 'step_failed',
      timestamp: Date.now(),
      payload: { step: 'draft', error: 'repo, title, and body are required' },
    })
    run.result = { outcome: 'failed', errorMessage: 'Missing required fields', recoveryHint: 'Provide repo (owner/repo), title, and body.' }
    transition(runId, 'failed')
    return
  }

  emit(runId, {
    type: 'step_succeeded',
    timestamp: Date.now(),
    payload: { step: 'draft', title: input.title, bodyLen: input.body.length },
  })

  // Step 2: Request human approval before irreversible submit
  transition(runId, 'awaiting_approval')
  emit(runId, {
    type: 'approval_requested',
    timestamp: Date.now(),
    payload: {
      message: `Create GitHub issue in ${input.repo}: "${input.title}"`,
      repo: input.repo,
      title: input.title,
      bodyPreview: input.body.slice(0, 200),
      dryRun: input.dryRun ?? false,
    },
  })

  // Wait for approval decision (max 10 minutes)
  const approved = await new Promise<boolean>((resolve) => {
    pendingApprovals.set(runId, { runId, resolve })
    setTimeout(() => {
      if (pendingApprovals.has(runId)) {
        pendingApprovals.delete(runId)
        resolve(false) // auto-reject on timeout
      }
    }, 10 * 60 * 1000)
  })

  emit(runId, {
    type: 'approval_resolved',
    timestamp: Date.now(),
    payload: { approved, runId },
  })

  if (!approved) {
    run.result = { outcome: 'rejected', recoveryHint: 'Re-submit when ready to approve.' }
    transition(runId, 'rejected')
    return
  }

  // Step 3: Submit to GitHub
  transition(runId, 'running')
  emit(runId, {
    type: 'step_started',
    timestamp: Date.now(),
    payload: { step: 'submit', dryRun: input.dryRun ?? false },
  })

  if (input.dryRun) {
    // Dry run — simulate success, don't actually call GitHub API
    emit(runId, {
      type: 'step_succeeded',
      timestamp: Date.now(),
      payload: { step: 'submit', dryRun: true, issueUrl: `https://github.com/${input.repo}/issues/[dry-run]` },
    })
    run.result = { outcome: 'completed', issueUrl: `https://github.com/${input.repo}/issues/[dry-run]` }
    transition(runId, 'completed')
    return
  }

  // Real GitHub API call
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    emit(runId, {
      type: 'step_failed',
      timestamp: Date.now(),
      payload: { step: 'submit', error: 'GITHUB_TOKEN not configured' },
    })
    run.result = { outcome: 'failed', errorMessage: 'GITHUB_TOKEN not set', recoveryHint: 'Set GITHUB_TOKEN env var with repo write scope.' }
    transition(runId, 'failed')
    return
  }

  try {
    const [owner, repo] = input.repo.split('/')
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ title: input.title, body: input.body }),
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const errBody = await res.text()
      emit(runId, {
        type: 'step_failed',
        timestamp: Date.now(),
        payload: { step: 'submit', status: res.status, error: errBody.slice(0, 200) },
      })
      run.result = {
        outcome: 'failed',
        errorMessage: `GitHub API error ${res.status}`,
        recoveryHint: 'Check GITHUB_TOKEN permissions (needs repo write scope).',
      }
      transition(runId, 'failed')
      return
    }

    const issue = await res.json() as { html_url: string; number: number }
    emit(runId, {
      type: 'step_succeeded',
      timestamp: Date.now(),
      payload: { step: 'submit', issueUrl: issue.html_url, issueNumber: issue.number },
    })
    run.result = { outcome: 'completed', issueUrl: issue.html_url }
    transition(runId, 'completed')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    emit(runId, {
      type: 'step_failed',
      timestamp: Date.now(),
      payload: { step: 'submit', error: message },
    })
    run.result = { outcome: 'failed', errorMessage: message, recoveryHint: 'Check network connectivity and retry.' }
    transition(runId, 'failed')
  }
}

/**
 * Approve a pending run (human confirms irreversible action).
 * Returns false if no pending approval found.
 */
export function approveRun(runId: string): boolean {
  const pending = pendingApprovals.get(runId)
  if (!pending) return false
  pendingApprovals.delete(runId)
  pending.resolve(true)
  return true
}

/**
 * Reject a pending run (human declines the action).
 */
export function rejectRun(runId: string): boolean {
  const pending = pendingApprovals.get(runId)
  if (!pending) return false
  pendingApprovals.delete(runId)
  pending.resolve(false)
  return true
}

/**
 * List runs currently awaiting human approval — surfaced in /approval-queue
 * so the presence canvas decision card can show them.
 */
export function listPendingRuns(): AgentInterfaceRun[] {
  const result: AgentInterfaceRun[] = []
  for (const run of runs.values()) {
    if (run.status === 'awaiting_approval') result.push(run)
  }
  return result
}

/**
 * List all runs with optional status filter.
 */
export function listRuns(status?: string): AgentInterfaceRun[] {
  const result: AgentInterfaceRun[] = []
  for (const run of runs.values()) {
    if (!status || run.status === status) result.push(run)
  }
  return result.sort((a, b) => b.createdAt - a.createdAt)
}

export function _clearRunsForTest(): void {
  runs.clear()
  subscribers.clear()
  pendingApprovals.clear()
}
