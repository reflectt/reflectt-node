import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { dataBindingManager } from '@/lib/components/data-binding'
import { BindingTemplates } from '@/lib/components/data-binding-templates'
import type { DataBindingInput } from '@/lib/components/data-binding'

interface CreateDataBindingParams {
  template:
    | 'table-to-chart'
    | 'filter-to-multiple'
    | 'master-detail'
    | 'search-to-highlight'
    | 'aggregation-to-summary'
    | 'selection-sync'
    | 'cascade-filter'
    | 'transform-pipeline'
    | 'custom'
  sourceComponentId?: string
  targetComponentId: string
  targetComponentIds?: string[]
  sourceDataPath?: string
  targetPropPath?: string
  options?: {
    xField?: string
    yField?: string
    seriesField?: string
    idField?: string
    loadFullRecord?: boolean
    searchField?: string
    matchFields?: string[]
    aggregationType?: 'sum' | 'avg' | 'count' | 'min' | 'max'
    aggregationField?: string
    bidirectional?: boolean
    filterKeys?: string[]
    debounce?: number
  }
  transformation?: string
  enabled?: boolean
  bidirectional?: boolean
  triggerEvents?: string[]
}

interface CreateDataBindingResult {
  success: boolean
  bindingIds: string[]
  bindings: Array<{
    id: string
    sourceComponentId: string
    targetComponentId: string
    enabled: boolean
    template: string
  }>
  message: string
  error?: string
}

/**
 * Create data binding between components
 */
export async function create_data_binding(
  params: CreateDataBindingParams,
  ctx: ToolContext
): Promise<CreateDataBindingResult> {
  const startTime = Date.now()

  try {
    const {
      template,
      sourceComponentId,
      targetComponentId,
      targetComponentIds,
      sourceDataPath,
      targetPropPath,
      options = {},
      transformation,
      enabled = true,
      bidirectional = false,
      triggerEvents
    } = params

    // Validate parameters based on template
    if (template === 'custom') {
      if (!sourceComponentId) {
        return {
          success: false,
          bindingIds: [],
          bindings: [],
          message: 'Custom bindings require sourceComponentId',
          error: 'Missing sourceComponentId parameter'
        }
      }
      if (!sourceDataPath) {
        return {
          success: false,
          bindingIds: [],
          bindings: [],
          message: 'Custom bindings require sourceDataPath',
          error: 'Missing sourceDataPath parameter'
        }
      }
      if (!targetPropPath) {
        return {
          success: false,
          bindingIds: [],
          bindings: [],
          message: 'Custom bindings require targetPropPath',
          error: 'Missing targetPropPath parameter'
        }
      }
    }

    if (template === 'filter-to-multiple' && !targetComponentIds) {
      return {
        success: false,
        bindingIds: [],
        bindings: [],
        message: 'filter-to-multiple template requires targetComponentIds array',
        error: 'Missing targetComponentIds parameter'
      }
    }

    // Create bindings based on template
    let bindingInputs: DataBindingInput[] = []

    switch (template) {
      case 'table-to-chart':
        if (!sourceComponentId) {
          return {
            success: false,
            bindingIds: [],
            bindings: [],
            message: 'table-to-chart requires sourceComponentId',
            error: 'Missing sourceComponentId'
          }
        }
        bindingInputs = [
          BindingTemplates.tableToChart(sourceComponentId, targetComponentId, {
            xField: options.xField,
            yField: options.yField,
            seriesField: options.seriesField
          })
        ]
        break

      case 'filter-to-multiple':
        if (!sourceComponentId) {
          return {
            success: false,
            bindingIds: [],
            bindings: [],
            message: 'filter-to-multiple requires sourceComponentId',
            error: 'Missing sourceComponentId'
          }
        }
        bindingInputs = BindingTemplates.filterToMultiple(
          sourceComponentId,
          targetComponentIds || [targetComponentId],
          {
            filterKeys: options.filterKeys,
            debounce: options.debounce
          }
        )
        break

      case 'master-detail':
        if (!sourceComponentId) {
          return {
            success: false,
            bindingIds: [],
            bindings: [],
            message: 'master-detail requires sourceComponentId',
            error: 'Missing sourceComponentId'
          }
        }
        bindingInputs = [
          BindingTemplates.masterDetail(sourceComponentId, targetComponentId, {
            idField: options.idField,
            loadFullRecord: options.loadFullRecord
          })
        ]
        break

      case 'search-to-highlight':
        if (!sourceComponentId) {
          return {
            success: false,
            bindingIds: [],
            bindings: [],
            message: 'search-to-highlight requires sourceComponentId',
            error: 'Missing sourceComponentId'
          }
        }
        bindingInputs = [
          BindingTemplates.searchToHighlight(sourceComponentId, targetComponentId, {
            searchField: options.searchField,
            matchFields: options.matchFields
          })
        ]
        break

      case 'aggregation-to-summary':
        if (!sourceComponentId) {
          return {
            success: false,
            bindingIds: [],
            bindings: [],
            message: 'aggregation-to-summary requires sourceComponentId',
            error: 'Missing sourceComponentId'
          }
        }
        if (!options.aggregationType) {
          return {
            success: false,
            bindingIds: [],
            bindings: [],
            message: 'aggregation-to-summary requires options.aggregationType',
            error: 'Missing aggregationType'
          }
        }
        bindingInputs = [
          BindingTemplates.aggregationToSummary(sourceComponentId, targetComponentId, {
            type: options.aggregationType,
            field: options.aggregationField
          })
        ]
        break

      case 'selection-sync':
        if (!sourceComponentId) {
          return {
            success: false,
            bindingIds: [],
            bindings: [],
            message: 'selection-sync requires sourceComponentId',
            error: 'Missing sourceComponentId'
          }
        }
        bindingInputs = BindingTemplates.selectionSync(sourceComponentId, targetComponentId, {
          idField: options.idField,
          bidirectional: options.bidirectional ?? bidirectional
        })
        break

      case 'custom':
        // Parse transformation function if provided
        let transformFn: ((value: any, context?: any) => any) | undefined
        if (transformation) {
          try {
            // Create function from string (safe eval in tool context)
            // eslint-disable-next-line no-new-func
            transformFn = new Function('return ' + transformation)() as (
              value: any,
              context?: any
            ) => any
          } catch (error) {
            return {
              success: false,
              bindingIds: [],
              bindings: [],
              message: `Invalid transformation function: ${error}`,
              error: `Failed to parse transformation: ${error}`
            }
          }
        }

        bindingInputs = [
          {
            sourceComponentId: sourceComponentId!,
            sourceDataPath: sourceDataPath!,
            targetComponentId,
            targetPropPath: targetPropPath!,
            transform: transformFn,
            bidirectional,
            triggerEvents,
            enabled,
            metadata: {
              template: 'custom'
            }
          }
        ]
        break

      default:
        return {
          success: false,
          bindingIds: [],
          bindings: [],
          message: `Unknown template: ${template}`,
          error: 'Invalid template type'
        }
    }

    // Set enabled state for all bindings
    bindingInputs = bindingInputs.map(input => ({ ...input, enabled }))

    // Create all bindings
    const bindingIds = bindingInputs.map(input => dataBindingManager.createBinding(input))

    // Get created bindings for response
    const bindings = bindingIds.map(id => {
      const binding = dataBindingManager.getBinding(id)!
      return {
        id: binding.id,
        sourceComponentId: binding.sourceComponentId,
        targetComponentId: binding.targetComponentId,
        enabled: binding.enabled,
        template: binding.metadata?.template || template
      }
    })

    const elapsedMs = Date.now() - startTime

    return {
      success: true,
      bindingIds,
      bindings,
      message: `Created ${bindings.length} data binding(s) using ${template} template (${elapsedMs.toFixed(2)}ms)`
    }
  } catch (error) {
    return {
      success: false,
      bindingIds: [],
      bindings: [],
      message: 'Failed to create data binding',
      error: formatError(error)
    }
  }
}

/**
 * Enable/disable data binding
 */
export async function toggle_data_binding(
  params: { bindingId: string; enabled: boolean },
  ctx: ToolContext
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const { bindingId, enabled } = params

    const success = enabled
      ? dataBindingManager.enableBinding(bindingId)
      : dataBindingManager.disableBinding(bindingId)

    if (!success) {
      return {
        success: false,
        message: `Binding ${bindingId} not found`,
        error: 'Binding does not exist'
      }
    }

    return {
      success: true,
      message: `Binding ${bindingId} ${enabled ? 'enabled' : 'disabled'}`
    }
  } catch (error) {
    return {
      success: false,
      message: 'Failed to toggle binding',
      error: formatError(error)
    }
  }
}

/**
 * Remove data binding
 */
export async function remove_data_binding(
  params: { bindingId: string },
  ctx: ToolContext
): Promise<{ success: boolean; message: string; error?: string }> {
  try {
    const { bindingId } = params

    const success = dataBindingManager.removeBinding(bindingId)

    if (!success) {
      return {
        success: false,
        message: `Binding ${bindingId} not found`,
        error: 'Binding does not exist'
      }
    }

    return {
      success: true,
      message: `Binding ${bindingId} removed`
    }
  } catch (error) {
    return {
      success: false,
      message: 'Failed to remove binding',
      error: formatError(error)
    }
  }
}

/**
 * List all data bindings
 */
export async function list_data_bindings(
  params: { componentId?: string },
  ctx: ToolContext
): Promise<{
  success: boolean
  bindings: Array<{
    id: string
    sourceComponentId: string
    sourceDataPath: string
    targetComponentId: string
    targetPropPath: string
    enabled: boolean
    bidirectional: boolean
    template?: string
  }>
  message: string
}> {
  try {
    const { componentId } = params

    const bindings = componentId
      ? dataBindingManager.getBindingsForComponent(componentId)
      : dataBindingManager.getBindings()

    return {
      success: true,
      bindings: bindings.map(b => ({
        id: b.id,
        sourceComponentId: b.sourceComponentId,
        sourceDataPath: b.sourceDataPath,
        targetComponentId: b.targetComponentId,
        targetPropPath: b.targetPropPath,
        enabled: b.enabled,
        bidirectional: b.bidirectional || false,
        template: b.metadata?.template
      })),
      message: `Found ${bindings.length} binding(s)${componentId ? ` for component ${componentId}` : ''}`
    }
  } catch (error) {
    return {
      success: true,
      bindings: [],
      message: 'Failed to list bindings'
    }
  }
}
