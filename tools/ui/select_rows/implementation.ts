/**
 * Select Rows Tool Implementation
 *
 * Programmatically selects rows in a table component.
 * Publishes selection changes via the context bus for cross-component communication.
 */

import { contextBus } from '@/lib/components/context-bus'

interface SelectRowsInput {
  componentId: string
  rowIds?: string[]
  selectAll?: boolean
  clearExisting?: boolean
}

interface SelectRowsResult {
  success: boolean
  rowsSelected?: number | 'all'
  error?: string
  selectedIds?: string[]
}

/**
 * Select Rows Tool
 *
 * Selects rows in a table component and publishes selection change event.
 */
export async function select_rows(
  input: SelectRowsInput
): Promise<SelectRowsResult> {
  try {
    // Validate input
    if (!input.selectAll && (!input.rowIds || input.rowIds.length === 0)) {
      return {
        success: false,
        error: 'Either selectAll must be true or rowIds must be provided',
      }
    }

    // Get component context from bus
    const context = contextBus.getContext(input.componentId)

    if (!context) {
      return {
        success: false,
        error: `Table component not found: ${input.componentId}. Make sure the component is rendered and registered with the context bus.`,
      }
    }

    // Find table element in DOM
    const tableEl = document.querySelector(
      `[data-module-id="${input.componentId}"]`
    )

    if (!tableEl) {
      return {
        success: false,
        error: `Table element not found in DOM: ${input.componentId}`,
      }
    }

    // Build selection payload
    const selectionPayload = {
      selectAll: input.selectAll || false,
      rowIds: input.rowIds || [],
      clearExisting: input.clearExisting !== false, // default true
      timestamp: Date.now(),
    }

    // Publish selection change event via context bus
    contextBus.publish({
      type: 'selection_change',
      source: input.componentId,
      payload: selectionPayload,
      timestamp: Date.now(),
    })

    // Try to trigger selection UI changes directly if possible
    if (input.selectAll) {
      // Look for "select all" checkbox
      const selectAllCheckbox = tableEl.querySelector(
        'input[type="checkbox"][data-action="select-all"], thead input[type="checkbox"]'
      ) as HTMLInputElement

      if (selectAllCheckbox && !selectAllCheckbox.checked) {
        selectAllCheckbox.click()
      }
    } else if (input.rowIds) {
      // Try to check individual row checkboxes
      for (const rowId of input.rowIds) {
        const rowCheckbox = tableEl.querySelector(
          `input[type="checkbox"][data-row-id="${rowId}"]`
        ) as HTMLInputElement

        if (rowCheckbox && !rowCheckbox.checked) {
          rowCheckbox.click()
        }
      }
    }

    // Update component context with new selection
    const currentSelection = context.selection || []
    let newSelection: string[]

    if (input.selectAll) {
      // Select all rows - get all row IDs from data
      const allRowIds = context.data?.map((row: any) => row.id || row._id) || []
      newSelection = allRowIds
    } else if (input.clearExisting) {
      newSelection = input.rowIds || []
    } else {
      // Add to existing selection
      const existingIds = new Set(
        Array.isArray(currentSelection) ? currentSelection : []
      )
      input.rowIds?.forEach((id) => existingIds.add(id))
      newSelection = Array.from(existingIds)
    }

    // Update context bus
    contextBus.update(input.componentId, {
      selection: newSelection,
    })

    return {
      success: true,
      rowsSelected: input.selectAll ? 'all' : newSelection.length,
      selectedIds: input.selectAll ? undefined : newSelection,
    }
  } catch (error) {
    return {
      success: false,
      error: `Error selecting rows: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
