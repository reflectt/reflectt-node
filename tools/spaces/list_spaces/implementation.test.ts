import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import listSpaces, { ListSpacesInput } from './implementation'

describe('listSpaces', () => {
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
    it('should return empty array when no spaces exist', async () => {
      const input: ListSpacesInput = {}

      const result = await listSpaces(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.count).toBe(0)
      expect(result.spaces).toEqual([])
    })

    it('should list all spaces without stats', async () => {
      // Create test spaces
      const spacesDir = tempSpacesDir
      fs.mkdirSync(spacesDir, { recursive: true })

      const space1 = path.join(spacesDir, 'space1')
      const space2 = path.join(spacesDir, 'space2')

      fs.mkdirSync(space1, { recursive: true })
      fs.mkdirSync(space2, { recursive: true })

      fs.writeFileSync(
        path.join(space1, 'space.json'),
        JSON.stringify({
          space_name: 'space1',
          description: 'First space',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      fs.writeFileSync(
        path.join(space2, 'space.json'),
        JSON.stringify({
          space_name: 'space2',
          description: 'Second space',
          created_at: '2025-01-02T00:00:00.000Z',
          updated_at: '2025-01-02T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await listSpaces({}, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.count).toBe(2)
      expect(result.spaces).toHaveLength(2)
      expect(result.spaces[0].stats).toBeUndefined()
      expect(result.spaces[1].stats).toBeUndefined()
    })

    it('should list spaces with statistics', async () => {
      // Create test space with content
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'test-space')

      fs.mkdirSync(spacePath, { recursive: true })

      // Create subdirectories
      fs.mkdirSync(path.join(spacePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tasks'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tables'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'storage'), { recursive: true })

      // Add some files
      fs.writeFileSync(path.join(spacePath, 'agents', 'agent1.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'agents', 'agent2.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'tasks', 'task1.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'storage', 'file1.txt'), 'test')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'test-space',
          description: 'Test',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await listSpaces(
        { include_stats: true },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.count).toBe(1)
      expect(result.spaces[0].stats).toBeDefined()
      expect(result.spaces[0].stats?.agent_count).toBe(2)
      expect(result.spaces[0].stats?.task_count).toBe(1)
      expect(result.spaces[0].stats?.storage_files).toBe(1)
    })

    it('should filter spaces by tag', async () => {
      const spacesDir = tempSpacesDir
      fs.mkdirSync(spacesDir, { recursive: true })

      // Space with production tag
      const prodSpace = path.join(spacesDir, 'prod-space')
      fs.mkdirSync(prodSpace, { recursive: true })
      fs.writeFileSync(
        path.join(prodSpace, 'space.json'),
        JSON.stringify({
          space_name: 'prod-space',
          description: 'Production',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: { tags: ['production', 'critical'] }
        })
      )

      // Space with dev tag
      const devSpace = path.join(spacesDir, 'dev-space')
      fs.mkdirSync(devSpace, { recursive: true })
      fs.writeFileSync(
        path.join(devSpace, 'space.json'),
        JSON.stringify({
          space_name: 'dev-space',
          description: 'Development',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: { tags: ['development'] }
        })
      )

      const result = await listSpaces(
        { filter_tag: 'production' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.count).toBe(1)
      expect(result.spaces[0].space_name).toBe('prod-space')
    })

    it('should handle spaces without metadata files', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'no-metadata')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await listSpaces({}, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.count).toBe(1)
      expect(result.spaces[0].space_name).toBe('no-metadata')
      expect(result.spaces[0].description).toBe('')
      expect(result.spaces[0].metadata).toEqual({})
    })
  })

  describe('Error Handling', () => {
    it('should handle missing spaces directory gracefully', async () => {
      const result = await listSpaces({}, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.count).toBe(0)
      expect(result.spaces).toEqual([])
    })

    it('should handle corrupted metadata files', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'corrupted')
      fs.mkdirSync(spacePath, { recursive: true })

      // Write invalid JSON
      fs.writeFileSync(path.join(spacePath, 'space.json'), 'invalid json {')

      const result = await listSpaces({}, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.count).toBe(1)
      // Should use defaults
      expect(result.spaces[0].space_name).toBe('corrupted')
      expect(result.spaces[0].description).toBe('')
    })

    it('should skip files in spaces directory', async () => {
      const spacesDir = tempSpacesDir
      fs.mkdirSync(spacesDir, { recursive: true })

      // Create a file (not a directory)
      fs.writeFileSync(path.join(spacesDir, 'not-a-space.txt'), 'test')

      // Create a valid space
      const validSpace = path.join(spacesDir, 'valid-space')
      fs.mkdirSync(validSpace, { recursive: true })

      const result = await listSpaces({}, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.count).toBe(1)
      expect(result.spaces[0].space_name).toBe('valid-space')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty tag filter returning no results', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'test-space')
      fs.mkdirSync(spacePath, { recursive: true })

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'test-space',
          description: 'Test',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: { tags: ['dev'] }
        })
      )

      const result = await listSpaces(
        { filter_tag: 'production' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.count).toBe(0)
      expect(result.spaces).toEqual([])
    })

    it('should handle spaces with no subdirectories when calculating stats', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'empty-space')
      fs.mkdirSync(spacePath, { recursive: true })

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'empty-space',
          description: 'Empty',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await listSpaces(
        { include_stats: true },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.spaces[0].stats).toEqual({
        agent_count: 0,
        task_count: 0,
        table_count: 0,
        storage_files: 0
      })
    })

    it('should handle nested task files correctly', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'nested-space')
      const tasksDir = path.join(spacePath, 'tasks')

      fs.mkdirSync(path.join(tasksDir, 'agent1', 'subdir'), { recursive: true })
      fs.mkdirSync(path.join(tasksDir, 'agent2'), { recursive: true })

      fs.writeFileSync(path.join(tasksDir, 'agent1', 'task1.json'), '{}')
      fs.writeFileSync(path.join(tasksDir, 'agent1', 'subdir', 'task2.json'), '{}')
      fs.writeFileSync(path.join(tasksDir, 'agent2', 'task3.json'), '{}')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'nested-space',
          description: 'Nested',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await listSpaces(
        { include_stats: true },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.spaces[0].stats?.task_count).toBe(3)
    })

    it('should handle large number of spaces', async () => {
      const spacesDir = tempSpacesDir
      fs.mkdirSync(spacesDir, { recursive: true })

      // Create 100 spaces
      for (let i = 0; i < 100; i++) {
        const spacePath = path.join(spacesDir, `space-${i}`)
        fs.mkdirSync(spacePath, { recursive: true })
        fs.writeFileSync(
          path.join(spacePath, 'space.json'),
          JSON.stringify({
            space_name: `space-${i}`,
            description: `Space ${i}`,
            created_at: '2025-01-01T00:00:00.000Z',
            updated_at: '2025-01-01T00:00:00.000Z',
            metadata: {}
          })
        )
      }

      const result = await listSpaces({}, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.count).toBe(100)
      expect(result.spaces).toHaveLength(100)
    })

    it('should handle spaces with no tags when filtering by tag', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'no-tags')
      fs.mkdirSync(spacePath, { recursive: true })

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'no-tags',
          description: 'No tags',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await listSpaces(
        { filter_tag: 'production' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.count).toBe(0)
    })
  })

  describe('Statistics Calculation', () => {
    it('should count agents correctly', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'test')
      const agentsDir = path.join(spacePath, 'agents')

      fs.mkdirSync(agentsDir, { recursive: true })
      fs.writeFileSync(path.join(agentsDir, 'agent1.json'), '{}')
      fs.writeFileSync(path.join(agentsDir, 'agent2.json'), '{}')
      fs.writeFileSync(path.join(agentsDir, 'agent3.json'), '{}')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'test',
          description: 'Test',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await listSpaces(
        { include_stats: true },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.spaces[0].stats?.agent_count).toBe(3)
    })

    it('should count storage files recursively', async () => {
      const spacesDir = tempSpacesDir
      const spacePath = path.join(spacesDir, 'test')
      const storageDir = path.join(spacePath, 'storage')

      fs.mkdirSync(path.join(storageDir, 'images'), { recursive: true })
      fs.mkdirSync(path.join(storageDir, 'docs'), { recursive: true })

      fs.writeFileSync(path.join(storageDir, 'file1.txt'), 'test')
      fs.writeFileSync(path.join(storageDir, 'images', 'img1.png'), 'test')
      fs.writeFileSync(path.join(storageDir, 'images', 'img2.png'), 'test')
      fs.writeFileSync(path.join(storageDir, 'docs', 'doc1.pdf'), 'test')

      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({
          space_name: 'test',
          description: 'Test',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await listSpaces(
        { include_stats: true },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.spaces[0].stats?.storage_files).toBe(4)
    })
  })
})
