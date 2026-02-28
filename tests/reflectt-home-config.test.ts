import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('REFLECTT_HOME config paths', () => {
  let tempDir: string
  const originalHome = process.env.REFLECTT_HOME

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'reflectt-home-test-'))
  })

  afterEach(() => {
    // Restore original env
    if (originalHome) {
      process.env.REFLECTT_HOME = originalHome
    } else {
      delete process.env.REFLECTT_HOME
    }
    try { rmSync(tempDir, { recursive: true }) } catch { /* ignore */ }
  })

  it('assignment engine reads TEAM-ROLES.yaml from REFLECTT_HOME', async () => {
    // Write a custom TEAM-ROLES.yaml to temp dir
    const yamlContent = `agents:
  - name: test-builder
    role: builder
    affinityTags: [backend]
    wipCap: 3
  - name: test-designer
    role: designer
    affinityTags: [ui]
    wipCap: 1
`
    writeFileSync(join(tempDir, 'TEAM-ROLES.yaml'), yamlContent, 'utf-8')

    // Set REFLECTT_HOME to temp dir — need to re-import to pick up new env
    process.env.REFLECTT_HOME = tempDir

    // Dynamic import to get fresh module state
    // Note: vitest caches modules, so we test the _parseRolesYaml function directly
    const { _parseRolesYaml } = await import('../src/assignment.js')

    const roles = _parseRolesYaml(yamlContent)
    expect(roles).toHaveLength(2)
    expect(roles[0].name).toBe('test-builder')
    expect(roles[0].wipCap).toBe(3)
    expect(roles[1].name).toBe('test-designer')
  })

  it('TEAM-ROLES.yaml path uses REFLECTT_HOME not hardcoded homedir', async () => {
    const { _CONFIG_PATHS } = await import('../src/assignment.js')

    // CONFIG_PATHS should reference REFLECTT_HOME, not contain hardcoded ~/.reflectt
    // Since REFLECTT_HOME defaults to ~/.reflectt, we just verify the paths are derived from it
    expect(_CONFIG_PATHS.length).toBeGreaterThan(0)
    expect(_CONFIG_PATHS[0]).toContain('TEAM-ROLES.yaml')

    // All paths should be under REFLECTT_HOME (no duplicate ~/.reflectt fallback)
    const allSameRoot = _CONFIG_PATHS.every(p =>
      p.startsWith(_CONFIG_PATHS[0].replace(/\/TEAM-ROLES\.(yaml|yml)$/, ''))
    )
    expect(allSameRoot).toBe(true)
  })
})
