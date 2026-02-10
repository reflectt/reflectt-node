/**
 * Get Visual Hierarchy Tool Implementation
 *
 * Returns the visual hierarchy of all components in the layout,
 * including slot structure, z-index, visibility, dimensions, and overlaps.
 */

import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

interface GetVisualHierarchyInput {
  includeHidden?: boolean
}

interface ModuleHierarchy {
  id: string
  type: string
  label?: string
  mounted: boolean
  visible: boolean
  zIndex: string
  position: string
  dimensions: {
    width: number
    height: number
    top: number
    left: number
    bottom: number
    right: number
  } | null
  isOverlapping: boolean
  overlappingWith?: string[]
}

interface SlotHierarchy {
  visible: boolean
  collapsed?: boolean
  moduleCount: number
  modules: ModuleHierarchy[]
}

interface OverlayHierarchy {
  id: string
  componentId: string
  mode: string
  size: string
  zIndex: number
  dismissable: boolean
}

interface HierarchyResult {
  mode: string
  slots: Record<string, SlotHierarchy>
  overlays: OverlayHierarchy[]
  splitView: {
    active: boolean
    leftPane?: string
    rightPane?: string
    ratio?: number
  }
  tabsConfig: {
    active: boolean
    activeTab?: number
    tabCount?: number
  }
  accordionConfig: {
    active: boolean
    sectionCount?: number
    expandedSections?: string[]
  }
  totalComponents: number
  visibleComponents: number
  hiddenComponents: number
}

interface GetVisualHierarchySuccess {
  success: true
  hierarchy: HierarchyResult
  warnings?: string[]
}

interface GetVisualHierarchyFailure {
  success: false
  error: string
}

type GetVisualHierarchyOutput =
  | GetVisualHierarchySuccess
  | GetVisualHierarchyFailure

/**
 * Check if element is visible
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

  // Check if element has dimensions
  if (rect.width === 0 || rect.height === 0) {
    return false
  }

  return true
}

/**
 * Get DOM element for component
 */
function getComponentElement(componentId: string): Element | null {
  if (typeof document === 'undefined') {
    return null
  }

  // Try multiple selectors
  const selectors = [
    `[data-component-id="${componentId}"]`,
    `[data-module-id="${componentId}"]`,
    `#${componentId}`
  ]

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element) {
      return element
    }
  }

  return null
}

/**
 * Detect overlapping elements
 */
function detectOverlaps(
  element: Element,
  allElements: Element[]
): { isOverlapping: boolean; overlappingWith: string[] } {
  const rect1 = element.getBoundingClientRect()
  const overlappingWith: string[] = []

  for (const other of allElements) {
    if (other === element) continue

    const rect2 = other.getBoundingClientRect()

    // Check if rectangles overlap
    const overlap = !(
      rect1.right < rect2.left ||
      rect1.left > rect2.right ||
      rect1.bottom < rect2.top ||
      rect1.top > rect2.bottom
    )

    if (overlap) {
      const otherId =
        other.getAttribute('data-component-id') ||
        other.getAttribute('data-module-id') ||
        other.id ||
        'unknown'
      overlappingWith.push(otherId)
    }
  }

  return {
    isOverlapping: overlappingWith.length > 0,
    overlappingWith
  }
}

/**
 * Get module hierarchy information
 */
function getModuleHierarchy(
  module: any,
  allElements: Element[]
): ModuleHierarchy {
  const element = getComponentElement(module.id)
  const mounted = !!element

  let visible = false
  let zIndex = 'auto'
  let position = 'static'
  let dimensions = null
  let isOverlapping = false
  let overlappingWith: string[] | undefined

  if (element) {
    const computed = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()

    visible = isElementVisible(element)
    zIndex = computed.zIndex || 'auto'
    position = computed.position || 'static'

    dimensions = {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right
    }

    const overlapInfo = detectOverlaps(element, allElements)
    isOverlapping = overlapInfo.isOverlapping
    overlappingWith = overlapInfo.overlappingWith
  }

  return {
    id: module.id,
    type: module.componentId,
    label: module.label,
    mounted,
    visible,
    zIndex,
    position,
    dimensions,
    isOverlapping,
    overlappingWith
  }
}

export default async function getVisualHierarchy(
  input: GetVisualHierarchyInput,
  ctx: ToolContext
): Promise<GetVisualHierarchyOutput> {
  try {
    const { includeHidden = false } = input

    const layoutState = useLayoutStore.getState()
    const warnings: string[] = []

    // Get all component elements for overlap detection
    const allElements: Element[] = []
    if (typeof document !== 'undefined') {
      // Get all components in DOM
      const componentElements = document.querySelectorAll(
        '[data-component-id], [data-module-id]'
      )
      allElements.push(...Array.from(componentElements))
    }

    // Build slot hierarchy
    const slots: Record<string, SlotHierarchy> = {}
    let totalComponents = 0
    let visibleComponents = 0
    let hiddenComponents = 0

    for (const [slotName, slotConfig] of Object.entries<any>(
      layoutState.slots
    )) {
      // Skip hidden slots if not including them
      if (!slotConfig.visible && !includeHidden) {
        continue
      }

      const modules = slotConfig.modules || []
      const moduleHierarchy: ModuleHierarchy[] = []

      for (const module of modules) {
        const hierarchy = getModuleHierarchy(module, allElements)
        moduleHierarchy.push(hierarchy)

        totalComponents++
        if (hierarchy.visible) {
          visibleComponents++
        } else {
          hiddenComponents++
        }

        // Add warnings for potential issues
        if (hierarchy.mounted && !hierarchy.visible) {
          warnings.push(
            `Component "${hierarchy.id}" is mounted but not visible in slot "${slotName}"`
          )
        }

        if (!hierarchy.mounted && slotConfig.visible) {
          warnings.push(
            `Component "${hierarchy.id}" is registered in slot "${slotName}" but not mounted in DOM`
          )
        }

        if (hierarchy.isOverlapping && hierarchy.overlappingWith) {
          warnings.push(
            `Component "${hierarchy.id}" is overlapping with: ${hierarchy.overlappingWith.join(', ')}`
          )
        }
      }

      slots[slotName] = {
        visible: slotConfig.visible,
        collapsed: slotConfig.collapsed,
        moduleCount: modules.length,
        modules: moduleHierarchy
      }
    }

    // Build overlay hierarchy
    const overlays: OverlayHierarchy[] = layoutState.overlayStack.map(
      (overlay, index) => ({
        id: overlay.id,
        componentId: overlay.componentId,
        mode: overlay.mode,
        size: overlay.size,
        zIndex: 40 + index, // Base z-index of 40, increment for each overlay
        dismissable: overlay.dismissable
      })
    )

    // Build split view info
    const splitView = {
      active: layoutState.mode === 'split' && !!layoutState.splitView,
      leftPane: layoutState.splitView?.leftPane?.componentId,
      rightPane: layoutState.splitView?.rightPane?.componentId,
      ratio: layoutState.splitView?.ratio
    }

    // Build tabs config info
    const tabsConfig = {
      active: layoutState.mode === 'tabs' && !!layoutState.tabsConfig,
      activeTab: layoutState.tabsConfig?.activeTab,
      tabCount: layoutState.tabsConfig?.tabs.length
    }

    // Build accordion config info
    const accordionConfig = {
      active: layoutState.mode === 'accordion' && !!layoutState.accordionConfig,
      sectionCount: layoutState.accordionConfig?.sections.length,
      expandedSections: layoutState.accordionConfig?.sections
        .filter((s) => s.expanded)
        .map((s) => s.id)
    }

    // Build final hierarchy
    const hierarchy: HierarchyResult = {
      mode: layoutState.mode,
      slots,
      overlays,
      splitView,
      tabsConfig,
      accordionConfig,
      totalComponents,
      visibleComponents,
      hiddenComponents
    }

    const result: GetVisualHierarchySuccess = {
      success: true,
      hierarchy
    }

    if (warnings.length > 0) {
      result.warnings = warnings
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: formatError(error)
    }
  }
}
