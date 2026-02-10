import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import upsertAgent, { UpsertAgentInput } from './implementation'

describe('upsertAgent', () => {
  let tempDataDir: string
  let tempGlobalDir: string
  let tempSpacesDir: string

  beforeEach(() => {
    // Create temporary directories for testing
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-data-'))
    tempGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-global-'))
    tempSpacesDir = path.join(path.dirname(tempGlobalDir), 'spaces')
    fs.mkdirSync(tempSpacesDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up temporary directories
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

  describe('Happy Path', () => {
    it('should create a new agent with all required fields', async () => {
      const input: UpsertAgentInput = {
        id: 'budget_tracker',
        slug: 'finance:budget_tracker',
        name: 'Budget Tracker',
        domain: 'finance',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/finance/budget-tracker.md'
      }

      const result = await upsertAgent(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.path).toBe('agents/finance/budget_tracker/')
      expect(result.message).toContain('Agent finance:budget_tracker created/updated successfully')

      // Verify file was created
      const agentPath = path.join(tempDataDir, 'agents', 'finance', 'budget_tracker', 'definition.json')
      expect(fs.existsSync(agentPath)).toBe(true)

      // Verify content
      const content = JSON.parse(fs.readFileSync(agentPath, 'utf-8'))
      expect(content.id).toBe('budget_tracker')
      expect(content.slug).toBe('finance:budget_tracker')
      expect(content.name).toBe('Budget Tracker')
      expect(content.domain).toBe('finance')
      expect(content.provider).toBe('claude_agents')
      expect(content.model).toBe('claude-haiku-4-5-20251001')
      // prompt_file is no longer in definition.json (stored as prompt.md instead)
      expect(content.version).toBe(1)
      expect(content.exported_at).toBeDefined()

      // Verify README.md was created
      const readmePath = path.join(tempDataDir, 'agents', 'finance', 'budget_tracker', 'README.md')
      expect(fs.existsSync(readmePath)).toBe(true)
    })

    it('should create agent with optional fields', async () => {
      const input: UpsertAgentInput = {
        id: 'story_writer',
        slug: 'creative:story_writer',
        name: 'Story Writer',
        domain: 'creative',
        provider: 'claude_agents',
        model: 'claude-opus-4-20250514',
        prompt_file: 'data/prompts/creative/story.md',
        role: 'Creative Writing Assistant',
        description: 'Helps write engaging stories',
        capabilities: ['storytelling', 'character_development', 'plot_creation'],
        temperature: 0.7,
        maxOutputTokens: 8192
      }

      const result = await upsertAgent(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)

      const agentPath = path.join(tempDataDir, 'agents', 'creative', 'story_writer/definition.json')
      const content = JSON.parse(fs.readFileSync(agentPath, 'utf-8'))

      expect(content.role).toBe('Creative Writing Assistant')
      expect(content.description).toBe('Helps write engaging stories')
      expect(content.capabilities).toEqual(['storytelling', 'character_development', 'plot_creation'])
      expect(content.temperature).toBe(0.7)
      expect(content.maxOutputTokens).toBe(8192)
      expect(content.metadata.domain).toBe('creative')
      expect(content.metadata.capability).toBe('storytelling')
    })

    it('should update existing agent', async () => {
      const input: UpsertAgentInput = {
        id: 'assistant',
        slug: 'support:assistant',
        name: 'Assistant v1',
        domain: 'support',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/support/v1.md'
      }

      // Create agent
      await upsertAgent(input, tempDataDir, tempGlobalDir)

      // Update agent
      const updatedInput: UpsertAgentInput = {
        ...input,
        name: 'Assistant v2',
        model: 'claude-haiku-4-5-20251001',
        temperature: 0.5
      }

      const result = await upsertAgent(updatedInput, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)

      // Verify update
      const agentPath = path.join(tempDataDir, 'agents', 'support', 'assistant/definition.json')
      const content = JSON.parse(fs.readFileSync(agentPath, 'utf-8'))
      expect(content.name).toBe('Assistant v2')
      expect(content.model).toBe('claude-haiku-4-5-20251001')
      expect(content.temperature).toBe(0.5)
    })
  })

  describe('Scope and Target Space', () => {
    it('should create agent in space scope (default)', async () => {
      const input: UpsertAgentInput = {
        id: 'space_agent',
        slug: 'test:space_agent',
        name: 'Space Agent',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md'
      }

      await upsertAgent(input, tempDataDir, tempGlobalDir)

      const agentPath = path.join(tempDataDir, 'agents', 'test', 'space_agent/definition.json')
      expect(fs.existsSync(agentPath)).toBe(true)
    })

    it('should create agent in global scope', async () => {
      const input: UpsertAgentInput = {
        id: 'global_agent',
        slug: 'test:global_agent',
        name: 'Global Agent',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md',
        scope: 'global'
      }

      await upsertAgent(input, tempDataDir, tempGlobalDir)

      const agentPath = path.join(tempGlobalDir, 'agents', 'test', 'global_agent/definition.json')
      expect(fs.existsSync(agentPath)).toBe(true)
    })

    it('should create agent in target_space (overrides scope)', async () => {
      // Create the target space directory
      const creativeSpaceDir = path.join(tempSpacesDir, 'creative')
      fs.mkdirSync(creativeSpaceDir, { recursive: true })

      const input: UpsertAgentInput = {
        id: 'creative_agent',
        slug: 'creative:creative_agent',
        name: 'Creative Agent',
        domain: 'creative',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/creative.md',
        scope: 'space',  // This should be ignored
        target_space: 'creative'
      }

      await upsertAgent(input, tempDataDir, tempGlobalDir)

      // Should be in target_space, not dataDir
      const spacePath = path.join(creativeSpaceDir, 'agents', 'creative', 'creative_agent/definition.json')
      const dataPath = path.join(tempDataDir, 'agents', 'creative', 'creative_agent/definition.json')

      expect(fs.existsSync(spacePath)).toBe(true)
      expect(fs.existsSync(dataPath)).toBe(false)
    })
  })

  describe('Default Values', () => {
    it('should apply default values for optional fields', async () => {
      const input: UpsertAgentInput = {
        id: 'minimal_agent',
        slug: 'test:minimal_agent',
        name: 'Minimal Agent',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md'
      }

      await upsertAgent(input, tempDataDir, tempGlobalDir)

      const agentPath = path.join(tempDataDir, 'agents', 'test', 'minimal_agent/definition.json')
      const content = JSON.parse(fs.readFileSync(agentPath, 'utf-8'))

      // Verify defaults
      expect(content.role).toBe('Minimal Agent')  // Defaults to name
      expect(content.description).toBe('Minimal Agent')  // Defaults to role/name
      expect(content.capabilities).toEqual([])
      expect(content.temperature).toBe(0.3)
      expect(content.maxOutputTokens).toBe(4096)
      expect(content.tools).toBeNull()
      expect(content.metadata.capability).toBe('general')  // No capabilities provided
    })
  })

  describe('Edge Cases', () => {
    it('should handle agent ID with underscores', async () => {
      const input: UpsertAgentInput = {
        id: 'test_agent_with_underscores',
        slug: 'test:test_agent_with_underscores',
        name: 'Test Agent',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md'
      }

      const result = await upsertAgent(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)

      const agentPath = path.join(tempDataDir, 'agents', 'test', 'test_agent_with_underscores/definition.json')
      expect(fs.existsSync(agentPath)).toBe(true)
    })

    it('should handle empty capabilities array', async () => {
      const input: UpsertAgentInput = {
        id: 'no_capabilities',
        slug: 'test:no_capabilities',
        name: 'No Capabilities',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md',
        capabilities: []
      }

      const result = await upsertAgent(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)

      const agentPath = path.join(tempDataDir, 'agents', 'test', 'no_capabilities/definition.json')
      const content = JSON.parse(fs.readFileSync(agentPath, 'utf-8'))
      expect(content.capabilities).toEqual([])
    })

    it('should handle nested domain directories', async () => {
      const input: UpsertAgentInput = {
        id: 'nested_agent',
        slug: 'test:nested_agent',
        name: 'Nested Agent',
        domain: 'test/subdomain/deeper',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md'
      }

      const result = await upsertAgent(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)

      const agentPath = path.join(tempDataDir, 'agents', 'test/subdomain/deeper', 'nested_agent/definition.json')
      expect(fs.existsSync(agentPath)).toBe(true)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid directory gracefully', async () => {
      const invalidDataDir = '/invalid/readonly/path'

      const input: UpsertAgentInput = {
        id: 'test_agent',
        slug: 'test:test_agent',
        name: 'Test Agent',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md'
      }

      const result = await upsertAgent(input, invalidDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toContain('ENOENT')
    })

    it('should handle file write errors', async () => {
      const input: UpsertAgentInput = {
        id: 'test_agent',
        slug: 'test:test_agent',
        name: 'Test Agent',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md'
      }

      // Create directory as a file to cause error
      const agentDir = path.join(tempDataDir, 'agents', 'test')
      fs.mkdirSync(path.dirname(agentDir), { recursive: true })
      fs.writeFileSync(agentDir, 'this is a file, not a directory')

      const result = await upsertAgent(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('Data Integrity', () => {
    it('should preserve all input data in saved file', async () => {
      const input: UpsertAgentInput = {
        id: 'full_agent',
        slug: 'test:full_agent',
        name: 'Full Agent',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md',
        role: 'Test Role',
        description: 'Test Description',
        capabilities: ['cap1', 'cap2', 'cap3'],
        temperature: 0.8,
        maxOutputTokens: 6000
      }

      await upsertAgent(input, tempDataDir, tempGlobalDir)

      const agentPath = path.join(tempDataDir, 'agents', 'test', 'full_agent/definition.json')
      const saved = JSON.parse(fs.readFileSync(agentPath, 'utf-8'))

      // Verify all fields match
      expect(saved.id).toBe(input.id)
      expect(saved.slug).toBe(input.slug)
      expect(saved.name).toBe(input.name)
      expect(saved.domain).toBe(input.domain)
      expect(saved.provider).toBe(input.provider)
      expect(saved.model).toBe(input.model)
      // prompt_file is not saved in definition.json anymore
      expect(saved.role).toBe(input.role)
      expect(saved.description).toBe(input.description)
      expect(saved.capabilities).toEqual(input.capabilities)
      expect(saved.temperature).toBe(input.temperature)
      expect(saved.maxOutputTokens).toBe(input.maxOutputTokens)
    })

    it('should have valid ISO timestamp in exported_at', async () => {
      const input: UpsertAgentInput = {
        id: 'timestamp_test',
        slug: 'test:timestamp_test',
        name: 'Timestamp Test',
        domain: 'test',
        provider: 'claude_agents',
        model: 'claude-haiku-4-5-20251001',
        prompt_file: 'data/prompts/test.md'
      }

      await upsertAgent(input, tempDataDir, tempGlobalDir)

      const agentPath = path.join(tempDataDir, 'agents', 'test', 'timestamp_test/definition.json')
      const saved = JSON.parse(fs.readFileSync(agentPath, 'utf-8'))

      // Verify ISO format
      expect(saved.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)

      // Verify it's a valid date
      const date = new Date(saved.exported_at)
      expect(date.toString()).not.toBe('Invalid Date')
    })
  })
})
