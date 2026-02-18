// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Task Transition Precheck
 *
 * Surfaces required fields BEFORE a status transition attempt,
 * so agents don't get rejected at gate time.
 *
 * Also provides auto-defaults for common fields (ETA, artifact path).
 */

import { taskManager } from './tasks.js'
import { policyManager } from './policy.js'
import type { Task } from './types.js'

// ── Types ──────────────────────────────────────────────────────────────────

export type PrecheckSeverity = 'error' | 'warning' | 'info'

export interface PrecheckItem {
  field: string
  severity: PrecheckSeverity
  message: string
  hint?: string
  autoDefault?: unknown
}

export interface PrecheckResult {
  taskId: string
  currentStatus: string
  targetStatus: string
  ready: boolean
  items: PrecheckItem[]
  autoDefaults: Record<string, unknown>
  template: Record<string, unknown> | null
}

// ── Default ETA by priority ────────────────────────────────────────────────

const DEFAULT_ETA_BY_PRIORITY: Record<string, string> = {
  P0: '~30m',
  P1: '~2h',
  P2: '~4h',
  P3: '~1d',
  P4: '~3d',
}

// ── Precheck ───────────────────────────────────────────────────────────────

export function runPrecheck(taskId: string, targetStatus: string): PrecheckResult {
  const task = taskManager.getTask(taskId)
  if (!task) {
    return {
      taskId,
      currentStatus: 'unknown',
      targetStatus,
      ready: false,
      items: [{ field: 'task', severity: 'error', message: `Task ${taskId} not found` }],
      autoDefaults: {},
      template: null,
    }
  }

  const items: PrecheckItem[] = []
  const autoDefaults: Record<string, unknown> = {}
  const meta = (task.metadata as Record<string, unknown>) || {}

  // ── Common gates (all non-todo statuses) ────────────────────────────

  if (targetStatus !== 'todo') {
    if (!task.done_criteria || task.done_criteria.length === 0) {
      items.push({
        field: 'done_criteria',
        severity: 'error',
        message: 'done_criteria required (at least 1 item)',
        hint: 'Add specific, verifiable completion criteria.',
      })
    }

    if (!task.reviewer?.trim()) {
      items.push({
        field: 'reviewer',
        severity: 'error',
        message: 'reviewer required before starting work',
        hint: 'Assign a reviewer who can validate the work.',
      })
    }
  }

  // ── doing ───────────────────────────────────────────────────────────

  if (targetStatus === 'doing') {
    const eta = meta.eta as string | undefined
    if (!eta?.trim()) {
      const defaultEta = DEFAULT_ETA_BY_PRIORITY[task.priority || 'P2'] || '~4h'
      items.push({
        field: 'metadata.eta',
        severity: 'warning',
        message: `ETA required. Auto-default available: "${defaultEta}" (based on ${task.priority || 'P2'} priority)`,
        hint: 'Provide explicit ETA or accept the auto-default.',
        autoDefault: defaultEta,
      })
      autoDefaults['metadata.eta'] = defaultEta
    }
  }

  // ── validating ──────────────────────────────────────────────────────

  if (targetStatus === 'validating') {
    // Artifact path
    const artifactPath = meta.artifact_path as string | undefined
    if (!artifactPath?.trim()) {
      const suggestedPath = `process/TASK-${taskId.split('-').pop()}.md`
      items.push({
        field: 'metadata.artifact_path',
        severity: 'error',
        message: 'artifact_path required under process/',
        hint: `Suggested: "${suggestedPath}"`,
        autoDefault: suggestedPath,
      })
      autoDefaults['metadata.artifact_path'] = suggestedPath
    } else if (!artifactPath.startsWith('process/')) {
      items.push({
        field: 'metadata.artifact_path',
        severity: 'error',
        message: 'artifact_path must be under process/ (repo-relative)',
      })
    }

    // Review handoff
    const handoff = meta.review_handoff as Record<string, unknown> | undefined
    if (!handoff) {
      items.push({
        field: 'metadata.review_handoff',
        severity: 'error',
        message: 'review_handoff object required for validating transition',
        hint: 'Must include: task_id, artifact_path, test_proof, known_caveats. Also pr_url + commit_sha unless doc_only or config_only.',
      })
    } else {
      if (!handoff.task_id) {
        items.push({ field: 'metadata.review_handoff.task_id', severity: 'error', message: 'task_id required in review_handoff' })
      } else if (handoff.task_id !== taskId) {
        items.push({ field: 'metadata.review_handoff.task_id', severity: 'error', message: `task_id must match: expected "${taskId}"` })
      }
      if (!handoff.artifact_path) {
        items.push({ field: 'metadata.review_handoff.artifact_path', severity: 'error', message: 'artifact_path required in review_handoff' })
      }
      if (!handoff.test_proof) {
        items.push({ field: 'metadata.review_handoff.test_proof', severity: 'error', message: 'test_proof required (e.g. "vitest run: 206 pass")' })
      }
      if (handoff.known_caveats === undefined) {
        items.push({ field: 'metadata.review_handoff.known_caveats', severity: 'error', message: 'known_caveats required (use "none" if none)' })
      }

      const isDocOnly = handoff.doc_only === true
      const isConfigOnly = handoff.config_only === true
      if (!isDocOnly && !isConfigOnly) {
        if (!handoff.pr_url) {
          items.push({ field: 'metadata.review_handoff.pr_url', severity: 'error', message: 'PR URL required (or set doc_only/config_only=true)' })
        }
        if (!handoff.commit_sha) {
          items.push({ field: 'metadata.review_handoff.commit_sha', severity: 'error', message: 'commit SHA required (or set doc_only/config_only=true)' })
        }
      }
    }

    // QA bundle
    const qaBundle = meta.qa_bundle as Record<string, unknown> | undefined
    if (!qaBundle) {
      items.push({
        field: 'metadata.qa_bundle',
        severity: 'warning',
        message: 'qa_bundle recommended for validating (summary, artifact_links, checks, lane, changed_files, screenshot_proof)',
        hint: 'Include: { summary, artifact_links: [], checks: [], lane, pr_link, commit_shas: [], changed_files: [], screenshot_proof: [] }',
      })
    } else {
      if (!qaBundle.summary) items.push({ field: 'metadata.qa_bundle.summary', severity: 'warning', message: 'qa_bundle.summary recommended' })
      if (!Array.isArray(qaBundle.checks) || qaBundle.checks.length === 0) {
        items.push({ field: 'metadata.qa_bundle.checks', severity: 'warning', message: 'qa_bundle.checks recommended (e.g. ["tsc clean", "vitest 206 pass"])' })
      }
      if (!Array.isArray(qaBundle.changed_files) || qaBundle.changed_files.length === 0) {
        items.push({ field: 'metadata.qa_bundle.changed_files', severity: 'warning', message: 'qa_bundle.changed_files recommended' })
      }
    }
  }

  // ── done ────────────────────────────────────────────────────────────

  if (targetStatus === 'done') {
    if (!meta.reviewer_approved) {
      items.push({
        field: 'metadata.reviewer_approved',
        severity: 'error',
        message: 'reviewer_approved must be true before marking done',
      })
    }
    if (!meta.artifact_path && !meta.artifacts) {
      items.push({
        field: 'metadata.artifact_path',
        severity: 'error',
        message: 'artifact_path or artifacts required for done status',
      })
    }
  }

  // ── Ready-queue floor warning ────────────────────────────────────────

  if ((targetStatus === 'validating' || targetStatus === 'done') && task.assignee) {
    const policy = policyManager.get()
    const rqf = policy.readyQueueFloor
    if (rqf?.enabled && rqf.agents.includes(task.assignee)) {
      const todoTasks = taskManager.listTasks({ status: 'todo', assignee: task.assignee })
      const unblockedTodo = todoTasks.filter(t => {
        const blocked = t.metadata?.blocked_by
        if (!blocked) return true
        const blocker = taskManager.getTask(blocked as string)
        return !blocker || blocker.status === 'done'
      })
      // This task is leaving the queue, so effective count will drop
      const effectiveReady = unblockedTodo.length
      if (effectiveReady < rqf.minReady) {
        items.push({
          field: 'readyQueueFloor',
          severity: 'warning',
          message: `Ready queue will be ${effectiveReady}/${rqf.minReady} after this transition. Ensure next tasks are queued for @${task.assignee}.`,
          hint: 'Create/assign more todo tasks to maintain engineering lane throughput.',
        })
      }
    }
  }

  // ── Build template ──────────────────────────────────────────────────

  const template = buildTemplate(task, targetStatus, autoDefaults)
  const hasErrors = items.some(i => i.severity === 'error')

  return {
    taskId,
    currentStatus: task.status,
    targetStatus,
    ready: !hasErrors,
    items,
    autoDefaults,
    template,
  }
}

// ── Auto-defaults application ──────────────────────────────────────────────

export function applyAutoDefaults(
  taskId: string,
  targetStatus: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const task = taskManager.getTask(taskId)
  if (!task) return metadata

  const result = { ...metadata }

  // Auto-fill ETA for doing
  if (targetStatus === 'doing' && !result.eta) {
    const priority = task.priority || 'P2'
    result.eta = DEFAULT_ETA_BY_PRIORITY[priority] || '~4h'
  }

  // Auto-fill artifact_path for validating
  if (targetStatus === 'validating' && !result.artifact_path) {
    const shortId = taskId.split('-').pop()
    result.artifact_path = `process/TASK-${shortId}.md`
  }

  return result
}

// ── Template builder ───────────────────────────────────────────────────────

function buildTemplate(
  task: Task,
  targetStatus: string,
  autoDefaults: Record<string, unknown>,
): Record<string, unknown> | null {
  const shortId = task.id.split('-').pop()

  if (targetStatus === 'doing') {
    return {
      status: 'doing',
      metadata: {
        eta: autoDefaults['metadata.eta'] || '<required>',
        branch: `link/task-${shortId}`,
      },
    }
  }

  if (targetStatus === 'validating') {
    return {
      status: 'validating',
      metadata: {
        artifact_path: autoDefaults['metadata.artifact_path'] || `process/TASK-${shortId}.md`,
        review_handoff: {
          task_id: task.id,
          repo: 'reflectt/reflectt-node',
          pr_url: '<required: https://github.com/reflectt/reflectt-node/pull/NNN>',
          commit_sha: '<required: 7+ hex chars>',
          artifact_path: `process/TASK-${shortId}.md`,
          test_proof: '<required: e.g. "vitest run: 206 pass, tsc clean">',
          known_caveats: '<required: "none" or description>',
        },
        qa_bundle: {
          summary: '<recommended>',
          artifact_links: ['<PR URL>'],
          checks: ['<e.g. tsc clean>', '<vitest NNN pass>'],
          lane: '<feature name>',
          pr_link: '<PR URL>',
          commit_shas: ['<sha>'],
          changed_files: ['<file1>', '<file2>'],
          screenshot_proof: ['<test output summary>'],
        },
      },
    }
  }

  return null
}
