import { stat } from 'fs/promises'
import {
  formatError,
  validateRequired,
  validateAll,
  type ToolOutput,
  type ToolContext,
} from '@/lib/tools/helpers'

interface GetToolImplementationInput {
  tool_name: string
  category: string
  target_space?: string
}

interface GetToolImplementationOutput extends ToolOutput<Record<string, unknown>> {
  success: boolean
  tool_name?: string
  category?: string
  implementation_code?: string
  path?: string
  file_size?: number
  last_modified?: string
}

async function getToolImplementationImpl(
  input: GetToolImplementationInput,
  ctx: ToolContext
): Promise<GetToolImplementationOutput> {
  // Validate input
  const validation = validateAll([
    () => validateRequired(input.tool_name, 'tool_name'),
    () => validateRequired(input.category, 'category'),
  ])

  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  const space = input.target_space || 'global'

  // Read the implementation file
  let implementationCode: string
  try {
    implementationCode = await ctx.readText(space, 'tools', input.category, input.tool_name, 'implementation.ts')
  } catch {
    throw new Error(`Implementation file not found for tool '${input.tool_name}' in category '${input.category}'`)
  }

  // Get file stats
  const implementationPath = ctx.resolvePath(space, 'tools', input.category, input.tool_name, 'implementation.ts')
  const stats = await stat(implementationPath)

  return {
    success: true,
    tool_name: input.tool_name,
    category: input.category,
    implementation_code: implementationCode,
    path: implementationPath,
    file_size: stats.size,
    last_modified: stats.mtime.toISOString(),
  }
}

export default async function getToolImplementation(
  input: GetToolImplementationInput,
  ctx: ToolContext
): Promise<GetToolImplementationOutput> {
  try {
    return { success: true, ...(await getToolImplementationImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
