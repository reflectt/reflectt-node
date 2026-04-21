import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resetBootstrapState } from '../src/manage.js'

describe('resetBootstrapState', () => {
  it('archives bootstrap state, workspaces, tasks, and agent configs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reflectt-reset-bootstrap-'))
    const reflecttHome = join(root, 'reflectt-home')
    const dataDir = join(reflecttHome, 'data')
    await mkdir(dataDir, { recursive: true })
    await mkdir(join(reflecttHome, 'workspace-main'), { recursive: true })
    await mkdir(join(reflecttHome, 'workspace-link'), { recursive: true })

    await writeFile(join(reflecttHome, 'TEAM.md'), '# team\n', 'utf-8')
    await writeFile(join(reflecttHome, 'TEAM-ROLES.yaml'), 'agents:\n  - name: main\n', 'utf-8')
    await writeFile(join(dataDir, '.first-boot-done'), 'done\n', 'utf-8')
    await writeFile(join(dataDir, 'TEAM_INTENT.md'), 'build a team\n', 'utf-8')
    await writeFile(join(dataDir, 'restart-context.json'), '{"restart":true}\n', 'utf-8')
    await writeFile(join(reflecttHome, 'workspace-main', 'AGENTS.md'), '# main\n', 'utf-8')
    await writeFile(join(reflecttHome, 'workspace-link', 'AGENTS.md'), '# link\n', 'utf-8')

    const deletedTaskIds: string[] = []
    const deletedAgentConfigIds: string[] = []
    let presenceCleared = false

    const result = await resetBootstrapState({
      reflecttHome,
      dataDir,
      now: () => 1234567890,
      taskManager: {
        listTasks: () => [{ id: 'task-1' }, { id: 'task-2' }],
        deleteTask: async (id: string) => {
          deletedTaskIds.push(id)
          return true
        },
      },
      presenceManager: {
        clearAll: () => {
          presenceCleared = true
        },
      },
      listAgentConfigs: () => [{ agentId: 'main' }, { agentId: 'link' }],
      deleteAgentConfig: (agentId: string) => {
        deletedAgentConfigIds.push(agentId)
        return true
      },
      clearFocusStates: () => 2,
    })

    expect(result.archiveDir).toBe(join(dataDir, 'reset-bootstrap', 'rb-1234567890'))
    expect(result.moved.reflecttHomeFiles).toEqual(['TEAM.md', 'TEAM-ROLES.yaml'])
    expect(result.moved.dataFiles).toEqual(['.first-boot-done', 'TEAM_INTENT.md', 'restart-context.json'])
    expect(result.moved.workspaces.sort()).toEqual(['workspace-link', 'workspace-main'])
    expect(result.deletedTasks).toBe(2)
    expect(result.clearedAgentConfigs).toBe(2)
    expect(result.clearedFocusStates).toBe(2)
    expect(result.presenceCleared).toBe(true)
    expect(deletedTaskIds).toEqual(['task-1', 'task-2'])
    expect(deletedAgentConfigIds).toEqual(['main', 'link'])
    expect(presenceCleared).toBe(true)

    await expect(access(join(reflecttHome, 'TEAM.md'))).rejects.toThrow()
    await expect(access(join(dataDir, '.first-boot-done'))).rejects.toThrow()
    await expect(access(join(reflecttHome, 'workspace-main'))).rejects.toThrow()

    expect(await readFile(join(result.archiveDir, 'reflectt-home', 'TEAM.md'), 'utf-8')).toContain('# team')
    expect(await readFile(join(result.archiveDir, 'data', '.first-boot-done'), 'utf-8')).toContain('done')
    expect(await readFile(join(result.archiveDir, 'workspaces', 'workspace-link', 'AGENTS.md'), 'utf-8')).toContain('# link')
  })
})
