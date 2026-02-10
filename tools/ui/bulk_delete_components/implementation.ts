/**
 * Bulk Delete Components Tool Implementation
 *
 * Deletes multiple components at once.
 * Useful for clearing slots, removing related components, or cleanup operations.
 * Each component is removed from its slot and optionally cleaned up from context bus.
 */

import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { useLayoutStore } from '@/lib/ui-control/layout-store'
import type { SlotModule, SlotsConfig } from '@/lib/ui-control/layout-store'
import { contextBus } from '@/lib/components/context-bus'

type SlotName = 'primary' | 'secondary' | 'sidebar' | 'top'

interface BulkDeleteComponentsInput {
  componentIds: string[]
  animate?: boolean
  cleanupContext?: boolean
  stopOnError?: boolean
}

interface DeleteResult {
  componentId: string
  success: boolean
  componentType?: string
  slot?: SlotName
  error?: string
}

interface BulkDeleteComponentsSuccess {
  success: true
  bulk_delete: {
    results: DeleteResult[]
    summary: {
      total: number
      successful: number
      failed: number
      notFound: number
    }
    timestamp: string
  }
  space_id: string
}

interface BulkDeleteComponentsFailure {
  success: false
  error: string
  partial_results?: DeleteResult[]
  space_id: string
}

type BulkDeleteComponentsOutput = BulkDeleteComponentsSuccess | BulkDeleteComponentsFailure

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
 * Delete a single component
 */
function deleteComponent(
  moduleId: string,
  cleanupContext: boolean
): DeleteResult {
  try {
    // Get layout state
    const layoutState = useLayoutStore.getState()

    // Find which slot contains the component
    const foundInfo = findModuleSlot(moduleId, layoutState.slots)

    if (!foundInfo) {
      return {
        componentId: moduleId,
        success: false,
        error: 'Component not found in any slot'
      }
    }

    const { slot, module } = foundInfo

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
      } catch (err) {
        console.warn(`[bulk_delete_components] Failed to cleanup context for ${moduleId}:`, err)
        // Don't fail the operation if context cleanup fails
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
        bulkOperation: true
      },
      timestamp: Date.now()
    })

    return {
      componentId: moduleId,
      success: true,
      componentType: module.componentId,
      slot
    }
  } catch (error) {
    return {
      componentId: moduleId,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Bulk Delete Components Tool
 *
 * Deletes multiple components in sequence.
 * Returns detailed results for each deletion and a summary.
 */
export default async function bulkDeleteComponentsTool(
  input: unknown,
  ctx: ToolContext
): Promise<BulkDeleteComponentsOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate componentIds array
    if (!params.componentIds || !Array.isArray(params.componentIds)) {
      throw new Error('componentIds must be an array')
    }

    if (params.componentIds.length === 0) {
      throw new Error('componentIds array cannot be empty')
    }

    // Validate each ID is a string
    params.componentIds.forEach((id: any, index: number) => {
      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error(`componentIds[${index}] must be a non-empty string`)
      }
    })

    const componentIds = params.componentIds as string[]
    const animate = params.animate === true // Default false
    const cleanupContext = params.cleanupContext !== false // Default true
    const stopOnError = params.stopOnError === true // Default false

    console.log('[bulk_delete_components] Starting bulk delete:', {
      componentCount: componentIds.length,
      animate,
      cleanupContext,
      stopOnError,
      spaceId: ctx.currentSpace
    })

    // If animate is enabled, log it
    if (animate) {
      console.log('[bulk_delete_components] Animation enabled for deletions')
      // In a real implementation, we might add delays between deletions
      // for visual effect, but for simplicity we'll process immediately
    }

    // Delete components
    const results: DeleteResult[] = []

    for (const componentId of componentIds) {
      const result = deleteComponent(componentId.trim(), cleanupContext)
      results.push(result)

      // Stop on first error if requested
      if (stopOnError && !result.success) {
        console.log('[bulk_delete_components] Stopping on error:', result.error)
        break
      }
    }

    // Calculate summary
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    const notFound = results.filter(r => !r.success && r.error?.includes('not found')).length

    console.log('[bulk_delete_components] Completed:', {
      total: results.length,
      successful,
      failed,
      notFound,
      timestamp: now()
    })

    return {
      success: true,
      bulk_delete: {
        results,
        summary: {
          total: results.length,
          successful,
          failed,
          notFound
        },
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
