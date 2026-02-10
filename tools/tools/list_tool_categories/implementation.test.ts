import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import listToolCategories, { ListToolCategoriesInput } from './implementation'

describe('listToolCategories', () => {
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
    it('should list all categories with tool counts', async () => {
      // Create multiple categories with different tool counts
      const cat1Dir = path.join(tempGlobalDir, 'tools', 'category1')
      const cat2Dir = path.join(tempGlobalDir, 'tools', 'category2')
      const cat3Dir = path.join(tempGlobalDir, 'tools', 'category3')

      // Category 1: 2 tools
      const tool1Dir = path.join(cat1Dir, 'tool1')
      fs.mkdirSync(tool1Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool1Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool1', description: 'Tool 1' })
      )

      const tool2Dir = path.join(cat1Dir, 'tool2')
      fs.mkdirSync(tool2Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool2Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool2', description: 'Tool 2' })
      )

      // Category 2: 1 tool
      const tool3Dir = path.join(cat2Dir, 'tool3')
      fs.mkdirSync(tool3Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool3Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool3', description: 'Tool 3' })
      )

      // Category 3: empty (should still be listed)
      fs.mkdirSync(cat3Dir, { recursive: true })

      const input: ListToolCategoriesInput = {
        include_counts: true
      }

      const result = await listToolCategories(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.categories).toBeDefined()
      expect(result.total).toBe(3)
      expect(result.categories?.length).toBe(3)

      // Check categories are sorted alphabetically
      expect(result.categories?.[0].name).toBe('category1')
      expect(result.categories?.[1].name).toBe('category2')
      expect(result.categories?.[2].name).toBe('category3')

      // Check tool counts
      expect(result.categories?.[0].tool_count).toBe(2)
      expect(result.categories?.[1].tool_count).toBe(1)
      expect(result.categories?.[2].tool_count).toBe(0)
    })

    it('should list categories without counts when not requested', async () => {
      const catDir = path.join(tempGlobalDir, 'tools', 'category1')
      const toolDir = path.join(catDir, 'tool1')
      fs.mkdirSync(toolDir, { recursive: true })
      fs.writeFileSync(
        path.join(toolDir, 'definition.json'),
        JSON.stringify({ function_name: 'tool1', description: 'Tool 1' })
      )

      const input: ListToolCategoriesInput = {
        include_counts: false
      }

      const result = await listToolCategories(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.categories?.[0].name).toBe('category1')
      expect(result.categories?.[0].tool_count).toBeUndefined()
    })
  })

  describe('Error Handling', () => {
    it('should handle empty input gracefully', async () => {
      const input: ListToolCategoriesInput = {}

      const result = await listToolCategories(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.categories).toEqual([])
      expect(result.total).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty tools directory', async () => {
      const input: ListToolCategoriesInput = {}

      const result = await listToolCategories(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.categories).toEqual([])
      expect(result.total).toBe(0)
    })

    it('should count only tools with definition.json', async () => {
      const catDir = path.join(tempGlobalDir, 'tools', 'category1')

      // Tool with definition
      const tool1Dir = path.join(catDir, 'tool1')
      fs.mkdirSync(tool1Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool1Dir, 'definition.json'),
        JSON.stringify({ function_name: 'tool1', description: 'Tool 1' })
      )

      // Tool without definition (only implementation)
      const tool2Dir = path.join(catDir, 'tool2')
      fs.mkdirSync(tool2Dir, { recursive: true })
      fs.writeFileSync(
        path.join(tool2Dir, 'implementation.ts'),
        'export default async function tool2() {}'
      )

      const input: ListToolCategoriesInput = {
        include_counts: true
      }

      const result = await listToolCategories(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.total).toBe(1)
      expect(result.categories?.[0].tool_count).toBe(1) // Only tool1 counted
    })

    it('should handle category with no tools', async () => {
      const catDir = path.join(tempGlobalDir, 'tools', 'empty_category')
      fs.mkdirSync(catDir, { recursive: true })

      const input: ListToolCategoriesInput = {
        include_counts: true
      }

      const result = await listToolCategories(input, tempDataDir, tempGlobalDir)

      expect(result.success).toBe(true)
      expect(result.total).toBe(1)
      expect(result.categories?.[0].name).toBe('empty_category')
      expect(result.categories?.[0].tool_count).toBe(0)
    })
  })
})
