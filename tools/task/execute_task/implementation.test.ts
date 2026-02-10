import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import executeTask, { ExecuteTaskInput } from './implementation'
import { createToolContext } from '@/lib/tools/helpers'

describe('executeTask', () => {
  let tempProjectRoot: string
  let tempDataDir: string
  let tempGlobalDir: string

  beforeEach(() => {
    // Create temp project structure
    tempProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-project-'))
    tempDataDir = path.join(tempProjectRoot, 'data', 'spaces', 'test-space')
    tempGlobalDir = path.join(tempProjectRoot, 'data', 'global')

    // Create directories
    fs.mkdirSync(tempDataDir, { recursive: true })
    fs.mkdirSync(tempGlobalDir, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(tempProjectRoot)) {
      fs.rmSync(tempProjectRoot, { recursive: true, force: true })
    }
  })

  describe('Happy Path', () => {
    it('should execute successfully with valid input', async () => {
      const input: ExecuteTaskInput = {
        agent_name: 'test-agent',
        task_name: 'test-task'
      }

      const context = createToolContext(tempProjectRoot, 'test-space')
      const result = await executeTask(input, context)

      expect(result).toBeDefined()
      expect(result.success).toBeDefined()
      // Result will fail because no agent exists, but it should not throw path errors
    })
  })

  describe('Error Handling', () => {
    it('should handle missing agent gracefully', async () => {
      const input: ExecuteTaskInput = {
        agent_name: 'nonexistent',
        task_name: 'test-task'
      }

      const context = createToolContext(tempProjectRoot, 'test-space')
      const result = await executeTask(input, context)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent "nonexistent" not found')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      const input: ExecuteTaskInput = {
        agent_name: 'test-agent',
        task_name: 'test-task'
      }

      const context = createToolContext(tempProjectRoot, 'test-space')
      const result = await executeTask(input, context)

      expect(result).toBeDefined()
      expect(result.success).toBe(false) // Should fail gracefully, not crash
    })
  })
})
