import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import deleteAgent from './implementation'

describe('deleteAgent', () => {
  let tempDataDir: string
  let tempGlobalDir: string
  let tempSpacesDir: string

  beforeEach(() => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-data-'))
    tempGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-global-'))
    tempSpacesDir = path.join(path.dirname(tempGlobalDir), 'spaces')
    fs.mkdirSync(tempSpacesDir, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempGlobalDir)) {
      fs.rmSync(tempGlobalDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempSpacesDir)) {
      fs.rmSync(tempSpacesDir, { recursive: true, force: true })
    }
  })

  function createAgent(baseDir: string, domain: string, agentId: string, data: any) {
    const agentDir = path.join(baseDir, "agents", domain, agentId)
    fs.mkdirSync(agentDir, { recursive: true })
    fs.writeFileSync(
      path.join(agentDir, "definition.json"),
      JSON.stringify(data, null, 2)
    )
  }

  describe('Happy Path', () => {
    it('should delete agent by slug from space scope', async () => {
      // Create agent directory with definition.json
      const agentDir = path.join(tempDataDir, 'agents', 'finance', 'budget_tracker')
      fs.mkdirSync(agentDir, { recursive: true })
      fs.writeFileSync(
        path.join(agentDir, 'definition.json'),
        JSON.stringify({ id: 'budget_tracker', slug: 'finance:budget_tracker' })
      )

      const result = await deleteAgent(
        {
          slug: 'finance:budget_tracker',
          scope: 'space'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.deleted_from).toBe('space')
      expect(result.agent_path).toContain('budget_tracker')
      expect(result.message).toContain('Successfully deleted')

      // Verify directory was deleted
      expect(fs.existsSync(agentDir)).toBe(false)
    })

    it('should delete agent by agent_id (searches all domains)', async () => {
      // Create agents in multiple domains using helper
      createAgent(tempDataDir, 'finance', 'tracker', {
        id: 'tracker',
        slug: 'finance:tracker'
      })
      createAgent(tempDataDir, 'inventory', 'manager', {
        id: 'manager',
        slug: 'inventory:manager'
      })

      const result = await deleteAgent(
        {
          agent_id: 'tracker'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.agent_path).toContain('finance')
      expect(result.agent_path).toContain('tracker')

      // Verify directory was deleted
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'finance', 'tracker'))).toBe(false)
    })

    it('should delete agent from global scope', async () => {
      // Create global agent using helper
      createAgent(tempGlobalDir, 'system', 'builder', {
        id: 'builder',
        slug: 'system:builder'
      })

      const result = await deleteAgent(
        {
          slug: 'system:builder',
          scope: 'global'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.deleted_from).toBe('global')

      // Verify directory was deleted
      const agentDir = path.join(tempGlobalDir, 'agents', 'system', 'builder')
      expect(fs.existsSync(agentDir)).toBe(false)
    })

    it('should delete agent with associated tasks', async () => {
      // Create agent using helper
      createAgent(tempDataDir, 'support', 'helper', {
        id: 'helper',
        slug: 'support:helper'
      })

      // Create associated tasks
      const tasksDir = path.join(tempDataDir, 'tasks', 'helper')
      fs.mkdirSync(tasksDir, { recursive: true })
      fs.writeFileSync(path.join(tasksDir, 'task1.json'), '{}')
      fs.writeFileSync(path.join(tasksDir, 'task2.json'), '{}')
      fs.writeFileSync(path.join(tasksDir, 'task3.json'), '{}')

      const result = await deleteAgent(
        {
          slug: 'support:helper',
          delete_tasks: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.tasks_deleted).toBe(3)
      expect(result.message).toContain('3 associated task(s)')

      // Verify agent directory was deleted
      const agentDir = path.join(tempDataDir, 'agents', 'support', 'helper')
      expect(fs.existsSync(agentDir)).toBe(false)

      // Verify tasks were deleted
      expect(fs.existsSync(path.join(tasksDir, 'task1.json'))).toBe(false)
      expect(fs.existsSync(path.join(tasksDir, 'task2.json'))).toBe(false)
      expect(fs.existsSync(path.join(tasksDir, 'task3.json'))).toBe(false)
    })

    it('should delete agent without deleting tasks when delete_tasks=false', async () => {
      // Create agent using helper
      createAgent(tempDataDir, 'test', 'agent', {
        id: 'agent',
        slug: 'test:agent'
      })

      // Create tasks
      const tasksDir = path.join(tempDataDir, 'tasks', 'agent')
      fs.mkdirSync(tasksDir, { recursive: true })
      fs.writeFileSync(path.join(tasksDir, 'task1.json'), '{}')

      const result = await deleteAgent(
        {
          slug: 'test:agent',
          delete_tasks: false
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.tasks_deleted).toBeUndefined()

      // Verify agent deleted but tasks still exist
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'test', 'agent'))).toBe(false)
      expect(fs.existsSync(path.join(tasksDir, 'task1.json'))).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should return error when neither agent_id nor slug provided', async () => {
      const result = await deleteAgent({}, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Either slug or id must be provided')
    })

    it('should return error for invalid slug format', async () => {
      const result = await deleteAgent({ slug: 'invalid-format' }, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid slug format')
    })

    it('should return error when agent not found', async () => {
      const result = await deleteAgent({ slug: 'finance:nonexistent' }, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found')
    })

    it('should return error when agents directory does not exist', async () => {
      // Don't create agents directory
      const result = await deleteAgent({ agent_id: 'test' }, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agents directory not found')
    })

    it('should return error when agent_id search finds no matches', async () => {
      // Create agents directory but no matching agent
      createAgent(tempDataDir, 'finance', 'other', {
        id: 'other'
      })

      const result = await deleteAgent({ agent_id: 'missing' }, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found: missing in space')
    })
  })

  describe('Edge Cases', () => {
    it('should search only direct agent directories, not nested paths', async () => {
      // Create a normal agent using helper
      createAgent(tempDataDir, 'finance', 'agent', {
        id: 'agent',
        slug: 'finance:agent'
      })

      // Also create a nested path (should be ignored during search)
      // In new structure, this would be finance/agent/subfolder which is not valid
      const nestedDir = path.join(tempDataDir, 'agents', 'finance', 'agent', 'subfolder')
      fs.mkdirSync(nestedDir, { recursive: true })
      fs.writeFileSync(
        path.join(nestedDir, 'nested.json'),
        JSON.stringify({ id: 'nested', slug: 'finance:nested' })
      )

      const result = await deleteAgent(
        {
          agent_id: 'agent'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.agent_path).toContain('finance/agent')

      // Entire agent directory deleted including nested files
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'finance', 'agent'))).toBe(false)
    })

    it('should handle tasks directory with non-JSON files', async () => {
      createAgent(tempDataDir, 'test', 'agent', {
        id: 'agent',
        slug: 'test:agent'
      })

      const tasksDir = path.join(tempDataDir, 'tasks', 'agent')
      fs.mkdirSync(tasksDir, { recursive: true })
      fs.writeFileSync(path.join(tasksDir, 'task.json'), '{}')
      fs.writeFileSync(path.join(tasksDir, 'readme.txt'), 'text file')
      fs.writeFileSync(path.join(tasksDir, 'config.yaml'), 'yaml file')

      const result = await deleteAgent(
        {
          slug: 'test:agent',
          delete_tasks: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.tasks_deleted).toBe(1) // Only JSON files counted

      // Non-JSON files should still exist
      expect(fs.existsSync(path.join(tasksDir, 'readme.txt'))).toBe(true)
      expect(fs.existsSync(path.join(tasksDir, 'config.yaml'))).toBe(true)
    })

    it('should handle slug precedence over agent_id', async () => {
      createAgent(tempDataDir, 'finance', 'agent', {
        id: 'agent',
        slug: 'finance:agent'
      })
      createAgent(tempDataDir, 'support', 'agent', {
        id: 'agent',
        slug: 'support:agent'
      })

      const result = await deleteAgent(
        {
          slug: 'finance:agent',
          agent_id: 'agent'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.agent_path).toContain('finance')

      // Finance agent deleted, support agent should still exist
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'finance', 'agent'))).toBe(false)
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'support', 'agent'))).toBe(true)
    })

    it('should handle missing tasks directory gracefully', async () => {
      createAgent(tempDataDir, 'test', 'agent', {
        id: 'agent',
        slug: 'test:agent'
      })

      // Don't create tasks directory
      const result = await deleteAgent(
        {
          slug: 'test:agent',
          delete_tasks: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)
      expect(result.tasks_deleted).toBe(0)
    })

    it('should find agent in first matching domain when using agent_id', async () => {
      const domains = ['aaa', 'bbb', 'ccc']

      for (const domain of domains) {
        createAgent(tempDataDir, domain, 'duplicate', {
          id: 'duplicate',
          slug: `${domain}:duplicate`
        })
      }

      const result = await deleteAgent(
        {
          agent_id: 'duplicate'
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.success).toBe(true)

      // Should delete first match (alphabetically first domain)
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'aaa', 'duplicate'))).toBe(false)

      // Others should still exist
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'bbb', 'duplicate'))).toBe(true)
      expect(fs.existsSync(path.join(tempDataDir, 'agents', 'ccc', 'duplicate'))).toBe(true)
    })
  })
})
