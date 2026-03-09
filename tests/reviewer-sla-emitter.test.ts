// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadReviewSlaHelpers() {
  const source = readFileSync(join(process.cwd(), 'public/dashboard.js'), 'utf8')
  const match = source.match(/function hasReviewerDecision\(task\) \{[\s\S]*?function shouldEscalateReviewerSla\(task\) \{[\s\S]*?\n\}/)
  if (!match) {
    throw new Error('Failed to locate reviewer SLA helpers in public/dashboard.js')
  }

  const factory = new Function(`${match[0]}; return { hasReviewerDecision, shouldEscalateReviewerSla };`)
  return factory() as {
    hasReviewerDecision: (task: Record<string, unknown>) => boolean
    shouldEscalateReviewerSla: (task: Record<string, unknown>) => boolean
  }
}

describe('reviewer SLA emitter precedence', () => {
  it('suppresses reviewer paging when reviewer_decision already exists', () => {
    const { hasReviewerDecision, shouldEscalateReviewerSla } = loadReviewSlaHelpers()

    const task = {
      status: 'validating',
      slaState: 'breach',
      metadata: {
        review_state: 'needs_author',
        reviewer_decision: {
          decision: 'changes_requested',
          reviewer: 'sage',
          decidedAt: Date.now(),
        },
      },
    }

    expect(hasReviewerDecision(task)).toBe(true)
    expect(shouldEscalateReviewerSla(task)).toBe(false)
  })

  it('still escalates true reviewer wait breaches without reviewer_decision', () => {
    const { shouldEscalateReviewerSla } = loadReviewSlaHelpers()

    const task = {
      status: 'validating',
      slaState: 'breach',
      metadata: {
        review_state: 'queued',
      },
    }

    expect(shouldEscalateReviewerSla(task)).toBe(true)
  })
})
