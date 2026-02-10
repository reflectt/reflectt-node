import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import upsertAgentPrompt from './implementation';

describe('upsert_agent_prompt', () => {
  const testDataDir = join(process.cwd(), 'test-data-agent-prompt');
  const testGlobalDir = join(testDataDir, 'global');
  const testCategory = 'test_category';
  const testAgentId = 'test_agent';
  const testAgentDir = join(testGlobalDir, 'agents', testCategory, testAgentId);

  beforeEach(() => {
    // Create test directory structure
    mkdirSync(testAgentDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should create a new prompt file', async () => {
    const input = {
      agent_id: testAgentId,
      category: testCategory,
      prompt: '# Test Prompt\n\nThis is a test prompt for the agent.',
      scope: 'global' as const,
    };

    const result = await upsertAgentPrompt(input, testDataDir, testGlobalDir);

    expect(result.success).toBe(true);
    expect(result.message).toContain('created successfully');
    expect(result.metadata?.is_new).toBe(true);
    expect(result.metadata?.prompt_length).toBe(input.prompt.length);

    // Verify file was created
    const promptPath = join(testAgentDir, 'prompt.md');
    expect(existsSync(promptPath)).toBe(true);
    
    const content = readFileSync(promptPath, 'utf-8');
    expect(content).toBe(input.prompt);
  });

  it('should update an existing prompt file', async () => {
    const initialPrompt = '# Initial Prompt\n\nInitial content.';
    const updatedPrompt = '# Updated Prompt\n\nUpdated content with more details.';

    // Create initial prompt
    await upsertAgentPrompt({
      agent_id: testAgentId,
      category: testCategory,
      prompt: initialPrompt,
      scope: 'global' as const,
    }, testDataDir, testGlobalDir);

    // Update prompt
    const result = await upsertAgentPrompt({
      agent_id: testAgentId,
      category: testCategory,
      prompt: updatedPrompt,
      scope: 'global' as const,
    }, testDataDir, testGlobalDir);

    expect(result.success).toBe(true);
    expect(result.message).toContain('updated successfully');
    expect(result.metadata?.is_new).toBe(false);
    expect(result.metadata?.prompt_length).toBe(updatedPrompt.length);

    // Verify file was updated
    const promptPath = join(testAgentDir, 'prompt.md');
    const content = readFileSync(promptPath, 'utf-8');
    expect(content).toBe(updatedPrompt);
  });

  it('should fail if agent directory does not exist', async () => {
    const input = {
      agent_id: 'nonexistent_agent',
      category: testCategory,
      prompt: '# Test Prompt',
      scope: 'global' as const,
    };

    const result = await upsertAgentPrompt(input, testDataDir, testGlobalDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Agent directory not found');
  });

  it('should fail if prompt is empty', async () => {
    const input = {
      agent_id: testAgentId,
      category: testCategory,
      prompt: '',
      scope: 'global' as const,
    };

    const result = await upsertAgentPrompt(input, testDataDir, testGlobalDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain('prompt cannot be empty');
  });

  it('should fail if scope is space but space_id is missing', async () => {
    const input = {
      agent_id: testAgentId,
      category: testCategory,
      prompt: '# Test Prompt',
      scope: 'space' as const,
    };

    const result = await upsertAgentPrompt(input, testDataDir, testGlobalDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain('space_id is required');
  });

  it('should handle errors gracefully', async () => {
    const input = {
      agent_id: testAgentId,
      category: testCategory,
      prompt: '# Test Prompt',
      scope: 'global' as const,
    };

    // Pass invalid directories to trigger an error
    const result = await upsertAgentPrompt(
      input,
      '/invalid/path/that/does/not/exist',
      '/invalid/global/path'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
