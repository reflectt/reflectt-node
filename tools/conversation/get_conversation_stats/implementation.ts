/**
 * Get Conversation Statistics Tool
 *
 * Provides usage statistics and cost analysis
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { getConversationStats } from '@/lib/conversations/storage-v2'
import type { GetConversationStatsParams, ConversationStats } from '@/lib/conversations/types'

interface StatsResult {
  success: boolean
  stats?: ConversationStats
  error?: string
}

export default async function get_conversation_stats_tool(
  params: GetConversationStatsParams,
  context: ToolContext
): Promise<StatsResult> {
  try {
    // Get stats from global conversations
    const stats = await getConversationStats(params, context, 'global')

    return {
      success: true,
      stats
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
