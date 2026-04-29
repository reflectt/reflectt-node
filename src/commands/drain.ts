// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// Command Drain — node-side cloud command queue runtime.
//
// Behavior-zero relocation of the inline command runtime previously
// living in `src/cloud.ts`. Same poll cadence (10s active / 60s idle),
// same dispatch (inline if/else by `cmd.type`), same ack contract.
// No registry yet — that lands in step 2 of §11e in
// `reflectt-cloud/docs/COMMAND_PLUGIN_SKILL_ARCHITECTURE.md`.
//
// Scope locks (kai msg-1777492135899 / link msg-1777492193718):
//   - keep step 1 behavior-zero
//   - same poll cadence
//   - same ack contract
//   - same inline dispatch semantics (no registry creep until step 2)
//   - no auth / intake churn
//   - no new verbs

import { state, config, isIdle, cloudGet, cloudPost, markCloudActivity } from '../cloud.js'

export const COMMAND_POLL_ACTIVE_MS = 10_000   // 10s when active
export const COMMAND_POLL_IDLE_MS = 60_000     // 60s when idle
let commandPollErrors = 0
let lastCommandPollAt = 0

interface PendingCommand {
  id: string
  type: string
  payload: Record<string, unknown>
  status: string
}

export async function pollAndProcessCommands(): Promise<void> {
  if (!state.hostId || !config || !state.running) return

  const now = Date.now()
  const interval = isIdle() ? COMMAND_POLL_IDLE_MS : COMMAND_POLL_ACTIVE_MS
  if (now - lastCommandPollAt < interval) return
  lastCommandPollAt = now

  const result = await cloudGet<{ commands: PendingCommand[] }>(
    `/api/hosts/${state.hostId}/commands?status=pending`
  )

  if (!result.success || !result.data?.commands) {
    commandPollErrors++
    if (commandPollErrors <= 3 || commandPollErrors % 20 === 0) {
      console.warn(`☁️  [Commands] Poll failed (${commandPollErrors}): ${result.error}`)
    }
    return
  }

  if (commandPollErrors > 0) {
    console.log(`☁️  [Commands] Poll recovered after ${commandPollErrors} errors`)
    commandPollErrors = 0
  }

  for (const cmd of result.data.commands) {
    try {
      await handleCommand(cmd)
    } catch (err: any) {
      console.warn(`☁️  [Commands] Failed to handle ${cmd.type} (${cmd.id}): ${err?.message}`)
      // Ack as failed so it doesn't re-run
      await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
        action: 'fail',
        error: err?.message || 'Handler error',
      }).catch(() => {})
    }
  }
}

async function handleCommand(cmd: PendingCommand): Promise<void> {
  if (cmd.type === 'context_sync') {
    await handleContextSync(cmd)
  } else if (cmd.type === 'run_approve') {
    await handleRunApprove(cmd)
  } else {
    console.log(`☁️  [Commands] Unknown command type: ${cmd.type} (${cmd.id}) — skipping`)
    // Ack unknown commands so they don't pile up
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { skipped: true, reason: 'unknown_type' },
    })
  }
}

async function handleRunApprove(cmd: PendingCommand): Promise<void> {
  if (!state.hostId) return

  const eventId = cmd.payload?.eventId as string
  const decision = cmd.payload?.decision as string
  const actor = cmd.payload?.actor as string || 'cloud-dashboard'
  const rationale = cmd.payload?.rationale as string || ''

  if (!eventId || !decision) {
    console.warn(`☁️  [Commands] run_approve missing eventId/decision (${cmd.id}) — failing`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: 'eventId and decision are required',
    })
    return
  }

  console.log(`☁️  [Commands] Processing run_approve: ${decision} for ${eventId} (${cmd.id})`)

  // Ack immediately
  await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
    action: 'ack',
  })

  // Execute locally against the approval queue
  const port = process.env.REFLECTT_NODE_PORT || '4445'
  try {
    const res = await fetch(`http://127.0.0.1:${port}/approval-queue/${encodeURIComponent(eventId)}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, actor, rationale }),
    })

    const result = await res.json().catch(() => ({ success: false }))

    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { eventId, decision, status: res.status, ...(result as Record<string, unknown>) },
    })

    console.log(`☁️  [Commands] run_approve ${decision} for ${eventId} — ${res.status}`)
  } catch (err: any) {
    console.warn(`☁️  [Commands] run_approve failed for ${eventId}: ${err?.message}`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: err?.message || 'Local approval-queue call failed',
    })
  }
}

async function handleContextSync(cmd: PendingCommand): Promise<void> {
  if (!state.hostId) return

  // Require explicit agent — no hardcoded fallback
  const agent = (cmd.payload?.agent as string)?.trim()
  if (!agent) {
    console.warn(`☁️  [Commands] context_sync missing payload.agent (${cmd.id}) — failing`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: 'payload.agent is required',
    })
    return
  }

  console.log(`☁️  [Commands] Processing context_sync for agent=${agent} (${cmd.id})`)

  // Ack immediately (in-progress)
  await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
    action: 'ack',
  })

  // Fetch context snapshot from local node
  const port = process.env.REFLECTT_NODE_PORT || '4445'
  let contextData: Record<string, unknown>
  try {
    const localRes = await fetch(`http://127.0.0.1:${port}/context/inject/${encodeURIComponent(agent)}`)
    if (!localRes.ok) throw new Error(`Local context fetch failed: ${localRes.status}`)
    contextData = await localRes.json() as Record<string, unknown>
  } catch (err: any) {
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: `Failed to fetch local context: ${err?.message}`,
    })
    throw err
  }

  // Push to cloud — use computed_at from injection payload when available
  const computedAt = (typeof contextData.computed_at === 'number' && contextData.computed_at > 0)
    ? contextData.computed_at
    : Date.now()

  const syncResult = await cloudPost(`/api/hosts/${state.hostId}/context/sync`, {
    agent,
    computed_at: computedAt,
    budgets: contextData.budgets || { totalTokens: 0, layers: {} },
    autosummary_enabled: Boolean(contextData.autosummary_enabled),
    layers: contextData.layers || {},
  })

  if (syncResult.success) {
    console.log(`☁️  [Commands] context_sync completed for ${agent} (${cmd.id})`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { syncedAt: Date.now(), agent },
    })
    markCloudActivity() // Mark as active
  } else {
    console.warn(`☁️  [Commands] context_sync failed for ${agent}: ${syncResult.error}`)
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'fail',
      error: syncResult.error,
    })
  }
}
