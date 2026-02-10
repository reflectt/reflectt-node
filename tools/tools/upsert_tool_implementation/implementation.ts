import {
  type ToolContext,
  formatError,
  validateIdentifier,
  validateRequired,
  validateAll,
  type ToolOutput,
} from '@/lib/tools/helpers'

interface UpsertToolImplementationInput {
  tool_name: string
  category: string
  implementation: string
}

interface UpsertToolImplementationOutput extends ToolOutput<{ path?: string }> {
  success: boolean
  path?: string
}

async function upsertToolImplementationImpl(
  input: UpsertToolImplementationInput,
  ctx: ToolContext
): Promise<UpsertToolImplementationOutput> {
  // Validate input
  const validation = validateAll([
    () => validateRequired(input.tool_name, 'tool_name'),
    () => validateRequired(input.category, 'category'),
    () => validateRequired(input.implementation, 'implementation'),
    () => validateIdentifier(input.tool_name, 'tool_name'),
    () => validateIdentifier(input.category, 'category'),
  ])

  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  // Verify definition exists
  try {
    await ctx.readJson('global', 'tools', input.category, input.tool_name, 'definition.json')
  } catch {
    throw new Error('Definition not found. Create definition first using upsert_tool_definition.')
  }

  // Write implementation file (structure: tools/[category]/[name]/implementation.ts)
  await ctx.writeText('global', 'tools', input.category, input.tool_name, 'implementation.ts', input.implementation)

  return {
    success: true,
    path: `tools/${input.category}/${input.tool_name}/implementation.ts`
  }
}

export default async function upsertToolImplementation(
  input: UpsertToolImplementationInput,
  ctx: ToolContext
): Promise<UpsertToolImplementationOutput> {
  try {
    return { success: true, ...(await upsertToolImplementationImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
