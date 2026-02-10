import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import getTask, { GetTaskInput } from './implementation'

describe('getTask', () => {
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
  function createTask(baseDir: string, category: string, agent: string, taskId: string, taskData: any) {
    const taskDir = path.join(baseDir, 'agents', category, agent, 'tasks', taskId)
    fs.mkdirSync(taskDir, { recursive: true })

    const { prompt_file, ...definitionData } = taskData
    fs.writeFileSync(
      path.join(taskDir, 'definition.json'),
      JSON.stringify({ id: taskId, agent, ...definitionData }, null, 2),
      'utf-8'
    )

    if (prompt_file) {
      fs.writeFileSync(
        path.join(taskDir, 'prompt.md'),
        `# ${taskData.title || taskId}\n\nTest prompt.`,
        'utf-8'
      )
    }
  }

  describe('Happy Path', () => {
    it('should execute successfully with valid input', async () => {
      createTask(tempDataDir, 'testing', 'test_agent', 'test_task_1', {
        title: 'Test Task',
        description: 'A test task'
      })

      const input: GetTaskInput = {
        task_id: 'test_task_1',
        agent: 'test_agent',
        search_space: true,
        search_global: false
      }

      const result = await getTask(input, tempDataDir, tempGlobalDir)

      expect(result).toBeDefined()
      expect(result.task.id).toBe('test_task_1')
      expect(result.task.agent).toBe('test_agent')
      expect(result.found_in).toBe('space')
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid input gracefully', async () => {
      const input: any = {}

      const result = await getTask(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('task_id is required')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      const input: GetTaskInput = {
        task_id: 'nonexistent_task',
        search_space: true,
        search_global: true
      }

      const result = await getTask(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Task not found')
    })
  })
})
