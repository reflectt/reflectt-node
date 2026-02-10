/**
 * Get Repair Suggestions Tool Implementation
 *
 * Analyzes component errors and provides intelligent repair suggestions.
 * Can optionally attempt automatic fixes for common issues.
 */

import {
  errorRecovery,
  type ComponentError,
  type RepairSuggestion,
} from '@/lib/intelligence/error-recovery'

interface GetRepairSuggestionsInput {
  componentId: string
  errorMessage: string
  errorType?: 'render' | 'props' | 'data' | 'interaction' | 'performance'
  includeContext?: boolean
  autoFix?: boolean
  maxSuggestions?: number
}

interface RepairSuggestionsResult {
  success: boolean
  suggestions?: RepairSuggestion[]
  autoFixAttempted?: boolean
  autoFixResult?: {
    success: boolean
    error?: string
    appliedFix?: string
  }
  errorAnalysis?: {
    errorType: string
    severity: string
    affectedComponent: string
    timestamp: number
  }
  context?: {
    componentType?: string
    hasProps: boolean
    hasState: boolean
    recentErrors: number
  }
  error?: string
}

/**
 * Get component type from DOM
 */
function getComponentType(componentId: string): string | undefined {
  const element = document.querySelector(`[data-module-id="${componentId}"]`)
  if (!element) return undefined

  return (
    element.getAttribute('data-component-type') ||
    element.getAttribute('data-type') ||
    'unknown'
  )
}

/**
 * Get component context from DOM
 */
function getComponentContext(componentId: string): {
  props?: any
  state?: any
  exists: boolean
} {
  const element = document.querySelector(`[data-module-id="${componentId}"]`)

  if (!element) {
    return { exists: false }
  }

  // Try to extract props/state from data attributes
  const propsAttr = element.getAttribute('data-props')
  const stateAttr = element.getAttribute('data-state')

  const context: any = { exists: true }

  if (propsAttr) {
    try {
      context.props = JSON.parse(propsAttr)
    } catch (e) {
      // Invalid JSON, skip
    }
  }

  if (stateAttr) {
    try {
      context.state = JSON.parse(stateAttr)
    } catch (e) {
      // Invalid JSON, skip
    }
  }

  return context
}

/**
 * Determine error severity based on type and message
 */
function determineErrorSeverity(
  errorType: string,
  errorMessage: string
): 'critical' | 'high' | 'medium' | 'low' {
  // Critical errors
  if (
    errorMessage.toLowerCase().includes('crash') ||
    errorMessage.toLowerCase().includes('fatal') ||
    errorType === 'render' && errorMessage.toLowerCase().includes('failed')
  ) {
    return 'critical'
  }

  // High severity
  if (
    errorType === 'render' ||
    errorType === 'props' ||
    errorMessage.toLowerCase().includes('required')
  ) {
    return 'high'
  }

  // Medium severity
  if (errorType === 'data' || errorType === 'interaction') {
    return 'medium'
  }

  // Low severity
  return 'low'
}

/**
 * Format suggestion for output
 */
function formatSuggestion(suggestion: RepairSuggestion): any {
  return {
    id: suggestion.id,
    severity: suggestion.severity,
    description: suggestion.description,
    autoFixable: suggestion.autoFixable,
    confidence: `${suggestion.confidence}%`,
    reasoning: suggestion.reasoning,
    ...(suggestion.autoFixable && suggestion.fix
      ? {
          autoFix: {
            action: suggestion.fix.action,
            params: suggestion.fix.params,
          },
        }
      : {}),
    ...(suggestion.manualSteps
      ? { manualSteps: suggestion.manualSteps }
      : {}),
  }
}

/**
 * Get Repair Suggestions Tool
 *
 * Analyzes component errors and provides repair suggestions
 */
export async function get_repair_suggestions(
  input: GetRepairSuggestionsInput
): Promise<RepairSuggestionsResult> {
  try {
    const errorType = input.errorType || 'render'
    const includeContext = input.includeContext ?? true
    const maxSuggestions = input.maxSuggestions || 5

    // Get component context if requested
    let componentContext: any = { exists: true }
    if (includeContext) {
      componentContext = getComponentContext(input.componentId)

      if (!componentContext.exists) {
        return {
          success: false,
          error: `Component not found in DOM: ${input.componentId}. Make sure the component has been rendered.`,
        }
      }
    }

    // Create error object
    const error: ComponentError = {
      componentId: input.componentId,
      componentType: getComponentType(input.componentId) || 'unknown',
      errorType,
      errorMessage: input.errorMessage,
      context: {
        props: componentContext.props,
        state: componentContext.state,
        timestamp: Date.now(),
      },
    }

    // Get repair suggestions from error recovery system
    const allSuggestions = errorRecovery.diagnoseError(error)

    // Limit suggestions
    const suggestions = allSuggestions.slice(0, maxSuggestions)

    // Prepare result
    const result: RepairSuggestionsResult = {
      success: true,
      suggestions: suggestions.map(formatSuggestion),
      errorAnalysis: {
        errorType,
        severity: determineErrorSeverity(errorType, input.errorMessage),
        affectedComponent: input.componentId,
        timestamp: Date.now(),
      },
      context: {
        componentType: error.componentType,
        hasProps: !!componentContext.props,
        hasState: !!componentContext.state,
        recentErrors: errorRecovery.getErrorHistory(input.componentId).length,
      },
    }

    // Attempt auto-fix if requested
    if (input.autoFix && suggestions.length > 0) {
      const autoFixableSuggestion = suggestions.find((s) => s.autoFixable)

      if (autoFixableSuggestion) {
        result.autoFixAttempted = true

        const fixResult = await errorRecovery.autoFix(
          autoFixableSuggestion,
          input.componentId
        )

        result.autoFixResult = {
          success: fixResult.success,
          error: fixResult.error,
          appliedFix: autoFixableSuggestion.id,
        }
      } else {
        result.autoFixAttempted = false
        result.autoFixResult = {
          success: false,
          error: 'No auto-fixable suggestions available. Manual intervention required.',
        }
      }
    }

    // Add helpful message if no suggestions found
    if (suggestions.length === 0) {
      result.suggestions = [
        {
          id: 'general-debugging',
          severity: 'medium',
          description: 'No specific suggestions for this error',
          autoFixable: false,
          confidence: 50,
          reasoning: [
            'Error pattern not recognized',
            'Manual debugging may be required',
          ],
          manualSteps: [
            'Use inspect_component_state to examine component',
            'Check browser console for additional errors',
            'Review component documentation',
            'Try recreating the component',
          ],
        },
      ]
    }

    return result
  } catch (error) {
    return {
      success: false,
      error: `Failed to get repair suggestions: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Get error history for a component
 */
export function getComponentErrorHistory(
  componentId: string
): ComponentError[] {
  return errorRecovery.getErrorHistory(componentId)
}

/**
 * Get error statistics
 */
export function getErrorStatistics() {
  return errorRecovery.getErrorStatistics()
}

/**
 * Clear error history
 */
export function clearErrorHistory() {
  return errorRecovery.clearErrorHistory()
}
