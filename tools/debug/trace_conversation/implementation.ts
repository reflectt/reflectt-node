/**
 * Trace Conversation Tool
 * Builds and visualizes complete execution traces
 */

import { ToolContext } from '@/lib/tools/helpers/tool-context'
import {
  buildConversationTrace,
  generateTreeVisualization,
  saveTrace,
  loadTrace,
} from '@/lib/debugging'

interface TraceConversationInput {
  conversation_id: string
  user_id: string
  include_visualization?: boolean
}

interface TraceConversationOutput {
  success: boolean
  trace: any
  visualization?: string
  error?: string
}

export default async function traceConversation(
  input: TraceConversationInput,
  context: ToolContext
): Promise<TraceConversationOutput> {
  try {
    // Try to load cached trace first
    let trace = await loadTrace(input.conversation_id, context)

    // If not cached or conversation_id is not root, build fresh trace
    if (!trace) {
      trace = await buildConversationTrace(input.conversation_id, context)

      // Save trace for future use
      await saveTrace(trace, context)
    }

    // Generate visualization if requested
    let visualization: string | undefined
    if (input.include_visualization !== false) {
      visualization = generateTreeVisualization(trace)
    }

    return {
      success: true,
      trace,
      visualization,
    }
  } catch (error: any) {
    return {
      success: false,
      trace: null,
      error: `Failed to trace conversation: ${error.message}`,
    }
  }
}
