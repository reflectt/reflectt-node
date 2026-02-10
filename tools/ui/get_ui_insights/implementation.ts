import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { uiInteractionTracker, type InteractionInsights, type UIInteraction } from '@/lib/learning/ui-interaction-tracker'
import { COMPONENT_INDEX } from '@/lib/components/component-index'

interface GetUIInsightsInput {
  includeRecommendations?: boolean
  timeWindow?: 'last_hour' | 'last_day' | 'last_week' | 'all'
  componentType?: string
}

interface Recommendation {
  type: 'optimization' | 'error' | 'usage' | 'satisfaction'
  priority: 'high' | 'medium' | 'low'
  message: string
  actionable: string
  relatedComponents?: string[]
}

interface GetUIInsightsSuccess {
  success: true
  insights: InteractionInsights
  filteredInsights?: {
    componentType: string
    interactions: number
    successRate: number
    errors: number
  }
  recommendations?: Recommendation[]
  timestamp: number
}

interface GetUIInsightsFailure {
  success: false
  error: string
  suggestion?: string
}

type GetUIInsightsOutput = GetUIInsightsSuccess | GetUIInsightsFailure

/**
 * Analyze UI interaction patterns and provide insights
 */
export default async function getUIInsights(
  input: GetUIInsightsInput,
  ctx: ToolContext
): Promise<GetUIInsightsOutput> {
  try {
    const { includeRecommendations = true, timeWindow = 'all', componentType } = input

    // Get insights from tracker
    const insights = uiInteractionTracker.getInsights()

    // Filter by time window if needed
    let filteredInsights: GetUIInsightsSuccess['filteredInsights']
    if (timeWindow !== 'all' || componentType) {
      const rawInteractions = uiInteractionTracker.getRawInteractions()
      const filtered = filterInteractions(rawInteractions, timeWindow, componentType)

      if (componentType) {
        const componentInteractions = filtered.filter(i => i.componentType === componentType)
        const successCount = componentInteractions.filter(i => i.outcome === 'success').length
        const errorCount = componentInteractions.filter(i => i.outcome === 'error').length

        filteredInsights = {
          componentType,
          interactions: componentInteractions.length,
          successRate: componentInteractions.length > 0
            ? successCount / componentInteractions.length
            : 0,
          errors: errorCount
        }
      }
    }

    // Generate recommendations
    const recommendations = includeRecommendations
      ? generateRecommendations(insights, filteredInsights)
      : undefined

    return {
      success: true,
      insights,
      filteredInsights,
      recommendations,
      timestamp: Date.now()
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      suggestion: 'Verify that UI interaction tracking is enabled and try again.'
    }
  }
}

/**
 * Filter interactions by time window and component type
 */
function filterInteractions(
  interactions: UIInteraction[],
  timeWindow: GetUIInsightsInput['timeWindow'],
  componentType?: string
): UIInteraction[] {
  const now = Date.now()
  let cutoff = 0

  switch (timeWindow) {
    case 'last_hour':
      cutoff = now - (60 * 60 * 1000)
      break
    case 'last_day':
      cutoff = now - (24 * 60 * 60 * 1000)
      break
    case 'last_week':
      cutoff = now - (7 * 24 * 60 * 60 * 1000)
      break
    default:
      cutoff = 0
  }

  return interactions.filter(interaction => {
    const afterCutoff = interaction.timestamp >= cutoff
    const matchesType = !componentType || interaction.componentType === componentType
    return afterCutoff && matchesType
  })
}

/**
 * Generate actionable recommendations based on insights
 */
function generateRecommendations(
  insights: InteractionInsights,
  filteredInsights?: GetUIInsightsSuccess['filteredInsights']
): Recommendation[] {
  const recommendations: Recommendation[] = []

  // 1. MOST USED COMPONENT OPTIMIZATION
  if (insights.mostUsed.length > 0) {
    const [topComponent, usageCount] = insights.mostUsed[0]
    const componentInfo = COMPONENT_INDEX[topComponent]

    recommendations.push({
      type: 'usage',
      priority: 'medium',
      message: `Component '${topComponent}' is heavily used (${usageCount} interactions)`,
      actionable: componentInfo
        ? `Consider optimizing ${componentInfo.name} for performance, or pre-loading it for faster interactions.`
        : `Consider optimizing this component for better performance.`,
      relatedComponents: [topComponent]
    })
  }

  // 2. ERROR COMPONENTS
  if (insights.problematicComponents.length > 0) {
    const errorCount = insights.problematicComponents.length
    const topErrors = insights.problematicComponents.slice(0, 3)

    recommendations.push({
      type: 'error',
      priority: 'high',
      message: `${errorCount} component${errorCount > 1 ? 's have' : ' has'} errors`,
      actionable: `Investigate and fix errors in: ${topErrors.join(', ')}. Check browser console and error logs for details.`,
      relatedComponents: topErrors
    })
  }

  // 3. SUCCESS RATE
  if (insights.successRate < 0.9 && insights.totalInteractions > 10) {
    const failureRate = ((1 - insights.successRate) * 100).toFixed(1)

    recommendations.push({
      type: 'error',
      priority: 'high',
      message: `Low success rate: ${(insights.successRate * 100).toFixed(1)}% (${failureRate}% failure rate)`,
      actionable: 'Review error handling across components. Add try-catch blocks, improve validation, and provide better error messages to users.',
      relatedComponents: insights.problematicComponents
    })
  } else if (insights.successRate >= 0.95 && insights.totalInteractions > 10) {
    recommendations.push({
      type: 'optimization',
      priority: 'low',
      message: `Excellent success rate: ${(insights.successRate * 100).toFixed(1)}%`,
      actionable: 'Current implementation is stable. Focus on performance optimization and user experience enhancements.'
    })
  }

  // 4. USER SATISFACTION
  if (insights.averageSatisfaction !== undefined) {
    if (insights.averageSatisfaction < 3) {
      recommendations.push({
        type: 'satisfaction',
        priority: 'high',
        message: `Low user satisfaction: ${insights.averageSatisfaction.toFixed(1)}/5`,
        actionable: 'Survey users to understand pain points. Consider UX improvements, better documentation, or training materials.',
        relatedComponents: insights.mostUsed.slice(0, 3).map(([comp]) => comp)
      })
    } else if (insights.averageSatisfaction >= 4) {
      recommendations.push({
        type: 'satisfaction',
        priority: 'low',
        message: `High user satisfaction: ${insights.averageSatisfaction.toFixed(1)}/5`,
        actionable: 'Users are happy! Maintain current quality and consider sharing best practices across other components.'
      })
    }
  }

  // 5. LOW ACTIVITY WARNING
  if (insights.totalInteractions < 10) {
    recommendations.push({
      type: 'usage',
      priority: 'low',
      message: 'Limited interaction data available',
      actionable: 'Continue monitoring. More interactions needed for meaningful insights (current: ' + insights.totalInteractions + ').'
    })
  }

  // 6. RECENT ACTIVITY PATTERNS
  const { recentPatterns } = insights
  if (recentPatterns.lastDay > 100 && recentPatterns.lastHour < 5) {
    recommendations.push({
      type: 'usage',
      priority: 'low',
      message: 'Activity has decreased recently',
      actionable: 'Normal variation or potential issue? Monitor for trends. Consider if recent changes affected user engagement.'
    })
  }

  // 7. FILTERED INSIGHTS RECOMMENDATIONS
  if (filteredInsights) {
    if (filteredInsights.errors > 0) {
      recommendations.push({
        type: 'error',
        priority: 'high',
        message: `Component '${filteredInsights.componentType}' has ${filteredInsights.errors} error(s)`,
        actionable: `Debug ${filteredInsights.componentType}. Check component props, data validation, and error boundaries.`,
        relatedComponents: [filteredInsights.componentType]
      })
    }

    if (filteredInsights.successRate < 0.8) {
      recommendations.push({
        type: 'error',
        priority: 'high',
        message: `Component '${filteredInsights.componentType}' has low success rate: ${(filteredInsights.successRate * 100).toFixed(1)}%`,
        actionable: 'This component needs attention. Review implementation and add better error handling.',
        relatedComponents: [filteredInsights.componentType]
      })
    }
  }

  // 8. TOP ACTIONS ANALYSIS
  if (insights.topActions.length > 0) {
    const [topAction, actionCount] = insights.topActions[0]
    if (topAction === 'error' || topAction === 'react_error') {
      recommendations.push({
        type: 'error',
        priority: 'high',
        message: `Most common action is '${topAction}' (${actionCount} occurrences)`,
        actionable: 'Errors are happening too frequently. Prioritize fixing error-prone components and improving stability.'
      })
    }
  }

  // Sort recommendations by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return recommendations
}
