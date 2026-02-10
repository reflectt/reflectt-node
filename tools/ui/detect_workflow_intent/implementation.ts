import { formatError, now } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { intentDetector } from '@/lib/ui-control/intent-detector'
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
 * Detect Workflow Intent Input
 */
interface DetectWorkflowIntentInput {
  analyzeCurrentSession?: boolean // Analyze current user behavior
  behavior?: {
    // Manual behavior data if not analyzing current session
    queriesRun?: number
    filtersApplied?: number
    chartInteractions?: number
    tableInteractions?: number
    formInteractions?: number
    componentsUsed?: string[]
    focusTime?: Record<string, number>
  }
  suggestLayout?: boolean // Include layout suggestion
  autoApply?: boolean // Auto-apply suggested layout if confidence > 0.9
}

/**
 * Detect Workflow Intent Tool
 *
 * Automatically detects user's workflow intent from behavior patterns
 * and suggests optimal layouts accordingly.
 */
export async function detect_workflow_intent(
  input: DetectWorkflowIntentInput,
  context: ToolContext
): Promise<any> {
  try {
    const spaceId = 'default' // context.requestContext.spaceId not available

    const analyzeCurrentSession = input.analyzeCurrentSession ?? true
    const suggestLayout = input.suggestLayout ?? true
    const autoApply = input.autoApply ?? false

    let detectedIntent

    if (analyzeCurrentSession) {
      // Start monitoring if not already active
      if (!intentDetector.getCurrentIntent()) {
        intentDetector.startMonitoring()

        // Simulate some behavior data from current layout state
        const layoutStore = useLayoutStore.getState()
        const slots = layoutStore.slots

        // Record behavior based on current state
        const componentCount = [
          ...(slots.primary.modules || []),
          ...(slots.secondary.modules || []),
          ...(slots.sidebar.modules || [])
        ].length

        if (componentCount > 0) {
          const components = [
            ...(slots.primary.modules || []),
            ...(slots.secondary.modules || []),
            ...(slots.sidebar.modules || [])
          ]

          components.forEach(module => {
            intentDetector.recordBehaviorEvent({
              type: 'interaction',
              details: {
                component: module.componentId,
                type: 'view'
              }
            })
          })
        }
      }

      // Detect intent from current behavior
      detectedIntent = intentDetector.detectIntent()
    } else if (input.behavior) {
      // Use provided behavior data
      const behaviorData = {
        pagesVisited: [],
        navigationSequence: [],
        backtrackCount: 0,
        componentsUsed: input.behavior.componentsUsed || [],
        interactionTypes: ['view'],
        focusTime: input.behavior.focusTime || {},
        queriesRun: input.behavior.queriesRun || 0,
        filtersApplied: input.behavior.filtersApplied || 0,
        exportsPerformed: 0,
        searchesPerformed: 0,
        sessionDuration: 0,
        interactionFrequency: 0,
        pauseDuration: 0,
        avgTimePerAction: 0,
        dataViewed: [],
        dataMutated: [],
        chartInteractions: input.behavior.chartInteractions || 0,
        tableInteractions: input.behavior.tableInteractions || 0,
        formInteractions: input.behavior.formInteractions || 0,
        scrollEvents: 0,
        tabSwitches: 0,
        windowResizes: 0
      }

      detectedIntent = intentDetector.detectIntent(behaviorData)
    } else {
      return {
        success: false,
        error: 'Must either analyze current session or provide behavior data',
        space_id: spaceId,
        timestamp: now()
      }
    }

    // Apply layout if requested and confidence is high
    if (autoApply && suggestLayout && detectedIntent.confidence >= 0.9) {
      const layoutStore = useLayoutStore.getState()
      layoutStore.actions.setLayoutMode(detectedIntent.suggestedLayout, { animate: true })

      // Show annotation
      layoutStore.actions.showAnnotation({
        id: `intent-layout-${Date.now()}`,
        target: { type: 'screen' },
        message: `Detected ${detectedIntent.intent} workflow - switched to ${detectedIntent.suggestedLayout} layout`,
        severity: 'info',
        duration: 5000,
        position: 'top-right',
        animate: true,
        dismissable: true,
        timestamp: new Date().toISOString()
      })

      return {
        success: true,
        intent: detectedIntent.intent,
        confidence: detectedIntent.confidence,
        reasoning: detectedIntent.reasoning,
        suggestedLayout: detectedIntent.suggestedLayout,
        layoutApplied: true,
        estimatedDuration: detectedIntent.estimatedDuration,
        subIntents: detectedIntent.subIntents,
        space_id: spaceId,
        timestamp: now()
      }
    }

    // Return detected intent
    return {
      success: true,
      intent: detectedIntent.intent,
      confidence: detectedIntent.confidence,
      reasoning: detectedIntent.reasoning,
      suggestedLayout: suggestLayout ? detectedIntent.suggestedLayout : undefined,
      suggestedComponents: detectedIntent.suggestedComponents,
      estimatedDuration: detectedIntent.estimatedDuration,
      subIntents: detectedIntent.subIntents,
      layoutApplied: false,
      space_id: spaceId,
      timestamp: now()
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      space_id: 'default', // context.requestContext.spaceId not available
      timestamp: now()
    }
  }
}
