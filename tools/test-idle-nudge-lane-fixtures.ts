import assert from 'node:assert/strict'
import { resolveIdleNudgeLane } from '../src/watchdog/idleNudgeLane.js'

type Fixture = {
  name: string
  agent: string
  presenceTaskRaw: unknown
  tasks: Array<{ id: string; assignee: string; status: string; createdAt: number; updatedAt: number }>
  expected: {
    laneReason: 'no-active-lane' | 'stale-lane' | 'ambiguous-lane' | 'presence-task-mismatch' | 'ok'
    selectedTaskId: string | null
  }
}

const now = Date.now()
const maxAgeMin = Number(process.env.IDLE_NUDGE_ACTIVE_TASK_MAX_AGE_MIN || 180)
const staleMs = (maxAgeMin + 5) * 60_000
const freshMs = Math.max(1, maxAgeMin - 5) * 60_000

const fixtures: Fixture[] = [
  {
    name: 'no-active-lane',
    agent: 'fixture-no-active',
    presenceTaskRaw: null,
    tasks: [],
    expected: { laneReason: 'no-active-lane', selectedTaskId: null },
  },
  {
    name: 'stale-lane',
    agent: 'fixture-stale',
    presenceTaskRaw: null,
    tasks: [
      {
        id: 'task-fixture-stale-1',
        assignee: 'fixture-stale',
        status: 'doing',
        createdAt: now - staleMs,
        updatedAt: now - staleMs,
      },
    ],
    expected: { laneReason: 'stale-lane', selectedTaskId: null },
  },
  {
    name: 'ambiguous-lane',
    agent: 'fixture-ambiguous',
    presenceTaskRaw: null,
    tasks: [
      {
        id: 'task-fixture-ambiguous-1',
        assignee: 'fixture-ambiguous',
        status: 'doing',
        createdAt: now - freshMs,
        updatedAt: now - freshMs,
      },
      {
        id: 'task-fixture-ambiguous-2',
        assignee: 'fixture-ambiguous',
        status: 'doing',
        createdAt: now - (freshMs - 60_000),
        updatedAt: now - (freshMs - 60_000),
      },
    ],
    expected: { laneReason: 'ambiguous-lane', selectedTaskId: 'task-fixture-ambiguous-2' },
  },
  {
    name: 'presence-task-mismatch',
    agent: 'fixture-mismatch',
    presenceTaskRaw: 'task-fixture-mismatch-presence',
    tasks: [
      {
        id: 'task-fixture-mismatch-actual',
        assignee: 'fixture-mismatch',
        status: 'doing',
        createdAt: now - freshMs,
        updatedAt: now - freshMs,
      },
    ],
    expected: { laneReason: 'presence-task-mismatch', selectedTaskId: 'task-fixture-mismatch-actual' },
  },
  {
    name: 'ok-lane',
    agent: 'fixture-ok',
    presenceTaskRaw: 'task-fixture-ok-1',
    tasks: [
      {
        id: 'task-fixture-ok-1',
        assignee: 'fixture-ok',
        status: 'doing',
        createdAt: now - freshMs,
        updatedAt: now - freshMs,
      },
    ],
    expected: { laneReason: 'ok', selectedTaskId: 'task-fixture-ok-1' },
  },
]

const rows: Array<Record<string, unknown>> = []

for (const fx of fixtures) {
  const lane = resolveIdleNudgeLane(
    fx.agent,
    fx.presenceTaskRaw,
    fx.tasks,
    now,
    maxAgeMin,
  )

  assert.equal(
    lane.laneReason,
    fx.expected.laneReason,
    `[${fx.name}] laneReason mismatch: expected ${fx.expected.laneReason}, got ${lane.laneReason}`,
  )

  assert.equal(
    lane.selectedTaskId,
    fx.expected.selectedTaskId,
    `[${fx.name}] selectedTaskId mismatch: expected ${fx.expected.selectedTaskId}, got ${lane.selectedTaskId}`,
  )

  rows.push({
    fixture: fx.name,
    expectedLaneReason: fx.expected.laneReason,
    actualLaneReason: lane.laneReason,
    expectedSelectedTaskId: fx.expected.selectedTaskId,
    actualSelectedTaskId: lane.selectedTaskId,
    freshDoingTaskIds: lane.freshDoingTaskIds,
    staleDoingTaskIds: lane.staleDoingTaskIds,
  })
}

const activeHandles = ((process as any)._getActiveHandles?.() || [])

console.log('IDLE_NUDGE_LANE_FIXTURES_PASS')
console.log(JSON.stringify({
  maxAgeMin,
  fixtureCount: fixtures.length,
  activeHandleCount: activeHandles.length,
  results: rows,
}, null, 2))
