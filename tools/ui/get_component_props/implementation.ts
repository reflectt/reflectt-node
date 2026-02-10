import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { COMPONENT_INDEX, type ComponentIndexEntry } from '@/lib/components/component-index'
import { getComponentExamples, type ComponentExample } from '@/lib/components/component-examples'
import { z } from 'zod'

interface GetComponentPropsInput {
  componentId: string
  includeExamples?: boolean
}

interface PropInfo {
  type: string
  required: boolean
  default?: any
  description?: string
  examples?: any[]
  enum?: string[]
}

interface GetComponentPropsSuccess {
  success: true
  componentId: string
  componentName: string
  componentDescription: string
  category: string
  tags: string[]
  props: Record<string, PropInfo>
  requiredProps: string[]
  optionalProps: string[]
  examples?: Array<{
    description: string
    useCase: string
    props: Record<string, any>
  }>
  capabilities?: Record<string, boolean>
  whenToUse?: string
  alternatives?: string[]
}

interface GetComponentPropsFailure {
  success: false
  error: string
  suggestion?: string
  similarComponents?: string[]
  availableComponents?: string[]
}

type GetComponentPropsOutput = GetComponentPropsSuccess | GetComponentPropsFailure

/**
 * Find similar component IDs using tag matching
 */
function findSimilarComponents(componentId: string, limit: number = 5): string[] {
  const query = componentId.toLowerCase()
  const allComponents = Object.keys(COMPONENT_INDEX)

  // Score components based on similarity
  const scored = allComponents.map(id => {
    let score = 0
    const entry = COMPONENT_INDEX[id]

    // Check if ID contains query
    if (id.toLowerCase().includes(query)) score += 10

    // Check tags
    entry.tags?.forEach(tag => {
      if (tag.toLowerCase().includes(query)) score += 5
    })

    // Check name
    if (entry.name.toLowerCase().includes(query)) score += 3

    // Check description
    if (entry.description.toLowerCase().includes(query)) score += 1

    return { id, score }
  })

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.id)
}

/**
 * Extract prop information from Zod schema
 */
function extractPropsFromSchema(schema: z.ZodObject<any> | null): Record<string, PropInfo> {
  if (!schema) return {}

  const props: Record<string, PropInfo> = {}
  const shape = schema.shape

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as any
    const propInfo: PropInfo = {
      type: 'unknown',
      required: true
    }

    // Unwrap optional types
    let innerType = zodType
    if (zodType instanceof z.ZodOptional) {
      propInfo.required = false
      innerType = (zodType as any)._def.innerType
    }

    if (zodType instanceof z.ZodDefault) {
      propInfo.required = false
      const defaultValue = (zodType as any)._def.defaultValue
      propInfo.default = typeof defaultValue === 'function' ? defaultValue() : defaultValue
      innerType = (zodType as any)._def.innerType
    }

    // Determine type
    if (innerType instanceof z.ZodString) {
      propInfo.type = 'string'
    } else if (innerType instanceof z.ZodNumber) {
      propInfo.type = 'number'
    } else if (innerType instanceof z.ZodBoolean) {
      propInfo.type = 'boolean'
    } else if (innerType instanceof z.ZodArray) {
      propInfo.type = 'array'
    } else if (innerType instanceof z.ZodObject) {
      propInfo.type = 'object'
    } else if (innerType instanceof z.ZodFunction) {
      propInfo.type = 'function'
    } else if (innerType instanceof z.ZodEnum) {
      propInfo.type = 'enum'
      // ZodEnum has .options property with the array of values
      propInfo.enum = (innerType as any).options || []
    } else if (innerType instanceof z.ZodRecord) {
      propInfo.type = 'record'
    }

    // Extract description if available
    const def = (zodType as any)._def
    if (def && def.description) {
      propInfo.description = def.description
    }

    props[key] = propInfo
  }

  return props
}

/**
 * Load component schema dynamically
 * Note: This function cannot use dynamic imports in Next.js production builds.
 * Schema loading has been disabled - schemas must be pre-loaded or accessed directly.
 */
async function loadComponentSchema(componentId: string, entry: ComponentIndexEntry): Promise<z.ZodObject<any> | null> {
  if (!entry.hasSchema || !entry.schemaPath) {
    return null
  }

  // Note: Dynamic imports are not supported in Next.js
  // This would need to be refactored to use a schema registry with static imports
  console.warn(`[get_component_props] Cannot dynamically load schema for ${componentId}. Schema path: ${entry.schemaPath}`)
  return null
}

export default async function getComponentProps(
  input: GetComponentPropsInput,
  ctx: ToolContext
): Promise<GetComponentPropsOutput> {
  try {
    const { componentId, includeExamples = true } = input

    // Check if component exists
    const entry = COMPONENT_INDEX[componentId]
    if (!entry) {
      const similar = findSimilarComponents(componentId)
      const allComponents = Object.keys(COMPONENT_INDEX).slice(0, 10)

      return {
        success: false,
        error: `Component '${componentId}' not found`,
        suggestion: similar.length > 0
          ? `Did you mean one of these? ${similar.slice(0, 3).join(', ')}`
          : 'Use inspect_component_state to see currently rendered components, or check the component registry.',
        similarComponents: similar,
        availableComponents: allComponents
      }
    }

    // Load schema and extract props
    const schema = await loadComponentSchema(componentId, entry)
    const props = extractPropsFromSchema(schema)

    // Separate required and optional props
    const requiredProps: string[] = []
    const optionalProps: string[] = []

    for (const [key, info] of Object.entries(props)) {
      if (info.required) {
        requiredProps.push(key)
      } else {
        optionalProps.push(key)
      }
    }

    // Build base response
    const response: GetComponentPropsSuccess = {
      success: true,
      componentId,
      componentName: entry.name,
      componentDescription: entry.description,
      category: entry.category || 'unknown',
      tags: entry.tags || [],
      props,
      requiredProps,
      optionalProps,
      capabilities: entry.capabilities as Record<string, boolean> | undefined,
      whenToUse: entry.whenToUse,
      alternatives: entry.alternatives
    }

    // Add examples if requested
    if (includeExamples) {
      const componentExamples = getComponentExamples(componentId)
      if (componentExamples.length > 0) {
        response.examples = componentExamples.map(ex => ({
          description: ex.description,
          useCase: ex.useCase,
          props: ex.manifest.interactiveModules[0]?.props || {}
        }))
      }
    }

    return response
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      suggestion: 'Check the component ID spelling and try again. Use inspect_component_state to see available components.'
    }
  }
}
