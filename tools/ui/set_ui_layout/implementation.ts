import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

type LayoutMode = 
  // Original modes
  | 'standard' 
  | 'split' 
  | 'sidebar-focus' 
  | 'fullscreen'
  // Industry-standard layouts
  | 'dashboard'      // Grid of widgets/cards
  | 'master-detail'  // List + detail panes
  | 'app-shell'      // Header/nav/content/footer
  | 'three-column'   // Nav | Content | Inspector
  | 'board'          // Kanban columns
  | 'feed'           // Vertical timeline

type BannerSeverity = 'info' | 'success' | 'warning' | 'error'

interface SlotConfig {
  visible?: boolean
  collapsed?: boolean // Only for sidebar
}

interface SlotsConfig {
  sidebar?: SlotConfig
  top?: SlotConfig
  primary?: SlotConfig
  secondary?: SlotConfig
}

interface TopBannerAction {
  label: string
  prompt: string
}

interface TopBannerConfig {
  message: string
  severity?: BannerSeverity
  dismissable?: boolean
  action?: TopBannerAction
}

interface SetUILayoutInput {
  mode: LayoutMode
  splitRatio?: number
  slots?: SlotsConfig
  topBanner?: TopBannerConfig
  animate?: boolean
}

interface SetUILayoutSuccess {
  success: true
  layout_update: {
    mode: LayoutMode
    splitRatio?: number
    slots?: SlotsConfig
    topBanner?: TopBannerConfig
    animate: boolean
    timestamp: string
  }
  space_id: string
}

interface SetUILayoutFailure {
  success: false
  error: string
  space_id: string
}

type SetUILayoutOutput = SetUILayoutSuccess | SetUILayoutFailure

/**
 * set_ui_layout - Streaming UI Tool
 * 
 * Controls the overall UI layout and slot configuration for orchestrating
 * spatial arrangement of content. This is a streaming UI control tool -
 * layout changes happen in real-time as the tool call streams through.
 * 
 * The layout update is processed by:
 * 1. Server validates mode, splitRatio, slots, topBanner, animate
 * 2. Returns success payload with layout_update object
 * 3. Client-side PortalExperienceStore listens for layout_update
 * 4. Store applies layout configuration to UI
 * 5. CSS transitions smooth the layout change if animate=true
 * 6. Content in slots adjusts to new spatial arrangement
 * 
 * Layout Modes:
 * 
 * Original Modes:
 * - standard: Chat-first with optional sidebar (default)
 * - split: Chat + primary/secondary panes side-by-side
 * - sidebar-focus: Sidebar emphasized, chat collapsed
 * - fullscreen: Content panes only, chat hidden (immersive)
 * 
 * Industry-Standard Layouts (Foolproof):
 * - dashboard: Grid of widgets/cards (responsive 2-4 columns, auto rows)
 *   Perfect for: Analytics, metrics, status overview, KPI monitoring
 * 
 * - master-detail: Classic list + detail (1/3 list, 2/3 detail)
 *   Perfect for: Email clients, file browsers, documentation, records
 * 
 * - app-shell: Traditional app structure (header/nav/content/footer)
 *   Perfect for: Full applications, admin panels, complex workflows
 * 
 * - three-column: IDE-style (nav | content | inspector)
 *   Perfect for: Code editors, design tools, data exploration
 * 
 * - board: Kanban columns (horizontal scroll, equal-width)
 *   Perfect for: Task management, pipelines, stage-based workflows
 * 
 * - feed: Vertical timeline (single column, centered, max-width 768px)
 *   Perfect for: Social feeds, activity streams, chronological content
 * 
 * Use Cases:
 * - Deep-dive analysis: Switch to split view with dashboard + metrics
 * - Immersive experiences: Fullscreen mode for galleries, workflows
 * - Critical alerts: Top banner with dismissable message
 * - Focus mode: sidebar-focus for tool/component exploration
 * - Compare views: Split mode with equal ratio (0.5)
 * - Progressive revelation: Standard → split → fullscreen
 */
export default async function setUILayoutTool(
  input: SetUILayoutInput,
  ctx: ToolContext
): Promise<SetUILayoutOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required mode
    const validModes: LayoutMode[] = [
      'standard', 'split', 'sidebar-focus', 'fullscreen',
      'dashboard', 'master-detail', 'app-shell', 'three-column', 'board', 'feed'
    ]
    if (!params.mode || !validModes.includes(params.mode)) {
      throw new Error(`Invalid or missing mode. Must be one of: ${validModes.join(', ')}`)
    }
    const mode = params.mode as LayoutMode

    // Validate optional splitRatio
    let splitRatio: number | undefined
    if (params.splitRatio !== undefined) {
      // Coerce string to number if needed (Claude sometimes passes "0.66" instead of 0.66)
      const ratio = typeof params.splitRatio === 'string' ? parseFloat(params.splitRatio) : params.splitRatio
      if (typeof ratio !== 'number' || isNaN(ratio)) {
        throw new Error('splitRatio must be a number')
      }
      if (ratio < 0.1 || ratio > 0.9) {
        throw new Error('splitRatio must be between 0.1 and 0.9')
      }
      splitRatio = ratio
    }

    // Validate optional slots
    let slots: SlotsConfig | undefined
    if (params.slots !== undefined) {
      // Coerce JSON string to object if needed (Claude sometimes passes JSON string instead of object)
      let slotsObj: any
      if (typeof params.slots === 'string') {
        try {
          slotsObj = JSON.parse(params.slots)
        } catch {
          throw new Error('slots must be a valid JSON object or object')
        }
      } else {
        slotsObj = params.slots
      }
      
      if (typeof slotsObj !== 'object' || Array.isArray(slotsObj)) {
        throw new Error('slots must be an object')
      }

      const validSlots = ['sidebar', 'top', 'primary', 'secondary']
      
      for (const key of Object.keys(slotsObj)) {
        if (!validSlots.includes(key)) {
          throw new Error(`Invalid slot key: "${key}". Must be one of: ${validSlots.join(', ')}`)
        }

        const slotConfig = slotsObj[key]
        if (typeof slotConfig !== 'object' || Array.isArray(slotConfig)) {
          throw new Error(`slots.${key} must be an object`)
        }

        if (slotConfig.visible !== undefined && typeof slotConfig.visible !== 'boolean') {
          throw new Error(`slots.${key}.visible must be a boolean`)
        }

        if (key === 'sidebar' && slotConfig.collapsed !== undefined && typeof slotConfig.collapsed !== 'boolean') {
          throw new Error('slots.sidebar.collapsed must be a boolean')
        }
      }

      slots = slotsObj as SlotsConfig
    }

    // Validate optional topBanner
    let topBanner: TopBannerConfig | undefined
    if (params.topBanner !== undefined) {
      // Coerce JSON string to object if needed (Claude sometimes passes JSON string instead of object)
      let banner: any
      if (typeof params.topBanner === 'string') {
        try {
          banner = JSON.parse(params.topBanner)
        } catch {
          throw new Error('topBanner must be a valid JSON object or object')
        }
      } else {
        banner = params.topBanner
      }
      
      if (typeof banner !== 'object' || Array.isArray(banner)) {
        throw new Error('topBanner must be an object')
      }

      // Validate required message
      if (!banner.message || typeof banner.message !== 'string') {
        throw new Error('topBanner.message is required and must be a string')
      }
      const message = banner.message.trim()
      if (message.length === 0) {
        throw new Error('topBanner.message cannot be empty')
      }
      if (message.length > 200) {
        throw new Error('topBanner.message must be 200 characters or less')
      }

      // Validate optional severity
      const validSeverities: BannerSeverity[] = ['info', 'success', 'warning', 'error']
      let severity: BannerSeverity = 'info'
      if (banner.severity) {
        if (!validSeverities.includes(banner.severity)) {
          throw new Error(`topBanner.severity must be one of: ${validSeverities.join(', ')}`)
        }
        severity = banner.severity as BannerSeverity
      }

      // Validate optional dismissable
      const dismissable = banner.dismissable !== false // Default true

      // Validate optional action
      let action: TopBannerAction | undefined
      if (banner.action) {
        if (typeof banner.action !== 'object' || Array.isArray(banner.action)) {
          throw new Error('topBanner.action must be an object')
        }
        if (!banner.action.label || typeof banner.action.label !== 'string') {
          throw new Error('topBanner.action.label is required and must be a string')
        }
        if (!banner.action.prompt || typeof banner.action.prompt !== 'string') {
          throw new Error('topBanner.action.prompt is required and must be a string')
        }
        action = {
          label: banner.action.label.trim(),
          prompt: banner.action.prompt.trim()
        }
      }

      topBanner = {
        message,
        severity,
        dismissable,
        action
      }
    }

    // Validate optional animate
    // Coerce string to boolean if needed (Claude sometimes passes "true" instead of true)
    const animate = params.animate === false || params.animate === 'false' ? false : true

    // Log layout change for debugging
    console.log('[set_ui_layout]', {
      mode,
      splitRatio,
      slotsCount: slots ? Object.keys(slots).length : 0,
      hasBanner: !!topBanner,
      animate,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      layout_update: {
        mode,
        ...(splitRatio !== undefined && { splitRatio }),
        ...(slots && { slots }),
        ...(topBanner && { topBanner }),
        animate,
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
