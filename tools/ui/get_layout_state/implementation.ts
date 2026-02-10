import { useLayoutStore } from '@/lib/ui-control/layout-store-v2'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

interface GetLayoutStateSuccess {
  success: true
  state: {
    currentIntent: string
    previousIntent: string | null
    breakpoint: string
    isTransitioning: boolean
    slots: Array<{
      slot: string
      visible: boolean
      componentCount: number
      components: Array<{
        id: string
        componentId: string
        lifecycle: string
        size: string
        priority: number
        label?: string
      }>
    }>
  }
  space_id: string
}

interface GetLayoutStateFailure {
  success: false
  error: string
  space_id: string
}

type GetLayoutStateOutput = GetLayoutStateSuccess | GetLayoutStateFailure

export default async function getLayoutStateTool(
  params: {},
  ctx: ToolContext
): Promise<GetLayoutStateOutput> {
  try {
    const state = useLayoutStore.getState()

    // Summarize state
    const summary = {
      currentIntent: state.currentIntent,
      previousIntent: state.previousIntent,
      breakpoint: state.breakpoint,
      isTransitioning: state.isTransitioning,

      slots: Object.entries(state.slots)
        .map(([name, config]) => ({
          slot: name,
          visible: config.visible,
          componentCount: config.components.length,
          components: config.components.map(c => ({
            id: c.id,
            componentId: c.componentId,
            lifecycle: c.lifecycle,
            size: c.size,
            priority: c.priority,
            label: c.label
          }))
        }))
        .filter(s => s.visible)
    }

    return {
      success: true,
      state: summary,
      space_id: ctx.currentSpace
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get layout state',
      space_id: ctx.currentSpace
    }
  }
}
