import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import deleteTask, { DeleteTaskInput } from './implementation'

describe('deleteTask', () => {
  let tempDataDir: string
  let tempGlobalDir: string

  beforeEach(() => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-data-'))
    tempGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-global-'))
  })

  afterEach(() => {
    if (fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempGlobalDir)) {
      fs.rmSync(tempGlobalDir, { recursive: true, force: true })
    }
  })

  // Helper to create task in new structure
  function createTask(baseDir: string, category: string, agent: string, taskId: string) {
    const taskDir = path.join(baseDir, 'agents', category, agent, 'tasks', taskId)
    fs.mkdirSync(taskDir, { recursive: true })
    fs.writeFileSync(
      path.join(taskDir, 'definition.json'),
      JSON.stringify({ id: taskId, agent, title: 'Test Task' }, null, 2),
      'utf-8'
    )
  }

  describe('Happy Path', () => {
    it('should execute successfully with valid input', async () => {
      createTask(tempDataDir, 'testing', 'test_agent', 'test_task_1')

      const input: DeleteTaskInput = {
        task_id: 'test_task_1',
        agent: 'test_agent',
        scope: 'space'
      }

      const result = await deleteTask(input, tempDataDir, tempGlobalDir)

      expect(result).toBeDefined()
      expect(result.success).toBe(true)
      expect(result.deleted_from).toBe('space')
      expect(result.agent).toBe('test_agent')

      // Verify task directory was deleted
      const taskDir = path.join(tempDataDir, 'agents', 'testing', 'test_agent', 'tasks', 'test_task_1')
      expect(fs.existsSync(taskDir)).toBe(false)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid input gracefully', async () => {
      const input: any = {
        // Missing task_id - should return error
      }

      const result = await deleteTask(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('task_id is required')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      // Create agents directory but no tasks
      fs.mkdirSync(path.join(tempDataDir, 'agents'), { recursive: true })

      const input: DeleteTaskInput = {
        task_id: 'nonexistent_task',
        scope: 'space'
      }

      const result = await deleteTask(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Task not found')
    })
  })
})
