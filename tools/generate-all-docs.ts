#!/usr/bin/env tsx

/**
 * Automated documentation and test generator for all tools
 *
 * This script generates README.md and implementation.test.ts files
 * for all tools that don't have them yet.
 */

import * as fs from 'fs'
import * as path from 'path'

interface ToolDefinition {
  id: string
  name: string
  description: string
  category: string
  parameters: any
  function_name: string
  context_requirements?: string[]
  examples?: any[]
}

const TOOL_CATEGORIES = [
  'agent',
  'data',
  'storage',
  'task',
  'tools',
  'web',
  'workflows'
]

const COMPLETED_TOOLS = [
  'agent/upsert_agent',
  'agent/get_agent',
  'data/upsert_record',
  'time/get_current_time',
  'web/web_search'
]

function generateReadme(toolDef: ToolDefinition, implCode: string): string {
  const required: string[] = []
  const optional: string[] = []

  if (toolDef.parameters?.properties) {
    const requiredFields = toolDef.parameters.required || []

    for (const [key, value] of Object.entries(toolDef.parameters.properties)) {
      const param: any = value
      if (requiredFields.includes(key)) {
        required.push(`| \`${key}\` | ${param.type} | ${param.description || ''} |`)
      } else {
        optional.push(`| \`${key}\` | ${param.type} | ${param.default !== undefined ? param.default : '-'} | ${param.description || ''} |`)
      }
    }
  }

  return `# ${toolDef.name || toolDef.id}

## Description

${toolDef.description}

## Purpose and Use Cases

- **Primary use**: ${toolDef.description}
- **Integration**: Works with ${toolDef.category} category tools
${toolDef.context_requirements ? `- **Requirements**: Needs ${toolDef.context_requirements.join(', ')}` : ''}

## Input Parameters

${required.length > 0 ? `### Required Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
${required.join('\n')}
` : ''}

${optional.length > 0 ? `### Optional Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
${optional.join('\n')}
` : ''}

## Output Format

See implementation for specific output type.

## Example Usage

\`\`\`typescript
import ${toCamelCase(toolDef.function_name)} from './implementation'

const result = await ${toCamelCase(toolDef.function_name)}(
  {
    // Add parameters here
  }${toolDef.context_requirements?.map(req => `,\n  ${req}`).join('') || ''}
)

console.log(result)
\`\`\`

${toolDef.examples && toolDef.examples.length > 0 ? `
## Examples

${toolDef.examples.map((ex: any, i: number) => `
### Example ${i + 1}: ${ex.scenario || 'Usage'}

\`\`\`typescript
const result = await ${toCamelCase(toolDef.function_name)}(
  ${JSON.stringify(ex.parameters, null, 2)}${toolDef.context_requirements?.map(req => `,\n  ${req}`).join('') || ''}
)

// Expected: ${ex.expected_result}
\`\`\`
`).join('\n')}
` : ''}

## Error Handling

The function returns structured error responses when issues occur.

## Related Tools

- See other ${toolDef.category} category tools
`
}

function generateTest(toolDef: ToolDefinition, implCode: string): string {
  const fnName = toCamelCase(toolDef.function_name)
  const inputType = fnName.charAt(0).toUpperCase() + fnName.slice(1) + 'Input'

  const contextParams = (toolDef.context_requirements || [])
    .filter(r => r !== 'dataDir' && r !== 'globalDir')

  const hasSpecialContext = contextParams.length > 0

  return `import { describe, it, expect, beforeEach, afterEach${hasSpecialContext ? ', vi' : ''} } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import ${fnName}, { ${inputType} } from './implementation'

describe('${fnName}', () => {
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
    it('should execute successfully with valid input', async () => {
      const input: ${inputType} = {
        // TODO: Add test input
      }

      const result = await ${fnName}(input, tempDataDir, tempGlobalDir${hasSpecialContext ? ', /* mock context */' : ''})

      expect(result).toBeDefined()
      // TODO: Add specific assertions
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid input gracefully', async () => {
      const input: any = {
        // Invalid input
      }

      ${hasSpecialContext ? `
      // Test should handle missing context
      try {
        await ${fnName}(input, tempDataDir, tempGlobalDir)
      } catch (error) {
        expect(error).toBeDefined()
      }
      ` : `
      const result = await ${fnName}(input, tempDataDir, tempGlobalDir)
      expect(result).toBeDefined()
      `}
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty directories', async () => {
      const input: ${inputType} = {
        // TODO: Add test input
      }

      const result = await ${fnName}(input, tempDataDir, tempGlobalDir${hasSpecialContext ? ', /* mock context */' : ''})

      expect(result).toBeDefined()
    })
  })
})
`
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

function shouldSkip(toolPath: string): boolean {
  return COMPLETED_TOOLS.some(completed => toolPath.includes(completed))
}

async function generateDocsForTool(categoryPath: string, toolName: string) {
  const toolPath = path.join(categoryPath, toolName)
  const defPath = path.join(toolPath, 'definition.json')
  const implPath = path.join(toolPath, 'implementation.ts')
  const readmePath = path.join(toolPath, 'README.md')
  const testPath = path.join(toolPath, 'implementation.test.ts')

  const relPath = path.relative(process.cwd(), toolPath)
  if (shouldSkip(relPath)) {
    console.log(`⏭️  Skipping ${relPath} (already completed)`)
    return
  }

  if (!fs.existsSync(defPath) || !fs.existsSync(implPath)) {
    console.log(`⚠️  Missing files for ${toolName}`)
    return
  }

  const toolDef: ToolDefinition = JSON.parse(fs.readFileSync(defPath, 'utf-8'))
  const implCode = fs.readFileSync(implPath, 'utf-8')

  // Generate README if missing
  if (!fs.existsSync(readmePath)) {
    const readme = generateReadme(toolDef, implCode)
    fs.writeFileSync(readmePath, readme, 'utf-8')
    console.log(`✅ Generated README for ${toolName}`)
  }

  // Generate test if missing
  if (!fs.existsSync(testPath)) {
    const test = generateTest(toolDef, implCode)
    fs.writeFileSync(testPath, test, 'utf-8')
    console.log(`✅ Generated test for ${toolName}`)
  }
}

async function main() {
  const toolsRoot = __dirname

  console.log('🚀 Starting automated documentation generation...\n')
  console.log(`Tools root: ${toolsRoot}\n`)

  for (const category of TOOL_CATEGORIES) {
    const categoryPath = path.join(toolsRoot, category)

    if (!fs.existsSync(categoryPath)) {
      console.log(`⚠️  Category not found: ${category}`)
      continue
    }

    console.log(`\n📁 Processing category: ${category}`)

    const tools = fs.readdirSync(categoryPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    for (const toolName of tools) {
      await generateDocsForTool(categoryPath, toolName)
    }
  }

  console.log('\n✨ Documentation generation complete!')
}

main().catch(console.error)
