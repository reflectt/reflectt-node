import { describe, expect, it, beforeAll } from 'vitest'
import type { FastifyInstance } from 'fastify'

describe('Knowledge Docs CRUD', () => {
  let app: FastifyInstance
  let createdDocId: string

  beforeAll(async () => {
    const { createServer } = await import('../src/server.js')
    app = await createServer()
    await app.ready()
  })

  it('POST /knowledge/docs creates a document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/docs',
      payload: {
        title: 'Deploy Runbook: reflectt-node',
        content: '## Steps\n1. git pull\n2. npm run build\n3. launchctl restart\n4. Verify /health',
        category: 'runbook',
        author: 'link',
        tags: ['deploy', 'ops'],
        related_task_ids: ['task-123'],
        metadata: { test_harness: true }
      }
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.doc.id).toMatch(/^kdoc-/)
    expect(body.doc.title).toBe('Deploy Runbook: reflectt-node')
    expect(body.doc.category).toBe('runbook')
    expect(body.doc.tags).toEqual(['deploy', 'ops'])
    expect(body.doc.related_task_ids).toEqual(['task-123'])
    createdDocId = body.doc.id
  })

  it('POST /knowledge/docs rejects missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/docs',
      payload: { title: 'Missing stuff' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /knowledge/docs rejects invalid category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/knowledge/docs',
      payload: {
        title: 'Bad Cat',
        content: 'test',
        category: 'invalid-category',
        author: 'link'
      }
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toContain('Invalid category')
  })

  it('GET /knowledge/docs lists documents', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/knowledge/docs'
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.docs)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(body.docs.length).toBeGreaterThan(0)
  })

  it('GET /knowledge/docs filters by category', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/knowledge/docs?category=runbook'
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const doc of body.docs) {
      expect(doc.category).toBe('runbook')
    }
  })

  it('GET /knowledge/docs filters by tag', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/knowledge/docs?tag=deploy'
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.docs.length).toBeGreaterThan(0)
    for (const doc of body.docs) {
      expect(doc.tags).toContain('deploy')
    }
  })

  it('GET /knowledge/docs filters by author', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/knowledge/docs?author=link'
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    for (const doc of body.docs) {
      expect(doc.author).toBe('link')
    }
  })

  it('GET /knowledge/docs text search with q', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/knowledge/docs?q=Deploy'
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.docs.length).toBeGreaterThan(0)
  })

  it('GET /knowledge/docs/:id returns single doc', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/knowledge/docs/${createdDocId}`
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.doc.id).toBe(createdDocId)
    expect(body.doc.title).toBe('Deploy Runbook: reflectt-node')
  })

  it('GET /knowledge/docs/:id returns 404 for missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/knowledge/docs/kdoc-nonexistent'
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH /knowledge/docs/:id updates document', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/knowledge/docs/${createdDocId}`,
      payload: {
        title: 'Deploy Runbook: reflectt-node (updated)',
        tags: ['deploy', 'ops', 'production'],
        category: 'runbook'
      }
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.success).toBe(true)
    expect(body.doc.title).toBe('Deploy Runbook: reflectt-node (updated)')
    expect(body.doc.tags).toEqual(['deploy', 'ops', 'production'])
    expect(body.doc.updated_at).toBeGreaterThan(body.doc.created_at)
  })

  it('PATCH /knowledge/docs/:id rejects invalid category', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/knowledge/docs/${createdDocId}`,
      payload: { category: 'bogus' }
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH /knowledge/docs/:id returns 404 for missing', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/knowledge/docs/kdoc-nonexistent',
      payload: { title: 'nope' }
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE /knowledge/docs/:id removes document', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/knowledge/docs/${createdDocId}`
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.deleted).toBe(true)

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/knowledge/docs/${createdDocId}`
    })
    expect(getRes.statusCode).toBe(404)
  })

  it('DELETE /knowledge/docs/:id returns 404 for missing', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/knowledge/docs/kdoc-nonexistent'
    })
    expect(res.statusCode).toBe(404)
  })

  it('all 5 categories are accepted', async () => {
    const categories = ['decision', 'runbook', 'architecture', 'lesson', 'how-to']
    for (const cat of categories) {
      const res = await app.inject({
        method: 'POST',
        url: '/knowledge/docs',
        payload: {
          title: `Test ${cat}`,
          content: `Content for ${cat}`,
          category: cat,
          author: 'test',
          metadata: { test_harness: true }
        }
      })
      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.body)
      expect(body.doc.category).toBe(cat)
    }
  })
})
