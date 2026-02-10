/**
 * Create Component Tool Implementation
 *
 * Creates a new component instance and mounts it to a specified slot.
 * Alternative to render_manifest for adding single components.
 * Provides prop validation and flexible positioning.
 */

import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { validateComponentProps } from '@/lib/components/schema-validation'
import { useLayoutStore } from '@/lib/ui-control/layout-store'
import type { SlotModule } from '@/lib/ui-control/layout-store'
import { contextBus } from '@/lib/components/context-bus'

type SlotName = 'primary' | 'secondary' | 'sidebar' | 'top'
type Position = 'start' | 'end' | 'before' | 'after'

interface CreateComponentInput {
  componentId: string
  slot: SlotName
  props: Record<string, any>
  position?: Position
  beforeModuleId?: string
  validate?: boolean
  effects?: Array<{
    type: string
    intensity?: number
    color?: string
    colors?: string[]
    speed?: number
    count?: number
    size?: 'sm' | 'md' | 'lg'
    pulse?: boolean
    interactive?: boolean
    zIndex?: number
  }>
  effectPreset?: 'subtle' | 'cyberpunk' | 'aurora' | 'mystical' | 'energetic' | 'calm' | 'celebration' | 'focus'
  label?: string
}

interface CreateComponentSuccess {
  success: true
  component_created: {
    moduleId: string
    componentId: string
    slot: SlotName
    position: number
    props: Record<string, any>
    timestamp: string
  }
  space_id: string
}

interface CreateComponentFailure {
  success: false
  error: string
  validation_errors?: Array<{
    path: string
    message: string
    severity: string
    fix?: string
  }>
  space_id: string
}

type CreateComponentOutput = CreateComponentSuccess | CreateComponentFailure

/**
 * Generate a unique module ID
 */
function generateModuleId(componentId: string): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 9)
  const componentName = componentId.split(':').pop() || componentId
  return `${componentName}_${timestamp}_${random}`
}

/**
 * Insert module at the specified position in the modules array
 */
function insertModule(
  currentModules: SlotModule[],
  newModule: SlotModule,
  position: Position,
  beforeModuleId?: string
): { modules: SlotModule[]; insertIndex: number } | { error: string } {
  switch (position) {
    case 'start':
      return {
        modules: [newModule, ...currentModules],
        insertIndex: 0
      }

    case 'end':
      return {
        modules: [...currentModules, newModule],
        insertIndex: currentModules.length
      }

    case 'before':
    case 'after': {
      if (!beforeModuleId) {
        return { error: `beforeModuleId is required when position is '${position}'` }
      }

      const refIndex = currentModules.findIndex(m => m.id === beforeModuleId)
      if (refIndex === -1) {
        return { error: `Reference module '${beforeModuleId}' not found in slot` }
      }

      const insertIndex = position === 'before' ? refIndex : refIndex + 1
      const modules = [
        ...currentModules.slice(0, insertIndex),
        newModule,
        ...currentModules.slice(insertIndex)
      ]

      return { modules, insertIndex }
    }

    default:
      return { error: `Invalid position: ${position}` }
  }
}

/**
 * Create Component Tool
 *
 * Creates and mounts a new component instance to a slot.
 * Returns the new module ID and position for tracking.
 */
export default async function createComponentTool(
  input: unknown,
  ctx: ToolContext
): Promise<CreateComponentOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required fields
    if (!params.componentId || typeof params.componentId !== 'string') {
      throw new Error('Missing required parameter: componentId')
    }

    if (!params.slot || typeof params.slot !== 'string') {
      throw new Error('Missing required parameter: slot')
    }

    const validSlots: SlotName[] = ['primary', 'secondary', 'sidebar', 'top']
    if (!validSlots.includes(params.slot as SlotName)) {
      throw new Error(`Invalid slot: "${params.slot}". Must be one of: ${validSlots.join(', ')}`)
    }

    if (!params.props || typeof params.props !== 'object' || Array.isArray(params.props)) {
      throw new Error('props must be a non-array object')
    }

    // Extract validated params
    const componentId = params.componentId.trim()
    const slot = params.slot as SlotName
    const props = params.props as Record<string, any>
    const position = (params.position as Position) || 'end'
    const beforeModuleId = params.beforeModuleId as string | undefined
    const validate = params.validate !== false // Default true
    const effects = params.effects
    const effectPreset = params.effectPreset
    const label = params.label

    // Validate position
    const validPositions: Position[] = ['start', 'end', 'before', 'after']
    if (!validPositions.includes(position)) {
      throw new Error(`Invalid position: "${position}". Must be one of: ${validPositions.join(', ')}`)
    }

    // Validate props if requested
    if (validate) {
      const validation = validateComponentProps(componentId, props)
      if (!validation.valid) {
        const errorDetails = validation.errors.filter(e => e.severity === 'error')

        return {
          success: false,
          error: `Props validation failed for component '${componentId}': ${errorDetails.length} error(s) found`,
          validation_errors: validation.errors.map(e => ({
            path: e.path,
            message: e.message,
            severity: e.severity,
            fix: e.fix
          })),
          space_id: ctx.currentSpace
        }
      }
    }

    // Generate unique module ID
    const moduleId = generateModuleId(componentId)

    // Create module object
    const module: SlotModule = {
      id: moduleId,
      componentId,
      props,
      ...(label && { label }),
      ...(effects && { effects }),
      ...(effectPreset && { effectPreset })
    }

    // Get current slot modules from layout store
    const layoutState = useLayoutStore.getState()
    const currentModules = layoutState.slots[slot].modules || []

    // Insert module at correct position
    const insertResult = insertModule(currentModules, module, position, beforeModuleId)

    if ('error' in insertResult) {
      throw new Error(insertResult.error)
    }

    const { modules: newModules, insertIndex } = insertResult

    // Update layout store
    useLayoutStore.getState().actions.setSlots({
      [slot]: {
        modules: newModules,
        visible: true // Ensure slot is visible when adding component
      }
    })

    // Publish component_created event to context bus
    contextBus.publish({
      type: 'custom',
      source: moduleId,
      payload: {
        action: 'component_created',
        componentType: componentId,
        slot,
        position: insertIndex
      },
      timestamp: Date.now()
    })

    console.log('[create_component]', {
      moduleId,
      componentId,
      slot,
      position: insertIndex,
      totalModulesInSlot: newModules.length,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      component_created: {
        moduleId,
        componentId,
        slot,
        position: insertIndex,
        props,
        timestamp: now()
      },
      space_id: ctx.currentSpace
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      space_id: ctx.currentSpace
    }
  }
}
