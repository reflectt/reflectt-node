import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import getTool, { GetToolInput } from './implementation'

describe('getTool', () => {
  let tempDataDir: string
  let tempGlobalDir: string

  beforeEach(() => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-data-'))
    tempGlobalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-global-'))

    // Create tools directory structure
    const toolsDir = path.join(tempGlobalDir, 'tools')
    fs.mkdirSync(toolsDir, { recursive: true })
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
    it('should retrieve a tool with definition only', async () => {
      // Create a test tool: tools/test_category/test_tool/definition.json
      const categoryDir = path.join(tempGlobalDir, 'tools', 'test_category')
      const toolDir = path.join(categoryDir, 'test_tool')
      fs.mkdirSync(toolDir, { recursive: true })

      const definition = {
        function_name: 'test_tool',
        description: 'A test tool',
        parameters: {}
      }
      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify(definition, null, 2)
      )

      const input: GetToolInput = {
        tool_name: 'test_tool'
      }

      const result = await getTool(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.tool).toBeDefined()
      expect(result.tool?.name).toBe('test_tool')
      expect(result.tool?.category).toBe('test_category')
      expect(result.tool?.description).toBe('A test tool')
      expect(result.tool?.definition).toEqual(definition)
      expect(result.tool?.implementation_path).toBeUndefined()
    })

    it('should retrieve a tool with definition and implementation', async () => {
      // Create a test tool with implementation
      const categoryDir = path.join(tempGlobalDir, 'tools', 'test_category')
      const toolDir = path.join(categoryDir, 'test_tool')
      fs.mkdirSync(toolDir, { recursive: true })

      const definition = {
        function_name: 'test_tool',
        description: 'A test tool',
        parameters: {}
      }
      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify(definition, null, 2)
      )

      const implementation = 'export default async function testTool() { return {} }'
      fs.writeFileSync(
        path.join(toolDir, 'implementation.ts'),
        implementation
      )

      const input: GetToolInput = {
        tool_name: 'test_tool',
        include_source: true
      }

      const result = await getTool(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.tool).toBeDefined()
      expect(result.tool?.name).toBe('test_tool')
      expect(result.tool?.category).toBe('test_category')
      expect(result.tool?.implementation_path).toBeDefined()
      expect(result.tool?.source).toBe(implementation)
    })
  })

  describe('Error Handling', () => {
    it('should return error when tool_name is missing', async () => {
      const input: any = {}

      const result = await getTool(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('tool_name is required')
    })

    it('should return error when tool not found', async () => {
      const input: GetToolInput = {
        tool_name: 'nonexistent_tool'
      }

      const result = await getTool(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Tool not found')
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty tools directory', async () => {
      const input: GetToolInput = {
        tool_name: 'test_tool'
      }

      const result = await getTool(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Tool not found')
    })

    it('should handle tool without include_source flag', async () => {
      const categoryDir = path.join(tempGlobalDir, 'tools', 'test_category')
      const toolDir = path.join(categoryDir, 'test_tool')
      fs.mkdirSync(toolDir, { recursive: true })

      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify({ function_name: 'test_tool', description: 'Test' })
      )
      fs.writeFileSync(
        path.join(toolDir, 'implementation.ts'),
        'export default async function testTool() {}'
      )

      const input: GetToolInput = {
        tool_name: 'test_tool',
        include_source: false
      }

      const result = await getTool(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.tool?.source).toBeUndefined()
    })
  })
})
