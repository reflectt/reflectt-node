import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { layoutAnalyzer, UserIntent, IntentContext } from '@/lib/ui-control/layout-analyzer'
import type { LayoutMode } from '@/lib/ui-control/layout-store'

interface SetLayoutByIntentInput {
  intent: UserIntent
  context?: {
    dataVolume?: 'small' | 'medium' | 'large'
    timeConstraint?: 'quick' | 'detailed'
    userRole?: 'viewer' | 'editor' | 'admin'
  }
  animate?: boolean
}

interface SetLayoutByIntentSuccess {
  success: true
  layout_update: {
    mode: LayoutMode
    animate: boolean
    timestamp: string
  }
  intent_analysis: {
    intent: UserIntent
    selectedMode: LayoutMode
    reasoning: string[]
    confidence: number
    alternatives?: Array<{
      mode: LayoutMode
      reasoning: string[]
      confidence: number
    }>
  }
  space_id: string
}

interface SetLayoutByIntentFailure {
  success: false
  error: string
  space_id: string
}

type SetLayoutByIntentOutput = SetLayoutByIntentSuccess | SetLayoutByIntentFailure

/**
 * Detect device type based on viewport width
 */
function detectDeviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop'

  const width = window.innerWidth
  if (width < 768) return 'mobile'
  if (width < 1024) return 'tablet'
  return 'desktop'
}

/**
 * Get all component types from current layout state
 * This would be implemented to query the actual layout store
 */
function getAllComponentTypes(): string[] {
  // In a real implementation, this would query the layout store
  // For now, return empty array - the tool will work without component info
  return []
}

/**
 * Count components in current layout
 */
function countComponents(): number {
  const components = getAllComponentTypes()
  return components.length || 1 // Default to 1 if unknown
}

/**
 * Estimate data volume based on component types and context
 */
function estimateDataVolume(explicitVolume?: 'small' | 'medium' | 'large'): 'small' | 'medium' | 'large' {
  if (explicitVolume) return explicitVolume

  // Default heuristic
  const componentCount = countComponents()
  if (componentCount <= 2) return 'small'
  if (componentCount <= 5) return 'medium'
  return 'large'
}

/**
 * set_layout_by_intent - Streaming UI Tool
 *
 * Sets layout based on user intent rather than explicit mode selection.
 * The system intelligently analyzes the intent and context to choose
 * the optimal layout mode automatically.
 *
 * Intent Types:
 * - analyze: Deep dive into data (split or dashboard)
 * - compare: Side-by-side comparison (split)
 * - explore: Browse and discover (master-detail, dashboard, or feed)
 * - focus: Concentrate on single item (fullscreen)
 * - present: Show to others (fullscreen or dashboard)
 * - edit: Modify content (split or three-column)
 * - monitor: Watch live updates (dashboard or feed)
 * - collaborate: Work with others (board or dashboard)
 *
 * The tool considers:
 * - Component count and types
 * - Data volume (small/medium/large)
 * - Device type (mobile/tablet/desktop)
 * - User role (viewer/editor/admin)
 * - Time constraint (quick/detailed)
 *
 * Returns the selected layout mode with reasoning and confidence score,
 * plus alternative options if applicable.
 */
export default async function setLayoutByIntentTool(
  input: SetLayoutByIntentInput,
  ctx: ToolContext
): Promise<SetLayoutByIntentOutput> {
  try {
    // Validate input
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected an object')
    }

    const params = input as Record<string, any>

    // Validate required intent
    const validIntents: UserIntent[] = [
      'analyze', 'compare', 'explore', 'focus',
      'present', 'edit', 'monitor', 'collaborate'
    ]
    if (!params.intent || !validIntents.includes(params.intent)) {
      throw new Error(`Invalid or missing intent. Must be one of: ${validIntents.join(', ')}`)
    }
    const intent = params.intent as UserIntent

    // Parse optional context
    let contextInput = params.context || {}
    if (typeof contextInput === 'string') {
      try {
        contextInput = JSON.parse(contextInput)
      } catch {
        throw new Error('context must be a valid JSON object or object')
      }
    }

    // Validate context fields if provided
    if (contextInput.dataVolume && !['small', 'medium', 'large'].includes(contextInput.dataVolume)) {
      throw new Error('context.dataVolume must be one of: small, medium, large')
    }
    if (contextInput.timeConstraint && !['quick', 'detailed'].includes(contextInput.timeConstraint)) {
      throw new Error('context.timeConstraint must be one of: quick, detailed')
    }
    if (contextInput.userRole && !['viewer', 'editor', 'admin'].includes(contextInput.userRole)) {
      throw new Error('context.userRole must be one of: viewer, editor, admin')
    }

    // Build full context for analysis
    const fullContext: IntentContext = {
      componentTypes: getAllComponentTypes(),
      componentCount: countComponents(),
      dataVolume: estimateDataVolume(contextInput.dataVolume),
      deviceType: detectDeviceType(),
      userRole: contextInput.userRole,
      timeConstraint: contextInput.timeConstraint
    }

    // Get layout recommendation from analyzer
    const recommendation = layoutAnalyzer.selectLayoutByIntent(intent, fullContext)

    // Validate optional animate
    const animate = params.animate === false || params.animate === 'false' ? false : true

    // Log intent-based layout selection
    console.log('[set_layout_by_intent]', {
      intent,
      context: fullContext,
      selectedMode: recommendation.recommendedMode,
      confidence: recommendation.confidence,
      reasoning: recommendation.reasoning,
      spaceId: ctx.currentSpace,
      timestamp: now()
    })

    return {
      success: true,
      layout_update: {
        mode: recommendation.recommendedMode,
        animate,
        timestamp: now()
      },
      intent_analysis: {
        intent: recommendation.intent,
        selectedMode: recommendation.recommendedMode,
        reasoning: recommendation.reasoning,
        confidence: recommendation.confidence,
        alternatives: recommendation.alternatives
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
