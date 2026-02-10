/**
 * Search Errors Tool
 * Find and analyze error patterns
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  searchErrors,
  detectErrorPatterns,
  saveErrorPatterns,
} from '@/lib/debugging'

interface SearchErrorsInput {
  user_id: string
  date_from?: string
  date_to?: string
  agent_slug?: string
  min_occurrences?: number
}

interface SearchErrorsOutput {
  success: boolean
  errors: any[]
  patterns: any[]
  total_errors: number
  unique_patterns: number
  error?: string
}

export default async function searchErrorsTool(
  input: SearchErrorsInput,
  context: ToolContext
): Promise<SearchErrorsOutput> {
  try {
    // Search for errors
    const errors = await searchErrors(
      input.user_id,
      {
        date_from: input.date_from,
        date_to: input.date_to,
        agent_slug: input.agent_slug,
      },
      context
    )

    // Detect patterns
    const allPatterns = detectErrorPatterns(errors)

    // Filter by minimum occurrences
    const minOccurrences = input.min_occurrences || 2
    const patterns = allPatterns.filter(p => p.occurrences >= minOccurrences)

    // Save patterns for caching
    if (patterns.length > 0) {
      await saveErrorPatterns(patterns, context)
    }

    return {
      success: true,
      errors,
      patterns,
      total_errors: errors.length,
      unique_patterns: patterns.length,
    }
  } catch (error: any) {
    return {
      success: false,
      errors: [],
      patterns: [],
      total_errors: 0,
      unique_patterns: 0,
      error: `Failed to search errors: ${error.message}`,
    }
  }
}
