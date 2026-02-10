import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { useLayoutStore } from '@/lib/ui-control/layout-store'
import { contextBus } from '@/lib/components/context-bus'

interface GetRenderFeedbackInput {
  componentId?: string
  includeMetrics?: boolean
}

interface PropsValidation {
  valid: boolean
  warnings?: string[]
  missing?: string[]
}

interface DataValidation {
  dataPresent: boolean
  rowsCount?: number
  itemsCount?: number
  issues?: string[]
}

interface VisualMetrics {
  rendered: boolean
  estimatedHeight?: number
  estimatedWidth?: number
  visible?: boolean
}

interface RenderDetails {
  mounted: boolean
  slot: string
  propsValidation: PropsValidation
  dataValidation?: DataValidation
  visualMetrics?: VisualMetrics
}

interface GetRenderFeedbackSuccess {
  success: true
  componentId: string
  componentType?: string
  renderDetails: RenderDetails
  suggestions?: string[]
}

interface GetRenderFeedbackFailure {
  success: false
  componentId: string
  renderDetails: RenderDetails
  error?: string
}

type GetRenderFeedbackOutput = GetRenderFeedbackSuccess | GetRenderFeedbackFailure

export default async function getRenderFeedback(
  input: GetRenderFeedbackInput,
  ctx: ToolContext
): Promise<GetRenderFeedbackOutput> {
  try {
    const { componentId, includeMetrics = true } = input

    // Get layout state
    const layoutState = useLayoutStore.getState()

    // Find the component
    let component: any
    let slot: string = 'unknown'

    if (componentId) {
      // Find specific component
      for (const [slotName, slotConfig] of Object.entries(layoutState.slots)) {
        const modules = slotConfig.modules || []
        const found = modules.find((m: any) => m.id === componentId)
        if (found) {
          component = found
          slot = slotName
          break
        }
      }
    } else {
      // Get last mounted component (most recently added)
      const allModules: Array<{ module: any; slot: string }> = []

      for (const [slotName, slotConfig] of Object.entries(layoutState.slots)) {
        const modules = slotConfig.modules || []
        modules.forEach((module: any) => {
          allModules.push({ module, slot: slotName })
        })
      }

      if (allModules.length > 0) {
        const last = allModules[allModules.length - 1]
        component = last.module
        slot = last.slot
      }
    }

    // Component not found
    if (!component) {
      return {
        success: false,
        componentId: componentId || 'unknown',
        renderDetails: {
          mounted: false,
          slot: 'none',
          propsValidation: {
            valid: false,
            warnings: ['Component not found in any slot']
          }
        },
        error: componentId
          ? `Component "${componentId}" not found in layout`
          : 'No components are currently mounted'
      }
    }

    // Get component context
    const ctx = contextBus.getContext(component.id)

    // Validate props (simplified - could use actual schema validation)
    const propsValidation: PropsValidation = {
      valid: true,
      warnings: [],
      missing: []
    }

    // Check if props is empty but might be required
    if (!component.props || Object.keys(component.props).length === 0) {
      propsValidation.warnings!.push('Component has no props - this may be intentional')
    }

    // Check data validation if available
    const dataValidation: DataValidation = {
      dataPresent: false
    }

    if (ctx?.data) {
      dataValidation.dataPresent = true

      // Try to count rows/items
      if (Array.isArray(ctx.data)) {
        dataValidation.rowsCount = ctx.data.length
        if (ctx.data.length === 0) {
          dataValidation.issues = ['Data array is empty']
        }
      } else if (typeof ctx.data === 'object') {
        const keys = Object.keys(ctx.data)
        dataValidation.itemsCount = keys.length
        if (keys.length === 0) {
          dataValidation.issues = ['Data object is empty']
        }
      }
    } else {
      dataValidation.issues = ['No data available in component context']
    }

    // Build render details
    const renderDetails: RenderDetails = {
      mounted: true,
      slot,
      propsValidation,
      dataValidation
    }

    // Add visual metrics if requested
    if (includeMetrics) {
      renderDetails.visualMetrics = {
        rendered: true,
        visible: layoutState.slots[slot as keyof typeof layoutState.slots]?.visible ?? false
      }
    }

    // Generate suggestions
    const suggestions: string[] = []

    if (!renderDetails.visualMetrics?.visible) {
      suggestions.push(`Component is mounted in "${slot}" slot, but slot is not visible. Use set_ui_layout to make it visible.`)
    }

    if (dataValidation.issues && dataValidation.issues.length > 0) {
      suggestions.push(`Data issues detected: ${dataValidation.issues.join(', ')}`)
    }

    if (propsValidation.warnings && propsValidation.warnings.length > 0) {
      suggestions.push(`Props warnings: ${propsValidation.warnings.join(', ')}`)
    }

    // Success response
    return {
      success: true,
      componentId: component.id,
      componentType: component.componentId,
      renderDetails,
      suggestions: suggestions.length > 0 ? suggestions : undefined
    }
  } catch (error) {
    return {
      success: false,
      componentId: input.componentId || 'unknown',
      renderDetails: {
        mounted: false,
        slot: 'unknown',
        propsValidation: {
          valid: false,
          warnings: ['Error during validation']
        }
      },
      error: formatError(error)
    }
  }
}
