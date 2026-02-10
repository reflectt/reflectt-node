import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import type { RenderManifestPayload } from '@/lib/portals/experience-types'
import { layoutActions } from '@/lib/ui-control/layout-store-v2'
import type { SemanticSlot } from '@/lib/ui-control/layout-types'

// V2.0.0 Component Input Format
interface ComponentInput {
  componentId: string
  slot: string
  props?: Record<string, any>
  lifecycle?: 'persistent' | 'ephemeral' | 'ambient'
  size?: 'compact' | 'comfortable' | 'spacious' | 'fill'
  priority?: number
  ttl?: number
  label?: string
}

interface RenderManifestToolSuccess {
  success: true
  render_manifest: RenderManifestPayload
  space_id: string
  mounted_components?: string[]
}

interface RenderManifestToolFailure {
  success: false
  error: string
  space_id: string
  errorDetails?: {
    type: 'schema_validation' | 'runtime_error' | 'component_not_found' | 'data_missing' | 'unknown'
    componentId?: string
    suggestion?: string
    debugInfo?: {
      providedProps?: string[]
      validationErrors?: string[]
    }
  }
}

type RenderManifestToolOutput = RenderManifestToolSuccess | RenderManifestToolFailure

function safeJsonParse(candidate: unknown): unknown {
  if (typeof candidate !== 'string') {
    return null
  }

  const trimmed = candidate.trim()
  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function normalizeRenderManifestInput(rawInput: unknown): unknown {
  if (typeof rawInput === 'string') {
    const parsed = safeJsonParse(rawInput)
    if (parsed && typeof parsed === 'object') {
      return normalizeRenderManifestInput(parsed)
    }
    return rawInput
  }

  if (!rawInput || typeof rawInput !== 'object') {
    return rawInput
  }

  const candidate = { ...(rawInput as Record<string, unknown>) }

  // Normalize render_manifest field (accept various formats)
  if (!candidate.render_manifest && candidate.renderManifest) {
    candidate.render_manifest = candidate.renderManifest
    delete candidate.renderManifest
  }

  if (!candidate.render_manifest && candidate.payload !== undefined) {
    candidate.render_manifest = candidate.payload
    delete candidate.payload
  }

  const manifestValue = candidate.render_manifest

  if (typeof manifestValue === 'string') {
    const parsed = safeJsonParse(manifestValue)
    if (parsed) {
      candidate.render_manifest = parsed
    }
  } else if (Array.isArray(manifestValue) && manifestValue.length > 0) {
    candidate.render_manifest = manifestValue[0]
  }

  // Normalize meta field (accept render_manifest_meta as alias)
  if (!candidate.meta && candidate.render_manifest_meta) {
    candidate.meta = candidate.render_manifest_meta
    delete candidate.render_manifest_meta
  }

  if (typeof candidate.meta === 'string') {
    const parsedMeta = safeJsonParse(candidate.meta)
    if (parsedMeta && typeof parsedMeta === 'object') {
      candidate.meta = parsedMeta
    }
  }

  return candidate
}

function dedupeCapabilities(capabilities: string[] | undefined): string[] | undefined {
  if (!Array.isArray(capabilities)) {
    return undefined
  }
  const unique = Array.from(new Set(capabilities.map((entry) => entry.trim()).filter((entry) => entry.length > 0)))
  return unique.length > 0 ? unique : undefined
}


/**
 * Classify error type for better debugging
 */
function classifyError(error: Error): 'schema_validation' | 'runtime_error' | 'component_not_found' | 'data_missing' | 'unknown' {
  const msg = error.message.toLowerCase()

  if (msg.includes('schema') || msg.includes('validation') || msg.includes('invalid')) {
    return 'schema_validation'
  }
  if (msg.includes('not found') || msg.includes('unknown component')) {
    return 'component_not_found'
  }
  if (msg.includes('required') || msg.includes('missing')) {
    return 'data_missing'
  }
  if (msg.includes('runtime') || msg.includes('execution')) {
    return 'runtime_error'
  }

  return 'unknown'
}

/**
 * Generate helpful suggestion based on error
 */
function generateSuggestion(error: Error): string {
  const msg = error.message.toLowerCase()

  if (msg.includes('rows') && msg.includes('required')) {
    return 'Provide rows array with data, or use an empty array []'
  }
  if (msg.includes('component') && msg.includes('not found')) {
    return 'Check component ID spelling, use inspect_component_state to see available components'
  }
  if (msg.includes('invalid prop') || msg.includes('schema')) {
    return 'Check component schema with get_component_capabilities or review component documentation'
  }
  if (msg.includes('data') && msg.includes('required')) {
    return 'This component requires data. Use query_table or other data tools to fetch data first'
  }

  return 'Check error message and component documentation for details'
}

/**
 * Extract validation errors from error message
 */
function extractValidationErrors(error: Error): string[] {
  const errors: string[] = []
  const msg = error.message

  // Try to extract Zod validation errors if present
  if (msg.includes('Expected') || msg.includes('Required')) {
    const lines = msg.split('\n')
    lines.forEach(line => {
      if (line.trim().startsWith('Expected') || line.trim().startsWith('Required')) {
        errors.push(line.trim())
      }
    })
  }

  if (errors.length === 0) {
    errors.push(msg)
  }

  return errors
}

export default async function renderManifestTool(
  rawInput: unknown,
  ctx: ToolContext
): Promise<RenderManifestToolOutput> {
  try {
    const actions = layoutActions()
    const mountedIds: string[] = []

    // Parse input (handle JSON strings)
    const normalizedInput = normalizeRenderManifestInput(rawInput)

    // V2.0.0 format - components array with semantic slots
    const componentsArray = (normalizedInput as any)?.components as ComponentInput[] | undefined

    if (!componentsArray || !Array.isArray(componentsArray) || componentsArray.length === 0) {
      throw new Error('render_manifest requires a "components" array with at least one component')
    }

    // Mount each component
    for (const component of componentsArray) {
      const id = actions.mountComponent({
        componentId: component.componentId,
        slot: component.slot as SemanticSlot,
        props: component.props,
        lifecycle: component.lifecycle || 'ephemeral',
        size: component.size || 'comfortable',
        priority: component.priority || 500,
        ttl: component.ttl,
        label: component.label,
        scrollable: true
      })

      mountedIds.push(id)
    }

    // Return success with v2.0.0 format
    return {
      success: true,
      render_manifest: {
        type: 'render_manifest',
        timestamp: now(),
        components: componentsArray.map((c, i) => ({
          id: mountedIds[i],
          componentId: c.componentId,
          slot: c.slot as SemanticSlot,
          props: c.props || {},
          lifecycle: c.lifecycle || 'ephemeral',
          size: c.size || 'comfortable',
          priority: c.priority || 500,
          label: c.label
        }))
      },
      mounted_components: mountedIds,
      space_id: ctx.currentSpace
    }
  } catch (error) {
    const errorObj = error as Error
    const errorType = classifyError(errorObj)
    const suggestion = generateSuggestion(errorObj)
    const validationErrors = extractValidationErrors(errorObj)

    // Try to extract component ID from input
    let componentId: string | undefined
    try {
      const input = normalizeRenderManifestInput(rawInput) as any
      componentId = input?.components?.[0]?.componentId
    } catch {
      // Ignore extraction errors
    }

    // Try to extract provided props
    let providedProps: string[] | undefined
    try {
      const input = normalizeRenderManifestInput(rawInput) as any
      const props = input?.components?.[0]?.props
      if (props && typeof props === 'object') {
        providedProps = Object.keys(props)
      }
    } catch {
      // Ignore extraction errors
    }

    return {
      success: false,
      error: formatError(error),
      space_id: ctx.currentSpace,
      errorDetails: {
        type: errorType,
        componentId,
        suggestion,
        debugInfo: {
          providedProps,
          validationErrors
        }
      }
    }
  }
}
