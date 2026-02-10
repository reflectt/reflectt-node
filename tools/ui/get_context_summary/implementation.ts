/**
 * Get Context Summary Tool Implementation
 *
 * Returns a summary of all component contexts showing data, selections, and filters.
 * Useful for debugging data flow and understanding component state.
 */

import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus, type ComponentContext } from '@/lib/components/context-bus'

interface GetContextSummaryInput {
  includeData?: boolean
  componentType?: string
}

interface ContextSummaryItem {
  componentId: string
  componentType: string
  hasData: boolean
  dataType: 'array' | 'object' | 'primitive' | 'null'
  dataSize: number
  hasSelection: boolean
  selectionType?: 'array' | 'object' | 'primitive'
  selectionSize?: number
  hasFilters: boolean
  filterCount?: number
  hasMetadata: boolean
  data?: any
  selection?: any
  filters?: Record<string, any>
  metadata?: Record<string, any>
}

interface GetContextSummarySuccess {
  success: true
  totalComponents: number
  componentsWithData: number
  componentsWithSelection: number
  componentsWithFilters: number
  contexts: ContextSummaryItem[]
  eventStats?: {
    totalEvents: number
    recentEvents: number
  }
}

interface GetContextSummaryFailure {
  success: false
  error: string
}

type GetContextSummaryOutput =
  | GetContextSummarySuccess
  | GetContextSummaryFailure

/**
 * Get data type and size
 */
function getDataInfo(data: any): {
  type: 'array' | 'object' | 'primitive' | 'null'
  size: number
} {
  if (data === null || data === undefined) {
    return { type: 'null', size: 0 }
  }

  if (Array.isArray(data)) {
    return { type: 'array', size: data.length }
  }

  if (typeof data === 'object') {
    return { type: 'object', size: Object.keys(data).length }
  }

  return { type: 'primitive', size: 1 }
}

/**
 * Get selection info
 */
function getSelectionInfo(
  selection: any
): {
  hasSelection: boolean
  type?: 'array' | 'object' | 'primitive'
  size?: number
} {
  if (!selection) {
    return { hasSelection: false }
  }

  if (Array.isArray(selection)) {
    return {
      hasSelection: selection.length > 0,
      type: 'array',
      size: selection.length
    }
  }

  if (typeof selection === 'object') {
    const keys = Object.keys(selection)
    return {
      hasSelection: keys.length > 0,
      type: 'object',
      size: keys.length
    }
  }

  return {
    hasSelection: true,
    type: 'primitive',
    size: 1
  }
}

/**
 * Build context summary for a component
 */
function buildContextSummary(
  ctx: ComponentContext,
  includeData: boolean
): ContextSummaryItem {
  const dataInfo = getDataInfo(ctx.data)
  const selectionInfo = getSelectionInfo(ctx.selection)
  const hasFilters = !!(ctx.filters && Object.keys(ctx.filters).length > 0)
  const hasMetadata = !!(ctx.metadata && Object.keys(ctx.metadata).length > 0)

  const summary: ContextSummaryItem = {
    componentId: ctx.id,
    componentType: ctx.type,
    hasData: dataInfo.type !== 'null' && dataInfo.size > 0,
    dataType: dataInfo.type,
    dataSize: dataInfo.size,
    hasSelection: selectionInfo.hasSelection,
    selectionType: selectionInfo.type,
    selectionSize: selectionInfo.size,
    hasFilters,
    filterCount: hasFilters ? Object.keys(ctx.filters!).length : 0,
    hasMetadata
  }

  // Include full data if requested
  if (includeData) {
    summary.data = ctx.data
    summary.selection = ctx.selection
    summary.filters = ctx.filters
    summary.metadata = ctx.metadata
  }

  return summary
}

/**
 * Get event statistics from context bus
 */
function getEventStats(): {
  totalEvents: number
  recentEvents: number
} {
  const history = contextBus.getEventHistory()
  const now = Date.now()
  const oneMinuteAgo = now - 60000

  const recentEvents = history.filter((e) => e.timestamp > oneMinuteAgo).length

  return {
    totalEvents: history.length,
    recentEvents
  }
}

export default async function getContextSummary(
  input: GetContextSummaryInput,
  ctx: ToolContext
): Promise<GetContextSummaryOutput> {
  try {
    const { includeData = false, componentType } = input

    // Query all contexts or filter by type
    const contexts = componentType
      ? contextBus.query((c) => c.type === componentType)
      : contextBus.query(() => true)

    // Build summaries
    const summaries = contexts.map((c) => buildContextSummary(c, includeData))

    // Calculate statistics
    const componentsWithData = summaries.filter((s) => s.hasData).length
    const componentsWithSelection = summaries.filter(
      (s) => s.hasSelection
    ).length
    const componentsWithFilters = summaries.filter((s) => s.hasFilters).length

    // Get event statistics
    const eventStats = getEventStats()

    return {
      success: true,
      totalComponents: contexts.length,
      componentsWithData,
      componentsWithSelection,
      componentsWithFilters,
      contexts: summaries,
      eventStats
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
