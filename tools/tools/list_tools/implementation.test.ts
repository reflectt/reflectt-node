import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import listTools, { ListToolsInput } from './implementation'

describe('listTools', () => {
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
    it('should list all tools across multiple categories', async () => {
      // Create tools in different categories
      const cat1Dir = path.join(tempGlobalDir, 'tools', 'category1')
      const cat2Dir = path.join(tempGlobalDir, 'tools', 'category2')

      // Category 1: tool1
      const tool1Dir = path.join(cat1Dir, 'tool1')
      fs.mkdirSync(tool1Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool1Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool1', description: 'Tool 1' })
      )
      fs.writeFileSync(
        path.join(tool1Dir, 'implementation.ts'),
        'export default async function tool1() {}'
      )

      // Category 1: tool2
      const tool2Dir = path.join(cat1Dir, 'tool2')
      fs.mkdirSync(tool2Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool2Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool2', description: 'Tool 2' })
      )

      // Category 2: tool3
      const tool3Dir = path.join(cat2Dir, 'tool3')
      fs.mkdirSync(tool3Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool3Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool3', description: 'Tool 3' })
      )

      const input: ListToolsInput = {}

      const result = await listTools(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.tools).toBeDefined()
      expect(result.total).toBe(3)
      expect(result.tools?.length).toBe(3)

      // Check sorting (category1 before category2)
      expect(result.tools?.[0].category).toBe('category1')
      expect(result.tools?.[1].category).toBe('category1')
      expect(result.tools?.[2].category).toBe('category2')

      // Check has_implementation
      expect(result.tools?.[0].has_implementation).toBe(true)
      expect(result.tools?.[1].has_implementation).toBe(false)
      expect(result.tools?.[2].has_implementation).toBe(false)
    })

    it('should filter tools by category', async () => {
      // Create tools in different categories
      const cat1Dir = path.join(tempGlobalDir, 'tools', 'category1')
      const cat2Dir = path.join(tempGlobalDir, 'tools', 'category2')

      const tool1Dir = path.join(cat1Dir, 'tool1')
      fs.mkdirSync(tool1Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool1Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool1', description: 'Tool 1' })
      )

      const tool2Dir = path.join(cat2Dir, 'tool2')
      fs.mkdirSync(tool2Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool2Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool2', description: 'Tool 2' })
      )

      const input: ListToolsInput = {
        category: 'category1'
      }

      const result = await listTools(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.total).toBe(1)
      expect(result.tools?.[0].name).toBe('tool1')
      expect(result.tools?.[0].category).toBe('category1')
    })
  })

  describe('Error Handling', () => {
    it('should handle empty input gracefully', async () => {
      const input: ListToolsInput = {}

      const result = await listTools(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.tools).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty tools directory', async () => {
      const input: ListToolsInput = {}

      const result = await listTools(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.tools).toEqual([])
      expect(result.total).toBe(0)
    })

    it('should skip tools without definition.json', async () => {
      const catDir = path.join(tempGlobalDir, 'tools', 'category1')
      const tool1Dir = path.join(catDir, 'tool1')
      fs.mkdirSync(tool1Dir, { recursive: true })

      // Only implementation, no definition
      fs.writeFileSync(
        path.join(tool1Dir, 'implementation.ts'),
        'export default async function tool1() {}'
      )

      const input: ListToolsInput = {}

      const result = await listTools(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.total).toBe(0)
    })

    it('should handle non-existent category filter', async () => {
      const catDir = path.join(tempGlobalDir, 'tools', 'category1')
      const toolDir = path.join(catDir, 'tool1')
      fs.mkdirSync(toolDir, { recursive: true })
      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify({ function_name: 'tool1', description: 'Tool 1' })
      )

      const input: ListToolsInput = {
        category: 'nonexistent'
      }

      const result = await listTools(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.total).toBe(0)
    })
  })
})
