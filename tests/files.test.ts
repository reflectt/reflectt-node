import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

describe('files', () => {
  let mod: typeof import('../src/files.js')

  beforeEach(async () => {
    mod = await import('../src/files.js')
    // Ensure files dir exists (uses REFLECTT_HOME from test env)
    mkdirSync(mod.FILES_DIR, { recursive: true })
    // Clean DB table between tests to avoid cross-test pollution
    const { getDb } = await import('../src/db.js')
    const db = getDb()
    try { db.exec('DELETE FROM files') } catch {}
  })

  afterEach(() => {
    // Clean up test files
    if (existsSync(mod.FILES_DIR)) {
      try { rmSync(mod.FILES_DIR, { recursive: true, force: true }) } catch {}
    }
  })

  it('uploads a valid file', () => {
    const result = mod.uploadFile({
      filename: 'test.pdf',
      buffer: Buffer.from('fake pdf content'),
      uploadedBy: 'ryan',
      tags: ['bank-statement'],
    })
    expect(result.success).toBe(true)
    expect(result.file).toBeDefined()
    expect(result.file!.originalName).toBe('test.pdf')
    expect(result.file!.mimeType).toBe('application/pdf')
    expect(result.file!.uploadedBy).toBe('ryan')
    expect(result.file!.tags).toEqual(['bank-statement'])
    expect(result.file!.sizeBytes).toBe(16)
    expect(result.file!.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects disallowed extensions', () => {
    const result = mod.uploadFile({
      filename: 'hack.exe',
      buffer: Buffer.from('malware'),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not allowed')
  })

  it('rejects oversized files', () => {
    // Create a buffer just over the limit
    const result = mod.uploadFile({
      filename: 'huge.pdf',
      buffer: Buffer.alloc(mod.MAX_SIZE_BYTES + 1),
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('50MB limit')
  })

  it('retrieves file by ID', () => {
    const upload = mod.uploadFile({
      filename: 'doc.txt',
      buffer: Buffer.from('hello world'),
    })
    expect(upload.success).toBe(true)

    const result = mod.readFile(upload.file!.id)
    expect(result).not.toBeNull()
    expect(result!.meta.originalName).toBe('doc.txt')
    expect(result!.buffer.toString()).toBe('hello world')
  })

  it('returns null for missing file', () => {
    expect(mod.getFile('nonexistent-id')).toBeNull()
    expect(mod.readFile('nonexistent-id')).toBeNull()
  })

  it('lists files', () => {
    mod.uploadFile({ filename: 'a.txt', buffer: Buffer.from('a'), uploadedBy: 'alice' })
    mod.uploadFile({ filename: 'b.pdf', buffer: Buffer.from('b'), uploadedBy: 'bob' })
    mod.uploadFile({ filename: 'c.txt', buffer: Buffer.from('c'), uploadedBy: 'alice', tags: ['important'] })

    const all = mod.listFiles()
    expect(all.total).toBe(3)
    expect(all.files.length).toBe(3)

    const byAlice = mod.listFiles({ uploadedBy: 'alice' })
    expect(byAlice.total).toBe(2)

    const byTag = mod.listFiles({ tag: 'important' })
    expect(byTag.total).toBe(1)
    expect(byTag.files[0].originalName).toBe('c.txt')
  })

  it('lists with pagination', () => {
    for (let i = 0; i < 5; i++) {
      mod.uploadFile({ filename: `file${i}.txt`, buffer: Buffer.from(`content ${i}`) })
    }
    const page1 = mod.listFiles({ limit: 2, offset: 0 })
    expect(page1.files.length).toBe(2)
    expect(page1.total).toBe(5)

    const page2 = mod.listFiles({ limit: 2, offset: 2 })
    expect(page2.files.length).toBe(2)
  })

  it('deletes a file', () => {
    const upload = mod.uploadFile({ filename: 'delete-me.txt', buffer: Buffer.from('bye') })
    expect(upload.success).toBe(true)

    const del = mod.deleteFile(upload.file!.id)
    expect(del.success).toBe(true)

    // Verify gone
    expect(mod.getFile(upload.file!.id)).toBeNull()
    expect(existsSync(upload.file!.storedPath)).toBe(false)
  })

  it('delete returns error for missing file', () => {
    const result = mod.deleteFile('nonexistent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('isImage detects image MIME types', () => {
    expect(mod.isImage('image/png')).toBe(true)
    expect(mod.isImage('image/jpeg')).toBe(true)
    expect(mod.isImage('application/pdf')).toBe(false)
    expect(mod.isImage('text/plain')).toBe(false)
  })

  it('supports all expected file types', () => {
    const types = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.csv', '.xlsx', '.txt', '.md', '.json', '.yaml', '.zip']
    for (const ext of types) {
      const result = mod.uploadFile({ filename: `test${ext}`, buffer: Buffer.from('x') })
      expect(result.success).toBe(true)
      expect(result.file!.mimeType).toBeTruthy()
    }
  })
})
