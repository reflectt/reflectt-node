import {
  formatError,
  validateRequired,
  validateAll,
  type ToolContext,
} from '@/lib/tools/helpers'

interface ValidateToolInput {
  tool_name: string
  strict?: boolean
  target_space?: string
}

interface ValidateToolOutput {
  success: boolean
  valid?: boolean
  issues?: string[]
  warnings?: string[]
  error?: string
}

async function validateToolImpl(
  input: ValidateToolInput,
  ctx: ToolContext
): Promise<ValidateToolOutput> {
  // Validate input
  const validation = validateAll([
    () => validateRequired(input.tool_name, 'tool_name'),
  ])
  if (!validation.valid) {
    throw new Error(validation.errors[0].message)
  }

  const space = input.target_space || 'global'
  const issues: string[] = []
  const warnings: string[] = []

  // Find tool definition in new structure: tools/[category]/[name]/definition.json
  let foundCategory = ''
  let foundDef: any = null

  const categories = await ctx.listDirs(space, 'tools')

  for (const category of categories) {
    const toolDirs = await ctx.listDirs(space, 'tools', category)

    for (const toolName of toolDirs) {
      if (toolName === input.tool_name) {
        try {
          foundDef = await ctx.readJson(space, 'tools', category, toolName, 'definition.json')
          if (foundDef) {
            foundCategory = category
            break
          }
        } catch {
          // Tool dir exists but no definition.json
          continue
        }
      }
    }

    if (foundDef) break
  }

  if (!foundDef) {
    throw new Error(`Tool not found: ${input.tool_name}`)
  }

  // Check required fields
  if (!foundDef.function_name) {
    issues.push('Missing function_name field')
  }

  if (!foundDef.parameters) {
    issues.push('Missing parameters field')
  }

  if (!foundDef.description) {
    warnings.push('Missing description')
  }

  if (!foundDef.category) {
    warnings.push('Missing category')
  }

  // Check implementation exists
  try {
    const implSource = await ctx.readText(space, 'tools', foundCategory, input.tool_name, 'implementation.ts')

    // Check for export default
    if (!implSource.includes('export default')) {
      issues.push('Implementation missing "export default" function')
    }

    // Check function name
    const funcName = foundDef.function_name
    if (funcName && !implSource.includes(funcName)) {
      warnings.push(`Function name "${funcName}" not found in implementation`)
    }
  } catch {
    issues.push('Implementation file not found')
  }

  // Strict mode checks
  if (input.strict) {
    if (!foundDef.examples || foundDef.examples.length === 0) {
      warnings.push('No examples provided')
    }

    if (!foundDef.tags || foundDef.tags.length === 0) {
      warnings.push('No tags provided')
    }

    if (!foundDef.version) {
      warnings.push('No version specified')
    }
  }

  return {
    success: true,
    valid: issues.length === 0,
    issues: issues.length > 0 ? issues : undefined,
    warnings: warnings.length > 0 ? warnings : undefined
  }
}

export default async function validateTool(
  input: ValidateToolInput,
  ctx: ToolContext
): Promise<ValidateToolOutput> {
  try {
    return { success: true, ...(await validateToolImpl(input, ctx)) }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
