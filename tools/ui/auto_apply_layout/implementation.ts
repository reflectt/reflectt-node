import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { layoutContextScorer } from '@/lib/ui-control/layout-context-scorer'
import { layoutLearning } from '@/lib/ui-control/layout-learning'
import { layoutAutoDetector } from '@/lib/ui-control/layout-auto-detection'
import { useLayoutStore } from '@/lib/ui-control/layout-store'

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

/**
 * Auto-Apply Layout Input
 */
interface AutoApplyLayoutInput {
  strategy: 'auto' | 'suggestion' | 'force'

  // Context hints (optional - will auto-detect if not provided)
  context?: {
    userRole?: string
    taskType?: string
    deviceType?: 'mobile' | 'tablet' | 'desktop'
    componentCount?: number
    dataVolume?: 'low' | 'medium' | 'high'
  }

  // Constraints
  confidenceThreshold?: number // Default: 0.8 (0-1)
  respectUserPreference?: boolean // Default: true
  allowAutoSwitch?: boolean // Default: false (needs user consent)

  // Options
  provideReasoning?: boolean // Default: true
  showAnnotation?: boolean // Default: true if strategy === 'suggestion'
  animateTransition?: boolean // Default: true

  // Fallback
  fallbackLayout?: LayoutMode // If auto-detection fails
}

/**
 * Auto-Apply Layout Output
 */
interface AutoApplyLayoutOutput {
  success: boolean
  action: 'applied' | 'suggested' | 'no_change' | 'error'
  previousLayout: LayoutMode
  newLayout?: LayoutMode
  confidence: number
  reasoning: string[]
  analysis: {
    context: {
      userRole?: string
      taskType?: string
      deviceType: string
      componentCount: number
      dataVolume: string
      timeOfDay: string
    }
    scores: Record<LayoutMode, number>
    recommendation: LayoutMode
    alternativeRecommendations: Array<{
      layout: LayoutMode
      score: number
      reasoning: string[]
    }>
  }
  userConsentNeeded?: boolean
  timestamp: string
  space_id: string
}

/**
 * Auto-Apply Layout Tool Implementation
 *
 * Automatically selects and applies optimal layout based on comprehensive analysis
 * of context, content, user behavior, and learned preferences.
 *
 * Strategies:
 * - auto: Analyze context, apply best layout if confidence > threshold
 * - suggestion: Show annotation with suggestion, don't auto-apply
 * - force: Apply specified fallbackLayout regardless of analysis
 */
export async function auto_apply_layout(
  input: AutoApplyLayoutInput,
  context: ToolContext
): Promise<AutoApplyLayoutOutput> {
  try {
    // NOTE: requestContext is not available in current ToolContext
    // Using default space ID
    const spaceId = 'default' // context.requestContext.spaceId

    // Get layout store
    const layoutStore = useLayoutStore.getState()
    const previousLayout = layoutStore.mode

    // Set defaults
    const confidenceThreshold = input.confidenceThreshold ?? 0.8
    const respectUserPreference = input.respectUserPreference ?? true
    const allowAutoSwitch = input.allowAutoSwitch ?? false
    const provideReasoning = input.provideReasoning ?? true
    const showAnnotation = input.showAnnotation ?? (input.strategy === 'suggestion')
    const animateTransition = input.animateTransition ?? true

    // Strategy: Force
    if (input.strategy === 'force' && input.fallbackLayout) {
      layoutStore.actions.setLayoutMode(input.fallbackLayout, { animate: animateTransition })

      return {
        success: true,
        action: 'applied',
        previousLayout,
        newLayout: input.fallbackLayout,
        confidence: 1.0,
        reasoning: ['Layout forced by explicit request'],
        analysis: {
          context: {
            deviceType: 'desktop',
            componentCount: 0,
            dataVolume: 'low',
            timeOfDay: 'unknown'
          },
          scores: { standard: 0, split: 0, 'sidebar-focus': 0, fullscreen: 0, dashboard: 0, 'master-detail': 0, 'app-shell': 0, 'three-column': 0, board: 0, feed: 0, tabs: 0, accordion: 0 },
          recommendation: input.fallbackLayout,
          alternativeRecommendations: []
        },
        timestamp: now(),
        space_id: spaceId
      }
    }

    // Step 1: Detect or use provided context
    const detectedContext = layoutContextScorer.identifyUserContext()
    const contentMetrics = layoutAutoDetector.analyzeContent(layoutStore.slots)

    const fullContext = {
      ...detectedContext,
      ...input.context,
      componentCount: input.context?.componentCount ?? contentMetrics.totalModules,
      dataVolume: input.context?.dataVolume ?? (
        contentMetrics.totalModules > 5 ? 'high' :
        contentMetrics.totalModules > 2 ? 'medium' : 'low'
      )
    }

    // Step 2: Get learned preferences
    const learnedPreferences = layoutLearning.predictPreference(fullContext)

    // Step 3: Score all layouts
    const layoutModes: LayoutMode[] = [
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

    const scores: Record<string, number> = {}
    const reasoningMap: Record<string, string[]> = {}

    layoutModes.forEach(layout => {
      const scoreResult = layoutContextScorer.scoreLayout(layout, fullContext)
      scores[layout] = scoreResult.overall
      reasoningMap[layout] = [
        scoreResult.recommendation,
        `Content fit: ${Math.round(scoreResult.breakdown.contentFit)}`,
        `User fit: ${Math.round(scoreResult.breakdown.userFit)}`,
        `Task fit: ${Math.round(scoreResult.breakdown.taskFit)}`,
        `Device fit: ${Math.round(scoreResult.breakdown.deviceFit)}`
      ]
    })

    // Boost learned preferences
    if (respectUserPreference && learnedPreferences.length > 0) {
      learnedPreferences.forEach((layout, index) => {
        const boost = (learnedPreferences.length - index) * 5
        scores[layout] = (scores[layout] || 0) + boost
      })
    }

    // Find top recommendation
    const sortedLayouts = Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .map(([layout]) => layout as LayoutMode)

    const recommendedLayout = sortedLayouts[0]
    const recommendedScore = scores[recommendedLayout]
    const confidence = Math.min(recommendedScore / 100, 1.0)

    // Get alternative recommendations
    const alternatives = sortedLayouts.slice(1, 4).map(layout => ({
      layout,
      score: scores[layout],
      reasoning: reasoningMap[layout]
    }))

    // Strategy: Auto
    if (input.strategy === 'auto') {
      if (confidence >= confidenceThreshold) {
        if (allowAutoSwitch || previousLayout === recommendedLayout) {
          // Apply the recommended layout
          layoutStore.actions.setLayoutMode(recommendedLayout, { animate: animateTransition })

          // Show annotation if requested
          if (showAnnotation) {
            layoutStore.actions.showAnnotation({
              id: `auto-layout-${Date.now()}`,
              target: { type: 'screen' },
              message: provideReasoning
                ? `Auto-applied ${recommendedLayout}: ${reasoningMap[recommendedLayout][0]}`
                : `Switched to ${recommendedLayout} layout`,
              severity: 'info',
              duration: 5000,
              position: 'top-right',
              animate: true,
              dismissable: true,
              timestamp: new Date().toISOString()
            })
          }

          return {
            success: true,
            action: 'applied',
            previousLayout,
            newLayout: recommendedLayout,
            confidence,
            reasoning: provideReasoning ? reasoningMap[recommendedLayout] : [],
            analysis: {
              context: fullContext as any,
              scores,
              recommendation: recommendedLayout,
              alternativeRecommendations: alternatives
            },
            timestamp: now(),
            space_id: spaceId
          }
        } else {
          // User consent needed
          if (showAnnotation) {
            layoutStore.actions.showAnnotation({
              id: `auto-layout-consent-${Date.now()}`,
              target: { type: 'screen' },
              message: `Suggested: ${recommendedLayout} layout (confidence: ${Math.round(confidence * 100)}%)`,
              icon: '💡',
              severity: 'insight',
              duration: 10000,
              position: 'top-right',
              animate: true,
              dismissable: true,
              timestamp: new Date().toISOString()
            })
          }

          return {
            success: true,
            action: 'suggested',
            previousLayout,
            newLayout: recommendedLayout,
            confidence,
            reasoning: provideReasoning ? reasoningMap[recommendedLayout] : [],
            analysis: {
              context: fullContext as any,
              scores,
              recommendation: recommendedLayout,
              alternativeRecommendations: alternatives
            },
            userConsentNeeded: true,
            timestamp: now(),
            space_id: spaceId
          }
        }
      } else {
        // Confidence too low
        if (showAnnotation) {
          layoutStore.actions.showAnnotation({
            id: `auto-layout-low-conf-${Date.now()}`,
            target: { type: 'screen' },
            message: `Current layout seems optimal (confidence: ${Math.round(confidence * 100)}%)`,
            severity: 'info',
            duration: 3000,
            position: 'top-right',
            animate: true,
            dismissable: true,
            timestamp: new Date().toISOString()
          })
        }

        return {
          success: true,
          action: 'no_change',
          previousLayout,
          confidence,
          reasoning: provideReasoning ? [`Confidence (${Math.round(confidence * 100)}%) below threshold (${Math.round(confidenceThreshold * 100)}%)`] : [],
          analysis: {
            context: fullContext as any,
            scores,
            recommendation: recommendedLayout,
            alternativeRecommendations: alternatives
          },
          timestamp: now(),
          space_id: spaceId
        }
      }
    }

    // Strategy: Suggestion
    if (input.strategy === 'suggestion') {
      if (showAnnotation) {
        const message = provideReasoning
          ? `Suggestion: ${recommendedLayout} layout - ${reasoningMap[recommendedLayout][0]}`
          : `Try ${recommendedLayout} layout (${Math.round(confidence * 100)}% confidence)`

        layoutStore.actions.showAnnotation({
          id: `layout-suggestion-${Date.now()}`,
          target: { type: 'screen' },
          message,
          icon: '💡',
          severity: 'insight',
          duration: 8000,
          position: 'top-right',
          animate: true,
          dismissable: true,
          timestamp: new Date().toISOString()
        })
      }

      return {
        success: true,
        action: 'suggested',
        previousLayout,
        newLayout: recommendedLayout,
        confidence,
        reasoning: provideReasoning ? reasoningMap[recommendedLayout] : [],
        analysis: {
          context: fullContext as any,
          scores,
          recommendation: recommendedLayout,
          alternativeRecommendations: alternatives
        },
        timestamp: now(),
        space_id: spaceId
      }
    }

    // Fallback
    return {
      success: false,
      action: 'error',
      previousLayout,
      confidence: 0,
      reasoning: ['Invalid strategy'],
      analysis: {
        context: fullContext as any,
        scores: { standard: 0, split: 0, 'sidebar-focus': 0, fullscreen: 0, dashboard: 0, 'master-detail': 0, 'app-shell': 0, 'three-column': 0, board: 0, feed: 0, tabs: 0, accordion: 0 },
        recommendation: 'standard',
        alternativeRecommendations: []
      },
      timestamp: now(),
      space_id: spaceId
    }
  } catch (error) {
    return {
      success: false,
      action: 'error',
      previousLayout: 'standard',
      confidence: 0,
      reasoning: [formatError(error)],
      analysis: {
        context: {
          deviceType: 'desktop',
          componentCount: 0,
          dataVolume: 'low',
          timeOfDay: 'unknown'
        },
        scores: { standard: 0, split: 0, 'sidebar-focus': 0, fullscreen: 0, dashboard: 0, 'master-detail': 0, 'app-shell': 0, 'three-column': 0, board: 0, feed: 0, tabs: 0, accordion: 0 },
        recommendation: 'standard',
        alternativeRecommendations: []
      },
      timestamp: now(),
      space_id: 'default' // context.requestContext.spaceId not available
    }
  }
}
