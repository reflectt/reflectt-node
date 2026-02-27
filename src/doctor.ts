// SPDX-License-Identifier: Apache-2.0
// Doctor CLI support — collect onboarding diagnostics via HTTP endpoints.

// Node's fetch typings don't consistently expose RequestInfo, so keep this narrow.
export type DoctorFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export type DoctorSectionResult = {
  ok: boolean
  status?: number
  ms?: number
  error?: string
  data?: any
}

export type DoctorReport = {
  baseUrl: string
  timestamp: number
  overall: 'pass' | 'warn' | 'fail'
  ok: boolean
  sections: {
    health: DoctorSectionResult
    system: DoctorSectionResult
    execution: DoctorSectionResult
    policy: DoctorSectionResult
    teamDoctor: DoctorSectionResult
    preflight: DoctorSectionResult
  }
  hints: string[]
}

async function getJson(fetchFn: DoctorFetch, baseUrl: string, path: string, timeoutMs: number): Promise<DoctorSectionResult> {
  const started = Date.now()
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    const ms = Date.now() - started
    const json: any = await res.json().catch(() => null)

    if (!res.ok) {
      const errMsg = (json && (json.error || json.message))
        ? String(json.error || json.message)
        : `HTTP ${res.status}`

      return {
        ok: false,
        status: res.status,
        ms,
        error: errMsg,
        data: json,
      }
    }

    return { ok: true, status: res.status, ms, data: json }
  } catch (err: any) {
    const ms = Date.now() - started
    return { ok: false, ms, error: err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(err?.message || err) }
  } finally {
    clearTimeout(t)
  }
}

export async function collectDoctorReport(input: {
  baseUrl: string
  timeoutMs?: number
  fetchFn?: DoctorFetch
}): Promise<DoctorReport> {
  const baseUrl = input.baseUrl.replace(/\/+$/, '')
  const timeoutMs = input.timeoutMs ?? 4000
  const fetchFn = input.fetchFn ?? fetch

  const [health, system, execution, policy, teamDoctor, preflight] = await Promise.all([
    getJson(fetchFn, baseUrl, '/health', timeoutMs),
    getJson(fetchFn, baseUrl, '/health/system', timeoutMs),
    getJson(fetchFn, baseUrl, '/execution-health', timeoutMs),
    getJson(fetchFn, baseUrl, '/policy', timeoutMs),
    getJson(fetchFn, baseUrl, '/health/team/doctor', timeoutMs),
    getJson(fetchFn, baseUrl, '/preflight', timeoutMs),
  ])

  const sections = { health, system, execution, policy, teamDoctor, preflight }

  const teamOverall = teamDoctor.ok ? (teamDoctor.data?.overall as 'pass' | 'warn' | 'fail' | undefined) : undefined
  const hardFail = Object.values(sections).some(s => !s.ok) || teamOverall === 'fail'
  const hasWarn = !hardFail && teamOverall === 'warn'

  const overall: DoctorReport['overall'] = hardFail ? 'fail' : hasWarn ? 'warn' : 'pass'
  const ok = overall !== 'fail'

  const hints: string[] = []
  if (!health.ok) hints.push('Server not reachable: ensure reflectt-node is running (try `reflectt start`), and check host/port in ~/.reflectt/config.json')
  if (teamDoctor.ok && teamOverall === 'fail') hints.push('Team doctor reports failures — fix the first failing check and re-run `reflectt doctor`')
  if (teamDoctor.ok && teamOverall === 'warn') hints.push('Team doctor reports warnings — fix warnings to improve reliability and re-run `reflectt doctor`')
  if (execution.ok && execution.data?.sweeper?.running === false) hints.push('Execution sweeper is not running — validating queue may not be enforced')
  if (preflight.ok && preflight.data?.allPassed === false) hints.push('Preflight checks failing — run `curl -s /preflight | jq` and fix failing checks before onboarding users')

  return {
    baseUrl,
    timestamp: Date.now(),
    overall,
    ok,
    sections,
    hints,
  }
}

export function formatDoctorHuman(report: DoctorReport): string {
  const lines: string[] = []
  const label = report.overall === 'pass' ? 'PASS' : report.overall === 'warn' ? 'WARN' : 'FAIL'
  lines.push(`reflectt doctor — ${label}`)
  lines.push(`baseUrl: ${report.baseUrl}`)
  lines.push(`timestamp: ${new Date(report.timestamp).toISOString()}`)
  lines.push('')

  function section(name: keyof DoctorReport['sections'], title: string, pick?: (data: any) => string) {
    const s = report.sections[name]
    const head = `${s.ok ? '✅' : '❌'} ${title}${s.status ? ` (HTTP ${s.status})` : ''}${typeof s.ms === 'number' ? ` — ${s.ms}ms` : ''}`
    lines.push(head)
    if (!s.ok) {
      if (s.error) lines.push(`   error: ${s.error}`)
      return
    }
    try {
      const detail = pick ? pick(s.data) : ''
      if (detail) lines.push(`   ${detail}`)
    } catch {
      // ignore formatting errors
    }
  }

  section('health', '/health', (d) => `status=${d?.status ?? 'unknown'} version=${d?.version ?? 'n/a'} commit=${d?.commit ?? 'n/a'}`)
  section('system', '/health/system', (d) => {
    const uptimeH = d?.uptimeHours ?? d?.uptime_hours
    const req = d?.requestCount ?? d?.request_count
    const errRate = d?.errorRate ?? d?.error_rate
    return `uptimeHours=${uptimeH ?? 'n/a'} requestCount=${req ?? 'n/a'} errorRate=${errRate ?? 'n/a'}%`
  })
  section('execution', '/execution-health', (d) => {
    const running = d?.sweeper?.running
    const last = d?.sweeper?.lastSweepAt
    const v = Array.isArray(d?.current?.violations) ? d.current.violations.length : 'n/a'
    return `sweeper.running=${String(running)} lastSweepAt=${last ?? 'n/a'} violations=${v}`
  })
  section('policy', '/policy', (d) => {
    const qh = d?.policy?.quietHours
    const enabled = qh?.enabled
    const window = (qh && typeof qh.startHour === 'number' && typeof qh.endHour === 'number') ? `${qh.startHour}-${qh.endHour}` : 'n/a'
    return `quietHours.enabled=${String(enabled)} window=${window}`
  })
  section('teamDoctor', '/health/team/doctor', (d) => {
    const overall = d?.overall
    const fails = Array.isArray(d?.checks) ? d.checks.filter((c: any) => c?.status === 'fail').map((c: any) => c?.name).filter(Boolean) : []
    const warns = Array.isArray(d?.checks) ? d.checks.filter((c: any) => c?.status === 'warn').map((c: any) => c?.name).filter(Boolean) : []
    const parts = [`overall=${overall ?? 'n/a'}`]
    if (fails.length) parts.push(`fails=${fails.join(',')}`)
    if (warns.length) parts.push(`warns=${warns.join(',')}`)
    return parts.join(' ')
  })
  section('preflight', '/preflight', (d) => {
    // /preflight returns { success, allPassed, results[] }
    const allPassed = d?.allPassed
    const results = Array.isArray(d?.results) ? d.results : []
    const failing = results.filter((r: any) => r && r.passed === false)
    const failCount = failing.length
    const failIds = failing.map((r: any) => r?.check?.id).filter(Boolean)
    const parts = [`allPassed=${String(allPassed)}`]
    parts.push(`failCount=${failCount}`)
    if (failIds.length) parts.push(`fails=${failIds.join(',')}`)
    return parts.join(' ')
  })

  if (report.hints.length) {
    lines.push('')
    lines.push('Hints:')
    for (const h of report.hints) lines.push(`- ${h}`)
  }

  lines.push('')
  lines.push('Copy/paste support bundle:')
  lines.push(`curl -s ${report.baseUrl}/health | jq`)
  lines.push(`curl -s ${report.baseUrl}/health/system | jq`)
  lines.push(`curl -s ${report.baseUrl}/execution-health | jq`)
  lines.push(`curl -s ${report.baseUrl}/policy | jq`)
  lines.push(`curl -s ${report.baseUrl}/health/team/doctor | jq`)
  lines.push(`curl -s ${report.baseUrl}/preflight | jq`)

  return lines.join('\n')
}
