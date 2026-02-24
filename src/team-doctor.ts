// SPDX-License-Identifier: Apache-2.0
// Team Doctor — diagnostic checks for onboarding and ongoing health.

import { getDb } from './db.js'

export type CheckStatus = 'pass' | 'fail' | 'warn'

export interface DoctorCheck {
  name: string
  status: CheckStatus
  message: string
  fix?: string
}

export interface DoctorReport {
  timestamp: number
  overall: CheckStatus
  checks: DoctorCheck[]
  nextAction?: string
}

/**
 * Run all team doctor checks and return a diagnostic report.
 * This is designed for onboarding (first-run) and ongoing health monitoring.
 */
export function runTeamDoctor(opts?: {
  gatewayUrl?: string
  modelProvider?: string
}): DoctorReport {
  const checks: DoctorCheck[] = []

  // 1. Check: reflectt-node is running (implicit — if this code runs, the node is up)
  checks.push({
    name: 'node_running',
    status: 'pass',
    message: 'reflectt-node is running',
  })

  // 2. Check: SQLite database is accessible
  checks.push(checkDatabase())

  // 3. Check: agents are configured
  checks.push(checkAgentsPresent())

  // 4. Check: gateway connection
  checks.push(checkGateway(opts?.gatewayUrl))

  // 5. Check: model/LLM auth
  checks.push(checkModelAuth(opts?.modelProvider))

  // 6. Check: at least one chat channel has messages (agents are communicating)
  checks.push(checkChatActivity())

  // Compute overall status
  const hasFailure = checks.some(c => c.status === 'fail')
  const hasWarn = checks.some(c => c.status === 'warn')
  const overall: CheckStatus = hasFailure ? 'fail' : hasWarn ? 'warn' : 'pass'

  // Determine next action from first failing check
  const firstFail = checks.find(c => c.status === 'fail')
  const firstWarn = checks.find(c => c.status === 'warn')
  const nextAction = firstFail?.fix || firstWarn?.fix

  return {
    timestamp: Date.now(),
    overall,
    checks,
    nextAction,
  }
}

function checkDatabase(): DoctorCheck {
  try {
    const db = getDb()
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined
    if (row?.ok === 1) {
      return { name: 'database', status: 'pass', message: 'SQLite database is accessible' }
    }
    return { name: 'database', status: 'fail', message: 'SQLite query returned unexpected result', fix: 'Check ~/.reflectt/data/ permissions' }
  } catch (err) {
    return { name: 'database', status: 'fail', message: `SQLite error: ${String(err)}`, fix: 'Ensure better-sqlite3 is installed and ~/.reflectt/data/ is writable' }
  }
}

function checkAgentsPresent(): DoctorCheck {
  try {
    const db = getDb()

    // Check if any agents have posted messages (proxy for "agents exist")
    const row = db.prepare('SELECT COUNT(DISTINCT "from") as count FROM chat_messages').get() as { count: number } | undefined
    const agentCount = row?.count ?? 0

    if (agentCount >= 2) {
      return { name: 'agents_present', status: 'pass', message: `${agentCount} agents detected in chat history` }
    }

    if (agentCount === 1) {
      return { name: 'agents_present', status: 'warn', message: 'Only 1 agent detected — teams work best with 2+', fix: 'Add another agent workspace or use the starter team template' }
    }

    return {
      name: 'agents_present',
      status: 'fail',
      message: 'No agents detected in chat history',
      fix: 'Run the starter team template to create default agents, or manually create agent workspaces',
    }
  } catch {
    return { name: 'agents_present', status: 'warn', message: 'Could not check for agents (DB not ready)', fix: 'Start the node and let it initialize' }
  }
}

function checkGateway(gatewayUrl?: string): DoctorCheck {
  // Check if gateway env vars / config exist
  const url = gatewayUrl || process.env.OPENCLAW_GATEWAY_URL || process.env.CLAWD_GATEWAY_URL
  const token = process.env.OPENCLAW_GATEWAY_TOKEN || process.env.CLAWD_GATEWAY_TOKEN

  if (!url) {
    return {
      name: 'gateway',
      status: 'fail',
      message: 'No gateway URL configured',
      fix: 'Set OPENCLAW_GATEWAY_URL in .env or run `openclaw setup`',
    }
  }

  if (!token) {
    return {
      name: 'gateway',
      status: 'warn',
      message: `Gateway URL set (${url}) but no token configured`,
      fix: 'Set OPENCLAW_GATEWAY_TOKEN in .env (find it in ~/.openclaw/openclaw.json)',
    }
  }

  return {
    name: 'gateway',
    status: 'pass',
    message: `Gateway configured: ${url}`,
  }
}

function checkModelAuth(provider?: string): DoctorCheck {
  // Check for common LLM provider API keys
  const providers = [
    { name: 'Anthropic', keys: ['ANTHROPIC_API_KEY'] },
    { name: 'OpenAI', keys: ['OPENAI_API_KEY'] },
    { name: 'Google', keys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
  ]

  const configured: string[] = []
  for (const p of providers) {
    if (p.keys.some(k => process.env[k]?.trim())) {
      configured.push(p.name)
    }
  }

  if (configured.length === 0) {
    return {
      name: 'model_auth',
      status: 'fail',
      message: 'No LLM API keys found (checked ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)',
      fix: 'Add at least one LLM API key to your .env file (e.g. ANTHROPIC_API_KEY=sk-...)',
    }
  }

  return {
    name: 'model_auth',
    status: 'pass',
    message: `LLM providers configured: ${configured.join(', ')}`,
  }
}

function checkChatActivity(): DoctorCheck {
  try {
    const db = getDb()
    const row = db.prepare('SELECT COUNT(*) as count FROM chat_messages').get() as { count: number } | undefined
    const count = row?.count ?? 0

    if (count > 10) {
      return { name: 'chat_activity', status: 'pass', message: `${count} messages in chat history` }
    }

    if (count > 0) {
      return { name: 'chat_activity', status: 'warn', message: `Only ${count} messages — agents may not be active yet`, fix: 'Send a test message via the chat API or wait for agents to start their heartbeats' }
    }

    return {
      name: 'chat_activity',
      status: 'warn',
      message: 'No chat messages yet',
      fix: 'This is normal on first run — agents will start communicating once configured and running',
    }
  } catch {
    return { name: 'chat_activity', status: 'warn', message: 'Could not check chat activity' }
  }
}
