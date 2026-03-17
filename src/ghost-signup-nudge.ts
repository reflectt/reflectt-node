// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * Ghost Signup Nudge — activation recovery for users who signed up but never ran the node
 *
 * Ghost signup: signup_completed fired, host_preflight_passed never fired after 2h.
 * These users are the dominant activation gap (8/12 in baseline).
 *
 * This module:
 * 1. Identifies ghost signup candidates from the activation funnel
 * 2. Sends a re-engagement email via the cloud relay (/email/send)
 * 3. Tags the user with ghost_signup_nudge_sent in the activation funnel (idempotent)
 *
 * The cloud provides the user's email address — the node provides the template + sends + tags.
 * Cloud calls POST /activation/ghost-signup-nudge with { userId, email, nudgeTier? }
 *
 * task-1773709288800-lam5hd11b
 */

import { emitActivationEvent, hasCompletedEvent, getUserFunnelState } from './activationEvents.js'

// ── Types ──

export type NudgeTier = '2h' | '24h'

export interface GhostSignupCandidate {
  userId: string
  signupAt: number
  hoursSinceSignup: number
  preflightAttempted: boolean // true if preflight_failed exists (ran but failed)
}

export interface NudgeResult {
  userId: string
  email: string
  tier: NudgeTier
  sent: boolean
  alreadyNudged: boolean
  preflightCompleted: boolean
  error?: string
}

// ── Constants ──

const NUDGE_2H_THRESHOLD_MS = 2 * 60 * 60 * 1000   // 2 hours
const NUDGE_24H_THRESHOLD_MS = 24 * 60 * 60 * 1000  // 24 hours
const SUPPRESS_AFTER_MS = 7 * 24 * 60 * 60 * 1000   // 7 days

// ── Ghost Signup Detection ──

/**
 * Returns all users who signed up but haven't passed preflight yet,
 * filtered by minimum staleness threshold.
 * Cloud uses this to find candidates before calling sendNudge.
 */
export function getGhostSignupCandidates(minAgeMs = NUDGE_2H_THRESHOLD_MS): GhostSignupCandidate[] {
  const now = Date.now()
  const candidates: GhostSignupCandidate[] = []

  // We inspect all users with signup_completed via getUserFunnelState
  // activationEvents doesn't export the full user map, so we use getFunnelSummary
  // and filter client-side. At pre-launch scale this is fine.
  const { funnelByUser } = (() => {
    // Import lazily to avoid circular dependency
    const { getFunnelSummary } = require('./activationEvents.js')
    return getFunnelSummary({ raw: false }) as { funnelByUser: ReturnType<typeof getUserFunnelState>[] }
  })()

  for (const user of funnelByUser) {
    const signupAt = user.events.signup_completed
    if (!signupAt) continue                                      // never signed up
    if (user.events.host_preflight_passed) continue             // already activated
    if (user.events.ghost_signup_nudge_sent) continue           // already nudged
    if (now - signupAt < minAgeMs) continue                     // too recent
    if (now - signupAt > SUPPRESS_AFTER_MS) continue            // too old, suppress

    candidates.push({
      userId: user.userId,
      signupAt,
      hoursSinceSignup: Math.floor((now - signupAt) / (60 * 60 * 1000)),
      preflightAttempted: !!user.events.host_preflight_failed,
    })
  }

  return candidates.sort((a, b) => a.signupAt - b.signupAt)
}

// ── Email Templates ──

function buildNudgeEmail(userId: string, tier: NudgeTier): { subject: string; html: string; text: string } {
  if (tier === '24h') {
    return {
      subject: 'Your AI team is ready — your node isn\'t (yet)',
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; }
  .cmd { background: #0a0010; color: #c4b5fd; padding: 16px 20px; border-radius: 8px; font-family: 'SF Mono', 'Monaco', monospace; font-size: 13px; margin: 20px 0; white-space: pre; }
  .cta { display: inline-block; background: #7c3aed; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
  .sub { color: #6b7280; font-size: 14px; margin-top: 8px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
  p { line-height: 1.6; color: #374151; }
</style></head>
<body>
  <h1>Your AI team is ready — your node isn't (yet)</h1>
  <p>You signed up for Reflectt yesterday. Your team is waiting. Here's all it takes:</p>
  <div class="cmd">npm install -g reflectt-node &amp;&amp; reflectt init &amp;&amp; reflectt start</div>
  <p>Then open your dashboard and click <strong>Canvas</strong>. You'll see your agents as living orbs in a shared room — ready to take on work.</p>
  <a class="cta" href="https://app.reflectt.ai">Connect my node →</a>
  <p class="sub">Already tried and ran into a problem? Run <code>reflectt doctor</code> — it'll tell you exactly what's wrong and how to fix it.</p>
  <p class="sub" style="color:#9ca3af;font-size:12px;">This is a one-time message. You won't hear from us again about this unless you take action.</p>
</body>
</html>`,
      text: `Your AI team is ready — your node isn't (yet)

You signed up for Reflectt yesterday. Your team is waiting. Here's all it takes:

  npm install -g reflectt-node && reflectt init && reflectt start

Then open https://app.reflectt.ai and click Canvas. You'll see your agents as living orbs in a shared room.

Already tried and ran into a problem? Run: reflectt doctor

This is a one-time message.`,
    }
  }

  // 2h tier — in-session, slightly more direct
  return {
    subject: 'Your node isn\'t connected yet — one command to fix it',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; }
  .cmd { background: #0a0010; color: #c4b5fd; padding: 16px 20px; border-radius: 8px; font-family: 'SF Mono', 'Monaco', monospace; font-size: 13px; margin: 20px 0; white-space: pre; }
  .cta { display: inline-block; background: #7c3aed; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 20px 0; }
  .sub { color: #6b7280; font-size: 14px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
  p { line-height: 1.6; color: #374151; }
</style></head>
<body>
  <h1>Your node isn't connected yet</h1>
  <p>Looks like you signed up but haven't started reflectt-node yet. It takes about 2 minutes:</p>
  <div class="cmd">npm install -g reflectt-node &amp;&amp; reflectt init &amp;&amp; reflectt start</div>
  <a class="cta" href="https://app.reflectt.ai">Go to dashboard →</a>
  <p class="sub">Stuck? Run <code>reflectt doctor</code> and it'll tell you exactly what to fix.</p>
</body>
</html>`,
    text: `Your node isn't connected yet

Looks like you signed up but haven't started reflectt-node yet. It takes about 2 minutes:

  npm install -g reflectt-node && reflectt init && reflectt start

Go to: https://app.reflectt.ai

Stuck? Run: reflectt doctor`,
  }
}

// ── Nudge Sender ──

/**
 * Send a ghost signup nudge email for a specific user.
 * Cloud calls this endpoint with the user's email address.
 * - Idempotent: won't send twice to same user (tracked via ghost_signup_nudge_sent event)
 * - Tags user with nudge_cohort metadata for conversion tracking
 */
export async function sendGhostSignupNudge(
  userId: string,
  email: string,
  tier: NudgeTier = '2h',
  emailRelayFn: (opts: {
    from: string; to: string; subject: string; html: string; text: string; tags?: Array<{ name: string; value: string }>;
  }) => Promise<{ success: boolean; error?: string }>,
): Promise<NudgeResult> {
  // Guard: already activated
  if (hasCompletedEvent(userId, 'host_preflight_passed')) {
    return { userId, email, tier, sent: false, alreadyNudged: false, preflightCompleted: true }
  }

  // Guard: already nudged (idempotent)
  if (hasCompletedEvent(userId, 'ghost_signup_nudge_sent')) {
    return { userId, email, tier, sent: false, alreadyNudged: true, preflightCompleted: false }
  }

  const { subject, html, text } = buildNudgeEmail(userId, tier)

  // Send via cloud relay
  const result = await emailRelayFn({
    from: 'Reflectt <hello@reflectt.ai>',
    to: email,
    subject,
    html,
    text,
    tags: [
      { name: 'email_type', value: 'ghost_signup_nudge' },
      { name: 'nudge_tier', value: tier },
      { name: 'user_id', value: userId.slice(0, 64) }, // Resend tag value limit
    ],
  })

  if (!result.success) {
    return { userId, email, tier, sent: false, alreadyNudged: false, preflightCompleted: false, error: result.error }
  }

  // Tag the user — idempotent, logged to activation-funnel.jsonl
  await emitActivationEvent('ghost_signup_nudge_sent', userId, {
    nudge_tier: tier,
    email_domain: email.split('@')[1] ?? 'unknown', // domain only, never full address
    sent_at: Date.now(),
  })

  return { userId, email, tier, sent: true, alreadyNudged: false, preflightCompleted: false }
}
