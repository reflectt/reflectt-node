import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../src/server.js'
import { deriveDmChannel } from '../src/chat.js'
import type { FastifyInstance } from 'fastify'

let app: FastifyInstance

beforeAll(async () => {
  process.env.REFLECTT_DATA_DIR = `/tmp/reflectt-test-dm-routing-${Date.now()}`
  app = await createServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

async function postChat(body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/chat/messages',
    payload: body,
  })
  expect(res.statusCode).toBe(200)
  return JSON.parse(res.body).message as {
    id: string
    from: string
    to?: string | null
    channel: string
    content: string
  }
}

describe('deriveDmChannel', () => {
  it('sorts endpoints so a→b and b→a hash identically', () => {
    expect(deriveDmChannel('claude', 'kai')).toBe('dm:claude_kai')
    expect(deriveDmChannel('kai', 'claude')).toBe('dm:claude_kai')
  })

  it('lowercases endpoints so case variants do not fork', () => {
    expect(deriveDmChannel('KAI', 'Claude')).toBe('dm:claude_kai')
  })

  it('trims whitespace from endpoints', () => {
    expect(deriveDmChannel(' claude ', 'kai')).toBe('dm:claude_kai')
  })
})

describe('POST /chat/messages — to: routing seam', () => {
  it('derives dm:<sorted> channel when to: is set and channel is absent', async () => {
    const msg = await postChat({ from: 'kai', to: 'claude', content: 'hey, sync on lane?' })
    expect(msg.channel).toBe('dm:claude_kai')
    expect(msg.to).toBe('claude')
  })

  it('does NOT land DM in #general anymore', async () => {
    const msg = await postChat({ from: 'compass', to: 'orbit', content: 'rolling to b67fd7d' })
    expect(msg.channel).not.toBe('general')
    expect(msg.channel).toBe('dm:compass_orbit')
  })

  it('explicit channel still wins over to: derivation', async () => {
    const msg = await postChat({
      from: 'claude', to: 'kai', channel: 'general',
      content: '@kai routing question for the room',
    })
    expect(msg.channel).toBe('general')
    expect(msg.to).toBe('kai')
  })

  it('no to: still goes to #general by default', async () => {
    const msg = await postChat({ from: 'claude', content: 'team broadcast' })
    expect(msg.channel).toBe('general')
  })
})
