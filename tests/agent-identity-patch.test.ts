// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// PATCH /agents/:name/identity — per-field write surface.
//
// This is the node-side terminus of the cloud→openclaw-channel→reflectt-node
// write seam locked by kai on 2026-04-22 (`write_seam_decision_2026_04_22_2324`
// on task-1776815665086-ebfbj898x). The openclaw plugin route bridges cloud
// PUTs into this endpoint so reads and writes stay on one source of truth.
//
// Companion to tests/agent-identity-per-field.test.ts (the GET shape proof).

import { describe, it, expect, beforeAll, vi } from 'vitest'
import Fastify from 'fastify'

// ── Module mocks (mirror agent-identity-per-field.test.ts) ───────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PATCH /agents/:name/identity — per-field write surface', () => {
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
    loadAgentRoles()
  })

  async function getIdentity(name = 'genesis') {
    const res = await app.inject({ method: 'GET', url: `/agents/${name}/identity` })
    return JSON.parse(res.body)
  }

  it('mutates a YAML field and rotates revision', async () => {
    const before = await getIdentity()
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: { displayName: 'Genesis Prime' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.fields.displayName.value).toBe('Genesis Prime')
    expect(body.revision).not.toBe(before.revision)

    const after = await getIdentity()
    expect(after.fields.displayName.value).toBe('Genesis Prime')
    expect(after.revision).toBe(body.revision)
  })

  it('mutates a settings field (avatar/voice/color)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: {
        avatar: { type: 'emoji', content: '🜂' },
        voice: 'EXAVITQu4vr4xnSDxMaL',
        color: '#22c55e',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.fields.avatar.value).toMatchObject({ type: 'emoji', content: '🜂' })
    expect(body.fields.voice.value).toBe('EXAVITQu4vr4xnSDxMaL')
    expect(body.fields.color.value).toBe('#22c55e')
  })

  it('mixed YAML + settings patch in one call', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: {
        affinityTags: ['managed', 'production'],
        wipCap: 5,
        color: '#ef4444',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.fields.affinityTags.value).toEqual(['managed', 'production'])
    expect(body.fields.wipCap.value).toBe(5)
    expect(body.fields.color.value).toBe('#ef4444')
  })

  it('honours If-Match: matching revision succeeds', async () => {
    const before = await getIdentity()
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      headers: { 'if-match': before.revision },
      payload: { description: 'Updated under If-Match' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.fields.description.value).toBe('Updated under If-Match')
  })

  it('honours If-Match: stale revision returns 412', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      headers: { 'if-match': '0000000000000000' },
      payload: { description: 'Should not apply' },
    })
    expect(res.statusCode).toBe(412)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(body.currentRevision).toMatch(/^[0-9a-f]{16}$/)
  })

  it('rejects rename — name field must use claim endpoint', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: { name: 'reborn' },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/claim/)
  })

  it('rejects unknown agent with 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/does-not-exist/identity',
      payload: { displayName: 'Anyone' },
    })
    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(false)
  })

  it('validates types — wipCap must be a positive integer', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: { wipCap: 0 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('validates types — color must match hex/rgb pattern', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: { color: 'periwinkle' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('validates types — voice must match recognised ID shape', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: { voice: 'sounds-nice' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('empty body is a no-op that still rotates nothing and returns 200', async () => {
    const before = await getIdentity()
    const res = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.revision).toBe(before.revision)
  })

  it('GET shape and PATCH response shape match (revision math is consistent)', async () => {
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/agents/genesis/identity',
      payload: { displayName: 'Genesis Prime' },
    })
    const patchBody = JSON.parse(patchRes.body)
    const getBody = await getIdentity()
    // success/agentId differ in framing but every per-field envelope must agree.
    expect(patchBody.fields).toEqual(getBody.fields)
    expect(patchBody.revision).toBe(getBody.revision)
  })
})
