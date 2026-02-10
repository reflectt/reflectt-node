import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import getAgent from './implementation'

describe('getAgent', () => {
  let tempDataDir: string
  let tempGlobalDir: string
  let originalCwd: string

  beforeEach(() => {
    // Create temporary directories for testing
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-data-'))
    tempGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-global-'))
    originalCwd = process.cwd()

    // Create test agents in space
    createTestAgent(tempDataDir, 'finance', 'budget_tracker', {
      id: 'budget_tracker',
      slug: 'finance:budget_tracker',
      name: 'Budget Tracker (Space)',
      domain: 'finance',
      provider: 'claude_agents',
      model: 'claude-haiku-4-5-20251001',
      prompt_file: 'data/prompts/finance/budget.md'
    })

    createTestAgent(tempDataDir, 'creative', 'story_writer', {
      id: 'story_writer',
      slug: 'creative:story_writer',
      name: 'Story Writer (Space)',
      domain: 'creative',
      provider: 'claude_agents',
      model: 'claude-opus-4-20250514',
      prompt_file: 'data/prompts/creative/story.md'
    })

    // Create test agents in global
    createTestAgent(tempGlobalDir, 'support', 'general_assistant', {
      id: 'general_assistant',
      slug: 'support:general_assistant',
      name: 'General Assistant (Global)',
      domain: 'support',
      provider: 'claude_agents',
      model: 'claude-haiku-4-5-20251001',
      prompt_file: 'data/prompts/support/general.md'
    })

    // Create same agent in both space and global (to test fallback)
    createTestAgent(tempGlobalDir, 'finance', 'global_tracker', {
      id: 'global_tracker',
      slug: 'finance:global_tracker',
      name: 'Global Tracker (Global)',
      domain: 'finance',
      provider: 'claude_agents',
      model: 'claude-haiku-4-5-20251001',
      prompt_file: 'data/prompts/finance/global.md'
    })
  })

  afterEach(() => {
    // Clean up temporary directories
    if (fs.existsSync(tempDataDir)) {
      fs.rmSync(tempDataDir, { recursive: true, force: true })
    }
    if (fs.existsSync(tempGlobalDir)) {
      fs.rmSync(tempGlobalDir, { recursive: true, force: true })
    }
    process.chdir(originalCwd)
  })

  function createTestAgent(baseDir: string, domain: string, id: string, data: any) {
    // New structure: agents/{category}/{agent_id}/definition.json
    const agentDir = path.join(baseDir, 'agents', domain, id)
    fs.mkdirSync(agentDir, { recursive: true })

    // Remove prompt_file from definition (it's stored separately now)
    const { prompt_file, ...definitionData } = data
    fs.writeFileSync(
      path.join(agentDir, 'definition.json'),
      JSON.stringify(definitionData, null, 2),
      'utf-8'
    )

    // Optionally create prompt file if specified
    if (prompt_file) {
      fs.writeFileSync(
        path.join(agentDir, 'prompt.md'),
        `# ${data.name}\n\nTest prompt content.`,
        'utf-8'
      )
    }
  }

  describe('Happy Path - Get by Slug', () => {
    it('should get agent from space by slug', async () => {
      const result = await getAgent(
        { slug: 'finance:budget_tracker' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.id).toBe('budget_tracker')
      expect(result.agent.slug).toBe('finance:budget_tracker')
      expect(result.agent.name).toBe('Budget Tracker (Space)')
      expect(result.agent.domain).toBe('finance')
      expect(result.agent.source).toBe('space')
      expect(result.found_in).toBe('space')
      expect(result.agent.path).toContain('definition.json')
    })

    it('should get agent from global by slug', async () => {
      const result = await getAgent(
        { slug: 'support:general_assistant' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.id).toBe('general_assistant')
      expect(result.agent.slug).toBe('support:general_assistant')
      expect(result.agent.name).toBe('General Assistant (Global)')
      expect(result.agent.domain).toBe('support')
      expect(result.agent.source).toBe('global')
      expect(result.found_in).toBe('global')
    })
  })

  describe('Happy Path - Get by ID', () => {
    it('should get agent by ID (searches all domains)', async () => {
      const result = await getAgent(
        { agent_id: 'budget_tracker' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.id).toBe('budget_tracker')
      expect(result.agent.slug).toBe('finance:budget_tracker')
      expect(result.agent.domain).toBe('finance')
      expect(result.found_in).toBe('space')
    })

    it('should find agent in any domain when using agent_id', async () => {
      const result = await getAgent(
        { agent_id: 'story_writer' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.id).toBe('story_writer')
      expect(result.agent.domain).toBe('creative')
    })
  })

  describe('Hierarchical Search (Space → Global)', () => {
    it('should prefer space over global when agent exists in both', async () => {
      // Create same agent in both locations
      createTestAgent(tempDataDir, 'finance', 'shared_agent', {
        id: 'shared_agent',
        slug: 'finance:shared_agent',
        name: 'Shared Agent (Space)',
        domain: 'finance'
      })

      createTestAgent(tempGlobalDir, 'finance', 'shared_agent', {
        id: 'shared_agent',
        slug: 'finance:shared_agent',
        name: 'Shared Agent (Global)',
        domain: 'finance'
      })

      const result = await getAgent(
        { slug: 'finance:shared_agent' },
        tempDataDir,
        tempGlobalDir
      )

      // Should get space version
      expect(result.agent.name).toBe('Shared Agent (Space)')
      expect(result.found_in).toBe('space')
    })

    it('should fall back to global when not found in space', async () => {
      const result = await getAgent(
        { slug: 'finance:global_tracker' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.name).toBe('Global Tracker (Global)')
      expect(result.found_in).toBe('global')
    })
  })

  describe('Search Control Flags', () => {
    it('should skip space search when search_space: false', async () => {
      const result = await getAgent(
        {
          slug: 'finance:global_tracker',
          search_space: false,
          search_global: true
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.found_in).toBe('global')
    })

    it('should skip global search when search_global: false', async () => {
      const result = await getAgent(
        {
          slug: 'finance:budget_tracker',
          search_space: true,
          search_global: false
        },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.found_in).toBe('space')
    })

    it('should return error when agent only exists in global but search_global: false', async () => {
      const result = await getAgent(
        {
          slug: 'support:general_assistant',
          search_space: true,
          search_global: false
        },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found: support:general_assistant')
    })
  })

  describe('Missing Required Parameters', () => {
    it('should return error when both agent_id and slug are missing', async () => {
      const result = await getAgent({}, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Either agent_id or slug must be provided')
    })

    it('should return error when input is empty object', async () => {
      const result = await getAgent({} as any, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Either agent_id or slug must be provided')
    })
  })

  describe('Invalid Inputs', () => {
    it('should return error for invalid slug format', async () => {
      const result = await getAgent(
        { slug: 'invalid-slug-no-colon' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid slug format')
    })

    it('should return error for slug with too many parts', async () => {
      const result = await getAgent(
        { slug: 'finance:budget:tracker' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid slug format')
    })

    it('should return error for slug with empty parts', async () => {
      const result1 = await getAgent(
        { slug: ':budget_tracker' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result1.success).toBe(false)
      expect(result1.error).toContain('Invalid slug format')

      const result2 = await getAgent(
        { slug: 'finance:' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result2.success).toBe(false)
      expect(result2.error).toContain('Invalid slug format')
    })
  })

  describe('Agent Not Found', () => {
    it('should return error when agent does not exist', async () => {
      const result = await getAgent(
        { slug: 'nonexistent:agent' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found: nonexistent:agent')
    })

    it('should return error when agent ID does not exist in any domain', async () => {
      const result = await getAgent(
        { agent_id: 'nonexistent_agent' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found: nonexistent_agent')
    })

    it('should return error when domain exists but agent does not', async () => {
      const result = await getAgent(
        { slug: 'finance:nonexistent' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found: finance:nonexistent')
    })
  })

  describe('Edge Cases', () => {
    it('should handle agent ID with underscores', async () => {
      createTestAgent(tempDataDir, 'test', 'agent_with_underscores', {
        id: 'agent_with_underscores',
        slug: 'test:agent_with_underscores',
        name: 'Test Agent'
      })

      const result = await getAgent(
        { agent_id: 'agent_with_underscores' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.id).toBe('agent_with_underscores')
    })

    it('should handle empty agents directory', async () => {
      const emptyDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-empty-'))

      const result = await getAgent(
        { slug: 'finance:budget_tracker' },
        emptyDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found')

      fs.rmSync(emptyDataDir, { recursive: true, force: true })
    })

    it('should handle malformed JSON gracefully', async () => {
      const malformedDir = path.join(tempDataDir, 'agents', 'broken', 'malformed')
      fs.mkdirSync(malformedDir, { recursive: true })
      fs.writeFileSync(path.join(malformedDir, 'definition.json'), '{ invalid json }', 'utf-8')

      // Should log error and continue searching
      const result = await getAgent(
        { slug: 'broken:malformed' },
        tempDataDir,
        tempGlobalDir
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('Agent not found')
    })
  })

  describe('Data Integrity', () => {
    it('should return complete agent data', async () => {
      const result = await getAgent(
        { slug: 'finance:budget_tracker' },
        tempDataDir,
        tempGlobalDir
      )

      // Verify all expected fields
      expect(result.agent.id).toBeDefined()
      expect(result.agent.slug).toBeDefined()
      expect(result.agent.name).toBeDefined()
      expect(result.agent.domain).toBeDefined()
      expect(result.agent.provider).toBeDefined()
      expect(result.agent.model).toBeDefined()
      expect(result.agent.prompt_file).toBeDefined()
      expect(result.agent.source).toBeDefined()
      expect(result.agent.path).toBeDefined()
    })

    it('should match source with found_in', async () => {
      const result = await getAgent(
        { slug: 'finance:budget_tracker' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.source).toBe(result.found_in)
    })

    it('should include full file path in agent.path', async () => {
      const result = await getAgent(
        { slug: 'finance:budget_tracker' },
        tempDataDir,
        tempGlobalDir
      )

      expect(result.agent.path).toContain('agents')
      expect(result.agent.path).toContain('finance')
      expect(result.agent.path).toContain('definition.json')
      expect(path.isAbsolute(result.agent.path!)).toBe(true)
    })
  })

  describe('Slug vs ID Priority', () => {
    it('should prioritize slug over agent_id when both provided', async () => {
      const result = await getAgent(
        {
          slug: 'finance:budget_tracker',
          agent_id: 'story_writer'  // Should be ignored
        },
        tempDataDir,
        tempGlobalDir
      )

      // Should get budget_tracker (from slug), not story_writer
      expect(result.agent.id).toBe('budget_tracker')
      expect(result.agent.domain).toBe('finance')
    })
  })

  describe('Multiple Domains Search (ID only)', () => {
    it('should search across all domains when using agent_id', async () => {
      // Create agents with same ID in different domains
      createTestAgent(tempDataDir, 'domain_a', 'shared_id', {
        id: 'shared_id',
        slug: 'domain_a:shared_id',
        name: 'Agent A'
      })

      createTestAgent(tempDataDir, 'domain_b', 'shared_id', {
        id: 'shared_id',
        slug: 'domain_b:shared_id',
        name: 'Agent B'
      })

      const result = await getAgent(
        { agent_id: 'shared_id' },
        tempDataDir,
        tempGlobalDir
      )

      // Should find one of them (order depends on file system)
      expect(result.agent.id).toBe('shared_id')
      expect(['domain_a', 'domain_b']).toContain(result.agent.domain)
    })
  })
})
