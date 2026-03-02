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
  freshInstall?: boolean
  /** Server running but unconfigured (no model key) */
  setupMode?: boolean
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

  // Extract team doctor check details for setup-aware logic
  const teamChecks: Array<{ name: string; status: string; message?: string; fix?: string }> =
    (teamDoctor.ok && Array.isArray(teamDoctor.data?.checks)) ? teamDoctor.data.checks : []
  const modelAuthCheck = teamChecks.find(c => c.name === 'model_auth')
  const modelAuthFail = modelAuthCheck?.status === 'fail'

  // Checks that are optional — their failure should not cause overall FAIL
  const OPTIONAL_CHECKS = new Set(['github-identity', 'openclaw_bootstrap'])

  // For overall status: ignore optional-only failures in team doctor
  const teamFailChecks = teamChecks.filter(c => c.status === 'fail')
  const teamHasRequiredFail = teamFailChecks.some(c => !OPTIONAL_CHECKS.has(c.name))
  const teamHasOnlyOptionalFail = teamFailChecks.length > 0 && !teamHasRequiredFail

  const hardFail = Object.values(sections).some(s => !s.ok) ||
    (teamOverall === 'fail' && teamHasRequiredFail)
  const hasWarn = !hardFail && (teamOverall === 'warn' || teamHasOnlyOptionalFail)

  const overall: DoctorReport['overall'] = hardFail ? 'fail' : hasWarn ? 'warn' : 'pass'
  const ok = overall !== 'fail'

  // Detect fresh-install mode: server not running at all
  const allDown = Object.values(sections).every(s => !s.ok)
  const freshInstall = allDown && health.error && /ECONNREFUSED|ENOTFOUND|timeout/i.test(health.error)

  // Detect setup mode: server running but no model key (fresh config)
  const setupMode = !freshInstall && health.ok && modelAuthFail

  const hints: string[] = []
  if (freshInstall) {
    hints.push('Server is not running. Start it with: reflectt start')
    hints.push('First time? Run: reflectt init && reflectt start')
    hints.push('Connect to cloud: https://app.reflectt.ai')
    hints.push('Dashboard: http://127.0.0.1:4445/dashboard (after starting)')
  } else if (setupMode) {
    hints.push('Your node is running! Next: add a model key to start using AI features.')
    hints.push('')
    hints.push('Required:')
    hints.push('  export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY=sk-...')
    hints.push('  Then restart: reflectt restart')
    hints.push('')
    hints.push('Optional (not required to get started):')
    hints.push('  GITHUB_TOKEN — enables PR review features (https://github.com/settings/tokens)')
    hints.push('  reflectt host connect — enables agent chat via Reflectt Cloud')
    hints.push('')
    hints.push('Dashboard: http://127.0.0.1:4445/dashboard')
  } else {
    if (!health.ok) hints.push('Server not reachable: ensure reflectt-node is running (try `reflectt start`), and check host/port in ~/.reflectt/config.json')
    if (teamDoctor.ok && teamHasRequiredFail) hints.push('Team doctor reports failures — fix the first failing check and re-run `reflectt doctor`')
    if (teamDoctor.ok && (teamOverall === 'warn' || teamHasOnlyOptionalFail)) hints.push('Team doctor reports warnings — these are optional checks that won\'t block core functionality')
    if (execution.ok && execution.data?.sweeper?.running === false) hints.push('Execution sweeper is not running — validating queue may not be enforced')
    if (preflight.ok && preflight.data?.allPassed === false) hints.push('Preflight checks failing — run `curl -s /preflight | jq` and fix failing checks before onboarding users')
  }

  return {
    baseUrl,
    timestamp: Date.now(),
    overall,
    ok,
    freshInstall: freshInstall || false,
    setupMode: setupMode || false,
    sections,
    hints,
  }
}

export function formatDoctorHuman(report: DoctorReport): string {
  const lines: string[] = []

  if (report.freshInstall) {
    lines.push('reflectt doctor — SERVER NOT RUNNING')
    lines.push('')
    lines.push('Looks like this is a fresh install or the server isn\'t started yet.')
    lines.push('')
    lines.push('Quick start:')
    lines.push('  reflectt init          # Set up config and data directory')
    lines.push('  reflectt start         # Start the server')
    lines.push('  reflectt doctor        # Re-run diagnostics')
    lines.push('')
    lines.push('Connect to cloud:')
    lines.push('  https://app.reflectt.ai')
    lines.push('')
    lines.push('Once running, your dashboard will be at:')
    lines.push(`  ${report.baseUrl}/dashboard`)
    return lines.join('\n')
  }

  if (report.setupMode) {
    lines.push('reflectt doctor — SETUP')
    lines.push('')
    lines.push('✅ Your node is running! Here\'s what to do next:')
    lines.push('')
    lines.push('1. Add a model API key (required for AI features):')
    lines.push('   export ANTHROPIC_API_KEY=sk-ant-...   # Anthropic Claude')
    lines.push('   # or: export OPENAI_API_KEY=sk-...    # OpenAI')
    lines.push('   # or: export GOOGLE_API_KEY=...       # Google Gemini')
    lines.push('')
    lines.push('2. Restart to pick up the key:')
    lines.push('   reflectt restart')
    lines.push('')
    lines.push('3. Optional (not needed to get started):')
    lines.push('   GITHUB_TOKEN  — PR review features (https://github.com/settings/tokens)')
    lines.push('   reflectt host connect — agent chat via Reflectt Cloud')
    lines.push('')
    lines.push(`Dashboard: ${report.baseUrl}/dashboard`)
    lines.push('')
    lines.push('Re-run after adding your key:')
    lines.push('  reflectt doctor')
    return lines.join('\n')
  }

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
    const OPTIONAL = new Set(['github-identity', 'openclaw_bootstrap'])
    const checks: any[] = Array.isArray(d?.checks) ? d.checks : []
    const fails = checks.filter((c: any) => c?.status === 'fail').map((c: any) => c?.name).filter(Boolean)
    const warns = checks.filter((c: any) => c?.status === 'warn').map((c: any) => c?.name).filter(Boolean)
    const requiredFails = fails.filter(n => !OPTIONAL.has(n))
    const optionalFails = fails.filter(n => OPTIONAL.has(n))
    const parts = [`overall=${overall ?? 'n/a'}`]
    if (requiredFails.length) parts.push(`fails=${requiredFails.join(',')}`)
    if (optionalFails.length) parts.push(`optional=${optionalFails.join(',')}`)
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
