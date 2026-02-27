import { setTimeout as sleep } from 'node:timers/promises'

type Check = {
  id: string
  desc: string
  pass: boolean
  expected: string
  actual: string
}

const baseUrl = process.env.REFLECTT_URL || process.env.REFLECTT_NODE_URL || 'http://127.0.0.1:4445'

async function postJson(path: string, body: any): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

const checks: Check[] = []
function push(id: string, desc: string, pass: boolean, expected: string, actual: string) {
  checks.push({ id, desc, pass, expected, actual })
}

const payload = {
  pain: '[harness] reflection dedup regression',
  impact: 'ensure duplicate reflections are suppressed',
  evidence: ['tools/test-reflection-dedup-regression.ts'],
  went_well: 'n/a',
  suspected_why: 'n/a',
  proposed_fix: 'n/a',
  confidence: 5,
  role_type: 'agent',
  author: 'harness',
  severity: 'low',
  metadata: { harness: true },
}

// Give the server a moment if it's starting up (best-effort)
await sleep(50)

const first = await postJson('/reflections', payload)
push(
  'create-201',
  'first POST /reflections creates a new reflection',
  first.status === 201 && first.json?.success === true && typeof first.json?.reflection?.id === 'string',
  'status=201, success=true, reflection.id=string',
  `status=${first.status}, success=${String(first.json?.success)}, id=${String(first.json?.reflection?.id)}`,
)

const firstId = first.json?.reflection?.id as string | undefined

const second = await postJson('/reflections', payload)
push(
  'dedup-200',
  'second identical POST /reflections is deduped and returns canonical reflection',
  second.status === 200 && second.json?.success === true && second.json?.deduped === true && second.json?.reflection?.id === firstId,
  'status=200, success=true, deduped=true, reflection.id==firstId',
  `status=${second.status}, success=${String(second.json?.success)}, deduped=${String(second.json?.deduped)}, id=${String(second.json?.reflection?.id)}, firstId=${String(firstId)}`,
)

if (firstId) {
  const fetched = await getJson(`/reflections/${firstId}`)
  const count = fetched.json?.reflection?.metadata?.dedup?.count
  push(
    'dedup-counter',
    'canonical reflection metadata.dedup.count increments on duplicate suppression',
    fetched.status === 200 && typeof count === 'number' && count >= 1,
    'status=200, metadata.dedup.count>=1',
    `status=${fetched.status}, count=${String(count)}`,
  )
}

const failCount = checks.filter(c => !c.pass).length
const result = {
  harness: 'reflection-dedup-regression',
  baseUrl,
  command: 'npm run test:reflection-dedup:regression',
  summary: {
    caseCount: checks.length,
    passCount: checks.length - failCount,
    failCount,
    status: failCount === 0 ? 'PASS' : 'FAIL',
  },
  checks,
}

console.log('REFLECTION_DEDUP_REGRESSION_HARNESS_RESULT')
console.log(JSON.stringify(result, null, 2))

if (failCount > 0) process.exit(1)
