import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import listAgents, { ListAgentsInput } from './implementation'

describe('listAgents', () => {
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

  describe('Happy Path', () => {
    it('should list agents from new directory structure', async () => {
      // Create test agent in new structure: {category}/{agent}/definition.json
      const agentDir = path.join(tempGlobalDir, 'agents', 'testing', 'test_agent')
      fs.mkdirSync(agentDir, { recursive: true })

      const agentData = {
        id: 'test_agent',
        slug: 'testing:test_agent',
        name: 'Test Agent',
        domain: 'testing',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        temperature: 0.5,
        maxOutputTokens: 4096
      }

      fs.writeFileSync(
        path.join(agentDir, 'definition.json'),
        JSON.stringify(agentData, null, 2)
      )

      const input: ListAgentsInput = {}
      const result = await listAgents(input, tempDataDir, tempGlobalDir)

      expect(result).toBeDefined()
      expect(result.total).toBe(1)
      expect(result.global_count).toBe(1)
      expect(result.agents[0].id).toBe('test_agent')
    })

    it('should detect prompt files in new structure', async () => {
      const agentDir = path.join(tempGlobalDir, 'agents', 'testing', 'test_agent')
      fs.mkdirSync(agentDir, { recursive: true })

      const agentData = {
        id: 'test_agent',
        slug: 'testing:test_agent',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001'
      }

      fs.writeFileSync(
        path.join(agentDir, 'definition.json'),
        JSON.stringify(agentData, null, 2)
      )

      // Add prompt file
      fs.writeFileSync(
        path.join(agentDir, 'prompt.md'),
        '# Test Prompt'
      )

      const result = await listAgents({}, tempDataDir, tempGlobalDir)

      expect(result.agents[0].prompt_file).toBe('agents/testing/test_agent/prompt.md')
    })

    it('should filter agents by domain', async () => {
      // Create agents in different categories
      const agent1Dir = path.join(tempGlobalDir, 'agents', 'finance', 'agent1')
      const agent2Dir = path.join(tempGlobalDir, 'agents', 'testing', 'agent2')

      fs.mkdirSync(agent1Dir, { recursive: true })
      fs.mkdirSync(agent2Dir, { recursive: true })

      fs.writeFileSync(path.join(agent1Dir, 'definition.json'), JSON.stringify({
        id: 'agent1', slug: 'finance:agent1', provider: 'claude_agents', model: 'claude-haiku-4-5-20251001'
      }))

      fs.writeFileSync(path.join(agent2Dir, 'definition.json'), JSON.stringify({
        id: 'agent2', slug: 'testing:agent2', provider: 'claude_agents', model: 'claude-haiku-4-5-20251001'
      }))

      const result = await listAgents({ domain: 'finance' }, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(1)
      expect(result.agents[0].id).toBe('agent1')
    })
  })

  describe('Error Handling', () => {
    it('should handle missing agents directory', async () => {
      const result = await listAgents({}, tempDataDir, tempGlobalDir)

      expect(result).toBeDefined()
      expect(result.total).toBe(0)
      expect(result.agents).toEqual([])
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      // Create empty agents directory
      fs.mkdirSync(path.join(tempGlobalDir, 'agents'), { recursive: true })

      const result = await listAgents({}, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(0)
    })

    it('should skip non-directory files', async () => {
      const agentsDir = path.join(tempGlobalDir, 'agents', 'testing')
      fs.mkdirSync(agentsDir, { recursive: true })

      // Create a file instead of directory
      fs.writeFileSync(path.join(agentsDir, 'not-a-dir.txt'), 'test')

      const result = await listAgents({}, tempDataDir, tempGlobalDir)

      expect(result.total).toBe(0)
    })
  })
})
