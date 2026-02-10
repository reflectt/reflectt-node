import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { contextBus } from '@/lib/components/context-bus'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

interface DebugComponentRenderInput {
  componentId: string
  includeDOM?: boolean
  includeContext?: boolean
  includeErrors?: boolean
  includePerformance?: boolean
}

interface ModuleInfo {
  type: string
  props?: Record<string, any>
  slot: string
  label?: string
  visible: boolean
}

interface DOMInfo {
  mounted: boolean
  visible: boolean
  dimensions?: {
    width: number
    height: number
    top: number
    left: number
  }
  displayStyle?: string
  computedStyles?: {
    display: string
    visibility: string
    opacity: string
    zIndex: string
  }
}

interface PerformanceInfo {
  renderCount: number
  lastRenderTime?: number
  averageRenderTime?: number
  eventCount: number
  lastActivity?: number
}

interface ErrorLog {
  timestamp: number
  message: string
  type: 'error' | 'warning'
  stack?: string
}

interface DebugComponentRenderSuccess {
  success: true
  componentId: string
  found: boolean
  module?: ModuleInfo
  dom?: DOMInfo
  context?: any
  errors?: ErrorLog[]
  performance?: PerformanceInfo
  recommendations?: string[]
}

interface DebugComponentRenderFailure {
  success: false
  error: string
}

type DebugComponentRenderOutput =
  | DebugComponentRenderSuccess
  | DebugComponentRenderFailure

/**
 * Find module by ID in layout store
 */
function findModuleById(componentId: string, slots: any): {
  module: any
  slot: string
  slotVisible: boolean
} | null {
  for (const [slotName, slotConfig] of Object.entries<any>(slots)) {
    const modules = slotConfig.modules || []
    const module = modules.find((m: any) => m.id === componentId)

    if (module) {
      return {
        module,
        slot: slotName,
        slotVisible: slotConfig.visible !== false
      }
    }
  }

  return null
}

/**
 * Check if element is visible in viewport
 */
function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  const computedStyle = window.getComputedStyle(element)

  // Check basic visibility
  if (
    computedStyle.display === 'none' ||
    computedStyle.visibility === 'hidden' ||
    computedStyle.opacity === '0'
  ) {
    return false
  }

  // Check if element is in viewport
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    rect.top > window.innerHeight ||
    rect.bottom < 0 ||
    rect.left > window.innerWidth ||
    rect.right < 0
  ) {
    return false
  }

  return true
}

/**
 * Get DOM information for a component
 */
function getDOMInfo(componentId: string): DOMInfo | null {
  if (typeof document === 'undefined') {
    return null
  }

  // Try multiple selectors
  const selectors = [
    `[data-component-id="${componentId}"]`,
    `[data-module-id="${componentId}"]`,
    `#${componentId}`
  ]

  let element: Element | null = null
  for (const selector of selectors) {
    element = document.querySelector(selector)
    if (element) break
  }

  if (!element) {
    return {
      mounted: false,
      visible: false
    }
  }

  const rect = element.getBoundingClientRect()
  const computedStyle = window.getComputedStyle(element)

  return {
    mounted: true,
    visible: isElementVisible(element),
    dimensions: {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left
    },
    displayStyle: (element as HTMLElement).style.display,
    computedStyles: {
      display: computedStyle.display,
      visibility: computedStyle.visibility,
      opacity: computedStyle.opacity,
      zIndex: computedStyle.zIndex
    }
  }
}

/**
 * Get performance metrics from event history
 */
function getPerformanceInfo(componentId: string): PerformanceInfo {
  const events = contextBus.getEventHistory()
  const componentEvents = events.filter(
    (e) => e.source === componentId || e.target === componentId
  )

  const info: PerformanceInfo = {
    renderCount: 0,
    eventCount: componentEvents.length,
    lastActivity: componentEvents.length > 0
      ? componentEvents[componentEvents.length - 1].timestamp
      : undefined
  }

  // Count render-related events
  const renderEvents = componentEvents.filter(
    (e) => e.type === 'data_update' || e.payload?.action === 'render'
  )
  info.renderCount = renderEvents.length

  // Calculate render timing if available
  if (renderEvents.length > 0) {
    info.lastRenderTime = renderEvents[renderEvents.length - 1].timestamp
  }

  return info
}

/**
 * Generate debugging recommendations
 */
function generateRecommendations(
  module: ModuleInfo | undefined,
  dom: DOMInfo | null,
  performance: PerformanceInfo | undefined
): string[] {
  const recommendations: string[] = []

  // Check if component is not mounted
  if (module && dom && !dom.mounted) {
    recommendations.push(
      'Component is registered but not mounted in DOM. Check if parent container is rendered.'
    )
  }

  // Check if component is hidden
  if (dom && dom.mounted && !dom.visible) {
    recommendations.push(
      'Component is mounted but not visible. Check CSS visibility, display, and opacity properties.'
    )
  }

  // Check if slot is hidden
  if (module && !module.visible) {
    recommendations.push(
      `Component's slot "${module.slot}" is not visible. Use set_ui_layout to make the slot visible.`
    )
  }

  // Check if component has zero dimensions
  if (dom && dom.dimensions && dom.dimensions.width === 0 && dom.dimensions.height === 0) {
    recommendations.push(
      'Component has zero dimensions. Check if parent container has size or if content is empty.'
    )
  }

  // Check for high event count but no renders
  if (performance && performance.eventCount > 10 && performance.renderCount === 0) {
    recommendations.push(
      'Component has many events but no renders. Check if component is properly responding to events.'
    )
  }

  // Check for no recent activity
  if (performance && performance.lastActivity) {
    const timeSinceActivity = Date.now() - performance.lastActivity
    if (timeSinceActivity > 60000) {
      // 1 minute
      recommendations.push(
        'No recent activity detected. Component may be idle or not receiving events.'
      )
    }
  }

  return recommendations
}

export default async function debugComponentRender(
  input: DebugComponentRenderInput,
  ctx: ToolContext
): Promise<DebugComponentRenderOutput> {
  try {
    const {
      componentId,
      includeDOM = true,
      includeContext = true,
      includeErrors = true,
      includePerformance = true
    } = input

    // Get layout state
    const layoutState = useLayoutStore.getState()
    const moduleInfo = findModuleById(componentId, layoutState.slots)

    if (!moduleInfo) {
      return {
        success: true,
        componentId,
        found: false,
        recommendations: [
          'Component not found in layout store. It may have been unmounted or never mounted.',
          'Use inspect_component_tree to see all available components.'
        ]
      }
    }

    const { module, slot, slotVisible } = moduleInfo

    // Build module info
    const moduleData: ModuleInfo = {
      type: module.componentId,
      props: module.props,
      slot,
      label: module.label,
      visible: slotVisible
    }

    // Build response
    const response: DebugComponentRenderSuccess = {
      success: true,
      componentId,
      found: true,
      module: moduleData
    }

    // Add DOM info
    if (includeDOM) {
      response.dom = getDOMInfo(componentId) || undefined
    }

    // Add context
    if (includeContext) {
      const context = contextBus.getContext(componentId)
      response.context = context || null
    }

    // Add performance info
    if (includePerformance) {
      response.performance = getPerformanceInfo(componentId)
    }

    // Add error logs (placeholder - would integrate with error tracking system)
    if (includeErrors) {
      // In production, this would query an error logging system
      response.errors = []
    }

    // Generate recommendations
    response.recommendations = generateRecommendations(
      moduleData,
      response.dom || null,
      response.performance
    )

    return response
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
