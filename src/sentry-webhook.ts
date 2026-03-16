// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Sentry Webhook → #ops Bridge
 *
 * Parses Sentry webhook payloads (issue alerts, metric alerts, etc.)
 * and formats them as chat messages for the #ops channel.
 *
 * Sentry webhook payload docs:
 * https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
 */

// ── Types ──────────────────────────────────────────────────────────────────

interface SentryIssueData {
  id?: string
  title?: string
  culprit?: string
  metadata?: {
    type?: string
    value?: string
    filename?: string
    function?: string
  }
  count?: string | number
  userCount?: number
  firstSeen?: string
  shortId?: string
  project?: { slug?: string; name?: string; id?: string }
  level?: string
  status?: string
}

interface SentryActor {
  type?: string
  id?: string
  name?: string
}

interface SentryWebhookPayload {
  action?: string           // 'triggered' | 'resolved' | 'assigned' | 'archived' | 'unresolved'
  data?: {
    issue?: SentryIssueData
    event?: Record<string, unknown>
    triggered_rule?: string
    metric_alert?: {
      id?: string | number
      title?: string
      alert_rule?: { id?: number; name?: string }
      status?: string
    }
  }
  actor?: SentryActor
  installation?: { uuid?: string }
}

// ── Severity Emoji ─────────────────────────────────────────────────────────

function severityEmoji(level?: string): string {
  switch (level) {
    case 'fatal': return '💀'
    case 'error': return '🔴'
    case 'warning': return '🟡'
    case 'info': return 'ℹ️'
    default: return '🔴'
  }
}

// ── Formatters ─────────────────────────────────────────────────────────────

/**
 * Format a Sentry webhook payload as a human-readable chat message.
 * Returns null if the payload isn't actionable (e.g. installation hooks).
 */
export function formatSentryAlert(payload: SentryWebhookPayload): string | null {
  const action = payload.action

  // Issue alert (most common)
  if (payload.data?.issue) {
    return formatIssueAlert(action, payload.data.issue, payload.data.triggered_rule)
  }

  // Metric alert
  if (payload.data?.metric_alert) {
    const ma = payload.data.metric_alert
    const ruleName = ma.alert_rule?.name ?? ma.title ?? 'Unknown metric alert'
    const status = ma.status ?? action ?? 'triggered'
    return `📊 **Metric Alert** — ${ruleName}\nStatus: ${status}`
  }

  // Unrecognized / installation / comment hooks — skip
  return null
}

function formatIssueAlert(
  action: string | undefined,
  issue: SentryIssueData,
  triggeredRule?: string,
): string {
  const emoji = severityEmoji(issue.level)
  const title = issue.title ?? 'Unknown error'
  const project = issue.project?.slug ?? issue.project?.name ?? 'unknown'
  const shortId = issue.shortId ?? issue.id ?? '?'
  const count = issue.count ?? '?'

  // Build file/function hint
  const file = issue.metadata?.filename ?? issue.culprit ?? null
  const fn = issue.metadata?.function ?? null
  const location = file ? (fn ? `${file} in ${fn}` : file) : null

  // Action verb
  const verb = action === 'resolved' ? '✅ Resolved'
    : action === 'assigned' ? '👤 Assigned'
    : action === 'archived' ? '📦 Archived'
    : action === 'unresolved' ? '🔄 Reopened'
    : `${emoji} Triggered`

  const lines: string[] = [
    `${verb}: **${title}**`,
    `Project: ${project} · ${shortId} · ${count} event(s)`,
  ]

  if (location) {
    lines.push(`📁 ${location}`)
  }

  if (triggeredRule) {
    lines.push(`Rule: ${triggeredRule}`)
  }

  // Sentry issue URL (conventional format)
  if (issue.project?.slug && issue.id) {
    lines.push(`🔗 https://sentry.io/issues/${issue.id}/`)
  }

  return lines.join('\n')
}

/**
 * Verify Sentry webhook signature (HMAC-SHA256).
 * Returns true if valid or if no secret is configured (permissive mode).
 */
export function verifySentrySignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  clientSecret: string | undefined,
): boolean {
  // If no secret configured, accept all (permissive mode for initial setup)
  if (!clientSecret) return true
  if (!signatureHeader) return false

  try {
    const crypto = require('crypto') as typeof import('crypto')
    const expected = crypto
      .createHmac('sha256', clientSecret)
      .update(rawBody)
      .digest('hex')
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    )
  } catch {
    return false
  }
}
