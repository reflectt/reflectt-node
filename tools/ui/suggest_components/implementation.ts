import { formatError } from '@/lib/tools/helpers'
import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  COMPONENT_COMPLEMENTARY_MAP,
  type ComponentSuggestion,
  getSynergyPatternsForComponent,
  type SynergyPattern
} from '@/lib/components/component-suggestions'
import { layoutAnalyzer } from '@/lib/ui-control/layout-analyzer'
import { COMPONENT_INDEX } from '@/lib/components/component-index'

interface SuggestComponentsInput {
  currentComponentId: string
  context?: {
    dataType?: string
    userIntent?: string
  }
  maxSuggestions?: number
}

interface EnhancedSuggestion extends ComponentSuggestion {
  componentName: string
  recommendedLayout?: string
  usage: string
  synergyPatterns?: string[]
}

interface SuggestComponentsSuccess {
  success: true
  currentComponent: string
  currentComponentName: string
  suggestions: EnhancedSuggestion[]
  totalFound: number
  synergyPatterns?: Array<{
    id: string
    name: string
    description: string
    components: string[]
  }>
}

interface SuggestComponentsFailure {
  success: false
  error: string
  suggestion?: string
  availableComponents?: string[]
}

type SuggestComponentsOutput = SuggestComponentsSuccess | SuggestComponentsFailure

/**
 * Suggest complementary components based on current component
 */
export default async function suggestComponents(
  input: SuggestComponentsInput,
  ctx: ToolContext
): Promise<SuggestComponentsOutput> {
  try {
    const { currentComponentId, context, maxSuggestions = 5 } = input

    // Verify the component exists
    const currentEntry = COMPONENT_INDEX[currentComponentId]
    if (!currentEntry) {
      const allComponents = Object.keys(COMPONENT_INDEX).slice(0, 20)
      return {
        success: false,
        error: `Component '${currentComponentId}' not found`,
        suggestion: 'Use inspect_component_state to see currently rendered components, or check the component registry.',
        availableComponents: allComponents
      }
    }

    // Get suggestions from the complementary map
    const suggestions = COMPONENT_COMPLEMENTARY_MAP[currentComponentId] || []

    if (suggestions.length === 0) {
      return {
        success: true,
        currentComponent: currentComponentId,
        currentComponentName: currentEntry.name,
        suggestions: [],
        totalFound: 0
      }
    }

    // Sort by priority (highest first)
    const sorted = [...suggestions].sort((a, b) => b.priority - a.priority)

    // Take top N
    const topSuggestions = sorted.slice(0, maxSuggestions)

    // Enhance suggestions with additional information
    const enhanced: EnhancedSuggestion[] = topSuggestions.map(suggestion => {
      const componentEntry = COMPONENT_INDEX[suggestion.componentId]
      const componentName = componentEntry ? componentEntry.name : suggestion.componentId

      // Get layout recommendation
      const layoutRec = layoutAnalyzer.recommendLayout({
        componentTypes: [currentComponentId, suggestion.componentId],
        componentCount: 2,
        viewportWidth: 1920,
        viewportHeight: 1080
      })

      // Find synergy patterns that include both components
      const synergyPatterns = getSynergyPatternsForComponent(currentComponentId)
        .filter(pattern => pattern.components.includes(suggestion.componentId))
        .map(pattern => pattern.id)

      // Build usage example
      const propsJson = suggestion.props ? JSON.stringify(suggestion.props, null, 2) : '{}'
      const usage = `Use render_manifest with:\n{\n  "componentId": "${suggestion.componentId}",\n  "slot": "${suggestion.slot}",\n  "props": ${propsJson}\n}`

      return {
        ...suggestion,
        componentName,
        recommendedLayout: layoutRec[0]?.mode || 'split',
        usage,
        synergyPatterns: synergyPatterns.length > 0 ? synergyPatterns : undefined
      }
    })

    // Get synergy patterns for additional context
    const allSynergyPatterns = getSynergyPatternsForComponent(currentComponentId)
    const synergyInfo = allSynergyPatterns.map(pattern => ({
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      components: pattern.components
    }))

    return {
      success: true,
      currentComponent: currentComponentId,
      currentComponentName: currentEntry.name,
      suggestions: enhanced,
      totalFound: suggestions.length,
      synergyPatterns: synergyInfo.length > 0 ? synergyInfo : undefined
    }
  } catch (error) {
    return {
      success: false,
      error: formatError(error),
      suggestion: 'Verify the component ID is valid and try again.'
    }
  }
}
