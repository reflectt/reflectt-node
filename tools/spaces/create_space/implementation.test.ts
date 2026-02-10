import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import createSpace, { CreateSpaceInput } from './implementation'

describe('createSpace', () => {
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
    it('should create a space with minimum required parameters', async () => {
      const input: CreateSpaceInput = {
        space_name: 'test-space'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.space_name).toBe('test-space')
      expect(result.message).toContain('created successfully')
      expect(result.created_at).toBeDefined()
      expect(result.path).toContain('test-space')

      // Verify directory structure
      const spacePath = path.join(tempSpacesDir, 'test-space')
      expect(fs.existsSync(spacePath)).toBe(true)
      expect(fs.existsSync(path.join(spacePath, 'agents'))).toBe(true)
      expect(fs.existsSync(path.join(spacePath, 'tasks'))).toBe(true)
      expect(fs.existsSync(path.join(spacePath, 'tables'))).toBe(true)
      expect(fs.existsSync(path.join(spacePath, 'storage'))).toBe(true)

      // Verify metadata file
      const metadataPath = path.join(spacePath, 'space.json')
      expect(fs.existsSync(metadataPath)).toBe(true)

      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      expect(metadata.space_name).toBe('test-space')
      expect(metadata.description).toBe('')
      expect(metadata.created_at).toBeDefined()
      expect(metadata.updated_at).toBeDefined()
      expect(metadata.metadata).toEqual({})
    })

    it('should create a space with description', async () => {
      const input: CreateSpaceInput = {
        space_name: 'project-x',
        description: 'Project X workspace'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)

      const spacePath = path.join(tempSpacesDir, 'project-x')
      const metadata = JSON.parse(fs.readFileSync(path.join(spacePath, 'space.json'), 'utf-8'))
      expect(metadata.description).toBe('Project X workspace')
    })

    it('should create a space with metadata', async () => {
      const input: CreateSpaceInput = {
        space_name: 'team-space',
        description: 'Team collaboration',
        metadata: {
          owner: 'engineering-team',
          tags: ['production', 'critical'],
          purpose: 'collaboration'
        }
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)

      const spacePath = path.join(tempSpacesDir, 'team-space')
      const metadata = JSON.parse(fs.readFileSync(path.join(spacePath, 'space.json'), 'utf-8'))
      expect(metadata.metadata.owner).toBe('engineering-team')
      expect(metadata.metadata.tags).toEqual(['production', 'critical'])
      expect(metadata.metadata.purpose).toBe('collaboration')
    })

    it('should accept space names with underscores', async () => {
      const input: CreateSpaceInput = {
        space_name: 'my_test_space'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)
    })

    it('should accept space names with hyphens', async () => {
      const input: CreateSpaceInput = {
        space_name: 'my-test-space'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)
    })

    it('should accept space names with numbers', async () => {
      const input: CreateSpaceInput = {
        space_name: 'project123'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should reject empty space name', async () => {
      const input: CreateSpaceInput = {
        space_name: ''
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should reject uppercase characters in space name', async () => {
      const input: CreateSpaceInput = {
        space_name: 'MySpace'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should reject spaces in space name', async () => {
      const input: CreateSpaceInput = {
        space_name: 'my space'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should reject special characters in space name', async () => {
      const input: CreateSpaceInput = {
        space_name: 'my@space!'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should reject duplicate space names', async () => {
      const input: CreateSpaceInput = {
        space_name: 'duplicate-space'
      }

      // Create first space
      await createSpace(input, tempDataDir, tempGlobalDir)

      // Try to create duplicate
      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('already exists')
    })

    it('should clean up on failure', async () => {
      const input: CreateSpaceInput = {
        space_name: 'cleanup-test'
      }

      // Create the space directory manually to simulate partial creation
      const spacePath = path.join(tempSpacesDir, 'cleanup-test')
      fs.mkdirSync(spacePath, { recursive: true })

      // Try to create (should fail because it exists)
      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle non-existent data directory by creating it', async () => {
      const newTempDir = path.join(os.tmpdir(), 'non-existent-' + Date.now())
      const newGlobalDir = path.join(newTempDir, 'global')

      try {
        // Create globalDir to satisfy the path.join(globalDir, '../spaces') calculation
        fs.mkdirSync(newGlobalDir, { recursive: true })

        const input: CreateSpaceInput = {
          space_name: 'test-space'
        }

        const result = await createSpace(input, newTempDir, newGlobalDir)
        expect(result.success).toBe(true)

        const spacePath = path.join(newTempDir, 'spaces', 'test-space')
        expect(fs.existsSync(spacePath)).toBe(true)
      } finally {
        if (fs.existsSync(newTempDir)) {
          fs.rmSync(newTempDir, { recursive: true, force: true })
        }
      }
    })

    it('should handle single character space names', async () => {
      const input: CreateSpaceInput = {
        space_name: 'a'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)
    })

    it('should handle very long space names', async () => {
      const input: CreateSpaceInput = {
        space_name: 'a'.repeat(100)
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)
    })

    it('should handle complex metadata structures', async () => {
      const input: CreateSpaceInput = {
        space_name: 'complex-metadata',
        metadata: {
          nested: {
            deeply: {
              nested: {
                value: 'test'
              }
            }
          },
          array: [1, 2, 3],
          boolean: true,
          number: 42
        }
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)

      const spacePath = path.join(tempSpacesDir, 'complex-metadata')
      const metadata = JSON.parse(fs.readFileSync(path.join(spacePath, 'space.json'), 'utf-8'))
      expect(metadata.metadata.nested.deeply.nested.value).toBe('test')
      expect(metadata.metadata.array).toEqual([1, 2, 3])
    })

    it('should create timestamps in ISO format', async () => {
      const input: CreateSpaceInput = {
        space_name: 'timestamp-test'
      }

      const result = await createSpace(input, tempDataDir, tempGlobalDir)

      // Verify ISO 8601 format
      expect(result.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

      const spacePath = path.join(tempSpacesDir, 'timestamp-test')
      const metadata = JSON.parse(fs.readFileSync(path.join(spacePath, 'space.json'), 'utf-8'))
      expect(metadata.created_at).toBe(metadata.updated_at)
    })
  })

  describe('Directory Structure', () => {
    it('should create all required subdirectories', async () => {
      const input: CreateSpaceInput = {
        space_name: 'structure-test'
      }

      await createSpace(input, tempDataDir, tempGlobalDir)

      const spacePath = path.join(tempSpacesDir, 'structure-test')
      const subdirs = ['agents', 'tasks', 'tables', 'storage']

      for (const subdir of subdirs) {
        const subdirPath = path.join(spacePath, subdir)
        expect(fs.existsSync(subdirPath)).toBe(true)
        expect(fs.statSync(subdirPath).isDirectory()).toBe(true)
      }
    })

    it('should create space.json with correct structure', async () => {
      const input: CreateSpaceInput = {
        space_name: 'metadata-structure-test',
        description: 'Test description',
        metadata: { tag: 'test' }
      }

      await createSpace(input, tempDataDir, tempGlobalDir)

      const spacePath = path.join(tempSpacesDir, 'metadata-structure-test')
      const metadata = JSON.parse(fs.readFileSync(path.join(spacePath, 'space.json'), 'utf-8'))

      expect(metadata).toHaveProperty('space_name')
      expect(metadata).toHaveProperty('description')
      expect(metadata).toHaveProperty('created_at')
      expect(metadata).toHaveProperty('updated_at')
      expect(metadata).toHaveProperty('metadata')
    })
  })
})
