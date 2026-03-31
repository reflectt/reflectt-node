// SPDX-License-Identifier: Apache-2.0
// Capability readiness contract — per-capability status with dependency checks.
// Powers GET /capabilities/readiness and cloud UI badges.

export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready' | 'unknown'

export interface CapabilityReadiness {
  capability: string
  status: ReadinessStatus
  last_success_at: number | null
  last_error: string | null
  dependencies: DependencyCheck[]
  hint: string | null
}

export interface DependencyCheck {
  name: string
  status: 'ok' | 'missing' | 'error'
  detail?: string
}

export interface ReadinessReport {
  overall: ReadinessStatus
  capabilities: CapabilityReadiness[]
  checked_at: number
}

// ── Browser ──────────────────────────────────────────────────────────────────

function checkBrowserReadiness(): CapabilityReadiness {
  const deps: DependencyCheck[] = []
  const errors: string[] = []

  // Check if Stagehand package is available
  try {
    require.resolve('@browserbasehq/stagehand')
    deps.push({ name: 'stagehand_package', status: 'ok' })
  } catch {
    deps.push({ name: 'stagehand_package', status: 'missing', detail: '@browserbasehq/stagehand not installed' })
    errors.push('Stagehand package not installed')
  }

  // Check for ANTHROPIC_API_KEY or OPENAI_API_KEY (required by Stagehand)
  const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY)
  const hasOpenAIKey = !!(process.env.OPENAI_API_KEY)
  if (hasAnthropicKey || hasOpenAIKey) {
    deps.push({ name: 'llm_api_key', status: 'ok', detail: hasAnthropicKey ? 'ANTHROPIC_API_KEY set' : 'OPENAI_API_KEY set' })
  } else {
    deps.push({ name: 'llm_api_key', status: 'missing', detail: 'ANTHROPIC_API_KEY or OPENAI_API_KEY required for Stagehand' })
    errors.push('LLM API key missing (ANTHROPIC_API_KEY or OPENAI_API_KEY)')
  }

  // Check BROWSERBASE_API_KEY (optional — cloud browser)
  const hasBrowserbaseKey = !!(process.env.BROWSERBASE_API_KEY)
  deps.push({
    name: 'browserbase_api_key',
    status: hasBrowserbaseKey ? 'ok' : 'missing',
    detail: hasBrowserbaseKey ? 'BROWSERBASE_API_KEY set' : 'Optional — uses local browser if absent',
  })

  const status: ReadinessStatus = errors.length === 0 ? 'ready'
    : errors.some(e => e.includes('package')) ? 'not_ready'
    : 'degraded'

  return {
    capability: 'browser',
    status,
    last_success_at: null,
    last_error: errors.length > 0 ? errors[0] : null,
    dependencies: deps,
    hint: status !== 'ready'
      ? 'Install @browserbasehq/stagehand and set ANTHROPIC_API_KEY to enable browser automation.'
      : null,
  }
}

// ── Email ─────────────────────────────────────────────────────────────────────

function checkEmailReadiness(cloudConnected: boolean, cloudUrl: string, webhooks: Array<{ provider: string; active: boolean }>): CapabilityReadiness {
  const deps: DependencyCheck[] = []
  const errors: string[] = []

  // Cloud connection required for relay
  deps.push({
    name: 'cloud_connection',
    status: cloudConnected ? 'ok' : 'missing',
    detail: cloudConnected ? `Connected to ${cloudUrl}` : 'Not enrolled with Reflectt Cloud',
  })
  if (!cloudConnected) errors.push('Cloud connection required for email relay')

  // Check inbound webhook route (resend)
  const resendWebhook = webhooks.find(w => w.provider === 'resend' && w.active)
  deps.push({
    name: 'inbound_webhook',
    status: resendWebhook ? 'ok' : 'missing',
    detail: resendWebhook ? 'Resend inbound webhook active' : 'No active Resend inbound webhook configured',
  })
  if (!resendWebhook) errors.push('Resend inbound webhook not configured — replies will not be received')

  const status: ReadinessStatus = errors.length === 0 ? 'ready'
    : !cloudConnected ? 'not_ready'
    : 'degraded'

  return {
    capability: 'email',
    status,
    last_success_at: null,
    last_error: errors.length > 0 ? errors[0] : null,
    dependencies: deps,
    hint: status !== 'ready'
      ? !cloudConnected
        ? 'Enroll this host with Reflectt Cloud to enable email relay.'
        : 'Configure a Resend inbound webhook via POST /provisioning/webhooks to receive replies.'
      : null,
  }
}

// ── SMS ───────────────────────────────────────────────────────────────────────

function checkSmsReadiness(cloudConnected: boolean, cloudUrl: string, webhooks: Array<{ provider: string; active: boolean }>): CapabilityReadiness {
  const deps: DependencyCheck[] = []
  const errors: string[] = []

  deps.push({
    name: 'cloud_connection',
    status: cloudConnected ? 'ok' : 'missing',
    detail: cloudConnected ? `Connected to ${cloudUrl}` : 'Not enrolled with Reflectt Cloud',
  })
  if (!cloudConnected) errors.push('Cloud connection required for SMS relay')

  // Check for Twilio inbound webhook route
  const twilioWebhook = webhooks.find(w => (w.provider === 'twilio' || w.provider === 'sms') && w.active)
  deps.push({
    name: 'inbound_webhook',
    status: twilioWebhook ? 'ok' : 'missing',
    detail: twilioWebhook ? 'SMS inbound webhook active' : 'No active SMS inbound webhook configured',
  })
  if (!twilioWebhook) errors.push('SMS inbound webhook not configured — replies will not be received')

  const status: ReadinessStatus = errors.length === 0 ? 'ready'
    : !cloudConnected ? 'not_ready'
    : 'degraded'

  return {
    capability: 'sms',
    status,
    last_success_at: null,
    last_error: errors.length > 0 ? errors[0] : null,
    dependencies: deps,
    hint: status !== 'ready'
      ? !cloudConnected
        ? 'Enroll this host with Reflectt Cloud to enable SMS relay.'
        : 'Configure a Twilio inbound webhook via POST /provisioning/webhooks to receive SMS replies.'
      : null,
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────────

function checkCalendarReadiness(): CapabilityReadiness {
  const deps: DependencyCheck[] = []
  const errors: string[] = []

  // Calendar is always locally available (no external deps required for basic scheduling)
  deps.push({ name: 'calendar_module', status: 'ok', detail: 'Local calendar storage active' })

  // Optional: Google Calendar sync env var
  const hasGoogleCal = !!(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET)
  deps.push({
    name: 'google_calendar_sync',
    status: hasGoogleCal ? 'ok' : 'missing',
    detail: hasGoogleCal
      ? 'Google Calendar credentials configured'
      : 'Optional — GOOGLE_CALENDAR_CLIENT_ID + GOOGLE_CALENDAR_CLIENT_SECRET for sync',
  })

  // iCal import is always available
  deps.push({ name: 'ical_import', status: 'ok', detail: 'iCal import/export available' })

  return {
    capability: 'calendar',
    status: errors.length === 0 ? 'ready' : 'degraded',
    last_success_at: null,
    last_error: errors.length > 0 ? errors[0] : null,
    dependencies: deps,
    hint: null,
  }
}

// ── Main readiness check ──────────────────────────────────────────────────────

export function getCapabilityReadiness(opts: {
  cloudConnected: boolean
  cloudUrl: string
  webhooks: Array<{ provider: string; active: boolean }>
}): ReadinessReport {
  const capabilities = [
    checkBrowserReadiness(),
    checkEmailReadiness(opts.cloudConnected, opts.cloudUrl, opts.webhooks),
    checkSmsReadiness(opts.cloudConnected, opts.cloudUrl, opts.webhooks),
    checkCalendarReadiness(),
  ]

  // Overall: ready if all ready, degraded if any degraded, not_ready if any not_ready
  const overall: ReadinessStatus =
    capabilities.some(c => c.status === 'not_ready') ? 'not_ready'
    : capabilities.some(c => c.status === 'degraded') ? 'degraded'
    : capabilities.every(c => c.status === 'ready') ? 'ready'
    : 'unknown'

  return { overall, capabilities, checked_at: Date.now() }
}
