// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI

/**
 * active-speakers — minimal in-memory tracker of which agents are currently
 * mid-TTS. Mirrors `canvas_state.payload.activeSpeaker` so server-side
 * gates that don't have access to the canvasStateMap closure (e.g.
 * voice-ack-on-handoff) can still ask the question. server.ts updates
 * this whenever it toggles canvasStateMap activeSpeaker; readers stay
 * pure.
 */

const speakers = new Set<string>()

export function setActiveSpeaker(agentId: string, active: boolean): void {
  if (!agentId) return
  if (active) speakers.add(agentId)
  else speakers.delete(agentId)
}

export function isAgentActiveSpeaker(agentId: string): boolean {
  return speakers.has(agentId)
}

export function _resetActiveSpeakersForTest(): void {
  speakers.clear()
}
