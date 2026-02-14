import { spawnSync } from 'node:child_process'

type CaseDef = {
  id: string
  fixture: string
  expectedFailedChecks: string[]
}

type CaseResult = {
  id: string
  fixture: string
  pass: boolean
  expectedFailedChecks: string[]
  actualFailedChecks: string[]
  exitCode: number | null
  status: string
  reason: string
}

const marker = 'TASK_LINKIFY_DRYRUN_TRANSCRIPT_VALIDATION_RESULT'

const cases: CaseDef[] = [
  {
    id: 'missing-mutation-line',
    fixture: 'artifacts/task-linkify/fixtures/fixture-missing-mutation-line.txt',
    expectedFailedChecks: ['mutation-false'],
  },
  {
    id: 'nonzero-mutation-endpoints',
    fixture: 'artifacts/task-linkify/fixtures/fixture-nonzero-mutation-endpoints.txt',
    expectedFailedChecks: ['mutation-endpoint-calls-zero'],
  },
  {
    id: 'missing-decision-line',
    fixture: 'artifacts/task-linkify/fixtures/fixture-missing-decision-line.txt',
    expectedFailedChecks: ['decision-explicit-single'],
  },
  {
    id: 'required-context-drift',
    fixture: 'artifacts/task-linkify/fixtures/fixture-required-context-drift.txt',
    expectedFailedChecks: ['required-context-exact'],
  },
]

function runCase(c: CaseDef): CaseResult {
  const run = spawnSync(
    'npm',
    ['run', 'test:task-linkify:dryrun-validator', '--', c.fixture],
    { encoding: 'utf8' },
  )

  const stdout = run.stdout || ''
  const stderr = run.stderr || ''

  // Reason-specific guard: must be validator FAIL payload, not generic parse/read usage failure.
  if (!stdout.includes(marker)) {
    return {
      id: c.id,
      fixture: c.fixture,
      pass: false,
      expectedFailedChecks: c.expectedFailedChecks,
      actualFailedChecks: [],
      exitCode: run.status,
      status: 'ERROR',
      reason: `missing validator marker (stderr=${stderr.trim() || '<empty>'})`,
    }
  }

  const fragment = stdout.split(marker, 2)[1]?.trim() || ''
  const brace = fragment.indexOf('{')
  if (brace < 0) {
    return {
      id: c.id,
      fixture: c.fixture,
      pass: false,
      expectedFailedChecks: c.expectedFailedChecks,
      actualFailedChecks: [],
      exitCode: run.status,
      status: 'ERROR',
      reason: 'missing JSON payload after marker',
    }
  }

  let payload: any
  try {
    payload = JSON.parse(fragment.slice(brace))
  } catch (err: any) {
    return {
      id: c.id,
      fixture: c.fixture,
      pass: false,
      expectedFailedChecks: c.expectedFailedChecks,
      actualFailedChecks: [],
      exitCode: run.status,
      status: 'ERROR',
      reason: `invalid JSON payload: ${err?.message || err}`,
    }
  }

  const failedChecks = (payload.checks || [])
    .filter((x: any) => x && x.pass === false)
    .map((x: any) => String(x.id))

  const hasExpectedReasons = c.expectedFailedChecks.every(id => failedChecks.includes(id))
  const explicitFailSignal = payload.status === 'FAIL' && Number(payload.failCount || 0) > 0
  const exitedNonZero = (run.status ?? 0) !== 0

  const pass = hasExpectedReasons && explicitFailSignal && exitedNonZero

  let reason = 'ok'
  if (!hasExpectedReasons) reason = `expected failed checks missing; expected=${c.expectedFailedChecks.join(',')} actual=${failedChecks.join(',')}`
  else if (!explicitFailSignal) reason = `validator payload did not report FAIL/failCount>0 (status=${payload.status}, failCount=${payload.failCount})`
  else if (!exitedNonZero) reason = `validator command exit code was ${run.status}, expected non-zero`

  return {
    id: c.id,
    fixture: c.fixture,
    pass,
    expectedFailedChecks: c.expectedFailedChecks,
    actualFailedChecks: failedChecks,
    exitCode: run.status,
    status: String(payload.status || 'UNKNOWN'),
    reason,
  }
}

const results = cases.map(runCase)
const failCount = results.filter(r => !r.pass).length

const output = {
  harness: 'task-linkify-dryrun-validator-negative-harness',
  command: 'npm run test:task-linkify:dryrun-negative-fixtures',
  summary: {
    caseCount: results.length,
    passCount: results.length - failCount,
    failCount,
    status: failCount === 0 ? 'PASS' : 'FAIL',
  },
  results,
}

console.log('TASK_LINKIFY_DRYRUN_NEGATIVE_HARNESS_RESULT')
console.log(JSON.stringify(output, null, 2))

if (failCount > 0) process.exit(1)
