import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import upsertToolDefinition, { UpsertToolDefinitionInput } from './implementation'

describe('upsertToolDefinition', () => {
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
    it('should create definition in new structure (tools/[category]/[name]/definition.json)', async () => {
      const input: UpsertToolDefinitionInput = {
        tool_name: 'test_tool',
        category: 'test_category',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string' }
          }
        },
        tags: ['test'],
        version: '1.0.0'
      }

      const result = await upsertToolDefinition(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.path).toBe('tools/test_category/test_tool/definition.json')

      // Verify file exists at correct path
      const expectedPath = path.join(tempGlobalDir, 'tools', 'test_category', 'test_tool', 'definition.json')
      expect(fs.existsSync(expectedPath)).toBe(true)

      // Verify content
      const content = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'))
      expect(content.id).toBe('test_tool')
      expect(content.category).toBe('test_category')
      expect(content.description).toBe('A test tool')
    })

    it('should overwrite existing definition', async () => {
      const input: UpsertToolDefinitionInput = {
        tool_name: 'test_tool',
        category: 'test_category',
        description: 'First version',
        parameters: { type: 'object' }
      }

      const result1 = await upsertToolDefinition(input, tempDataDir, tempGlobalDir)
      expect(result1.success).toBe(true)

      // Update
      input.description = 'Updated version'
      const result2 = await upsertToolDefinition(input, tempDataDir, tempGlobalDir)
      expect(result2.success).toBe(true)

      // Verify updated content
      const expectedPath = path.join(tempGlobalDir, 'tools', 'test_category', 'test_tool', 'definition.json')
      const content = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'))
      expect(content.description).toBe('Updated version')
    })
  })

  describe('Error Handling', () => {
    it('should reject invalid tool_name', async () => {
      const input: any = {
        tool_name: 'Invalid-Name!',
        category: 'test',
        description: 'Test',
        parameters: {}
      }

      const result = await upsertToolDefinition(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid tool_name')
    })

    it('should reject invalid category', async () => {
      const input: any = {
        tool_name: 'test_tool',
        category: 'Invalid Category',
        description: 'Test',
        parameters: {}
      }

      const result = await upsertToolDefinition(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid category')
    })

    it('should reject missing parameters', async () => {
      const input: any = {
        tool_name: 'test_tool',
        category: 'test',
        description: 'Test'
      }

      const result = await upsertToolDefinition(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('parameters is required')
    })
  })

  describe('Edge Cases', () => {
    it('should create nested category directories', async () => {
      const input: UpsertToolDefinitionInput = {
        tool_name: 'nested_tool',
        category: 'deeply_nested',
        description: 'Test',
        parameters: { type: 'object' }
      }

      const result = await upsertToolDefinition(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)

      const expectedPath = path.join(tempGlobalDir, 'tools', 'deeply_nested', 'nested_tool', 'definition.json')
      expect(fs.existsSync(expectedPath)).toBe(true)
    })
  })
})
