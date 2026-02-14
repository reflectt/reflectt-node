import { resolveIdleNudgeLane } from '../src/watchdog/idleNudgeLane.js'

type TaskLike = {
  id: string
  assignee: string
  status: string
  createdAt: number
  updatedAt: number
}

type Scenario = {
  name: string
  agent: string
  presenceTaskRaw: string | null
  idleMinutes: number
  tasks: TaskLike[]
  expected: {
    laneReason: 'no-active-lane' | 'stale-lane' | 'ambiguous-lane' | 'presence-task-mismatch' | 'ok'
    decision: 'none' | 'warn' | 'escalate'
    reason: string
  }
}

const now = Date.now()
const maxAgeMin = Number(process.env.IDLE_NUDGE_ACTIVE_TASK_MAX_AGE_MIN || 180)
const warnMin = Number(process.env.IDLE_NUDGE_WARN_MIN || 45)
const escalateMin = Number(process.env.IDLE_NUDGE_ESCALATE_MIN || 60)

const mkTask = (id: string, assignee: string, ageMin: number): TaskLike => ({
  id,
  assignee,
  status: 'doing',
  createdAt: now - (ageMin * 60_000),
  updatedAt: now - (ageMin * 60_000),
})

function decisionFromLane(laneReason: string, idleMinutes: number): { decision: 'none' | 'warn' | 'escalate'; reason: string } {
  if (idleMinutes < warnMin) return { decision: 'none', reason: 'below-warn-threshold' }

  if (laneReason === 'no-active-lane') return { decision: 'none', reason: 'missing-active-task' }
  if (laneReason === 'stale-lane') return { decision: 'none', reason: 'stale-active-task' }
  if (laneReason === 'ambiguous-lane') return { decision: 'none', reason: 'ambiguous-active-task' }
  if (laneReason === 'presence-task-mismatch') return { decision: 'none', reason: 'presence-task-mismatch' }

  return {
    decision: idleMinutes >= escalateMin ? 'escalate' : 'warn',
    reason: 'eligible',
  }
}

const scenarios: Scenario[] = [
  {
    name: 'missing-active-task',
    agent: 'coh-missing',
    presenceTaskRaw: null,
    idleMinutes: 90,
    tasks: [],
    expected: { laneReason: 'no-active-lane', decision: 'none', reason: 'missing-active-task' },
  },
  {
    name: 'stale-active-task',
    agent: 'coh-stale',
    presenceTaskRaw: null,
    idleMinutes: 90,
    tasks: [mkTask('task-coh-stale-1', 'coh-stale', maxAgeMin + 20)],
    expected: { laneReason: 'stale-lane', decision: 'none', reason: 'stale-active-task' },
  },
  {
    name: 'ambiguous-active-task',
    agent: 'coh-amb',
    presenceTaskRaw: null,
    idleMinutes: 90,
    tasks: [mkTask('task-coh-amb-1', 'coh-amb', 20), mkTask('task-coh-amb-2', 'coh-amb', 10)],
    expected: { laneReason: 'ambiguous-lane', decision: 'none', reason: 'ambiguous-active-task' },
  },
  {
    name: 'presence-task-mismatch',
    agent: 'coh-mismatch',
    presenceTaskRaw: 'task-coh-presence-other',
    idleMinutes: 90,
    tasks: [mkTask('task-coh-mismatch-1', 'coh-mismatch', 10)],
    expected: { laneReason: 'presence-task-mismatch', decision: 'none', reason: 'presence-task-mismatch' },
  },
  {
    name: 'ok-warn',
    agent: 'coh-ok-warn',
    presenceTaskRaw: 'task-coh-ok-warn-1',
    idleMinutes: 50,
    tasks: [mkTask('task-coh-ok-warn-1', 'coh-ok-warn', 10)],
    expected: { laneReason: 'ok', decision: 'warn', reason: 'eligible' },
  },
  {
    name: 'ok-escalate',
    agent: 'coh-ok-esc',
    presenceTaskRaw: 'task-coh-ok-esc-1',
    idleMinutes: 75,
    tasks: [mkTask('task-coh-ok-esc-1', 'coh-ok-esc', 10)],
    expected: { laneReason: 'ok', decision: 'escalate', reason: 'eligible' },
  },
]

const rows = scenarios.map((s) => {
  const lane = resolveIdleNudgeLane(s.agent, s.presenceTaskRaw, s.tasks, now, maxAgeMin)
  const decision = decisionFromLane(lane.laneReason, s.idleMinutes)
  const pass = lane.laneReason === s.expected.laneReason
    && decision.decision === s.expected.decision
    && decision.reason === s.expected.reason

  return {
    scenario: s.name,
    input: {
      idleMinutes: s.idleMinutes,
      presenceTaskRaw: s.presenceTaskRaw,
      taskIds: s.tasks.map(t => t.id),
      taskAgesMin: s.tasks.map(t => Math.floor((now - t.updatedAt) / 60_000)),
    },
    expected: s.expected,
    actual: {
      laneReason: lane.laneReason,
      decision: decision.decision,
      reason: decision.reason,
      selectedTaskId: lane.selectedTaskId,
    },
    pass,
  }
})

const failCount = rows.filter(r => !r.pass).length
const summary = {
  warnMin,
  escalateMin,
  activeTaskMaxAgeMin: maxAgeMin,
  scenarioCount: rows.length,
  passCount: rows.length - failCount,
  failCount,
  status: failCount === 0 ? 'PASS' : 'FAIL',
}

console.log('IDLE_NUDGE_COHERENCE_HARNESS_RESULT')
console.log(JSON.stringify({ summary, rows }, null, 2))

if (failCount > 0) {
  process.exit(1)
}
