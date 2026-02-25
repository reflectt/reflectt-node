import { describe, expect, it, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

describe('Contacts Directory', () => {
  let app: FastifyInstance
  let createdId: string

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
    await app.ready()
  })

  it('POST /contacts creates a contact', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/contacts',
      payload: {
        name: 'Alice Smith',
        org: 'Acme Corp',
        emails: ['alice@acme.com'],
        handles: { discord: 'alice#1234', github: 'alicesmith' },
        tags: ['pilot', 'enterprise'],
        notes: 'Interested in team plan. Met at Discord community.',
        source: 'discord community',
        owner: 'echo',
        related_task_ids: ['task-abc']
      }
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.contact.id).toMatch(/^contact-/)
    expect(body.contact.name).toBe('Alice Smith')
    expect(body.contact.org).toBe('Acme Corp')
    expect(body.contact.emails).toEqual(['alice@acme.com'])
    expect(body.contact.handles.github).toBe('alicesmith')
    expect(body.contact.tags).toEqual(['pilot', 'enterprise'])
    expect(body.contact.owner).toBe('echo')
    createdId = body.contact.id
  })

  it('POST /contacts requires name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/contacts',
      payload: { org: 'No Name Corp' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /contacts minimal — name only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/contacts',
      payload: { name: 'Bob Minimal' }
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.contact.name).toBe('Bob Minimal')
    expect(body.contact.emails).toEqual([])
    expect(body.contact.tags).toEqual([])
  })

  it('GET /contacts lists contacts', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.contacts)).toBe(true)
    expect(body.contacts.length).toBeGreaterThanOrEqual(2)
    expect(typeof body.total).toBe('number')
  })

  it('GET /contacts filters by org', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts?org=Acme Corp' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const c of body.contacts) {
      expect(c.org).toBe('Acme Corp')
    }
  })

  it('GET /contacts filters by tag', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts?tag=pilot' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.contacts.length).toBeGreaterThan(0)
    for (const c of body.contacts) {
      expect(c.tags).toContain('pilot')
    }
  })

  it('GET /contacts filters by owner', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts?owner=echo' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const c of body.contacts) {
      expect(c.owner).toBe('echo')
    }
  })

  it('GET /contacts text search with q', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts?q=alice' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.contacts.length).toBeGreaterThan(0)
  })

  it('GET /contacts filters by name', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts?name=Alice' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.contacts.length).toBeGreaterThan(0)
  })

  it('GET /contacts/:id returns single contact', async () => {
    const res = await app.inject({ method: 'GET', url: `/contacts/${createdId}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.contact.id).toBe(createdId)
    expect(body.contact.name).toBe('Alice Smith')
  })

  it('GET /contacts/:id returns 404 for missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/contacts/contact-nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /contacts/:id updates contact', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/contacts/${createdId}`,
      payload: {
        notes: 'Upgraded to paid plan',
        tags: ['pilot', 'enterprise', 'paid'],
        last_contact: Date.now()
      }
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.contact.notes).toBe('Upgraded to paid plan')
    expect(body.contact.tags).toContain('paid')
    expect(body.contact.last_contact).toBeGreaterThan(0)
  })

  it('PATCH /contacts/:id returns 404 for missing', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/contacts/contact-nonexistent',
      payload: { name: 'nope' }
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /contacts/:id removes contact', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/contacts/${createdId}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.deleted).toBe(true)

    // Verify gone
    const getRes = await app.inject({ method: 'GET', url: `/contacts/${createdId}` })
    expect(getRes.statusCode).toBe(404)
  })

  it('DELETE /contacts/:id returns 404 for missing', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/contacts/contact-nonexistent' })
    expect(res.statusCode).toBe(404)
  })
})
