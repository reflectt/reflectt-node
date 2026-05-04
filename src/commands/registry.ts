// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// Command registry — the single dispatch lookup `drain.ts` uses to map
// `cmd.type` → handler. §11e step 2 of
// `reflectt-cloud/docs/COMMAND_PLUGIN_SKILL_ARCHITECTURE.md`.
//
// Locks (kai msg-1777932028252 / link msg-1777932030625):
//   - keep step 2 behavior-zero
//   - no new verbs (the two existing verbs become the first two registry
//     entries — no scope creep)
//   - drain.ts dispatches via this registry; unknown `cmd.type` falls
//     back to the existing skip-and-ack path in drain
//
// Adding a new verb after this lane closes is one entry here plus one
// per-verb file in `./handlers/` — no ad-hoc dispatch edits in drain.

import { handleContextSync } from './handlers/context-sync.js'
import { handleRunApprove } from './handlers/run-approve.js'
import type { CommandHandler } from './types.js'

export const COMMAND_REGISTRY: Record<string, CommandHandler> = {
  context_sync: handleContextSync,
  run_approve: handleRunApprove,
}
