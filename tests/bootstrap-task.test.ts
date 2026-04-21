// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Locks in the bootstrap task contract so edits can't silently regress the
// fresh-host flow (claim-first, color required, enumerated Kokoro voices,
// autonomous no-human execution, explicit task transition).
// task-1776796380591-wroo87jmu — fresh managed host was running against stale
// bootstrap text that told the agent to save TEAM-ROLES before claiming its
// own identity and didn't require color, so presence stayed neutral.
// Follow-up: the fresh host DID claim but sat in "who am I? ask the user"
// mode and never transitioned the bootstrap task, so the board stayed todo.

import { describe, it, expect } from 'vitest'
import { BOOTSTRAP_TEMPLATE_VERSION, buildIntentBootstrapTaskSpec } from '../src/bootstrap-task.js'

describe('bootstrap task template', () => {
  const spec = buildIntentBootstrapTaskSpec('build me a team that ships a product')

  it('tells main to claim its identity FIRST before any other step', () => {
    expect(spec.description).toMatch(/Claim your own identity/)
    expect(spec.done_criteria.join('\n')).toMatch(/POST \/agents\/main\/identity\/claim.*before any other step/)
  })

  it('makes the no-human-autonomous contract explicit', () => {
    expect(spec.description).toMatch(/no human is watching|no human user|No human/i)
    expect(spec.description).toMatch(/do not ask|You decide|Do not post "who am I/i)
  })

  it('requires an idempotency check against /agent-configs before re-claiming', () => {
    expect(spec.description).toMatch(/GET \/agent-configs/)
    expect(spec.description).toMatch(/already claimed/i)
    expect(spec.done_criteria.join('\n')).toMatch(/GET \/agent-configs first/)
  })

  it('requires explicit bootstrap task transition to doing then done', () => {
    expect(spec.description).toMatch(/PATCH \/tasks.*"status":\s*"doing"/)
    expect(spec.description).toMatch(/PATCH \/tasks.*"status":\s*"done"/)
    const criteria = spec.done_criteria.join('\n')
    expect(criteria).toMatch(/transitioned to `doing`/)
    expect(criteria).toMatch(/transitioned to `done`/)
  })

  it('requires color in the claim body shape', () => {
    expect(spec.description).toMatch(/"color":\s*"#/)
    expect(spec.description).toMatch(/color.*is a hex/)
  })

  it('enumerates only real Kokoro voice IDs with af_/am_/bf_/bm_ prefixes', () => {
    expect(spec.description).toMatch(/af_sarah/)
    expect(spec.description).toMatch(/am_adam/)
    expect(spec.description).toMatch(/Voice IDs must start with `af_`, `am_`, `bf_`, or `bm_`/)
    expect(spec.description).not.toMatch(/s3:\/\//)
    expect(spec.description).not.toMatch(/fusionVoice/)
    expect(spec.description).not.toMatch(/EXAVITQu4vr4xnSDxMaL/)
  })

  it('embeds the teamIntent verbatim as a blockquote', () => {
    expect(spec.description).toContain('> build me a team that ships a product')
  })

  it('requires every agent (including main) to claim identity with color + Kokoro voice', () => {
    const joined = spec.done_criteria.join('\n')
    expect(joined).toMatch(/Each agent \(including main\)/)
    expect(joined).toMatch(/color/)
    expect(joined).toMatch(/Kokoro voice/)
    expect(joined).toMatch(/af_\/am_\/bf_\/bm_/)
  })

  it('exports a non-empty template version stamp for self-heal', () => {
    expect(BOOTSTRAP_TEMPLATE_VERSION).toBeTruthy()
    expect(BOOTSTRAP_TEMPLATE_VERSION.length).toBeGreaterThan(0)
  })

  it('bumped the template version stamp so stale hosts self-heal', () => {
    expect(BOOTSTRAP_TEMPLATE_VERSION).toMatch(/autonomous|no-human/i)
  })
})
