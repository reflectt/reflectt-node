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
import { executeIntent as macOSExecuteIntent, requiresApproval as macOSRequiresApproval, validateIntent as macOSValidateIntent } from "./macos-accessibility.js";

export type RunKind = 'github_issue_create' | 'macos_ui_action'
export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'rejected' | 'aborted'

/**
 * Approval timeout in ms.
 * In production: 10 minutes (never hardcoded — reads from env).
 * In CI/tests: set APPROVAL_TIMEOUT_MS_TEST to a smaller value (e.g. 200).
 * The test env var ONLY applies when running tests — never override in production code.
 */
export function getApprovalTimeoutMs(): number {
  const testOverride = process.env.APPROVAL_TIMEOUT_MS_TEST
  if (testOverride) return Number(testOverride)
  return 10 * 60 * 1000 // 10 minutes (production default)
}

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
    }, getApprovalTimeoutMs())
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
 * Abort a run — emergency kill for kill-switch or out-of-band termination.
 * Works on any active state: awaiting_approval (rejects pending gate),
 * running (forces abort), or queued (cancels before execution).
 *
 * @param actor  identity invoking the abort (for audit log)
 */
export function abortRun(runId: string, actor = 'kill-switch'): boolean {
  const run = runs.get(runId)
  if (!run) return false
  if (['completed', 'failed', 'rejected', 'aborted', 'cancelled'].includes(run.status)) return false

  // If waiting for approval — resolve the gate with rejection first
  const pending = pendingApprovals.get(runId)
  if (pending) {
    pendingApprovals.delete(runId)
    pending.resolve(false)
  }

  run.result = { outcome: 'aborted', actor, abortedAt: Date.now() } as unknown as typeof run.result
  transition(runId, 'aborted', { actor, abortedAt: Date.now() })
  emit(runId, { type: 'step_failed', timestamp: Date.now(), payload: { step: 'execute', error: `aborted by ${actor}` } })
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

// ── Immutable audit + replay packet ─────────────────────────────────────────

/**
 * Structured audit packet for a completed run.
 * Includes intent, step timeline, approval decisions, outcome, and rollback hints.
 *
 * task-1773486840057-e92leqnr1
 */
export interface ReplayPacket {
  schema: 'agent-interface-replay-v1'
  runId: string
  kind: string
  generatedAt: number
  run: {
    id: string
    kind: string
    status: RunStatus
    createdAt: number
    completedAt: number | null
    durationMs: number | null
  }
  intent: Record<string, unknown>
  stepTimeline: Array<{
    type: string
    timestamp: number
    offsetMs: number  // ms from run start
    payload: Record<string, unknown>
  }>
  approvals: Array<{
    requestedAt: number
    resolvedAt: number | null
    approved: boolean | null
    timeoutMs: number
  }>
  outcome: {
    status: RunStatus
    result: Record<string, unknown> | null
    errorMessage: string | null
  }
  rollbackHints: string[]
}

/**
 * Build an immutable audit/replay packet for the given run.
 * Safe to call at any run lifecycle stage.
 */
export function buildReplayPacket(runId: string): ReplayPacket | null {
  const run = runs.get(runId)
  if (!run) return null

  const startMs = run.createdAt

  // Find approval events
  const approvals: ReplayPacket['approvals'] = []
  let pendingApproval: Partial<ReplayPacket['approvals'][0]> | null = null
  for (const event of run.log) {
    if (event.type === 'approval_requested') {
      pendingApproval = { requestedAt: event.timestamp, resolvedAt: null, approved: null, timeoutMs: getApprovalTimeoutMs() }
    } else if (event.type === 'approval_resolved' && pendingApproval) {
      pendingApproval.resolvedAt = event.timestamp
      pendingApproval.approved = (event.payload as any).approved ?? null
      approvals.push(pendingApproval as ReplayPacket['approvals'][0])
      pendingApproval = null
    }
  }
  if (pendingApproval) approvals.push(pendingApproval as ReplayPacket['approvals'][0])

  // Determine completion time
  const terminalEvent = [...run.log].reverse().find(e =>
    e.type === 'state_changed' && ['completed', 'failed', 'rejected'].includes((e.payload as any).to),
  )
  const completedAt = terminalEvent?.timestamp ?? null

  // Rollback hints based on intent action
  const intent = (run.input as any).intent ?? run.input
  const rollbackHints = buildRollbackHints(run.kind as string, intent)

  return {
    schema: 'agent-interface-replay-v1',
    runId,
    kind: run.kind as string,
    generatedAt: Date.now(),
    run: {
      id: run.id,
      kind: run.kind as string,
      status: run.status,
      createdAt: run.createdAt,
      completedAt,
      durationMs: completedAt ? completedAt - startMs : null,
    },
    intent,
    stepTimeline: run.log.map(event => ({
      type: event.type,
      timestamp: event.timestamp,
      offsetMs: event.timestamp - startMs,
      payload: event.payload,
    })),
    approvals,
    outcome: {
      status: run.status,
      result: run.result ? { ...run.result } : null,
      errorMessage: run.result?.errorMessage ?? null,
    },
    rollbackHints,
  }
}

function buildRollbackHints(kind: string, intent: Record<string, unknown>): string[] {
  if (kind === 'github_issue_create') {
    return ['Close the created GitHub issue via the issue URL in the run result.']
  }
  if (kind === 'macos_ui_action') {
    const action = String(intent?.action ?? '')
    switch (action) {
      case 'create_reminder':
        return ['Open Reminders app → find and delete the created reminder manually.']
      case 'draft_email':
        return ['Open Mail app → Drafts → delete the draft before sending.']
      case 'summarize_note':
        return ['Read-only — no rollback needed.']
      case 'open_app':
      case 'focus_window':
        return ['Reversible — close the application if needed.']
      case 'type_text':
        return ['Undo via Cmd+Z in the focused application.']
      default:
        return ['Review the target application manually for any unintended changes.']
    }
  }
  return ['Review output carefully; consult the run log for step-by-step details.']
}

/**
 * Execute a macOS UI action run.
 * Handles the awaiting_approval gate for irreversible intents.
 *
 * task-1773486840001-u0shj14v3 / task-1773486840036-8x0o76rmp
 */
export async function executeMacOSUIAction(
  runId: string,
  intent: Record<string, unknown>,
): Promise<void> {
  // Validate
  const validation = macOSValidateIntent(intent as any)
  if (!validation.ok) {
    emit(runId, { type: 'step_failed', timestamp: Date.now(), payload: { step: 'validate', error: validation.reason } })
    transition(runId, 'failed')
    return
  }

  transition(runId, 'running')
  emit(runId, { type: 'step_started', timestamp: Date.now(), payload: { step: 'validate', action: (intent as any).action } })
  emit(runId, { type: 'step_succeeded', timestamp: Date.now(), payload: { step: 'validate', action: (intent as any).action } })

  // Irreversible: request human approval before executing
  if (macOSRequiresApproval(intent as any)) {
    transition(runId, 'awaiting_approval')
    emit(runId, { type: 'approval_requested', timestamp: Date.now(), payload: {
      message: `macOS action "${(intent as any).action}" requires human approval (pilot safety gate)`,
      action: (intent as any).action,
      app: (intent as any).app,
      preview: ((intent as any).text ?? '').slice(0, 200),
    }})

    // Wait for approve/reject (10m timeout → auto-reject, matching github_issue_create pattern)
    const approved = await new Promise<boolean>((resolve) => {
      pendingApprovals.set(runId, { runId, resolve })
      setTimeout(() => {
        if (pendingApprovals.has(runId)) {
          pendingApprovals.delete(runId)
          resolve(false)
        }
      }, getApprovalTimeoutMs())
    })

    emit(runId, { type: 'approval_resolved', timestamp: Date.now(), payload: { approved, runId } })

    if (!approved) {
      const run = runs.get(runId)
      if (run) run.result = { outcome: 'rejected', recoveryHint: 'Re-submit and approve when ready.' } as any
      transition(runId, 'rejected')
      return
    }

    transition(runId, 'running')
  }

  // Execute
  emit(runId, { type: 'step_started', timestamp: Date.now(), payload: { step: 'execute', action: (intent as any).action } })
  const result = await macOSExecuteIntent(intent as any)

  // Check if aborted while executing — kill-switch may have fired during the await
  const runAfterExec = runs.get(runId)
  if (!runAfterExec || runAfterExec.status === 'aborted') return

  if (result.ok) {
    emit(runId, { type: 'step_succeeded', timestamp: Date.now(), payload: {
      step: 'execute',
      action: (intent as any).action,
      output: result.output?.slice(0, 200),
      stepCount: result.steps.length,
    }})
    const run = runs.get(runId)
    if (run) run.result = { outcome: 'completed', output: result.output, steps: result.steps } as any
    transition(runId, 'completed')
  } else {
    emit(runId, { type: 'step_failed', timestamp: Date.now(), payload: { step: 'execute', error: result.error } })
    const run = runs.get(runId)
    if (run) run.result = { outcome: 'failed', errorMessage: result.error } as any
    transition(runId, 'failed')
  }
}
