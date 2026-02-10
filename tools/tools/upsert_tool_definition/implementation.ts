import {
  type ToolContext,
  formatError,
  validateIdentifier,
  validateRequired,
  validateAll,
  type ToolOutput,
} from '@/lib/tools/helpers'

interface UpsertToolDefinitionInput {
  tool_name: string
  category: string
  description: string
  parameters: any
  tags?: string[]
  examples?: any[]
  version?: string
}

interface UpsertToolDefinitionOutput extends ToolOutput<UpsertToolDefinitionInput> {
  success: boolean
  path?: string
}

async function upsertToolDefinitionImpl(
  input: UpsertToolDefinitionInput,
  ctx: ToolContext
): Promise<UpsertToolDefinitionOutput> {
  // Validate input
  const validation = validateAll([
    () => validateRequired(input.tool_name, 'tool_name'),
    () => validateRequired(input.category, 'category'),
    () => validateRequired(input.description, 'description'),
    () => validateRequired(input.parameters, 'parameters'),
    () => validateIdentifier(input.tool_name, 'tool_name'),
    () => validateIdentifier(input.category, 'category'),
  ])

  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  if (!input.parameters || typeof input.parameters !== 'object') {
    throw new Error('parameters required (must be object)')
  }

  // Create definition
  const definition = {
    id: input.tool_name,
    name: input.tool_name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    description: input.description,
    category: input.category,
    function_name: input.tool_name,
    parameters: input.parameters,
    use_tool_context: true,
    examples: input.examples || [],
    tags: input.tags || [],
    version: input.version || '1.0.0',
    dependencies: []
  }

  // Write definition file (structure: tools/[category]/[name]/definition.json)
  // Tools are always global
  await ctx.writeJson('global', 'tools', input.category, input.tool_name, 'definition.json', definition)

  return {
    success: true,
    path: `tools/${input.category}/${input.tool_name}/definition.json`
  }
}

export default async function upsertToolDefinition(
  input: UpsertToolDefinitionInput,
  ctx: ToolContext
): Promise<UpsertToolDefinitionOutput> {
  try {
    return { success: true, ...(await upsertToolDefinitionImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
