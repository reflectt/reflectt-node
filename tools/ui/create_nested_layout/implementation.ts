/**
 * Create Nested Layout Tool
 *
 * Enables AI to create layouts within layouts (composite/nested layouts).
 * This allows for complex multi-level UI structures like:
 * - Tabs inside dashboard cells
 * - Split views with tabbed details
 * - Accordions with split content
 * - Dashboard grids inside tabs
 * - Master-detail with tabbed detail views
 *
 * ARCHITECTURE:
 * - Creates a special "layout container" module (not a regular component)
 * - The module has isLayoutContainer=true and nestedLayout configuration
 * - NestedLayoutRenderer recursively renders the nested layout
 * - Supports all layout modes (tabs, accordion, split, dashboard, etc.)
 *
 * EXAMPLES:
 * - Tabbed dashboard: Dashboard views switched via tabs
 * - Split with tabs: Data on left, tabbed details on right
 * - Accordion sections: Collapsible sections with split content
 */

import { useLayoutStore } from '@/lib/ui-control/layout-store'
import type { LayoutMode, TabsConfig, AccordionConfig, NestedLayoutConfig } from '@/lib/ui-control/layout-store'
import { createNestedLayoutContainer, NestedLayoutTemplates } from '@/lib/ui-control/layout-store'

interface CreateNestedLayoutInput {
  parentSlot: 'primary' | 'secondary' | 'sidebar'
  nestedMode?: LayoutMode
  label?: string
  configuration?: {
    tabsConfig?: TabsConfig
    accordionConfig?: AccordionConfig
    splitRatio?: number
  }
  template?: 'tabbedDashboard' | 'splitWithTabs' | 'accordionWithSplits' | 'dashboardInTab' | 'masterDetailWithTabs'
  templateConfig?: {
    tabLabels?: string[]
    sectionTitles?: string[]
    leftLabel?: string
    rightTabLabels?: string[]
  }
}

interface CreateNestedLayoutOutput {
  success: boolean
  message: string
  moduleId?: string
  nestedMode?: LayoutMode
  error?: string
}

export async function createNestedLayout(
  input: CreateNestedLayoutInput
): Promise<CreateNestedLayoutOutput> {
  try {
    console.log('[create_nested_layout] Creating nested layout:', input)

    const store = useLayoutStore.getState()
    const { mountModuleInSlot } = store.actions

    let nestedLayoutModule

    // Use template if provided
    if (input.template) {
      nestedLayoutModule = createModuleFromTemplate(input)
    }
    // Create manual configuration
    else if (input.nestedMode && input.configuration) {
      nestedLayoutModule = createModuleFromConfig(input)
    } else {
      return {
        success: false,
        message: 'Either template or (nestedMode + configuration) must be provided',
        error: 'INVALID_INPUT'
      }
    }

    // Mount the nested layout module in the parent slot
    mountModuleInSlot(input.parentSlot, nestedLayoutModule)

    return {
      success: true,
      message: `Nested layout created in ${input.parentSlot} slot`,
      moduleId: nestedLayoutModule.id,
      nestedMode: nestedLayoutModule.nestedLayout?.mode
    }
  } catch (error) {
    console.error('[create_nested_layout] Error:', error)
    return {
      success: false,
      message: `Failed to create nested layout: ${error instanceof Error ? error.message : String(error)}`,
      error: 'EXECUTION_ERROR'
    }
  }
}

/**
 * Create nested layout module from template
 */
function createModuleFromTemplate(input: CreateNestedLayoutInput) {
  const { template, templateConfig, label } = input

  if (!template) {
    throw new Error('Template is required')
  }

  switch (template) {
    case 'tabbedDashboard': {
      const tabLabels = templateConfig?.tabLabels || ['Dashboard 1', 'Dashboard 2', 'Dashboard 3']
      const module = NestedLayoutTemplates.tabbedDashboard(tabLabels)
      if (label) module.label = label
      return module
    }

    case 'splitWithTabs': {
      const leftLabel = templateConfig?.leftLabel || 'Data'
      const rightTabLabels = templateConfig?.rightTabLabels || ['Details', 'Analysis', 'Settings']
      const module = NestedLayoutTemplates.splitWithTabs(leftLabel, rightTabLabels)
      if (label) module.label = label
      return module
    }

    case 'accordionWithSplits': {
      const sectionTitles = templateConfig?.sectionTitles || ['Section 1', 'Section 2', 'Section 3']
      const module = NestedLayoutTemplates.accordionWithSplits(sectionTitles)
      if (label) module.label = label
      return module
    }

    case 'dashboardInTab': {
      const module = NestedLayoutTemplates.dashboardInTab()
      if (label) module.label = label
      return module
    }

    case 'masterDetailWithTabs': {
      const tabLabels = templateConfig?.tabLabels || ['Overview', 'Details', 'Related']
      const module = NestedLayoutTemplates.masterDetailWithTabs(tabLabels)
      if (label) module.label = label
      return module
    }

    default:
      throw new Error(`Unknown template: ${template}`)
  }
}

/**
 * Create nested layout module from manual configuration
 */
function createModuleFromConfig(input: CreateNestedLayoutInput) {
  const { nestedMode, configuration, label } = input

  if (!nestedMode) {
    throw new Error('Nested mode is required')
  }

  // Build slots configuration
  const slots = {
    primary: { visible: true, modules: [] },
    secondary: { visible: false, modules: [] },
    sidebar: { visible: false, modules: [] },
    top: { visible: false, modules: [] }
  }

  // For split mode, enable secondary
  if (nestedMode === 'split') {
    slots.secondary.visible = true
  }

  // For three-column, enable sidebar
  if (nestedMode === 'three-column') {
    slots.sidebar.visible = true
    slots.secondary.visible = true
  }

  // For app-shell, enable top
  if (nestedMode === 'app-shell') {
    slots.top.visible = true
  }

  // Create nested layout module
  return createNestedLayoutContainer(
    nestedMode,
    slots,
    label,
    {
      tabsConfig: configuration?.tabsConfig,
      accordionConfig: configuration?.accordionConfig,
      splitRatio: configuration?.splitRatio
    }
  )
}

// Export for tool registry
export default {
  name: 'create_nested_layout',
  description: 'Create a layout within another layout (nested/composite layouts)',
  execute: createNestedLayout
}
