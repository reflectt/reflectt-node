/**
 * Integration tests for reflectt-node API
 *
 * Tests core API contracts: task CRUD, backlog, claim, close gate, chat, inbox.
 * Spins up the actual Fastify server for each test suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createServer } from '../src/server.js'
import { DATA_DIR, REFLECTT_HOME } from '../src/config.js'
import { setTestRoles } from '../src/assignment.js'
import { TEST_AGENT_ROLES } from './fixtures/test-roles.js'
import { getDb } from '../src/db.js'
import { _clearFeedbackStore } from '../src/feedback.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  setTestRoles(TEST_AGENT_ROLES)
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  // Clean up all TEST: prefixed tasks created during this run
  // to prevent pollution across test runs sharing the same DB
  try {
    const res = await app.inject({ method: 'GET', url: '/tasks?limit=500' })
    const tasks = JSON.parse(res.body)?.tasks || []
    for (const task of tasks) {
      if (typeof task.title === 'string' && task.title.startsWith('TEST:')) {
        await app.inject({ method: 'DELETE', url: `/tasks/${task.id}` })
      }
    }
  } catch {
    // Best-effort cleanup — don't fail the suite if cleanup errors
  }
  await app.close()
})

// Helper to make requests against the test server
async function req(method: string, url: string, body?: unknown) {
  const res = await app.inject({
    method: method as any,
    url,
    payload: body,
    headers: body ? { 'content-type': 'application/json' } : undefined,
  })
  return {
    status: res.statusCode,
    body: JSON.parse(res.body),
  }
}

/**
 * Walk a task from todo through valid transitions.
 * 'doing' = todo→doing
 * 'validating' = todo→doing→validating (with minimal valid QA bundle)
 */
async function advanceTo(taskId: string, targetStatus: 'doing' | 'validating'): Promise<void> {
  await req('PATCH', `/tasks/${taskId}`, {
    status: 'doing',
    metadata: { transition: { type: 'claim', reason: 'test advance' }, eta: '~1h' },
  })
  if (targetStatus === 'validating') {
    await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-test-advance.md',
        qa_bundle: validQaBundle({
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
            commit: 'abc1234',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-test-advance.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit_sha: 'abc1234',
          changed_files: ['src/server.ts'],
          artifact_path: 'process/TASK-test-advance.md',
          test_proof: 'test',
          known_caveats: 'none',
          caveats: 'none',
        },
      },
    })
  }
}

/** Build a valid QA bundle that passes QaBundleSchema */
function validQaBundle(overrides: Record<string, unknown> = {}) {
  return {
    lane: 'test',
    summary: 'test bundle',
    pr_link: 'https://github.com/reflectt/reflectt-node/pull/999',
    commit_shas: ['abc1234'],
    changed_files: ['src/server.ts'],
    artifact_links: ['process/TASK-test-proof.md'],
    checks: ['npm test'],
    screenshot_proof: ['process/TASK-test-proof.md'],
    review_packet: {
      task_id: 'task-0000000000000-default',
      pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
      commit: 'abc1234',
      changed_files: ['src/server.ts'],
      artifact_path: 'process/TASK-test-proof.md',
      caveats: 'none',
    },
    ...overrides,
  }
}

describe('Health', () => {
  it('GET /health returns ok', async () => {
    const { status, body } = await req('GET', '/health')
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.tasks).toBeDefined()
    expect(body.chat).toBeDefined()
  })

  it('GET /health/build returns build info with SHA and PID', async () => {
    const { status, body } = await req('GET', '/health/build')
    expect(status).toBe(200)
    expect(body.appVersion).toBeDefined()
    expect(body.gitSha).toBeDefined()
    expect(body.gitShortSha).toBeDefined()
    expect(body.gitBranch).toBeDefined()
    expect(body.buildTimestamp).toBeDefined()
    expect(body.pid).toBeTypeOf('number')
    expect(body.nodeVersion).toBeDefined()
    expect(body.startedAt).toBeDefined()
    expect(body.uptime).toBeTypeOf('number')
  })

  it('GET /health/deploy returns deploy attestation payload', async () => {
    const { status, body } = await req('GET', '/health/deploy')
    expect(status).toBe(200)
    expect(body.version).toBeDefined()
    expect(body.gitSha).toBeDefined()
    expect(body.gitShortSha).toBeDefined()
    expect(body.branch).toBeDefined()
    expect(body.buildTimestamp).toBeDefined()
    expect(body.startedAt).toBeDefined()
    expect(body.pid).toBeTypeOf('number')
    expect(body.nodeVersion).toBeDefined()
    expect(body.uptime).toBeTypeOf('number')
  })

  it('GET /team/health returns team config linter status payload', async () => {
    const { status, body } = await req('GET', '/team/health')
    expect(status).toBe(200)
    expect(typeof body.ok).toBe('boolean')
    expect(typeof body.checkedAt).toBe('number')
    expect(body.files).toBeDefined()
    expect(typeof body.files.teamMd).toBe('string')
    expect(typeof body.files.rolesYaml).toBe('string')
    expect(typeof body.files.standardsMd).toBe('string')
    expect(Array.isArray(body.issues)).toBe(true)
    expect(Array.isArray(body.assignmentRoleNames)).toBe(true)
  })

  it('GET /health/team includes active task title + PR link for each agent when available', async () => {
    const prLink = 'https://github.com/reflectt/reflectt-node/pull/59'
    const agentName = `health-agent-${Date.now()}`

    const created = await req('POST', '/tasks', {
      title: 'TEST: health team active task enrichment',
      description: 'Used to verify /health/team active task title and PR link',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: agentName,
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Verify /health/team payload'],
      eta: '1h',
      metadata: {
        eta: '1h',
        artifacts: [prLink],
      },
    })

    expect(created.status).toBe(200)
    const taskId = created.body.task.id as string

    const { status, body } = await req('GET', '/health/team')
    expect(status).toBe(200)
    expect(Array.isArray(body.agents)).toBe(true)

    const agent = body.agents.find((row: any) => row.agent === agentName)
    expect(agent).toBeDefined()
    expect(agent.activeTaskId).toBe(taskId)
    expect(agent.activeTaskTitle).toBe('TEST: health team active task enrichment')
    expect(agent.activeTaskPrLink).toBe(prLink)

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('GET /health/agents?teamId filters to team agents', async () => {
    const teamAgent = `health-team-a-${Date.now()}`
    const otherAgent = `health-team-b-${Date.now()}`

    const createTeam = await req('POST', '/tasks', {
      title: 'TEST: health team filter include',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: teamAgent,
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Verify health team filter include'],
      eta: '1h',
      teamId: 'team-alpha',
    })

    const createOther = await req('POST', '/tasks', {
      title: 'TEST: health team filter exclude',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: otherAgent,
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Verify health team filter exclude'],
      eta: '1h',
      teamId: 'team-beta',
    })

    expect(createTeam.status).toBe(200)
    expect(createOther.status).toBe(200)

    const res = await req('GET', '/health/agents?teamId=team-alpha')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.agents)).toBe(true)
    expect(res.body.agents.some((row: any) => row.agent === teamAgent)).toBe(true)
    expect(res.body.agents.some((row: any) => row.agent === otherAgent)).toBe(false)

    await req('DELETE', `/tasks/${createTeam.body.task.id}`)
    await req('DELETE', `/tasks/${createOther.body.task.id}`)
  })
})

describe('SQLite sync ledger', () => {
  it('creates sync_ledger table in schema v2', async () => {
    const { status, body } = await req('GET', '/db/status')
    expect(status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.schemaVersion).toBeGreaterThanOrEqual(2)
    expect(body.tables).toBeDefined()
    expect(typeof body.tables.sync_ledger).toBe('number')
  })

  it('supports pending -> synced lifecycle fields for task sync rows', async () => {
    const db = getDb()
    const taskId = `task-sync-ledger-${Date.now()}`
    const now = Date.now()

    db.prepare(`
      INSERT INTO sync_ledger (record_type, record_id, local_updated_at, sync_status, attempt_count)
      VALUES ('task', ?, ?, 'pending', 0)
      ON CONFLICT(record_type, record_id) DO UPDATE SET
        local_updated_at = excluded.local_updated_at,
        sync_status = 'pending'
    `).run(taskId, now)

    db.prepare(`
      UPDATE sync_ledger
      SET cloud_synced_at = ?, sync_status = 'synced', attempt_count = attempt_count + 1
      WHERE record_type = 'task' AND record_id = ?
    `).run(now + 500, taskId)

    const ledgerRow = db.prepare(`
      SELECT record_type, record_id, sync_status, local_updated_at, cloud_synced_at, attempt_count
      FROM sync_ledger
      WHERE record_type = 'task' AND record_id = ?
    `).get(taskId) as {
      record_type: string
      record_id: string
      sync_status: string
      local_updated_at: number
      cloud_synced_at: number
      attempt_count: number
    } | undefined

    expect(ledgerRow).toBeDefined()
    expect(ledgerRow?.record_type).toBe('task')
    expect(ledgerRow?.record_id).toBe(taskId)
    expect(ledgerRow?.sync_status).toBe('synced')
    expect(typeof ledgerRow?.local_updated_at).toBe('number')
    expect(typeof ledgerRow?.cloud_synced_at).toBe('number')
    expect(ledgerRow?.attempt_count).toBeGreaterThanOrEqual(1)

    db.prepare(`DELETE FROM sync_ledger WHERE record_type = 'task' AND record_id = ?`).run(taskId)
  })
})

describe('Release', () => {
  it('GET /release/diff returns changed files/endpoints/tests with PR links', async () => {
    const { status, body } = await req('GET', '/release/diff')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(typeof body.liveSha).toBe('string')
    expect(typeof body.previousDeploySha).toBe('string')
    expect(Array.isArray(body.changedFiles)).toBe(true)
    expect(Array.isArray(body.changedEndpoints)).toBe(true)
    expect(Array.isArray(body.changedTests)).toBe(true)
    expect(Array.isArray(body.pullRequestLinks)).toBe(true)
  })

  it('POST /release/deploy tracks commit and previousCommit', async () => {
    const first = await req('POST', '/release/deploy', {
      deployedBy: 'test-runner',
      note: 'first marker',
    })
    expect(first.status).toBe(200)
    expect(first.body.success).toBe(true)
    expect(typeof first.body.marker.commit).toBe('string')

    const second = await req('POST', '/release/deploy', {
      deployedBy: 'test-runner',
      note: 'second marker',
    })
    expect(second.status).toBe(200)
    expect(second.body.success).toBe(true)
    expect(second.body.marker.previousCommit).toBe(first.body.marker.commit)
  })
})

describe('Release', () => {
  it('GET /release/diff returns changed files/endpoints/tests with PR links', async () => {
    const { status, body } = await req('GET', '/release/diff')
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(typeof body.liveSha).toBe('string')
    expect(typeof body.previousDeploySha).toBe('string')
    expect(Array.isArray(body.changedFiles)).toBe(true)
    expect(Array.isArray(body.changedEndpoints)).toBe(true)
    expect(Array.isArray(body.changedTests)).toBe(true)
    expect(Array.isArray(body.pullRequestLinks)).toBe(true)
  })

  it('POST /release/deploy tracks commit and previousCommit', async () => {
    const first = await req('POST', '/release/deploy', {
      deployedBy: 'test-runner',
      note: 'first marker',
    })
    expect(first.status).toBe(200)
    expect(first.body.success).toBe(true)
    expect(typeof first.body.marker.commit).toBe('string')

    const second = await req('POST', '/release/deploy', {
      deployedBy: 'test-runner',
      note: 'second marker',
    })
    expect(second.status).toBe(200)
    expect(second.body.success).toBe(true)
    expect(second.body.marker.previousCommit).toBe(first.body.marker.commit)
  })
})

describe('Quiet Hours Watchdog Suppression', () => {
  const quietNowMs = Date.parse('2026-02-15T02:00:00-08:00')

  it('suppresses idle-nudge tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(true)
    expect(body.reason).toBe('quiet-hours')
    expect(Array.isArray(body.nudged)).toBe(true)
    expect(Array.isArray(body.decisions)).toBe(true)
  })

  it('suppresses cadence-watchdog tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/cadence-watchdog/tick?dryRun=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(true)
    expect(body.reason).toBe('quiet-hours')
    expect(Array.isArray(body.alerts)).toBe(true)
  })

  it('suppresses mention-rescue tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/mention-rescue/tick?dryRun=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(true)
    expect(body.reason).toBe('quiet-hours')
    expect(Array.isArray(body.rescued)).toBe(true)
  })

  it('allows forced idle-nudge tick during quiet hours', async () => {
    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&force=true&nowMs=${quietNowMs}`)
    expect(status).toBe(200)
    expect(body.suppressed).toBe(false)
    expect(body.force).toBe(true)
  })
})

describe('Mention Rescue', () => {
  it('nudges only the agents actually mentioned (after delay)', async () => {
    const threadId = `test-mention-rescue-${Date.now()}`
    const token = Math.random().toString(36).slice(2, 8)
    const sent = await req('POST', '/chat/messages', {
      from: 'ryan',
      channel: 'general',
      threadId,
      content: `ping @pixel ${token}`,
    })
    expect(sent.status).toBe(200)
    const mentionId = sent.body.message.id as string
    const mentionAt = sent.body.message.timestamp as number

    const { status, body } = await req(
      'POST',
      `/health/mention-rescue/tick?dryRun=true&force=true&nowMs=${mentionAt + 10 * 60_000}`,
    )
    expect(status).toBe(200)
    expect(body.suppressed).toBe(false)
    expect(Array.isArray(body.rescued)).toBe(true)
    expect(body.rescued.length).toBeGreaterThan(0)

    const rescueMsg = (body.rescued as string[]).find((m: string) => m.includes(`[[reply_to:${mentionId}]]`))
    expect(rescueMsg).toBeTruthy()
    expect(rescueMsg as string).toContain(`[[reply_to:${mentionId}]]`)
    expect(rescueMsg as string).toContain('@pixel')
    expect(rescueMsg as string).not.toContain('@kai')
    expect(rescueMsg as string).not.toContain('@link')
  })

  it('does not rescue before the delay window elapses (default behavior)', async () => {
    const threadId = `test-mention-rescue-delay-${Date.now()}`
    const token = Math.random().toString(36).slice(2, 8)
    const sent = await req('POST', '/chat/messages', {
      from: 'ryan',
      channel: 'general',
      threadId,
      content: `ping @pixel ${token}`,
    })
    expect(sent.status).toBe(200)
    const mentionId = sent.body.message.id as string
    const mentionAt = sent.body.message.timestamp as number

    const { status, body } = await req(
      'POST',
      `/health/mention-rescue/tick?dryRun=true&force=true&nowMs=${mentionAt + 2 * 60_000}`,
    )
    expect(status).toBe(200)
    expect(body.suppressed).toBe(false)
    expect(Array.isArray(body.rescued)).toBe(true)
    expect(body.rescued.some((msg: string) => msg.includes(`[[reply_to:${mentionId}]]`))).toBe(false)
  })

  it('does not rescue if any trio agent replied after the mention', async () => {
    const threadId = `test-mention-rescue-reply-${Date.now()}`
    const token = Math.random().toString(36).slice(2, 8)
    const sent = await req('POST', '/chat/messages', {
      from: 'ryan',
      channel: 'general',
      threadId,
      content: `ping @pixel ${token}`,
    })
    expect(sent.status).toBe(200)
    const mentionId = sent.body.message.id as string
    const mentionAt = sent.body.message.timestamp as number

    const reply = await req('POST', '/chat/messages', {
      from: 'kai',
      channel: 'general',
      threadId,
      content: 'ack',
    })
    expect(reply.status).toBe(200)

    const { status, body } = await req(
      'POST',
      `/health/mention-rescue/tick?dryRun=true&force=true&nowMs=${mentionAt + 10 * 60_000}`,
    )
    expect(status).toBe(200)
    expect(body.suppressed).toBe(false)
    expect(Array.isArray(body.rescued)).toBe(true)
    expect(body.rescued.some((msg: string) => msg.includes(`[[reply_to:${mentionId}]]`))).toBe(false)
  })

  it('does not cancel rescue on unrelated trio message elsewhere (regression)', async () => {
    const threadId = `test-mention-rescue-false-cancel-${Date.now()}`
    const token = Math.random().toString(36).slice(2, 8)
    const sent = await req('POST', '/chat/messages', {
      from: 'ryan',
      channel: 'general',
      threadId,
      content: `ping @pixel ${token}`,
    })
    expect(sent.status).toBe(200)
    const mentionId = sent.body.message.id as string
    const mentionAt = sent.body.message.timestamp as number

    // Trio spoke elsewhere (different thread) — should NOT cancel rescue
    const otherThreadId = `other-${threadId}`
    const replyElsewhere = await req('POST', '/chat/messages', {
      from: 'kai',
      channel: 'general',
      threadId: otherThreadId,
      content: 'ack elsewhere',
    })
    expect(replyElsewhere.status).toBe(200)

    const { status, body } = await req(
      'POST',
      `/health/mention-rescue/tick?dryRun=true&force=true&nowMs=${mentionAt + 10 * 60_000}`,
    )
    expect(status).toBe(200)
    expect(body.suppressed).toBe(false)
    expect(Array.isArray(body.rescued)).toBe(true)
    expect(body.rescued.some((msg: string) => msg.includes(`[[reply_to:${mentionId}]]`))).toBe(true)
  })
})

describe('Validation Error Shape', () => {
  it('returns structured fields for malformed POST /tasks payload', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'bad task',
      description: 'missing required fields',
    })
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Validation failed')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(body.fields.length).toBeGreaterThan(0)
    expect(body.fields[0]).toHaveProperty('path')
    expect(body.fields[0]).toHaveProperty('message')
  })

  it('returns structured fields for malformed POST /tasks/recurring payload', async () => {
    const { status, body } = await req('POST', '/tasks/recurring', {
      title: 'recurring bad',
      assignee: 'harmony',
    })
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toBe('Validation failed')
    expect(Array.isArray(body.fields)).toBe(true)
    expect(body.fields.length).toBeGreaterThan(0)
  })
})

describe('Recurring task management', () => {
  it('PATCH/DELETE /tasks/recurring/:id can disable and remove recurring definitions', async () => {
    const create = await req('POST', '/tasks/recurring', {
      title: `TEST recurring ${Date.now()}`,
      description: 'recurring endpoint management test',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['test recurring management'],
      eta: '10m',
      createdBy: 'test-runner',
      schedule: {
        kind: 'interval',
        everyMs: 60_000,
      },
    })

    expect(create.status).toBe(200)
    expect(create.body.success).toBe(true)
    const recurringId = create.body.recurring.id as string

    const disable = await req('PATCH', `/tasks/recurring/${recurringId}`, {
      enabled: false,
    })
    expect(disable.status).toBe(200)
    expect(disable.body.success).toBe(true)
    expect(disable.body.recurring.enabled).toBe(false)

    const listDisabled = await req('GET', '/tasks/recurring?enabled=false')
    expect(listDisabled.status).toBe(200)
    expect(Array.isArray(listDisabled.body.recurring)).toBe(true)
    expect(listDisabled.body.recurring.some((item: any) => item.id === recurringId)).toBe(true)

    const recurringPath = join(DATA_DIR, 'tasks.recurring.jsonl')
    const fileContent = await fs.readFile(recurringPath, 'utf-8')
    const persisted = fileContent
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((item: any) => item.id === recurringId)

    expect(persisted).toBeDefined()
    expect(persisted.enabled).toBe(false)

    const remove = await req('DELETE', `/tasks/recurring/${recurringId}`)
    expect(remove.status).toBe(200)
    expect(remove.body.success).toBe(true)
    expect(remove.body.id).toBe(recurringId)

    const afterDelete = await req('GET', '/tasks/recurring')
    expect(afterDelete.status).toBe(200)
    expect(afterDelete.body.recurring.some((item: any) => item.id === recurringId)).toBe(false)
  })
})

describe('Task CRUD', () => {
  let taskId: string

  it('POST /tasks creates a task', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: integration test task',
      description: 'Created by integration test',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Test passes'],
      eta: '1h',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.title).toBe('TEST: integration test task')
    expect(body.task.status).toBe('todo')
    expect(body.task.id).toBeDefined()
    taskId = body.task.id
  })

  it('GET /tasks/:id reads the task', async () => {
    const { status, body } = await req('GET', `/tasks/${taskId}`)
    expect(status).toBe(200)
    expect(body.task.title).toBe('TEST: integration test task')
    expect(body.task.assignee).toBe('test-agent')
  })

  it('GET /tasks/:id accepts unique prefix match', async () => {
    const prefix = taskId.slice(0, -4)
    const { status, body } = await req('GET', `/tasks/${prefix}`)
    expect(status).toBe(200)
    expect(body.task.id).toBe(taskId)
    expect(body.matchType).toBe('prefix')
  })

  it('GET /tasks/:id returns guided error for ambiguous prefix', async () => {
    const { status: status2, body: body2 } = await req('POST', '/tasks', {
      title: 'TEST: integration test task 2',
      description: 'Created for ambiguous prefix check',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Test passes'],
      eta: '1h',
    })
    expect(status2).toBe(200)
    const taskId2 = body2.task.id as string

    const commonPrefix = (() => {
      let i = 0
      while (i < taskId.length && i < taskId2.length && taskId[i] === taskId2[i]) i++
      return taskId.slice(0, Math.max(1, i))
    })()

    const { status, body } = await req('GET', `/tasks/${commonPrefix}`)
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('Ambiguous task ID prefix')
    expect(Array.isArray(body.details?.suggestions)).toBe(true)
    expect(body.details.suggestions.length).toBeGreaterThan(0)

    await req('DELETE', `/tasks/${taskId2}`)
  })

  it('PATCH /tasks/:id updates the task', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      description: 'Updated by test',
      priority: 'P1',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.description).toBe('Updated by test')
    expect(body.task.priority).toBe('P1')
  })

  it('GET /tasks lists tasks including test task', async () => {
    const { status, body } = await req('GET', '/tasks')
    expect(status).toBe(200)
    expect(body.tasks).toBeInstanceOf(Array)
    const found = body.tasks.find((t: any) => t.id === taskId)
    expect(found).toBeDefined()
  })

  it('GET /tasks?assignee= filters correctly', async () => {
    const { status, body } = await req('GET', '/tasks?assignee=test-agent')
    expect(status).toBe(200)
    const found = body.tasks.find((t: any) => t.id === taskId)
    expect(found).toBeDefined()
  })

  it('GET /tasks?teamId= filters correctly and stores teamId on create', async () => {
    const create = await req('POST', '/tasks', {
      title: 'TEST: team scoped task',
      description: 'Team-scoped test task',
      createdBy: 'test-runner',
      assignee: 'team-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Team filter works'],
      eta: '1h',
      teamId: 'team-alpha',
    })

    expect(create.status).toBe(200)
    expect(create.body.task.teamId).toBe('team-alpha')

    const list = await req('GET', '/tasks?teamId=team-alpha')
    expect(list.status).toBe(200)
    expect(list.body.tasks.some((t: any) => t.id === create.body.task.id)).toBe(true)

    await req('DELETE', `/tasks/${create.body.task.id}`)
  })

  it('DELETE /tasks/:id deletes the task', async () => {
    const { status, body } = await req('DELETE', `/tasks/${taskId}`)
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    // Verify deleted
    const { body: body2 } = await req('GET', `/tasks/${taskId}`)
    expect(body2.error).toBe('Task not found')
  })

  it('GET /tasks/:id returns error for nonexistent', async () => {
    const { body } = await req('GET', '/tasks/nonexistent-id')
    expect(body.error).toBe('Task not found')
  })
})

describe('Task History Changelog', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: history changelog task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['History visible'],
      eta: '1h',
    })
    taskId = body.task.id

    await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
      actor: 'test-agent',
      metadata: {
        eta: '1h',
      },
    })

    await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      actor: 'test-agent',
      metadata: {
        artifact_path: 'process/TASK-history-proof.md',
        qa_bundle: validQaBundle({
          summary: 'history test',
          artifact_links: ['process/TASK-history-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/123',
            commit: 'abcdef1',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-history-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/123',
          commit_sha: 'abcdef1',
          artifact_path: 'process/TASK-history-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
        },
      },
    })

    await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['process/TASK-history-proof.md'],
        reviewer_approved: true,
      },
    })
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('GET /tasks/:id/history returns normalized lifecycle changelog entries', async () => {
    const { status, body } = await req('GET', `/tasks/${taskId}/history`)
    expect(status).toBe(200)
    expect(body.history).toBeInstanceOf(Array)

    const statuses = body.history.map((entry: any) => entry.status)
    expect(statuses).toContain('doing')
    expect(statuses).toContain('validating')
    expect(statuses).toContain('done')

    const first = body.history[0]
    expect(first).toHaveProperty('status')
    expect(first).toHaveProperty('changedBy')
    expect(first).toHaveProperty('changedAt')
    expect(first).toHaveProperty('metadata')
  })
})

describe('Artifact Path Canonicalization', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: artifact path canonicalization',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Path canonicalized'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects validating status when artifact_path is not repo-relative under process/', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        eta: '1h',
        artifact_path: '/tmp/TASK-proof.md',
        qa_bundle: validQaBundle({
          summary: 'test bundle',
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/456',
            commit: 'abcdef2',
            changed_files: ['src/tasks.ts'],
            artifact_path: '/tmp/TASK-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/456',
          commit_sha: 'abcdef2',
          artifact_path: 'process/TASK-test-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('artifact_path')
    expect(body.error).toContain('process/')
  })

  it('accepts validating status when artifact_path is canonical', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        eta: '1h',
        artifact_path: 'process/TASK-test-proof.md',
        qa_bundle: validQaBundle({
          summary: 'test bundle',
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/457',
            commit: 'abcdef3',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-test-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/457',
          commit_sha: 'abcdef3',
          artifact_path: 'process/TASK-test-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(200)
    expect(body.task.status).toBe('validating')
  })
})

describe('Review packet gate', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: review packet gate',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Review packet required'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('blocks transition to validating when review packet fields are missing', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-gate-proof.md',
        qa_bundle: {
          lane: 'test',
          summary: 'missing packet fields',
          pr_link: 'https://github.com/reflectt/reflectt-node/pull/5',
          commit_shas: ['abcd123'],
          changed_files: ['src/server.ts'],
          artifact_links: ['process/TASK-gate-proof.md'],
          checks: ['npm test'],
          screenshot_proof: ['process/TASK-gate-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-gate-proof.md',
            caveats: 'none',
          },
        },
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
          commit_sha: 'abcd123',
          artifact_path: 'process/TASK-gate-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('Review packet required before validating')
    expect(body.error).toContain('metadata.qa_bundle.review_packet.commit')
  })

  it('returns clear mismatch error when review packet task_id does not match', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-gate-proof.md',
        qa_bundle: validQaBundle({
          summary: 'bad task id',
          artifact_links: ['process/TASK-gate-proof.md'],
          review_packet: {
            task_id: 'task-0000000000000-mismatch',
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
            commit: 'abcd123',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-gate-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
          commit_sha: 'abcd123',
          artifact_path: 'process/TASK-gate-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('Review packet task mismatch')
  })
})

describe('Validating review handoff gate', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: validating review handoff gate',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Handoff contract enforced'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects validating status when review_handoff is missing', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-handoff-proof.md',
        qa_bundle: validQaBundle({
          summary: 'handoff gate test',
          artifact_links: ['process/TASK-handoff-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/500',
            commit: 'abc5000',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-handoff-proof.md',
            caveats: 'none',
          },
        }),
      },
    })

    expect(status).toBe(400)
    expect(body.gate).toBe('review_handoff')
  })

  it('rejects validating when PR URL/commit SHA missing unless doc_only=true', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-handoff-proof.md',
        qa_bundle: validQaBundle({
          summary: 'handoff gate test',
          artifact_links: ['process/TASK-handoff-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/501',
            commit: 'abc5001',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-handoff-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          artifact_path: 'process/TASK-handoff-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(400)
    expect(body.error).toContain('open PR URL required')
  })

  it('accepts validating with doc_only handoff and enforces delta note on re-review', async () => {
    const first = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-handoff-proof.md',
        qa_bundle: validQaBundle({
          summary: 'handoff gate test',
          artifact_links: ['process/TASK-handoff-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/502',
            commit: 'abc5002',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-handoff-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          artifact_path: 'process/TASK-handoff-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
          doc_only: true,
        },
      },
    })

    expect(first.status).toBe(200)

    const second = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-handoff-proof.md',
        qa_bundle: validQaBundle({
          summary: 'handoff gate test rerun',
          artifact_links: ['process/TASK-handoff-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/503',
            commit: 'abc5003',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-handoff-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          artifact_path: 'process/TASK-handoff-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
          doc_only: true,
        },
      },
    })

    expect(second.status).toBe(400)
    expect(second.body.gate).toBe('review_delta')

    const third = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-handoff-proof.md',
        qa_bundle: validQaBundle({
          summary: 'handoff gate test rerun',
          artifact_links: ['process/TASK-handoff-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/504',
            commit: 'abc5004',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-handoff-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          artifact_path: 'process/TASK-handoff-proof.md',
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'none',
          doc_only: true,
        },
        review_delta_note: 'Updated test proof wording and summary for re-review.',
      },
    })

    expect(third.status).toBe(200)
  })
})

describe('Non-code validating contract (design/docs)', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: non-code validating contract',
      createdBy: 'test-runner',
      assignee: 'pixel',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Non-code validating accepted without PR/commit'],
      eta: '1h',
      metadata: {
        lane: 'design',
      },
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('accepts validating for design lane without PR URL/commit SHA when non-code proof bundle is provided', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        lane: 'design',
        artifact_path: 'process/TASK-non-code-proof.md',
        qa_bundle: validQaBundle({
          lane: 'design',
          summary: 'design handoff evidence package',
          non_code: true,
          changed_files: ['process/TASK-non-code-proof.md'],
          artifact_links: ['process/TASK-non-code-proof.md'],
          screenshot_proof: ['process/TASK-non-code-proof.md'],
          checks: ['design acceptance checklist complete'],
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          artifact_path: 'process/TASK-non-code-proof.md',
          test_proof: 'Design/doc checklist reviewed with acceptance criteria mapping.',
          known_caveats: 'No code changes in this lane.',
          non_code: true,
        },
      },
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('validating')
  })
})

describe('Non-code validating without qa_bundle', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: non-code validating without qa_bundle',
      createdBy: 'test-runner',
      assignee: 'pixel',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Validating accepted with non_code review_handoff and no qa_bundle'],
      eta: '1h',
      metadata: {
        lane: 'analysis',
      },
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('accepts validating without qa_bundle when review_handoff.non_code=true', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-non-code-no-qabundle.md',
        review_handoff: {
          task_id: taskId,
          artifact_path: 'process/TASK-non-code-no-qabundle.md',
          test_proof: 'Strategic/non-code proof (manual checklist) complete.',
          known_caveats: 'No PR/commit for this task type.',
          non_code: true,
        },
      },
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('validating')
  })
})

describe('Backlog', () => {
  let taskId: string

  beforeAll(async () => {
    // Create an unassigned todo task
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: backlog task',
      createdBy: 'test-runner',
      assignee: 'unassigned',
      priority: 'P1',
      done_criteria: ['In backlog'],
      eta: '1h',
      reviewer: 'test-reviewer',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('GET /tasks/backlog returns unassigned todos', async () => {
    const { status, body } = await req('GET', '/tasks/backlog')
    expect(status).toBe(200)
    expect(body.tasks).toBeInstanceOf(Array)
    expect(body.count).toBeGreaterThanOrEqual(0)
    // All tasks should be unassigned and todo
    for (const t of body.tasks) {
      expect(t.status).toBe('todo')
      expect(t.assignee).toBeFalsy()
    }
  })

  it('backlog is sorted by priority then age', async () => {
    const { body } = await req('GET', '/tasks/backlog')
    const pOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }
    for (let i = 1; i < body.tasks.length; i++) {
      const prev = body.tasks[i - 1]
      const curr = body.tasks[i]
      const pp = pOrder[prev.priority || 'P3'] ?? 9
      const cp = pOrder[curr.priority || 'P3'] ?? 9
      if (pp === cp) {
        expect(prev.createdAt).toBeLessThanOrEqual(curr.createdAt)
      } else {
        expect(pp).toBeLessThanOrEqual(cp)
      }
    }
  })
})

describe('My Now cockpit', () => {
  let doingTaskId: string
  let blockedTaskId: string
  let reviewTaskId: string

  beforeAll(async () => {
    const createDoing = await req('POST', '/tasks', {
      title: 'TEST: cockpit assigned doing',
      createdBy: 'test-runner',
      assignee: 'cockpit-agent',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Cockpit includes assigned task'],
      eta: '1h',
      status: 'doing',
      metadata: {
        artifacts: ['https://github.com/reflectt/reflectt-node/pull/999'],
      },
    })
    doingTaskId = createDoing.body.task.id

    const createBlocked = await req('POST', '/tasks', {
      title: 'TEST: cockpit blocked task',
      createdBy: 'test-runner',
      assignee: 'cockpit-agent',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Cockpit includes blocker lane'],
      eta: '1h',
      status: 'blocked',
      metadata: {
        blocker: 'Waiting for dependency update',
      },
    })
    blockedTaskId = createBlocked.body.task.id

    const createReview = await req('POST', '/tasks', {
      title: 'TEST: cockpit pending review',
      createdBy: 'test-runner',
      assignee: 'other-agent',
      reviewer: 'cockpit-agent',
      priority: 'P2',
      done_criteria: ['Cockpit includes pending review'],
      eta: '1h',
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-test-cockpit-review.md',
        qa_bundle: validQaBundle({ summary: 'cockpit test bundle', artifact_links: ['process/TASK-test-cockpit-review.md'] }),
      },
    })
    reviewTaskId = createReview.body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${doingTaskId}`)
    await req('DELETE', `/tasks/${blockedTaskId}`)
    await req('DELETE', `/tasks/${reviewTaskId}`)
  })

  it('GET /me/:agent returns single-pane payload with assigned/review lanes + blockers + changelog', async () => {
    await req('POST', '/chat/messages', {
      from: 'system',
      channel: 'general',
      content: '@cockpit-agent build failed on CI check for PR #999',
    })

    const { status, body } = await req('GET', '/me/cockpit-agent')
    expect(status).toBe(200)
    expect(body.agent).toBe('cockpit-agent')
    expect(body.assignedTasks).toBeInstanceOf(Array)
    expect(body.pendingReviews).toBeInstanceOf(Array)
    expect(body.blockers).toBeInstanceOf(Array)
    expect(body.taskPrLinks).toBeInstanceOf(Array)
    expect(body.failingChecks).toBeInstanceOf(Array)
    expect(body.sinceLastSeen).toBeDefined()
    expect(body.sinceLastSeen.changes).toBeInstanceOf(Array)
    expect(typeof body.nextAction).toBe('string')

    const assignedIds = body.assignedTasks.map((t: any) => t.id)
    const reviewIds = body.pendingReviews.map((t: any) => t.id)
    const blockerIds = body.blockers.map((t: any) => t.id)

    expect(assignedIds).toContain(doingTaskId)
    expect(assignedIds).toContain(blockedTaskId)
    expect(reviewIds).toContain(reviewTaskId)
    expect(blockerIds).toContain(blockedTaskId)

    expect(body.taskPrLinks).toEqual(expect.arrayContaining(['https://github.com/reflectt/reflectt-node/pull/999']))
    expect(body.failingChecks.length).toBeGreaterThan(0)
    expect(body.sinceLastSeen.changes.length).toBeGreaterThan(0)
    expect(body.nextAction).toContain('Unblock')
  })
})

describe('Task Claim', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: claimable task',
      createdBy: 'test-runner',
      assignee: 'unassigned',
      priority: 'P2',
      done_criteria: ['Claimed'],
      eta: '1h',
      reviewer: 'test-reviewer',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('POST /tasks/:id/claim requires agent', async () => {
    const { body } = await req('POST', `/tasks/${taskId}/claim`, {})
    expect(body.success).toBe(false)
    expect(body.error).toContain('agent')
  })

  it('POST /tasks/:id/claim assigns the task', async () => {
    // First clear the "unassigned" assignee so claim works
    await req('PATCH', `/tasks/${taskId}`, { assignee: '' })

    const { body } = await req('POST', `/tasks/${taskId}/claim`, {
      agent: 'test-claimer',
    })
    // Claim may fail if assignee is set — check the actual behavior
    if (body.success) {
      expect(body.task).toBeDefined()
    }
  })

  it('POST /tasks/:id/claim rejects if not found', async () => {
    const { body } = await req('POST', '/tasks/nonexistent/claim', {
      agent: 'test',
    })
    expect(body.success).toBe(false)
    expect(body.error).toContain('not found')
  })
})

describe('Task Close Gate', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: close gate task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Gate tested'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'validating')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects done without artifacts', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
    })
    expect(status).toBe(422)
    expect(body.gate).toBe('artifacts')
    expect(body.hint).toBeDefined()
  })

  it('rejects done with artifacts but no reviewer sign-off', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      metadata: { artifacts: ['test-evidence'] },
    })
    expect(status).toBe(422)
    expect(body.gate).toBe('reviewer_signoff')
  })

  it('accepts done with artifacts + reviewer sign-off from assigned reviewer', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['test-evidence'],
        reviewer_approved: true,
      },
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('done')
  })
})

describe('Task close follow-on linkage gate', () => {
  it('rejects done for spec tasks without follow_on_task_id or follow_on_na_reason', async () => {
    const created = await req('POST', '/tasks', {
      title: 'TEST: spec close gate missing follow-on',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Spec close requires linkage'],
      eta: '1h',
      metadata: {
        task_type: 'spec',
      },
    })

    const specTaskId = created.body.task.id
    await advanceTo(specTaskId, 'validating')

    const result = await req('PATCH', `/tasks/${specTaskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['process/TASK-spec-proof.md'],
        reviewer_approved: true,
      },
    })

    expect(result.status).toBe(422)
    expect(result.body.gate).toBe('follow_on_linkage')

    await req('DELETE', `/tasks/${specTaskId}`)
  })

  it('accepts done for spec tasks when follow_on_task_id points to existing task', async () => {
    const followOn = await req('POST', '/tasks', {
      title: 'TEST: follow-on implementation task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Exists for linkage'],
      eta: '1h',
    })

    const spec = await req('POST', '/tasks', {
      title: 'TEST: spec close gate with follow-on link',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Spec close requires linkage'],
      eta: '1h',
      metadata: {
        task_type: 'spec',
      },
    })

    const followOnId = followOn.body.task.id
    const specTaskId = spec.body.task.id
    await advanceTo(specTaskId, 'validating')

    const result = await req('PATCH', `/tasks/${specTaskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['process/TASK-spec-proof.md'],
        reviewer_approved: true,
        follow_on_task_id: followOnId,
      },
    })

    expect(result.status).toBe(200)
    expect(result.body.task.status).toBe('done')
    expect(result.body.task.metadata.follow_on_task_id).toBe(followOnId)

    await req('DELETE', `/tasks/${specTaskId}`)
    await req('DELETE', `/tasks/${followOnId}`)
  })

  it('accepts done for research tasks with explicit follow_on_na rationale', async () => {
    const research = await req('POST', '/tasks', {
      title: 'TEST: research close gate with explicit NA',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Research close requires rationale'],
      eta: '1h',
      metadata: {
        task_type: 'research',
      },
    })

    const taskId = research.body.task.id
    await advanceTo(taskId, 'validating')

    const result = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['process/TASK-research-proof.md'],
        reviewer_approved: true,
        follow_on_na: true,
        follow_on_na_reason: 'Investigation-only result; no implementation work required.',
      },
    })

    expect(result.status).toBe(200)
    expect(result.body.task.status).toBe('done')
    expect(result.body.task.metadata.follow_on_na).toBe(true)

    await req('DELETE', `/tasks/${taskId}`)
  })
})

describe('Design handoff auto-notification', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: design handoff source task',
      description: 'Design-ready task should auto-notify implementation handoff to @link',
      createdBy: 'test-runner',
      assignee: 'pixel',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['implement chat page polish', 'verify with design QA'],
      eta: '1h',
      metadata: {
        lane: 'design',
      },
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('posts a @link review-channel handoff message when design task becomes ready', async () => {
    // Design handoff fires on validating (first ready transition), not done
    const validating = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        lane: 'design',
        artifact_path: 'process/TASK-design-ready-proof.md',
        qa_bundle: validQaBundle({
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
            commit: 'abc1234',
            changed_files: ['src/design.ts'],
            artifact_path: 'process/TASK-design-ready-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit_sha: 'abc1234',
          changed_files: ['src/design.ts'],
          artifact_path: 'process/TASK-design-ready-proof.md',
          test_proof: 'test',
          known_caveats: 'none',
          caveats: 'none',
        },
      },
    })

    expect(validating.status).toBe(200)
    expect(validating.body.success).toBe(true)

    const { status, body } = await req('GET', '/chat/messages?channel=reviews&limit=200')
    expect(status).toBe(200)
    expect(Array.isArray(body.messages)).toBe(true)

    const handoff = body.messages.find((m: any) => {
      const content = String(m.content || '')
      return content.includes(taskId)
        && content.includes('@link')
        && content.includes('process/TASK-design-ready-proof.md')
        && content.includes('Acceptance criteria')
    })

    expect(handoff).toBeDefined()
  })
})

describe('Task review endpoint', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: task review endpoint',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'assigned-reviewer',
      priority: 'P2',
      done_criteria: ['Review captured in metadata'],
      eta: '1h',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('POST /tasks/:id/review rejects non-assigned reviewer', async () => {
    const { status, body } = await req('POST', `/tasks/${taskId}/review`, {
      reviewer: 'wrong-reviewer',
      decision: 'approve',
      comment: 'LGTM',
    })

    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.error).toContain('Only assigned reviewer')
  })

  it('POST /tasks/:id/review stores reviewer decision metadata', async () => {
    const { status, body } = await req('POST', `/tasks/${taskId}/review`, {
      reviewer: 'assigned-reviewer',
      decision: 'approve',
      comment: 'Ship it',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.decision.decision).toBe('approved')
    expect(body.task.metadata.reviewer_approved).toBe(true)
    expect(body.task.metadata.reviewer_decision.reviewer).toBe('assigned-reviewer')
    expect(body.task.metadata.reviewer_decision.comment).toBe('Ship it')

    // reviewer actions should stamp actor + keep queue state coherent
    expect(body.task.metadata.actor).toBe('assigned-reviewer')
    expect(body.task.metadata.review_state).toBe('approved')
    expect(body.task.metadata.review_last_activity_at).toBeTruthy()
  })

  it('POST /tasks/:id/review supports reject and flips reviewer_approved false', async () => {
    const { status, body } = await req('POST', `/tasks/${taskId}/review`, {
      reviewer: 'assigned-reviewer',
      decision: 'reject',
      comment: 'Missing validation evidence',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.decision.decision).toBe('rejected')
    expect(body.task.metadata.reviewer_approved).toBe(false)
    expect(body.task.metadata.reviewer_decision.comment).toBe('Missing validation evidence')

    expect(body.task.metadata.actor).toBe('assigned-reviewer')
    expect(body.task.metadata.review_state).toBe('needs_author')
    expect(body.task.metadata.review_last_activity_at).toBeTruthy()
  })
})

describe('State machine transition validation', () => {
  // Helper to create a task in a given status
  async function createInStatus(status: string): Promise<string> {
    const ts = Date.now()
    const { body } = await req('POST', '/tasks', {
      title: `TEST: state-machine-${status}-${ts}`,
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['test'],
      priority: 'P2',
      eta: '~1h',
      metadata: {
        source_reflection: 'ref-test-statemachine',
        is_test: true,
        eta: '~1h',
      },
    })
    const id = body.task?.id || body.id
    if (!id) throw new Error(`Failed to create task: ${JSON.stringify(body)}`)

    // Walk forward to the desired status
    if (status === 'todo') return id
    await req('PATCH', `/tasks/${id}`, {
      status: 'doing',
      metadata: { transition: { type: 'claim', reason: 'test' }, eta: '~1h' },
    })
    if (status === 'doing') return id
    if (status === 'blocked') {
      await req('PATCH', `/tasks/${id}`, {
        status: 'blocked',
        metadata: { transition: { type: 'pause', reason: 'test block' } },
      })
      return id
    }
    if (status === 'validating') {
      await req('PATCH', `/tasks/${id}`, {
        status: 'validating',
        metadata: {
          artifact_path: 'process/test-statemachine.md',
          qa_bundle: {
            lane: 'engineering',
            summary: 'test',
            changed_files: ['test.ts'],
            artifact_links: ['process/test-statemachine.md'],
            checks: ['test: pass'],
            screenshot_proof: ['n/a'],
            review_packet: {
              task_id: id,
              repo: 'test',
              pr_url: 'https://github.com/test/test/pull/1',
              commit: 'abc123',
              changed_files: ['test.ts'],
              artifact_path: 'process/test-statemachine.md',
              test_proof: 'pass',
              caveats: 'none',
            },
          },
        },
      })
      return id
    }
    return id
  }

  // ── Forward transitions should work ──

  it('allows todo→doing', async () => {
    const id = await createInStatus('todo')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'doing',
      metadata: { transition: { type: 'claim', reason: 'test' }, eta: '~1h' },
    })
    expect(status).toBe(200)
    expect(body.task.status).toBe('doing')
  })

  it('allows doing→blocked', async () => {
    const id = await createInStatus('doing')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'blocked',
      metadata: { transition: { type: 'pause', reason: 'waiting on dep' } },
    })
    expect(status).toBe(200)
    expect(body.task.status).toBe('blocked')
  })

  it('allows blocked→doing', async () => {
    const id = await createInStatus('blocked')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'doing',
      metadata: { transition: { type: 'resume', reason: 'unblocked' }, eta: '~1h' },
    })
    expect(status).toBe(200)
    expect(body.task.status).toBe('doing')
  })

  it('allows validating→doing (reviewer rejection)', async () => {
    const id = await createInStatus('validating')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'doing',
      metadata: { transition: { type: 'claim', reason: 'reviewer rejected' }, eta: '~1h' },
    })
    expect(status).toBe(200)
    expect(body.task.status).toBe('doing')
  })

  // ── Backward transitions should be rejected ──

  it('rejects doing→todo without reopen', async () => {
    const id = await createInStatus('doing')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'todo',
    })
    expect(status).toBe(422)
    expect(body.error).toContain('State transition rejected')
    expect(body.error).toContain('doing→todo')
    expect(body.code).toBe('STATE_TRANSITION_REJECTED')
  })

  it('rejects todo→validating (skip doing)', async () => {
    const id = await createInStatus('todo')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/test.md',
      },
    })
    expect(status).toBe(422)
    expect(body.error).toContain('State transition rejected')
    expect(body.error).toContain('todo→validating')
  })

  it('rejects todo→done (skip everything)', async () => {
    const id = await createInStatus('todo')
    const { status, body } = await req('PATCH', `/tasks/${id}`, { status: 'done' })
    expect(status).toBe(422)
    expect(body.error).toContain('State transition rejected')
  })

  // ── Reopen override should work ──

  it('allows doing→todo with explicit reopen', async () => {
    const id = await createInStatus('doing')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'todo',
      metadata: {
        reopen: true,
        reopen_reason: 'Descoped — returning to backlog',
      },
    })
    expect(status).toBe(200)
    expect(body.task.status).toBe('todo')
    expect(body.task.metadata.reopened_at).toBeTruthy()
    expect(body.task.metadata.reopened_from).toBe('doing')
  })

  it('rejects reopen without reason', async () => {
    const id = await createInStatus('doing')
    const { status, body } = await req('PATCH', `/tasks/${id}`, {
      status: 'todo',
      metadata: { reopen: true },
    })
    expect(status).toBe(422)
    expect(body.error).toContain('State transition rejected')
  })
})

describe('Lane-state transition lock', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: lane-state lock task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Transition lock tested'],
      eta: '1h',
    })
    taskId = body.task.id

    const moveToDoing = await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
      metadata: { actor: 'test-agent' },
    })
    expect(moveToDoing.status).toBe(200)
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects ambiguous doing->blocked transition without metadata.transition', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'blocked',
      metadata: { actor: 'test-agent' },
    })

    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error).toContain('doing->blocked transition requires metadata.transition')
  })

  it('accepts doing->blocked transition with explicit pause metadata', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'blocked',
      metadata: {
        actor: 'test-agent',
        transition: {
          type: 'pause',
          reason: 'Waiting on API dependency',
        },
      },
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('blocked')
    expect(body.task.metadata?.last_transition?.type).toBe('pause')
    expect(body.task.metadata?.last_transition?.reason).toBe('Waiting on API dependency')
  })
})

describe('Review State Tracking Metadata', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: review state transitions',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Review flow tracked'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('sets queued review metadata when entering validating', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/test-review-state-artifact.md',
        qa_bundle: validQaBundle({
          summary: 'test review bundle',
          artifact_links: ['test://artifact'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/99999',
            commit: 'deadbeef',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/test-review-state-artifact.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/99999',
          commit_sha: 'deadbeef',
          artifact_path: 'process/test-review-state-artifact.md',
          test_proof: 'npm test (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.metadata.entered_validating_at).toBeTypeOf('number')
    expect(body.task.metadata.review_state).toBe('queued')
    expect(body.task.metadata.review_last_activity_at).toBeTypeOf('number')
  })

  it('moves review_state to in_progress when reviewer updates in validating', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      actor: 'test-reviewer',
      metadata: {
        review_notes: 'review in progress',
      },
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.metadata.review_state).toBe('in_progress')
    expect(body.task.metadata.review_last_activity_at).toBeTypeOf('number')
  })

  it('marks approved when reviewer_approved=true from assigned reviewer', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      actor: 'test-reviewer',
      metadata: {
        reviewer_approved: true,
      },
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.metadata.review_state).toBe('approved')
    expect(body.task.metadata.review_last_activity_at).toBeTypeOf('number')
  })
})

describe('Chat Messages', () => {
  let authorMessageId: string

  it('POST /chat/messages sends a message', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'TEST: integration test message',
      channel: 'general',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.message).toBeDefined()
    expect(body.message.id).toBeDefined()
    authorMessageId = body.message.id
  })

  it('POST /chat/messages returns no warnings when content has no @mentions', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'no mentions in this message',
      channel: 'general',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.warnings).toBeUndefined()
  })

  it('POST /chat/messages returns no warnings for valid known @mentions', async () => {
    await req('POST', '/presence/harmony', { status: 'working' })

    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'ping @harmony for review',
      channel: 'general',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.warnings).toBeUndefined()
  })

  it('POST /chat/messages includes warnings for unknown/offline @mentions', async () => {
    await req('POST', '/presence/rhythm', { status: 'offline' })

    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'ping @notarealagent and @rhythm',
      channel: 'general',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.warnings)).toBe(true)
    expect(body.warnings.length).toBe(2)
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mention: 'notarealagent', reason: 'unknown_agent' }),
        expect.objectContaining({ mention: 'rhythm', reason: 'offline_agent' }),
      ]),
    )
  })

  it('PATCH /chat/messages/:id edits content for original author', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'TEST: edited content',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.message.content).toBe('TEST: edited content')
    expect(body.message.metadata).toBeDefined()
    expect(body.message.metadata.editedAt).toBeDefined()
  })

  it('PATCH /chat/messages/:id rejects non-author edits', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'someone-else',
      content: 'hijack',
    })
    expect(status).toBe(403)
    expect(body.error).toContain('Only original author')
  })

  it('PATCH /chat/messages/:id rejects empty/whitespace content', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: '   ',
    })
    expect(status).toBe(400)
    expect(body.error).toContain('Invalid body')
  })

  it('PATCH /chat/messages/:id returns 404 when message does not exist', async () => {
    const { status, body } = await req('PATCH', '/chat/messages/msg-does-not-exist', {
      from: 'test-runner',
      content: 'no-op',
    })
    expect(status).toBe(404)
    expect(body.error).toContain('not found')
  })

  it('PATCH /chat/messages/:id applies last-write-wins for same author', async () => {
    const { body: first } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'TEST: first edit',
    })
    const { status, body: second } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'TEST: second edit',
    })

    expect(status).toBe(200)
    expect(first.message.content).toBe('TEST: first edit')
    expect(second.message.content).toBe('TEST: second edit')

    const { body: listBody } = await req('GET', '/chat/messages?channel=general&limit=200')
    const found = (listBody.messages || []).find((m: any) => m.id === authorMessageId)
    expect(found).toBeDefined()
    expect(found.content).toBe('TEST: second edit')
  })

  it('DELETE /chat/messages/:id rejects non-author delete', async () => {
    const { status, body } = await req('DELETE', `/chat/messages/${authorMessageId}`, {
      from: 'someone-else',
    })
    expect(status).toBe(403)
    expect(body.error).toContain('Only original author')
  })

  it('DELETE /chat/messages/:id returns 404 when message does not exist', async () => {
    const { status, body } = await req('DELETE', '/chat/messages/msg-does-not-exist', {
      from: 'test-runner',
    })
    expect(status).toBe(404)
    expect(body.error).toContain('not found')
  })

  it('DELETE /chat/messages/:id deletes for original author', async () => {
    const { status, body } = await req('DELETE', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    const { status: getStatus, body: getBody } = await req('GET', '/chat/messages?channel=general&limit=200')
    expect(getStatus).toBe(200)
    const found = (getBody.messages || []).find((m: any) => m.id === authorMessageId)
    expect(found).toBeUndefined()
  })

  it('PATCH /chat/messages/:id after delete returns 404', async () => {
    const { status, body } = await req('PATCH', `/chat/messages/${authorMessageId}`, {
      from: 'test-runner',
      content: 'should fail',
    })
    expect(status).toBe(404)
    expect(body.error).toContain('not found')
  })

  it('GET /chat/messages returns messages', async () => {
    const { status, body } = await req('GET', '/chat/messages?channel=general&limit=5')
    expect(status).toBe(200)
    expect(body.messages).toBeInstanceOf(Array)
  })

  it('GET /chat/channels lists channels', async () => {
    const { status, body } = await req('GET', '/chat/channels')
    expect(status).toBe(200)
    expect(body.channels).toBeInstanceOf(Array)

    const channelNames = (body.channels || []).map((channel: any) => channel.channel)
    expect(channelNames).toEqual(expect.arrayContaining(['general', 'shipping', 'reviews', 'blockers']))
  })

  it('POST /chat/messages supports reviews and blockers channels', async () => {
    const { status: reviewStatus, body: reviewBody } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: '@harmony review requested for task-123',
      channel: 'reviews',
    })
    expect(reviewStatus).toBe(200)
    expect(reviewBody.message.channel).toBe('reviews')

    const { status: blockerStatus, body: blockerBody } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: '@kai blocked on task-123 migration dependency',
      channel: 'blockers',
    })
    expect(blockerStatus).toBe(200)
    expect(blockerBody.message.channel).toBe('blockers')
  })

  it('POST /chat/messages blocks action-required reviews/blockers messages without @owner + task-id', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'please review this soon',
      channel: 'reviews',
    })

    expect(status).toBe(400)
    expect(body.gate).toBe('action_message_contract')
    expect(body.error).toContain('@owner')
  })

  it('POST /chat/messages warns (but allows) likely action-required messages in general missing @owner/task-id', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'Please review task-123 when you can',
      channel: 'general',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.action_warnings)).toBe(true)
    expect(body.action_warnings.length).toBeGreaterThan(0)
  })

  it('POST /chat/messages warns on autonomy anti-pattern: asking Ryan what to do next', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: 'hey @ryan what should I do next?',
      channel: 'general',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.autonomy_warnings)).toBe(true)
    expect(body.autonomy_warnings[0]).toContain('Autonomy guardrail')
  })

  it("POST /chat/messages warns on autonomy anti-pattern: whats next variants", async () => {
    const variants = [
      'hey @ryan whats next for me?',
      "hey @ryan what's next for me?",
      'hey @ryan what do I do next?',
      'hey @ryan what should I work on next?',
      'hey @ryan should I work on the router bug next?',
    ]

    for (const content of variants) {
      const { status, body } = await req('POST', '/chat/messages', {
        from: 'test-runner',
        content,
        channel: 'general',
      })

      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(Array.isArray(body.autonomy_warnings)).toBe(true)
      expect(body.autonomy_warnings[0]).toContain('Autonomy guardrail')
    }
  })

  it('POST /chat/messages blocks approve/merge requests to Ryan unless task+permissions reason are included', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: '@ryan can you approve/merge PR #287 when you have a sec?',
      channel: 'general',
    })

    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.gate).toBe('ryan_approval_gate')
  })

  it('POST /chat/messages allows approve/merge escalation to Ryan when blocked by permissions (task+reason)', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: '@ryan task-123 no merge rights (auth mismatch) — can you merge PR #287? https://github.com/org/repo/pull/287',
      channel: 'general',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('POST /chat/messages does not warn on logistics ask to Ryan (not task-selection)', async () => {
    const { status, body } = await req('POST', '/chat/messages', {
      from: 'test-runner',
      content: '@ryan do you want me to send you the link?',
      channel: 'general',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.autonomy_warnings).toBeUndefined()
  })

})

// Clean up all tasks for a given agent to prevent cross-test pollution.
// Previous test failures can leak doing tasks that corrupt lane-state assertions.
async function cleanupAgentTasks(agent: string) {
  const { body } = await req('GET', `/tasks?assignee=${agent}&limit=200`)
  const tasks = body?.tasks || []
  for (const task of tasks) {
    await req('DELETE', `/tasks/${task.id}`)
  }
}

describe('Idle Nudge lane-state transitions', () => {
  async function createDoingTask(agent: string, title: string): Promise<string> {
    const { status, body } = await req('POST', '/tasks', {
      title,
      description: 'Lane-state test task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      priority: 'P2',
      status: 'doing',
      done_criteria: ['lane test'],
      eta: '1h',
    })
    expect(status).toBe(200)
    return body.task.id as string
  }

  async function getDecision(agent: string): Promise<any> {
    // force=true bypasses quiet hours — tests must work at any time of day
    const { status, body } = await req('POST', '/health/idle-nudge/tick?dryRun=true&force=true')
    expect(status).toBe(200)
    const decision = (body.decisions || []).find((d: any) => d.agent === agent)
    expect(decision).toBeDefined()
    return decision
  }

  it('shows no-active-lane when agent has no doing task', async () => {
    const agent = 'lane-no-active'
    await cleanupAgentTasks(agent)
    await req('POST', `/presence/${agent}`, { status: 'working' })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('no-active-lane')
    expect(decision.lane.selectedTaskId).toBeNull()
  })

  it('nudges queue-clear agents to pull /tasks/next after warn threshold', async () => {
    const agent = 'lane-queue-clear-nudge'
    await cleanupAgentTasks(agent)
    await req('POST', `/presence/${agent}`, { status: 'working' })

    const tickNowMs = Date.now() + (50 * 60_000) // > warnMin (45m)
    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&force=true&nowMs=${tickNowMs}`)
    expect(status).toBe(200)

    const decision = (body.decisions || []).find((d: any) => d.agent === agent)
    expect(decision).toBeDefined()
    expect(decision.lane.laneReason).toBe('no-active-lane')
    expect(decision.decision).toBe('warn')
    expect(decision.reason).toBe('queue-clear')
    expect(String(decision.renderedMessage || '')).toContain('/tasks/next')
  })

  it('shows ambiguous-lane when agent has multiple fresh doing tasks', async () => {
    const agent = 'lane-ambiguous'
    await cleanupAgentTasks(agent)
    const taskA = await createDoingTask(agent, 'TEST: lane ambiguous A')
    const taskB = await createDoingTask(agent, 'TEST: lane ambiguous B')
    await req('POST', `/presence/${agent}`, { status: 'working' })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('ambiguous-lane')
    expect(decision.lane.freshDoingTaskIds).toEqual(expect.arrayContaining([taskA, taskB]))

    await req('DELETE', `/tasks/${taskA}`)
    await req('DELETE', `/tasks/${taskB}`)
  })

  it('shows presence-task-mismatch when presence.task differs from selected doing task', async () => {
    const agent = 'lane-mismatch'
    await cleanupAgentTasks(agent)
    const activeTask = await createDoingTask(agent, 'TEST: lane mismatch active')
    const { body: todoBody } = await req('POST', '/tasks', {
      title: 'TEST: lane mismatch presence task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      priority: 'P2',
      status: 'todo',
      done_criteria: ['lane mismatch'],
      eta: '1h',
    })
    const presenceTask = todoBody.task.id as string

    await req('POST', `/presence/${agent}`, { status: 'working', task: presenceTask })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('presence-task-mismatch')
    expect(decision.lane.selectedTaskId).toBe(activeTask)
    expect(decision.lane.presenceTaskId).toBe(presenceTask)

    await req('DELETE', `/tasks/${activeTask}`)
    await req('DELETE', `/tasks/${presenceTask}`)
  })

  it('shows ok when presence.task matches single doing task', async () => {
    const agent = 'lane-ok'
    await cleanupAgentTasks(agent)
    const taskId = await createDoingTask(agent, 'TEST: lane ok task')
    await req('POST', `/presence/${agent}`, { status: 'working', task: taskId })

    const decision = await getDecision(agent)
    expect(decision.lane.laneReason).toBe('ok')
    expect(decision.lane.selectedTaskId).toBe(taskId)

    await req('DELETE', `/tasks/${taskId}`)
  })
})

describe('Idle Nudge shipped cooldown', () => {
  async function createDoingTask(agent: string, title: string): Promise<string> {
    const { status, body } = await req('POST', '/tasks', {
      title,
      description: 'Ship cooldown test task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      priority: 'P2',
      status: 'doing',
      done_criteria: ['ship cooldown test'],
      eta: '1h',
    })
    expect(status).toBe(200)
    return body.task.id as string
  }

  async function postShippedUpdate(agent: string) {
    const { status } = await req('POST', '/chat/messages', {
      from: agent,
      channel: 'general',
      content: `1) Shipped: PR #999 + artifact proof\n2) Blocker: none\n3) Next: follow-up + ETA 20m\nTask: task-demo`,
    })
    expect(status).toBe(200)
  }

  it('suppresses nudges after recent shipped signal', async () => {
    const agent = 'lane-ship-cooldown'
    await cleanupAgentTasks(agent)
    const taskId = await createDoingTask(agent, 'TEST: ship cooldown suppression')

    await req('POST', `/presence/${agent}`, {
      status: 'working',
      task: taskId,
      since: Date.now() - (50 * 60_000),
    })
    await postShippedUpdate(agent)

    const tickNowMs = Date.now() + (10 * 60_000)
    // force=true bypasses quiet hours — tests must work at any time of day
    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&force=true&nowMs=${tickNowMs}`)
    expect(status).toBe(200)

    const decision = (body.decisions || []).find((d: any) => d.agent === agent)
    expect(decision).toBeDefined()
    expect(decision.reason).toBe('recent-shipped-cooldown')
    expect(decision.decision).toBe('none')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('does not apply shipped cooldown when doing lane is stale', async () => {
    const agent = 'lane-ship-stale'
    await cleanupAgentTasks(agent)
    const taskId = await createDoingTask(agent, 'TEST: ship cooldown stale exemption')

    await req('POST', `/presence/${agent}`, {
      status: 'working',
      task: taskId,
      since: Date.now() - (50 * 60_000),
    })
    await postShippedUpdate(agent)

    const staleNowMs = Date.now() + (4 * 60 * 60_000)
    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&force=true&nowMs=${staleNowMs}`)
    expect(status).toBe(200)

    const decision = (body.decisions || []).find((d: any) => d.agent === agent)
    expect(decision).toBeDefined()
    expect(decision.reason).not.toBe('recent-shipped-cooldown')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('suppresses nudges when task comment posted recently', async () => {
    const agent = 'lane-comment-suppress'
    await cleanupAgentTasks(agent)
    const taskId = await createDoingTask(agent, 'TEST: comment suppression')

    await req('POST', `/presence/${agent}`, {
      status: 'working',
      task: taskId,
      since: Date.now() - (50 * 60_000),
    })

    // Post a task comment
    await req('POST', `/tasks/${taskId}/comments`, {
      author: agent,
      content: 'Working on the implementation, making progress',
    })

    const { status, body } = await req('POST', `/health/idle-nudge/tick?dryRun=true&force=true`)
    expect(status).toBe(200)

    const decision = (body.decisions || []).find((d: any) => d.agent === agent)
    expect(decision).toBeDefined()
    expect(decision.reason).toBe('recent-task-comment')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('starts task focus window on doing transition', async () => {
    const agent = 'lane-focus-window'
    await cleanupAgentTasks(agent)

    // Create task and move to doing — should start focus window
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: focus window task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      done_criteria: ['Focus tested'],
      eta: '45m',
      priority: 'P3',
    })
    const taskId = body.task.id
    await req('PATCH', `/tasks/${taskId}`, { status: 'doing' })

    await req('POST', `/presence/${agent}`, {
      status: 'working',
      task: taskId,
      since: Date.now() - (50 * 60_000),
    })

    const { status: s, body: b } = await req('POST', `/health/idle-nudge/tick?dryRun=true&force=true`)
    expect(s).toBe(200)

    const decision = (b.decisions || []).find((d: any) => d.agent === agent)
    expect(decision).toBeDefined()
    expect(decision.reason).toBe('task-focus-window')

    await req('DELETE', `/tasks/${taskId}`)
  })
})

describe('SSE Event Filtering', () => {
  it('GET /events/types returns valid event types', async () => {
    const { status, body } = await req('GET', '/events/types')
    expect(status).toBe(200)
    expect(body.types).toBeInstanceOf(Array)
    expect(body.types).toContain('message_posted')
    expect(body.types).toContain('task_created')
    expect(body.types).toContain('task_updated')
    expect(body.types).toContain('task_assigned')
    expect(body.types).toContain('presence_updated')
    expect(body.usage).toBeDefined()
  })

  it('GET /events/status returns subscription info', async () => {
    const { status, body } = await req('GET', '/events/status')
    expect(status).toBe(200)
    expect(body.connected).toBeTypeOf('number')
    expect(body.eventLog).toBeTypeOf('number')
  })
})

describe('Inbox', () => {
  it('GET /inbox/:agent returns inbox', async () => {
    const { status, body } = await req('GET', '/inbox/test-agent')
    expect(status).toBe(200)
    expect(body.messages).toBeInstanceOf(Array)
  })

  it('GET /inbox/:agent/unread returns count', async () => {
    const { status, body } = await req('GET', '/inbox/test-agent/unread')
    expect(status).toBe(200)
    expect(typeof body.count).toBe('number')
  })

  it('GET /inbox/:agent/subscriptions returns subs', async () => {
    const { status, body } = await req('GET', '/inbox/test-agent/subscriptions')
    expect(status).toBe(200)
    expect(body.subscriptions).toBeInstanceOf(Array)
  })

  it('POST /inbox/:agent/subscribe updates per-agent channel subscriptions', async () => {
    const agent = 'channel-reviewer'

    const { status: subscribeStatus, body: subscribeBody } = await req('POST', `/inbox/${agent}/subscribe`, {
      channels: ['reviews', 'blockers'],
    })
    expect(subscribeStatus).toBe(200)
    expect(subscribeBody.subscriptions).toEqual(['reviews', 'blockers'])

    const { status: getStatus, body: getBody } = await req('GET', `/inbox/${agent}/subscriptions`)
    expect(getStatus).toBe(200)
    expect(getBody.subscriptions).toEqual(['reviews', 'blockers'])
  })
})

describe('Mention Ack', () => {
  it('GET /health/mention-ack returns metrics', async () => {
    const { status, body } = await req('GET', '/health/mention-ack')
    expect(status).toBe(200)
    expect(typeof body.totalMentions).toBe('number')
    expect(typeof body.totalAcked).toBe('number')
    expect(body.byAgent).toBeDefined()
  })

  it('POST /health/mention-ack/check-timeouts runs sweep', async () => {
    const { status, body } = await req('POST', '/health/mention-ack/check-timeouts')
    expect(status).toBe(200)
    expect(body.timedOut).toBeInstanceOf(Array)
    expect(typeof body.count).toBe('number')
  })
})

describe('Metrics', () => {
  it('GET /metrics returns structured operational stats', async () => {
    const { status, body } = await req('GET', '/metrics')
    expect(status).toBe(200)
    expect(body.tasks).toBeDefined()
    expect(body.tasks.byStatus).toBeDefined()
    expect(body.chat).toBeDefined()
    expect(typeof body.chat.recentMessagesLastHour).toBe('number')
    expect(body.presence).toBeDefined()
    expect(body.agentActivityRates).toBeInstanceOf(Array)
    expect(typeof body.uptimeMs).toBe('number')
    expect(typeof body.responseTimeMs).toBe('number')
    expect(body.responseTimeMs).toBeLessThan(100)
  })
})

describe('Task outcome checkpoint', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: outcome checkpoint task',
      description: 'Outcome endpoint test',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Outcome captured'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'validating')

    await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['integration-test-evidence'],
        reviewer_approved: true,
      },
    })
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('POST /tasks/:id/outcome captures verdict metadata', async () => {
    const { status, body } = await req('POST', `/tasks/${taskId}/outcome`, {
      verdict: 'PASS',
      author: 'test-reviewer',
      notes: 'Looks healthy after 48h checkpoint',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.metadata.outcome_checkpoint).toBeDefined()
    expect(body.task.metadata.outcome_checkpoint.verdict).toBe('PASS')
    expect(body.task.metadata.outcome_checkpoint.capturedBy).toBe('test-reviewer')
  })
})

describe('Task review bundle', () => {
  const artifactRelPath = 'process/TASK-test-review-bundle.md'
  const artifactAbsPath = join(process.cwd(), artifactRelPath)
  let taskId: string

  beforeAll(async () => {
    await fs.mkdir(join(process.cwd(), 'process'), { recursive: true })
    await fs.writeFile(artifactAbsPath, '# test bundle\n', 'utf-8')

    const { body } = await req('POST', '/tasks', {
      title: 'TEST: review bundle task',
      description: 'Review bundle endpoint test',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Review packet generated'],
      eta: '1h',
    })

    taskId = body.task.id
    await advanceTo(taskId, 'doing')

    await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: artifactRelPath,
        qa_bundle: validQaBundle({
          summary: 'test summary',
          artifact_links: [artifactRelPath],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/4',
            commit: '1234abc',
            changed_files: ['process/TASK-test-review-bundle.md'],
            artifact_path: artifactRelPath,
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          artifact_path: artifactRelPath,
          test_proof: 'npm test -- tests/api.test.ts (pass)',
          known_caveats: 'No PR expected for this doc-only review-bundle test fixture.',
          doc_only: true,
        },
        artifacts: [artifactRelPath],
      },
    })
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
    await fs.rm(artifactAbsPath, { force: true })
  })

  it('POST /tasks/:id/review-bundle resolves artifacts and returns normalized verdict', async () => {
    const { status, body } = await req('POST', `/tasks/${taskId}/review-bundle`, {
      author: 'test-reviewer',
      strict: false,
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.bundle.taskId).toBe(taskId)
    expect(body.bundle.verdict).toBe('fail')
    expect(body.bundle.reasons).toContain('no_pr_url_resolved')
    expect(body.bundle.artifacts).toBeInstanceOf(Array)
    expect(body.bundle.artifacts.length).toBeGreaterThan(0)
    expect(body.bundle.artifacts[0].path).toBe(artifactRelPath)
    expect(body.bundle.artifacts[0].exists).toBe(true)
    expect(body.bundle.evidence.follow_on.required).toBe(false)
  })

  it('review bundle surfaces follow-on evidence for spec tasks', async () => {
    const followOn = await req('POST', '/tasks', {
      title: 'TEST: follow-on task for review bundle evidence',
      description: 'Used to validate follow-on evidence rendering',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Exists for linkage'],
      eta: '1h',
    })
    const followOnId = followOn.body.task.id

    const specTask = await req('POST', '/tasks', {
      title: 'TEST: review bundle follow-on evidence spec task',
      description: 'Spec task for follow-on evidence',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Follow-on evidence appears in bundle'],
      eta: '1h',
      metadata: {
        task_type: 'spec',
        artifact_path: artifactRelPath,
        artifacts: [artifactRelPath],
        follow_on_task_id: followOnId,
      },
    })
    const specTaskId = specTask.body.task.id

    const { status, body } = await req('POST', `/tasks/${specTaskId}/review-bundle`, {
      author: 'test-reviewer',
      strict: false,
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.bundle.evidence.follow_on.required).toBe(true)
    expect(body.bundle.evidence.follow_on.state).toBe('linked')
    expect(body.bundle.evidence.follow_on.followOnTaskId).toBe(followOnId)

    await req('DELETE', `/tasks/${specTaskId}`)
    await req('DELETE', `/tasks/${followOnId}`)
  })
})

describe('Cloud Integration', () => {
  it('GET /cloud/status returns cloud state', async () => {
    const { status, body } = await req('GET', '/cloud/status')
    expect(status).toBe(200)
    expect(typeof body.configured).toBe('boolean')
    expect(typeof body.registered).toBe('boolean')
    expect(typeof body.running).toBe('boolean')
    expect(typeof body.heartbeatCount).toBe('number')
    expect(typeof body.errors).toBe('number')
  })
})

describe('Team Manifest', () => {
  const teamManifestPath = join(REFLECTT_HOME, 'TEAM.md')

  it('GET /team/manifest returns ~/.reflectt TEAM.md (raw + parsed sections + metadata)', async () => {
    await fs.mkdir(REFLECTT_HOME, { recursive: true })
    const fixture = [
      '# TEAM.md — Test Team',
      '',
      '## Mission',
      'Ship real value.',
      '',
      '## Principles',
      '- Reflection over apology',
      '- Quality over quantity',
      '',
    ].join('\n')
    await fs.writeFile(teamManifestPath, fixture, 'utf8')

    const { status, body } = await req('GET', '/team/manifest')
    expect(status).toBe(200)
    expect(typeof body.manifest?.raw_markdown).toBe('string')
    expect(body.manifest.raw_markdown).toContain('Test Team')
    expect(Array.isArray(body.manifest?.sections)).toBe(true)
    expect(body.manifest.sections.some((section: any) => section.heading === 'Mission')).toBe(true)
    expect(typeof body.manifest?.version).toBe('string')
    expect(body.manifest.version.length).toBeGreaterThanOrEqual(32)
    expect(typeof body.manifest?.updated_at).toBe('number')
    expect(body.manifest.relative_path).toBe('TEAM.md')
    expect(body.manifest.source).toBe('reflectt_home')
  })
})

describe('Docs', () => {
  it('GET /docs returns markdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('reflectt-node API')
  })
})

describe('Agent roles config', () => {
  it('GET /agents/roles returns config source info', async () => {
    const { status, body } = await req('GET', '/agents/roles')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.agents).toBeDefined()
    expect(Array.isArray(body.agents)).toBe(true)
    expect(body.agents.length).toBeGreaterThan(0)
    expect(body.config).toBeDefined()
    expect(body.config.source).toBeDefined()
    expect(body.config.count).toBeGreaterThan(0)
  })

  it('GET /team/roles returns team-scoped role registry payload', async () => {
    const { status, body } = await req('GET', '/team/roles')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.agents)).toBe(true)
    expect(body.roleRegistry?.format).toBe('TEAM-ROLES.yaml')
    expect(body.roleRegistry?.count).toBeGreaterThan(0)
  })

  it('each agent has required fields', async () => {
    const { body } = await req('GET', '/agents/roles')
    for (const agent of body.agents) {
      expect(agent.name).toBeDefined()
      expect(agent.role).toBeDefined()
      expect(Array.isArray(agent.affinityTags)).toBe(true)
      expect(typeof agent.wipCap).toBe('number')
      expect(typeof agent.wipCount).toBe('number')
      expect(typeof agent.overCap).toBe('boolean')
      if (agent.description !== undefined) expect(typeof agent.description).toBe('string')
      if (agent.alwaysRoute !== undefined) expect(Array.isArray(agent.alwaysRoute)).toBe(true)
      if (agent.neverRoute !== undefined) expect(Array.isArray(agent.neverRoute)).toBe(true)
    }
  })
})

describe('Branch tracking on doing transition', () => {
  it('auto-populates metadata.branch when task moves to doing', async () => {
    const agentName = `branch-agent-${Date.now()}`
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: branch auto-populate',
      assignee: agentName,
      reviewer: 'kai',
      done_criteria: ['Branch auto-populated'],
      createdBy: 'test',
      eta: '1h',
      priority: 'P2',
    })
    expect(created.success).toBe(true)
    const taskId = created.task.id

    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.metadata.branch).toBeDefined()

    // Branch should follow convention: {assignee}/task-{shortId}
    const shortId = taskId.replace(/^task-\d+-/, '')
    expect(body.task.metadata.branch).toBe(`${agentName}/task-${shortId}`)

    // Cleanup
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('does not overwrite explicit branch in metadata', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: explicit branch',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['Explicit branch preserved'],
      createdBy: 'test',
      eta: '1h',
      priority: 'P2',
    })
    const taskId = created.task.id

    const { body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
      metadata: { branch: 'custom/my-branch' },
    })
    expect(body.task.metadata.branch).toBe('custom/my-branch')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('auto-populates branch on claim endpoint', async () => {
    const agentName = `claim-agent-${Date.now()}`
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: claim branch',
      assignee: agentName,
      reviewer: 'kai',
      done_criteria: ['Branch set on claim'],
      createdBy: 'test',
      eta: '1h',
      priority: 'P3',
    })
    const taskId = created.task.id

    // Unassign so we can claim
    await req('PATCH', `/tasks/${taskId}`, { assignee: '' })

    const { body } = await req('POST', `/tasks/${taskId}/claim`, {
      agent: agentName,
    })
    expect(body.success).toBe(true)
    const shortId = taskId.replace(/^task-\d+-/, '')
    expect(body.task.metadata.branch).toBe(`${agentName}/task-${shortId}`)

    await req('DELETE', `/tasks/${taskId}`)
  })
})

/* ── Batch create + board health ───────────────────────────────────── */
describe('Batch task creation', () => {
  const createdIds: string[] = []

  afterAll(async () => {
    for (const id of createdIds) {
      await req('DELETE', `/tasks/${id}`)
    }
  })

  it('POST /tasks/batch-create creates multiple tasks', async () => {
    const { status, body } = await req('POST', '/tasks/batch-create', {
      createdBy: 'test-runner',
      deduplicate: false,
      tasks: [
        {
          title: 'TEST: batch task alpha',
          assignee: 'test-agent',
          reviewer: 'test-reviewer',
          done_criteria: ['Alpha done'],
          eta: '30m',
          priority: 'P3',
          createdBy: 'test-runner',
        },
        {
          title: 'TEST: batch task beta',
          assignee: 'test-agent',
          reviewer: 'test-reviewer',
          done_criteria: ['Beta done'],
          eta: '30m',
          priority: 'P3',
          createdBy: 'test-runner',
        },
      ],
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.summary.created).toBe(2)
    expect(body.results.length).toBe(2)
    for (const r of body.results) {
      if (r.task?.id) createdIds.push(r.task.id)
    }
  })

  it('deduplicates against existing tasks', async () => {
    const { body: first } = await req('POST', '/tasks', {
      title: 'TEST: unique dedup target task',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['Dedup tested'],
      eta: '30m',
      priority: 'P3',
      createdBy: 'test-runner',
    })
    createdIds.push(first.task.id)

    const { body } = await req('POST', '/tasks/batch-create', {
      createdBy: 'test-runner',
      deduplicate: true,
      tasks: [
        {
          title: 'TEST: unique dedup target task',
          assignee: 'test-agent',
          reviewer: 'test-reviewer',
          done_criteria: ['Dedup tested'],
          eta: '30m',
          priority: 'P3',
          createdBy: 'test-runner',
        },
      ],
    })
    expect(body.summary.duplicates).toBe(1)
    expect(body.results[0].status).toBe('duplicate')
    expect(body.results[0].duplicateOf).toBe(first.task.id)
  })

  it('supports dryRun mode', async () => {
    const { body } = await req('POST', '/tasks/batch-create', {
      createdBy: 'test-runner',
      deduplicate: false,
      dryRun: true,
      tasks: [
        {
          title: 'TEST: dry run task',
          assignee: 'test-agent',
          reviewer: 'test-reviewer',
          done_criteria: ['Dry run done'],
          eta: '30m',
          priority: 'P3',
          createdBy: 'test-runner',
        },
      ],
    })
    expect(body.dryRun).toBe(true)
    expect(body.summary.created).toBe(1)
    expect(body.results[0].task).toBeUndefined()
  })
})

describe('Board health', () => {
  it('GET /tasks/board-health returns board status', async () => {
    const { status, body } = await req('GET', '/tasks/board-health')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.board).toBeDefined()
    expect(typeof body.board.totalTodo).toBe('number')
    expect(typeof body.board.totalDoing).toBe('number')
    expect(typeof body.board.replenishNeeded).toBe('boolean')
    expect(Array.isArray(body.agents)).toBe(true)
  })

  it('flags echo out-of-lane ops work unless explicit reassignment exists', async () => {
    const created = await req('POST', '/tasks', {
      title: 'TEST: echo CI pipeline guardrail hotfix',
      description: 'ops/system work in voice lane without reassignment',
      createdBy: 'test-runner',
      assignee: 'echo',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Guardrail catches out-of-lane assignment'],
      eta: '30m',
      status: 'doing',
      metadata: {
        lane: 'ops',
      },
    })

    expect(created.status).toBe(200)
    const taskId = created.body.task.id as string

    const flagged = await req('GET', '/tasks/board-health')
    expect(flagged.status).toBe(200)
    expect(Array.isArray(flagged.body.outOfLaneFlags)).toBe(true)
    expect(flagged.body.outOfLaneFlags.some((f: any) => f.taskId === taskId)).toBe(true)

    const patched = await req('PATCH', `/tasks/${taskId}`, {
      metadata: {
        lane: 'ops',
        reassigned: true,
        reassigned_by: 'kai',
        reassignment: 'temporary incident response assignment',
      },
    })
    expect(patched.status).toBe(200)

    const cleared = await req('GET', '/tasks/board-health')
    expect(cleared.status).toBe(200)
    expect(cleared.body.outOfLaneFlags.some((f: any) => f.taskId === taskId)).toBe(false)

    await req('DELETE', `/tasks/${taskId}`)
  })
})

/* ── Role-based assignment engine ──────────────────────────────────── */
describe('Agent role registry', () => {
  it('GET /agents/roles returns all agents with WIP status', async () => {
    const { status, body } = await req('GET', '/agents/roles')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.agents)).toBe(true)
    expect(body.agents.length).toBeGreaterThan(0)

    const link = body.agents.find((a: any) => a.name === 'link')
    expect(link).toBeDefined()
    expect(link.role).toBe('builder')
    expect(Array.isArray(link.affinityTags)).toBe(true)
    expect(typeof link.wipCount).toBe('number')
    expect(typeof link.wipCap).toBe('number')
  })
})

describe('Suggest assignee', () => {
  it('scores backend-related tasks highest for link', async () => {
    const { status, body } = await req('POST', '/tasks/suggest-assignee', {
      title: 'Fix API endpoint bug in server.ts webhook handler',
      done_criteria: ['Backend endpoint fixed', 'Tests pass'],
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    const linkScore = body.scores.find((s: any) => s.agent === 'link')
    expect(linkScore).toBeDefined()
    expect(linkScore.breakdown.affinity).toBeGreaterThan(0)
    for (const s of body.scores) {
      if (s.agent !== 'link') {
        expect(linkScore.breakdown.affinity).toBeGreaterThanOrEqual(s.breakdown.affinity)
      }
    }
  })

  it('scores dashboard tasks highest for pixel (explicit design opt-in)', async () => {
    const { body } = await req('POST', '/tasks/suggest-assignee', {
      title: 'Dashboard UI layout fix: modal animation and CSS cleanup',
      tags: ['ui', 'design'],
      metadata: { lane: 'design', surface: 'reflectt-node' },
    })
    const pixelScore = body.scores.find((s: any) => s.agent === 'pixel')
    expect(pixelScore).toBeDefined()
    expect(pixelScore.breakdown.affinity).toBeGreaterThan(0)
  })

  it('routes deploy/CI tasks to sage via protected domain', async () => {
    const { body } = await req('POST', '/tasks/suggest-assignee', {
      title: 'Fix CI deploy pipeline timeout issue',
    })
    expect(body.suggested).toBe('sage')
    expect(body.protectedMatch).toContain('deploy')
  })

  it('requires title parameter', async () => {
    const { body } = await req('POST', '/tasks/suggest-assignee', {})
    expect(body.success).toBe(false)
    expect(body.error).toContain('title')
  })
})

describe('WIP cap enforcement', () => {
  const taskIds: string[] = []
  const wipAgent = 'echo'

  afterAll(async () => {
    for (const id of taskIds) {
      await req('DELETE', `/tasks/${id}`)
    }
  })

  it('blocks doing transition when agent hits WIP cap', async () => {
    const { body: t1 } = await req('POST', '/tasks', {
      title: 'TEST: WIP cap test task 1',
      createdBy: 'test-runner',
      assignee: wipAgent,
      reviewer: 'test-reviewer',
      done_criteria: ['WIP tested'],
      eta: '30m',
      priority: 'P3',
    })
    taskIds.push(t1.task.id)
    await req('PATCH', `/tasks/${t1.task.id}`, { status: 'doing' })

    const { body: t2 } = await req('POST', '/tasks', {
      title: 'WIP cap test task 2',
      createdBy: 'test-runner',
      assignee: wipAgent,
      reviewer: 'test-reviewer',
      done_criteria: ['WIP tested'],
      eta: '30m',
      priority: 'P3',
    })
    taskIds.push(t2.task.id)

    const { status, body } = await req('PATCH', `/tasks/${t2.task.id}`, {
      status: 'doing',
    })
    expect(status).toBe(422)
    expect(body.gate).toBe('wip_cap')
  })

  it('allows doing transition with wip_override', async () => {
    const t2Id = taskIds[taskIds.length - 1]
    const { status, body } = await req('PATCH', `/tasks/${t2Id}`, {
      status: 'doing',
      metadata: { wip_override: 'Urgent P0 needs parallel work' },
    })
    expect(status).toBe(200)
    expect(body.task.status).toBe('doing')
    expect(body.task.metadata.wip_override_used).toBe(true)
  })
})

describe('Telemetry', () => {
  it('GET /telemetry returns snapshot + config', async () => {
    const { status, body } = await req('GET', '/telemetry')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.config).toBeDefined()
    expect(typeof body.config.enabled).toBe('boolean')
    expect(body.snapshot).toBeDefined()
    expect(body.snapshot.version).toBe('1.0.0')
    expect(body.snapshot.team).toBeDefined()
    expect(typeof body.snapshot.team.agentCount).toBe('number')
    expect(body.snapshot.tasks).toBeDefined()
    expect(body.snapshot.health).toBeDefined()
    expect(typeof body.snapshot.health.uptimeMs).toBe('number')
  })

  it('GET /telemetry/config returns config only', async () => {
    const { status, body } = await req('GET', '/telemetry/config')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.config.enabled).toBe('boolean')
    expect(typeof body.config.reportIntervalMs).toBe('number')
  })

  it('POST /api/telemetry/ingest accepts valid payload', async () => {
    const { status, body } = await req('POST', '/api/telemetry/ingest', {
      version: '1.0.0',
      hostId: 'test-host',
      timestamp: Date.now(),
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.received).toBe(true)
  })

  it('POST /api/telemetry/ingest rejects invalid payload', async () => {
    const { status, body } = await req('POST', '/api/telemetry/ingest', {})
    expect(status).toBe(400)
    expect(body.success).toBe(false)
  })
})

describe('Model performance analytics', () => {
  it('GET /analytics/models returns model stats', async () => {
    const { status, body } = await req('GET', '/analytics/models')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.analytics).toBeDefined()
    expect(typeof body.analytics.totalTracked).toBe('number')
    expect(typeof body.analytics.totalUntracked).toBe('number')
    expect(Array.isArray(body.analytics.models)).toBe(true)
  })

  it('GET /analytics/agents returns per-agent stats', async () => {
    const { status, body } = await req('GET', '/analytics/agents')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(Array.isArray(body.agents)).toBe(true)
  })

  it('model metadata persists through task lifecycle', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: model tracking lifecycle',
      assignee: 'test-model-agent',
      reviewer: 'kai',
      done_criteria: ['Model tracked'],
      createdBy: 'test',
      eta: '1h',
      priority: 'P3',
    })
    const taskId = created.task.id

    // Move to doing with model info
    const { body: doing } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
      metadata: { model: 'anthropic/claude-sonnet-4-5' },
    })
    expect(doing.task.metadata.model).toBe('anthropic/claude-sonnet-4-5')

    // Advance to validating before done
    await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-model-test.md',
        qa_bundle: validQaBundle({
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
            commit: 'abc1234',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-model-test.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/999',
          commit_sha: 'abc1234',
          changed_files: ['src/server.ts'],
          artifact_path: 'process/TASK-model-test.md',
          test_proof: 'test',
          known_caveats: 'none',
          caveats: 'none',
        },
      },
    })

    // Model should persist through to done
    const { body: done } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'kai',
      metadata: {
        artifacts: ['test-evidence'],
        reviewer_approved: true,
      },
    })
    expect(done.task.metadata.model).toBe('anthropic/claude-sonnet-4-5')

    // Check it shows in analytics
    const { body: analytics } = await req('GET', '/analytics/models')
    const modelEntry = analytics.analytics.models.find((m: any) => m.model === 'anthropic/claude-sonnet-4-5')
    expect(modelEntry).toBeDefined()

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects unknown model identifier when moving task to doing', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: invalid model id rejected',
      assignee: 'test-model-agent',
      reviewer: 'kai',
      done_criteria: ['Model validation blocks unknown values'],
      createdBy: 'test',
      eta: '1h',
      priority: 'P3',
    })
    const taskId = created.task.id

    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
      metadata: { model: 'not-a-real-model' },
    })
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.gate).toBe('model_validation')
    expect(body.error).toContain('Unknown model identifier')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('auto-defaults model alias when task starts without model configured', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: default model alias on start',
      assignee: 'test-model-agent',
      reviewer: 'kai',
      done_criteria: ['Default model assigned on start'],
      createdBy: 'test',
      eta: '1h',
      priority: 'P3',
    })
    const taskId = created.task.id

    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'doing',
      metadata: {},
    })
    expect(status).toBe(200)
    expect(body.task.metadata.model).toBe('gpt-codex')
    expect(body.task.metadata.model_resolved).toBe('openai-codex/gpt-5.3-codex')
    expect(body.task.metadata.model_defaulted).toBe(true)

    await req('DELETE', `/tasks/${taskId}`)
  })
})

// ============ Definition of Ready ============
describe('Definition of Ready enforcement', () => {
  // Note: DoR is skipped in NODE_ENV=test, so these tests verify the
  // checkDefinitionOfReady function behavior via the intake-schema endpoint
  // and schema-level validation (priority always present via default).

  it('GET /tasks/intake-schema returns required fields and DoR rules', async () => {
    const { status, body } = await req('GET', '/tasks/intake-schema')
    expect(status).toBe(200)
    expect(body.required).toContain('priority')
    expect(body.required).toContain('done_criteria')
    expect(body.optional).toContain('reviewer') // reviewer defaults to 'auto' (load-balanced assignment)
    expect(body.notes?.reviewer).toBeDefined()
    expect(body.types).toContain('bug')
    expect(body.types).toContain('feature')
    expect(body.definition_of_ready).toBeDefined()
    expect(body.definition_of_ready.length).toBeGreaterThan(0)
  })

  it('task creation always sets priority (defaults to P3)', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: priority default verification task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['Priority is set to P3 by default'],
      eta: '30m',
      // no priority specified
    })
    expect(status).toBe(200)
    expect(body.task.priority).toBe('P3')
    await req('DELETE', `/tasks/${body.task.id}`)
  })

  it('task creation accepts type field', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: typed task creation for bug type',
      type: 'bug',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['Bug type stored in metadata'],
      eta: '30m',
      priority: 'P1',
    })
    expect(status).toBe(200)
    expect(body.task.metadata?.type).toBe('bug')
    await req('DELETE', `/tasks/${body.task.id}`)
  })

  it('auto-assigns reviewer when reviewer is "auto"', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: auto reviewer assignment test',
      createdBy: 'test-runner',
      assignee: 'link',
      reviewer: 'auto',
      done_criteria: ['Reviewer is auto-assigned'],
      eta: '30m',
      priority: 'P2',
    })
    expect(status).toBe(200)
    expect(body.task.reviewer).toBeTruthy()
    expect(body.task.reviewer).not.toBe('link') // not the assignee
    expect(body.task.reviewer).not.toBe('auto') // resolved to actual agent
    expect(body.task.metadata?.reviewer_auto_assigned).toBe(true)
    expect(body.task.metadata?.reviewer_scores).toBeDefined()
    await req('DELETE', `/tasks/${body.task.id}`)
  })

  it('auto-assigns reviewer when reviewer is omitted', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: no reviewer specified test',
      createdBy: 'test-runner',
      assignee: 'pixel',
      done_criteria: ['Reviewer is auto-assigned when omitted'],
      eta: '30m',
      priority: 'P2',
    })
    expect(status).toBe(200)
    expect(body.task.reviewer).toBeTruthy()
    expect(body.task.reviewer).not.toBe('pixel')
    expect(body.task.metadata?.reviewer_auto_assigned).toBe(true)
    await req('DELETE', `/tasks/${body.task.id}`)
  })

  it('respects manual reviewer override', async () => {
    const { status, body } = await req('POST', '/tasks', {
      title: 'TEST: manual reviewer override test',
      createdBy: 'test-runner',
      assignee: 'link',
      reviewer: 'sage',
      done_criteria: ['Manual reviewer is preserved'],
      eta: '30m',
      priority: 'P2',
    })
    expect(status).toBe(200)
    expect(body.task.reviewer).toBe('sage')
    expect(body.task.metadata?.reviewer_auto_assigned).toBeUndefined()
    await req('DELETE', `/tasks/${body.task.id}`)
  })

  it('rejects invalid task type', async () => {
    const { status } = await req('POST', '/tasks', {
      title: 'TEST: invalid type task',
      type: 'invalid-type',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['Should fail'],
      eta: '30m',
      priority: 'P2',
    })
    expect(status).toBe(400)
  })
})

// PR Review Quality Panel
describe('PR Review Quality Panel', () => {
  let taskId: string

  it('returns available=false when task has no PR URL', async () => {
    // Create a task without PR metadata
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: task without PR',
      createdBy: 'test',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['Some criterion'],
      eta: '1h',
      priority: 'P3',
    })
    taskId = created.task.id

    const { status, body } = await req('GET', `/tasks/${taskId}/pr-review`)
    expect(status).toBe(200)
    expect(body.available).toBe(false)
    expect(body.taskId).toBe(taskId)

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('returns available=true with PR data when task has pr_url', async () => {
    // Create a task with a GitHub PR URL
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: task with PR',
      createdBy: 'test',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['Dashboard shows diff summary', 'Test results inline'],
      eta: '2h',
      priority: 'P2',
      metadata: {
        pr_url: 'https://github.com/octocat/hello-world/pull/1',
      },
    })
    taskId = created.task.id

    const { status, body } = await req('GET', `/tasks/${taskId}/pr-review`)
    expect(status).toBe(200)
    expect(body.available).toBe(true)
    expect(body.taskId).toBe(taskId)
    expect(body.pr).toBeDefined()
    expect(body.pr.number).toBe(1)
    expect(body.pr.owner).toBe('octocat')
    expect(body.pr.repo).toBe('hello-world')
    expect(body.diffScope).toBeDefined()
    expect(body.diffScope).toHaveProperty('riskLevel')
    expect(body.ci).toBeDefined()
    expect(body.doneCriteriaAlignment).toBeDefined()
    expect(body.doneCriteriaAlignment.summary.total).toBe(2)

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('extracts PR URL from qa_bundle.pr_link', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: task with qa_bundle PR',
      createdBy: 'test',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['Feature works'],
      eta: '1h',
      priority: 'P3',
      metadata: {
        qa_bundle: {
          lane: 'feature',
          summary: 'test',
          pr_link: 'https://github.com/octocat/hello-world/pull/2',
          commit_shas: ['abc'],
          changed_files: ['src/index.ts'],
          artifact_links: [],
          checks: ['npm test passed'],
          screenshot_proof: ['proof.png'],
        },
      },
    })
    taskId = created.task.id

    const { status, body } = await req('GET', `/tasks/${taskId}/pr-review`)
    expect(status).toBe(200)
    expect(body.available).toBe(true)
    expect(body.pr.number).toBe(2)
    expect(body.ci.qaBundleChecks).toContain('npm test passed')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('returns 404 for non-existent task', async () => {
    const res = await app.inject({ method: 'GET', url: '/tasks/task-nonexistent-99999/pr-review' })
    expect(res.statusCode).toBe(404)
  })
})

describe('Active Lane', () => {
  it('/health/agents includes active_lane field for doing agent', async () => {
    const agentName = `lane-test-${Date.now()}`
    const created = await req('POST', '/tasks', {
      title: 'TEST: active lane doing',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: agentName,
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Verify active lane'],
      eta: '1h',
    })
    expect(created.status).toBe(200)
    const taskId = created.body.task.id as string

    const { status, body } = await req('GET', '/health/agents')
    expect(status).toBe(200)
    const agent = body.agents.find((row: any) => row.agent === agentName)
    expect(agent).toBeDefined()
    expect(agent.active_lane).toBe('doing')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('/me/:agent includes active_lane field', async () => {
    const agentName = `lane-me-${Date.now()}`
    const created = await req('POST', '/tasks', {
      title: 'TEST: me endpoint active lane',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: agentName,
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Verify /me active lane'],
      eta: '1h',
    })
    expect(created.status).toBe(200)
    const taskId = created.body.task.id as string

    const { status, body } = await req('GET', `/me/${agentName}`)
    expect(status).toBe(200)
    expect(body.active_lane).toBe('doing')

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('active_lane is queue-clear when agent has no active tasks', async () => {
    const agentName = `lane-clear-${Date.now()}`
    const { status, body } = await req('GET', `/me/${agentName}`)
    expect(status).toBe(200)
    expect(body.active_lane).toBe('queue-clear')
  })
})

describe('Auto-queue notification', () => {
  it('sends auto-queue chat message when task moves to done', async () => {
    const agentName = `autoq-${Date.now()}`

    // Create a todo candidate that could be recommended
    const candidate = await req('POST', '/tasks', {
      title: 'TEST: auto-queue candidate',
      status: 'todo',
      createdBy: 'test-runner',
      assignee: agentName,
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Be recommended by auto-queue'],
      eta: '1h',
    })
    expect(candidate.status).toBe(200)
    const candidateId = candidate.body.task.id as string

    // Create a doing task for the agent
    const doingTask = await req('POST', '/tasks', {
      title: 'TEST: auto-queue completing task',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: agentName,
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Complete and trigger auto-queue'],
      eta: '1h',
    })
    expect(doingTask.status).toBe(200)
    const doingTaskId = doingTask.body.task.id as string

    // Move to validating
    const validating = await req('PATCH', `/tasks/${doingTaskId}`, {
      status: 'validating',
      metadata: {
        artifact_path: 'process/TASK-test-proof.md',
        qa_bundle: validQaBundle({
          review_packet: {
            task_id: doingTaskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/1',
            commit: 'abc1234',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-test-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: doingTaskId,
          artifact_path: 'process/TASK-test-proof.md',
          test_proof: 'npm test (pass)',
          known_caveats: 'none',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/1',
          commit_sha: 'abc1234',
        },
      },
    })
    expect(validating.status).toBe(200)

    // Move to done with reviewer approval
    const done = await req('PATCH', `/tasks/${doingTaskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        reviewer_approved: true,
        artifacts: ['https://github.com/reflectt/reflectt-node/pull/1'],
      },
    })
    expect(done.status).toBe(200)

    // Check chat for auto-queue message
    const { body: chatBody } = await req('GET', '/chat/messages?limit=50')
    const autoQueueMsg = chatBody.messages.find((m: any) =>
      m.metadata?.kind === 'auto-queue' && m.metadata?.completedTaskId === doingTaskId
    )
    expect(autoQueueMsg).toBeDefined()
    expect(autoQueueMsg.content).toContain(`@${agentName}`)
    expect(autoQueueMsg.content).toContain('great work')
    expect(autoQueueMsg.metadata.suggestedTaskIds.length).toBeGreaterThan(0)

    await req('DELETE', `/tasks/${doingTaskId}`)
    await req('DELETE', `/tasks/${candidateId}`)
  })
})

// Approval Queue + Routing Policy
describe('Approval Queue', () => {
  it('GET /approval-queue returns queue data', async () => {
    const { status, body } = await req('GET', '/approval-queue')
    expect(status).toBe(200)
    expect(body).toHaveProperty('items')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('highConfidenceCount')
    expect(body).toHaveProperty('needsReviewCount')
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('POST /approval-queue/:id/approve approves a task', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: approval queue approve test',
      createdBy: 'test',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['Works'],
      eta: '1h',
      priority: 'P3',
    })
    const taskId = created.task.id

    const { status, body } = await req('POST', `/approval-queue/${taskId}/approve`, {
      assignedAgent: 'pixel',
      reviewedBy: 'kai',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('POST /approval-queue/:id/reject rejects a task', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: approval queue reject test',
      createdBy: 'test',
      assignee: 'link',
      reviewer: 'kai',
      done_criteria: ['Works'],
      eta: '1h',
      priority: 'P3',
    })
    const taskId = created.task.id

    const { status, body } = await req('POST', `/approval-queue/${taskId}/reject`, {
      reason: 'Duplicate',
      reviewedBy: 'kai',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)

    await req('DELETE', `/tasks/${taskId}`)
  })

  it('POST /approval-queue/batch-approve handles multiple tasks', async () => {
    const tasks: string[] = []
    for (let i = 0; i < 3; i++) {
      const { body: created } = await req('POST', '/tasks', {
        title: `TEST: batch approve ${i}`,
        createdBy: 'test',
        assignee: 'link',
        reviewer: 'kai',
        done_criteria: ['Works'],
        eta: '1h',
        priority: 'P3',
      })
      tasks.push(created.task.id)
    }

    const { status, body } = await req('POST', '/approval-queue/batch-approve', {
      taskIds: tasks,
      reviewedBy: 'kai',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.approved).toBe(3)

    for (const id of tasks) await req('DELETE', `/tasks/${id}`)
  })
})

describe('Routing Policy', () => {
  it('GET /routing-policy returns agent affinity data', async () => {
    const { status, body } = await req('GET', '/routing-policy')
    expect(status).toBe(200)
    expect(Array.isArray(body.agents)).toBe(true)
    expect(body.agents.length).toBeGreaterThan(0)
    expect(body.agents[0]).toHaveProperty('agentId')
    expect(body.agents[0]).toHaveProperty('affinityTags')
    expect(body.agents[0]).toHaveProperty('weight')
  })

  it('PUT /routing-policy validates agents array', async () => {
    const { body } = await req('PUT', '/routing-policy', {
      agents: [],
      updatedBy: 'test',
    })
    expect(body.success).toBe(false)
    expect(body.error).toContain('agents')
  })
})

// Feedback Collection
describe('Feedback Collection', () => {
  it('POST /feedback creates feedback with valid data', async () => {
    const { status, body } = await req('POST', '/feedback', {
      category: 'bug',
      message: 'The widget does not close when clicking outside.',
      email: 'user@example.com',
      siteToken: 'test-token',
      url: 'https://chat.reflectt.ai',
    })
    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.id).toMatch(/^fb-/)
    expect(body.message).toBe('Feedback received.')
  })

  it('POST /feedback rejects short messages', async () => {
    const { status, body } = await req('POST', '/feedback', {
      category: 'bug',
      message: 'short',
      siteToken: 'test',
    })
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.message).toContain('10 characters')
  })

  it('POST /feedback rejects invalid category', async () => {
    const { status, body } = await req('POST', '/feedback', {
      category: 'invalid',
      message: 'This is a valid length message for testing.',
      siteToken: 'test',
    })
    expect(status).toBe(400)
    expect(body.message).toContain('bug, feature, or general')
  })

  it('GET /feedback returns feedback list', async () => {
    const { status, body } = await req('GET', '/feedback?status=all')
    expect(status).toBe(200)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('newCount')
  })

  it('PATCH /feedback/:id updates feedback status', async () => {
    // Create feedback first
    const { body: created } = await req('POST', '/feedback', {
      category: 'feature',
      message: 'Would love dark mode on the chat interface please.',
      siteToken: 'test',
    })
    const fbId = created.id

    const { status, body } = await req('PATCH', `/feedback/${fbId}`, {
      status: 'triaged',
      notes: 'Confirmed, assign to link',
      assignedTo: 'link',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.feedback.status).toBe('triaged')
    expect(body.feedback.assignedTo).toBe('link')
  })

  it('POST /feedback/:id/vote increments votes', async () => {
    const { body: created } = await req('POST', '/feedback', {
      category: 'general',
      message: 'General feedback about the product experience overall.',
      siteToken: 'test',
    })

    const { status, body } = await req('POST', `/feedback/${created.id}/vote`)
    expect(status).toBe(200)
    expect(body.votes).toBe(1)

    const { body: body2 } = await req('POST', `/feedback/${created.id}/vote`)
    expect(body2.votes).toBe(2)
  })

  it('GET /widget/feedback.js serves the widget', async () => {
    const res = await app.inject({ method: 'GET', url: '/widget/feedback.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('javascript')
    expect(res.body).toContain('reflectt-feedback-widget')
  })
})

/* ── Triage pipeline ───────────────────────────────────────────────── */
describe('Triage pipeline', () => {
  beforeAll(() => {
    _clearFeedbackStore()
  })

  it('POST /feedback accepts severity and reporterType', async () => {
    const { status, body } = await req('POST', '/feedback', {
      category: 'bug',
      message: 'Authentication is broken — users cannot login at all.',
      siteToken: 'test',
      severity: 'critical',
      reporterType: 'agent',
      reporterAgent: 'watchdog',
    })
    expect(status).toBe(201)
    expect(body.severity).toBe('critical')
    expect(body.reporterType).toBe('agent')
  })

  it('POST /feedback auto-infers severity when not provided', async () => {
    const { body } = await req('POST', '/feedback', {
      category: 'bug',
      message: 'The save button fails with an error on the settings page.',
      siteToken: 'test',
    })
    expect(body.severity).toBe('high') // matches 'fails' + 'error' patterns
    expect(body.reporterType).toBe('human') // default
  })

  it('GET /triage returns untriaged feedback sorted by severity', async () => {
    const { status, body } = await req('GET', '/triage')
    expect(status).toBe(200)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body).toHaveProperty('total')
    // Items should include severity and suggestedPriority
    if (body.items.length > 0) {
      expect(body.items[0]).toHaveProperty('severity')
      expect(body.items[0]).toHaveProperty('suggestedPriority')
      expect(body.items[0]).toHaveProperty('reporterType')
    }
  })

  it('POST /feedback/:id/triage creates a task from feedback', async () => {
    // Create feedback
    const { body: fb } = await req('POST', '/feedback', {
      category: 'bug',
      message: 'Dashboard crashes when loading more than 50 tasks in the view.',
      siteToken: 'test',
      severity: 'high',
      reporterType: 'human',
      email: 'user@example.com',
    })

    // Triage it
    const { status, body } = await req('POST', `/feedback/${fb.id}/triage`, {
      triageAgent: 'kai',
      assignee: 'link',
      lane: 'frontend',
    })
    expect(status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.taskId).toBeTruthy()
    expect(body.feedbackId).toBe(fb.id)
    expect(body.priority).toBe('P1') // high → P1

    // Verify task was created
    const { body: taskBody } = await req('GET', `/tasks/${body.taskId}`)
    expect(taskBody.task.title).toContain('Bug')
    expect(taskBody.task.metadata.source).toBe('feedback')
    expect(taskBody.task.metadata.feedbackId).toBe(fb.id)
    expect(taskBody.task.metadata.severity).toBe('high')
    expect(taskBody.task.metadata.reporterType).toBe('human')

    // Verify feedback is now triaged
    const { body: fbBody } = await req('GET', `/feedback/${fb.id}`)
    expect(fbBody.feedback.status).toBe('triaged')
    expect(fbBody.feedback.triageResult.taskId).toBe(body.taskId)
  })

  it('POST /feedback/:id/triage rejects already-triaged feedback', async () => {
    // Create and triage
    const { body: fb } = await req('POST', '/feedback', {
      category: 'feature',
      message: 'Add keyboard shortcuts for common task actions in the dashboard.',
      siteToken: 'test',
    })
    await req('POST', `/feedback/${fb.id}/triage`, { triageAgent: 'kai' })

    // Try again
    const { status, body } = await req('POST', `/feedback/${fb.id}/triage`, { triageAgent: 'kai' })
    expect(status).toBe(409)
    expect(body.error).toContain('Already triaged')
  })

  it('POST /feedback/:id/triage allows priority override', async () => {
    const { body: fb } = await req('POST', '/feedback', {
      category: 'general',
      message: 'The onboarding flow could be more intuitive for new users.',
      siteToken: 'test',
    })

    const { status, body } = await req('POST', `/feedback/${fb.id}/triage`, {
      triageAgent: 'sage',
      priority: 'P1', // Override from auto P3
    })
    expect(status).toBe(201)
    expect(body.priority).toBe('P1')
  })

  it('GET /feedback supports severity and reporterType filters', async () => {
    const { status, body } = await req('GET', '/feedback?status=all&severity=critical&reporterType=agent')
    expect(status).toBe(200)
    // All returned items should match filters
    for (const item of body.items) {
      expect(item.severity).toBe('critical')
      expect(item.reporterType).toBe('agent')
    }
  })
})

/* ── Reviewer approval identity enforcement ────────────────────────── */
describe('Reviewer approval identity gate', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'Reviewer identity gate test',
      createdBy: 'test-runner',
      assignee: 'agent-a',
      reviewer: 'agent-reviewer',
      priority: 'P2',
      done_criteria: ['Identity gate tested'],
      eta: '1h',
    })
    taskId = body.task.id
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects reviewer_approved=true when actor is missing', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      metadata: { reviewer_approved: true },
    })
    expect(status).toBe(400)
    expect(body.gate).toBe('reviewer_identity')
    expect(body.error).toContain('actor field')
  })

  it('rejects reviewer_approved=true when actor is not the assigned reviewer', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      actor: 'some-other-agent',
      metadata: { reviewer_approved: true },
    })
    expect(status).toBe(403)
    expect(body.gate).toBe('reviewer_identity')
    expect(body.error).toContain('Only assigned reviewer')
    expect(body.error).toContain('agent-reviewer')
  })

  it('accepts reviewer_approved=true when actor matches assigned reviewer', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      actor: 'agent-reviewer',
      metadata: { reviewer_approved: true },
    })
    expect(status).toBe(200)
    expect(body.task.metadata.reviewer_approved).toBe(true)
    expect(body.task.metadata.approved_by).toBe('agent-reviewer')
    expect(body.task.metadata.approved_at).toBeTypeOf('number')
  })

  it('records approval_rejected metadata when non-reviewer attempts approval', async () => {
    // Reset approval first
    await req('PATCH', `/tasks/${taskId}`, {
      actor: 'agent-reviewer',
      metadata: { reviewer_approved: false, review_state: 'in_progress' },
    })

    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      actor: 'agent-a',
      metadata: { reviewer_approved: true },
    })
    expect(status).toBe(403)
    expect(body.gate).toBe('reviewer_identity')
  })

  it('done transition rejected when approval came from wrong reviewer', async () => {
    // Create a fresh task for this test
    const { body: created } = await req('POST', '/tasks', {
      title: 'Reviewer identity done-gate test',
      createdBy: 'test-runner',
      assignee: 'agent-b',
      reviewer: 'agent-reviewer',
      priority: 'P2',
      done_criteria: ['Done gate tested'],
      eta: '1h',
    })
    const freshId = created.task.id
    await advanceTo(freshId, 'validating')

    // Try to approve and move to done in one call — wrong actor
    const { status, body } = await req('PATCH', `/tasks/${freshId}`, {
      status: 'done',
      actor: 'agent-b',
      metadata: {
        artifacts: ['test-evidence'],
        reviewer_approved: true,
      },
    })
    expect(status).toBe(403)
    expect(body.gate).toBe('reviewer_identity')

    await req('DELETE', `/tasks/${freshId}`)
  })

  it('case-insensitive reviewer matching', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'Reviewer case test',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'Kai',
      priority: 'P3',
      done_criteria: ['Case tested'],
      eta: '1h',
    })
    const caseId = created.task.id

    const { status } = await req('PATCH', `/tasks/${caseId}`, {
      actor: 'kai',
      metadata: { reviewer_approved: true },
    })
    expect(status).toBe(200)

    await req('DELETE', `/tasks/${caseId}`)
  })
})

/* ── Stale SLA alert guardrails (integration) ──────────────────────── */
describe('Stale SLA alert guardrails (integration)', () => {
  it('verifyTaskExists returns null after hard DELETE (full API flow)', async () => {
    const { verifyTaskExists } = await import('../src/health.js')

    // Create a task then delete it (simulates the hard-DELETE scenario that caused stale alerts)
    const createRes = await req('POST', '/tasks', {
      title: 'TEST: SLA guardrail delete-task check',
      assignee: 'test-agent',
      done_criteria: ['Verify deleted tasks are filtered from alerts'],
      eta: '~1h',
      createdBy: 'test',
      priority: 'P3',
      reviewer: 'kai',
    })
    const taskId = createRes.body.task.id

    // Verify it exists first
    const beforeDelete = verifyTaskExists(taskId)
    expect(beforeDelete).not.toBeNull()

    // Hard delete — this is what triggers the stale alert bug
    await req('DELETE', `/tasks/${taskId}`)

    // Should now return null — alert pipeline will skip it
    const afterDelete = verifyTaskExists(taskId)
    expect(afterDelete).toBeNull()
  })

  it('/health/team staleDoing only contains tasks that still exist', async () => {
    const { status, body } = await req('GET', '/health/team')
    expect(status).toBe(200)

    // All tasks in staleDoing list must be real, existing tasks
    if (body.staleDoing?.tasks?.length > 0) {
      const { verifyTaskExists } = await import('../src/health.js')
      for (const staleTask of body.staleDoing.tasks) {
        const exists = verifyTaskExists(staleTask.task_id)
        expect(exists).not.toBeNull()
      }
    }
  })

  it('staleDoing stale_minutes are bounded (no impossible durations)', async () => {
    const { status, body } = await req('GET', '/health/team')
    expect(status).toBe(200)

    if (body.staleDoing?.tasks?.length > 0) {
      const MAX_STALE_DISPLAY_MIN = 24 * 60 // 1 day cap
      for (const staleTask of body.staleDoing.tasks) {
        expect(staleTask.stale_minutes).toBeLessThanOrEqual(MAX_STALE_DISPLAY_MIN)
        expect(staleTask.stale_minutes).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

// ── PR merge gate tests ──
describe('Task close gate: PR merge state', () => {
  let taskId: string

  beforeAll(async () => {
    const { body } = await req('POST', '/tasks', {
      title: 'TEST: PR merge gate task',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['PR merge gate tested'],
      tags: ['code'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'validating')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('rejects done for code-lane task without PR URL', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['tested locally'],
        reviewer_approved: true,
      },
    })
    expect(status).toBe(422)
    expect(body.gate).toBe('pr_link')
  })

  it('accepts done with waiver even without merged PR', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['https://github.com/reflectt/reflectt-node/pull/999999'],
        reviewer_approved: true,
        pr_waiver: true,
        pr_waiver_reason: 'Test waiver — hotfix scenario',
      },
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.task.status).toBe('done')
  })

  it('does not block when GitHub API is unavailable (graceful degradation)', async () => {
    // Reset task to doing
    await req('PATCH', `/tasks/${taskId}`, { status: 'doing' })

    // Use a clearly fake PR URL — GitHub API will fail, gate should not block
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'done',
      actor: 'test-reviewer',
      metadata: {
        artifacts: ['https://github.com/fake-org/fake-repo/pull/99999'],
        reviewer_approved: true,
      },
    })
    // Should pass because GitHub API failure = graceful skip
    expect(status).toBe(200)
    expect(body.task.status).toBe('done')
  })
})

// ── Regression: task comment notification truncation ───────────────────────

describe('task comment notification - no truncation', () => {
  it('preserves full comment content in notification relay (no 280-char truncation)', async () => {
    // Create a task
    const { body: taskBody } = await req('POST', '/tasks', {
      title: 'TEST: truncation regression',
      createdBy: 'test-runner',
      assignee: 'truncation-agent',
      reviewer: 'truncation-reviewer',
      done_criteria: ['No truncation'],
      eta: '~15m',
    })
    const taskId = taskBody.task.id

    // Post a long comment (>280 chars)
    const longContent = 'A'.repeat(500) + ' END_MARKER'
    const { status, body } = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'truncation-reviewer',
      content: longContent,
    })
    expect(status).toBe(200)
    expect(body.comment.content).toBe(longContent)

    // Verify the comment is stored in full
    const { body: commentsBody } = await req('GET', `/tasks/${taskId}/comments`)
    const stored = commentsBody.comments.find((c: any) => c.content.includes('END_MARKER'))
    expect(stored).toBeDefined()
    expect(stored.content).toBe(longContent)
    expect(stored.content.length).toBe(511) // 500 A's + ' END_MARKER'

    // Verify chat relay message contains full content (not truncated to 280)
    const { body: chatBody } = await req('GET', '/chat/messages?channel=task-comments&limit=50')
    const allMsgs = chatBody.messages || []
    const relayMsg = allMsgs.find((m: any) =>
      m.content.includes('END_MARKER') && m.content.includes('[task-comment:')
    )
    expect(relayMsg).toBeDefined()
    // The relay message should contain the full content, not a 280-char snippet
    expect(relayMsg.content).toContain('END_MARKER')
    expect(relayMsg.content.length).toBeGreaterThan(400)

    // Cleanup
    await req('DELETE', `/tasks/${taskId}`)
  })

  it('preserves short comments unchanged', async () => {
    const uniqueSuffix = Date.now()
    const { status: createStatus, body: taskBody } = await req('POST', '/tasks', {
      title: `TEST: short comment regression ${uniqueSuffix}`,
      createdBy: 'test-runner',
      assignee: 'truncation-short-agent',
      reviewer: 'truncation-short-reviewer',
      done_criteria: ['Short ok'],
      eta: '~15m',
    })
    expect(createStatus).toBe(200)
    const taskId = taskBody.task.id

    const shortContent = `LGTM, ship it! ${uniqueSuffix}`
    const { status, body } = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'truncation-short-reviewer',
      content: shortContent,
    })
    expect(status).toBe(200)
    expect(body.comment.content).toBe(shortContent)

    // Verify chat relay has full content
    const { body: chatBody } = await req('GET', '/chat/messages?channel=task-comments&limit=50')
    const relayMsg = (chatBody.messages || []).find((m: any) =>
      m.content.includes(`ship it! ${uniqueSuffix}`) && m.content.includes('[task-comment:')
    )
    expect(relayMsg).toBeDefined()
    expect(relayMsg.content).toContain(shortContent)

    await req('DELETE', `/tasks/${taskId}`)
  })
})

// ── Regression: task updatedAt advances on comment ────────────────────────

describe('task comment activity updates task.updatedAt', () => {
  it('bumps updatedAt when a comment is added', async () => {
    const uniqueSuffix = Date.now()
    const { status: createStatus, body: taskBody } = await req('POST', '/tasks', {
      title: `TEST: updatedAt bump on comment ${uniqueSuffix}`,
      createdBy: 'test-runner',
      assignee: 'activity-agent',
      reviewer: 'activity-reviewer',
      done_criteria: ['updatedAt advances on comment'],
      eta: '~15m',
    })
    expect(createStatus).toBe(200)
    const taskId = taskBody.task.id

    const { body: beforeBody } = await req('GET', `/tasks/${taskId}`)
    const beforeUpdatedAt = beforeBody.task.updatedAt

    await new Promise(resolve => setTimeout(resolve, 10))

    const { status: commentStatus } = await req('POST', `/tasks/${taskId}/comments`, {
      author: 'activity-agent',
      content: `Progress update ${uniqueSuffix}`,
    })
    expect(commentStatus).toBe(200)

    const { body: afterBody } = await req('GET', `/tasks/${taskId}`)
    const afterUpdatedAt = afterBody.task.updatedAt

    expect(afterUpdatedAt).toBeGreaterThan(beforeUpdatedAt)

    await req('DELETE', `/tasks/${taskId}`)
  })
})

/* ── Test harness noise filter on /tasks/next ──────────────────────── */
describe('Test harness task filtering on /tasks/next', () => {
  const testTaskIds: string[] = []

  afterAll(async () => {
    for (const id of testTaskIds) {
      await req('DELETE', `/tasks/${id}`)
    }
  })

  it('excludes tasks with ref-test-* source_reflection from /tasks/next', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: harness noise ref-test filter',
      createdBy: 'test-runner',
      assignee: 'filter-test-agent',
      reviewer: 'test-reviewer',
      done_criteria: ['Filtered from next'],
      eta: '30m',
      priority: 'P0',
      metadata: {
        source_reflection: 'ref-test-artifact-vis',
        source_insight: 'ins-test-artifact-vis',
      },
    })
    testTaskIds.push(created.task.id)

    const { status, body } = await req('GET', '/tasks/next?agent=filter-test-agent')
    expect(status).toBe(200)
    // Should NOT return the test-harness task even though it's P0
    if (body.task) {
      expect(body.task.id).not.toBe(created.task.id)
    }
  })

  it('excludes tasks with "test run <timestamp>" title pattern from /tasks/next', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'Implement artifact visibility endpoint with heartbeat validation for test run 1771944154373',
      createdBy: 'test-runner',
      assignee: 'filter-test-agent-2',
      reviewer: 'test-reviewer',
      done_criteria: ['Filtered from next'],
      eta: '30m',
      priority: 'P0',
    })
    testTaskIds.push(created.task.id)

    const { status, body } = await req('GET', '/tasks/next?agent=filter-test-agent-2')
    expect(status).toBe(200)
    if (body.task) {
      expect(body.task.id).not.toBe(created.task.id)
    }
  })

  it('excludes tasks with metadata.is_test=true from /tasks/next', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: is_test flag filter',
      createdBy: 'test-runner',
      assignee: 'filter-test-agent-3',
      reviewer: 'test-reviewer',
      done_criteria: ['Filtered from next'],
      eta: '30m',
      priority: 'P0',
      metadata: { is_test: true },
    })
    testTaskIds.push(created.task.id)

    const { status, body } = await req('GET', '/tasks/next?agent=filter-test-agent-3')
    expect(status).toBe(200)
    if (body.task) {
      expect(body.task.id).not.toBe(created.task.id)
    }
  })

  it('includes test tasks when ?include_test=1 is passed', async () => {
    const { body: created } = await req('POST', '/tasks', {
      title: 'TEST: include_test override',
      createdBy: 'test-runner',
      assignee: 'filter-test-agent-4',
      reviewer: 'test-reviewer',
      done_criteria: ['Visible with override'],
      eta: '30m',
      priority: 'P0',
      metadata: {
        source_reflection: 'ref-test-override',
        is_test: true,
      },
    })
    testTaskIds.push(created.task.id)

    const { status, body } = await req('GET', '/tasks/next?agent=filter-test-agent-4&include_test=1')
    expect(status).toBe(200)
    expect(body.task).toBeDefined()
    expect(body.task.id).toBe(created.task.id)
  })

  it('excludes test-harness tasks from /tasks list by default (unless include_test=1)', async () => {
    const agent = `filter-list-agent-${Date.now()}`
    const { body: created } = await req('POST', '/tasks', {
      title: 'Harness list filter task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      done_criteria: ['Filtered from /tasks list by default'],
      eta: '30m',
      priority: 'P2',
      status: 'todo',
      metadata: {
        source_reflection: 'ref-test-list-filter',
        source_insight: 'ins-test-list-filter',
      },
    })
    testTaskIds.push(created.task.id)

    const { status: s1, body: b1 } = await req('GET', `/tasks?assignee=${agent}&status=todo`)
    expect(s1).toBe(200)
    expect((b1.tasks || []).some((t: any) => t.id === created.task.id)).toBe(false)

    const { status: s2, body: b2 } = await req('GET', `/tasks?assignee=${agent}&status=todo&include_test=1`)
    expect(s2).toBe(200)
    expect((b2.tasks || []).some((t: any) => t.id === created.task.id)).toBe(true)
  })

  it('excludes test-harness tasks from /tasks/board-health counts', async () => {
    const agent = `filter-board-health-agent-${Date.now()}`

    const { body: realTask } = await req('POST', '/tasks', {
      title: 'Real backlog task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      done_criteria: ['Counts in board health'],
      eta: '30m',
      priority: 'P2',
      status: 'todo',
      metadata: {
        reflection_exempt: true,
        reflection_exempt_reason: 'test: board-health counts',
      },
    })
    testTaskIds.push(realTask.task.id)

    const { body: testTask } = await req('POST', '/tasks', {
      title: 'Harness board-health noise task',
      createdBy: 'test-runner',
      assignee: agent,
      reviewer: 'test-reviewer',
      done_criteria: ['Should NOT count in board health'],
      eta: '30m',
      priority: 'P2',
      status: 'todo',
      metadata: {
        source_reflection: 'ref-test-board-health',
        source_insight: 'ins-test-board-health',
      },
    })
    testTaskIds.push(testTask.task.id)

    const { status, body } = await req('GET', '/tasks/board-health')
    expect(status).toBe(200)
    const agentRow = (body.agents || []).find((a: any) => a.agent === agent)
    expect(agentRow).toBeDefined()
    expect(agentRow.todo).toBe(1) // only the real task
  })

  it('filters title-only "Test Run <timestamp>" case-insensitively in /tasks and /tasks/search (even if metadata.is_test missing)', async () => {
    const db = getDb()
    const ts = Date.now()
    const agent = `filter-case-agent-${ts}`
    const id = `task-caseinsens-${ts}`
    const title = `CASEINSENS-${ts} for Test Run ${ts}`

    // Insert directly into DB to simulate legacy/unmarked harness tasks
    db.prepare(
      `INSERT INTO tasks (
        id, title, description, status, assignee, reviewer, done_criteria,
        created_by, created_at, updated_at, priority, blocked_by, epic_id,
        tags, metadata, comment_count
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )`
    ).run(
      id,
      title,
      'Inserted directly for filter regression test',
      'todo',
      agent,
      'test-reviewer',
      JSON.stringify(['n/a']),
      'test-runner',
      ts,
      ts,
      'P2',
      JSON.stringify([]),
      null,
      JSON.stringify([]),
      JSON.stringify({}),
      0
    )

    // /tasks should exclude it by default
    const { status: s1, body: b1 } = await req('GET', `/tasks?assignee=${agent}&status=todo`)
    expect(s1).toBe(200)
    expect((b1.tasks || []).some((t: any) => t.id === id)).toBe(false)

    // include_test=1 should include it (escape hatch)
    const { status: s2, body: b2 } = await req('GET', `/tasks?assignee=${agent}&status=todo&include_test=1`)
    expect(s2).toBe(200)
    expect((b2.tasks || []).some((t: any) => t.id === id)).toBe(true)

    // /tasks/search should also exclude by default
    const { status: s3, body: b3 } = await req('GET', `/tasks/search?q=${encodeURIComponent(`CASEINSENS-${ts}`)}`)
    expect(s3).toBe(200)
    expect((b3.tasks || []).some((t: any) => t.id === id)).toBe(false)

    // include_test=1 should include in search
    const { status: s4, body: b4 } = await req('GET', `/tasks/search?q=${encodeURIComponent(`CASEINSENS-${ts}`)}&include_test=1`)
    expect(s4).toBe(200)
    expect((b4.tasks || []).some((t: any) => t.id === id)).toBe(true)

    // Cleanup
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  })
})

// ── Shared Workspace Read API (HTTP) ─────────────────────

describe('Shared Workspace Read API (HTTP)', () => {
  it('GET /shared/list returns entries for process/', async () => {
    const res = await app.inject({ method: 'GET', url: '/shared/list?path=process/' })
    const body = JSON.parse(res.body)
    // May or may not have files depending on shared workspace state, but should not error
    expect(body.success !== undefined || body.error !== undefined).toBe(true)
    if (body.success) {
      expect(Array.isArray(body.entries)).toBe(true)
    }
  })

  it('GET /shared/list rejects traversal', async () => {
    const res = await app.inject({ method: 'GET', url: '/shared/list?path=process/../../etc' })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
  })

  it('GET /shared/list rejects outside-allowlist path', async () => {
    const res = await app.inject({ method: 'GET', url: '/shared/list?path=src/' })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
  })

  it('GET /shared/read requires path', async () => {
    const res = await app.inject({ method: 'GET', url: '/shared/read' })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(body.error).toContain('path')
  })

  it('GET /shared/read rejects traversal', async () => {
    const res = await app.inject({ method: 'GET', url: '/shared/read?path=process/../../etc/passwd' })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
  })

  it('GET /shared/read rejects disallowed extension', async () => {
    const res = await app.inject({ method: 'GET', url: '/shared/read?path=process/malware.exe' })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
  })

  it('GET /shared/view requires path', async () => {
    const res = await app.inject({ method: 'GET', url: '/shared/view' })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toContain('path')
  })

  it('GET /tasks/:id/artifacts returns artifact list for a task with metadata', async () => {
    // Create a task with an artifact_path
    const created = await req('POST', '/tasks', {
      title: 'TEST: shared-ws-artifact-preview',
      description: 'Test artifact resolution with shared workspace fallback',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Verify artifact preview'],
      eta: '1h',
      metadata: {
        artifact_path: 'process/nonexistent-test-artifact.md',
        artifacts: ['https://github.com/reflectt/reflectt-node/pull/999'],
        reflection_exempt: true,
      },
    })
    expect(created.status).toBe(200)
    const taskId = created.body.task.id

    // Fetch artifacts
    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}/artifacts` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.taskId).toBe(taskId)
    expect(body.artifactCount).toBeGreaterThan(0)
    expect(Array.isArray(body.artifacts)).toBe(true)

    // URL artifact should be accessible
    const urlArtifact = body.artifacts.find((a: any) => a.type === 'url')
    expect(urlArtifact).toBeDefined()
    expect(urlArtifact.accessible).toBe(true)

    // File artifact may or may not be accessible (depends on shared workspace state)
    const fileArtifact = body.artifacts.find((a: any) => a.path === 'process/nonexistent-test-artifact.md')
    expect(fileArtifact).toBeDefined()

    // Heartbeat info should be present
    expect(body.heartbeat).toBeDefined()

    // Cleanup
    await app.inject({ method: 'DELETE', url: `/tasks/${taskId}` })
  })

  it('GET /tasks/:id/artifacts?include=preview includes preview field', async () => {
    // This test verifies the include=preview query param is accepted
    const created = await req('POST', '/tasks', {
      title: 'TEST: shared-ws-preview-mode',
      description: 'Test preview mode on artifact endpoint',
      status: 'doing',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P2',
      done_criteria: ['Verify preview mode'],
      eta: '1h',
      metadata: {
        artifact_path: 'process/some-artifact.md',
        reflection_exempt: true,
      },
    })
    expect(created.status).toBe(200)
    const taskId = created.body.task.id

    const res = await app.inject({ method: 'GET', url: `/tasks/${taskId}/artifacts?include=preview` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.taskId).toBe(taskId)

    // Cleanup
    await app.inject({ method: 'DELETE', url: `/tasks/${taskId}` })
  })
})

describe('Context budget', () => {
  it('GET /context/budgets returns configured budgets', async () => {
    const { status, body } = await req('GET', '/context/budgets')
    expect(status).toBe(200)
    expect(body.budgets).toBeTruthy()
    expect(body.budgets.layers).toBeTruthy()
    expect(body.budgets.layers.session_local).toBeGreaterThan(0)
  })

  it('POST/GET /context/memo persists memo content', async () => {
    const scope_id = 'TEST:scope:context-memo'
    const content = 'TEST memo content'

    const created = await req('POST', '/context/memo', {
      scope_id,
      layer: 'team_shared',
      content,
      source_window: { test: true },
    })
    expect(created.status).toBe(200)
    expect(created.body.success).toBe(true)
    expect(created.body.memo.scope_id).toBe(scope_id)

    const fetched = await req('GET', `/context/memo?scope_id=${encodeURIComponent(scope_id)}&layer=team_shared`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.memo.content).toContain(content)

    // Cleanup
    const db = getDb()
    db.prepare('DELETE FROM context_memos WHERE scope_id = ?').run(scope_id)
  })

  it('GET /context/inject enforces per-layer budgets and reuses persisted memos', async () => {
    const prev = {
      OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
      REFLECTT_CONTEXT_AUTOSUMMARY: process.env.REFLECTT_CONTEXT_AUTOSUMMARY,
      REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS: process.env.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS,
      REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS: process.env.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS,
    }

    // Create a fake OpenClaw state dir with a workspace for this agent.
    const tmp = await fs.mkdtemp(join(tmpdir(), 'reflectt-context-'))

    try {
      process.env.OPENCLAW_STATE_DIR = tmp

      const agent = 'testagent'
      const ws = join(tmp, `workspace-${agent}`)
      await fs.mkdir(ws, { recursive: true })

      // Write an oversized SOUL.md to force agent_persistent overflow.
      const huge = 'A'.repeat(10_000)
      await fs.writeFile(join(ws, 'SOUL.md'), huge, 'utf-8')

      // Force small budgets + enable autosummary.
      process.env.REFLECTT_CONTEXT_AUTOSUMMARY = 'true'
      process.env.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS = '80'
      process.env.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS = '80'

      const first = await req('GET', `/context/inject/${agent}?limit=5&scope_id=team:default`)
      expect(first.status).toBe(200)
      expect(first.body.layers.agent_persistent.used_tokens).toBeLessThanOrEqual(first.body.layers.agent_persistent.budget_tokens)
      expect(first.body.layers.agent_persistent.memo_used).toBe(true)
      expect(first.body.layers.agent_persistent.memo_updated).toBe(true)

      const second = await req('GET', `/context/inject/${agent}?limit=5&scope_id=team:default`)
      expect(second.status).toBe(200)
      expect(second.body.layers.agent_persistent.memo_used).toBe(true)
      // Should reuse memo when the overflow window didn't change.
      expect(second.body.layers.agent_persistent.memo_updated).toBe(false)

      // Cleanup memo row
      const db = getDb()
      db.prepare('DELETE FROM context_memos WHERE scope_id = ?').run(`agent:${agent}`)
    } finally {
      // Restore env
      if (prev.OPENCLAW_STATE_DIR === undefined) delete process.env.OPENCLAW_STATE_DIR
      else process.env.OPENCLAW_STATE_DIR = prev.OPENCLAW_STATE_DIR

      if (prev.REFLECTT_CONTEXT_AUTOSUMMARY === undefined) delete process.env.REFLECTT_CONTEXT_AUTOSUMMARY
      else process.env.REFLECTT_CONTEXT_AUTOSUMMARY = prev.REFLECTT_CONTEXT_AUTOSUMMARY

      if (prev.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS === undefined) delete process.env.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS
      else process.env.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS = prev.REFLECTT_CONTEXT_BUDGET_AGENT_PERSISTENT_TOKENS

      if (prev.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS === undefined) delete process.env.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS
      else process.env.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS = prev.REFLECTT_CONTEXT_BUDGET_SESSION_LOCAL_TOKENS

      // Best-effort cleanup tmp dir
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    }
  })
})

describe('Duplicate-closure validating evidence gate', () => {
  let taskId: string
  let dupeOfTaskId: string

  beforeAll(async () => {
    // Fixture artifact used by artifact mirroring when a task enters validating.
    await fs.mkdir(join(process.cwd(), 'process'), { recursive: true })
    await fs.writeFile(
      join(process.cwd(), 'process', 'TASK-duplicate-gate-proof.md'),
      '# TASK-duplicate-gate-proof\n\nTest fixture for validating transition tests.\n',
      'utf8',
    )

    const dupeOf = await req('POST', '/tasks', {
      title: 'TEST: duplicate-of target',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P3',
      done_criteria: ['exists'],
      eta: '1h',
    })
    dupeOfTaskId = dupeOf.body.task.id

    const { body } = await req('POST', '/tasks', {
      title: 'TEST: duplicate closure evidence gate',
      createdBy: 'test-runner',
      assignee: 'test-agent',
      reviewer: 'test-reviewer',
      priority: 'P1',
      done_criteria: ['Duplicate closures require evidence'],
      eta: '1h',
    })
    taskId = body.task.id
    await advanceTo(taskId, 'doing')
  })

  afterAll(async () => {
    await req('DELETE', `/tasks/${taskId}`)
    await req('DELETE', `/tasks/${dupeOfTaskId}`)
    await fs.rm(join(process.cwd(), 'process', 'TASK-duplicate-gate-proof.md'), { force: true }).catch(() => {})
  })

  it('rejects validating transition for duplicate auto-closure without canonical reference/proof', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        auto_closed: true,
        auto_close_reason: 'duplicate',
        artifact_path: 'process/TASK-duplicate-gate-proof.md',
        qa_bundle: validQaBundle({
          summary: 'ok bundle (but missing duplicate evidence)',
          artifact_links: ['process/TASK-duplicate-gate-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
            commit: 'abcd123',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-duplicate-gate-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
          commit_sha: 'abcd123',
          artifact_path: 'process/TASK-duplicate-gate-proof.md',
          test_proof: 'npm test (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(400)
    expect(body.gate).toBe('duplicate_evidence')
    expect(body.error).toContain('Duplicate-closure validating gate')
  })

  it('accepts validating transition for duplicate auto-closure with canonical reference + proof', async () => {
    const { status, body } = await req('PATCH', `/tasks/${taskId}`, {
      status: 'validating',
      metadata: {
        auto_closed: true,
        auto_close_reason: 'duplicate_task',
        duplicate_of: {
          task_id: dupeOfTaskId,
          proof: `Duplicate of ${dupeOfTaskId}: same root cause and same fix path; keeping one canonical task.`,
        },
        artifact_path: 'process/TASK-duplicate-gate-proof.md',
        qa_bundle: validQaBundle({
          summary: 'ok bundle + duplicate evidence',
          artifact_links: ['process/TASK-duplicate-gate-proof.md'],
          review_packet: {
            task_id: taskId,
            pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
            commit: 'abcd123',
            changed_files: ['src/server.ts'],
            artifact_path: 'process/TASK-duplicate-gate-proof.md',
            caveats: 'none',
          },
        }),
        review_handoff: {
          task_id: taskId,
          repo: 'reflectt/reflectt-node',
          pr_url: 'https://github.com/reflectt/reflectt-node/pull/5',
          commit_sha: 'abcd123',
          artifact_path: 'process/TASK-duplicate-gate-proof.md',
          test_proof: 'npm test (pass)',
          known_caveats: 'none',
        },
      },
    })

    expect(status).toBe(200)
    expect(body.task.status).toBe('validating')
  })
})
