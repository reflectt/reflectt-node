import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import upsertToolImplementation, { UpsertToolImplementationInput } from './implementation'

describe('upsertToolImplementation', () => {
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
    it('should create implementation in new structure (tools/[category]/[name]/implementation.ts)', async () => {
      // First create the definition
      const toolDir = path.join(tempGlobalDir, 'tools', 'test_category', 'test_tool')
      fs.mkdirSync(toolDir, { recursive: true })
      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify({ id: 'test_tool', name: 'Test Tool' }),
        'utf-8'
      )

      const input: UpsertToolImplementationInput = {
        tool_name: 'test_tool',
        category: 'test_category',
        implementation: 'export default async function testTool() { return "test"; }'
      }

      const result = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.path).toBe('tools/test_category/test_tool/implementation.ts')

      // Verify file exists at correct path
      const expectedPath = path.join(tempGlobalDir, 'tools', 'test_category', 'test_tool', 'implementation.ts')
      expect(fs.existsSync(expectedPath)).toBe(true)

      // Verify content
      const content = fs.readFileSync(expectedPath, 'utf-8')
      expect(content).toContain('export default async function testTool')
    })

    it('should overwrite existing implementation', async () => {
      // Create definition and initial implementation
      const toolDir = path.join(tempGlobalDir, 'tools', 'test_category', 'test_tool')
      fs.mkdirSync(toolDir, { recursive: true })
      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify({ id: 'test_tool' }),
        'utf-8'
      )

      const input: UpsertToolImplementationInput = {
        tool_name: 'test_tool',
        category: 'test_category',
        implementation: 'export default async function testTool() { return "v1"; }'
      }

      const result1 = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)
      expect(result1.success).toBe(true)

      // Update
      input.implementation = 'export default async function testTool() { return "v2"; }'
      const result2 = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)
      expect(result2.success).toBe(true)

      // Verify updated content
      const expectedPath = path.join(tempGlobalDir, 'tools', 'test_category', 'test_tool', 'implementation.ts')
      const content = fs.readFileSync(expectedPath, 'utf-8')
      expect(content).toContain('v2')
    })
  })

  describe('Error Handling', () => {
    it('should reject if definition does not exist', async () => {
      const input: UpsertToolImplementationInput = {
        tool_name: 'nonexistent_tool',
        category: 'test',
        implementation: 'export default async function() {}'
      }

      const result = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Definition not found')
    })

    it('should reject invalid tool_name', async () => {
      const input: any = {
        tool_name: 'Invalid-Name!',
        category: 'test',
        implementation: 'code'
      }

      const result = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid tool_name')
    })

    it('should reject invalid category', async () => {
      const input: any = {
        tool_name: 'test_tool',
        category: 'Invalid Category',
        implementation: 'code'
      }

      const result = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid category')
    })

    it('should reject missing implementation', async () => {
      const input: any = {
        tool_name: 'test_tool',
        category: 'test'
      }

      const result = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(false)
      expect(result.error).toContain('implementation is required')
    })
  })

  describe('Edge Cases', () => {
    it('should handle deeply nested categories', async () => {
      // Create definition first
      const toolDir = path.join(tempGlobalDir, 'tools', 'deeply_nested', 'nested_tool')
      fs.mkdirSync(toolDir, { recursive: true })
      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify({ id: 'nested_tool' }),
        'utf-8'
      )

      const input: UpsertToolImplementationInput = {
        tool_name: 'nested_tool',
        category: 'deeply_nested',
        implementation: 'export default async function() {}'
      }

      const result = await upsertToolImplementation(input, tempDataDir, tempGlobalDir)
      expect(result.success).toBe(true)

      const expectedPath = path.join(tempGlobalDir, 'tools', 'deeply_nested', 'nested_tool', 'implementation.ts')
      expect(fs.existsSync(expectedPath)).toBe(true)
    })
  })
})
