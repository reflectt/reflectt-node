import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

type Check = {
  id: string
  desc: string
  pass: boolean
  expected: string
  actual: string
}

const dashboardPath = resolve(process.cwd(), 'public/dashboard.js')
const src = readFileSync(dashboardPath, 'utf8')

function between(start: string, end: string): string {
  const s = src.indexOf(start)
  if (s === -1) throw new Error(`missing marker: ${start}`)
  const e = src.indexOf(end, s)
  if (e === -1) throw new Error(`missing end marker: ${end}`)
  return src.slice(s, e).trim()
}

function line(re: RegExp): string {
  const m = src.match(re)
  if (!m) throw new Error(`missing line: ${re}`)
  return m[0]
}

const agoFn = between('function ago(ts)', 'function esc(s)')
const resolveFn = between('function resolveSSOTState(lastVerifiedUtc)', 'async function fetchSSOTMeta()')
const fetchFn = between('async function fetchSSOTMeta()', 'async function renderPromotionSSOT()')
const isUrlFn = between('function isTaskTokenInsideUrl(text, start, end)', 'function isTaskTokenLinkable(text, start, end)')

const ssotIndexLine = line(/const SSOT_INDEX_RAW_URL = .+;/)
const cacheLine = line(/let ssotMetaCache = .+;/)
const cacheMsLine = line(/const SSOT_META_CACHE_MS = .+;/)

const runtimeCode = `
${ssotIndexLine}
${cacheLine}
${cacheMsLine}
${agoFn}
${resolveFn}
${fetchFn}
${isUrlFn}
globalThis.__testExports = {
  resolveSSOTState,
  fetchSSOTMeta,
  isTaskTokenInsideUrl,
  getCache: () => ssotMetaCache,
  setCache: (v) => { ssotMetaCache = v; },
};
`

const fixedNow = Date.parse('2026-02-14T15:00:00Z')
const context = {
  console,
  Date: { ...Date, now: () => fixedNow, parse: Date.parse },
  fetch: async (_url: string) => ({ ok: true, status: 200, text: async () => '- last_verified_utc: 2026-02-14T14:00:00Z\n' }),
  globalThis: {} as any,
}

vm.createContext(context)
vm.runInContext(runtimeCode, context)

const t = context.globalThis.__testExports as {
  resolveSSOTState: (input: string | null) => { state: string, label: string, text: string }
  fetchSSOTMeta: () => Promise<{ fetchedAt: number, lastVerifiedUtc: string | null }>
  isTaskTokenInsideUrl: (text: string, start: number, end: number) => boolean
  getCache: () => { fetchedAt: number, lastVerifiedUtc: string | null }
  setCache: (v: { fetchedAt: number, lastVerifiedUtc: string | null }) => void
}

const checks: Check[] = []

function push(id: string, desc: string, pass: boolean, expected: string, actual: string) {
  checks.push({ id, desc, pass, expected, actual })
}

const fresh = t.resolveSSOTState('2026-02-14T14:00:00Z')
push('state-fresh', 'fresh state for <=24h age', fresh.state === 'fresh' && fresh.label === 'fresh', 'state=fresh,label=fresh', `state=${fresh.state},label=${fresh.label}`)

const warn = t.resolveSSOTState('2026-02-13T03:00:00Z')
push('state-warn', 'warn state for >24h and <=72h', warn.state === 'warn' && warn.label === 'review soon', 'state=warn,label=review soon', `state=${warn.state},label=${warn.label}`)

const stale = t.resolveSSOTState('2026-02-10T00:00:00Z')
push('state-stale', 'stale state for >72h age', stale.state === 'stale' && stale.label === 'stale evidence', 'state=stale,label=stale evidence', `state=${stale.state},label=${stale.label}`)

const unknownNull = t.resolveSSOTState(null)
push('state-unknown-null', 'unknown state for missing timestamp', unknownNull.state === 'unknown' && unknownNull.text === 'verification timestamp unavailable', 'state=unknown,text=verification timestamp unavailable', `state=${unknownNull.state},text=${unknownNull.text}`)

const unknownInvalid = t.resolveSSOTState('not-a-date')
push('state-unknown-invalid', 'unknown state for invalid timestamp', unknownInvalid.state === 'unknown' && unknownInvalid.text === 'verification timestamp unavailable', 'state=unknown,text=verification timestamp unavailable', `state=${unknownInvalid.state},text=${unknownInvalid.text}`)

context.fetch = async () => ({ ok: true, status: 200, text: async () => '- last_verified_utc: 2026-02-14T14:00:00Z\n' })
t.setCache({ fetchedAt: 0, lastVerifiedUtc: null })
const okMeta = await t.fetchSSOTMeta()
push('fetch-parse-ok', 'fetch path parses last_verified_utc value', okMeta.lastVerifiedUtc === '2026-02-14T14:00:00Z', 'lastVerifiedUtc=2026-02-14T14:00:00Z', `lastVerifiedUtc=${okMeta.lastVerifiedUtc}`)

context.fetch = async () => ({ ok: true, status: 200, text: async () => '# no key\n' })
t.setCache({ fetchedAt: 0, lastVerifiedUtc: 'x' })
const parseMissMeta = await t.fetchSSOTMeta()
push('fetch-parse-miss-null', 'parse miss returns explicit null (no fallback time)', parseMissMeta.lastVerifiedUtc === null, 'lastVerifiedUtc=null', `lastVerifiedUtc=${String(parseMissMeta.lastVerifiedUtc)}`)

context.fetch = async () => { throw new Error('forced') }
t.setCache({ fetchedAt: 0, lastVerifiedUtc: 'x' })
const failMeta = await t.fetchSSOTMeta()
push('fetch-fail-null', 'fetch fail returns explicit null (unknown path)', failMeta.lastVerifiedUtc === null, 'lastVerifiedUtc=null', `lastVerifiedUtc=${String(failMeta.lastVerifiedUtc)}`)

let fetchCalls = 0
context.fetch = async () => {
  fetchCalls += 1
  return { ok: true, status: 200, text: async () => '- last_verified_utc: 2026-02-14T14:00:00Z\n' }
}
t.setCache({ fetchedAt: 0, lastVerifiedUtc: null })
await t.fetchSSOTMeta()
await t.fetchSSOTMeta()
push('cache-ttl', 'cache TTL avoids second fetch within window', fetchCalls === 1, 'fetchCalls=1', `fetchCalls=${fetchCalls}`)

const sample = 'see https://example.com/task-foo and task-1771079981830-8x3kfxpz5'
const urlId = 'task-foo'
const urlStart = sample.indexOf(urlId)
const urlEnd = urlStart + urlId.length
const plainId = 'task-1771079981830-8x3kfxpz5'
const plainStart = sample.indexOf(plainId)
const plainEnd = plainStart + plainId.length
const urlDetected = t.isTaskTokenInsideUrl(sample, urlStart, urlEnd)
const plainDetected = t.isTaskTokenInsideUrl(sample, plainStart, plainEnd)
push('url-guard-url-token', 'url-embedded token detected as inside URL', urlDetected === true, 'true', String(urlDetected))
push('url-guard-plain-token', 'plain token not detected as URL segment', plainDetected === false, 'false', String(plainDetected))

const noFixedFallbackInSource = !src.includes('SSOT_LAST_VERIFIED_FALLBACK_UTC')
push('no-fixed-fallback-symbol', 'fixed fallback timestamp symbol absent from source', noFixedFallbackInSource, 'absent', noFixedFallbackInSource ? 'absent' : 'present')

const failCount = checks.filter(c => !c.pass).length
const result = {
  harness: 'ssot-indicator-regression-harness',
  dashboardPath,
  command: 'npm run test:ssot-indicator:regression',
  summary: {
    caseCount: checks.length,
    passCount: checks.length - failCount,
    failCount,
    status: failCount === 0 ? 'PASS' : 'FAIL',
  },
  checks,
}

console.log('SSOT_INDICATOR_REGRESSION_HARNESS_RESULT')
console.log(JSON.stringify(result, null, 2))

if (failCount > 0) process.exit(1)
