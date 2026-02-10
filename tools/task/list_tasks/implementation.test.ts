import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import listTasks, { ListTasksInput } from './implementation'

describe('listTasks', () => {
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

    // Optionally create prompt file
    if (prompt_file) {
      fs.writeFileSync(
        path.join(taskDir, 'prompt.md'),
        `# ${taskData.title || taskId}\n\nTest prompt.`,
        'utf-8'
      )
    }
  }

  describe('Happy Path', () => {
    it('should list tasks from new directory structure', async () => {
      // Create test tasks
      createTask(tempGlobalDir, 'testing', 'test_agent', 'test-task-1', {
        title: 'Test Task 1',
        description: 'Test description',
        status: 'active',
        priority: 'high'
      })

      createTask(tempGlobalDir, 'testing', 'test_agent', 'test-task-2', {
        title: 'Test Task 2',
        description: 'Another test',
        status: 'active',
        priority: 'medium'
      })

      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      expect(result).toBeDefined()
      expect(result.total).toBe(2)
      expect(result.global_count).toBe(2)
      expect(result.space_count).toBe(0)
      expect(result.tasks[0].id).toBeDefined()
    })

    it('should detect prompt files', async () => {
      createTask(tempGlobalDir, 'testing', 'test_agent', 'task-with-prompt', {
        title: 'Task With Prompt',
        description: 'Has a prompt',
        prompt_file: true  // Will create prompt.md
      })

      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      expect(result.tasks[0].prompt_file).toBeDefined()
      expect(result.tasks[0].prompt_file).toContain('prompt.md')
    })

    it('should filter by agent', async () => {
      createTask(tempGlobalDir, 'testing', 'agent1', 'task1', {
        title: 'Agent 1 Task',
        description: 'Test'
      })

      createTask(tempGlobalDir, 'testing', 'agent2', 'task2', {
        title: 'Agent 2 Task',
        description: 'Test'
      })

      const result = await listTasks({ agent: 'agent1' }, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(1)
      expect(result.tasks[0].agent).toBe('agent1')
    })

    it('should filter by status', async () => {
      createTask(tempGlobalDir, 'testing', 'test_agent', 'active-task', {
        title: 'Active Task',
        description: 'Test',
        status: 'active'
      })

      createTask(tempGlobalDir, 'testing', 'test_agent', 'draft-task', {
        title: 'Draft Task',
        description: 'Test',
        status: 'draft'
      })

      const result = await listTasks({ status: 'active' }, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(1)
      expect(result.tasks[0].status).toBe('active')
    })

    it('should filter by priority', async () => {
      createTask(tempGlobalDir, 'testing', 'test_agent', 'high-task', {
        title: 'High Priority',
        description: 'Test',
        priority: 'high'
      })

      createTask(tempGlobalDir, 'testing', 'test_agent', 'low-task', {
        title: 'Low Priority',
        description: 'Test',
        priority: 'low'
      })

      const result = await listTasks({ priority: 'high' }, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(1)
      expect(result.tasks[0].priority).toBe('high')
    })
  })

  describe('Error Handling', () => {
    it('should handle missing agents directory', async () => {
      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      expect(result).toBeDefined()
      expect(result.total).toBe(0)
      expect(result.tasks).toEqual([])
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty agents directory', async () => {
      fs.mkdirSync(path.join(tempGlobalDir, 'agents'), { recursive: true })

      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(0)
    })

    it('should skip non-directory files', async () => {
      const agentsDir = path.join(tempGlobalDir, 'agents', 'testing')
      fs.mkdirSync(agentsDir, { recursive: true })

      // Create a file instead of directory
      fs.writeFileSync(path.join(agentsDir, 'not-a-dir.txt'), 'test')

      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(0)
    })

    it('should handle malformed JSON gracefully', async () => {
      const taskDir = path.join(tempGlobalDir, 'agents', 'testing', 'test_agent', 'tasks', 'bad-task')
      fs.mkdirSync(taskDir, { recursive: true })
      fs.writeFileSync(path.join(taskDir, 'definition.json'), '{ invalid json }', 'utf-8')

      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      // Should skip malformed tasks
      expect(result.total).toBe(0)
    })
  })

  describe('Multiple Sources', () => {
    it('should combine global and space tasks', async () => {
      createTask(tempGlobalDir, 'testing', 'test_agent', 'global-task', {
        title: 'Global Task',
        description: 'Test'
      })

      createTask(tempDataDir, 'testing', 'test_agent', 'space-task', {
        title: 'Space Task',
        description: 'Test'
      })

      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(2)
      expect(result.global_count).toBe(1)
      expect(result.space_count).toBe(1)
    })
  })

  describe('Sorting', () => {
    it('should sort by priority then agent then title', async () => {
      createTask(tempGlobalDir, 'testing', 'agent_b', 'task1', {
        title: 'B Task',
        description: 'Test',
        priority: 'medium'
      })

      createTask(tempGlobalDir, 'testing', 'agent_a', 'task2', {
        title: 'A Task',
        description: 'Test',
        priority: 'critical'
      })

      createTask(tempGlobalDir, 'testing', 'agent_c', 'task3', {
        title: 'C Task',
        description: 'Test',
        priority: 'critical'
      })

      const result = await listTasks({}, tempDataDir, tempGlobalDir)

      // Critical tasks first, then alphabetically by agent
      expect(result.tasks[0].priority).toBe('critical')
      expect(result.tasks[0].agent).toBe('agent_a')
      expect(result.tasks[1].priority).toBe('critical')
      expect(result.tasks[1].agent).toBe('agent_c')
      expect(result.tasks[2].priority).toBe('medium')
    })
  })
})
