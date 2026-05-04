// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// `run_approve` — relays a cloud-side approval decision into the local
// approval queue. Behavior-zero relocation from `drain.ts` per §11e
// step 2 (kai msg-1777932028252 / link msg-1777932030625).

import { state, cloudPost } from '../../cloud.js'
import type { CommandHandler } from '../types.js'

export const handleRunApprove: CommandHandler = async (cmd) => {
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
