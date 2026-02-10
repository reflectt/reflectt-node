import {
  type ToolContext,
  formatError,
  validateRequired,
  validateAll,
  type ToolOutput,
} from '@/lib/tools/helpers'

interface GetToolInput {
  tool_name: string
  include_source?: boolean
}

interface ToolInfo {
  name: string
  category: string
  description: string
  definition: any
  implementation_path?: string
  source?: string
}

interface GetToolOutput extends ToolOutput<{ tool?: ToolInfo }> {
  success: boolean
  tool?: ToolInfo
}

async function getToolImpl(
  input: GetToolInput,
  ctx: ToolContext
): Promise<GetToolOutput> {
  // Validate input
  const validation = validateAll([
    () => validateRequired(input.tool_name, 'tool_name'),
  ])
  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  // Search for the tool in structure: tools/[category]/[name]/definition.json
  let foundDef: any = null
  let foundCategory: string = ''

  // Get all category directories
  const categories = await ctx.listDirs('global', 'tools')

  for (const category of categories) {
    const toolDirs = await ctx.listDirs('global', 'tools', category)

    for (const toolName of toolDirs) {
      if (toolName === input.tool_name) {
        try {
          foundDef = await ctx.readJson('global', 'tools', category, toolName, 'definition.json')
          if (foundDef) {
            foundCategory = category
            break
          }
        } catch {
          // Tool definition doesn't exist, continue
        }
      }
    }

    if (foundDef) break
  }

  if (!foundDef) {
    throw new Error(`Tool not found: ${input.tool_name}`)
  }

  // Check for implementation
  let hasImpl = false
  let source: string | undefined
  try {
    source = await ctx.readText('global', 'tools', foundCategory, input.tool_name, 'implementation.ts')
    hasImpl = true
  } catch {
    // Implementation doesn't exist
  }

  const tool: ToolInfo = {
    name: foundDef.function_name || input.tool_name,
    category: foundCategory,
    description: foundDef.description || '',
    definition: foundDef,
    implementation_path: hasImpl ? `tools/${foundCategory}/${input.tool_name}/implementation.ts` : undefined
  }

  // Include source if requested
  if (input.include_source && source) {
    tool.source = source
  }

  return { success: true, tool }
}

export default async function getTool(
  input: GetToolInput,
  ctx: ToolContext
): Promise<GetToolOutput> {
  try {
    const result = await getToolImpl(input, ctx)
    return { success: true, ...result }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
