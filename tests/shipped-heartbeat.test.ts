// Tests for shipped-artifact auto-heartbeat
// Task: task-1771691652369-2c2y0uknl
// Done criteria mapping:
//   ✅ Compact heartbeat payload format documented → buildPayload + formatMessage tests
//   ✅ Trigger + suppression rule documented → handleTaskEvent + suppression tests
//   ✅ At least 3 example messages (ops/product/comms) → example format tests
//   ✅ Failure mode notes → dedup, missing artifact, reviewer override tests

import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildPayload,
  formatMessage,
  _testing,
  type ShippedHeartbeatPayload,
} from '../src/shipped-heartbeat.js'
import type { Task } from '../src/types.js'

// ── Helpers ──

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-test-001',
    title: 'Test task',
    status: 'validating',
    assignee: 'link',
    reviewer: 'sage',
    createdBy: 'kai',
    createdAt: Date.now() - 60000,
    updatedAt: Date.now(),
    metadata: {
      artifact_path: 'process/test-spec.md',
      eta: '~2h',
    },
    ...overrides,
  }
}

beforeEach(() => {
  _testing.dedupMap.clear()
  _testing.stats.totalEmitted = 0
  _testing.stats.totalSuppressed = 0
  _testing.stats.suppressionReasons = {}
  _testing.stats.lastEmittedAt = null
})

// ── Payload Format (Done Criteria #1) ──

describe('buildPayload', () => {
  it('builds correct payload from task with artifact_path', () => {
    const task = makeTask()
    const payload = buildPayload(task)

    expect(payload).not.toBeNull()
    expect(payload!.taskId).toBe('task-test-001')
    expect(payload!.shipped).toBe('process/test-spec.md')
    expect(payload!.next).toBe('~2h')
    expect(payload!.reviewer).toBe('@sage')
    expect(payload!.owner).toBe('@link')
  })

  it('returns null when no artifact_path', () => {
    const task = makeTask({ metadata: {} })
    expect(buildPayload(task)).toBeNull()
  })

  it('uses "done" as next when task status is done', () => {
    const task = makeTask({ status: 'done' })
    const payload = buildPayload(task)
    expect(payload!.next).toBe('done')
  })

  it('uses "pending review" when no eta in metadata', () => {
    const task = makeTask({
      status: 'validating',
      metadata: { artifact_path: 'process/spec.md' },
    })
    const payload = buildPayload(task)
    expect(payload!.next).toBe('pending review')
  })

  it('handles missing reviewer gracefully', () => {
    const task = makeTask({ reviewer: undefined })
    const payload = buildPayload(task)
    expect(payload!.reviewer).toBe('none')
  })

  it('handles missing assignee gracefully', () => {
    const task = makeTask({ assignee: undefined })
    const payload = buildPayload(task)
    expect(payload!.owner).toBe('unknown')
  })
})

describe('formatMessage', () => {
  it('produces canonical compact format', () => {
    const payload: ShippedHeartbeatPayload = {
      taskId: 'task-abc123',
      shipped: 'process/spec.md',
      next: 'pending review',
      reviewer: '@sage',
      owner: '@scout',
      lane: 'ops',
    }
    const msg = formatMessage(payload)
    expect(msg).toBe(
      '[SHIP] task-abc123 | shipped:process/spec.md | next:pending review | review:@sage | by:@scout'
    )
  })
})

// ── Example Messages: ops / product / comms (Done Criteria #3) ──

describe('example messages by lane', () => {
  it('ops example — deploy artifact', () => {
    const task = makeTask({
      id: 'task-ops-deploy-001',
      title: 'Deploy staging infra update',
      assignee: 'link',
      reviewer: 'kai',
      metadata: { artifact_path: 'process/deploy-runbook.md', eta: '~1h', role_type: 'ops' },
      tags: ['ops'],
    })
    const payload = buildPayload(task)!
    const msg = formatMessage(payload)

    expect(msg).toBe(
      '[SHIP] task-ops-deploy-001 | shipped:process/deploy-runbook.md | next:~1h | review:@kai | by:@link'
    )
    expect(payload.lane).toBe('ops')
  })

  it('product example — feature spec', () => {
    const task = makeTask({
      id: 'task-prod-spec-002',
      title: 'Design onboarding flow spec',
      assignee: 'scout',
      reviewer: 'pixel',
      metadata: { artifact_path: 'process/onboarding-spec.md', eta: 'pending review', role_type: 'product' },
      tags: ['product'],
    })
    const payload = buildPayload(task)!
    const msg = formatMessage(payload)

    expect(msg).toBe(
      '[SHIP] task-prod-spec-002 | shipped:process/onboarding-spec.md | next:pending review | review:@pixel | by:@scout'
    )
    expect(payload.lane).toBe('product')
  })

  it('comms example — docs/announcement', () => {
    const task = makeTask({
      id: 'task-comms-docs-003',
      title: 'Announce v2 launch blog post',
      assignee: 'echo',
      reviewer: 'sage',
      status: 'done',
      metadata: { artifact_path: 'docs/v2-launch-post.md', role_type: 'comms' },
      tags: ['comms'],
    })
    const payload = buildPayload(task)!
    const msg = formatMessage(payload)

    expect(msg).toBe(
      '[SHIP] task-comms-docs-003 | shipped:docs/v2-launch-post.md | next:done | review:@sage | by:@echo'
    )
    expect(payload.lane).toBe('comms')
  })
})

// ── Lane Inference ──

describe('inferLane', () => {
  it('infers ops from role_type', () => {
    const task = makeTask({ metadata: { artifact_path: 'process/x.md', role_type: 'ops' } })
    const payload = buildPayload(task)!
    expect(payload.lane).toBe('ops')
  })

  it('infers product from tags', () => {
    const task = makeTask({ tags: ['product'] })
    const payload = buildPayload(task)!
    expect(payload.lane).toBe('product')
  })

  it('infers comms from title keyword', () => {
    const task = makeTask({ title: 'Write blog announcement', tags: [] })
    expect(_testing.inferLane(task)).toBe('comms')
  })

  it('infers engineering from dev tag', () => {
    const task = makeTask({ tags: ['dev'] })
    expect(_testing.inferLane(task)).toBe('engineering')
  })

  it('falls back to unknown', () => {
    const task = makeTask({ title: 'Misc cleanup', tags: [], metadata: { artifact_path: 'process/x.md' } })
    expect(_testing.inferLane(task)).toBe('unknown')
  })
})

// ── Trigger + Suppression Rules (Done Criteria #2) ──

describe('suppression: dedup window', () => {
  it('isDuplicate returns false on first emit', () => {
    expect(_testing.isDuplicate('task-new')).toBe(false)
  })

  it('isDuplicate returns true within 30m window', () => {
    _testing.dedupMap.set('task-recent', Date.now() - 10 * 60 * 1000) // 10m ago
    expect(_testing.isDuplicate('task-recent')).toBe(true)
  })

  it('isDuplicate returns false after 30m window expires', () => {
    _testing.dedupMap.set('task-old', Date.now() - 31 * 60 * 1000) // 31m ago
    expect(_testing.isDuplicate('task-old')).toBe(false)
  })
})

describe('suppression: artifact validation', () => {
  it('accepts process/ paths', () => {
    expect(_testing.isValidArtifactPath('process/spec.md')).toBe(true)
  })

  it('accepts src/ paths', () => {
    expect(_testing.isValidArtifactPath('src/feature.ts')).toBe(true)
  })

  it('accepts docs/ paths', () => {
    expect(_testing.isValidArtifactPath('docs/runbook.md')).toBe(true)
  })

  it('rejects random paths', () => {
    expect(_testing.isValidArtifactPath('tmp/scratch.txt')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(_testing.isValidArtifactPath('')).toBe(false)
  })
})

// ── Failure Modes (Done Criteria #4) ──

describe('failure mode: duplicate spam', () => {
  it('dedup map prevents double-emit on rapid status flips', () => {
    // Simulate: task goes validating (emit) → blocked → validating (should suppress)
    _testing.dedupMap.set('task-flip', Date.now() - 5 * 60 * 1000) // 5m ago

    expect(_testing.isDuplicate('task-flip')).toBe(true)
    // This prevents the second validating transition from double-posting
  })
})

describe('failure mode: missing artifact link', () => {
  it('buildPayload returns null for task without artifact_path', () => {
    const task = makeTask({ metadata: {} })
    expect(buildPayload(task)).toBeNull()
  })

  it('buildPayload returns null for non-string artifact_path', () => {
    const task = makeTask({ metadata: { artifact_path: 42 } })
    expect(buildPayload(task)).toBeNull()
  })
})

describe('failure mode: reviewer override suppression', () => {
  // Note: isReviewerOverride depends on chatManager which requires integration test.
  // Unit-level: we verify the function exists and handles missing reviewer.
  it('returns false when task has no reviewer', () => {
    const task = makeTask({ reviewer: undefined })
    expect(_testing.isReviewerOverride(task)).toBe(false)
  })
})

// ── Zombie Cleanup & N/A Review Packet Suppression (Regression) ──

describe('suppression: zombie cleanup transitions', () => {
  it('handleTaskEvent suppresses zombie cleanup transition', async () => {
    const task = makeTask({
      metadata: {
        artifact_path: 'process/TASK-zombie.md',
        transition: { type: 'resume', reason: 'Zombie cleanup' },
        qa_bundle: {
          review_packet: { pr_url: 'N/A', commit: 'N/A' },
        },
      },
    })
    const event = { type: 'task_updated' as const, data: task, timestamp: Date.now() }
    await _testing.handleTaskEvent(event)
    expect(_testing.stats.totalEmitted).toBe(0)
    expect(_testing.stats.suppressionReasons['zombie_cleanup']).toBe(1)
  })

  it('handleTaskEvent suppresses auto_close_reason zombie cleanup', async () => {
    const task = makeTask({
      metadata: {
        artifact_path: 'process/TASK-zombie2.md',
        auto_close_reason: 'Zombie task cleanup',
        qa_bundle: {
          review_packet: { pr_url: 'N/A', commit: 'N/A' },
        },
      },
    })
    const event = { type: 'task_updated' as const, data: task, timestamp: Date.now() }
    await _testing.handleTaskEvent(event)
    expect(_testing.stats.totalEmitted).toBe(0)
    expect(_testing.stats.suppressionReasons['zombie_cleanup']).toBe(1)
  })
})

describe('suppression: N/A review packet', () => {
  it('handleTaskEvent suppresses when pr_url and commit are N/A', async () => {
    const task = makeTask({
      metadata: {
        artifact_path: 'process/TASK-fake.md',
        qa_bundle: {
          review_packet: { pr_url: 'N/A', commit: 'N/A' },
        },
      },
    })
    const event = { type: 'task_updated' as const, data: task, timestamp: Date.now() }
    await _testing.handleTaskEvent(event)
    expect(_testing.stats.totalEmitted).toBe(0)
    expect(_testing.stats.suppressionReasons['invalid_review_packet']).toBe(1)
  })

  it('handleTaskEvent suppresses when pr_url is missing and commit is short', async () => {
    const task = makeTask({
      metadata: {
        artifact_path: 'process/TASK-missing.md',
        qa_bundle: {
          review_packet: { commit: 'abc' },
        },
      },
    })
    const event = { type: 'task_updated' as const, data: task, timestamp: Date.now() }
    await _testing.handleTaskEvent(event)
    expect(_testing.stats.totalEmitted).toBe(0)
    expect(_testing.stats.suppressionReasons['invalid_review_packet']).toBe(1)
  })

  it('handleTaskEvent allows valid pr_url even without commit', async () => {
    const task = makeTask({
      metadata: {
        artifact_path: 'process/TASK-valid.md',
        eta: '~1h',
        qa_bundle: {
          review_packet: { pr_url: 'https://github.com/reflectt/reflectt-node/pull/432' },
        },
      },
    })
    const event = { type: 'task_updated' as const, data: task, timestamp: Date.now() }
    await _testing.handleTaskEvent(event)
    // Should not be suppressed by review packet check
    // (may be suppressed by reviewer override or other checks, but not invalid_review_packet)
    expect(_testing.stats.suppressionReasons['invalid_review_packet']).toBeUndefined()
  })

  it('handleTaskEvent allows valid commit SHA even without pr_url', async () => {
    const task = makeTask({
      metadata: {
        artifact_path: 'process/TASK-sha.md',
        eta: '~1h',
        commit_sha: 'c6c2f0660a99b49a2fe45bfd3fb8a165c9b4654f',
        qa_bundle: {
          review_packet: { commit: 'c6c2f0660a99b49a2fe45bfd3fb8a165c9b4654f' },
        },
      },
    })
    const event = { type: 'task_updated' as const, data: task, timestamp: Date.now() }
    await _testing.handleTaskEvent(event)
    expect(_testing.stats.suppressionReasons['invalid_review_packet']).toBeUndefined()
  })
})
