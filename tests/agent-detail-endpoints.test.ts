// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance
let sandbox: string
let savedHome: string | undefined

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'agent-detail-endpoints-'))
  savedHome = process.env.OPENCLAW_HOME
  process.env.OPENCLAW_HOME = sandbox

  // Seed claude workspace with all top-level files + 2 daily memories
  const root = join(sandbox, 'workspace-claude')
  mkdirSync(join(root, 'memory'), { recursive: true })
  writeFileSync(join(root, 'SOUL.md'), '# I am claude\n')
  writeFileSync(join(root, 'MEMORY.md'), '# Memory index\n- [pinned](pinned.md)\n')
  writeFileSync(join(root, 'HEARTBEAT.md'), '# Heartbeat\nlast tick: 2026-04-22T07:00:00Z\n')
  writeFileSync(join(root, 'memory', '2026-04-21.md'), '# 2026-04-21\nentry one')
  writeFileSync(join(root, 'memory', '2026-04-20.md'), '# 2026-04-20\nentry zero')

  // Seed a second agent with 35 days of memory — proves totalMemoryDays is honest
  // beyond the 30-day list cap surfaced by /detail.
  const farRoot = join(sandbox, 'workspace-archivist')
  mkdirSync(join(farRoot, 'memory'), { recursive: true })
  for (let i = 0; i < 35; i++) {
    const d = new Date(Date.UTC(2026, 2, 1 + i)) // 2026-03-01 .. 2026-04-04
    const iso = d.toISOString().slice(0, 10)
    writeFileSync(join(farRoot, 'memory', `${iso}.md`), `# ${iso}\nday ${i}`)
  }

  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
  if (savedHome === undefined) delete process.env.OPENCLAW_HOME
  else process.env.OPENCLAW_HOME = savedHome
  rmSync(sandbox, { recursive: true, force: true })
})

// Fastify's `app.inject` reports the source IP as `127.0.0.1` by default,
// which satisfies the loopbackOnly gate. To prove the gate works, we override
// the `x-forwarded-for` header — but that won't change `request.ip` in the
// default trust-proxy mode. The simplest assertion of the gate is to check
// that loopback access succeeds on every endpoint. We add one explicit
// non-loopback test by spoofing remote address through inject's `remoteAddress`.

async function req(method: string, url: string, opts?: { remoteAddress?: string }) {
  const res = await app.inject({ method: method as any, url, remoteAddress: opts?.remoteAddress })
  let body: any = res.body
  try { body = JSON.parse(res.body) } catch {}
  return { status: res.statusCode, body }
}

describe('agent detail endpoints — happy path (loopback)', () => {
  it('GET /agents/:name/detail returns the join shape with heartbeat pointer', async () => {
    const { status, body } = await req('GET', '/agents/claude/detail')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.agent).toBe('claude')
    expect(body.soul).toMatchObject({ relPath: 'SOUL.md' })
    expect(body.soul.size).toBeGreaterThan(0)
    expect(body.memoryIndex).toMatchObject({ relPath: 'MEMORY.md' })
    expect(body.heartbeat).toMatchObject({ relPath: 'HEARTBEAT.md' })
    expect(body.heartbeat.size).toBeGreaterThan(0)
    expect(body.latestMemoryDay).toMatchObject({ date: '2026-04-21' })
    expect(body.memoryDaysReturned).toBe(2)
    expect(body.totalMemoryDays).toBe(2)
    expect(body.memoryDays.map((d: any) => d.date)).toEqual(['2026-04-21', '2026-04-20'])
    expect(body).toHaveProperty('identityClaimedAt')
  })

  it('GET /agents/:name/detail reports honest totalMemoryDays beyond list cap', async () => {
    const { status, body } = await req('GET', '/agents/archivist/detail')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    // /detail caps the returned list at 30 — but totalMemoryDays must be the real count.
    expect(body.memoryDaysReturned).toBe(30)
    expect(body.totalMemoryDays).toBe(35)
    expect(body.memoryDays.length).toBe(30)
  })

  it('GET /agents/:name/memory lists days desc', async () => {
    const { status, body } = await req('GET', '/agents/claude/memory')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.days.map((d: any) => d.date)).toEqual(['2026-04-21', '2026-04-20'])
  })

  it('GET /agents/:name/memory/:date returns the body', async () => {
    const { status, body } = await req('GET', '/agents/claude/memory/2026-04-21')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.date).toBe('2026-04-21')
    expect(body.file.exists).toBe(true)
    expect(body.file.content).toMatch(/entry one/)
  })

  it('GET /agents/:name/memory/:date returns 404 for missing date', async () => {
    const { status, body } = await req('GET', '/agents/claude/memory/2099-01-01')
    expect(status).toBe(404)
    expect(body.success).toBe(false)
  })

  it('GET /agents/:name/soul returns pointer only by default', async () => {
    const { status, body } = await req('GET', '/agents/claude/soul')
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.exists).toBe(true)
    expect(body.pointer.relPath).toBe('SOUL.md')
    expect(body.file).toBeNull()
  })

  it('GET /agents/:name/soul?include=body returns the file', async () => {
    const { status, body } = await req('GET', '/agents/claude/soul?include=body')
    expect(status).toBe(200)
    expect(body.exists).toBe(true)
    expect(body.file.content).toMatch(/I am claude/)
  })
})

describe('agent detail endpoints — input validation', () => {
  it('rejects bad agent name with 400', async () => {
    const { status } = await req('GET', '/agents/Bad..Name/detail')
    expect(status).toBe(400)
  })

  it('rejects bad date with 400', async () => {
    const { status } = await req('GET', '/agents/claude/memory/2026-4-21')
    expect(status).toBe(400)
  })
})

describe('agent detail endpoints — loopback gate', () => {
  it('returns 403 to non-loopback caller', async () => {
    const { status, body } = await req('GET', '/agents/claude/detail', {
      remoteAddress: '203.0.113.7',
    })
    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/Forbidden/)
  })

  it('returns 403 on /memory from non-loopback', async () => {
    const { status } = await req('GET', '/agents/claude/memory', {
      remoteAddress: '203.0.113.7',
    })
    expect(status).toBe(403)
  })

  it('returns 403 on /memory/:date from non-loopback', async () => {
    const { status } = await req('GET', '/agents/claude/memory/2026-04-21', {
      remoteAddress: '203.0.113.7',
    })
    expect(status).toBe(403)
  })

  it('returns 403 on /soul from non-loopback', async () => {
    const { status } = await req('GET', '/agents/claude/soul', {
      remoteAddress: '203.0.113.7',
    })
    expect(status).toBe(403)
  })
})
