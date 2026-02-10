import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

interface InspectComponentStateInput {
  componentId?: string
  componentType?: string
  includeProps?: boolean
  includeSelection?: boolean
  includeFilters?: boolean
  includeData?: boolean
}

interface ComponentInfo {
  id: string
  type: string
  slot: string
  props?: any
  context?: {
    selection?: any
    filters?: any
    data?: any
  }
}

interface InspectComponentStateSuccess {
  success: true
  components: ComponentInfo[]
  totalComponents: number
  query: {
    componentId?: string
    componentType?: string
    filters: string[]
  }
}

interface InspectComponentStateFailure {
  success: false
  error: string
}

type InspectComponentStateOutput = InspectComponentStateSuccess | InspectComponentStateFailure

export default async function inspectComponentState(
  input: InspectComponentStateInput,
  ctx: ToolContext
): Promise<InspectComponentStateOutput> {
  try {
    const {
      componentId,
      componentType,
      includeProps = true,
      includeSelection = true,
      includeFilters = true,
      includeData = false
    } = input

    // Get all components from context bus
    const allContexts = contextBus.query(() => true)

    // Get all mounted modules from layout store
    const layoutState = useLayoutStore.getState()
    const allModules: Array<{ id: string; slot: string; componentId: string; props?: any }> = []

    // Collect all modules from all slots
    for (const [slotName, slotConfig] of Object.entries(layoutState.slots)) {
      const modules = slotConfig.modules || []
      modules.forEach((module: any) => {
        allModules.push({
          id: module.id,
          slot: slotName,
          componentId: module.componentId,
          props: module.props
        })
      })
    }

    // Filter components based on query
    let components = allContexts
      .filter(ctx => {
        if (componentId && ctx.id !== componentId) return false
        if (componentType && ctx.type !== componentType) return false
        return true
      })
      .map(ctx => {
        const module = allModules.find(m => m.id === ctx.id)

        const component: ComponentInfo = {
          id: ctx.id,
          type: ctx.type,
          slot: module?.slot || 'unknown'
        }

        // Add props if requested and available
        if (includeProps && module?.props) {
          component.props = module.props
        }

        // Add context information
        const context: any = {}
        if (includeSelection && ctx.selection) {
          context.selection = ctx.selection
        }
        if (includeFilters && ctx.filters) {
          context.filters = ctx.filters
        }
        if (includeData && ctx.data) {
          context.data = ctx.data
        }

        if (Object.keys(context).length > 0) {
          component.context = context
        }

        return component
      })

    // Build filter list for response
    const filters: string[] = []
    if (includeProps) filters.push('props')
    if (includeSelection) filters.push('selection')
    if (includeFilters) filters.push('filters')
    if (includeData) filters.push('data')

    return {
      success: true,
      components,
      totalComponents: allContexts.length,
      query: {
        componentId,
        componentType,
        filters
      }
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
