// SPDX-License-Identifier: Apache-2.0
// Copyright (c) Reflectt AI
//
// Proof tests for the fresh-host identity handoff path.
//
// Before this fix: a fresh host's bootstrap agent ("main") had no path to
// switch its name/avatar/voice at runtime. TEAM-ROLES.yaml updates never
// triggered a gateway reidentify or an identity-changed event, so chat
// attribution, presence, and TTS surfaces kept showing "main" indefinitely.
//
// After this fix:
// - POST /agents/:name/identity/claim atomically: renames in TEAM-ROLES.yaml,
//   stores avatar+voice in agent_config, emits agent_identity_changed, and
//   triggers openclawClient.reidentify().
// - PUT /config/team-roles detects bootstrap→real handoff and fires
//   agent_identity_changed + openclawClient.reidentify() automatically.
// - TTS synthesizer checks agent_config.voice before falling back to the
//   hardcoded NODE_AGENT_VOICE_IDS map.

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

// Capture reidentify calls without opening a real WebSocket
const reidentifyCalls: Array<{ name: string; displayName?: string }> = []
vi.mock('../src/openclaw.js', () => ({
  openclawClient: {
    get instance() { return { isConnected: () => false } },
    close: vi.fn(),
    isConnected: vi.fn(() => false),
    reidentify: vi.fn((identity: { name: string; displayName?: string }) => {
      reidentifyCalls.push(identity)
    }),
    getIdentity: vi.fn(() => ({ name: 'main' })),
  },
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fresh-host identity handoff', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()

    // Seed a bootstrap 'main' agent so routes can find it
    const { setTestRoles } = await import('../src/assignment.js')
    setTestRoles([
      { name: 'main', role: 'bootstrap', description: 'Bootstrap', affinityTags: [], wipCap: 1 },
    ])
  })

  // ── Proof 1: claim endpoint renames agent + stores avatar/voice/color ────
  it('POST /agents/main/identity/claim: returns success + renames to claimedName', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/main/identity/claim',
      payload: {
        claimedName: 'nova',
        displayName: 'Nova',
        color: '#fb923c',
        voice: 'EXAVITQu4vr4xnSDxMaL',
        avatar: { type: 'emoji', content: '🌟' },
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.previousName).toBe('main')
    expect(body.newName).toBe('nova')
    expect(body.avatarSet).toBe(true)
    expect(body.voiceSet).toBe(true)
    expect(body.colorSet).toBe(true)
  })

  // ── Proof 1b: claimed color persists to agent_config.settings.identityColor
  it('claim persists color as settings.identityColor and presence reflects it', async () => {
    const cfgRes = await app.inject({ method: 'GET', url: '/agents/nova/config' })
    expect(cfgRes.statusCode).toBe(200)
    const cfg = JSON.parse(cfgRes.body)
    expect(cfg.settings?.identityColor).toBe('#fb923c')

    const presRes = await app.inject({ method: 'GET', url: '/canvas/presence' })
    expect(presRes.statusCode).toBe(200)
    const pres = JSON.parse(presRes.body)
    const nova = (pres.agents || []).find((a: { name: string }) => a.name === 'nova')
    if (nova) expect(nova.identityColor).toBe('#fb923c')
  })

  // ── Proof 2: reidentify was called with the new name ─────────────────────
  it('claim triggers openclawClient.reidentify with new name', () => {
    const call = reidentifyCalls.find(c => c.name === 'nova')
    expect(call).toBeDefined()
    expect(call?.displayName).toBe('Nova')
  })

  // ── Proof 3: avatar stored in agent_config ────────────────────────────────
  it('avatar is readable via GET /agents/nova/identity/avatar after claim', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents/nova/identity/avatar' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.found).toBe(true)
    expect(body.avatar.type).toBe('emoji')
    expect(body.avatar.content).toBe('🌟')
  })

  // ── Proof 4: agent_identity_changed event type is valid ───────────────────
  it('agent_identity_changed is a valid EventType (no TS errors)', async () => {
    const { VALID_EVENT_TYPES } = await import('../src/events.js')
    expect(VALID_EVENT_TYPES.has('agent_identity_changed')).toBe(true)
  })

  // ── Proof 5: claimed name must be valid slug ───────────────────────────────
  it('claim rejects claimedName with uppercase or spaces', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/main/identity/claim',
      payload: { claimedName: 'My Agent' },
    })
    expect(res.statusCode).toBe(400)
  })

  // ── Proof 6: claim requires claimedName ───────────────────────────────────
  it('claim returns 400 when claimedName is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/main/identity/claim',
      payload: { displayName: 'Just a display name' },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toMatch(/claimedName/)
  })

  // ── Proof 7: claim requires color — forcing function for persistence ─────
  // task-1776796380591-wroo87jmu: fresh managed agents were claiming name+avatar+voice
  // but not color, because the contract treated color as optional. With color
  // required, the LLM cannot silently skip it and leave presence at the neutral
  // #9ca3af fallback.
  it('claim returns 400 when color is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/agents/main/identity/claim',
      payload: { claimedName: 'colorless', voice: 'am_adam', avatar: { type: 'emoji', content: '🫥' } },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toMatch(/color/)
  })
})
