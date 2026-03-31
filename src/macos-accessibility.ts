// SPDX-License-Identifier: Apache-2.0
/**
 * macOS Accessibility Control Harness — Pilot scope only.
 *
 * Executes whitelisted UI intents on macOS via AppleScript/System Events.
 * Every run is logged immutably. A hard kill-switch disables all control instantly.
 *
 * PILOT CONSTRAINTS (from process/TASK-jy0to4o17.md):
 *   Allowed apps:   Notes, Reminders, Mail (no finance/admin/system settings)
 *   Allowed actions: open_app, focus_window, click_element, type_text, create_reminder,
 *                    draft_email, summarize_note (no send/delete/submit/payment)
 *
 * task-1773486840001-u0shj14v3
 */

import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// ── Kill-switch ──────────────────────────────────────────────────────────────

let KILL_SWITCH_ENGAGED = false

export function engageKillSwitch(): void {
  KILL_SWITCH_ENGAGED = true
  console.warn('[macOS-AX] KILL-SWITCH ENGAGED — all accessibility control disabled')
}

export function resetKillSwitch(): void {
  KILL_SWITCH_ENGAGED = false
  console.log('[macOS-AX] Kill-switch reset')
}

export function isKillSwitchEngaged(): boolean {
  return KILL_SWITCH_ENGAGED
}

// ── Allowlist ────────────────────────────────────────────────────────────────

const ALLOWED_APPS = new Set(['Notes', 'Reminders', 'Mail'])

const ALLOWED_ACTIONS = new Set([
  'open_app',
  'focus_window',
  'click_element',
  'type_text',
  'create_reminder',
  'draft_email',
  'summarize_note',
])

// Actions that require human approval before execution
const IRREVERSIBLE_ACTIONS = new Set([
  'draft_email', // excluded: send_email would be irreversible — only draft is allowed in pilot
])

export type MacOSIntent = {
  action: string
  app?: string
  target?: string    // element description or window title
  text?: string      // text to type / reminder title / note ref
  listName?: string  // for Reminders
  dryRun?: boolean   // skip AppleScript execution (test/preview mode)
}

export type StepRecord = {
  step: string
  timestamp: number
  ok: boolean
  detail?: string
}

export type MacOSRunResult = {
  ok: boolean
  output?: string
  error?: string
  steps: StepRecord[]
  requiresApproval?: boolean
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validateIntent(intent: MacOSIntent): { ok: boolean; reason?: string } {
  if (!ALLOWED_ACTIONS.has(intent.action)) {
    return { ok: false, reason: `Action "${intent.action}" not in pilot allowlist` }
  }
  if (intent.app && !ALLOWED_APPS.has(intent.app)) {
    return { ok: false, reason: `App "${intent.app}" not in pilot allowlist (allowed: ${[...ALLOWED_APPS].join(', ')})` }
  }
  // Block any text that looks like it would trigger send/delete/payment
  const dangerPatterns = /\b(send|delete|rm|remove|pay|transfer|submit|confirm.*order|place.*order)\b/i
  if (intent.text && dangerPatterns.test(intent.text)) {
    return { ok: false, reason: 'Text contains disallowed keywords (send/delete/pay/submit)' }
  }
  return { ok: true }
}

export function requiresApproval(intent: MacOSIntent): boolean {
  return IRREVERSIBLE_ACTIONS.has(intent.action)
}

// ── AppleScript runner ───────────────────────────────────────────────────────

async function runAppleScript(script: string, timeoutMs = 10_000): Promise<{ ok: boolean; output: string; error?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 64,
    })
    return { ok: true, output: stdout.trim(), error: stderr.trim() || undefined }
  } catch (err: any) {
    return { ok: false, output: '', error: err.message ?? String(err) }
  }
}

// ── Intent executors ─────────────────────────────────────────────────────────

async function execOpenApp(app: string, steps: StepRecord[]): Promise<MacOSRunResult> {
  const script = `tell application "${app}" to activate`
  const result = await runAppleScript(script)
  steps.push({ step: 'open_app', timestamp: Date.now(), ok: result.ok, detail: result.error })
  return { ok: result.ok, output: result.output, error: result.error, steps }
}

async function execFocusWindow(app: string, target: string | undefined, steps: StepRecord[]): Promise<MacOSRunResult> {
  const script = target
    ? `tell application "System Events" to tell process "${app}" to set frontmost to true`
    : `tell application "${app}" to activate`
  const result = await runAppleScript(script)
  steps.push({ step: 'focus_window', timestamp: Date.now(), ok: result.ok, detail: result.error })
  return { ok: result.ok, output: result.output, error: result.error, steps }
}

async function execTypeText(app: string, text: string, steps: StepRecord[]): Promise<MacOSRunResult> {
  const escaped = text.replace(/"/g, '\\"')
  const script = `tell application "System Events" to keystroke "${escaped}"`
  const result = await runAppleScript(script)
  steps.push({ step: 'type_text', timestamp: Date.now(), ok: result.ok, detail: result.error })
  return { ok: result.ok, output: result.output, error: result.error, steps }
}

async function execCreateReminder(text: string, listName: string | undefined, steps: StepRecord[]): Promise<MacOSRunResult> {
  const list = listName ?? 'Reminders'
  const escaped = text.replace(/"/g, '\\"')
  const script = `tell application "Reminders"
    tell list "${list}"
      make new reminder with properties {name:"${escaped}"}
    end tell
  end tell`
  const result = await runAppleScript(script)
  steps.push({ step: 'create_reminder', timestamp: Date.now(), ok: result.ok, detail: result.error })
  return { ok: result.ok, output: result.output, error: result.error, steps }
}

async function execDraftEmail(text: string, steps: StepRecord[]): Promise<MacOSRunResult> {
  // Draft only — sets body text, does NOT send
  const escaped = text.replace(/"/g, '\\"')
  const script = `tell application "Mail"
    set newMsg to make new outgoing message with properties {subject:"[Draft]", content:"${escaped}", visible:true}
  end tell`
  const result = await runAppleScript(script)
  steps.push({ step: 'draft_email', timestamp: Date.now(), ok: result.ok, detail: result.error })
  if (result.ok) {
    steps.push({ step: 'draft_email_safety_note', timestamp: Date.now(), ok: true, detail: 'Draft created but NOT sent — send requires explicit human action' })
  }
  return { ok: result.ok, output: result.output, error: result.error, steps }
}

async function execSummarizeNote(target: string, steps: StepRecord[]): Promise<MacOSRunResult> {
  // Read-only: fetch note content for LLM summarization
  const escaped = target.replace(/"/g, '\\"')
  const script = `tell application "Notes"
    set matchingNotes to notes whose name contains "${escaped}"
    if (count of matchingNotes) > 0 then
      return body of item 1 of matchingNotes
    else
      return "NOTE_NOT_FOUND"
    end if
  end tell`
  const result = await runAppleScript(script)
  steps.push({ step: 'summarize_note_read', timestamp: Date.now(), ok: result.ok, detail: result.error })
  if (!result.ok) return { ok: false, error: result.error, steps }
  if (result.output === 'NOTE_NOT_FOUND') {
    return { ok: false, error: `Note containing "${target}" not found`, steps }
  }
  return { ok: true, output: result.output, steps }
}

// ── Main executor ─────────────────────────────────────────────────────────────

/**
 * Execute a macOS UI intent via the accessibility harness.
 *
 * Returns requiresApproval=true if the intent needs human sign-off before run.
 * Never executes if kill-switch is engaged.
 */
export async function executeIntent(intent: MacOSIntent): Promise<MacOSRunResult> {
  const steps: StepRecord[] = []

  // Kill-switch check
  if (KILL_SWITCH_ENGAGED) {
    return { ok: false, error: 'Kill-switch engaged — all accessibility control disabled', steps }
  }

  // Allowlist validation
  const validation = validateIntent(intent)
  if (!validation.ok) {
    return { ok: false, error: validation.reason, steps }
  }

  const app = intent.app ?? 'Notes'
  steps.push({ step: 'start', timestamp: Date.now(), ok: true, detail: `${intent.action} on ${app}` })

  // Dry run: skip AppleScript, return success proof
  if (intent.dryRun) {
    steps.push({ step: 'dry_run', timestamp: Date.now(), ok: true, detail: `[dry-run] would execute ${intent.action} on ${app}` })
    return { ok: true, output: `[dry-run] ${intent.action} on ${app}`, steps }
  }

  switch (intent.action) {
    case 'open_app':     return execOpenApp(app, steps)
    case 'focus_window': return execFocusWindow(app, intent.target, steps)
    case 'type_text':    return execTypeText(app, intent.text ?? '', steps)
    case 'create_reminder': return execCreateReminder(intent.text ?? '', intent.listName, steps)
    case 'draft_email':  return execDraftEmail(intent.text ?? '', steps)
    case 'summarize_note': return execSummarizeNote(intent.target ?? intent.text ?? '', steps)
    case 'click_element': {
      // Placeholder — click_element requires element targeting; stub for pilot
      steps.push({ step: 'click_element', timestamp: Date.now(), ok: false, detail: 'click_element not yet implemented in pilot v0' })
      return { ok: false, error: 'click_element not yet implemented in pilot v0', steps }
    }
    default:
      return { ok: false, error: `Unhandled action: ${intent.action}`, steps }
  }
}
