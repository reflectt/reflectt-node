import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resetFirstBootState } from '../src/manage.js'

describe('resetFirstBootState', () => {
  it('moves first-boot artifacts into backup and deletes live tasks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reflectt-reset-first-boot-'))
    const reflecttHome = join(root, '.reflectt')
    const dataDir = join(reflecttHome, 'data')
    const agentsDir = join(dataDir, 'agents')
    mkdirSync(agentsDir, { recursive: true })

    writeFileSync(join(dataDir, '.first-boot-done'), 'done\n', 'utf-8')
    writeFileSync(join(dataDir, 'TEAM_INTENT.md'), '# Team Intent\n', 'utf-8')
    mkdirSync(join(agentsDir, 'main'), { recursive: true })
    mkdirSync(join(agentsDir, 'kai'), { recursive: true })
    writeFileSync(join(reflecttHome, 'TEAM-ROLES.yaml'), 'agents: []\n', 'utf-8')

    const deleted: string[] = []
    const summary = await resetFirstBootState({
      reflecttHome,
      dataDir,
      now: () => 12345,
      listTasks: () => [{ id: 'task-1' }, { id: 'task-2' }],
      deleteTask: async (taskId) => {
        deleted.push(taskId)
        return true
      },
    })

    expect(summary.removedMarker).toBe(true)
    expect(summary.removedTeamRoles).toBe(true)
    expect(summary.movedAgentEntries.sort()).toEqual(['kai', 'main'])
    expect(summary.deletedTaskIds).toEqual(['task-1', 'task-2'])
    expect(summary.removedBackupDir).toBe(false)
    expect(summary.backupDir).toBe(join(dataDir, '_bootstrap_resets', 'reset-12345'))

    expect(existsSync(join(dataDir, '.first-boot-done'))).toBe(false)
    expect(existsSync(join(reflecttHome, 'TEAM-ROLES.yaml'))).toBe(false)
    expect(existsSync(join(dataDir, 'TEAM_INTENT.md'))).toBe(true)
    expect(readdirSync(agentsDir)).toEqual([])
    expect(existsSync(join(summary.backupDir, 'data.first-boot-done.bak'))).toBe(true)
    expect(existsSync(join(summary.backupDir, 'TEAM-ROLES.yaml.bak'))).toBe(true)
    expect(existsSync(join(summary.backupDir, 'agents', 'main'))).toBe(true)
    expect(existsSync(join(summary.backupDir, 'agents', 'kai'))).toBe(true)

    expect(deleted).toEqual(['task-1', 'task-2'])

    rmSync(root, { recursive: true, force: true })
  })

  it('removes the empty backup directory when nothing needed resetting', async () => {
    const root = mkdtempSync(join(tmpdir(), 'reflectt-reset-first-boot-'))
    const reflecttHome = join(root, '.reflectt')
    const dataDir = join(reflecttHome, 'data')
    mkdirSync(dataDir, { recursive: true })

    const summary = await resetFirstBootState({
      reflecttHome,
      dataDir,
      now: () => 999,
      listTasks: () => [],
      deleteTask: async () => true,
    })

    expect(summary.removedMarker).toBe(false)
    expect(summary.removedTeamRoles).toBe(false)
    expect(summary.movedAgentEntries).toEqual([])
    expect(summary.deletedTaskIds).toEqual([])
    expect(summary.removedBackupDir).toBe(true)
    expect(existsSync(summary.backupDir)).toBe(false)

    rmSync(root, { recursive: true, force: true })
  })
})
