import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

type OverlayMode = 'modal' | 'fullscreen'
type OverlaySize = 'small' | 'medium' | 'large' | 'xlarge' | 'auto'
type BackdropStyle = 'blur' | 'dark' | 'light' | 'transparent'

interface MountOverlayInput {
  componentId: string
  mode?: OverlayMode
  size?: OverlaySize
  dismissable?: boolean
  props?: Record<string, any>
  backdrop?: BackdropStyle
  animate?: boolean
}

interface MountOverlaySuccess {
  success: true
  overlay_mount: {
    componentId: string
    mode: OverlayMode
    size: OverlaySize
    dismissable: boolean
    props?: Record<string, any>
    backdrop: BackdropStyle
    animate: boolean
    timestamp: string
  }
  space_id: string
}

interface MountOverlayFailure {
  success: false
  error: string
  space_id: string
}

type MountOverlayOutput = MountOverlaySuccess | MountOverlayFailure

/**
 * mount_overlay - Streaming UI Tool
 * 
 * Mounts a component in overlay mode (modal or fullscreen) for immersive,
 * focused experiences. This is a streaming UI control tool - overlay appears
 * in real-time as the tool call streams through.
 * 
 * The overlay is processed by:
 * 1. Server validates componentId, mode, size, dismissable, props, backdrop, animate
 * 2. Returns success payload with overlay_mount object
 * 3. Client-side PortalExperienceStore listens for overlay_mount
 * 4. Store mounts component in overlay slot with specified configuration
 * 5. Backdrop renders with selected style (blur/dark/light/transparent)
 * 6. Component animates in if animate=true
 * 7. User can dismiss if dismissable=true (ESC key or backdrop click)
 * 
 * Modal vs Fullscreen:
 * - modal: Centered dialog, sized container, dismissable by default
 * - fullscreen: Entire viewport, no chrome, locked by default
 * 
 * Use Cases:
 * - Image galleries (lightbox mode)
 * - PDF/document previews (focused reading)
 * - Error traces (debug deep-dive)
 * - Workflows (step-by-step wizards)
 * - Critical alerts (force attention)
 * - Video players (immersive viewing)
 */
export default async function mountOverlayTool(
  input: unknown,
  ctx: ToolContext
): Promise<MountOverlayOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required componentId
    if (!params.componentId || typeof params.componentId !== 'string') {
      throw new Error('Missing required parameter: componentId')
    }
    const componentId = params.componentId.trim()
    if (componentId.length === 0) {
      throw new Error('componentId cannot be empty')
    }

    // Validate optional mode
    const validModes: OverlayMode[] = ['modal', 'fullscreen']
    const mode: OverlayMode = params.mode && validModes.includes(params.mode) 
      ? params.mode as OverlayMode 
      : 'modal'

    // Validate optional size
    const validSizes: OverlaySize[] = ['small', 'medium', 'large', 'xlarge', 'auto']
    const size: OverlaySize = params.size && validSizes.includes(params.size)
      ? params.size as OverlaySize
      : 'medium'

    // Validate optional dismissable (default depends on mode)
    // Coerce string to boolean if needed (Claude sometimes passes "true" instead of true)
    const dismissable = params.dismissable !== undefined 
      ? (params.dismissable === true || params.dismissable === 'true')
      : mode === 'modal' // modal=true, fullscreen=false by default

    // Validate optional props
    let props: Record<string, any> | undefined
    if (params.props !== undefined) {
      // Coerce JSON string to object if needed (Claude sometimes passes JSON string instead of object)
      if (typeof params.props === 'string') {
        try {
          props = JSON.parse(params.props)
        } catch {
          throw new Error('props must be a valid JSON object or object')
        }
      } else {
        props = params.props
      }
      
      if (typeof props !== 'object' || Array.isArray(props)) {
        throw new Error('props must be a non-array object')
      }
    }

    // Validate optional backdrop
    const validBackdrops: BackdropStyle[] = ['blur', 'dark', 'light', 'transparent']
    const backdrop: BackdropStyle = params.backdrop && validBackdrops.includes(params.backdrop)
      ? params.backdrop as BackdropStyle
      : 'blur'

    // Validate optional animate
    const animate = params.animate !== false // Default true

    // Log overlay mount for debugging
    console.log('[mount_overlay]', {
      componentId,
      mode,
      size,
      dismissable,
      hasProps: !!props,
      backdrop,
      animate,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      overlay_mount: {
        componentId,
        mode,
        size,
        dismissable,
        ...(props && { props }),
        backdrop,
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
