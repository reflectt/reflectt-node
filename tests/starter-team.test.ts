import { describe, expect, it, afterEach } from 'vitest'
import { createStarterTeam, STARTER_AGENTS } from '../src/starter-team.js'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('starter-team', () => {
  const testDirs: string[] = []

  afterEach(async () => {
    for (const dir of testDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
    testDirs.length = 0
  })

  it('creates default starter agents with SOUL.md and AGENTS.md', async () => {
    const baseDir = join(tmpdir(), `starter-team-test-${Date.now()}`)
    testDirs.push(baseDir)

    const result = await createStarterTeam({ baseDir })

    expect(result.created).toEqual(['builder', 'ops'])
    expect(result.skipped).toEqual([])
    expect(result.teamDir).toBe(baseDir)

    // Verify files exist
    for (const agent of STARTER_AGENTS) {
      const soul = await fs.readFile(join(baseDir, agent.name, 'SOUL.md'), 'utf-8')
      expect(soul).toContain(agent.name.charAt(0).toUpperCase())

      const agents = await fs.readFile(join(baseDir, agent.name, 'AGENTS.md'), 'utf-8')
      expect(agents).toContain(agent.role)
    }
  })

  it('is idempotent — skips existing agent directories', async () => {
    const baseDir = join(tmpdir(), `starter-team-test-${Date.now()}`)
    testDirs.push(baseDir)

    // First run
    const result1 = await createStarterTeam({ baseDir })
    expect(result1.created.length).toBeGreaterThan(0)

    // Second run — should skip everything
    const result2 = await createStarterTeam({ baseDir })
    expect(result2.created).toEqual([])
    expect(result2.skipped.length).toBe(STARTER_AGENTS.length)
  })

  it('accepts custom agents', async () => {
    const baseDir = join(tmpdir(), `starter-team-test-${Date.now()}`)
    testDirs.push(baseDir)

    const result = await createStarterTeam({
      baseDir,
      agents: [
        { name: 'custom', role: 'specialist', description: 'A custom agent', soulMd: '# Custom\nHello' },
      ],
    })

    expect(result.created).toEqual(['custom'])
    const soul = await fs.readFile(join(baseDir, 'custom', 'SOUL.md'), 'utf-8')
    expect(soul).toContain('Custom')
  })
})
