import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('avatar bootstrap seeding', () => {
  const originalEnv = { ...process.env }
  let tempDir = ''

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'reflectt-avatar-seed-'))
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.resetModules()
    vi.unmock('../src/agent-config.js')
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  async function importAssignmentWithSeedSpy() {
    const calls: string[][] = []
    process.env.REFLECTT_HOME = tempDir
    process.env.NODE_ENV = 'development'
    delete process.env.VITEST

    vi.doMock('../src/agent-config.js', () => ({
      seedAgentAvatars: vi.fn((ids: string[]) => {
        calls.push([...ids])
        return ids.length
      }),
    }))

    const assignment = await import('../src/assignment.js')
    return { assignment, calls }
  }

  it('seeds avatars when TEAM-ROLES loads from bootstrap output', async () => {
    writeFileSync(join(tempDir, 'TEAM-ROLES.yaml'), `agents:\n  - name: kai\n    role: builder\n    affinityTags: [backend]\n    wipCap: 2\n  - name: link\n    role: ops\n    affinityTags: [infra]\n    wipCap: 2\n`, 'utf-8')

    const { assignment, calls } = await importAssignmentWithSeedSpy()
    const result = assignment.loadAgentRoles()

    expect(result.roles.map(role => role.name)).toEqual(['kai', 'link'])
    expect(calls).toEqual([['kai', 'link']])
  })

  it('seeds avatars when routing policy saves agent roles', async () => {
    const { assignment, calls } = await importAssignmentWithSeedSpy()

    assignment.saveAgentRoles([
      { name: 'pixel', role: 'designer', affinityTags: ['ui'], wipCap: 1 },
      { name: 'claude', role: 'analyst', affinityTags: ['docs'], wipCap: 1 },
    ])

    expect(calls).toEqual([['pixel', 'claude']])
  })
})
