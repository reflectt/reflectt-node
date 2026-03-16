// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Sentry Integration
 *
 * Initializes Sentry error tracking for reflectt-node.
 * Only activates when SENTRY_DSN environment variable is set.
 *
 * Setup:
 *   1. Create a Sentry project at sentry.io
 *   2. Set SENTRY_DSN env var to the project's DSN
 *   3. Optionally set SENTRY_ENVIRONMENT (defaults to 'production')
 *   4. Optionally set SENTRY_CLIENT_SECRET for webhook signature verification
 */

import * as Sentry from '@sentry/node'

let initialized = false

export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    console.log('[Sentry] SENTRY_DSN not set — error tracking disabled')
    return false
  }

  if (initialized) return true

  try {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || 'production',
      // Only send errors in non-test mode
      enabled: process.env.REFLECTT_TEST_MODE !== 'true',
      // Sample rate for performance monitoring (0 = disabled, we only want errors)
      tracesSampleRate: 0,
      // Attach server name for multi-host identification
      serverName: process.env.HOSTNAME || undefined,
      beforeSend(event) {
        // Strip any sensitive env vars from breadcrumbs
        if (event.breadcrumbs) {
          event.breadcrumbs = event.breadcrumbs.map(b => {
            if (b.data && typeof b.data === 'object') {
              const data = { ...b.data }
              delete data.SENTRY_DSN
              delete data.SENTRY_CLIENT_SECRET
              return { ...b, data }
            }
            return b
          })
        }
        return event
      },
    })

    initialized = true
    console.log('[Sentry] Error tracking initialized')
    return true
  } catch (err) {
    console.error('[Sentry] Failed to initialize:', err)
    return false
  }
}

/**
 * Capture an exception and send to Sentry.
 * No-op if Sentry is not initialized.
 */
export function captureException(error: Error | unknown, context?: Record<string, unknown>): void {
  if (!initialized) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

/**
 * Capture a message and send to Sentry.
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!initialized) return
  Sentry.captureMessage(message, level)
}

/**
 * Flush pending events before shutdown.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return
  await Sentry.flush(timeoutMs)
}

export { Sentry }
