// Tests for shared-workspace read API — path validation, traversal protection, symlink defense
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  validatePath,
  validatePathWithRealpath,
  listSharedFiles,
  readSharedFile,
  resolveTaskArtifact,
  ALLOWED_EXTENSIONS,
} from '../src/shared-workspace-api.js'

// ── Test fixtures ──
// We override REFLECTT_SHARED_WORKSPACE to a temp directory for isolation.

let testRoot: string
let processDir: string
const originalEnv = process.env.REFLECTT_SHARED_WORKSPACE

beforeAll(async () => {
  testRoot = resolve(tmpdir(), `shared-ws-test-${Date.now()}`)
  processDir = join(testRoot, 'process')
  await fs.mkdir(processDir, { recursive: true })

  // Create test files
  await fs.writeFile(join(processDir, 'task-abc-proof.md'), '# Proof\nThis is a proof artifact.\n')
  await fs.writeFile(join(processDir, 'task-abc-qa.json'), '{"passed": true}')
  await fs.writeFile(join(processDir, 'task-abc-notes.txt'), 'Some plain text notes')
  await fs.writeFile(join(processDir, 'task-abc-log.log'), 'Line 1\nLine 2\nLine 3')
  await fs.writeFile(join(processDir, 'task-abc-config.yml'), 'key: value')

  // Create a subdirectory
  await fs.mkdir(join(processDir, 'task-deep'), { recursive: true })
  await fs.writeFile(join(processDir, 'task-deep', 'details.md'), '# Deep artifact')

  // Create a disallowed file type
  await fs.writeFile(join(processDir, 'evil.exe'), 'not really')
  await fs.writeFile(join(processDir, 'script.sh'), '#!/bin/bash')

  // Create outside-root directory for symlink tests
  await fs.mkdir(join(testRoot, '..', `outside-root-${Date.now()}`), { recursive: true }).catch(() => {})

  process.env.REFLECTT_SHARED_WORKSPACE = testRoot
})

afterAll(async () => {
  process.env.REFLECTT_SHARED_WORKSPACE = originalEnv
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {})
})

// ── validatePath (synchronous checks) ──

describe('validatePath', () => {
  it('rejects absolute paths', () => {
    expect(() => validatePath('/etc/passwd')).toThrow('Absolute paths')
    expect(() => validatePath('/process/foo.md')).toThrow('Absolute paths')
  })

  it('rejects Windows drive letter paths', () => {
    expect(() => validatePath('C:\\Users\\me')).toThrow('Absolute paths')
    expect(() => validatePath('D:process/foo')).toThrow('Absolute paths')
  })

  it('rejects .. traversal', () => {
    expect(() => validatePath('process/../../etc/passwd')).toThrow('traversal')
    expect(() => validatePath('../outside')).toThrow('traversal')
    expect(() => validatePath('process/../../../root')).toThrow('traversal')
  })

  it('rejects paths outside allowed prefixes', () => {
    expect(() => validatePath('src/server.ts')).toThrow('must start with')
    expect(() => validatePath('node_modules/foo')).toThrow('must start with')
    expect(() => validatePath('.env')).toThrow('must start with')
  })

  it('accepts valid process/ paths', () => {
    const result = validatePath('process/task-abc-proof.md')
    expect(result).toContain('process')
    expect(result).toContain('task-abc-proof.md')
  })

  it('accepts process/ directory itself', () => {
    const result = validatePath('process/')
    expect(result).toContain('process')
  })

  it('accepts nested process/ paths', () => {
    const result = validatePath('process/task-deep/details.md')
    expect(result).toContain('task-deep')
  })
})

// ── validatePathWithRealpath (async, symlink defense) ──

describe('validatePathWithRealpath', () => {
  it('resolves valid paths', async () => {
    const result = await validatePathWithRealpath('process/task-abc-proof.md')
    expect(result).toBeTruthy()
  })

  it('rejects nonexistent paths', async () => {
    await expect(validatePathWithRealpath('process/does-not-exist.md')).rejects.toThrow('does not exist')
  })

  it('rejects absolute paths', async () => {
    await expect(validatePathWithRealpath('/etc/passwd')).rejects.toThrow('Absolute paths')
  })

  it('rejects traversal', async () => {
    await expect(validatePathWithRealpath('process/../../etc/passwd')).rejects.toThrow('traversal')
  })

  // Symlink escape test
  it('rejects symlinks pointing outside root', async () => {
    const linkPath = join(processDir, 'escape-link')
    const outsidePath = resolve(testRoot, '..')

    try {
      await fs.symlink(outsidePath, linkPath)
    } catch {
      // symlink creation might fail on some systems — skip test
      return
    }

    try {
      await expect(validatePathWithRealpath('process/escape-link')).rejects.toThrow('symlink escape')
    } finally {
      await fs.unlink(linkPath).catch(() => {})
    }
  })

  // Symlink within root should work
  it('accepts symlinks staying inside root', async () => {
    const linkPath = join(processDir, 'internal-link.md')

    try {
      await fs.symlink(join(processDir, 'task-abc-proof.md'), linkPath)
    } catch {
      return // skip if symlinks not supported
    }

    try {
      const result = await validatePathWithRealpath('process/internal-link.md')
      expect(result).toBeTruthy()
    } finally {
      await fs.unlink(linkPath).catch(() => {})
    }
  })
})

// ── listSharedFiles ──

describe('listSharedFiles', () => {
  it('lists files in process/', async () => {
    const result = await listSharedFiles('process/')
    expect(result.success).toBe(true)
    expect(result.entries.length).toBeGreaterThan(0)

    // Should have our test files
    const names = result.entries.map(e => e.name)
    expect(names).toContain('task-abc-proof.md')
    expect(names).toContain('task-abc-qa.json')
    expect(names).toContain('task-abc-notes.txt')
  })

  it('excludes disallowed file extensions', async () => {
    const result = await listSharedFiles('process/')
    expect(result.success).toBe(true)
    const names = result.entries.map(e => e.name)
    expect(names).not.toContain('evil.exe')
    expect(names).not.toContain('script.sh')
  })

  it('lists directories', async () => {
    const result = await listSharedFiles('process/')
    expect(result.success).toBe(true)
    const dirs = result.entries.filter(e => e.type === 'directory')
    const dirNames = dirs.map(d => d.name)
    expect(dirNames).toContain('task-deep')
  })

  it('sorts directories first, then by name', async () => {
    const result = await listSharedFiles('process/')
    expect(result.success).toBe(true)
    const types = result.entries.map(e => e.type)
    const firstFileIdx = types.indexOf('file')
    const lastDirIdx = types.lastIndexOf('directory')
    if (firstFileIdx >= 0 && lastDirIdx >= 0) {
      expect(lastDirIdx).toBeLessThan(firstFileIdx)
    }
  })

  it('respects limit parameter', async () => {
    const result = await listSharedFiles('process/', 2)
    expect(result.success).toBe(true)
    expect(result.entries.length).toBeLessThanOrEqual(2)
  })

  it('rejects path traversal', async () => {
    const result = await listSharedFiles('process/../../')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/traversal/i)
  })

  it('rejects paths outside allowed prefixes', async () => {
    const result = await listSharedFiles('src/')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/must start with/i)
  })

  it('skips symlinks pointing outside root', async () => {
    const linkPath = join(processDir, 'outside-dir-link')
    const outsidePath = resolve(testRoot, '..')

    try {
      await fs.symlink(outsidePath, linkPath)
    } catch {
      return // skip if symlinks not supported
    }

    try {
      const result = await listSharedFiles('process/')
      expect(result.success).toBe(true)
      const names = result.entries.map(e => e.name)
      expect(names).not.toContain('outside-dir-link')
    } finally {
      await fs.unlink(linkPath).catch(() => {})
    }
  })

  it('returns error for non-directory paths', async () => {
    const result = await listSharedFiles('process/task-abc-proof.md')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not a directory/i)
  })
})

// ── readSharedFile ──

describe('readSharedFile', () => {
  it('reads a markdown file', async () => {
    const result = await readSharedFile('process/task-abc-proof.md')
    expect(result.success).toBe(true)
    expect(result.file).toBeDefined()
    expect(result.file!.content).toContain('# Proof')
    expect(result.file!.source).toBe('shared-workspace')
  })

  it('reads a JSON file', async () => {
    const result = await readSharedFile('process/task-abc-qa.json')
    expect(result.success).toBe(true)
    expect(result.file!.content).toContain('"passed"')
  })

  it('reads a text file', async () => {
    const result = await readSharedFile('process/task-abc-notes.txt')
    expect(result.success).toBe(true)
    expect(result.file!.content).toContain('plain text')
  })

  it('reads a log file', async () => {
    const result = await readSharedFile('process/task-abc-log.log')
    expect(result.success).toBe(true)
    expect(result.file!.content).toContain('Line 1')
  })

  it('reads a yml file', async () => {
    const result = await readSharedFile('process/task-abc-config.yml')
    expect(result.success).toBe(true)
    expect(result.file!.content).toContain('key: value')
  })

  it('rejects disallowed extensions', async () => {
    const result = await readSharedFile('process/evil.exe')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not allowed/i)
  })

  it('returns preview mode (truncated content)', async () => {
    const result = await readSharedFile('process/task-abc-proof.md', { preview: true, maxChars: 10 })
    expect(result.success).toBe(true)
    expect(result.file!.content.length).toBeLessThanOrEqual(10)
    expect(result.file!.truncated).toBe(true)
  })

  it('rejects traversal', async () => {
    const result = await readSharedFile('process/../../etc/passwd')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/traversal/i)
  })

  it('rejects absolute paths', async () => {
    const result = await readSharedFile('/etc/passwd')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Absolute/i)
  })

  it('returns error for nonexistent files', async () => {
    const result = await readSharedFile('process/nonexistent.md')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not exist/i)
  })

  it('rejects reading directories', async () => {
    const result = await readSharedFile('process/task-deep')
    expect(result.success).toBe(false)
    // Should fail because directories don't have an extension match, or because it's not a file
  })

  it('enforces size limit on large files', async () => {
    const bigPath = join(processDir, 'big.md')
    await fs.writeFile(bigPath, 'x'.repeat(500 * 1024)) // 500KB > 400KB limit
    try {
      const result = await readSharedFile('process/big.md')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/size limit/i)
    } finally {
      await fs.unlink(bigPath).catch(() => {})
    }
  })
})

// ── resolveTaskArtifact ──

describe('resolveTaskArtifact', () => {
  let wsRoot: string

  beforeAll(async () => {
    // Create a separate workspace root for testing
    wsRoot = resolve(tmpdir(), `ws-root-test-${Date.now()}`)
    await fs.mkdir(join(wsRoot, 'process'), { recursive: true })
    await fs.writeFile(join(wsRoot, 'process', 'ws-artifact.md'), '# From workspace')
  })

  afterAll(async () => {
    await fs.rm(wsRoot, { recursive: true, force: true }).catch(() => {})
  })

  it('finds artifact in workspace root first', async () => {
    const result = await resolveTaskArtifact('process/ws-artifact.md', wsRoot)
    expect(result.accessible).toBe(true)
    expect(result.source).toBe('workspace')
    expect(result.type).toBe('file')
  })

  it('falls back to shared workspace when not in workspace root', async () => {
    // task-abc-proof.md exists in shared workspace but not in wsRoot
    const result = await resolveTaskArtifact('process/task-abc-proof.md', wsRoot)
    expect(result.accessible).toBe(true)
    expect(result.source).toBe('shared-workspace')
  })

  it('returns missing for nonexistent artifacts', async () => {
    const result = await resolveTaskArtifact('process/does-not-exist.md', wsRoot)
    expect(result.accessible).toBe(false)
    expect(result.type).toBe('missing')
  })

  it('rejects path traversal', async () => {
    const result = await resolveTaskArtifact('process/../../etc/passwd', wsRoot)
    expect(result.accessible).toBe(false)
    expect(result.type).toBe('missing')
  })

  it('rejects absolute paths', async () => {
    const result = await resolveTaskArtifact('/etc/passwd', wsRoot)
    expect(result.accessible).toBe(false)
  })

  it('returns preview for text files', async () => {
    const result = await resolveTaskArtifact('process/task-abc-proof.md', wsRoot)
    expect(result.accessible).toBe(true)
    expect(result.preview).toContain('# Proof')
  })

  it('handles empty artifact path', async () => {
    const result = await resolveTaskArtifact('', wsRoot)
    expect(result.accessible).toBe(false)
    expect(result.type).toBe('missing')
  })
})
