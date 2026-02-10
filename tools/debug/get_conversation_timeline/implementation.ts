/**
 * Get Conversation Timeline Tool
 * Generate timeline visualization
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  buildTimeline,
  formatTimelineForDisplay,
  generateTimelineVisualization,
  saveTimeline,
} from '@/lib/debugging'

interface GetConversationTimelineInput {
  conversation_id: string
  user_id: string
  format?: 'json' | 'text'
}

interface GetConversationTimelineOutput {
  success: boolean
  timeline: any
  formatted?: string
  error?: string
}

export default async function getConversationTimeline(
  input: GetConversationTimelineInput,
  context: ToolContext
): Promise<GetConversationTimelineOutput> {
  try {
    // Build timeline
    const timeline = await buildTimeline(input.conversation_id, input.user_id, context)

    // Save timeline
    await saveTimeline(timeline, input.user_id, context)

    // Format if requested
    let formatted: string | undefined
    if (input.format === 'text' || !input.format) {
      formatted = formatTimelineForDisplay(timeline)
    }

    return {
      success: true,
      timeline,
      formatted,
    }
  } catch (error: any) {
    return {
      success: false,
      timeline: null,
      error: `Failed to generate timeline: ${error.message}`,
    }
  }
}
