import {
  type ToolContext,
  formatError,
  type ToolOutput,
} from '@/lib/tools/helpers'
import { loadAllTools } from '@/lib/tools/helpers/tool-loader'

interface ListToolsInput {
  category?: string
  include_implementations?: boolean
}

interface ToolItem {
  name: string
  category: string
  description: string
  has_implementation: boolean
  definition_path: string
  implementation_path?: string
}

interface ListToolsOutput extends ToolOutput<ListToolsData> {
  success: boolean
  tools?: ToolItem[]
  total?: number
}

interface ListToolsData {
  tools?: ToolItem[]
  total?: number
}

async function listToolsImpl(
  input: ListToolsInput,
  ctx: ToolContext
): Promise<ListToolsOutput> {
  const tools: ToolItem[] = []

  try {
    // Use tool-loader to get all tools from /tools directory
    const toolsDir = ctx.projectRoot + '/tools'
    const { definitions } = await loadAllTools(toolsDir)

    for (const [toolName, def] of definitions.entries()) {
      // Filter by category if specified
      if (input.category && def.category !== input.category) {
        continue
      }

      tools.push({
        name: def.function_name || def.name || toolName,
        category: def.category,
        description: def.description || '',
        has_implementation: true, // loadAllTools only returns tools with implementations
        definition_path: `tools/${def.category}/${toolName}/definition.json`,
        implementation_path: `tools/${def.category}/${toolName}/implementation.ts`
      })
    }
  } catch (error) {
    // If tools directory doesn't exist, return empty list
    if ((error as any).code === 'ENOENT') {
      return { success: true, tools: [], total: 0 }
    }
    throw error
  }

  // Sort by category then name
  tools.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category.localeCompare(b.category)
    }
    return a.name.localeCompare(b.name)
  })

  return {
    success: true,
    tools,
    total: tools.length
  }
}

export default async function listTools(
  input: ListToolsInput,
  ctx: ToolContext
): Promise<ListToolsOutput> {
  try {
    return { success: true, ...(await listToolsImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
