/**
 * Show Modal Layout Tool Handler
 *
 * Shows a modal/overlay containing a full layout with multiple components.
 * This enables complex modal experiences like wizards, comparisons, and dashboards.
 */

import { useLayoutStore, type SlotModule, type SlotsConfig } from '@/lib/ui-control/layout-store'
import { ModalLayoutTemplates } from '@/lib/ui-control/modal-layout-templates'

// V2.0.0: Semantic slots only
interface ShowModalLayoutInput {
  layoutMode: 'standard' | 'split' | 'tabs' | 'accordion' | 'dashboard' | 'master-detail' | 'three-column' | 'feed'
  title?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  components: Array<{
    componentId: string
    slot: 'hero' | 'main' | 'detail' | 'context' | 'navigation' | 'status' | 'actions' | 'overlay' | 'background'
    props?: Record<string, any>
    label?: string
    icon?: string
  }>
  layoutConfig?: {
    splitRatio?: number
    tabsConfig?: {
      position?: 'top' | 'left' | 'bottom'
      initialTab?: number
    }
    accordionConfig?: {
      allowMultiple?: boolean
      sections?: Array<{
        id: string
        title: string
        icon?: string
        slot: 'hero' | 'main' | 'detail' | 'context' | 'navigation' | 'status' | 'actions' | 'overlay' | 'background'
        expanded?: boolean
        collapsible?: boolean
      }>
    }
  }
  dismissable?: boolean
  backdrop?: 'blur' | 'dark' | 'light' | 'none'
  template?: string
}

export async function handler(input: ShowModalLayoutInput): Promise<{
  success: boolean
  overlayId: string
  message: string
}> {
  try {
    const store = useLayoutStore.getState()

    // Check if using a template
    if (input.template && input.template in ModalLayoutTemplates) {
      // Template-based modal (simplified API)
      const templateFn = ModalLayoutTemplates[input.template as keyof typeof ModalLayoutTemplates]

      // For now, just use the manual approach
      // Templates would need component grouping logic
      console.log('[show_modal_layout] Template requested:', input.template, '- using manual layout')
    }

    // Build slots configuration from components
    const slots: SlotsConfig = {
      primary: { visible: false, modules: [] },
      secondary: { visible: false, modules: [] },
      sidebar: { visible: false, modules: [] },
      top: { visible: false, modules: [] }
    }

    // Group components by slot
    input.components.forEach((comp, index) => {
      const module: SlotModule = {
        id: `modal-${Date.now()}-${index}`,
        componentId: comp.componentId,
        props: comp.props || {},
        label: comp.label
      }

      const slot = slots[comp.slot]
      if (slot) {
        slot.visible = true
        slot.modules = slot.modules || []
        slot.modules.push(module)
      }
    })

    // Build layout config
    const layoutConfig: any = {}

    // Tabs configuration
    if (input.layoutMode === 'tabs' && input.layoutConfig?.tabsConfig) {
      const tabComponents = input.components.filter(c => c.label)
      layoutConfig.tabsConfig = {
        activeTab: input.layoutConfig.tabsConfig.initialTab || 0,
        tabs: tabComponents.map((comp) => ({
          label: comp.label || 'Tab',
          icon: comp.icon,
          slot: comp.slot
        })),
        position: input.layoutConfig.tabsConfig.position || 'top'
      }
    }

    // Accordion configuration
    if (input.layoutMode === 'accordion' && input.layoutConfig?.accordionConfig) {
      layoutConfig.accordionConfig = {
        sections: input.layoutConfig.accordionConfig.sections || [],
        allowMultiple: input.layoutConfig.accordionConfig.allowMultiple !== false
      }
    }

    // Split ratio
    if (input.layoutMode === 'split' && input.layoutConfig?.splitRatio) {
      layoutConfig.splitRatio = input.layoutConfig.splitRatio
    }

    // Push the overlay
    const overlayId = store.actions.pushLayoutOverlay({
      mode: 'modal',
      layoutMode: input.layoutMode,
      layoutSlots: slots,
      layoutConfig,
      title: input.title,
      size: input.size === 'sm' ? 'small' :
            input.size === 'md' ? 'medium' :
            input.size === 'lg' ? 'large' :
            input.size === 'xl' ? 'xlarge' :
            input.size === 'full' ? 'xlarge' :
            'large',
      dismissable: input.dismissable !== false,
      backdrop: input.backdrop === 'none' ? 'transparent' : (input.backdrop || 'blur'),
      animate: true
    })

    console.log('[show_modal_layout] Modal opened:', overlayId, {
      layoutMode: input.layoutMode,
      componentCount: input.components.length,
      slots: Object.entries(slots).filter(([_, s]) => s.visible).map(([name]) => name)
    })

    return {
      success: true,
      overlayId,
      message: `Modal opened with ${input.layoutMode} layout containing ${input.components.length} components`
    }
  } catch (error) {
    console.error('[show_modal_layout] Error:', error)
    return {
      success: false,
      overlayId: '',
      message: `Failed to show modal: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}
