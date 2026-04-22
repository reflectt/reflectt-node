// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Locks in the bootstrap task contract so edits can't silently regress the
// fresh-host flow (claim-first, color required, enumerated voice IDs,
// autonomous no-human execution, explicit task transition, no identity Q&A
// leaking into product channels, no kokoro impl-detail wording in agent copy).
// task-1776796380591-wroo87jmu — fresh managed host was running against stale
// bootstrap text that told the agent to save TEAM-ROLES before claiming its
// own identity and didn't require color, so presence stayed neutral.
// Follow-up: the fresh host DID claim but sat in "who am I? ask the user"
// mode and never transitioned the bootstrap task, so the board stayed todo.
// Seam 2 follow-up: bootstrap copy was leaking "Kokoro" wording and the
// no-Q&A rule did not propagate into subagent task descriptions, so
// strategist/scribe/pixel still posted "who am I?" into #general.

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

  it('enumerates only real voice IDs with af_/am_/bf_/bm_ prefixes', () => {
    expect(spec.description).toMatch(/af_sarah/)
    expect(spec.description).toMatch(/am_adam/)
    expect(spec.description).toMatch(/Voice IDs must start with `af_`, `am_`, `bf_`, or `bm_`/)
    expect(spec.description).not.toMatch(/s3:\/\//)
    expect(spec.description).not.toMatch(/fusionVoice/)
    expect(spec.description).not.toMatch(/EXAVITQu4vr4xnSDxMaL/)
  })

  it('scrubs kokoro impl-detail wording from agent-facing bootstrap copy', () => {
    // Agents read this verbatim and parrot it into product channels.
    // Internal infra references (env var names, server logs) live elsewhere.
    expect(spec.description).not.toMatch(/kokoro/i)
    expect(spec.done_criteria.join('\n')).not.toMatch(/kokoro/i)
  })

  it('forbids identity-discovery Q&A in product channels and propagates the rule to subagents', () => {
    expect(spec.description).toMatch(/internal/i)
    expect(spec.description).toMatch(/Who am I\?/)
    expect(spec.description).toMatch(/subagent task description/i)
    const criteria = spec.done_criteria.join('\n')
    expect(criteria).toMatch(/No agent posted identity-discovery questions/)
    expect(criteria).toMatch(/Subagent task descriptions include the no-Q&A clause/)
  })

  it('embeds the teamIntent verbatim as a blockquote', () => {
    expect(spec.description).toContain('> build me a team that ships a product')
  })

  it('requires every agent (including main) to claim identity with color + voice', () => {
    const joined = spec.done_criteria.join('\n')
    expect(joined).toMatch(/Each agent \(including main\)/)
    expect(joined).toMatch(/color/)
    expect(joined).toMatch(/voice/)
    expect(joined).toMatch(/af_\/am_\/bf_\/bm_/)
  })

  it('exports a non-empty template version stamp for self-heal', () => {
    expect(BOOTSTRAP_TEMPLATE_VERSION).toBeTruthy()
    expect(BOOTSTRAP_TEMPLATE_VERSION.length).toBeGreaterThan(0)
  })

  it('bumped the template version stamp so stale hosts self-heal', () => {
    // The stamp must change every time the bootstrap contract materially
    // changes, otherwise existing-volume hosts won't rewrite their stale
    // bootstrap task. We assert it's a date-prefixed string and not any
    // historical stamp we know stale hosts may already carry.
    expect(BOOTSTRAP_TEMPLATE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-/)
    expect(BOOTSTRAP_TEMPLATE_VERSION).not.toBe('2026-04-21-autonomous-bootstrap-no-human')
  })
})
