// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// `context_sync` — fetches the local agent context snapshot and pushes
// it to the cloud's `/context/sync` endpoint. Behavior-zero relocation
// from `drain.ts` per §11e step 2 (kai msg-1777932028252 / link
// msg-1777932030625).

import { state, cloudPost, markCloudActivity } from '../../cloud.js'
import type { CommandHandler } from '../types.js'

export const handleContextSync: CommandHandler = async (cmd) => {
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
