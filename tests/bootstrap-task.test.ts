// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Locks in the bootstrap task contract so edits can't silently regress the
// fresh-host flow (claim-first, color required, enumerated Kokoro voices).
// task-1776796380591-wroo87jmu — fresh managed host was running against stale
// bootstrap text that told the agent to save TEAM-ROLES before claiming its
// own identity and didn't require color, so presence stayed neutral.

import { describe, it, expect } from 'vitest'
import { BOOTSTRAP_TEMPLATE_VERSION, buildIntentBootstrapTaskSpec } from '../src/bootstrap-task.js'

describe('bootstrap task template', () => {
  const spec = buildIntentBootstrapTaskSpec('build me a team that ships a product')

  it('tells main to claim its identity FIRST before any other step', () => {
    expect(spec.description).toMatch(/Claim your own identity FIRST/)
    expect(spec.done_criteria[0]).toMatch(/POST \/agents\/main\/identity\/claim.*before any other step/)
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
})
