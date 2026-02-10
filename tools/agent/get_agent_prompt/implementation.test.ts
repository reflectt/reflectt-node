import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execute as getAgentPrompt } from './implementation'

describe('getAgentPrompt', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-prompts-'))
  })

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    // Restore process.cwd if needed
    process.chdir(__dirname)
  })

  it('should get prompt for global agent', async () => {
    // Change to temp dir so relative paths work
    const originalCwd = process.cwd()
    process.chdir(tempDir)

    const agentDir = path.join(tempDir, 'data/global/agents/testing/test_agent')
    fs.mkdirSync(agentDir, { recursive: true })
    fs.writeFileSync(path.join(agentDir, 'prompt.md'), '# Test Prompt\n\nTest content')

    const result = await getAgentPrompt({
      agent_id: 'test_agent',
      category: 'testing',
      scope: 'global'
    })

    expect(result.success).toBe(true)
    expect(result.prompt).toContain('# Test Prompt')
    expect(result.metadata?.prompt_exists).toBe(true)

    process.chdir(originalCwd)
  })

  it('should handle missing prompt file', async () => {
    const originalCwd = process.cwd()
    process.chdir(tempDir)

    const agentDir = path.join(tempDir, 'data/global/agents/testing/test_agent')
    fs.mkdirSync(agentDir, { recursive: true })

    const result = await getAgentPrompt({
      agent_id: 'test_agent',
      category: 'testing',
      scope: 'global'
    })

    expect(result.success).toBe(false)
    expect(result.metadata?.prompt_exists).toBe(false)

    process.chdir(originalCwd)
  })

  it('should require space_id when scope is space', async () => {
    const result = await getAgentPrompt({
      agent_id: 'test_agent',
      category: 'testing',
      scope: 'space'
      // Missing space_id
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('space_id is required')
  })
})
