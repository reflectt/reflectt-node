import {
  formatError,
  validateRequired,
  validateAll,
  type ToolContext,
} from '@/lib/tools/helpers'

interface UpsertToolTestInput {
  tool_name: string
  category: string
  test_code: string
  target_space?: string
}

interface UpsertToolTestOutput {
  success: boolean
  path?: string
  created?: boolean
  error?: string
}

async function upsertToolTestImpl(
  input: UpsertToolTestInput,
  ctx: ToolContext
): Promise<UpsertToolTestOutput> {
  // Validate input
  const validation = validateAll([
    () => validateRequired(input.tool_name, 'tool_name'),
    () => validateRequired(input.category, 'category'),
    () => validateRequired(input.test_code, 'test_code'),
  ])

  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  if (!input.test_code || input.test_code.trim().length === 0) {
    throw new Error('test_code cannot be empty')
  }

  const space = input.target_space || 'global'

  // Ensure the tool directory exists by checking for definition
  try {
    await ctx.readJson(space, 'tools', input.category, input.tool_name, 'definition.json')
  } catch {
    throw new Error(
      `Tool directory not found for '${input.tool_name}' in category '${input.category}'. Create the tool first using upsert_tool_definition and upsert_tool_implementation.`
    )
  }

  // Check if test file already exists
  let existed = false
  try {
    await ctx.readText(space, 'tools', input.category, input.tool_name, 'implementation.test.ts')
    existed = true
  } catch {
    // Doesn't exist yet
  }

  // Write the test file
  await ctx.writeText(input.test_code, space, 'tools', input.category, input.tool_name, 'implementation.test.ts')

  const testPath = ctx.resolvePath(space, 'tools', input.category, input.tool_name, 'implementation.test.ts')

  return {
    success: true,
    path: testPath,
    created: !existed,
  }
}

export default async function upsertToolTest(
  input: UpsertToolTestInput,
  ctx: ToolContext
): Promise<UpsertToolTestOutput> {
  try {
    return { success: true, ...(await upsertToolTestImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
