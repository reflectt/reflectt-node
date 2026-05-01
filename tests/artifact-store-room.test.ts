// Room Share Snapshot v0 slice 5A + Camera Snapshot v0 slice C-image-A:
// tests for the artifact-store extensions (kind filter, sinceMs filter,
// updateArtifactMetadata, pruneImageArtifactsForRetention). The room
// flow piles all room-scoped artifacts under agentId=ROOM_ARTIFACT_AGENT_ID
// with metadata.kind as the discriminator — these tests pin that contract.
// Shared-pool retention (kai msg-1777619980384 R1-3) verified separately.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { promises as fs } from 'fs'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

let tempHome: string

beforeAll(async () => {
  tempHome = await fs.mkdtemp(join(tmpdir(), 'artifact-store-room-test-'))
  // homedir() honors HOME on darwin/linux; REFLECTT_HOME pins the DB path.
  process.env.HOME = tempHome
  process.env.REFLECTT_HOME = join(tempHome, '.reflectt')
})

afterAll(async () => {
  delete process.env.REFLECTT_HOME
  await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {})
})

describe('artifact-store room extensions', () => {
  beforeEach(async () => {
    // Wipe DB rows + storage between tests so retention math is deterministic.
    const mod = await import('../src/artifact-store.js')
    const dbMod = await import('../src/db.js')
    dbMod.getDb().prepare('DELETE FROM artifacts WHERE agent_id = ?').run(mod.ROOM_ARTIFACT_AGENT_ID)
  })

  function storeSnapshot(name: string, kind: string = 'snapshot', extraMeta: Record<string, unknown> = {}) {
    // Need a real png-ish buffer on disk since storeArtifact writeFileSyncs.
    // Content can be anything — these tests don't read it back.
    return import('../src/artifact-store.js').then((mod) =>
      mod.storeArtifact({
        agentId: mod.ROOM_ARTIFACT_AGENT_ID,
        name,
        mimeType: 'image/png',
        content: Buffer.from('fake-png'),
        metadata: { kind, ...extraMeta },
      })
    )
  }

  it('listArtifacts({kind}) only returns matching kind', async () => {
    const mod = await import('../src/artifact-store.js')
    await storeSnapshot('a.png', 'snapshot')
    await storeSnapshot('b.png', 'snapshot')
    await storeSnapshot('c.png', 'recording')

    const snapshots = mod.listArtifacts({ agentId: mod.ROOM_ARTIFACT_AGENT_ID, kind: 'snapshot' })
    expect(snapshots).toHaveLength(2)
    expect(snapshots.every((a) => a.metadata.kind === 'snapshot')).toBe(true)

    const recordings = mod.listArtifacts({ agentId: mod.ROOM_ARTIFACT_AGENT_ID, kind: 'recording' })
    expect(recordings).toHaveLength(1)
    expect(recordings[0].name).toBe('c.png')
  })

  it('listArtifacts({sinceMs}) drops older items', async () => {
    const mod = await import('../src/artifact-store.js')
    const a = await storeSnapshot('a.png')
    await new Promise((r) => setTimeout(r, 10))
    const b = await storeSnapshot('b.png')

    const after = mod.listArtifacts({
      agentId: mod.ROOM_ARTIFACT_AGENT_ID,
      sinceMs: b.createdAt,
    })
    expect(after.map((x) => x.id)).toEqual([b.id])
    expect(after.map((x) => x.id)).not.toContain(a.id)
  })

  it('updateArtifactMetadata merges keys without dropping prior ones', async () => {
    const mod = await import('../src/artifact-store.js')
    const a = await storeSnapshot('a.png', 'snapshot', { sharedBy: 'p-1', sharedByDisplayName: 'Ryan' })
    const updated = mod.updateArtifactMetadata(a.id, {
      thumbnailPath: '/tmp/thumb.png',
      dimensions: { width: 1920, height: 1080 },
    })
    expect(updated).not.toBeNull()
    expect(updated!.metadata.kind).toBe('snapshot')
    expect(updated!.metadata.sharedBy).toBe('p-1')
    expect(updated!.metadata.sharedByDisplayName).toBe('Ryan')
    expect(updated!.metadata.thumbnailPath).toBe('/tmp/thumb.png')
    expect((updated!.metadata.dimensions as { width: number }).width).toBe(1920)

    // Re-fetch from DB to confirm persistence.
    const reread = mod.getArtifact(a.id)
    expect(reread!.metadata.thumbnailPath).toBe('/tmp/thumb.png')
  })

  it('updateArtifactMetadata returns null for unknown id (sweep-eviction race)', async () => {
    const mod = await import('../src/artifact-store.js')
    expect(mod.updateArtifactMetadata('art-nonexistent', { x: 1 })).toBeNull()
  })

  it('pruneImageArtifactsForRetention(agentId, [snapshot], max=2) keeps the newest 2 snapshots and deletes thumbs', async () => {
    const mod = await import('../src/artifact-store.js')
    const items = [] as Awaited<ReturnType<typeof storeSnapshot>>[]
    for (let i = 0; i < 5; i++) {
      const a = await storeSnapshot(`a${i}.png`)
      // Plant a fake thumbnail file at the metadata-tracked path so eviction
      // exercises the unlink branch.
      const thumbPath = a.storagePath.replace(/\.png$/i, '') + '-thumb.png'
      writeFileSync(thumbPath, 'fake-thumb')
      mod.updateArtifactMetadata(a.id, { thumbnailPath: thumbPath })
      items.push({ ...a, storagePath: a.storagePath })
      await new Promise((r) => setTimeout(r, 5)) // force createdAt ordering
    }

    const result = mod.pruneImageArtifactsForRetention(mod.ROOM_ARTIFACT_AGENT_ID, ['snapshot'], 2)
    expect(result.removed).toBe(3)

    const remaining = mod.listArtifacts({
      agentId: mod.ROOM_ARTIFACT_AGENT_ID,
      kind: 'snapshot',
      limit: 100,
    })
    expect(remaining).toHaveLength(2)
    // Newest 2 survived (indexes 4 and 3).
    expect(remaining.map((r) => r.name).sort()).toEqual(['a3.png', 'a4.png'])

    // Evicted thumbnails are gone from disk.
    for (const it of items.slice(0, 3)) {
      const thumbPath = it.storagePath.replace(/\.png$/i, '') + '-thumb.png'
      expect(existsSync(thumbPath)).toBe(false)
    }
  })

  it('pruneImageArtifactsForRetention is a no-op when union count <= max', async () => {
    const mod = await import('../src/artifact-store.js')
    await storeSnapshot('only.png')
    expect(mod.pruneImageArtifactsForRetention(mod.ROOM_ARTIFACT_AGENT_ID, ['snapshot', 'camera-snapshot'], 20))
      .toEqual({ removed: 0 })
  })

  // ── Camera Snapshot v0 (Cut C-image) ─────────────────────────────────
  // Shared-pool retention: snapshot + camera-snapshot count against ONE
  // pool of `max`. A new image of either kind can evict an older image
  // of either kind. Pinning kai's R1-3 lock (msg-1777619980384).

  it('pruneImageArtifactsForRetention shared-pool: a camera-snapshot can evict an older snapshot', async () => {
    const mod = await import('../src/artifact-store.js')

    // 2 screen snapshots first (older), then 1 camera snapshot (newest).
    // With max=2 across the union, the OLDEST screen snapshot must evict.
    const oldScreen = await storeSnapshot('old-screen.png', 'snapshot')
    await new Promise((r) => setTimeout(r, 5))
    const newerScreen = await storeSnapshot('newer-screen.png', 'snapshot')
    await new Promise((r) => setTimeout(r, 5))
    const camera = await storeSnapshot('cam.png', 'camera-snapshot')

    const result = mod.pruneImageArtifactsForRetention(
      mod.ROOM_ARTIFACT_AGENT_ID,
      ['snapshot', 'camera-snapshot'],
      2,
    )
    expect(result.removed).toBe(1)

    // The oldest screen snapshot is gone; the newer screen + camera survive.
    const allKinds = mod.listArtifacts({ agentId: mod.ROOM_ARTIFACT_AGENT_ID, limit: 100 })
    const surviving = new Set(allKinds.map((a) => a.id))
    expect(surviving.has(oldScreen.id)).toBe(false)
    expect(surviving.has(newerScreen.id)).toBe(true)
    expect(surviving.has(camera.id)).toBe(true)
  })

  it('pruneImageArtifactsForRetention shared-pool: a snapshot can evict an older camera-snapshot', async () => {
    const mod = await import('../src/artifact-store.js')

    // Inverse of above — proves eviction is kind-agnostic, not snapshot-priority.
    const oldCamera = await storeSnapshot('old-cam.png', 'camera-snapshot')
    await new Promise((r) => setTimeout(r, 5))
    const newerCamera = await storeSnapshot('newer-cam.png', 'camera-snapshot')
    await new Promise((r) => setTimeout(r, 5))
    const screen = await storeSnapshot('s.png', 'snapshot')

    mod.pruneImageArtifactsForRetention(
      mod.ROOM_ARTIFACT_AGENT_ID,
      ['snapshot', 'camera-snapshot'],
      2,
    )

    const allKinds = mod.listArtifacts({ agentId: mod.ROOM_ARTIFACT_AGENT_ID, limit: 100 })
    const surviving = new Set(allKinds.map((a) => a.id))
    expect(surviving.has(oldCamera.id)).toBe(false)
    expect(surviving.has(newerCamera.id)).toBe(true)
    expect(surviving.has(screen.id)).toBe(true)
  })

  it('pruneImageArtifactsForRetention only counts kinds in the kinds list', async () => {
    const mod = await import('../src/artifact-store.js')

    // 5 recordings (a hypothetical future kind not in the image kinds list)
    // + 2 snapshots — with max=2 and kinds=['snapshot'], no eviction should happen.
    for (let i = 0; i < 5; i++) {
      await storeSnapshot(`r${i}.png`, 'recording')
      await new Promise((r) => setTimeout(r, 2))
    }
    await storeSnapshot('s1.png', 'snapshot')
    await storeSnapshot('s2.png', 'snapshot')

    const result = mod.pruneImageArtifactsForRetention(
      mod.ROOM_ARTIFACT_AGENT_ID,
      ['snapshot'],
      2,
    )
    expect(result.removed).toBe(0)

    // Recordings are untouched (different kind, not in the prune list).
    const recordings = mod.listArtifacts({
      agentId: mod.ROOM_ARTIFACT_AGENT_ID,
      kind: 'recording',
      limit: 100,
    })
    expect(recordings).toHaveLength(5)
  })
})
