/**
 * Bulk Select Rows Tool Implementation
 *
 * Selects rows in multiple table components at once.
 * Useful for syncing selections across tables, selecting related data,
 * or multi-table operations. Each selection can be configured independently.
 */

import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'

interface SelectionOperation {
  componentId: string
  rowIds?: string[]
  selectAll?: boolean
  clearExisting?: boolean
}

interface BulkSelectRowsInput {
  selections: SelectionOperation[]
  stopOnError?: boolean
}

interface SelectionResult {
  componentId: string
  success: boolean
  rowsSelected?: number | 'all'
  selectedIds?: string[]
  error?: string
}

interface BulkSelectRowsSuccess {
  success: true
  bulk_select: {
    results: SelectionResult[]
    summary: {
      total: number
      successful: number
      failed: number
      totalRowsSelected: number
    }
    timestamp: string
  }
  space_id: string
}

interface BulkSelectRowsFailure {
  success: false
  error: string
  partial_results?: SelectionResult[]
  space_id: string
}

type BulkSelectRowsOutput = BulkSelectRowsSuccess | BulkSelectRowsFailure

/**
 * Apply a single selection operation
 */
function applySelection(selection: SelectionOperation): SelectionResult {
  try {
    const { componentId, rowIds, selectAll, clearExisting = true } = selection

    // Validate that either selectAll or rowIds is provided
    if (!selectAll && (!rowIds || rowIds.length === 0)) {
      throw new Error('Either selectAll must be true or rowIds must be provided')
    }

    // Get component context from bus
    const context = contextBus.getContext(componentId)

    if (!context) {
      throw new Error(`Table component not found: ${componentId}. Make sure the component is rendered and registered.`)
    }

    // Build selection payload
    const selectionPayload = {
      selectAll: selectAll || false,
      rowIds: rowIds || [],
      clearExisting,
      timestamp: Date.now()
    }

    // Publish selection_change event via context bus
    contextBus.publish({
      type: 'selection_change',
      source: componentId,
      payload: selectionPayload,
      timestamp: Date.now(),
      metadata: {
        bulkOperation: true
      }
    })

    // Try to trigger selection UI changes directly if possible
    const tableEl = document.querySelector(`[data-module-id="${componentId}"]`)

    if (tableEl) {
      if (selectAll) {
        // Look for "select all" checkbox
        const selectAllCheckbox = tableEl.querySelector(
          'input[type="checkbox"][data-action="select-all"], thead input[type="checkbox"]'
        ) as HTMLInputElement

        if (selectAllCheckbox && !selectAllCheckbox.checked) {
          selectAllCheckbox.click()
        }
      } else if (rowIds) {
        // Try to check individual row checkboxes
        for (const rowId of rowIds) {
          const rowCheckbox = tableEl.querySelector(
            `input[type="checkbox"][data-row-id="${rowId}"]`
          ) as HTMLInputElement

          if (rowCheckbox && !rowCheckbox.checked) {
            rowCheckbox.click()
          }
        }
      }
    }

    // Update component context with new selection
    const currentSelection = context.selection || []
    let newSelection: string[]

    if (selectAll) {
      // Select all rows - get all row IDs from data
      const allRowIds = context.data?.map((row: any) => row.id || row._id) || []
      newSelection = allRowIds
    } else if (clearExisting) {
      newSelection = rowIds || []
    } else {
      // Add to existing selection
      const existingIds = new Set(
        Array.isArray(currentSelection) ? currentSelection : []
      )
      rowIds?.forEach(id => existingIds.add(id))
      newSelection = Array.from(existingIds)
    }

    // Update context bus
    contextBus.update(componentId, {
      selection: newSelection
    })

    return {
      componentId,
      success: true,
      rowsSelected: selectAll ? 'all' : newSelection.length,
      selectedIds: selectAll ? undefined : newSelection
    }
  } catch (error) {
    return {
      componentId: selection.componentId,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Bulk Select Rows Tool
 *
 * Applies multiple selection operations to different table components.
 * Returns detailed results for each selection and a summary.
 */
export default async function bulkSelectRowsTool(
  input: unknown,
  ctx: ToolContext
): Promise<BulkSelectRowsOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate selections array
    if (!params.selections || !Array.isArray(params.selections)) {
      throw new Error('selections must be an array')
    }

    if (params.selections.length === 0) {
      throw new Error('selections array cannot be empty')
    }

    // Validate each selection has componentId
    params.selections.forEach((selection: any, index: number) => {
      if (!selection.componentId || typeof selection.componentId !== 'string') {
        throw new Error(`selections[${index}] missing required field: componentId`)
      }
    })

    const selections = params.selections as SelectionOperation[]
    const stopOnError = params.stopOnError === true // Default false

    console.log('[bulk_select_rows] Starting bulk select:', {
      selectionCount: selections.length,
      stopOnError,
      spaceId: ctx.currentSpace
    })

    // Apply selections
    const results: SelectionResult[] = []

    for (const selection of selections) {
      const result = applySelection(selection)
      results.push(result)

      // Stop on first error if requested
      if (stopOnError && !result.success) {
        console.log('[bulk_select_rows] Stopping on error:', result.error)
        break
      }
    }

    // Calculate summary
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length
    const totalRowsSelected = results
      .filter(r => r.success)
      .reduce((sum, r) => {
        if (r.rowsSelected === 'all') {
          // For 'all', we'll count it as a large number for summary purposes
          // In reality, this would be dynamic based on table data
          return sum + 9999
        }
        return sum + (r.rowsSelected || 0)
      }, 0)

    console.log('[bulk_select_rows] Completed:', {
      total: results.length,
      successful,
      failed,
      totalRowsSelected: totalRowsSelected === 9999 ? 'all' : totalRowsSelected,
      timestamp: now()
    })

    return {
      success: true,
      bulk_select: {
        results,
        summary: {
          total: results.length,
          successful,
          failed,
          totalRowsSelected
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
