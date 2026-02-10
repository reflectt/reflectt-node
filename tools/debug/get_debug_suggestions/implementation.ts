/**
 * Get Debug Suggestions Tool
 * Generate smart debugging recommendations
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  generateDebugSuggestions,
  saveDebugSuggestions,
} from '@/lib/debugging'

interface GetDebugSuggestionsInput {
  user_id: string
  days?: number
  focus?: 'errors' | 'performance' | 'cost' | 'all'
}

interface GetDebugSuggestionsOutput {
  success: boolean
  suggestions: any[]
  summary: string
  error?: string
}

export default async function getDebugSuggestions(
  input: GetDebugSuggestionsInput,
  context: ToolContext
): Promise<GetDebugSuggestionsOutput> {
  try {
    // Generate suggestions
    const suggestions = await generateDebugSuggestions(
      input.user_id,
      {
        days: input.days || 7,
        focus: input.focus || 'all',
      },
      context
    )

    // Save suggestions
    await saveDebugSuggestions(input.user_id, suggestions, context)

    // Generate summary
    const summary = generateSummary(suggestions)

    return {
      success: true,
      suggestions,
      summary,
    }
  } catch (error: any) {
    return {
      success: false,
      suggestions: [],
      summary: '',
      error: `Failed to generate debug suggestions: ${error.message}`,
    }
  }
}

function generateSummary(suggestions: any[]): string {
  if (suggestions.length === 0) {
    return 'No issues detected. System is running smoothly.'
  }

  const high = suggestions.filter(s => s.severity === 'high').length
  const medium = suggestions.filter(s => s.severity === 'medium').length
  const low = suggestions.filter(s => s.severity === 'low').length

  let summary = `Found ${suggestions.length} suggestion(s): `
  const parts: string[] = []

  if (high > 0) parts.push(`${high} high priority`)
  if (medium > 0) parts.push(`${medium} medium priority`)
  if (low > 0) parts.push(`${low} low priority`)

  summary += parts.join(', ')
  summary += '. Review suggestions for details.'

  return summary
}
