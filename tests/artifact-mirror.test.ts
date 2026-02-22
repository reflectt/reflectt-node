// Tests for artifact mirror + status heartbeat policy
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

describe('Artifact Mirror', () => {
  let tempDir: string
  let sourceDir: string
  let sharedDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'artifact-mirror-test-'))
    sourceDir = join(tempDir, 'workspace')
    sharedDir = join(tempDir, 'workspace-shared')

    // Create mock workspace structure
    await fs.mkdir(join(sourceDir, 'process', 'task-test-123'), { recursive: true })
    await fs.writeFile(join(sourceDir, 'process', 'task-test-123', 'review.md'), '# Review\nTest artifact')
    await fs.writeFile(join(sourceDir, 'process', 'task-test-123', 'proof.png'), 'fake-png')
    await fs.writeFile(join(sourceDir, 'process', 'task-single-file.md'), '# Single file artifact')
    await fs.mkdir(sharedDir, { recursive: true })

    // Set env BEFORE importing the module
    process.env.REFLECTT_WORKSPACE = sourceDir
    process.env.REFLECTT_SHARED_WORKSPACE = sharedDir
  })

  afterAll(async () => {
    delete process.env.REFLECTT_WORKSPACE
    delete process.env.REFLECTT_SHARED_WORKSPACE
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  it('mirrors a directory artifact to shared workspace', async () => {
    // Dynamic import so env vars are resolved
    const mod = await import('../src/artifact-mirror.js')
    const result = await mod.mirrorArtifacts('process/task-test-123')
    expect(result.mirrored).toBe(true)
    expect(result.filesCopied).toBe(2)

    const reviewContent = await fs.readFile(join(sharedDir, 'process', 'task-test-123', 'review.md'), 'utf-8')
    expect(reviewContent).toContain('# Review')
  })

  it('mirrors a single file artifact', async () => {
    const mod = await import('../src/artifact-mirror.js')
    const result = await mod.mirrorArtifacts('process/task-single-file.md')
    expect(result.mirrored).toBe(true)
    expect(result.filesCopied).toBe(1)
  })

  it('returns error for non-process paths', async () => {
    const mod = await import('../src/artifact-mirror.js')
    const result = await mod.mirrorArtifacts('src/server.ts')
    expect(result.mirrored).toBe(false)
    expect(result.error).toContain('Not a process/')
  })

  it('returns error for non-existent source', async () => {
    const mod = await import('../src/artifact-mirror.js')
    const result = await mod.mirrorArtifacts('process/does-not-exist')
    expect(result.mirrored).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('Status Heartbeat Policy', () => {
  it('policy includes statusHeartbeat config with defaults', async () => {
    const { policyManager } = await import('../src/policy.js')
    const policy = policyManager.get()
    expect((policy as any).statusHeartbeat).toBeDefined()
    expect((policy as any).statusHeartbeat.enabled).toBe(true)
    expect((policy as any).statusHeartbeat.intervalMin).toBe(30)
    expect((policy as any).statusHeartbeat.graceMin).toBe(10)
    expect((policy as any).statusHeartbeat.escalationChannel).toBe('general')
  })
})
