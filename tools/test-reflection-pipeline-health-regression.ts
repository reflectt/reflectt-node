type Check = {
  id: string
  desc: string
  pass: boolean
  expected: string
  actual: string
}

const baseUrl = process.env.REFLECTT_URL || process.env.REFLECTT_NODE_URL || 'http://127.0.0.1:4445'

async function getJson(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`)
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}

const checks: Check[] = []
function push(id: string, desc: string, pass: boolean, expected: string, actual: string) {
  checks.push({ id, desc, pass, expected, actual })
}

const h = await getJson('/health/reflection-pipeline')
push(
  'http-200',
  'GET /health/reflection-pipeline returns 200',
  h.status === 200,
  'status=200',
  `status=${h.status}`,
)

const status = h.json?.status
const created = h.json?.recentInsightsCreated
const updated = h.json?.recentInsightsUpdated
const activity = h.json?.recentInsightActivity

push(
  'shape',
  'payload includes expected fields',
  typeof status === 'string' && typeof created === 'number' && typeof updated === 'number' && typeof activity === 'number',
  'status:string, recentInsightsCreated:number, recentInsightsUpdated:number, recentInsightActivity:number',
  `status=${String(status)}, created=${String(created)}, updated=${String(updated)}, activity=${String(activity)}`,
)

if (typeof created === 'number' && typeof updated === 'number' && typeof activity === 'number') {
  push(
    'activity-sum',
    'recentInsightActivity == recentInsightsCreated + recentInsightsUpdated',
    activity === created + updated,
    `activity=${created + updated}`,
    `activity=${activity}`,
  )
}

// Regression guard: updated>0 should count as healthy signal even if created=0
// (This specifically protects against the old false-positive health failure mode.)
if (typeof created === 'number' && typeof updated === 'number' && updated > 0 && created === 0) {
  push(
    'updated-implies-healthy',
    'when recentInsightsUpdated>0 and recentInsightsCreated==0, status is healthy',
    status === 'healthy',
    'status=healthy',
    `status=${String(status)}`,
  )
}

const failCount = checks.filter(c => !c.pass).length
const result = {
  harness: 'reflection-pipeline-health-regression',
  baseUrl,
  command: 'npm run test:reflection-pipeline-health:regression',
  note: 'Some assertions are conditional on live data (updated>0 & created==0). This is intended as a regression guard, not a full simulation.',
  summary: {
    caseCount: checks.length,
    passCount: checks.length - failCount,
    failCount,
    status: failCount === 0 ? 'PASS' : 'FAIL',
  },
  checks,
  sample: h.json,
}

console.log('REFLECTION_PIPELINE_HEALTH_REGRESSION_HARNESS_RESULT')
console.log(JSON.stringify(result, null, 2))

if (failCount > 0) process.exit(1)
