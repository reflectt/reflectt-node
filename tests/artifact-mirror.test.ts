// Tests for artifact mirror + status heartbeat policy
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { tmpdir, homedir } from 'os'

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
    process.env.OPENCLAW_STATE_DIR = tempDir
    process.env.REFLECTT_WORKSPACE = sourceDir
    process.env.REFLECTT_SHARED_WORKSPACE = sharedDir
  })

  afterAll(async () => {
    delete process.env.OPENCLAW_STATE_DIR
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

  it('finds source artifact in OPENCLAW_STATE_DIR/workspace-<assignee> when REFLECTT_WORKSPACE is unset', async () => {
    const wsLink = join(tempDir, 'workspace-link')
    await fs.mkdir(join(wsLink, 'process', 'task-link-abc'), { recursive: true })
    await fs.writeFile(join(wsLink, 'process', 'task-link-abc', 'review.md'), '# Link artifact')

    const savedWorkspace = process.env.REFLECTT_WORKSPACE
    delete process.env.REFLECTT_WORKSPACE
    try {
      const mod = await import('../src/artifact-mirror.js')
      const result = await mod.mirrorArtifacts('process/task-link-abc', { assignee: 'link' })
      expect(result.mirrored).toBe(true)
      const content = await fs.readFile(join(sharedDir, 'process', 'task-link-abc', 'review.md'), 'utf-8')
      expect(content).toContain('# Link artifact')
    } finally {
      if (savedWorkspace !== undefined) process.env.REFLECTT_WORKSPACE = savedWorkspace
    }
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

describe('Shared Workspace Canonical Path', () => {
  it('defaults to ~/.openclaw/workspace-shared when REFLECTT_SHARED_WORKSPACE is unset', async () => {
    const savedWs = process.env.REFLECTT_SHARED_WORKSPACE
    const savedWorkspace = process.env.REFLECTT_WORKSPACE
    delete process.env.REFLECTT_SHARED_WORKSPACE
    delete process.env.REFLECTT_WORKSPACE
    try {
      // Dynamic re-import to pick up env changes
      const mod = await import('../src/artifact-mirror.js')
      const canonical = mod.SHARED_WORKSPACE()
      const expected = resolve(homedir(), '.openclaw', 'workspace-shared')
      expect(canonical).toBe(expected)
    } finally {
      // Restore env for other tests
      if (savedWs !== undefined) process.env.REFLECTT_SHARED_WORKSPACE = savedWs
      if (savedWorkspace !== undefined) process.env.REFLECTT_WORKSPACE = savedWorkspace
    }
  })

  it('respects REFLECTT_SHARED_WORKSPACE override', async () => {
    const savedWs = process.env.REFLECTT_SHARED_WORKSPACE
    process.env.REFLECTT_SHARED_WORKSPACE = '/custom/shared'
    try {
      const mod = await import('../src/artifact-mirror.js')
      expect(mod.SHARED_WORKSPACE()).toBe('/custom/shared')
    } finally {
      if (savedWs !== undefined) {
        process.env.REFLECTT_SHARED_WORKSPACE = savedWs
      } else {
        delete process.env.REFLECTT_SHARED_WORKSPACE
      }
    }
  })

  it('isSharedWorkspaceReady returns true when directory exists', async () => {
    const tmpShared = await fs.mkdtemp(join(tmpdir(), 'shared-ready-'))
    const saved = process.env.REFLECTT_SHARED_WORKSPACE
    process.env.REFLECTT_SHARED_WORKSPACE = tmpShared
    try {
      const mod = await import('../src/artifact-mirror.js')
      const ready = await mod.isSharedWorkspaceReady()
      expect(ready).toBe(true)
    } finally {
      if (saved !== undefined) process.env.REFLECTT_SHARED_WORKSPACE = saved
      else delete process.env.REFLECTT_SHARED_WORKSPACE
      await fs.rm(tmpShared, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('isSharedWorkspaceReady returns false when directory missing', async () => {
    const saved = process.env.REFLECTT_SHARED_WORKSPACE
    process.env.REFLECTT_SHARED_WORKSPACE = '/nonexistent/workspace-shared-test-xyz'
    try {
      const mod = await import('../src/artifact-mirror.js')
      const ready = await mod.isSharedWorkspaceReady()
      expect(ready).toBe(false)
    } finally {
      if (saved !== undefined) process.env.REFLECTT_SHARED_WORKSPACE = saved
      else delete process.env.REFLECTT_SHARED_WORKSPACE
    }
  })

  it('mirrorArtifacts writes to the canonical shared workspace path', async () => {
    // This is the key integration test: ensure mirroring actually writes
    // to the shared workspace path (not some relative sibling)
    const tmpBase = await fs.mkdtemp(join(tmpdir(), 'canonical-mirror-'))
    const wsDir = join(tmpBase, 'workspace')
    const sharedDir = join(tmpBase, 'shared')
    await fs.mkdir(join(wsDir, 'process', 'task-canonical-test'), { recursive: true })
    await fs.writeFile(join(wsDir, 'process', 'task-canonical-test', 'artifact.md'), '# Test')
    await fs.mkdir(sharedDir, { recursive: true })

    const savedWs = process.env.REFLECTT_WORKSPACE
    const savedShared = process.env.REFLECTT_SHARED_WORKSPACE
    process.env.REFLECTT_WORKSPACE = wsDir
    process.env.REFLECTT_SHARED_WORKSPACE = sharedDir
    try {
      const mod = await import('../src/artifact-mirror.js')
      const result = await mod.mirrorArtifacts('process/task-canonical-test')
      expect(result.mirrored).toBe(true)
      expect(result.destination).toBe(resolve(sharedDir, 'process', 'task-canonical-test'))
      // Verify file actually exists at destination
      const content = await fs.readFile(join(sharedDir, 'process', 'task-canonical-test', 'artifact.md'), 'utf-8')
      expect(content).toBe('# Test')
    } finally {
      if (savedWs !== undefined) process.env.REFLECTT_WORKSPACE = savedWs
      else delete process.env.REFLECTT_WORKSPACE
      if (savedShared !== undefined) process.env.REFLECTT_SHARED_WORKSPACE = savedShared
      else delete process.env.REFLECTT_SHARED_WORKSPACE
      await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})
    }
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
