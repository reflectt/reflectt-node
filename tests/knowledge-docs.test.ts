import { describe, it, expect, beforeEach } from 'vitest'
import { createDoc, getDoc, listDocs, updateDoc, deleteDoc, countDocs, VALID_CATEGORIES, type DocCategory } from '../src/knowledge-docs.js'

function clearDocs() {
  const docs = listDocs({ limit: 500 })
  for (const d of docs) {
    deleteDoc(d.id)
  }
}

describe('Knowledge Docs CRUD', () => {
  beforeEach(() => {
    clearDocs()
  })

  describe('createDoc', () => {
    it('creates a document with all fields', () => {
      const doc = createDoc({
        title: 'How to deploy',
        content: '# Deploy\n\n1. Push to main\n2. CI runs\n3. Auto-deploy',
        category: 'how-to',
        author: 'link',
        tags: ['deploy', 'ci'],
        related_task_ids: ['task-123'],
        related_insight_ids: ['ins-456'],
      })

      expect(doc.id).toMatch(/^kdoc-/)
      expect(doc.title).toBe('How to deploy')
      expect(doc.content).toContain('# Deploy')
      expect(doc.category).toBe('how-to')
      expect(doc.author).toBe('link')
      expect(doc.tags).toEqual(['deploy', 'ci'])
      expect(doc.related_task_ids).toEqual(['task-123'])
      expect(doc.related_insight_ids).toEqual(['ins-456'])
      expect(doc.created_at).toBeGreaterThan(0)
    })

    it('creates with minimal fields', () => {
      const doc = createDoc({
        title: 'Minimal doc',
        content: 'Just some content',
        category: 'decision',
        author: 'sage',
      })

      expect(doc.tags).toEqual([])
      expect(doc.related_task_ids).toEqual([])
    })

    it('validates required fields', () => {
      expect(() => createDoc({ title: '', content: 'x', category: 'decision', author: 'link' }))
        .toThrow('title is required')
      expect(() => createDoc({ title: 'x', content: '', category: 'decision', author: 'link' }))
        .toThrow('content is required')
      expect(() => createDoc({ title: 'x', content: 'x', category: 'invalid' as any, author: 'link' }))
        .toThrow('category must be one of')
      expect(() => createDoc({ title: 'x', content: 'x', category: 'decision', author: '' }))
        .toThrow('author is required')
    })

    it('accepts all valid categories', () => {
      for (const cat of VALID_CATEGORIES) {
        const doc = createDoc({
          title: `Test ${cat}`,
          content: `Content for ${cat}`,
          category: cat,
          author: 'link',
        })
        expect(doc.category).toBe(cat)
      }
    })
  })

  describe('getDoc', () => {
    it('returns a doc by id', () => {
      const created = createDoc({ title: 'Get test', content: 'content', category: 'runbook', author: 'link' })
      const found = getDoc(created.id)
      expect(found).not.toBeNull()
      expect(found!.title).toBe('Get test')
    })

    it('returns null for missing id', () => {
      expect(getDoc('nonexistent')).toBeNull()
    })
  })

  describe('listDocs', () => {
    it('lists all docs', () => {
      createDoc({ title: 'A', content: 'content', category: 'decision', author: 'link' })
      createDoc({ title: 'B', content: 'content', category: 'runbook', author: 'sage' })

      const docs = listDocs()
      expect(docs.length).toBe(2)
    })

    it('filters by category', () => {
      createDoc({ title: 'Decision doc', content: 'content', category: 'decision', author: 'link' })
      createDoc({ title: 'Runbook doc', content: 'content', category: 'runbook', author: 'link' })

      const decisions = listDocs({ category: 'decision' })
      expect(decisions.length).toBe(1)
      expect(decisions[0].title).toBe('Decision doc')
    })

    it('filters by author', () => {
      createDoc({ title: 'By link', content: 'content', category: 'decision', author: 'link' })
      createDoc({ title: 'By sage', content: 'content', category: 'decision', author: 'sage' })

      const linkDocs = listDocs({ author: 'link' })
      expect(linkDocs.length).toBe(1)
      expect(linkDocs[0].author).toBe('link')
    })

    it('filters by tag', () => {
      createDoc({ title: 'Tagged', content: 'content', category: 'how-to', author: 'link', tags: ['deploy', 'ci'] })
      createDoc({ title: 'No tag', content: 'content', category: 'how-to', author: 'link' })

      const tagged = listDocs({ tag: 'deploy' })
      expect(tagged.length).toBe(1)
      expect(tagged[0].title).toBe('Tagged')
    })

    it('searches in title and content', () => {
      createDoc({ title: 'Deploy guide', content: 'Push to main', category: 'how-to', author: 'link' })
      createDoc({ title: 'Auth design', content: 'JWT tokens', category: 'architecture', author: 'link' })

      const results = listDocs({ search: 'deploy' })
      expect(results.length).toBe(1)
      expect(results[0].title).toBe('Deploy guide')
    })
  })

  describe('updateDoc', () => {
    it('updates title and content', () => {
      const doc = createDoc({ title: 'Original', content: 'Old content', category: 'decision', author: 'link' })
      const updated = updateDoc(doc.id, { title: 'Updated', content: 'New content' })

      expect(updated).not.toBeNull()
      expect(updated!.title).toBe('Updated')
      expect(updated!.content).toBe('New content')
      expect(updated!.updated_at).toBeGreaterThanOrEqual(doc.updated_at)
    })

    it('updates tags', () => {
      const doc = createDoc({ title: 'T', content: 'C', category: 'lesson', author: 'link', tags: ['old'] })
      const updated = updateDoc(doc.id, { tags: ['new', 'tags'] })
      expect(updated!.tags).toEqual(['new', 'tags'])
    })

    it('returns null for missing doc', () => {
      expect(updateDoc('nonexistent', { title: 'x' })).toBeNull()
    })

    it('validates category on update', () => {
      const doc = createDoc({ title: 'T', content: 'C', category: 'decision', author: 'link' })
      expect(() => updateDoc(doc.id, { category: 'invalid' as any })).toThrow('category must be one of')
    })
  })

  describe('deleteDoc', () => {
    it('deletes a doc', () => {
      const doc = createDoc({ title: 'Delete me', content: 'content', category: 'lesson', author: 'link' })
      expect(deleteDoc(doc.id)).toBe(true)
      expect(getDoc(doc.id)).toBeNull()
    })

    it('returns false for missing doc', () => {
      expect(deleteDoc('nonexistent')).toBe(false)
    })
  })

  describe('countDocs', () => {
    it('counts all docs', () => {
      createDoc({ title: 'A', content: 'c', category: 'decision', author: 'link' })
      createDoc({ title: 'B', content: 'c', category: 'runbook', author: 'link' })
      expect(countDocs()).toBe(2)
    })

    it('counts by category', () => {
      createDoc({ title: 'A', content: 'c', category: 'decision', author: 'link' })
      createDoc({ title: 'B', content: 'c', category: 'runbook', author: 'link' })
      expect(countDocs('decision')).toBe(1)
      expect(countDocs('runbook')).toBe(1)
    })
  })
})
