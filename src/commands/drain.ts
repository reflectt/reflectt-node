// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// Command Drain — node-side cloud command queue runtime.
//
// §11e step 1 (kai msg-1777492135899 / link msg-1777492193718) extracted
// the inline poll/dispatch/ack from `src/cloud.ts` into this file with
// inline if/else dispatch.
//
// §11e step 2 (kai msg-1777932028252 / link msg-1777932030625) replaces
// that inline if/else with a registry lookup so adding a new verb is one
// entry in `./registry.ts` plus one file in `./handlers/`. Behavior-zero
// — same poll cadence, same ack contract, same unknown-skip semantics.
//
// Scope locks (still in force):
//   - same poll cadence
//   - same ack contract
//   - no auth / intake churn
//   - no new verbs (the two existing verbs are the first two registry entries)

import { state, config, isIdle, cloudGet, cloudPost } from '../cloud.js'
import { COMMAND_REGISTRY } from './registry.js'
import type { PendingCommand } from './types.js'

export const COMMAND_POLL_ACTIVE_MS = 10_000   // 10s when active
export const COMMAND_POLL_IDLE_MS = 60_000     // 60s when idle
let commandPollErrors = 0
let lastCommandPollAt = 0

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
  const handler = COMMAND_REGISTRY[cmd.type]
  if (!handler) {
    console.log(`☁️  [Commands] Unknown command type: ${cmd.type} (${cmd.id}) — skipping`)
    // Ack unknown commands so they don't pile up
    await cloudPost(`/api/hosts/${state.hostId}/commands/${cmd.id}/ack`, {
      action: 'complete',
      result: { skipped: true, reason: 'unknown_type' },
    })
    return
  }
  await handler(cmd, { hostId: state.hostId! })
}
