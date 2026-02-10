import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

interface PaneConfig {
  componentId: string
  props?: Record<string, any>
  title?: string
}

interface SetSplitViewInput {
  leftPane: PaneConfig
  rightPane: PaneConfig
  ratio?: number
  linkScroll?: boolean
  dividerLocked?: boolean
  animate?: boolean
}

interface SetSplitViewSuccess {
  success: true
  split_view_update: {
    leftPane: PaneConfig
    rightPane: PaneConfig
    ratio: number
    linkScroll: boolean
    dividerLocked: boolean
    animate: boolean
    timestamp: string
  }
  space_id: string
}

interface SetSplitViewFailure {
  success: false
  error: string
  space_id: string
}

type SetSplitViewOutput = SetSplitViewSuccess | SetSplitViewFailure

/**
 * set_split_view - Streaming UI Tool
 * 
 * Configures a split-screen view with two components side-by-side for
 * comparisons, parallel analysis, or multi-context exploration. This is
 * a streaming UI control tool - split view renders in real-time as the
 * tool call streams through.
 * 
 * The split view is processed by:
 * 1. Server validates leftPane, rightPane, ratio, linkScroll, dividerLocked, animate
 * 2. Returns success payload with split_view_update object
 * 3. Client-side PortalExperienceStore listens for split_view_update
 * 4. Store mounts both components in primary/secondary slots
 * 5. Divider renders between panes at specified ratio
 * 6. If linkScroll=true, scrolling syncs between panes
 * 7. If dividerLocked=false, user can drag to adjust ratio
 * 8. Components animate in if animate=true
 * 
 * Use Cases:
 * - Compare agent outputs (same query, different agents)
 * - Before/after code comparison
 * - Dual dashboards (cost + performance metrics)
 * - Multi-model responses (GPT-4 vs Claude side-by-side)
 * - Document comparison (two PDFs, two error traces)
 * - A/B testing results
 * - Timeline comparisons (historical vs current data)
 */
export default async function setSplitViewTool(
  input: unknown,
  ctx: ToolContext
): Promise<SetSplitViewOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required leftPane
    if (!params.leftPane || typeof params.leftPane !== 'object' || Array.isArray(params.leftPane)) {
      throw new Error('Missing or invalid leftPane: must be an object')
    }
    const leftPaneRaw = params.leftPane as Record<string, any>
    if (!leftPaneRaw.componentId || typeof leftPaneRaw.componentId !== 'string') {
      throw new Error('leftPane.componentId is required and must be a string')
    }
    const leftComponentId = leftPaneRaw.componentId.trim()
    if (leftComponentId.length === 0) {
      throw new Error('leftPane.componentId cannot be empty')
    }

    const leftPane: PaneConfig = { componentId: leftComponentId }
    
    if (leftPaneRaw.props !== undefined) {
      if (typeof leftPaneRaw.props !== 'object' || Array.isArray(leftPaneRaw.props)) {
        throw new Error('leftPane.props must be a non-array object')
      }
      leftPane.props = leftPaneRaw.props as Record<string, any>
    }

    if (leftPaneRaw.title !== undefined) {
      if (typeof leftPaneRaw.title !== 'string') {
        throw new Error('leftPane.title must be a string')
      }
      const leftTitle = leftPaneRaw.title.trim()
      if (leftTitle.length === 0) {
        throw new Error('leftPane.title cannot be empty')
      }
      if (leftTitle.length > 50) {
        throw new Error('leftPane.title must be 50 characters or less')
      }
      leftPane.title = leftTitle
    }

    // Validate required rightPane
    if (!params.rightPane || typeof params.rightPane !== 'object' || Array.isArray(params.rightPane)) {
      throw new Error('Missing or invalid rightPane: must be an object')
    }
    const rightPaneRaw = params.rightPane as Record<string, any>
    if (!rightPaneRaw.componentId || typeof rightPaneRaw.componentId !== 'string') {
      throw new Error('rightPane.componentId is required and must be a string')
    }
    const rightComponentId = rightPaneRaw.componentId.trim()
    if (rightComponentId.length === 0) {
      throw new Error('rightPane.componentId cannot be empty')
    }

    const rightPane: PaneConfig = { componentId: rightComponentId }
    
    if (rightPaneRaw.props !== undefined) {
      if (typeof rightPaneRaw.props !== 'object' || Array.isArray(rightPaneRaw.props)) {
        throw new Error('rightPane.props must be a non-array object')
      }
      rightPane.props = rightPaneRaw.props as Record<string, any>
    }

    if (rightPaneRaw.title !== undefined) {
      if (typeof rightPaneRaw.title !== 'string') {
        throw new Error('rightPane.title must be a string')
      }
      const rightTitle = rightPaneRaw.title.trim()
      if (rightTitle.length === 0) {
        throw new Error('rightPane.title cannot be empty')
      }
      if (rightTitle.length > 50) {
        throw new Error('rightPane.title must be 50 characters or less')
      }
      rightPane.title = rightTitle
    }

    // Validate optional ratio
    let ratio = 0.5 // Default equal split
    if (params.ratio !== undefined) {
      if (typeof params.ratio !== 'number') {
        throw new Error('ratio must be a number')
      }
      if (params.ratio < 0.1 || params.ratio > 0.9) {
        throw new Error('ratio must be between 0.1 and 0.9')
      }
      ratio = params.ratio
    }

    // Validate optional linkScroll
    const linkScroll = params.linkScroll === true // Default false

    // Validate optional dividerLocked
    const dividerLocked = params.dividerLocked === true // Default false

    // Validate optional animate
    const animate = params.animate !== false // Default true

    // Log split view setup for debugging
    console.log('[set_split_view]', {
      leftComponentId: leftPane.componentId,
      rightComponentId: rightPane.componentId,
      ratio,
      linkScroll,
      dividerLocked,
      animate,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      split_view_update: {
        leftPane,
        rightPane,
        ratio,
        linkScroll,
        dividerLocked,
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
