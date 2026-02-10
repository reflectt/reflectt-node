import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

/**
 * update_grid_cells - Office Suite AI Tool
 *
 * Allows AI agents to programmatically update cells in the DataGrid component.
 * Supports Excel-style cell references, batch updates, formulas, and auto-fill
 * operations. This enables AI to manipulate spreadsheet data just like Excel.
 *
 * This tool enables AI to:
 * - Fill in missing data based on context
 * - Apply formulas to calculate values
 * - Update cells with analyzed or generated data
 * - Perform bulk data operations
 * - Auto-fill series and patterns
 *
 * Use Cases:
 * - "Fill column B with the sum of columns C and D"
 * - "Update cell A1 with the total count"
 * - "Auto-fill the dates from A1 to A30"
 * - "Set formula =AVERAGE(B2:B100) in cell B1"
 * - "Update all cells in the 'Status' column to 'Complete'"
 *
 * Component Integration:
 * The tool uses patch_component_state with special grid operation commands to
 * update the AG Grid data. The DataGrid component processes these commands,
 * updates the grid, triggers formula recalculation, and optionally animates changes.
 *
 * @param input - Grid update parameters
 * @param ctx - Tool execution context
 * @returns Success with update details or error
 */
export default async function updateGridCellsTool(
  input: unknown,
  ctx: ToolContext
): Promise<UpdateGridCellsOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required moduleId
    if (!params.moduleId || typeof params.moduleId !== 'string') {
      throw new Error('Missing required parameter: moduleId')
    }

    const moduleId = params.moduleId.trim()
    if (moduleId.length === 0) {
      throw new Error('moduleId cannot be empty')
    }

    // Must have either updates or autoFill
    if (!params.updates && !params.autoFill) {
      throw new Error('Must provide either "updates" or "autoFill" parameter')
    }

    // Parse updates
    const updates = parseUpdates(params.updates)

    // Parse autoFill
    const autoFill = parseAutoFill(params.autoFill)

    // Validate triggerRecalc
    const triggerRecalc = params.triggerRecalc !== false

    // Validate animate
    const animate = params.animate !== false

    // Build grid operation command
    const gridCommand: any = {
      _gridOperation: {
        updates,
        autoFill,
        triggerRecalc,
        animate,
        timestamp: now()
      }
    }

    console.log('[update_grid_cells]', {
      moduleId,
      updateCount: updates.length,
      hasAutoFill: !!autoFill,
      triggerRecalc,
      animate,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      grid_update: {
        moduleId,
        updateCount: updates.length,
        updates,
        autoFill,
        triggerRecalc,
        animate,
        propsPatch: gridCommand,
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

/**
 * Parse and validate cell updates
 */
function parseUpdates(input: any): Array<{
  cell?: string
  row?: number
  column?: string
  value?: any
  formula?: string
}> {
  if (!input) return []

  if (!Array.isArray(input)) {
    throw new Error('updates must be an array')
  }

  return input.map((update, index) => {
    if (typeof update !== 'object' || update === null) {
      throw new Error(`updates[${index}] must be an object`)
    }

    // Must have either cell reference OR row+column
    const hasCell = update.cell && typeof update.cell === 'string'
    const hasRowCol = (update.row !== undefined && update.column !== undefined)

    if (!hasCell && !hasRowCol) {
      throw new Error(`updates[${index}] must have either "cell" or both "row" and "column"`)
    }

    // Validate cell reference format if provided
    if (hasCell) {
      const cellRef = update.cell.toUpperCase()
      if (!/^[A-Z]+[0-9]+$/.test(cellRef)) {
        throw new Error(`updates[${index}].cell "${update.cell}" is invalid. Use Excel notation like A1, B2, AA10`)
      }
      update.cell = cellRef
    }

    // Validate row if provided
    if (update.row !== undefined) {
      if (typeof update.row !== 'number' || update.row < 0) {
        throw new Error(`updates[${index}].row must be a non-negative number`)
      }
    }

    // Validate column if provided
    if (update.column !== undefined && typeof update.column !== 'string') {
      throw new Error(`updates[${index}].column must be a string`)
    }

    // Must have either value or formula
    if (update.value === undefined && !update.formula) {
      throw new Error(`updates[${index}] must have either "value" or "formula"`)
    }

    // Validate formula if provided
    if (update.formula !== undefined) {
      if (typeof update.formula !== 'string') {
        throw new Error(`updates[${index}].formula must be a string`)
      }
      // Formula should start with =
      if (!update.formula.startsWith('=')) {
        update.formula = '=' + update.formula
      }
    }

    return {
      cell: update.cell,
      row: update.row !== undefined ? Math.floor(update.row) : undefined,
      column: update.column,
      value: update.value,
      formula: update.formula
    }
  })
}

/**
 * Parse and validate auto-fill operation
 */
function parseAutoFill(input: any): {
  from: string
  to: string
  pattern: string
  step?: number
} | null {
  if (!input) return null

  if (typeof input !== 'object' || input === null) {
    throw new Error('autoFill must be an object')
  }

  // Validate from
  if (!input.from || typeof input.from !== 'string') {
    throw new Error('autoFill.from is required and must be a string')
  }
  const from = input.from.toUpperCase()
  if (!/^[A-Z]+[0-9]+$/.test(from)) {
    throw new Error(`autoFill.from "${input.from}" is invalid. Use Excel notation like A1`)
  }

  // Validate to
  if (!input.to || typeof input.to !== 'string') {
    throw new Error('autoFill.to is required and must be a string')
  }
  const to = input.to.toUpperCase()
  if (!/^[A-Z]+[0-9]+$/.test(to)) {
    throw new Error(`autoFill.to "${input.to}" is invalid. Use Excel notation like A10`)
  }

  // Validate pattern
  const validPatterns = ['copy', 'series', 'increment']
  const pattern = input.pattern || 'copy'
  if (!validPatterns.includes(pattern)) {
    throw new Error(`autoFill.pattern must be one of: ${validPatterns.join(', ')}`)
  }

  // Validate step for increment pattern
  let step: number | undefined
  if (pattern === 'increment') {
    step = input.step !== undefined ? input.step : 1
    if (typeof step !== 'number') {
      throw new Error('autoFill.step must be a number')
    }
  }

  // Validate range makes sense
  const fromParts = parseCellReference(from)
  const toParts = parseCellReference(to)

  if (fromParts.col !== toParts.col && fromParts.row !== toParts.row) {
    throw new Error('autoFill range must be in same column or same row')
  }

  return {
    from,
    to,
    pattern,
    step
  }
}

/**
 * Parse Excel cell reference (e.g., "A1" -> {col: "A", row: 1})
 */
function parseCellReference(cell: string): { col: string; row: number } {
  const match = cell.match(/^([A-Z]+)([0-9]+)$/)
  if (!match) {
    throw new Error(`Invalid cell reference: ${cell}`)
  }
  return {
    col: match[1],
    row: parseInt(match[2], 10)
  }
}

// Types
interface UpdateGridCellsSuccess {
  success: true
  grid_update: {
    moduleId: string
    updateCount: number
    updates: Array<{
      cell?: string
      row?: number
      column?: string
      value?: any
      formula?: string
    }>
    autoFill?: {
      from: string
      to: string
      pattern: string
      step?: number
    } | null
    triggerRecalc: boolean
    animate: boolean
    propsPatch: Record<string, any>
    timestamp: string
  }
  space_id: string
}

interface UpdateGridCellsFailure {
  success: false
  error: string
  space_id: string
}

type UpdateGridCellsOutput = UpdateGridCellsSuccess | UpdateGridCellsFailure
