/**
 * Get Conversation Tool
 *
 * Retrieves full conversation history by ID
 */

import type { ToolContext } from '@/lib/tools/helpers/tool-context'
import { loadConversation } from '@/lib/conversations/storage-v2'
import type { ConversationFile } from '@/lib/conversations/types'

interface GetConversationParams {
  conversation_id: string
  user_id?: string
  include_tools?: boolean
}

interface GetConversationResult {
  success: boolean
  conversation?: ConversationFile
  error?: string
}

export default async function get_conversation(
  params: GetConversationParams,
  context: ToolContext
): Promise<GetConversationResult> {
  try {
    const { conversation_id, user_id = 'cli_user', include_tools = true } = params

    // Use provided user_id or default
    const userId = user_id

    // Try loading from global conversations first
    let conversation = await loadConversation(conversation_id, userId, context, 'global')

    // If not found in global, try current space
    if (!conversation && context.currentSpace !== 'global') {
      conversation = await loadConversation(conversation_id, userId, context, undefined)
    }

    if (!conversation) {
      return {
        success: false,
        error: `Conversation not found: ${conversation_id}`
      }
    }

    // Optionally filter out tool details
    if (!include_tools) {
      conversation = {
        ...conversation,
        tools_used: []
      }
    }

    return {
      success: true,
      conversation
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
