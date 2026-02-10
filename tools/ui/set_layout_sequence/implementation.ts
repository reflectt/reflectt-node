import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'

type LayoutMode =
  | 'standard'
  | 'split'
  | 'sidebar-focus'
  | 'fullscreen'
  | 'dashboard'
  | 'master-detail'
  | 'app-shell'
  | 'three-column'
  | 'board'
  | 'feed'
  | 'tabs'
  | 'accordion'

type TransitionStyle = 'instant' | 'subtle' | 'normal' | 'dramatic'

interface SlotConfig {
  visible?: boolean
  collapsed?: boolean
}

interface SlotsConfig {
  sidebar?: SlotConfig
  top?: SlotConfig
  primary?: SlotConfig
  secondary?: SlotConfig
}

interface SequenceStep {
  mode: LayoutMode
  duration?: number
  slots?: SlotsConfig
  transition?: TransitionStyle
}

interface SetLayoutSequenceInput {
  steps: SequenceStep[]
  loop?: boolean
  onComplete?: string
}

interface SetLayoutSequenceSuccess {
  success: true
  sequence: {
    steps: number
    totalDuration: number
    loop: boolean
    sequenceId: string
  }
  space_id: string
}

interface SetLayoutSequenceFailure {
  success: false
  error: string
  space_id: string
}

type SetLayoutSequenceOutput = SetLayoutSequenceSuccess | SetLayoutSequenceFailure

/**
 * set_layout_sequence - Layout Orchestration Tool
 *
 * Orchestrates a timed sequence of layout changes for progressive disclosure patterns,
 * guided tours, multi-step workflows, or automated demonstrations.
 *
 * How it works:
 * 1. Server validates the sequence steps and parameters
 * 2. Returns success payload with sequence metadata
 * 3. Client-side PortalExperienceStore receives the sequence
 * 4. Store executes each step with configured timing
 * 5. Transitions between steps use specified animation styles
 * 6. Sequence can loop or complete with optional callback
 *
 * Use Cases:
 * - Guided tours: Walk users through features step-by-step
 * - Progressive disclosure: Reveal complexity gradually
 * - Automated demos: Showcase functionality without interaction
 * - Multi-step workflows: Guide users through complex processes
 * - Presentation mode: Auto-advance through content sections
 *
 * Example Sequences:
 * - Onboarding: standard → sidebar-focus → split → dashboard
 * - Deep dive: dashboard → master-detail → three-column → fullscreen
 * - Focus sequence: standard → sidebar-focus → fullscreen → standard (loop)
 * - Comparison: split (equal) → split (detailed) → master-detail
 */
export default async function setLayoutSequenceTool(
  input: SetLayoutSequenceInput,
  ctx: ToolContext
): Promise<SetLayoutSequenceOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required steps array
    if (!params.steps || !Array.isArray(params.steps)) {
      throw new Error('steps is required and must be an array')
    }

    if (params.steps.length === 0) {
      throw new Error('steps array must contain at least one step')
    }

    const validModes: LayoutMode[] = [
      'standard',
      'split',
      'sidebar-focus',
      'fullscreen',
      'dashboard',
      'master-detail',
      'app-shell',
      'three-column',
      'board',
      'feed',
      'tabs',
      'accordion'
    ]

    const validTransitions: TransitionStyle[] = ['instant', 'subtle', 'normal', 'dramatic']

    // Validate each step
    const steps: SequenceStep[] = []
    let totalDuration = 0

    for (let i = 0; i < params.steps.length; i++) {
      const step = params.steps[i]

      if (typeof step !== 'object' || Array.isArray(step)) {
        throw new Error(`Step ${i}: must be an object`)
      }

      // Validate mode
      if (!step.mode || !validModes.includes(step.mode)) {
        throw new Error(`Step ${i}: invalid or missing mode. Must be one of: ${validModes.join(', ')}`)
      }

      // Validate duration
      let duration = 3000 // Default 3 seconds
      if (step.duration !== undefined) {
        const d = typeof step.duration === 'string' ? parseFloat(step.duration) : step.duration
        if (typeof d !== 'number' || isNaN(d) || d < 0) {
          throw new Error(`Step ${i}: duration must be a non-negative number`)
        }
        duration = d
      }
      totalDuration += duration

      // Validate optional slots
      let slots: SlotsConfig | undefined
      if (step.slots !== undefined) {
        if (typeof step.slots !== 'object' || Array.isArray(step.slots)) {
          throw new Error(`Step ${i}: slots must be an object`)
        }

        const validSlots = ['sidebar', 'top', 'primary', 'secondary']
        for (const key of Object.keys(step.slots)) {
          if (!validSlots.includes(key)) {
            throw new Error(`Step ${i}: invalid slot key: "${key}". Must be one of: ${validSlots.join(', ')}`)
          }

          const slotConfig = step.slots[key]
          if (typeof slotConfig !== 'object' || Array.isArray(slotConfig)) {
            throw new Error(`Step ${i}: slots.${key} must be an object`)
          }

          if (slotConfig.visible !== undefined && typeof slotConfig.visible !== 'boolean') {
            throw new Error(`Step ${i}: slots.${key}.visible must be a boolean`)
          }

          if (
            key === 'sidebar' &&
            slotConfig.collapsed !== undefined &&
            typeof slotConfig.collapsed !== 'boolean'
          ) {
            throw new Error(`Step ${i}: slots.sidebar.collapsed must be a boolean`)
          }
        }

        slots = step.slots as SlotsConfig
      }

      // Validate optional transition
      let transition: TransitionStyle = 'normal'
      if (step.transition !== undefined) {
        if (!validTransitions.includes(step.transition)) {
          throw new Error(
            `Step ${i}: invalid transition. Must be one of: ${validTransitions.join(', ')}`
          )
        }
        transition = step.transition
      }

      steps.push({
        mode: step.mode as LayoutMode,
        duration,
        ...(slots && { slots }),
        transition
      })
    }

    // Validate optional loop
    const loop = params.loop === true

    // Validate optional onComplete
    let onComplete: string | undefined
    if (params.onComplete !== undefined) {
      if (typeof params.onComplete !== 'string') {
        throw new Error('onComplete must be a string')
      }
      onComplete = params.onComplete.trim()
      if (onComplete.length === 0) {
        throw new Error('onComplete cannot be empty')
      }
    }

    // Generate unique sequence ID
    const sequenceId = `seq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    // Log sequence creation
    console.log('[set_layout_sequence]', {
      sequenceId,
      steps: steps.length,
      totalDuration,
      loop,
      hasOnComplete: !!onComplete,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    // Return success with sequence metadata
    // The client-side store will handle execution
    return {
      success: true,
      sequence: {
        steps: steps.length,
        totalDuration,
        loop,
        sequenceId
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
