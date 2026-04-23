// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Per-field DetailField + revision shape proof for GET /agents/:name/identity.
//
// Cloud's agent detail pane consumes a per-field truth contract documented in
// reflectt-cloud/docs/AGENT_IDENTITY_PROXY.md. Each field carries:
//   - support: 'editable' | 'readable' | 'unsupported'
//   - source: dotted origin (e.g. reflectt-node.team-roles.yaml.name)
//   - value?: present when known
// The payload also carries a 16-char SHA-256 `revision` so future
// cloud→channel→OpenClaw writes can use If-Match optimistic concurrency.
//
// This is the read-only half of task-1776815665086-ebfbj898x. The write
// path lives in reflectt-channel-openclaw (cloud → channel → OpenClaw),
// not here — node deliberately stays runtime/control-truth only (PR #1279).

import { describe, it, expect, beforeAll, vi } from 'vitest'
import Fastify from 'fastify'

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/chat.js', () => ({
  chatManager: {
    sendMessage: vi.fn(async () => ({ id: 'mock-msg', timestamp: Date.now() })),
    getMessages: vi.fn(() => []),
    getStats: vi.fn(() => ({ totalMessages: 0, rooms: 0, subscribers: 0, initialized: true, drops: {} })),
  },
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execSync: () => 'UNKNOWN' }
})

vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>()
  return {
    ...actual,
    openclawConfig: {
      ...actual.openclawConfig,
      gatewayToken: 'test-token',
      gatewayUrl: 'ws://localhost:18789',
    },
  }
})

vi.mock('../src/openclaw.js', () => ({
  openclawClient: {
    get instance() { return { isConnected: () => false } },
    close: vi.fn(),
    isConnected: vi.fn(() => false),
    reidentify: vi.fn(),
    getIdentity: vi.fn(() => ({ name: 'main' })),
  },
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /agents/:name/identity — per-field DetailField + revision shape', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()

    const { setTestRoles, loadAgentRoles } = await import('../src/assignment.js')
    setTestRoles([
      {
        name: 'genesis',
        displayName: 'Genesis',
        role: 'managed',
        description: 'Managed host genesis agent',
        aliases: ['gen'],
        affinityTags: ['managed', 'staging'],
        wipCap: 3,
      },
    ])
    // setTestRoles only stores the override; getAgentRole() reads loadedRoles.
    // Call loadAgentRoles() to push the override into loadedRoles (line 125-129
    // of assignment.ts handles the test-mode short-circuit).
    loadAgentRoles()
  })

  it('returns the legacy flat keys (back-compat with v0.1.33 callers)', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/genesis/identity' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.found).toBe(true)
    expect(body.agentId).toBe('genesis')
    expect(body.displayName).toBe('Genesis')
    expect(body.role).toBe('managed')
    expect(body.aliases).toEqual(['gen'])
    expect(body.affinityTags).toEqual(['managed', 'staging'])
    expect(body.wipCap).toBe(3)
    expect(body.source).toBe('yaml')
  })

  it('emits a `fields` block with all expected keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/genesis/identity' })
    const body = JSON.parse(res.body)
    expect(body.fields).toBeDefined()
    const expectedKeys = [
      'name', 'displayName', 'role', 'description',
      'aliases', 'affinityTags', 'wipCap',
      'avatar', 'voice', 'color',
    ]
    for (const k of expectedKeys) {
      expect(body.fields, `field ${k} missing`).toHaveProperty(k)
      expect(body.fields[k].support, `field ${k} missing support`).toBe('editable')
      expect(body.fields[k].source, `field ${k} missing source`).toBeTruthy()
    }
  })

  it('YAML fields carry value + yaml-prefixed source', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/genesis/identity' })
    const body = JSON.parse(res.body)
    expect(body.fields.name.value).toBe('genesis')
    expect(body.fields.name.source).toMatch(/team-roles\.yaml\.name$/)
    expect(body.fields.displayName.value).toBe('Genesis')
    expect(body.fields.displayName.source).toMatch(/team-roles\.yaml\.displayName$/)
    expect(body.fields.role.value).toBe('managed')
    expect(body.fields.aliases.value).toEqual(['gen'])
    expect(body.fields.wipCap.value).toBe(3)
  })

  it('settings fields carry agent_config-prefixed source', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/genesis/identity' })
    const body = JSON.parse(res.body)
    expect(body.fields.avatar.source).toMatch(/agent_config\.settings\.avatar$/)
    expect(body.fields.voice.source).toMatch(/agent_config\.settings\.voice$/)
    expect(body.fields.color.source).toMatch(/agent_config\.settings\.identityColor$/)
  })

  it('settings fields with no stored value carry support+source but no `value`', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/genesis/identity' })
    const body = JSON.parse(res.body)
    // No claim has run on `genesis` in this test, so settings table is empty
    // for these keys — `value` should be omitted, not null/undefined-as-key.
    expect(body.fields.avatar).not.toHaveProperty('value')
    expect(body.fields.voice).not.toHaveProperty('value')
    expect(body.fields.color).not.toHaveProperty('value')
  })

  it('emits a 16-char hex `revision` string', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/genesis/identity' })
    const body = JSON.parse(res.body)
    expect(typeof body.revision).toBe('string')
    expect(body.revision).toMatch(/^[0-9a-f]{16}$/)
  })

  it('revision is stable across two identical reads', async () => {
    const a = JSON.parse((await app.inject({ method: 'GET', url: '/agents/genesis/identity' })).body)
    const b = JSON.parse((await app.inject({ method: 'GET', url: '/agents/genesis/identity' })).body)
    expect(a.revision).toBe(b.revision)
  })

  it('revision rotates when an avatar claim mutates settings', async () => {
    const before = JSON.parse((await app.inject({ method: 'GET', url: '/agents/genesis/identity' })).body)

    // Claim mutates agent_config.settings.{avatar,voice,identityColor}, which
    // feeds the settings-sourced fields and therefore must rotate the revision.
    const claim = await app.inject({
      method: 'POST',
      url: '/agents/genesis/identity/claim',
      payload: {
        claimedName: 'genesis',
        displayName: 'Genesis',
        color: '#22c55e',
        voice: 'EXAVITQu4vr4xnSDxMaL',
        avatar: { type: 'emoji', content: '🜂' },
      },
    })
    expect(claim.statusCode).toBe(200)

    const after = JSON.parse((await app.inject({ method: 'GET', url: '/agents/genesis/identity' })).body)
    expect(after.revision).not.toBe(before.revision)
    // avatar value also gets an `updatedAt` from the claim handler, so use
    // toMatchObject (subset match) rather than strict toEqual.
    expect(after.fields.avatar.value).toMatchObject({ type: 'emoji', content: '🜂' })
    expect(after.fields.voice.value).toBe('EXAVITQu4vr4xnSDxMaL')
    expect(after.fields.color.value).toBe('#22c55e')
  })

  it('returns the {found:false, hint} shape unchanged for unknown agents', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/does-not-exist/identity' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.found).toBe(false)
    expect(body.hint).toBeTruthy()
    expect(body).not.toHaveProperty('fields')
    expect(body).not.toHaveProperty('revision')
  })
})
