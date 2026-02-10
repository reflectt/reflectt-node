/**
 * Search Conversations Tool
 *
 * Searches conversations by various criteria
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { searchConversations } from '@/lib/conversations/storage-v2'
import type { SearchConversationsParams, ConversationSummary } from '@/lib/conversations/types'

interface SearchResult {
  success: boolean
  conversations?: ConversationSummary[]
  total?: number
  error?: string
}

export default async function search_conversations_tool(
  params: SearchConversationsParams,
  context: ToolContext
): Promise<SearchResult> {
  try {
    // Search in global conversations (all conversations are stored there)
    const result = await searchConversations(params, context, 'global')

    return {
      success: true,
      conversations: result.conversations,
      total: result.total
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
