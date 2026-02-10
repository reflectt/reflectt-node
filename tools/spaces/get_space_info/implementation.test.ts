import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import getSpaceInfo, { GetSpaceInfoInput } from './implementation'

describe('getSpaceInfo', () => {
  let tempDataDir: string
  let tempGlobalDir: string
  let tempSpacesDir: string

  beforeEach(() => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-data-'))
    tempGlobalDir = path.join(tempDataDir, 'global')
    tempSpacesDir = path.join(tempDataDir, 'spaces')
    fs.mkdirSync(tempGlobalDir, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true })
    }
  })

  describe('Success Cases', () => {
    it('should get basic space info without contents', async () => {
      const spacePath = path.join(tempSpacesDir, 'test-space')
      fs.mkdirSync(spacePath, { recursive: true })

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'test-space',
          description: 'Test space',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-02T00:00:00.000Z',
          metadata: { owner: 'test-user' }
        })
      )

      const result = await getSpaceInfo(
        { space_name: 'test-space' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.space_name).toBe('test-space')
      expect(result.description).toBe('Test space')
      expect(result.created_at).toBe('2025-01-01T00:00:00.000Z')
      expect(result.updated_at).toBe('2025-01-02T00:00:00.000Z')
      expect(result.metadata.owner).toBe('test-user')
      expect(result.path).toContain('test-space')
      expect(result.stats).toBeDefined()
      expect(result.contents).toBeUndefined()
    })

    it('should calculate statistics correctly', async () => {
      const spacePath = path.join(tempSpacesDir, 'stats-test')
      fs.mkdirSync(path.join(spacePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tasks'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tables'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'storage'), { recursive: true })

      // Add agents
      fs.writeFileSync(path.join(spacePath, 'agents', 'agent1.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'agents', 'agent2.json'), '{}')

      // Add tasks
      fs.writeFileSync(path.join(spacePath, 'tasks', 'task1.json'), '{}')

      // Add tables
      fs.mkdirSync(path.join(spacePath, 'tables', 'table1'))
      fs.mkdirSync(path.join(spacePath, 'tables', 'table2'))

      // Add storage files
      fs.writeFileSync(path.join(spacePath, 'storage', 'file1.txt'), 'test')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'stats-test',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        { space_name: 'stats-test' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.agent_count).toBe(2)
      expect(result.stats.task_count).toBe(1)
      expect(result.stats.table_count).toBe(2)
      expect(result.stats.storage_files).toBe(1)
      expect(result.stats.total_size_bytes).toBeGreaterThan(0)
    })

    it('should include contents when requested', async () => {
      const spacePath = path.join(tempSpacesDir, 'contents-test')
      fs.mkdirSync(path.join(spacePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tasks', 'agent1'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tables', 'table1'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'storage', 'images'), { recursive: true })

      fs.writeFileSync(path.join(spacePath, 'agents', 'sales-agent.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'agents', 'support-agent.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'tasks', 'agent1', 'task1.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'tasks', 'agent1', 'task2.json'), '{}')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'contents-test',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        {
          space_name: 'contents-test',
          include_contents: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.contents).toBeDefined()
      expect(result.contents?.agents).toContain('sales-agent')
      expect(result.contents?.agents).toContain('support-agent')
      expect(result.contents?.tasks).toContain('agent1/task1')
      expect(result.contents?.tasks).toContain('agent1/task2')
      expect(result.contents?.tables).toContain('table1')
      expect(result.contents?.storage_categories).toContain('images')
    })

    it('should handle space without metadata file', async () => {
      const spacePath = path.join(tempSpacesDir, 'no-metadata')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await getSpaceInfo(
        { space_name: 'no-metadata' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.space_name).toBe('no-metadata')
      expect(result.description).toBe('')
      expect(result.metadata).toEqual({})
    })

    it('should handle empty space', async () => {
      const spacePath = path.join(tempSpacesDir, 'empty-space')
      fs.mkdirSync(spacePath, { recursive: true })

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'empty-space',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        {
          space_name: 'empty-space',
          include_contents: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.agent_count).toBe(0)
      expect(result.stats.task_count).toBe(0)
      expect(result.stats.table_count).toBe(0)
      expect(result.stats.storage_files).toBe(0)
      expect(result.contents?.agents).toEqual([])
      expect(result.contents?.tasks).toEqual([])
      expect(result.contents?.tables).toEqual([])
      expect(result.contents?.storage_categories).toEqual([])
    })
  })

  describe('Error Handling', () => {
    it('should return error for non-existent space', async () => {
      const result = await getSpaceInfo(
        { space_name: 'non-existent' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('does not exist')
    })

    it('should return error for invalid space name', async () => {
      const result = await getSpaceInfo(
        { space_name: 'Invalid Name' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should return error for empty space name', async () => {
      const result = await getSpaceInfo(
        { space_name: '' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should return error for space name with special characters', async () => {
      const result = await getSpaceInfo(
        { space_name: 'test@space!' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should handle corrupted metadata file gracefully', async () => {
      const spacePath = path.join(tempSpacesDir, 'corrupted')
      fs.mkdirSync(spacePath, { recursive: true })
      fs.writeFileSync(path.join(spacePath, 'space.json'), 'invalid json {')

      const result = await getSpaceInfo(
        { space_name: 'corrupted' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.space_name).toBe('corrupted')
      expect(result.description).toBe('')
    })
  })

  describe('Edge Cases', () => {
    it('should handle nested task structure', async () => {
      const spacePath = path.join(tempSpacesDir, 'nested-tasks')
      const tasksDir = path.join(spacePath, 'tasks')

      fs.mkdirSync(path.join(tasksDir, 'agent1', 'subdir'), { recursive: true })
      fs.mkdirSync(path.join(tasksDir, 'agent2'), { recursive: true })

      fs.writeFileSync(path.join(tasksDir, 'agent1', 'task1.json'), '{}')
      fs.writeFileSync(path.join(tasksDir, 'agent1', 'subdir', 'task2.json'), '{}')
      fs.writeFileSync(path.join(tasksDir, 'agent2', 'task3.json'), '{}')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'nested-tasks',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        { space_name: 'nested-tasks' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.task_count).toBe(3)
    })

    it('should handle deeply nested storage files', async () => {
      const spacePath = path.join(tempSpacesDir, 'deep-storage')
      const storageDir = path.join(spacePath, 'storage')

      fs.mkdirSync(path.join(storageDir, 'a', 'b', 'c'), { recursive: true })
      fs.writeFileSync(path.join(storageDir, 'file1.txt'), 'test')
      fs.writeFileSync(path.join(storageDir, 'a', 'file2.txt'), 'test')
      fs.writeFileSync(path.join(storageDir, 'a', 'b', 'file3.txt'), 'test')
      fs.writeFileSync(path.join(storageDir, 'a', 'b', 'c', 'file4.txt'), 'test')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'deep-storage',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        { space_name: 'deep-storage' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.storage_files).toBe(4)
      expect(result.stats.total_size_bytes).toBeGreaterThan(0)
    })

    it('should only list JSON files as agents', async () => {
      const spacePath = path.join(tempSpacesDir, 'agent-filter')
      const agentsDir = path.join(spacePath, 'agents')

      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(path.join(agentsDir, 'agent1.json'), '{}')
      fs.writeFileSync(path.join(agentsDir, 'agent2.json'), '{}')
      fs.writeFileSync(path.join(agentsDir, 'not-agent.txt'), 'test')
      fs.writeFileSync(path.join(agentsDir, 'README.md'), 'test')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'agent-filter',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        {
          space_name: 'agent-filter',
          include_contents: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.contents?.agents).toHaveLength(2)
      expect(result.contents?.agents).toContain('agent1')
      expect(result.contents?.agents).toContain('agent2')
      expect(result.contents?.agents).not.toContain('not-agent')
      expect(result.contents?.agents).not.toContain('README')
    })

    it('should only list directories as tables', async () => {
      const spacePath = path.join(tempSpacesDir, 'table-filter')
      const tablesDir = path.join(spacePath, 'tables')

      fs.mkdirSync(path.join(tablesDir, 'table1'), { recursive: true })
      fs.mkdirSync(path.join(tablesDir, 'table2'), { recursive: true })
      fs.writeFileSync(path.join(tablesDir, 'not-table.txt'), 'test')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'table-filter',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        {
          space_name: 'table-filter',
          include_contents: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.contents?.tables).toHaveLength(2)
      expect(result.contents?.tables).toContain('table1')
      expect(result.contents?.tables).toContain('table2')
    })

    it('should calculate correct total size', async () => {
      const spacePath = path.join(tempSpacesDir, 'size-test')
      fs.mkdirSync(spacePath, { recursive: true })

      const content = 'x'.repeat(1000) // 1000 bytes
      fs.writeFileSync(path.join(spacePath, 'file1.txt'), content)
      fs.writeFileSync(path.join(spacePath, 'file2.txt'), content)

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'size-test',
          description: '',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await getSpaceInfo(
        { space_name: 'size-test' },
        tempDataDir,
        tempGlobalDir
      )

      // Should be at least 2000 bytes (2 files) plus space.json
      expect(result.stats.total_size_bytes).toBeGreaterThanOrEqual(2000)
    })

    it('should handle space with complex metadata', async () => {
      const spacePath = path.join(tempSpacesDir, 'complex-meta')
      fs.mkdirSync(spacePath, { recursive: true })

      const complexMetadata = {
        space_name: 'complex-meta',
        description: 'Complex metadata space',
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-02T00:00:00.000Z',
        metadata: {
          owner: 'team-a',
          tags: ['production', 'critical'],
          nested: {
            deep: {
              value: 'test'
            }
          },
          array: [1, 2, 3]
        }
      }

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify(complexMetadata)
      )

      const result = await getSpaceInfo(
        { space_name: 'complex-meta' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.metadata.owner).toBe('team-a')
      expect(result.metadata.tags).toEqual(['production', 'critical'])
      expect(result.metadata.nested.deep.value).toBe('test')
      expect(result.metadata.array).toEqual([1, 2, 3])
    })
  })
})
