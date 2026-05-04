// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

// Command runtime — shared types.
//
// §11e step 2 of `reflectt-cloud/docs/COMMAND_PLUGIN_SKILL_ARCHITECTURE.md`.
// Locks (kai msg-1777932028252 / link msg-1777932030625):
//   - shared handler/context types
//   - behavior-zero
//   - no new verbs

/** A pending command pulled off the cloud's command queue (one entry of
 *  `GET /api/hosts/:hostId/commands?status=pending`). */
export interface PendingCommand {
  id: string
  type: string
  payload: Record<string, unknown>
  status: string
}

/** Per-dispatch context passed by `drain.ts` into the handler. Carries
 *  what every handler needs at the boundary today (the validated host id).
 *  Future verbs may extend this — kept narrow on purpose. */
export interface CommandContext {
  hostId: string
}

/** Async handler for a single command verb. Errors thrown out of the
 *  handler are caught by `drain.ts` and acked as `fail` on the cloud
 *  queue — same contract step 1 already implemented inline. */
export type CommandHandler = (cmd: PendingCommand, ctx: CommandContext) => Promise<void>
