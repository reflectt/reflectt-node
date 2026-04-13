// SPDX-License-Identifier: Apache-2.0
// Capability readiness contract — per-capability status with dependency checks.
// Powers GET /capabilities/readiness and cloud UI badges.

import { existsSync } from 'node:fs'

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

function checkBrowserReadiness(cloudConnected: boolean): CapabilityReadiness {
  const deps: DependencyCheck[] = []

  if (cloudConnected) {
    // Managed hosts use the cloud browser relay (/browser/managed/sessions →
    // /api/hosts/:hostId/relay/browser/sessions). The cloud holds the LLM keys;
    // the node just proxies. No local Stagehand or API key required.
    deps.push({
      name: 'managed_relay',
      status: 'ok',
      detail: 'Cloud browser relay available via /browser/managed/sessions',
    })

    // Local Stagehand runtime (optional — useful for debugging/fallback).
    const stagehandPath = new URL('../node_modules/@browserbasehq/stagehand/package.json', import.meta.url)
    const stagehandInstalled = (() => { try { return existsSync(stagehandPath) } catch { return false } })()
    deps.push({
      name: 'local_stagehand',
      status: stagehandInstalled ? 'ok' : 'missing',
      detail: stagehandInstalled
        ? 'Local Stagehand runtime available (direct sessions via /browser/sessions)'
        : 'Optional — local Stagehand not installed; use /browser/managed/sessions instead',
    })

    return {
      capability: 'browser',
      status: 'ready',
      last_success_at: null,
      last_error: null,
      dependencies: deps,
      hint: null,
    }
  }

  // Standalone (not cloud-connected) — must use local Stagehand with a local LLM key.
  const errors: string[] = []

  const stagehandPath = new URL('../node_modules/@browserbasehq/stagehand/package.json', import.meta.url)
  const stagehandInstalled = (() => { try { return existsSync(stagehandPath) } catch { return false } })()
  if (stagehandInstalled) {
    deps.push({ name: 'stagehand_package', status: 'ok' })
  } else {
    deps.push({ name: 'stagehand_package', status: 'missing', detail: '@browserbasehq/stagehand not installed' })
    errors.push('Stagehand package not installed')
  }

  const hasAnthropicKey = !!(process.env.ANTHROPIC_API_KEY)
  const hasOpenAIKey = !!(process.env.OPENAI_API_KEY)
  if (hasAnthropicKey || hasOpenAIKey) {
    deps.push({ name: 'llm_api_key', status: 'ok', detail: hasAnthropicKey ? 'ANTHROPIC_API_KEY set' : 'OPENAI_API_KEY set' })
  } else {
    deps.push({ name: 'llm_api_key', status: 'missing', detail: 'ANTHROPIC_API_KEY or OPENAI_API_KEY required for local Stagehand AI operations' })
    errors.push('LLM API key missing (ANTHROPIC_API_KEY or OPENAI_API_KEY)')
  }

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
      ? errors.some(e => e.includes('package'))
        ? 'Install @browserbasehq/stagehand and set ANTHROPIC_API_KEY, or enroll this host with Reflectt Cloud to use the managed browser relay.'
        : 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY for local AI extraction, or enroll this host with Reflectt Cloud to use the managed browser relay.'
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

// ── Models ────────────────────────────────────────────────────────────────────

const MODEL_ENV_KEYS: Array<{ key: string; label: string; path: 'api-key' | 'subscription' }> = [
  { key: 'ANTHROPIC_API_KEY', label: 'Anthropic', path: 'api-key' },
  { key: 'OPENAI_API_KEY', label: 'OpenAI', path: 'api-key' },
  { key: 'GOOGLE_AI_API_KEY', label: 'Google AI', path: 'api-key' },
  { key: 'MISTRAL_API_KEY', label: 'Mistral', path: 'api-key' },
  { key: 'GROQ_API_KEY', label: 'Groq', path: 'api-key' },
  { key: 'MINIMAX_API_KEY', label: 'MiniMax', path: 'api-key' },
]

/**
 * Check which model providers are available on this node.
 * Reports API keys set in the node environment (distinct from team_secrets in the cloud).
 * Subscription-backed inference (Claude Code sampling) is reported separately
 * via the `subscription_providers` dependency when a sampling session is active.
 */
export function checkModelsReadiness(opts: { samplingProviders?: string[] } = {}): CapabilityReadiness {
  const deps: DependencyCheck[] = []

  const presentKeys = MODEL_ENV_KEYS.filter(m => !!process.env[m.key])
  const missingKeys = MODEL_ENV_KEYS.filter(m => !process.env[m.key])

  // Report each present API key as a dependency
  for (const m of presentKeys) {
    deps.push({ name: m.key, status: 'ok', detail: `${m.label} API key set` })
  }
  for (const m of missingKeys) {
    deps.push({ name: m.key, status: 'missing', detail: `${m.label} API key not set` })
  }

  // Report subscription-backed providers (e.g. Claude Code sampling session active)
  const subscriptionProviders = opts.samplingProviders ?? []
  if (subscriptionProviders.length > 0) {
    deps.push({ name: 'subscription_providers', status: 'ok', detail: subscriptionProviders.join(', ') })
  } else {
    deps.push({ name: 'subscription_providers', status: 'missing', detail: 'No subscription-backed providers active (Claude Code or OpenClaw)' })
  }

  const hasAny = presentKeys.length > 0 || subscriptionProviders.length > 0
  const status: ReadinessStatus = hasAny ? 'ready' : 'not_ready'

  return {
    capability: 'models',
    status,
    last_success_at: null,
    last_error: hasAny ? null : 'No model providers configured on this node',
    dependencies: deps,
    hint: hasAny ? null : 'Set a model API key (e.g. ANTHROPIC_API_KEY) on this node, or connect Claude Code with a subscription.',
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

function checkSearchReadiness(): CapabilityReadiness {
  const deps: DependencyCheck[] = []

  const hasSerper = !!(process.env.SERPER_API_KEY)
  const hasBrave = !!(process.env.BRAVE_SEARCH_API_KEY)
  const hasTavily = !!(process.env.TAVILY_API_KEY)
  const hasAny = hasSerper || hasBrave || hasTavily

  const activeProvider = hasSerper ? 'SERPER_API_KEY' : hasBrave ? 'BRAVE_SEARCH_API_KEY' : hasTavily ? 'TAVILY_API_KEY' : null
  deps.push({
    name: 'search_api_key',
    status: hasAny ? 'ok' : 'missing',
    detail: hasAny
      ? `${activeProvider} set`
      : 'Set SERPER_API_KEY, BRAVE_SEARCH_API_KEY, or TAVILY_API_KEY to enable web search',
  })

  return {
    capability: 'search',
    status: hasAny ? 'ready' : 'not_ready',
    last_success_at: null,
    last_error: hasAny ? null : 'No search API key configured',
    dependencies: deps,
    hint: hasAny ? null : 'Set SERPER_API_KEY, BRAVE_SEARCH_API_KEY, or TAVILY_API_KEY on this node to enable web search.',
  }
}

// ── Main readiness check ──────────────────────────────────────────────────────

export function getCapabilityReadiness(opts: {
  cloudConnected: boolean
  cloudUrl: string
  webhooks: Array<{ provider: string; active: boolean }>
  samplingProviders?: string[]
}): ReadinessReport {
  const capabilities = [
    checkBrowserReadiness(opts.cloudConnected),
    checkSearchReadiness(),
    checkEmailReadiness(opts.cloudConnected, opts.cloudUrl, opts.webhooks),
    checkSmsReadiness(opts.cloudConnected, opts.cloudUrl, opts.webhooks),
    checkCalendarReadiness(),
    checkModelsReadiness({ samplingProviders: opts.samplingProviders }),
  ]

  // Overall: ready if all ready, degraded if any degraded, not_ready if any not_ready
  const overall: ReadinessStatus =
    capabilities.some(c => c.status === 'not_ready') ? 'not_ready'
    : capabilities.some(c => c.status === 'degraded') ? 'degraded'
    : capabilities.every(c => c.status === 'ready') ? 'ready'
    : 'unknown'

  return { overall, capabilities, checked_at: Date.now() }
}
