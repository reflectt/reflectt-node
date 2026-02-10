/**
 * Delete Component Tool Implementation
 *
 * Deletes/unmounts a component from its slot.
 * Automatically finds the component across all slots and handles cleanup.
 * Publishes lifecycle events and optionally cleans up context bus registration.
 */

import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { useLayoutStore } from '@/lib/ui-control/layout-store'
import type { SlotModule, SlotsConfig } from '@/lib/ui-control/layout-store'
import { contextBus } from '@/lib/components/context-bus'

type SlotName = 'primary' | 'secondary' | 'sidebar' | 'top'

interface DeleteComponentInput {
  componentId: string // This is the module ID, not the component type
  animate?: boolean
  cleanupContext?: boolean
}

interface DeleteComponentSuccess {
  success: true
  component_deleted: {
    moduleId: string
    componentType: string
    slot: SlotName
    remainingModulesInSlot: number
    timestamp: string
  }
  space_id: string
}

interface DeleteComponentFailure {
  success: false
  error: string
  space_id: string
}

type DeleteComponentOutput = DeleteComponentSuccess | DeleteComponentFailure

/**
 * Find which slot contains a module
 */
function findModuleSlot(
  moduleId: string,
  slots: SlotsConfig
): { slot: SlotName; module: SlotModule } | null {
  const slotNames: SlotName[] = ['primary', 'secondary', 'sidebar', 'top']

  for (const slotName of slotNames) {
    const slotConfig = slots[slotName]
    const modules = slotConfig.modules || []
    const module = modules.find(m => m.id === moduleId)

    if (module) {
      return { slot: slotName, module }
    }
  }

  return null
}

/**
 * Delete Component Tool
 *
 * Removes a component from its slot and optionally cleans up context.
 * Returns information about the deleted component and updated slot state.
 */
export default async function deleteComponentTool(
  input: unknown,
  ctx: ToolContext
): Promise<DeleteComponentOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required fields
    if (!params.componentId || typeof params.componentId !== 'string') {
      throw new Error('Missing required parameter: componentId (module ID)')
    }

    const moduleId = params.componentId.trim()
    if (moduleId.length === 0) {
      throw new Error('componentId cannot be empty')
    }

    const animate = params.animate !== false // Default true
    const cleanupContext = params.cleanupContext !== false // Default true

    // Get layout state
    const layoutState = useLayoutStore.getState()

    // Find which slot contains the component
    const foundInfo = findModuleSlot(moduleId, layoutState.slots)

    if (!foundInfo) {
      // Provide helpful error with list of available modules
      const allModules: string[] = []
      const slotNames: SlotName[] = ['primary', 'secondary', 'sidebar', 'top']

      slotNames.forEach(slotName => {
        const modules = layoutState.slots[slotName].modules || []
        modules.forEach(m => allModules.push(`${m.id} (${m.componentId} in ${slotName})`))
      })

      const availableModulesMessage = allModules.length > 0
        ? `Available modules: ${allModules.slice(0, 5).join(', ')}${allModules.length > 5 ? ` and ${allModules.length - 5} more` : ''}`
        : 'No modules currently mounted'

      throw new Error(
        `Component '${moduleId}' not found in any slot. ${availableModulesMessage}`
      )
    }

    const { slot, module } = foundInfo

    // If animation requested, we'd typically set a flag here
    // For now, we'll just log it - actual animation would be handled by UI components
    if (animate) {
      console.log(`[delete_component] Animating exit for ${moduleId}`)
      // In a real implementation, we might:
      // 1. Set a "deleting" flag on the module
      // 2. Wait for animation duration
      // 3. Then remove the module
      // For simplicity, we'll proceed immediately
    }

    // Remove from slot
    const currentModules = layoutState.slots[slot].modules || []
    const newModules = currentModules.filter(m => m.id !== moduleId)

    // Update layout store
    useLayoutStore.getState().actions.setSlots({
      [slot]: {
        modules: newModules,
        visible: newModules.length > 0 ? layoutState.slots[slot].visible : false
      }
    })

    // Cleanup context bus if requested
    if (cleanupContext) {
      try {
        contextBus.unregister(moduleId)
        console.log(`[delete_component] Cleaned up context for ${moduleId}`)
      } catch (err) {
        console.warn(`[delete_component] Failed to cleanup context for ${moduleId}:`, err)
        // Don't fail the entire operation if context cleanup fails
      }
    }

    // Publish component_deleted event
    contextBus.publish({
      type: 'custom',
      source: moduleId,
      payload: {
        action: 'component_deleted',
        componentType: module.componentId,
        slot,
        remainingModules: newModules.length
      },
      timestamp: Date.now()
    })

    console.log('[delete_component]', {
      moduleId,
      componentType: module.componentId,
      slot,
      remainingModulesInSlot: newModules.length,
      animate,
      cleanupContext,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      component_deleted: {
        moduleId,
        componentType: module.componentId,
        slot,
        remainingModulesInSlot: newModules.length,
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
