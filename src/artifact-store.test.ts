// SPDX-License-Identifier: Apache-2.0
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

interface Artifact { id: string; agentId: string; runId: string | null; taskId: string | null; name: string; mimeType: string; sizeBytes: number; content: Buffer }

class InMemoryArtifactStore {
  private artifacts: Artifact[] = []
  private counter = 0

  store(agentId: string, name: string, content: string | Buffer, opts?: { runId?: string; taskId?: string; mimeType?: string }): Artifact {
    const buf = typeof content === 'string' ? Buffer.from(content) : content
    const art: Artifact = {
      id: `art-${++this.counter}`,
      agentId, name,
      runId: opts?.runId ?? null,
      taskId: opts?.taskId ?? null,
      mimeType: opts?.mimeType ?? this.guessMime(name),
      sizeBytes: buf.length,
      content: buf,
    }
    this.artifacts.push(art)
    return art
  }

  get(id: string): Artifact | null { return this.artifacts.find(a => a.id === id) ?? null }
  read(id: string): Buffer | null { return this.get(id)?.content ?? null }

  list(opts: { agentId?: string; runId?: string; taskId?: string }): Artifact[] {
    return this.artifacts.filter(a => {
      if (opts.agentId && a.agentId !== opts.agentId) return false
      if (opts.runId && a.runId !== opts.runId) return false
      if (opts.taskId && a.taskId !== opts.taskId) return false
      return true
    })
  }

  delete(id: string): boolean {
    const idx = this.artifacts.findIndex(a => a.id === id)
    if (idx === -1) return false
    this.artifacts.splice(idx, 1)
    return true
  }

  usage(agentId: string): { totalBytes: number; count: number } {
    const mine = this.artifacts.filter(a => a.agentId === agentId)
    return { totalBytes: mine.reduce((sum, a) => sum + a.sizeBytes, 0), count: mine.length }
  }

  private guessMime(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase()
    if (ext === 'json') return 'application/json'
    if (ext === 'md') return 'text/markdown'
    if (ext === 'png') return 'image/png'
    return 'application/octet-stream'
  }

  clear() { this.artifacts = []; this.counter = 0 }
}

describe('artifact store', () => {
  let store: InMemoryArtifactStore

  beforeEach(() => { store = new InMemoryArtifactStore() })

  it('stores and retrieves artifact', () => {
    const art = store.store('link', 'report.md', '# Report')
    assert.ok(art.id.startsWith('art-'))
    assert.equal(art.name, 'report.md')
    assert.equal(art.mimeType, 'text/markdown')
    assert.equal(art.sizeBytes, 8)
  })

  it('reads content back', () => {
    const art = store.store('link', 'data.json', '{"key":"value"}')
    const content = store.read(art.id)
    assert.ok(content)
    assert.equal(content.toString(), '{"key":"value"}')
  })

  it('returns null for missing artifact', () => {
    assert.equal(store.get('nonexistent'), null)
    assert.equal(store.read('nonexistent'), null)
  })

  it('links artifact to run', () => {
    store.store('link', 'log.txt', 'run output', { runId: 'arun-123' })
    const results = store.list({ runId: 'arun-123' })
    assert.equal(results.length, 1)
    assert.equal(results[0].runId, 'arun-123')
  })

  it('links artifact to task', () => {
    store.store('link', 'screenshot.png', Buffer.alloc(100), { taskId: 'task-456' })
    const results = store.list({ taskId: 'task-456' })
    assert.equal(results.length, 1)
  })

  it('lists by agent', () => {
    store.store('link', 'a.md', 'aaa')
    store.store('kai', 'b.md', 'bbb')
    store.store('link', 'c.md', 'ccc')
    assert.equal(store.list({ agentId: 'link' }).length, 2)
    assert.equal(store.list({ agentId: 'kai' }).length, 1)
  })

  it('deletes artifact', () => {
    const art = store.store('link', 'temp.txt', 'temp')
    assert.equal(store.delete(art.id), true)
    assert.equal(store.get(art.id), null)
    assert.equal(store.delete(art.id), false)
  })

  it('tracks storage usage', () => {
    store.store('link', 'a.txt', 'hello') // 5 bytes
    store.store('link', 'b.txt', 'world!') // 6 bytes
    const usage = store.usage('link')
    assert.equal(usage.count, 2)
    assert.equal(usage.totalBytes, 11)
  })

  it('uses correct MIME types', () => {
    assert.equal(store.store('link', 'file.json', '{}').mimeType, 'application/json')
    assert.equal(store.store('link', 'file.md', '#').mimeType, 'text/markdown')
    assert.equal(store.store('link', 'file.png', Buffer.alloc(1)).mimeType, 'image/png')
    assert.equal(store.store('link', 'file.xyz', 'x').mimeType, 'application/octet-stream')
  })

  it('allows custom MIME type override', () => {
    const art = store.store('link', 'data.bin', 'custom', { mimeType: 'application/x-custom' })
    assert.equal(art.mimeType, 'application/x-custom')
  })
})
