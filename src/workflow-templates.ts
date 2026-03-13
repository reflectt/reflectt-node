// SPDX-License-Identifier: Apache-2.0
// Canonical workflow templates — reusable, runnable, regression-testable
// Packages the proven PR review → approve → handoff → completion loop

import { createAgentRun, updateAgentRun, appendAgentEvent, getAgentRun } from './agent-runs.js'

const LOCAL_NODE_BASE = process.env.REFLECTT_NODE_BASE_URL || 'http://127.0.0.1:4445'

type CanvasEmitState = 'thinking' | 'rendering' | 'ambient' | 'urgent'

async function emitCanvasState(agentId: string, state: CanvasEmitState, text: string, extraPayload: Record<string, unknown> = {}): Promise<void> {
  try {
    await fetch(`${LOCAL_NODE_BASE}/canvas/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state,
        agentId,
        payload: { text, ...extraPayload },
      }),
    })
  } catch {
    // Presence updates are best-effort; workflow execution must continue.
  }
}

export interface WorkflowStep {
  name: string
  description: string
  action: (ctx: WorkflowContext) => Promise<StepResult> | StepResult
}

export interface WorkflowContext {
  runId: string
  agentId: string
  teamId: string
  params: Record<string, unknown>
}

export interface StepResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
}

export interface WorkflowResult {
  success: boolean
  runId: string
  steps: Array<{ name: string; success: boolean; data?: Record<string, unknown>; error?: string; durationMs: number }>
  totalDurationMs: number
}

// ── PR Review Workflow ──────────────────────────────────────────────────

export const prReviewWorkflow: WorkflowTemplate = {
  id: 'pr-review',
  name: 'PR Review → Approve → Handoff → Complete',
  description: 'The canonical agent workflow: create run, attach task, request review, approve, handoff, complete.',
  steps: [
    {
      name: 'create_run',
      description: 'Create an agent run with objective',
      action: (ctx) => {
        const run = createAgentRun(ctx.agentId, ctx.teamId, ctx.params.objective as string ?? 'PR review workflow', {
          taskId: ctx.params.taskId as string,
        })
        ctx.runId = run.id
        return { success: true, data: { runId: run.id } }
      },
    },
    {
      name: 'start_work',
      description: 'Move run to working status',
      action: (ctx) => {
        updateAgentRun(ctx.runId, { status: 'working' })
        appendAgentEvent({
          agentId: ctx.agentId,
          runId: ctx.runId,
          eventType: 'work_started',
          payload: { message: 'Agent began working on objective' },
        })
        return { success: true }
      },
    },
    {
      name: 'request_review',
      description: 'Submit work for review',
      action: (ctx) => {
        updateAgentRun(ctx.runId, { status: 'waiting_review' })
        const event = appendAgentEvent({
          agentId: ctx.agentId,
          runId: ctx.runId,
          eventType: 'review_requested',
          payload: {
            action_required: 'review',
            urgency: ctx.params.urgency as string ?? 'normal',
            owner: ctx.params.reviewer as string ?? 'kai',
            pr_url: ctx.params.prUrl as string,
            title: ctx.params.title as string ?? 'Review requested',
            rationale: {
              choice: (ctx.params.rationale as string) ?? 'Work completed — requesting review to validate output against acceptance criteria.',
              considered: ['self-merge', 'skip review'],
              constraint: 'All decision events require structured rationale per routing schema',
            },
          },
        })
        return { success: true, data: { eventId: event.id } }
      },
    },
    {
      name: 'approve',
      description: 'Approve the review (simulates reviewer action)',
      action: (ctx) => {
        updateAgentRun(ctx.runId, { status: 'working' })
        appendAgentEvent({
          agentId: ctx.agentId,
          runId: ctx.runId,
          eventType: 'review_approved',
          payload: {
            reviewer: ctx.params.reviewer as string ?? 'kai',
            comment: 'LGTM',
            rationale: {
              choice: (ctx.params.approvalRationale as string) ?? 'Changes reviewed and approved — meets acceptance criteria.',
              considered: ['request changes', 'reject'],
              constraint: 'Approval requires explicit rationale for audit trail',
            },
          },
        })
        return { success: true }
      },
    },
    {
      name: 'handoff',
      description: 'Hand off to next owner or complete',
      action: (ctx) => {
        appendAgentEvent({
          agentId: ctx.agentId,
          runId: ctx.runId,
          eventType: 'handed_off',
          payload: {
            action_required: 'approve',
            urgency: 'normal',
            owner: ctx.params.nextOwner as string ?? ctx.agentId,
            summary: ctx.params.summary as string ?? 'Work reviewed and approved',
            rationale: {
              choice: (ctx.params.handoffRationale as string) ?? 'Handing off to next owner for final approval and merge.',
              considered: ['self-complete', 'escalate'],
              constraint: 'Handoff requires rationale per decision event schema',
            },
          },
        })
        return { success: true }
      },
    },
    {
      name: 'complete',
      description: 'Mark run as completed',
      action: (ctx) => {
        updateAgentRun(ctx.runId, { status: 'completed', completedAt: Date.now() })
        appendAgentEvent({
          agentId: ctx.agentId,
          runId: ctx.runId,
          eventType: 'run_completed',
          payload: { message: 'Workflow completed successfully' },
        })
        return { success: true }
      },
    },
  ],
}

// ── Workflow runner ──────────────────────────────────────────────────────

export async function runWorkflow(
  template: WorkflowTemplate,
  agentId: string,
  teamId: string,
  params: Record<string, unknown> = {},
): Promise<WorkflowResult> {
  const start = Date.now()
  const ctx: WorkflowContext = { runId: '', agentId, teamId, params }
  const stepResults: WorkflowResult['steps'] = []

  for (const step of template.steps) {
    const stepStart = Date.now()
    await emitCanvasState(ctx.agentId, 'thinking', step.description)
    try {
      const result = await step.action(ctx)
      stepResults.push({
        name: step.name,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - stepStart,
      })
      if (!result.success) {
        await emitCanvasState(ctx.agentId, 'urgent', result.error || `Step failed: ${step.description}`)
        return { success: false, runId: ctx.runId, steps: stepResults, totalDurationMs: Date.now() - start }
      }
      await emitCanvasState(ctx.agentId, 'rendering', `Completed: ${step.description}`)
    } catch (err: any) {
      stepResults.push({
        name: step.name,
        success: false,
        error: err.message,
        durationMs: Date.now() - stepStart,
      })
      await emitCanvasState(ctx.agentId, 'urgent', err.message || `Step failed: ${step.description}`)
      return { success: false, runId: ctx.runId, steps: stepResults, totalDurationMs: Date.now() - start }
    }
  }

  await emitCanvasState(ctx.agentId, 'ambient', 'Workflow completed successfully')
  return { success: true, runId: ctx.runId, steps: stepResults, totalDurationMs: Date.now() - start }
}

// ── Template registry ───────────────────────────────────────────────────

const TEMPLATES = new Map<string, WorkflowTemplate>([
  ['pr-review', prReviewWorkflow],
])

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return TEMPLATES.get(id)
}

export function listWorkflowTemplates(): Array<{ id: string; name: string; description: string; stepCount: number }> {
  return [...TEMPLATES.values()].map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    stepCount: t.steps.length,
  }))
}
