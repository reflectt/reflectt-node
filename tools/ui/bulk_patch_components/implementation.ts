/**
 * Bulk Patch Components Tool Implementation
 *
 * Updates multiple components at once with different prop changes.
 * Dramatically reduces the number of tool calls needed for complex operations.
 * Each patch can use different modes (merge, replace, array operations).
 */

import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

type PatchMode = 'merge' | 'replace' | 'array_add' | 'array_remove' | 'array_update'

interface PatchOperation {
  componentId: string
  propsPatch?: Record<string, any>
  mode?: PatchMode
  // Array operation fields
  path?: string
  items?: any[]
  position?: 'start' | 'end'
  itemIds?: string[]
  updates?: Array<{ id: string; changes: Record<string, any> }>
  idField?: string
}

interface BulkPatchComponentsInput {
  patches: PatchOperation[]
  animate?: boolean
  stopOnError?: boolean
}

interface PatchResult {
  componentId: string
  success: boolean
  mode?: PatchMode
  error?: string
  patchedProps?: string[]
}

interface BulkPatchComponentsSuccess {
  success: true
  bulk_patch: {
    results: PatchResult[]
    summary: {
      total: number
      successful: number
      failed: number
    }
    timestamp: string
  }
  space_id: string
}

interface BulkPatchComponentsFailure {
  success: false
  error: string
  partial_results?: PatchResult[]
  space_id: string
}

type BulkPatchComponentsOutput = BulkPatchComponentsSuccess | BulkPatchComponentsFailure

/**
 * Apply a single patch operation
 */
async function applyPatch(
  patch: PatchOperation,
  animate: boolean
): Promise<PatchResult> {
  try {
    const { componentId, mode = 'merge' } = patch

    // Build the patch payload based on mode
    let patchPayload: Record<string, any>

    switch (mode) {
      case 'merge':
      case 'replace':
        if (!patch.propsPatch) {
          throw new Error('propsPatch is required for merge/replace mode')
        }
        patchPayload = patch.propsPatch
        break

      case 'array_add':
        if (!patch.path || !patch.items) {
          throw new Error('path and items are required for array_add mode')
        }
        patchPayload = {
          _arrayOperation: {
            type: 'add',
            path: patch.path,
            items: patch.items,
            position: patch.position || 'end'
          }
        }
        break

      case 'array_remove':
        if (!patch.path || !patch.itemIds) {
          throw new Error('path and itemIds are required for array_remove mode')
        }
        patchPayload = {
          _arrayOperation: {
            type: 'remove',
            path: patch.path,
            itemIds: patch.itemIds,
            idField: patch.idField || 'id'
          }
        }
        break

      case 'array_update':
        if (!patch.path || !patch.updates) {
          throw new Error('path and updates are required for array_update mode')
        }
        patchPayload = {
          _arrayOperation: {
            type: 'update',
            path: patch.path,
            updates: patch.updates,
            idField: patch.idField || 'id'
          }
        }
        break

      default:
        throw new Error(`Invalid mode: ${mode}`)
    }

    // Apply patch via layout store
    useLayoutStore.getState().actions.patchComponentProps(
      componentId,
      patchPayload,
      mode,
      undefined // No animation config for now
    )

    return {
      componentId,
      success: true,
      mode,
      patchedProps: patch.propsPatch ? Object.keys(patch.propsPatch) : undefined
    }
  } catch (error) {
    return {
      componentId: patch.componentId,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Bulk Patch Components Tool
 *
 * Applies multiple patch operations in sequence.
 * Returns detailed results for each patch and a summary.
 */
export default async function bulkPatchComponentsTool(
  input: unknown,
  ctx: ToolContext
): Promise<BulkPatchComponentsOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate patches array
    if (!params.patches || !Array.isArray(params.patches)) {
      throw new Error('patches must be an array')
    }

    if (params.patches.length === 0) {
      throw new Error('patches array cannot be empty')
    }

    // Validate each patch has componentId
    params.patches.forEach((patch: any, index: number) => {
      if (!patch.componentId || typeof patch.componentId !== 'string') {
        throw new Error(`patches[${index}] missing required field: componentId`)
      }
    })

    const patches = params.patches as PatchOperation[]
    const animate = params.animate === true // Default false for performance
    const stopOnError = params.stopOnError === true // Default false

    console.log('[bulk_patch_components] Starting bulk patch:', {
      patchCount: patches.length,
      animate,
      stopOnError,
      spaceId: ctx.currentSpace
    })

    // Apply patches
    const results: PatchResult[] = []

    for (const patch of patches) {
      const result = await applyPatch(patch, animate)
      results.push(result)

      // Stop on first error if requested
      if (stopOnError && !result.success) {
        console.log('[bulk_patch_components] Stopping on error:', result.error)
        break
      }
    }

    // Calculate summary
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    console.log('[bulk_patch_components] Completed:', {
      total: results.length,
      successful,
      failed,
      timestamp: now()
    })

    return {
      success: true,
      bulk_patch: {
        results,
        summary: {
          total: results.length,
          successful,
          failed
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
