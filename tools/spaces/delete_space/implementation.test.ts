import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import deleteSpace, { DeleteSpaceInput } from './implementation'

describe('deleteSpace', () => {
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
    it('should delete an empty space', async () => {
      const spacePath = path.join(tempSpacesDir, 'empty-space')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await deleteSpace(
        {
          space_name: 'empty-space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.space_name).toBe('empty-space')
      expect(result.message).toContain('permanently deleted')
      expect(result.deleted_at).toBeDefined()
      expect(fs.existsSync(spacePath)).toBe(false)
    })

    it('should delete a space with files and subdirectories', async () => {
      const spacePath = path.join(tempSpacesDir, 'full-space')
      fs.mkdirSync(path.join(spacePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tasks'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tables'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'storage'), { recursive: true })

      fs.writeFileSync(path.join(spacePath, 'agents', 'agent1.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'tasks', 'task1.json'), '{}')
      fs.writeFileSync(path.join(spacePath, 'storage', 'file.txt'), 'test')
      fs.writeFileSync(
        path.join(spacePath, 'space.json'),
        JSON.stringify({ space_name: 'full-space' })
      )

      const result = await deleteSpace(
        {
          space_name: 'full-space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
      expect(fs.existsSync(path.join(spacePath, 'agents'))).toBe(false)
      expect(fs.existsSync(path.join(spacePath, 'tasks'))).toBe(false)
    })

    it('should delete space with nested directory structure', async () => {
      const spacePath = path.join(tempSpacesDir, 'nested-space')
      fs.mkdirSync(path.join(spacePath, 'storage', 'a', 'b', 'c'), { recursive: true })

      fs.writeFileSync(path.join(spacePath, 'storage', 'file1.txt'), 'test')
      fs.writeFileSync(path.join(spacePath, 'storage', 'a', 'file2.txt'), 'test')
      fs.writeFileSync(path.join(spacePath, 'storage', 'a', 'b', 'file3.txt'), 'test')
      fs.writeFileSync(path.join(spacePath, 'storage', 'a', 'b', 'c', 'file4.txt'), 'test')

      const result = await deleteSpace(
        {
          space_name: 'nested-space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
    })

    it('should return valid ISO timestamp', async () => {
      const spacePath = path.join(tempSpacesDir, 'test-space')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await deleteSpace(
        {
          space_name: 'test-space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.deleted_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    })
  })

  describe('Error Handling', () => {
    it('should return error when confirm is false', async () => {
      const spacePath = path.join(tempSpacesDir, 'test-space')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await deleteSpace(
        {
          space_name: 'test-space',
          confirm: false
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Deletion not confirmed')

      // Space should still exist
      expect(fs.existsSync(spacePath)).toBe(true)
    })

    it('should return error when space does not exist', async () => {
      const result = await deleteSpace(
        {
          space_name: 'non-existent',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('does not exist')
    })

    it('should return error for invalid space name', async () => {
      const result = await deleteSpace(
        {
          space_name: 'Invalid Name',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should return error for empty space name', async () => {
      const result = await deleteSpace(
        {
          space_name: '',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should return error for space name with special characters', async () => {
      const result = await deleteSpace(
        {
          space_name: 'test@space!',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should return error for uppercase characters in space name', async () => {
      const result = await deleteSpace(
        {
          space_name: 'MySpace',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })
  })

  describe('Edge Cases', () => {
    it('should handle space with read-only files', async () => {
      const spacePath = path.join(tempSpacesDir, 'readonly-space')
      fs.mkdirSync(spacePath, { recursive: true })

      const filePath = path.join(spacePath, 'readonly.txt')
      fs.writeFileSync(filePath, 'test')
      fs.chmodSync(filePath, 0o444) // Read-only

      const result = await deleteSpace(
        {
          space_name: 'readonly-space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
    })

    it('should handle space with many files', async () => {
      const spacePath = path.join(tempSpacesDir, 'many-files')
      fs.mkdirSync(path.join(spacePath, 'storage'), { recursive: true })

      // Create 100 files
      for (let i = 0; i < 100; i++) {
        fs.writeFileSync(path.join(spacePath, 'storage', `file${i}.txt`), 'test')
      }

      const result = await deleteSpace(
        {
          space_name: 'many-files',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
    })

    it('should handle space with symlinks', async () => {
      const spacePath = path.join(tempSpacesDir, 'symlink-space')
      fs.mkdirSync(spacePath, { recursive: true })

      const targetFile = path.join(tempDataDir, 'target.txt')
      const symlinkFile = path.join(spacePath, 'link.txt')

      fs.writeFileSync(targetFile, 'test')
      fs.symlinkSync(targetFile, symlinkFile)

      const result = await deleteSpace(
        {
          space_name: 'symlink-space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
      // Target file should still exist
      expect(fs.existsSync(targetFile)).toBe(true)
    })

    it('should handle space with empty subdirectories', async () => {
      const spacePath = path.join(tempSpacesDir, 'empty-subdirs')
      fs.mkdirSync(path.join(spacePath, 'agents'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tasks'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'tables'), { recursive: true })
      fs.mkdirSync(path.join(spacePath, 'storage'), { recursive: true })

      const result = await deleteSpace(
        {
          space_name: 'empty-subdirs',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
    })

    it('should handle deletion with space name containing hyphens', async () => {
      const spacePath = path.join(tempSpacesDir, 'my-test-space')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await deleteSpace(
        {
          space_name: 'my-test-space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
    })

    it('should handle deletion with space name containing underscores', async () => {
      const spacePath = path.join(tempSpacesDir, 'my_test_space')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await deleteSpace(
        {
          space_name: 'my_test_space',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
    })

    it('should handle deletion with space name containing numbers', async () => {
      const spacePath = path.join(tempSpacesDir, 'project123')
      fs.mkdirSync(spacePath, { recursive: true })

      const result = await deleteSpace(
        {
          space_name: 'project123',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(false)
    })
  })

  describe('Safety Features', () => {
    it('should not delete without explicit confirmation', async () => {
      const spacePath = path.join(tempSpacesDir, 'safe-space')
      fs.mkdirSync(spacePath, { recursive: true })
      fs.writeFileSync(path.join(spacePath, 'important.txt'), 'important data')

      // Try to delete without confirmation
      const result = await deleteSpace(
        {
          space_name: 'safe-space',
          confirm: false
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)

      // Verify space still exists
      expect(fs.existsSync(spacePath)).toBe(true)
      expect(fs.existsSync(path.join(spacePath, 'important.txt'))).toBe(true)
    })

    it('should validate space name before attempting deletion', async () => {
      // Invalid name should error before checking if space exists
      const result = await deleteSpace(
        {
          space_name: 'INVALID',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid space_name')
    })

    it('should require both valid name and confirmation', async () => {
      const spacePath = path.join(tempSpacesDir, 'test')
      fs.mkdirSync(spacePath, { recursive: true })

      // Invalid name
      const result1 = await deleteSpace(
        {
          space_name: 'TEST',
          confirm: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result1.success).toBe(false)
      expect(result1.error).toContain('Invalid space_name')

      // Not confirmed
      const result2 = await deleteSpace(
        {
          space_name: 'test',
          confirm: false
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result2.success).toBe(false)
      expect(result2.error).toContain('Deletion not confirmed')

      // Space should still exist
      expect(fs.existsSync(spacePath)).toBe(true)
    })
  })
})
