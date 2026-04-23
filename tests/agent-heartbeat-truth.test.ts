// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../src/server.js'
import { presenceManager, IDLE_THRESHOLD_MS, OFFLINE_THRESHOLD_MS } from '../src/presence.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let sandbox: string
let savedHome: string | undefined

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'agent-heartbeat-truth-'))
  savedHome = process.env.OPENCLAW_HOME
  process.env.OPENCLAW_HOME = sandbox

  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  if (savedHome === undefined) delete process.env.OPENCLAW_HOME
  else process.env.OPENCLAW_HOME = savedHome
  rmSync(sandbox, { recursive: true, force: true })
})

beforeEach(() => {
  presenceManager.clearAll()
})

async function req(method: string, url: string, opts?: { remoteAddress?: string }) {
  const res = await app.inject({
    method: method as any,
    url,
    remoteAddress: opts?.remoteAddress,
  })
  let body: any = res.body
  try { body = JSON.parse(res.body) } catch {}
  return { status: res.statusCode, body }
}

describe('GET /agents/:name/heartbeat', () => {
  it('returns offline defaults with thresholds when no presence', async () => {
    const { status, body } = await req('GET', '/agents/ghost-agent/heartbeat')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.agent).toBe('ghost-agent')
    expect(body.status).toBe('offline')
    expect(body.lastBeatAt).toBeNull()
    expect(body.sinceLastBeatMs).toBeNull()
    expect(body.beatsToday).toBe(0)
    expect(body.intervalMs).toBeGreaterThan(0)
    expect(body.idleThresholdMs).toBe(IDLE_THRESHOLD_MS)
    expect(body.offlineThresholdMs).toBe(OFFLINE_THRESHOLD_MS)
  })

  it('reports lastBeatAt and sinceLastBeatMs after a heartbeat tick', async () => {
    presenceManager.updatePresence('claude', 'working', 'task-7')
    presenceManager.recordActivity('claude', 'heartbeat')

    const { status, body } = await req('GET', '/agents/claude/heartbeat')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(typeof body.lastBeatAt).toBe('number')
    expect(typeof body.sinceLastBeatMs).toBe('number')
    expect(body.sinceLastBeatMs).toBeGreaterThanOrEqual(0)
    expect(body.status).toBe('working')
  })

  it('rejects bad agent name with 400', async () => {
    const { status } = await req('GET', '/agents/Bad..Name/heartbeat')
    expect(status).toBe(400)
  })

  it('returns 403 to public-internet caller', async () => {
    const { status } = await req('GET', '/agents/claude/heartbeat', {
      remoteAddress: '203.0.113.7',
    })
    expect(status).toBe(403)
  })

  it('accepts Fly 6PN caller (fdaa::/16) for cloud→node proxy', async () => {
    const { status, body } = await req('GET', '/agents/claude/heartbeat', {
      remoteAddress: 'fdaa:0:1234:a7b:1c2:3d4:5e6:7',
    })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })
})
