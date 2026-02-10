import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import copySpace, { CopySpaceInput } from './implementation'

describe('copySpace', () => {
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
    it('should copy a basic space', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(path.join(sourcePath, 'agents'), { recursive: true })
      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent1.json'), '{}')

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({
          space_name: 'source',
          description: 'Source space',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: {}
        })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.source_space).toBe('source')
      expect(result.destination_space).toBe('dest')
      expect(result.message).toContain('Successfully copied')
      expect(result.stats.agents_copied).toBe(1)

      // Verify destination exists
      const destPath = path.join(tempSpacesDir, 'dest')
      expect(fs.existsSync(destPath)).toBe(true)
      expect(fs.existsSync(path.join(destPath, 'agents', 'agent1.json'))).toBe(true)
    })

    it('should copy all content types', async () => {
      const sourcePath = path.join(tempSpacesDir, 'full-source')
      fs.mkdirSync(path.join(sourcePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'tasks'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'tables'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'storage'), { recursive: true })

      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'tasks', 'task1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'tables', 'table1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'storage', 'file1.txt'), 'test')

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'full-source' })
      )

      const result = await copySpace(
        {
          source_space: 'full-source',
          destination_space: 'full-dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.agents_copied).toBe(1)
      expect(result.stats.tasks_copied).toBe(1)
      expect(result.stats.tables_copied).toBe(1)
      expect(result.stats.storage_files_copied).toBe(1)
    })

    it('should copy with selective includes', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(path.join(sourcePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'tasks'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'tables'), { recursive: true })

      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'tasks', 'task1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'tables', 'table1.json'), '{}')

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest',
          include_agents: true,
          include_tasks: false,
          include_tables: false,
          include_storage: false
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.agents_copied).toBe(1)
      expect(result.stats.tasks_copied).toBe(0)
      expect(result.stats.tables_copied).toBe(0)

      const destPath = path.join(tempSpacesDir, 'dest')
      expect(fs.existsSync(path.join(destPath, 'agents', 'agent1.json'))).toBe(true)
      expect(fs.existsSync(path.join(destPath, 'tasks', 'task1.json'))).toBe(false)
    })

    it('should update metadata in destination', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(sourcePath, { recursive: true })

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({
          space_name: 'source',
          description: 'Source description',
          created_at: '2025-01-01T00:00:00.000Z',
          updated_at: '2025-01-01T00:00:00.000Z',
          metadata: { tag: 'production' }
        })
      )

      await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      const destMetadata = JSON.parse(
        fs.readFileSync(
          path.join(tempSpacesDir, 'dest', 'space.json'),
          'utf-8'
        )
      )

      expect(destMetadata.space_name).toBe('dest')
      expect(destMetadata.description).toBe('Source description')
      expect(destMetadata.metadata.copied_from).toBe('source')
      expect(destMetadata.metadata.copied_at).toBeDefined()
      expect(destMetadata.metadata.tag).toBe('production')
    })

    it('should overwrite existing files when overwrite is true', async () => {
      // Create source
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(path.join(sourcePath, 'agents'), { recursive: true })
      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent1.json'), '{"new": true}')
      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      // Create destination with existing file
      const destPath = path.join(tempSpacesDir, 'dest')
      fs.mkdirSync(path.join(destPath, 'agents'), { recursive: true })
      fs.writeFileSync(path.join(destPath, 'agents', 'agent1.json'), '{"old": true}')
      fs.writeFileSync(
        path.join(destPath, 'space.json'),
        JSON.stringify({ space_name: 'dest' })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest',
          overwrite: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)

      const content = fs.readFileSync(
        path.join(destPath, 'agents', 'agent1.json'),
        'utf-8'
      )
      expect(content).toBe('{"new": true}')
    })

    it('should skip existing files when overwrite is true but files already exist', async () => {
      // Create source
      const sourcePath = path.join(tempSpacesDir, 'source2')
      fs.mkdirSync(path.join(sourcePath, 'agents'), { recursive: true })
      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent1.json'), '{"new": true}')
      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent2.json'), '{"unique": true}')
      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source2' })
      )

      // Create destination with existing file
      const destPath = path.join(tempSpacesDir, 'dest2')
      fs.mkdirSync(path.join(destPath, 'agents'), { recursive: true })
      fs.writeFileSync(path.join(destPath, 'agents', 'agent1.json'), '{"old": true}')
      fs.writeFileSync(
        path.join(destPath, 'space.json'),
        JSON.stringify({ space_name: 'dest2' })
      )

      const result = await copySpace(
        {
          source_space: 'source2',
          destination_space: 'dest2',
          overwrite: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)

      // agent1.json should be overwritten
      const content1 = fs.readFileSync(
        path.join(destPath, 'agents', 'agent1.json'),
        'utf-8'
      )
      expect(content1).toBe('{"new": true}')

      // agent2.json should be copied
      const content2 = fs.readFileSync(
        path.join(destPath, 'agents', 'agent2.json'),
        'utf-8'
      )
      expect(content2).toBe('{"unique": true}')
    })

    it('should copy nested directory structures', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(path.join(sourcePath, 'storage', 'a', 'b'), { recursive: true })

      fs.writeFileSync(path.join(sourcePath, 'storage', 'file1.txt'), 'test')
      fs.writeFileSync(path.join(sourcePath, 'storage', 'a', 'file2.txt'), 'test')
      fs.writeFileSync(path.join(sourcePath, 'storage', 'a', 'b', 'file3.txt'), 'test')

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.storage_files_copied).toBe(3)

      const destPath = path.join(tempSpacesDir, 'dest')
      expect(fs.existsSync(path.join(destPath, 'storage', 'file1.txt'))).toBe(true)
      expect(fs.existsSync(path.join(destPath, 'storage', 'a', 'file2.txt'))).toBe(true)
      expect(fs.existsSync(path.join(destPath, 'storage', 'a', 'b', 'file3.txt'))).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should return error for non-existent source', async () => {
      const result = await copySpace(
        {
          source_space: 'non-existent',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('does not exist')
    })

    it('should return error for invalid source name', async () => {
      const result = await copySpace(
        {
          source_space: 'Invalid Name',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid source_space')
    })

    it('should return error for invalid destination name', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(sourcePath, { recursive: true })

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'Invalid Name'
        },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid destination_space')
    })

    it('should return error when destination exists and overwrite is false', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      const destPath = path.join(tempSpacesDir, 'dest')

      fs.mkdirSync(sourcePath, { recursive: true })
      fs.mkdirSync(destPath, { recursive: true })

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest',
          overwrite: false
        },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('already exists')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty source space', async () => {
      const sourcePath = path.join(tempSpacesDir, 'empty')
      fs.mkdirSync(sourcePath, { recursive: true })

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'empty' })
      )

      const result = await copySpace(
        {
          source_space: 'empty',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.stats.agents_copied).toBe(0)
      expect(result.stats.tasks_copied).toBe(0)
      expect(result.stats.tables_copied).toBe(0)
      expect(result.stats.storage_files_copied).toBe(0)
    })

    it('should handle source without metadata file', async () => {
      const sourcePath = path.join(tempSpacesDir, 'no-meta')
      fs.mkdirSync(sourcePath, { recursive: true })

      const result = await copySpace(
        {
          source_space: 'no-meta',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)

      const destMetadata = JSON.parse(
        fs.readFileSync(
          path.join(tempSpacesDir, 'dest', 'space.json'),
          'utf-8'
        )
      )

      expect(destMetadata.space_name).toBe('dest')
      expect(destMetadata.description).toContain('Copy of no-meta')
      expect(destMetadata.metadata.copied_from).toBe('no-meta')
    })

    it('should handle large number of files', async () => {
      const sourcePath = path.join(tempSpacesDir, 'large')
      fs.mkdirSync(path.join(sourcePath, 'storage'), { recursive: true })

      // Create 100 files
      for (let i = 0; i < 100; i++) {
        fs.writeFileSync(path.join(sourcePath, 'storage', `file${i}.txt`), 'test')
      }

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'large' })
      )

      const result = await copySpace(
        {
          source_space: 'large',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.stats.storage_files_copied).toBe(100)
    })

    it('should handle space names with hyphens and underscores', async () => {
      const sourcePath = path.join(tempSpacesDir, 'my-test_space')
      fs.mkdirSync(sourcePath, { recursive: true })

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'my-test_space' })
      )

      const result = await copySpace(
        {
          source_space: 'my-test_space',
          destination_space: 'new-test_space'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
    })

    it('should preserve file contents exactly', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(path.join(sourcePath, 'storage'), { recursive: true })

      const content = 'This is test content with special characters: @#$%^&*()'
      fs.writeFileSync(path.join(sourcePath, 'storage', 'test.txt'), content)

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      const copiedContent = fs.readFileSync(
        path.join(tempSpacesDir, 'dest', 'storage', 'test.txt'),
        'utf-8'
      )

      expect(copiedContent).toBe(content)
    })

    it('should create subdirectories in destination if they do not exist', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(sourcePath, { recursive: true })

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      const destPath = path.join(tempSpacesDir, 'dest')
      expect(fs.existsSync(path.join(destPath, 'agents'))).toBe(true)
      expect(fs.existsSync(path.join(destPath, 'tasks'))).toBe(true)
      expect(fs.existsSync(path.join(destPath, 'tables'))).toBe(true)
      expect(fs.existsSync(path.join(destPath, 'storage'))).toBe(true)
    })

    it('should return correct timestamp in ISO format', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(sourcePath, { recursive: true })

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.copied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('Selective Copy Combinations', () => {
    it('should only copy agents and tasks', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(path.join(sourcePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'tasks'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'tables'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'storage'), { recursive: true })

      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'tasks', 'task1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'tables', 'table1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'storage', 'file1.txt'), 'test')

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest',
          include_agents: true,
          include_tasks: true,
          include_tables: false,
          include_storage: false
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.agents_copied).toBe(1)
      expect(result.stats.tasks_copied).toBe(1)
      expect(result.stats.tables_copied).toBe(0)
      expect(result.stats.storage_files_copied).toBe(0)
    })

    it('should only copy storage files', async () => {
      const sourcePath = path.join(tempSpacesDir, 'source')
      fs.mkdirSync(path.join(sourcePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(sourcePath, 'storage'), { recursive: true })

      fs.writeFileSync(path.join(sourcePath, 'agents', 'agent1.json'), '{}')
      fs.writeFileSync(path.join(sourcePath, 'storage', 'file1.txt'), 'test')

      fs.writeFileSync(
        path.join(sourcePath, 'space.json'),
        JSON.stringify({ space_name: 'source' })
      )

      const result = await copySpace(
        {
          source_space: 'source',
          destination_space: 'dest',
          include_agents: false,
          include_tasks: false,
          include_tables: false,
          include_storage: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.stats.agents_copied).toBe(0)
      expect(result.stats.storage_files_copied).toBe(1)
    })
  })
})
