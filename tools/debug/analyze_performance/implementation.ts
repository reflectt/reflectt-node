/**
 * Analyze Performance Tool
 * Profile conversation performance
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  profileConversation,
  savePerformanceProfile,
  generatePerformanceRecommendations,
  loadPerformanceProfile,
} from '@/lib/debugging'

interface AnalyzePerformanceInput {
  conversation_id: string
  user_id: string
}

interface AnalyzePerformanceOutput {
  success: boolean
  profile: any
  recommendations: string[]
  error?: string
}

export default async function analyzePerformance(
  input: AnalyzePerformanceInput,
  context: ToolContext
): Promise<AnalyzePerformanceOutput> {
  try {
    // Try to load cached profile
    let profile = await loadPerformanceProfile(input.conversation_id, context)

    // If not cached, generate new profile
    if (!profile) {
      profile = await profileConversation(input.conversation_id, input.user_id, context)

      // Save for future use
      await savePerformanceProfile(profile, context)
    }

    // Generate recommendations
    const recommendations = generatePerformanceRecommendations(profile)

    return {
      success: true,
      profile,
      recommendations,
    }
  } catch (error: any) {
    return {
      success: false,
      profile: null,
      recommendations: [],
      error: `Failed to analyze performance: ${error.message}`,
    }
  }
}
